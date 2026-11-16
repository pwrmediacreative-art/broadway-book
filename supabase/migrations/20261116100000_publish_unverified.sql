-- Publish every waiting AI draft as Unverified, plus "Played it, it's right".
--
-- * Bulk publish (run by `npm run publish:unverified`, service role only, never from the
--   browser): every needs_review song whose draft clears the rule in
--   publish_unverified_reasons() goes live as Unverified. The script also runs our chart
--   parser on each draft and only sends the ones that parse.
-- * Skipped, by reason: needs_manual (no usable reading), lyrics (the AI saw lyric lines on
--   the page), duplicate (another live Dropbox file or song with the same title + artist),
--   long_cue, held, in_review (claimed or a saved review draft), sent_back (an admin sent it
--   back or it was auto-approved before), verified, example, not_ai.
-- * The record reuses auto_approvals (20261114100000) with approved_by = 'bulk' and a
--   run_id, so the "Auto-approved" queue filter, "Send back to review" and the history line
--   all work for these charts. Revisions are never edited.
-- * Undo: publish_unverified_undo(run) sends back every song of that run that is still on
--   the bulk-published chart and unverified. Anything verified or changed since stays live.
--   Songs undone by the script (no person recorded) can be published again by a later run.
-- * chart_confirmations: one row per player per exact revision. A new revision starts at 0;
--   older rows stay on record. It never touches Verified status.
-- * Review queue: review_items gains `confirmations`; review_list / review_next gain the
--   'confirmed' order ("Most confirmed first", then highest confidence).
-- Replaces review_items, review_list, review_next, review_song; older files are unchanged.

-- ── auto_approvals: allow 'bulk' rows with a run tag ────────────────────────
do $$
declare
  c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.auto_approvals'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%approved_by%' loop
    execute format('alter table public.auto_approvals drop constraint %I', c);
  end loop;
end $$;
alter table public.auto_approvals
  add constraint auto_approvals_approved_by_check check (approved_by in ('auto', 'bulk')),
  add column run_id text check (run_id is null or run_id ~ '^[a-z0-9-]{1,40}$');
create index auto_approvals_run on public.auto_approvals (run_id) where run_id is not null;

-- ── the rule, in one place ──────────────────────────────────────────────────
-- Every needs_review song with the first reason it can't be bulk-published (null = it can,
-- if it also parses). Checked again inside the publish function.
create or replace function public.publish_unverified_reasons()
returns table (song_id uuid, reason text)
language sql stable security definer set search_path = ''
as $$
  with live_files as (
    select f.song_id, f.status, lower(f.title) lt, lower(f.artist) la
    from public.import_files f
    where not f.missing
  ),
  file_dups as (
    select lt, la from live_files where lt is not null and la is not null
    group by 1, 2 having count(*) > 1
  ),
  song_dups as (
    select lower(title) lt, lower(artist) la from public.songs
    where status <> 'archived' and title is not null and artist is not null
    group by 1, 2 having count(*) > 1
  )
  select s.id,
    case
      when s.is_example then 'example'
      when s.verified_at is not null then 'verified'
      when v.id is null or v.source <> 'ai' then 'not_ai'
      when r.status is null or r.status not in ('ok', 'ok_after_retry')
           or exists (select 1 from live_files lf where lf.song_id = s.id and lf.status = 'needs_manual')
        then 'needs_manual'
      when coalesce(v.ai_raw->>'has_lyrics', 'false') = 'true' then 'lyrics'
      when exists (select 1 from file_dups d where d.lt = lower(s.title) and d.la = lower(s.artist))
           or exists (select 1 from song_dups d where d.lt = lower(s.title) and d.la = lower(s.artist))
        then 'duplicate'
      when char_length(v.chart_text) > 20000 or public.chart_has_long_cue(v.chart_text) then 'long_cue'
      when s.review_hold then 'held'
      when exists (select 1 from public.review_claims c where c.song_id = s.id and c.expires_at > now())
           or exists (select 1 from public.review_drafts d where d.song_id = s.id)
        then 'in_review'
      -- an admin sent it back, or auto-approve already had its turn: a person decides now
      when exists (select 1 from public.auto_approvals x
                   where x.song_id = s.id and (x.approved_by = 'auto' or x.pulled_back_by is not null))
        then 'sent_back'
    end
  from public.songs s
  left join public.revisions v on v.id = s.current_revision_id
  left join public.ai_readings r on r.revision_id = v.id
  where s.status = 'needs_review';
$$;
revoke execute on function public.publish_unverified_reasons from public, anon, authenticated;

