-- Review screen, part 2: claims, drafts, a review log, trusted reviewers, queue orders
-- and filters, progress.
--
-- * Trusted reviewers (profiles.reviewer, set by admins) can use the review screen like
--   admins: publish, publish unverified, save draft, can't read, skip. Hold, bulk publish,
--   dismissing flags, marking duplicates and reverts stay admin-only.
-- * Opening a song claims it for 30 minutes from the last activity. Every review action
--   needs the claim; a song claimed by someone else can't be changed until it expires.
-- * One working draft per song (review_drafts). Only publishing makes a revision.
-- * review_log records who published / couldn't read each song (admins + reviewers see
--   the counts; the log itself is never readable directly).

-- ── trusted reviewers ───────────────────────────────────────────────────────
alter table public.profiles add column reviewer boolean not null default false;

-- Column grants already stop users updating `reviewer` (only display_name and instrument
-- are granted); this backs it up.
create or replace function public.guard_profile_reviewer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reviewer is distinct from old.reviewer
     and coalesce(auth.role(), '') in ('anon', 'authenticated')
     and not public.is_admin() then
    raise exception 'only admins can set reviewers' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_reviewer
  before update on public.profiles
  for each row execute function public.guard_profile_reviewer();

-- Admins, plus trusted reviewers who aren't blocked.
create or replace function public.can_review()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and (role = 'admin' or (reviewer and not blocked))
  );
$$;
grant execute on function public.can_review to authenticated;

-- ── tables (no direct access: everything goes through the functions below) ──
create table public.review_claims (
  song_id uuid primary key references public.songs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null
);
create index review_claims_user on public.review_claims (user_id);
alter table public.review_claims enable row level security;

