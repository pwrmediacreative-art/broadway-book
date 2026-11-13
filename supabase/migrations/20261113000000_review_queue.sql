-- Review queue for imported (AI-read) charts, "Unverified" publishing, and player flags.
--
-- * Admins work songs in 'needs_review': publish verified (no "# UNCLEAR" lines left),
--   publish as unverified (badge for players), hold, or bulk-publish the clean ones.
-- * Any signed-in player can flag a published chart as wrong, once per song. At
--   settings.flags_to_alert open flags, every admin gets a 'flagged' notification and the
--   song jumps to the top of the queue. Publishing it verified resolves its flags.
-- * Players never see how a chart was made: the revision's AI fields aren't readable.

-- ── songs ───────────────────────────────────────────────────────────────────
alter table public.songs
  add column unverified boolean not null default false, -- published before a human checked it
  add column review_hold boolean not null default false; -- an admin pushed it to the back of the queue

-- ── revisions: hide the AI columns from everyone but the database functions ─
revoke select on public.revisions from anon, authenticated;
grant select (id, song_id, chart_text, author_id, source, note, created_at) on public.revisions to anon, authenticated;

-- ── settings + notifications ────────────────────────────────────────────────
insert into public.settings (key, value, label)
values ('flags_to_alert', 3, 'Flags on a chart before admins are alerted')
on conflict (key) do nothing;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('merged', 'closed', 'out_of_date', 'flagged'));

-- ── chart_flags ─────────────────────────────────────────────────────────────
create table public.chart_flags (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  revision_id uuid references public.revisions (id) on delete set null, -- the chart they saw
  reason text not null check (reason in ('wrong_chords', 'wrong_structure', 'wrong_key', 'lyrics', 'other')),
  details text check (char_length(details) <= 300),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);
create unique index chart_flags_once on public.chart_flags (song_id, reporter_id) where status = 'open';
create index chart_flags_open on public.chart_flags (song_id) where status = 'open';
create index chart_flags_reporter on public.chart_flags (reporter_id, created_at desc);

alter table public.chart_flags enable row level security;
revoke all on public.chart_flags from anon, authenticated;
grant select on public.chart_flags to authenticated;
create policy "admins and reporters read flags" on public.chart_flags
  for select to authenticated using (public.is_admin() or reporter_id = auth.uid());
-- Writes only through flag_chart() and the review functions below.

create or replace function public.setting(p_key text, p_default int)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce((select value from public.settings where key = p_key), p_default);
$$;
revoke execute on function public.setting from public, anon, authenticated;

-- How many "# UNCLEAR" notes a chart still has. Internal.
create or replace function public.unclear_count(p_chart text)
returns int
language sql immutable set search_path = ''
as $$
  select coalesce(regexp_count(p_chart, '^# UNCLEAR', 1, 'n'), 0);
$$;