-- One page of needs_review drafts with their chart text, for the script's parser check.
create or replace function public.publish_unverified_plan(p_offset int, p_limit int)
returns table (song_id uuid, title text, artist text, confidence numeric, chart_text text, reason text)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.title, s.artist, v.ai_confidence, v.chart_text, x.reason
  from public.publish_unverified_reasons() x
  join public.songs s on s.id = x.song_id
  left join public.revisions v on v.id = s.current_revision_id
  order by s.id
  limit least(greatest(coalesce(p_limit, 500), 1), 500) offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke execute on function public.publish_unverified_plan from public, anon, authenticated;
grant execute on function public.publish_unverified_plan to service_role;

-- Publish these songs (at most 500 per call) as Unverified under run p_run. Songs that
-- fail the rule are ignored. Returns how many went live.
create or replace function public.publish_unverified_apply(p_run text, p_ids uuid[])
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  ids uuid[];
  n int;
begin
  if p_run is null or p_run !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'run id: 1 to 40 lowercase letters, digits or dashes';
  end if;
  if p_ids is null or cardinality(p_ids) > 500 then
    raise exception 'at most 500 songs per call';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.auto_approve'));
  select coalesce(array_agg(x.song_id), '{}') into ids
  from public.publish_unverified_reasons() x
  where x.reason is null and x.song_id = any (p_ids);

  insert into public.auto_approvals (song_id, revision_id, approved_by, confidence, cutoff, run_by, run_id)
  select s.id, v.id, 'bulk', coalesce(v.ai_confidence, 0), 0, null, p_run
  from public.songs s join public.revisions v on v.id = s.current_revision_id
  where s.id = any (ids)
  -- a song an earlier run published and the undo sent back: this run takes it again
  on conflict (revision_id) do update set
    run_id = excluded.run_id, approved_at = now(), pulled_back_at = null
  where public.auto_approvals.approved_by = 'bulk' and public.auto_approvals.pulled_back_by is null;

  -- Unverified by construction (songs_set_verification, 20261113200000).
  update public.songs set status = 'published', review_hold = false, updated_at = now()
  where id = any (ids) and status = 'needs_review' and verified_at is null;
  get diagnostics n = row_count;
  -- History page line. No person: the page shows it as "Automatic".
  insert into public.verification_log (song_id, revision_id, status, by_id, reason)
  select s.id, s.current_revision_id, 'unverified', null, 'Published as Unverified, not checked yet'
  from public.songs s where s.id = any (ids) and s.status = 'published' and s.verified_at is null;
  update public.import_files set status = 'done', updated_at = now()
  where song_id = any (ids) and status = 'needs_review';
  return n;
end;
$$;
revoke execute on function public.publish_unverified_apply from public, anon, authenticated;
grant execute on function public.publish_unverified_apply to service_role;

