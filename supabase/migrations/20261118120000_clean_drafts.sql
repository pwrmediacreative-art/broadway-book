-- Clean AI drafts: approve as is, review last.
--
-- * A chart is "clean" when it is the AI reading, has zero "# UNCLEAR" notes and an AI
--   confidence of 75% or higher (is_clean_reading: the rule in one place).
-- * approved_as_is: admin-only record that a clean chart was approved as is (approved_by
--   'auto', time, confidence, run id). Tied to the exact revision; a new revision is not
--   marked. Players never see it (they get the normal Unverified badge). It never touches
--   Verified status: only admins verify.
-- * New drafts: auto-approve (when its switch is on) and the bulk publish both record
--   auto_approvals; a trigger marks the chart when it is clean. With auto-approve off,
--   clean drafts wait like any other.
-- * One-time pass (scripts/clean-drafts.ts, service role): clean_plan() sorts every
--   never-verified AI chart, live or waiting, into mark_live / publish_draft /
--   skip_<reason> / already / not_clean. Apply marks the live ones (clean_mark) and
--   publishes the waiting clean drafts through publish_unverified_apply (same rules as the
--   bulk run; the trigger marks them). Undo: clean_undo(run) clears that run's marks, and
--   the script sends that run's published drafts back with publish_unverified_undo.
-- * Review queue: review_items gains `clean`, filter 'clean' and count 'clean'; clean
--   charts sort after everything else. Older files are unchanged.

create or replace function public.is_clean_reading(p_source text, p_chart text, p_confidence numeric)
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(p_source = 'ai' and p_chart is not null and p_confidence is not null
     and p_confidence * 100 >= 75 and public.unclear_count(p_chart) = 0, false);
$$;
revoke execute on function public.is_clean_reading from public, anon, authenticated;

create table public.approved_as_is (
  id bigint generated always as identity primary key,
  song_id uuid not null references public.songs (id) on delete cascade,
  revision_id uuid not null references public.revisions (id) on delete cascade,
  approved_by text not null default 'auto' check (approved_by = 'auto'),
  approved_at timestamptz not null default now(),
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  run_id text check (run_id is null or run_id ~ '^[a-z0-9-]{1,40}$'),
  undone_at timestamptz
);
create unique index approved_as_is_live on public.approved_as_is (revision_id) where undone_at is null;
create index approved_as_is_song on public.approved_as_is (song_id);
create index approved_as_is_run on public.approved_as_is (run_id) where run_id is not null;
alter table public.approved_as_is enable row level security;
revoke all on public.approved_as_is from anon, authenticated;
grant select on public.approved_as_is to authenticated;
create policy "admins read approved_as_is" on public.approved_as_is for select to authenticated
  using (public.is_admin());

-- auto-approve and the bulk publish both write auto_approvals: mark the chart when clean.
create or replace function public.auto_approvals_mark_clean()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.pulled_back_at is null then
    insert into public.approved_as_is (song_id, revision_id, confidence, run_id)
    select new.song_id, v.id, v.ai_confidence, new.run_id
    from public.revisions v
    where v.id = new.revision_id
      and public.is_clean_reading(v.source::text, v.chart_text, v.ai_confidence)
    on conflict (revision_id) where undone_at is null do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.auto_approvals_mark_clean from public, anon, authenticated;
create trigger auto_approvals_mark_clean
  after insert or update of run_id, pulled_back_at on public.auto_approvals
  for each row execute function public.auto_approvals_mark_clean();

-- Every never-verified AI chart, live or waiting, with what the one-time pass would do.
create or replace function public.clean_plan()
returns table (song_id uuid, title text, artist text, status text, unclear int, confidence numeric,
               bucket text, chart_text text)
