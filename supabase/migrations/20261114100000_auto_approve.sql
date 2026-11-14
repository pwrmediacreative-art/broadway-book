-- Auto-approve: an AI reading that clears every rule below goes live on its own, as
-- Unverified. Everything else stays in needs_review exactly as before.
--
-- * Two settings (admins change them on /admin/import, no code): the switch (off by
--   default) and the cutoff in percent (75, settable 50 to 99).
-- * One rule, in one place: auto_approve_candidates(), with the comparison in
--   auto_approve_over(). Used when a reading is saved (ai_finish) and by the "existing
--   drafts" button (auto_approve_existing). Any "# UNCLEAR" note keeps a chart in review.
-- * The record is a row in auto_approvals (approved_by = 'auto', the score, the cutoff
--   used, when, and a pull-back if any). Revisions are never edited. Admin-only.
-- * The public history page gets a line: "Automatic · Published automatically from the
--   AI reading, not checked yet" (verification_log, no person).
-- * Admins can send one chart back (auto_approve_revert) or all of them
--   (auto_approve_pull_back). A chart that was sent back is never auto-approved again.
-- * Switching off stops new auto-approvals; it never unpublishes anything.
-- * Verified status comes from 20261113200000_verification.sql: only an admin verifies, and
--   its trigger keeps songs.unverified true for any chart no admin has verified. Nothing
--   here sets or clears verification.
-- Replaces ai_finish (20261113160000) and review_items, review_list, review_song
-- (20261113200000); those files are unchanged.

-- ── settings: allow 0 (switch off) ──────────────────────────────────────────
do $$
declare
  c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.settings'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%value%' loop
    execute format('alter table public.settings drop constraint %I', c);
  end loop;
end $$;
alter table public.settings add constraint settings_value_check check (value between 0 and 1000);

insert into public.settings (key, value, label) values
  ('auto_approve_enabled', 0, 'Auto-approve AI charts (1 = on, 0 = off)'),
  ('auto_approve_min_confidence', 75, 'Auto-approve: score must be over this percent')
on conflict (key) do nothing;

-- ── who or what approved it ─────────────────────────────────────────────────
-- One row per auto-approved revision. Admins read it through the functions below;
-- players and the API can't read or write it.
create table public.auto_approvals (
  id bigint generated always as identity primary key,
  song_id uuid not null references public.songs (id) on delete cascade,
  revision_id uuid not null unique references public.revisions (id) on delete cascade,
  approved_by text not null default 'auto' check (approved_by = 'auto'),
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  cutoff numeric(3,2) not null check (cutoff between 0 and 1), -- the setting at that moment
  approved_at timestamptz not null default now(),
  run_by uuid references public.profiles (id) on delete set null, -- admin whose run saved it
  pulled_back_at timestamptz,                                      -- sent back to needs_review
  pulled_back_by uuid references public.profiles (id) on delete set null
);
create index auto_approvals_song on public.auto_approvals (song_id);
alter table public.auto_approvals enable row level security;
revoke all on public.auto_approvals from anon, authenticated;

-- ── the comparison, in one place ────────────────────────────────────────────
-- Strictly over: a score of exactly the cutoff does not pass.
create or replace function public.auto_approve_over(p_confidence numeric, p_cutoff_percent int)
returns boolean
language sql immutable set search_path = ''
as $$
  select p_confidence is not null and p_cutoff_percent is not null
     and p_confidence * 100 > p_cutoff_percent;
$$;
revoke execute on function public.auto_approve_over from public, anon, authenticated;