-- Undo a run (or one song of it with p_song_id). Sends back only songs still on the exact
-- chart the run published and still unverified; reports the rest as left_live.
create or replace function public.publish_unverified_undo(p_run text, p_dry_run boolean, p_song_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  ids uuid[];
  total int;
  n int := 0;
begin
  if p_run is null then
    raise exception 'run id needed';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.auto_approve'));
  select count(distinct a.song_id) into total
  from public.auto_approvals a
  where a.run_id = p_run and a.approved_by = 'bulk' and a.pulled_back_at is null
    and (p_song_id is null or a.song_id = p_song_id);
  select coalesce(array_agg(a.song_id), '{}') into ids
  from public.auto_approvals a
  join public.songs s on s.id = a.song_id and s.current_revision_id = a.revision_id
  where a.run_id = p_run and a.approved_by = 'bulk' and a.pulled_back_at is null
    and (p_song_id is null or a.song_id = p_song_id)
    and a.song_id in (select x from public.auto_approved_songs() x);
  if not coalesce(p_dry_run, true) then
    n := public.auto_approve_unpublish(ids);
  end if;
  return jsonb_build_object('run', p_run, 'dry_run', coalesce(p_dry_run, true),
    'would_unpublish', cardinality(ids), 'unpublished', n, 'left_live', total - cardinality(ids));
end;
$$;
revoke execute on function public.publish_unverified_undo from public, anon, authenticated;
grant execute on function public.publish_unverified_undo to service_role;

-- ── "Played it, it's right" ─────────────────────────────────────────────────
create table public.chart_confirmations (
  song_id uuid not null references public.songs (id) on delete cascade,
  revision_id uuid not null references public.revisions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (revision_id, user_id)
);
create index chart_confirmations_song on public.chart_confirmations (song_id, revision_id);
alter table public.chart_confirmations enable row level security;
revoke all on public.chart_confirmations from anon, authenticated;

-- Count for the live chart, and whether the signed-in player has confirmed it.
create or replace function public.chart_confirm_state(p_song_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'count', (select count(*) from public.chart_confirmations c where c.revision_id = s.current_revision_id),
    'mine', auth.uid() is not null and exists (select 1 from public.chart_confirmations c
                                               where c.revision_id = s.current_revision_id and c.user_id = auth.uid()))
  from public.songs s
  where s.id = p_song_id and s.status = 'published';
$$;
revoke execute on function public.chart_confirm_state from public;
grant execute on function public.chart_confirm_state to anon, authenticated;

-- Tap: confirm the live chart; tap again: take it back. Only on live Unverified charts.
create or replace function public.chart_confirm_toggle(p_song_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.songs;
begin
  if auth.uid() is null then
    raise exception 'Sign in to confirm a chart' using errcode = '42501';
  end if;
  if public.is_blocked(auth.uid()) then
    raise exception 'Your account can''t do this right now' using errcode = '42501';
  end if;
  select * into s from public.songs where id = p_song_id for share;
  if not found or s.status <> 'published' or s.is_example or not s.unverified or s.current_revision_id is null then
    raise exception 'Only live Unverified charts can be confirmed';
  end if;
  delete from public.chart_confirmations where revision_id = s.current_revision_id and user_id = auth.uid();
  if not found then
    insert into public.chart_confirmations (song_id, revision_id, user_id)
    values (s.id, s.current_revision_id, auth.uid());
  end if;
  return public.chart_confirm_state(p_song_id);
end;
$$;
revoke execute on function public.chart_confirm_toggle from public, anon;
grant execute on function public.chart_confirm_toggle to authenticated;

-- ── review queue: confirmations column + "Most confirmed first" ─────────────
-- Same as 20261114100000 plus confirmations (players who confirmed the live chart).
drop function public.review_items(text);
create function public.review_items(p_filter text)
returns table (
  id uuid, slug text, title text, artist text, status text, unverified boolean, review_hold boolean,
  unclear int, confidence numeric, flags int, flagged boolean, has_draft boolean,
  claimed_by uuid, claimed_name text, claim_expires timestamptz, file_id uuid, auto_approved boolean,
  confirmations int
)
language sql stable security definer set search_path = ''
as $$
  with alert as (select public.setting('flags_to_alert', 3) n),
  live_files as (
    select f.* from public.import_files f where not f.missing
  ),
  dup_keys as (
    select lower(title) lt, lower(artist) la from live_files
    where title is not null and artist is not null
    group by 1, 2 having count(*) > 1
  ),
  auto as (select a id from public.auto_approved_songs() a),
  base as (
    select s.id, s.slug, s.title, s.artist, s.status::text status, s.unverified, s.review_hold,
           s.verified_at,
           public.unclear_count(v.chart_text) unclear, v.ai_confidence confidence,
           (select count(*)::int from public.chart_flags fl where fl.song_id = s.id and fl.status = 'open') flags,
           exists (select 1 from public.review_drafts d where d.song_id = s.id) has_draft,
           f.id file_id, f.status::text file_status, f.title f_title, f.artist f_artist,
           exists (select 1 from auto a where a.id = s.id) auto_approved,
           (select count(*)::int from public.chart_confirmations cc where cc.revision_id = s.current_revision_id) confirmations
    from public.songs s
    left join public.revisions v on v.id = s.current_revision_id
    left join lateral (
      select lf.id, lf.status, lf.title, lf.artist from live_files lf where lf.song_id = s.id
      order by lf.updated_at desc limit 1
    ) f on true
    where s.status in ('needs_review', 'published', 'imported')
  )
  select b.id, b.slug, b.title, b.artist, b.status, b.unverified, b.review_hold, b.unclear, b.confidence,
         b.flags, b.flags >= (select n from alert), b.has_draft,
         c.user_id,
         case when c.user_id is not null then coalesce(nullif(p.display_name, ''), 'Another reviewer') end,
         c.expires_at, b.file_id, b.auto_approved, b.confirmations
  from base b
  left join public.review_claims c on c.song_id = b.id and c.expires_at > now()
  left join public.profiles p on p.id = c.user_id
  where case coalesce(p_filter, 'needs_review')
    when 'needs_manual' then b.file_status = 'needs_manual' and b.status <> 'published'
    when 'duplicates' then exists (select 1 from dup_keys k where k.lt = lower(b.f_title) and k.la = lower(b.f_artist))
    when 'unverified' then b.status = 'published' and b.unverified
    when 'verified' then b.status = 'published' and b.verified_at is not null
    when 'auto_approved' then b.auto_approved
    else (b.status = 'needs_review' and coalesce(b.file_status, '') <> 'needs_manual')
         or (b.status = 'published' and b.flags >= (select n from alert))
  end;
$$;
revoke execute on function public.review_items from public, anon, authenticated;

-- Same as 20261114100000 plus the 'confirmed' order.
create or replace function public.review_list(p_filter text, p_order text, p_q text, p_limit int, p_offset int)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  q text := nullif(trim(coalesce(p_q, '')), '');
  result jsonb;
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  with items as (
    select * from public.review_items(p_filter) i
    where q is null or i.title ilike '%' || q || '%' or i.artist ilike '%' || q || '%'
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'unverified', (select count(*) from public.songs where status = 'published' and unverified),
      'verified', (select count(*) from public.songs where status = 'published' and verified_at is not null),
      'auto_approved', (select count(*) from public.auto_approved_songs()),
      'needs_review', (select count(*) from public.review_items('needs_review')),
      'needs_manual', (select count(*) from public.review_items('needs_manual')),
      'duplicates', (select count(*) from public.review_items('duplicates')),
      'manual_files_without_song', (select count(*) from public.import_files
                                    where status = 'needs_manual' and song_id is null and not missing)),
    'matches', (select count(*) from items),
    'songs', coalesce((
      select jsonb_agg((to_jsonb(x) - 'ord' - 'claimed_by') || jsonb_build_object('claimed_by_me', x.claimed_by = auth.uid()))
      from (
        select *, row_number() over (
          order by flagged desc, review_hold,
                   case when p_order = 'confirmed' then -confirmations end,
                   public.review_order_key(p_order, confidence),
                   case when p_order = 'artist' then lower(coalesce(artist, '')) end,
                   lower(title), id) ord
        from items
        order by ord
        limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
      ) x), '[]')
  ) into result;
  return result;
end;
$$;
revoke execute on function public.review_list from public, anon;
grant execute on function public.review_list to authenticated;

-- Same as 20261113120000 plus the 'confirmed' order.
create or replace function public.review_next(p_filter text, p_order text, p_skip uuid[])
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  nid uuid;
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  select i.id into nid
  from public.review_items(p_filter) i
  where (i.claimed_by is null or i.claimed_by = auth.uid())
    and not (i.id = any (coalesce(p_skip, '{}')))
  order by i.flagged desc, i.review_hold,
           case when p_order = 'confirmed' then -i.confirmations end,
           public.review_order_key(p_order, i.confidence),
           case when p_order = 'artist' then lower(coalesce(i.artist, '')) end,
           lower(i.title), i.id
  limit 1;
  return nid;
end;
$$;
revoke execute on function public.review_next from public, anon;
grant execute on function public.review_next to authenticated;

-- Same as 20261114100000 plus confirmations.
create or replace function public.review_song(p_song_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  admin boolean := public.is_admin();
  f public.import_files;
  result jsonb;
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  select * into f from public.import_files where song_id = p_song_id
  order by missing, updated_at desc limit 1;
  select jsonb_build_object(
    'id', s.id, 'slug', s.slug, 'title', s.title, 'artist', s.artist, 'status', s.status,
    'unverified', s.unverified, 'review_hold', s.review_hold,
    'verified_at', s.verified_at, 'is_example', s.is_example,
    'verified_by', (select coalesce(nullif(display_name, ''), 'an admin') from public.profiles where id = s.verified_by),
    'revision_id', s.current_revision_id, 'chart_text', v.chart_text, 'source', v.source,
    'confidence', v.ai_confidence, 'notes', v.ai_raw->>'notes',
    'import_file_id', f.id, 'file_status', f.status, 'file_name', f.file_name,
    'is_admin', admin,
    'auto_approved', exists (select 1 from public.auto_approved_songs() a where a = s.id),
    'auto_cutoff', (select a.cutoff from public.auto_approvals a where a.revision_id = s.current_revision_id),
    'confirmations', (select count(*) from public.chart_confirmations cc where cc.revision_id = s.current_revision_id),
    'draft', (select jsonb_build_object('chart_text', d.chart_text, 'base_revision_id', d.base_revision_id,
                                        'updated_at', d.updated_at,
                                        'by', coalesce(nullif(p.display_name, ''), 'a reviewer'))
              from public.review_drafts d left join public.profiles p on p.id = d.updated_by
              where d.song_id = s.id),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object('reason', fl.reason, 'details', fl.details, 'created_at', fl.created_at,
                                          'by', case when admin then p.display_name end) order by fl.created_at)
      from public.chart_flags fl left join public.profiles p on p.id = fl.reporter_id
      where fl.song_id = s.id and fl.status = 'open'), '[]'),
    'duplicates', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'artist', o.artist, 'status', o.status,
                                          'file_name', df.file_name) order by df.file_name)
      from public.import_files df join public.songs o on o.id = df.song_id
      where f.title is not null and f.artist is not null and not df.missing
        and lower(df.title) = lower(f.title) and lower(df.artist) = lower(f.artist)
        and o.id <> s.id and o.status <> 'archived'), '[]')
  ) into result
  from public.songs s
  left join public.revisions v on v.id = s.current_revision_id
  where s.id = p_song_id;
  if result is null then
    raise exception 'Song not found';
  end if;
  return result;
end;
$$;
revoke execute on function public.review_song from public, anon;
grant execute on function public.review_song to authenticated;