language sql stable security definer set search_path = ''
as $$
  with r as (select * from public.publish_unverified_reasons())
  select s.id, s.title, s.artist, s.status::text, public.unclear_count(v.chart_text), v.ai_confidence,
    case
      when not public.is_clean_reading(v.source::text, v.chart_text, v.ai_confidence) then 'not_clean'
      when exists (select 1 from public.approved_as_is m where m.revision_id = v.id and m.undone_at is null) then 'already'
      when s.status = 'published' then 'mark_live'
      when r.reason is null then 'publish_draft'
      else 'skip_' || r.reason
    end,
    case when s.status = 'needs_review' then v.chart_text end
  from public.songs s
  join public.revisions v on v.id = s.current_revision_id
  left join r on r.song_id = s.id
  where not s.is_example and s.verified_at is null and v.source = 'ai'
    and s.status in ('published', 'needs_review');
$$;
revoke execute on function public.clean_plan from public, anon, authenticated;
grant execute on function public.clean_plan to service_role;

-- Mark live clean charts (only those clean_plan puts in mark_live right now).
create or replace function public.clean_mark(p_run text, p_ids uuid[])
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if p_run is null or p_run !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'run id: 1 to 40 lowercase letters, digits or dashes';
  end if;
  if p_ids is null or cardinality(p_ids) > 500 then
    raise exception 'at most 500 songs per call';
  end if;
  insert into public.approved_as_is (song_id, revision_id, confidence, run_id)
  select p.song_id, s.current_revision_id, p.confidence, p_run
  from public.clean_plan() p join public.songs s on s.id = p.song_id
  where p.bucket = 'mark_live' and p.song_id = any (p_ids)
  on conflict (revision_id) where undone_at is null do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.clean_mark from public, anon, authenticated;
grant execute on function public.clean_mark to service_role;

-- Undo a run's marks (the drafts it published go back through publish_unverified_undo).
create or replace function public.clean_undo(p_run text, p_dry_run boolean)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if p_dry_run then
    select count(*) into n from public.approved_as_is where run_id = p_run and undone_at is null;
  else
    update public.approved_as_is set undone_at = now() where run_id = p_run and undone_at is null;
    get diagnostics n = row_count;
  end if;
  return n;
end;
$$;
revoke execute on function public.clean_undo from public, anon, authenticated;
grant execute on function public.clean_undo to service_role;

-- ── review queue: clean column, filter and count; clean charts last ─────────
drop function public.review_items(text);
create function public.review_items(p_filter text)
returns table (
  id uuid, slug text, title text, artist text, status text, unverified boolean, review_hold boolean,
  unclear int, confidence numeric, flags int, flagged boolean, has_draft boolean,
  claimed_by uuid, claimed_name text, claim_expires timestamptz, file_id uuid, auto_approved boolean,
  confirmations int, clean boolean
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
           (select count(*)::int from public.chart_confirmations cc where cc.revision_id = s.current_revision_id) confirmations,
           s.verified_at is null and exists (select 1 from public.approved_as_is m
             where m.revision_id = s.current_revision_id and m.undone_at is null) clean
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
         c.expires_at, b.file_id, b.auto_approved, b.confirmations, b.clean
  from base b
  left join public.review_claims c on c.song_id = b.id and c.expires_at > now()
  left join public.profiles p on p.id = c.user_id
  where case coalesce(p_filter, 'needs_review')
    when 'needs_manual' then b.file_status = 'needs_manual' and b.status <> 'published'
    when 'duplicates' then exists (select 1 from dup_keys k where k.lt = lower(b.f_title) and k.la = lower(b.f_artist))
    when 'unverified' then b.status = 'published' and b.unverified
    when 'verified' then b.status = 'published' and b.verified_at is not null
    when 'auto_approved' then b.auto_approved
    when 'clean' then b.status = 'published' and b.unverified and b.clean
    else (b.status = 'needs_review' and coalesce(b.file_status, '') <> 'needs_manual')
         or (b.status = 'published' and b.flags >= (select n from alert))
  end;
$$;
revoke execute on function public.review_items from public, anon, authenticated;

-- Same as 20261116100000; clean charts sort last.
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
      'clean', (select count(*) from public.review_items('clean')),
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
          order by flagged desc, review_hold, clean,
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

-- Same as 20261116100000; clean charts sort last.
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
  order by i.flagged desc, i.review_hold, i.clean,
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