-- ── the rule, in one place ──────────────────────────────────────────────────
-- Songs that may be auto-approved right now (one song when p_song_id is given). The
-- switch is NOT checked here, so the admin panel can show the count while it's off;
-- everything that publishes checks the switch itself.
--   * in needs_review, not on hold, not claimed, no saved review draft
--   * its chart is the AI reading, saved as 'ok' on the first try (the server only saves
--     'ok' when the chart passed the parser), never re-read by "Retry failed", no
--     technical failure on record (ai_finish also checks the one it is saving)
--   * score strictly over the cutoff, no "# UNCLEAR" notes, lyrics guard again
--   * no other live Dropbox file with the same title and artist
--   * the song was never auto-approved before (so one that was sent back stays back)
create or replace function public.auto_approve_candidates(p_song_id uuid default null)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select s.id
  from public.songs s
  join public.revisions v on v.id = s.current_revision_id
  join public.ai_readings r on r.revision_id = v.id
  where (p_song_id is null or s.id = p_song_id)
    and s.status = 'needs_review' and not s.review_hold
    and s.verified_at is null and not s.is_example
    and v.source = 'ai'
    and r.status = 'ok' and r.admin_retries = 0 and r.failures = 0
    and public.auto_approve_over(v.ai_confidence, public.setting('auto_approve_min_confidence', 75))
    and public.unclear_count(v.chart_text) = 0
    and char_length(v.chart_text) <= 20000
    and not public.chart_has_long_cue(v.chart_text)
    and not exists (select 1 from public.auto_approvals x where x.song_id = s.id)
    and not exists (select 1 from public.review_claims c where c.song_id = s.id and c.expires_at > now())
    and not exists (select 1 from public.review_drafts d where d.song_id = s.id)
    and (select count(*) from public.import_files f
         where not f.missing and f.title is not null and f.artist is not null
           and lower(f.title) = lower(s.title) and lower(f.artist) = lower(s.artist)) <= 1;
$$;
revoke execute on function public.auto_approve_candidates from public, anon, authenticated;

-- Songs that are auto-approved right now: live, Unverified, the live chart is the one
-- that was auto-approved, not sent back, and nobody has Verified it since.
create or replace function public.auto_approved_songs()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select s.id
  from public.songs s
  join public.auto_approvals a on a.revision_id = s.current_revision_id
  where s.status = 'published' and s.verified_at is null and not s.is_example
    and a.pulled_back_at is null
    -- verified once and later marked unverified by an admin: a person has looked at it
    and not exists (select 1 from public.verification_log l
                    where l.song_id = s.id and l.revision_id = a.revision_id and l.status = 'verified');
$$;
revoke execute on function public.auto_approved_songs from public, anon, authenticated;

-- Publish these songs as Unverified and record the approval. Internal: callers have
-- already checked the rule and the switch.
create or replace function public.auto_approve_publish(p_ids uuid[])
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  cutoff int := public.setting('auto_approve_min_confidence', 75);
  n int;
begin
  insert into public.auto_approvals (song_id, revision_id, confidence, cutoff, run_by)
  select s.id, v.id, v.ai_confidence, least(greatest(cutoff, 0), 100) / 100.0, auth.uid()
  from public.songs s join public.revisions v on v.id = s.current_revision_id
  where s.id = any (p_ids) and s.verified_at is null
  on conflict (revision_id) do nothing;
  -- Unverified by construction: the songs_set_verification trigger (20261113200000) sets
  -- songs.unverified for any chart no admin has verified, and candidates have none.
  update public.songs set status = 'published', review_hold = false, updated_at = now()
  where id = any (p_ids) and verified_at is null;
  get diagnostics n = row_count;
  -- History page line. No person: the page shows it as "Automatic".
  insert into public.verification_log (song_id, revision_id, status, by_id, reason)
  select s.id, s.current_revision_id, 'unverified', null,
         'Published automatically from the AI reading, not checked yet'
  from public.songs s where s.id = any (p_ids) and s.status = 'published' and s.verified_at is null;
  update public.import_files set status = 'done', updated_at = now()
  where song_id = any (p_ids) and status = 'needs_review';
  return n;
end;
$$;
revoke execute on function public.auto_approve_publish from public, anon, authenticated;

-- ── admin: settings + numbers ───────────────────────────────────────────────
create or replace function public.auto_approve_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'enabled', public.setting('auto_approve_enabled', 0) = 1,
    'min_confidence', public.setting('auto_approve_min_confidence', 75),
    'would_publish', (select count(*) from public.auto_approve_candidates()),
    'live', (select count(*) from public.auto_approved_songs()),
    -- full-batch readings that went live by themselves (for the run summary)
    'batch_auto', (select count(*) from public.auto_approvals a
                   join public.ai_readings r on r.revision_id = a.revision_id where r.mode = 'batch'),
    'needs_review', (select count(*) from public.songs where status = 'needs_review'));
end;
$$;
revoke execute on function public.auto_approve_overview from public, anon;
grant execute on function public.auto_approve_overview to authenticated;

create or replace function public.auto_approve_set(p_enabled boolean, p_min_confidence int)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_enabled is null or p_min_confidence is null or p_min_confidence < 50 or p_min_confidence > 99 then
    raise exception 'Cutoff: a whole percent from 50 to 99';
  end if;
  update public.settings set value = v.value, updated_at = now(), updated_by = auth.uid()
  from (values ('auto_approve_enabled', case when p_enabled then 1 else 0 end),
               ('auto_approve_min_confidence', p_min_confidence)) v (key, value)
  where public.settings.key = v.key;