create table public.review_drafts (
  song_id uuid primary key references public.songs (id) on delete cascade,
  chart_text text not null check (char_length(chart_text) <= 20000),
  base_revision_id uuid references public.revisions (id),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.review_drafts enable row level security;

create table public.review_log (
  id bigint generated always as identity primary key,
  song_id uuid not null references public.songs (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('verified', 'unverified', 'cant_read', 'duplicate')),
  created_at timestamptz not null default now()
);
create index review_log_user on public.review_log (user_id, created_at);
alter table public.review_log enable row level security;

revoke all on public.review_claims, public.review_drafts, public.review_log from anon, authenticated;

create or replace function public.set_reviewer(p_user_id uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  update public.profiles set reviewer = coalesce(p_on, false) where id = p_user_id;
  if not found then
    raise exception 'Player not found';
  end if;
  if not coalesce(p_on, false) then
    delete from public.review_claims where user_id = p_user_id;
  end if;
end;
$$;
revoke execute on function public.set_reviewer from public, anon;
grant execute on function public.set_reviewer to authenticated;

-- ── claims ──────────────────────────────────────────────────────────────────
-- Claim (or renew) a song for the caller. Returns the holder's id: the caller when they
-- got it, someone else when it's taken. Releases the caller's other claims (one song at
-- a time). Internal.
create or replace function public.review_try_claim(p_song_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  holder uuid;
begin
  insert into public.review_claims (song_id, user_id, expires_at)
  values (p_song_id, auth.uid(), now() + interval '30 minutes')
  on conflict (song_id) do update
    set user_id = excluded.user_id, expires_at = excluded.expires_at
    where public.review_claims.user_id = excluded.user_id
       or public.review_claims.expires_at <= now()
  returning user_id into holder;
  if holder is null then
    select user_id into holder from public.review_claims where song_id = p_song_id;
    return holder;
  end if;
  delete from public.review_claims where user_id = auth.uid() and song_id <> p_song_id;
  return holder;
end;
$$;
revoke execute on function public.review_try_claim from public, anon, authenticated;

-- Every review action calls this first: it fails when someone else holds the song.
create or replace function public.review_take(p_song_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if public.review_try_claim(p_song_id) is distinct from auth.uid() then
    raise exception 'Someone else is reviewing this song right now.';
  end if;
end;
$$;
revoke execute on function public.review_take from public, anon, authenticated;

-- Open (or keep working on) a song: {mine, by, expires_at}.
create or replace function public.review_claim(p_song_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  holder uuid;
  c public.review_claims;
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.songs where id = p_song_id) then
    raise exception 'Song not found';
  end if;
  holder := public.review_try_claim(p_song_id);
  select * into c from public.review_claims where song_id = p_song_id;
  return jsonb_build_object(
    'mine', holder = auth.uid(),
    'by', (select coalesce(nullif(display_name, ''), 'Another reviewer') from public.profiles where id = holder),
    'expires_at', c.expires_at);
end;
$$;
revoke execute on function public.review_claim from public, anon;
grant execute on function public.review_claim to authenticated;

create or replace function public.review_release(p_song_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.review_claims where song_id = p_song_id and user_id = auth.uid();
$$;
revoke execute on function public.review_release from public, anon;
grant execute on function public.review_release to authenticated;

-- ── drafts ──────────────────────────────────────────────────────────────────
create or replace function public.review_save_draft(p_song_id uuid, p_chart text, p_base_revision uuid)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  ts timestamptz := now();
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  perform public.review_take(p_song_id);
  if p_chart is null or char_length(p_chart) > 20000 or btrim(p_chart) = '' then
    raise exception 'Chart is empty or too long';
  end if;
  if public.chart_has_long_cue(p_chart) then
    raise exception 'A cue is over 6 words (lyrics aren''t allowed)';
  end if;
  insert into public.review_drafts (song_id, chart_text, base_revision_id, updated_by, updated_at)
  values (p_song_id, p_chart, p_base_revision, auth.uid(), ts)
  on conflict (song_id) do update
    set chart_text = excluded.chart_text, base_revision_id = excluded.base_revision_id,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return ts;
end;
$$;
revoke execute on function public.review_save_draft from public, anon;
grant execute on function public.review_save_draft to authenticated;

create or replace function public.review_discard_draft(p_song_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  perform public.review_take(p_song_id);
  delete from public.review_drafts where song_id = p_song_id;
end;
$$;
revoke execute on function public.review_discard_draft from public, anon;
grant execute on function public.review_discard_draft to authenticated;

-- ── actions ─────────────────────────────────────────────────────────────────
-- Publish a reviewed chart (replaces the version from 20261113000000). Now also open to
-- reviewers, needs the claim, works for charts typed from scratch ('imported' songs),
-- logs who did it, clears the draft and releases the claim.
create or replace function public.review_publish(p_song_id uuid, p_chart text, p_verified boolean, p_base_revision uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  s public.songs;
  cur text;
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  perform public.review_take(p_song_id);
  select * into s from public.songs where id = p_song_id for update;
  if not found or s.status not in ('needs_review', 'published', 'imported') then
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
  update public.import_files set status = 'done', updated_at = now()
  where song_id = s.id and status in ('needs_review', 'needs_manual');
  if p_verified then
    update public.chart_flags set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
    where song_id = s.id and status = 'open';
  end if;
  insert into public.review_log (song_id, user_id, action)
  values (s.id, auth.uid(), case when p_verified then 'verified' else 'unverified' end);
  delete from public.review_drafts where song_id = s.id;
  delete from public.review_claims where song_id = s.id;
  return case when p_verified then 'verified' else 'unverified' end;
end;
$$;
revoke execute on function public.review_publish from public, anon;
grant execute on function public.review_publish to authenticated;

-- "Can't read": the PDF goes to needs_manual and the song leaves the main queue, hidden
-- from players. The AI draft stays as the song's revision. Not for live songs.
create or replace function public.review_cant_read(p_song_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.songs;
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  perform public.review_take(p_song_id);
  select * into s from public.songs where id = p_song_id for update;
  if not found or s.status not in ('needs_review', 'imported') then
    raise exception 'Only songs that aren''t live yet can be marked "can''t read"';
  end if;
  update public.songs set status = 'imported', review_hold = false, updated_at = now() where id = s.id;
  update public.import_files set status = 'needs_manual', updated_at = now()
  where song_id = s.id and not missing;
  insert into public.review_log (song_id, user_id, action) values (s.id, auth.uid(), 'cant_read');
  delete from public.review_claims where song_id = s.id;
end;
$$;
revoke execute on function public.review_cant_read from public, anon;
grant execute on function public.review_cant_read to authenticated;

-- Admins: this song is a duplicate of another one. Hidden for good (archived, kept).
create or replace function public.review_mark_duplicate(p_song_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  perform public.review_take(p_song_id);
  update public.songs set status = 'archived', review_hold = false, updated_at = now()
  where id = p_song_id and status <> 'archived';
  if not found then
    raise exception 'Song not found or already hidden';
  end if;
  update public.import_files set status = 'done', error = 'Duplicate of another chart', updated_at = now()
  where song_id = p_song_id;
  insert into public.review_log (song_id, user_id, action) values (p_song_id, auth.uid(), 'duplicate');
  delete from public.review_drafts where song_id = p_song_id;
  delete from public.review_claims where song_id = p_song_id;
end;
$$;
revoke execute on function public.review_mark_duplicate from public, anon;
grant execute on function public.review_mark_duplicate to authenticated;

-- A needs_manual file with no song yet gets one (needs a title and artist).
create or replace function public.review_file_song(p_file_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  return public.import_ensure_song(p_file_id);
end;
$$;
revoke execute on function public.review_file_song from public, anon;
grant execute on function public.review_file_song to authenticated;

-- Bulk "publish clean charts as unverified" now skips songs someone has claimed.
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
    and not public.chart_has_long_cue(v.chart_text)
    and not exists (select 1 from public.review_claims c where c.song_id = s.id and c.expires_at > now());
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

-- ── queue ───────────────────────────────────────────────────────────────────
-- Every song a filter covers, with what the queue shows and sorts by. Internal.
--   needs_review: not live yet and readable, plus live songs with enough player flags
--   needs_manual: the PDF was marked "can't read" (or the reader gave up)
--   duplicates:   another live PDF has the same title and artist
create or replace function public.review_items(p_filter text)
returns table (
  id uuid, slug text, title text, artist text, status text, unverified boolean, review_hold boolean,
  unclear int, confidence numeric, flags int, flagged boolean, has_draft boolean,
  claimed_by uuid, claimed_name text, claim_expires timestamptz, file_id uuid
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
  base as (
    select s.id, s.slug, s.title, s.artist, s.status::text status, s.unverified, s.review_hold,
           public.unclear_count(v.chart_text) unclear, v.ai_confidence confidence,
           (select count(*)::int from public.chart_flags fl where fl.song_id = s.id and fl.status = 'open') flags,
           exists (select 1 from public.review_drafts d where d.song_id = s.id) has_draft,
           f.id file_id, f.status::text file_status, f.title f_title, f.artist f_artist
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
         c.user_id, coalesce(nullif(p.display_name, ''), 'Another reviewer'), c.expires_at, b.file_id
  from base b
  left join public.review_claims c on c.song_id = b.id and c.expires_at > now()
  left join public.profiles p on p.id = c.user_id
  where case coalesce(p_filter, 'needs_review')
    when 'needs_manual' then b.file_status = 'needs_manual' and b.status <> 'published'
    when 'duplicates' then exists (select 1 from dup_keys k where k.lt = lower(b.f_title) and k.la = lower(b.f_artist))
    else (b.status = 'needs_review' and coalesce(b.file_status, '') <> 'needs_manual')
         or (b.status = 'published' and b.flags >= (select n from alert))
  end;
$$;
revoke execute on function public.review_items from public, anon, authenticated;

-- Queue order: flagged songs first, held ones last, then the chosen order.
--   conf_desc (default) | conf_asc | title | artist
create or replace function public.review_order_key(p_order text, p_confidence numeric)
returns numeric
language sql immutable set search_path = ''
as $$
  select case p_order
    when 'conf_asc' then coalesce(p_confidence, 2)
    when 'title' then 0
    when 'artist' then 0
    else -coalesce(p_confidence, -1)
  end;
$$;

-- The next song to open: in queue order, not claimed by someone else, not in p_skip.
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
           public.review_order_key(p_order, i.confidence),
           case when p_order = 'artist' then lower(coalesce(i.artist, '')) end,
           lower(i.title), i.id
  limit 1;
  return nid;
end;
$$;
revoke execute on function public.review_next from public, anon;
grant execute on function public.review_next to authenticated;

-- Progress for the bar: Dropbox songs live (verified / unverified) out of the live PDFs,
-- plus how many each person published or couldn't read (all-time and today, Nashville time).
create or replace function public.review_progress()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  result jsonb;
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'total', (select count(*) from public.import_files where not missing),
    'verified', (select count(*) from public.songs where status = 'published' and dropbox_path is not null and not unverified),
    'unverified', (select count(*) from public.songs where status = 'published' and dropbox_path is not null and unverified),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'total', x.total, 'today', x.today, 'me', x.me)
                       order by x.total desc, x.name)
      from (
        select coalesce(nullif(p.display_name, ''), 'Unnamed') name, count(*) total,
               count(*) filter (where (l.created_at at time zone 'America/Chicago')::date = today) today,
               l.user_id = auth.uid() me
        from public.review_log l join public.profiles p on p.id = l.user_id
        where l.action in ('verified', 'unverified', 'cant_read')
        group by l.user_id, p.display_name
      ) x), '[]')
  ) into result;
  return result;
end;
$$;
revoke execute on function public.review_progress from public, anon;
grant execute on function public.review_progress to authenticated;

-- The queue list: one page of a filter in the chosen order, counts per filter.
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

-- Needs_manual PDFs that have no song yet (so the queue can't list them).
create or replace function public.review_manual_files(p_limit int)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'title', f.title, 'artist', f.artist))
    from (select * from public.import_files
          where status = 'needs_manual' and song_id is null and not missing
          order by file_name limit least(greatest(coalesce(p_limit, 50), 1), 200)) f), '[]');
end;
$$;
revoke execute on function public.review_manual_files from public, anon;
grant execute on function public.review_manual_files to authenticated;

-- ── one song ────────────────────────────────────────────────────────────────
-- Replaces the version from 20261113000000: open to reviewers; adds the draft, the PDF's
-- import status and duplicate copies. Flaggers' names only for admins.
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
    'revision_id', s.current_revision_id, 'chart_text', v.chart_text, 'source', v.source,
    'confidence', v.ai_confidence, 'notes', v.ai_raw->>'notes',
    'import_file_id', f.id, 'file_status', f.status, 'file_name', f.file_name,
    'is_admin', admin,
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

-- The PDF behind a song, for the viewer. Reviewers can't read import_files directly.
create or replace function public.review_pdf_ref(p_file_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  return (select jsonb_build_object('dropbox_file_id', dropbox_file_id, 'dropbox_path', dropbox_path)
          from public.import_files where id = p_file_id);
end;
$$;
revoke execute on function public.review_pdf_ref from public, anon;
grant execute on function public.review_pdf_ref to authenticated;