-- A signed-in player flags a published chart. One open flag per player per song,
-- at most 20 flags an hour. Returns 'flagged' or 'already'.
create or replace function public.flag_chart(p_song_id uuid, p_reason text, p_details text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s public.songs;
  n int;
begin
  if uid is null then
    raise exception 'Sign in to flag a chart' using errcode = '42501';
  end if;
  if public.is_blocked(uid) then
    raise exception 'Your account can''t flag charts' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('wrong_chords', 'wrong_structure', 'wrong_key', 'lyrics', 'other') then
    raise exception 'Pick a reason';
  end if;
  if char_length(coalesce(p_details, '')) > 300 then
    raise exception 'Keep the note under 300 characters';
  end if;
  select * into s from public.songs where id = p_song_id and status = 'published';
  if not found then
    raise exception 'Song not found';
  end if;
  if (select count(*) from public.chart_flags
      where reporter_id = uid and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many flags this hour. Try again later.';
  end if;

  insert into public.chart_flags (song_id, reporter_id, revision_id, reason, details)
  values (s.id, uid, s.current_revision_id, p_reason, nullif(trim(p_details), ''))
  on conflict (song_id, reporter_id) where status = 'open' do nothing;
  if not found then
    return 'already';
  end if;

  select count(*) into n from public.chart_flags where song_id = s.id and status = 'open';
  if n = public.setting('flags_to_alert', 3) then
    insert into public.notifications (user_id, kind, song_id)
    select p.id, 'flagged', s.id from public.profiles p where p.role = 'admin';
  end if;
  return 'flagged';
end;
$$;
revoke execute on function public.flag_chart from public, anon;
grant execute on function public.flag_chart to authenticated;

-- ── review (admins) ─────────────────────────────────────────────────────────
-- The queue: flagged songs first (at or over the alert threshold), then needs_review
-- songs, not held before held, fewest unclear spots, highest AI confidence.
create or replace function public.review_queue(p_q text, p_limit int, p_offset int)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  alert int := public.setting('flags_to_alert', 3);
  q text := nullif(trim(coalesce(p_q, '')), '');
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  with base as (
    select s.id, s.slug, s.title, s.artist, s.status::text status, s.unverified, s.review_hold,
           public.unclear_count(v.chart_text) unclear, v.ai_confidence confidence,
           (select count(*) from public.chart_flags f where f.song_id = s.id and f.status = 'open') flags
    from public.songs s
    left join public.revisions v on v.id = s.current_revision_id
    where s.status in ('needs_review', 'published')
  ),
  queue as (
    select * from base
    where (status = 'needs_review' or flags >= alert)
      and (q is null or title ilike '%' || q || '%' or artist ilike '%' || q || '%')
  )
  select jsonb_build_object(
    'needs_review', (select count(*) from base where status = 'needs_review'),
    'flagged', (select count(*) from base where flags >= alert),
    'held', (select count(*) from base where status = 'needs_review' and review_hold),
    'unverified', (select count(*) from base where status = 'published' and unverified),
    'alert', alert,
    'matches', (select count(*) from queue),
    'songs', coalesce((
      select jsonb_agg(to_jsonb(x) - 'ord')
      from (
        select *, row_number() over (
          order by (flags >= alert) desc, review_hold, unclear, confidence desc nulls last, title
        ) ord
        from queue
        order by ord
        limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
      ) x), '[]')
  ) into result;
  return result;
end;
$$;
revoke execute on function public.review_queue from public, anon;
grant execute on function public.review_queue to authenticated;

-- One song for the review screen: chart, its PDF's import row, open flags, and the next
-- song in the queue.
create or replace function public.review_song(p_song_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', s.id, 'slug', s.slug, 'title', s.title, 'artist', s.artist, 'status', s.status,
    'unverified', s.unverified, 'review_hold', s.review_hold,
    'revision_id', s.current_revision_id, 'chart_text', v.chart_text, 'source', v.source,
    'confidence', v.ai_confidence, 'notes', v.ai_raw->>'notes',
    'import_file_id', (select f.id from public.import_files f where f.song_id = s.id
                       order by f.missing, f.updated_at desc limit 1),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object('reason', f.reason, 'details', f.details, 'created_at', f.created_at,
                                          'by', p.display_name) order by f.created_at)
      from public.chart_flags f left join public.profiles p on p.id = f.reporter_id
      where f.song_id = s.id and f.status = 'open'), '[]'),
    'next_id', (
      select n.id from public.songs n
      left join public.revisions nv on nv.id = n.current_revision_id
      where n.id <> s.id and n.status = 'needs_review' and not n.review_hold
      order by public.unclear_count(nv.chart_text), nv.ai_confidence desc nulls last, n.title
      limit 1)
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