end;
$$;
revoke execute on function public.auto_approve_set from public, anon;
grant execute on function public.auto_approve_set to authenticated;

-- ── admin: the drafts already read ──────────────────────────────────────────
-- Count (p_dry_run) or publish every draft that passes the rule with the current
-- settings. Refuses to publish while the switch is off. Safe to run again: a chart that
-- is live, or was ever auto-approved, is not a candidate.
create or replace function public.auto_approve_existing(p_dry_run boolean)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  ids uuid[];
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.auto_approve'));
  select coalesce(array_agg(c), '{}') into ids from public.auto_approve_candidates() c;
  if coalesce(p_dry_run, true) then
    return cardinality(ids);
  end if;
  if public.setting('auto_approve_enabled', 0) <> 1 then
    raise exception 'Auto-approve is switched off';
  end if;
  return public.auto_approve_publish(ids);
end;
$$;
revoke execute on function public.auto_approve_existing from public, anon;
grant execute on function public.auto_approve_existing to authenticated;

-- ── admin: send back ────────────────────────────────────────────────────────
-- Internal: back to needs_review. Open player flags stay open.
create or replace function public.auto_approve_unpublish(p_ids uuid[])
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  update public.auto_approvals a set pulled_back_at = now(), pulled_back_by = auth.uid()
  from public.songs s
  where s.id = any (p_ids) and a.revision_id = s.current_revision_id and a.pulled_back_at is null;
  update public.songs set status = 'needs_review', updated_at = now()
  where id = any (p_ids);
  get diagnostics n = row_count;
  update public.import_files set status = 'needs_review', updated_at = now()
  where song_id = any (p_ids) and status = 'done' and not missing;
  return n;
end;
$$;
revoke execute on function public.auto_approve_unpublish from public, anon, authenticated;

-- One chart, from the review screen. Needs the song's claim like every review action.
create or replace function public.auto_approve_revert(p_song_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  perform public.review_take(p_song_id);
  perform 1 from public.songs where id = p_song_id for update;
  if not exists (select 1 from public.auto_approved_songs() a where a = p_song_id) then
    raise exception 'This chart isn''t auto-approved (or was already checked)';
  end if;
  perform public.auto_approve_unpublish(array[p_song_id]);
  delete from public.review_claims where song_id = p_song_id;
end;
$$;
revoke execute on function public.auto_approve_revert from public, anon;
grant execute on function public.auto_approve_revert to authenticated;

-- Every auto-approved chart that hasn't been Verified. p_dry_run only counts.
create or replace function public.auto_approve_pull_back(p_dry_run boolean)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  ids uuid[];
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.auto_approve'));
  select coalesce(array_agg(a), '{}') into ids from public.auto_approved_songs() a;
  if coalesce(p_dry_run, true) then
    return cardinality(ids);
  end if;
  return public.auto_approve_unpublish(ids);
end;
$$;
revoke execute on function public.auto_approve_pull_back from public, anon;
grant execute on function public.auto_approve_pull_back to authenticated;

-- ── ai_finish: same as 20261113160000, plus the auto-approve step at the end ─
create or replace function public.ai_finish(p_id uuid, p_status text, p_result jsonb)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r public.ai_readings;
  f public.import_files;
  s public.songs;
  st text := p_status;
  err text := left(p_result->>'error', 2000);
  chart text := p_result->>'chart_text';
  conf numeric := least(greatest((p_result->>'confidence')::numeric, 0), 1);
  cost numeric := coalesce((p_result->>'cost_usd')::numeric, 0);
  fails int;
  bpm_text text;
  sid uuid;
  rev uuid;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if st is null or st not in ('ok', 'ok_after_retry', 'needs_manual', 'refused', 'error') then
    raise exception 'bad status';
  end if;
  if cost < 0 or cost > 5 then
    raise exception 'cost_usd must be between 0 and 5';
  end if;
  select * into r from public.ai_readings where id = p_id for update;
  if not found then
    raise exception 'reading not found';
  end if;
  if r.status not in ('reserved', 'submitted') then
    return r.status;
  end if;
  select * into f from public.import_files where id = r.import_file_id;

  fails := case when st = 'error' and cost = 0 then r.failures + 1 else 0 end;
  if fails >= 2 then
    st := 'needs_manual';
    err := left(coalesce(err, 'Failed') || ' (failed twice; needs a person)', 2000);
  elsif st in ('error', 'refused') and fails = 0 and r.admin_retries > 0 then
    st := 'needs_manual';
  end if;

  -- The database repeats the lyrics guard instead of trusting the server.
  if st in ('ok', 'ok_after_retry') and (chart is null or char_length(chart) > 20000
                                          or public.chart_has_long_cue(chart)) then
    st := 'needs_manual';
    err := 'Chart missing, too long, or has a cue over 6 words.';
  end if;

  if st in ('ok', 'ok_after_retry') then
    sid := coalesce(f.song_id, public.import_ensure_song(f.id));
    select * into s from public.songs where id = sid for update;
    if sid is null then
      st := 'needs_manual';
      err := 'No song for this file (set its title and artist).';
    elsif s.status not in ('imported', 'draft', 'review', 'needs_review') then
      -- A live or archived song keeps its chart; don't add an unreviewed revision to
      -- its public history. The reading stays on this row.
      err := 'Song is ' || s.status || '; reading kept here, not attached.';
    else
      insert into public.revisions (song_id, chart_text, author_id, source, note, ai_confidence, ai_raw)
      values (sid, chart, auth.uid(), 'ai', left('AI reading of ' || coalesce(f.file_name, f.dropbox_path), 500),
              conf, p_result->'raw')
      returning id into rev;
      bpm_text := public.chart_tag(chart, 'bpm');
      update public.songs set
        current_revision_id = rev,
        status = 'needs_review',
        key = coalesce(public.chart_tag(chart, 'key'), key),
        bpm = case when bpm_text ~ '^\d{2,3}$' and bpm_text::int between 20 and 400 then bpm_text::int else bpm end,
        time_sig = coalesce(public.chart_tag(chart, 'time'), time_sig),
        dropbox_content_hash = r.content_hash,
        updated_at = now()
      where id = sid;
    end if;
  end if;

  update public.ai_readings set
    status = st,
    failures = fails,
    reserved_usd = 0,
    cost_usd = cost_usd + cost,
    input_tokens = input_tokens + coalesce((p_result->>'input_tokens')::int, 0),
    output_tokens = output_tokens + coalesce((p_result->>'output_tokens')::int, 0),
    cache_read_tokens = cache_read_tokens + coalesce((p_result->>'cache_read_tokens')::int, 0),
    cache_write_tokens = cache_write_tokens + coalesce((p_result->>'cache_write_tokens')::int, 0),
    confidence = conf,
    unclear = p_result->'unclear',
    raw = case when rev is null then p_result->'raw' end,
    error = err,
    revision_id = coalesce(rev, revision_id),
    updated_at = now()
  where id = p_id;

  update public.import_files set
    status = (case when st in ('ok', 'ok_after_retry') then 'needs_review'
                   when st = 'needs_manual' then 'needs_manual'
                   else 'error' end)::public.import_status,
    error = err,
    attempts = attempts + 1,
    song_id = coalesce(sid, song_id),
    updated_at = now()
  where id = f.id;

  -- New: with the switch on, a reading that passes the rule goes live as Unverified.
  -- r.failures is the count before this save (a technical failure that was re-sent).
  if rev is not null and r.failures = 0 and public.setting('auto_approve_enabled', 0) = 1
     and exists (select 1 from public.auto_approve_candidates(sid)) then
    perform public.auto_approve_publish(array[sid]);
  end if;

  return st;
end;
$$;
revoke execute on function public.ai_finish from public, anon;
grant execute on function public.ai_finish to authenticated;

-- ── review queue: the "auto_approved" filter and flag ───────────────────────
-- Same as 20261113200000 plus the auto_approved column and filter. The return type
-- changes, so the old function is dropped first (its callers below are re-created).
drop function public.review_items(text);
create function public.review_items(p_filter text)
returns table (
  id uuid, slug text, title text, artist text, status text, unverified boolean, review_hold boolean,
  unclear int, confidence numeric, flags int, flagged boolean, has_draft boolean,
  claimed_by uuid, claimed_name text, claim_expires timestamptz, file_id uuid, auto_approved boolean
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
           exists (select 1 from auto a where a.id = s.id) auto_approved
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
         c.expires_at, b.file_id, b.auto_approved
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

-- Same as 20261113200000 plus one count: auto_approved.
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

-- Same as 20261113200000 plus auto_approved and the cutoff it passed.
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