-- Publish a reviewed chart. p_verified: a human checked it against the original (no
-- "# UNCLEAR" notes may remain). p_base_revision guards against two admins at once.
-- A changed chart becomes a new 'human' revision; an unchanged one keeps its revision.
create or replace function public.review_publish(p_song_id uuid, p_chart text, p_verified boolean, p_base_revision uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  s public.songs;
  cur text;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select * into s from public.songs where id = p_song_id for update;
  if not found or s.status not in ('needs_review', 'published') then
    raise exception 'Song not found or not reviewable';
  end if;
  if s.current_revision_id is distinct from p_base_revision then
    raise exception 'This chart changed since you opened it. Reload and check again.';
  end if;
  if p_chart is null or char_length(p_chart) > 20000 or btrim(p_chart) = '' then
    raise exception 'Chart is empty or too long';
  end if;
  if public.chart_has_long_cue(p_chart) then
    raise exception 'A cue is over 6 words (lyrics aren''t allowed)';
  end if;
  if p_verified and public.unclear_count(p_chart) > 0 then
    raise exception 'Fix or delete every "# UNCLEAR" note before publishing as verified';
  end if;

  select chart_text into cur from public.revisions where id = s.current_revision_id;
  if cur is distinct from p_chart then
    perform public.publish_chart(s.id, p_chart, auth.uid(), 'human',
      case when p_verified then 'Checked against the original' else 'Reviewed' end);
  end if;
  update public.songs set status = 'published', unverified = not p_verified, review_hold = false, updated_at = now()
  where id = s.id;
  update public.import_files set status = 'done', updated_at = now() where song_id = s.id and status = 'needs_review';
  if p_verified then
    update public.chart_flags set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
    where song_id = s.id and status = 'open';
  end if;
  return case when p_verified then 'verified' else 'unverified' end;
end;
$$;
revoke execute on function public.review_publish from public, anon;
grant execute on function public.review_publish to authenticated;

create or replace function public.review_set_hold(p_song_id uuid, p_hold boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  update public.songs set review_hold = coalesce(p_hold, false), updated_at = now()
  where id = p_song_id and status = 'needs_review';
end;
$$;
revoke execute on function public.review_set_hold from public, anon;
grant execute on function public.review_set_hold to authenticated;

-- Close a song's open flags without changing the chart (they were wrong).
create or replace function public.review_dismiss_flags(p_song_id uuid)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  update public.chart_flags set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
  where song_id = p_song_id and status = 'open';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.review_dismiss_flags from public, anon;
grant execute on function public.review_dismiss_flags to authenticated;

-- Publish every needs_review song (not held) with at most p_max_unclear notes and AI
-- confidence of at least p_min_conf as unverified. p_dry_run only counts.
create or replace function public.review_bulk_unverified(p_max_unclear int, p_min_conf numeric, p_dry_run boolean)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  ids uuid[];
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_max_unclear is null or p_max_unclear < 0 or p_max_unclear > 50
     or p_min_conf is null or p_min_conf < 0 or p_min_conf > 1 then
    raise exception 'bad limits';
  end if;
  select coalesce(array_agg(s.id), '{}') into ids
  from public.songs s
  join public.revisions v on v.id = s.current_revision_id
  where s.status = 'needs_review' and not s.review_hold
    and public.unclear_count(v.chart_text) <= p_max_unclear
    and coalesce(v.ai_confidence, 0) >= p_min_conf
    and not public.chart_has_long_cue(v.chart_text);
  if not coalesce(p_dry_run, true) then
    update public.songs set status = 'published', unverified = true, updated_at = now() where id = any (ids);
    update public.import_files set status = 'done', updated_at = now()
    where song_id = any (ids) and status = 'needs_review';
  end if;
  return cardinality(ids);
end;
$$;
revoke execute on function public.review_bulk_unverified from public, anon;
grant execute on function public.review_bulk_unverified to authenticated;

-- Admin home: add the review numbers.
create or replace function public.admin_dashboard()
returns json
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return json_build_object(
    'songs',          (select count(*) from public.songs),
    'published',      (select count(*) from public.songs where status = 'published'),
    'open_proposals', (select count(*) from public.proposals where status = 'open'),
    'open_reports',   (select count(*) from public.reports where status = 'open'),
    'imports',        (select count(*) from public.import_files),
    'people',         (select count(*) from public.profiles),
    'needs_review',   (select count(*) from public.songs where status = 'needs_review'),
    'flagged',        (select count(distinct song_id) from public.chart_flags where status = 'open')
  );
end;
$$;
revoke execute on function public.admin_dashboard from public, anon;
grant execute on function public.admin_dashboard to authenticated;
