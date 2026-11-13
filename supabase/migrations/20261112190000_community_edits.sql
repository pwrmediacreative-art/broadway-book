-- Community edits.
-- * Signed-in users suggest a chart change (proposals). It merges after N approvals and
--   closes after N rejections (N lives in `settings`, so admins can change it without code).
-- * A suggestion is "out of date" when the song's live revision is no longer the one it was
--   based on. Out-of-date suggestions can't be voted on or merged; the author updates them
--   (which resets the votes). Nothing ever overwrites a newer revision.
-- * Admins approve now / close, revert to any revision, block users, handle reports.
-- * Personal chart versions: one private copy per user per song, owner-only.
-- * In-app notifications for authors (merged, closed, out of date).
-- All rules are enforced here (triggers, security-definer functions, RLS), not in the UI.

-- ── settings ────────────────────────────────────────────────────────────────
create table public.settings (
  key text primary key,
  value int not null check (value between 1 and 1000),
  label text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.settings (key, value, label) values
  ('approvals_needed', 3, 'Approvals to merge a suggestion'),
  ('rejections_needed', 3, 'Rejections to close a suggestion'),
  ('max_open_proposals', 5, 'Open suggestions per person'),
  ('votes_per_hour', 30, 'Votes per person per hour');

alter table public.settings enable row level security;
revoke all on public.settings from anon, authenticated;
grant select on public.settings to anon, authenticated;
create policy "settings are public" on public.settings for select using (true);

create or replace function public.app_setting(p_key text)
returns int
language sql stable security definer set search_path = ''
as $$
  select value from public.settings where key = p_key;
$$;

create or replace function public.set_setting(p_key text, p_value int)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change settings' using errcode = '42501';
  end if;
  if p_value is null or p_value < 1 or p_value > 1000 then
    raise exception 'Pick a number from 1 to 1000';
  end if;
  update public.settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  if not found then
    raise exception 'Unknown setting %', p_key;
  end if;
end;
$$;
revoke execute on function public.set_setting from public, anon;
grant execute on function public.set_setting to authenticated;

-- ── blocking ────────────────────────────────────────────────────────────────
alter table public.profiles add column blocked boolean not null default false;

-- Column grants already stop users updating `blocked`; this backs it up.
create or replace function public.guard_profile_blocked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.blocked is distinct from old.blocked
     and coalesce(auth.role(), '') in ('anon', 'authenticated')
     and not public.is_admin() then
    raise exception 'only admins can block users' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_blocked
  before update on public.profiles
  for each row execute function public.guard_profile_blocked();

create or replace function public.is_blocked(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select blocked from public.profiles where id = p_user), false);
$$;

create or replace function public.set_blocked(p_user uuid, p_blocked boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can block users' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'admin') then
    raise exception 'Admins can''t be blocked';
  end if;
  update public.profiles set blocked = p_blocked where id = p_user;
  if p_blocked then
    update public.proposals
      set status = 'withdrawn', decided_at = now(), decided_by = auth.uid()
      where author_id = p_user and status = 'open';
  end if;
end;
$$;
revoke execute on function public.set_blocked from public, anon;
grant execute on function public.set_blocked to authenticated;

-- ── lyric guard: cues are "short quoted text", 6 words max (same rule as the parser) ──
create or replace function public.chart_has_long_cue(chart text)
returns boolean
language sql immutable set search_path = ''
as $$
  select exists (
    select 1 from regexp_matches(chart, '"([^"]+)"', 'g') as m(arr)
    where array_length(regexp_split_to_array(btrim(arr[1]), '\s+'), 1) > 6
  );
$$;

-- ── notifications ───────────────────────────────────────────────────────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('merged', 'closed', 'out_of_date')),
  proposal_id uuid references public.proposals (id) on delete cascade,
  song_id uuid references public.songs (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy "read own notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "mark own notifications read" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── proposals ───────────────────────────────────────────────────────────────
alter table public.proposals add column updated_at timestamptz not null default now();
create index proposals_open on public.proposals (created_at desc) where status = 'open';
create index proposals_author_open on public.proposals (author_id) where status = 'open';

-- PostgREST computed column: select=...,out_of_date
create or replace function public.out_of_date(p public.proposals)
returns boolean
language sql stable set search_path = ''
as $$
  select p.base_revision_id is distinct from (select s.current_revision_id from public.songs s where s.id = p.song_id);
$$;

create or replace function public.check_new_proposal()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  cur uuid;
  open_count int;
begin
  if public.is_blocked(new.author_id) then
    raise exception 'Your account can''t suggest changes right now' using errcode = '42501';
  end if;
  new.note := btrim(coalesce(new.note, ''));
  if char_length(new.note) < 3 then
    raise exception 'Add a short note saying what you changed';
  end if;
  if public.chart_has_long_cue(new.chart_text) then
    raise exception 'A cue is longer than 6 words. Cues only, never lyrics.';
  end if;
  select current_revision_id into cur from public.songs where id = new.song_id;
  if new.base_revision_id is null then
    new.base_revision_id := cur;
  elsif new.base_revision_id is distinct from cur then
    raise exception 'The chart changed while you were editing. Reload to start from the newest version.'
      using hint = 'stale';
  end if;
  if exists (select 1 from public.revisions r where r.id = cur and r.chart_text = new.chart_text) then
    raise exception 'Nothing changed yet. Edit the chart first.';
  end if;
  -- Serialise this author's inserts so two at once can't slip past the limit.
  perform pg_advisory_xact_lock(hashtext('proposals:' || new.author_id::text));
  select count(*) into open_count from public.proposals where author_id = new.author_id and status = 'open';
  if open_count >= public.app_setting('max_open_proposals') then
    raise exception 'You already have % open suggestions. Wait for votes or withdraw one.', open_count;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger proposals_check
  before insert on public.proposals
  for each row execute function public.check_new_proposal();

-- Author updates their open suggestion (e.g. after it went out of date). Votes reset,
-- because people approved different text.
create or replace function public.update_proposal(p_id uuid, p_chart text, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.proposals%rowtype;
  cur uuid;
begin
  select * into p from public.proposals where id = p_id for update;
  if not found or p.author_id is distinct from auth.uid() then
    raise exception 'Only the author can update this suggestion' using errcode = '42501';
  end if;
  if p.status <> 'open' then
    raise exception 'This suggestion is already closed';
  end if;
  if public.is_blocked(auth.uid()) then
    raise exception 'Your account can''t suggest changes right now' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Add a short note saying what you changed';
  end if;
  if p_chart is null or char_length(p_chart) > 20000 then
    raise exception 'Chart is empty or too long';
  end if;
  if public.chart_has_long_cue(p_chart) then
    raise exception 'A cue is longer than 6 words. Cues only, never lyrics.';
  end if;
  select current_revision_id into cur from public.songs where id = p.song_id for update;
  update public.proposals
    set chart_text = p_chart, note = btrim(p_note), base_revision_id = cur, updated_at = now()
    where id = p_id;
  delete from public.votes where proposal_id = p_id;
  update public.notifications set read_at = now()
    where proposal_id = p_id and kind = 'out_of_date' and read_at is null;
end;
$$;
revoke execute on function public.update_proposal from public, anon;
grant execute on function public.update_proposal to authenticated;

create or replace function public.withdraw_proposal(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.proposals
    set status = 'withdrawn', decided_at = now(), decided_by = auth.uid()
    where id = p_id and author_id = auth.uid() and status = 'open';
  if not found then
    raise exception 'Only the author can withdraw an open suggestion' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.withdraw_proposal from public, anon;
grant execute on function public.withdraw_proposal to authenticated;

-- Merge or close. Refuses to merge when the song has moved on (never overwrite a newer
-- revision). Locks the proposal and the song so two merges can't race.
create or replace function public.decide_proposal(p_id uuid, p_approve boolean, p_by uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.proposals%rowtype;
  cur uuid;
  rev_id uuid;
begin
  select * into p from public.proposals where id = p_id for update;
  if not found or p.status <> 'open' then return; end if;
  select current_revision_id into cur from public.songs where id = p.song_id for update;

  if p_approve and p.base_revision_id is distinct from cur then
    raise exception 'This suggestion is out of date: the chart changed after it was made. The author needs to update it first.'
      using hint = 'stale';
  end if;

  -- Close it first, so the out-of-date notifier skips this one.
  update public.proposals set
    status = case when p_approve then 'approved'::public.proposal_status else 'rejected' end,
    decided_at = now(),
    decided_by = p_by
  where id = p_id;

  if p_approve then
    rev_id := public.publish_chart(p.song_id, p.chart_text, p.author_id, 'community', p.note);
    update public.proposals set resulting_revision_id = rev_id where id = p_id;
  end if;

  if p_by is distinct from p.author_id then
    insert into public.notifications (user_id, kind, proposal_id, song_id)
    values (p.author_id, case when p_approve then 'merged' else 'closed' end, p.id, p.song_id);
  end if;
end;
$$;
revoke execute on function public.decide_proposal from public, anon, authenticated;

-- Admin buttons: "Approve now" / "Close". Admins can't approve their own suggestion.
create or replace function public.admin_decide(p_id uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can do that' using errcode = '42501';
  end if;
  if p_approve and exists (select 1 from public.proposals where id = p_id and author_id = auth.uid()) then
    raise exception 'You can''t approve your own suggestion' using errcode = '42501';
  end if;
  if not exists (select 1 from public.proposals where id = p_id and status = 'open') then
    raise exception 'This suggestion is already closed';
  end if;
  perform public.decide_proposal(p_id, p_approve, auth.uid());
end;
$$;
revoke execute on function public.admin_decide from public, anon;
grant execute on function public.admin_decide to authenticated;

-- Tell authors when the chart moves on under their open suggestion.
create or replace function public.notify_out_of_date()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.current_revision_id is distinct from old.current_revision_id then
    insert into public.notifications (user_id, kind, proposal_id, song_id)
    select p.author_id, 'out_of_date', p.id, p.song_id
    from public.proposals p
    where p.song_id = new.id and p.status = 'open'
      and p.base_revision_id is distinct from new.current_revision_id
      and not exists (
        select 1 from public.notifications n
        where n.proposal_id = p.id and n.kind = 'out_of_date' and n.read_at is null
      );
  end if;
  return new;
end;
$$;

create trigger songs_notify_out_of_date
  after update of current_revision_id on public.songs
  for each row execute function public.notify_out_of_date();

-- ── votes ───────────────────────────────────────────────────────────────────
-- One vote per user per suggestion is the primary key (proposal_id, voter_id).
alter table public.votes add column comment text check (char_length(comment) <= 300);

create or replace function public.check_new_vote()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p public.proposals%rowtype;
  cur uuid;
  recent int;
begin
  select * into p from public.proposals where id = new.proposal_id;
  if not found then
    raise exception 'Suggestion not found';
  end if;
  if p.status <> 'open' then
    raise exception 'Voting has closed on this suggestion';
  end if;
  if p.author_id = new.voter_id then
    raise exception 'You can''t vote on your own suggestion' using errcode = '42501';
  end if;
  if public.is_blocked(new.voter_id) then
    raise exception 'Your account can''t vote right now' using errcode = '42501';
  end if;
  select current_revision_id into cur from public.songs where id = p.song_id;
  if p.base_revision_id is distinct from cur then
    raise exception 'This suggestion is out of date. Voting reopens when the author updates it.'
      using hint = 'stale';
  end if;
  perform pg_advisory_xact_lock(hashtext('votes:' || new.voter_id::text));
  select count(*) into recent from public.votes
    where voter_id = new.voter_id and created_at > now() - interval '1 hour';
  if recent >= public.app_setting('votes_per_hour') then
    raise exception 'That''s the vote limit for now (% an hour). Try again later.', public.app_setting('votes_per_hour');
  end if;
  new.comment := nullif(btrim(coalesce(new.comment, '')), '');
  new.created_at := now();
  return new;
end;
$$;

create trigger votes_check
  before insert on public.votes
  for each row execute function public.check_new_vote();

-- Votes from non-authors count; thresholds come from settings. Admin votes count as one
-- vote (admins use admin_decide to decide at once).
create or replace function public.tally_vote()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  approvals int;
  rejections int;
  author uuid;
begin
  select author_id into author from public.proposals where id = new.proposal_id;
  select
    count(*) filter (where value = 'approve'),
    count(*) filter (where value = 'reject')
  into approvals, rejections
  from public.votes
  where proposal_id = new.proposal_id and voter_id <> author;

  if approvals >= public.app_setting('approvals_needed') then
    perform public.decide_proposal(new.proposal_id, true, null);
  elsif rejections >= public.app_setting('rejections_needed') then
    perform public.decide_proposal(new.proposal_id, false, null);
  end if;
  return new;
end;
$$;

drop policy "signed-in vote" on public.votes;
create policy "signed-in vote" on public.votes
  for insert to authenticated with check (
    voter_id = auth.uid()
    and exists (
      select 1 from public.proposals p
      where p.id = proposal_id and p.status = 'open' and p.author_id <> auth.uid()
    )
  );

-- Anyone can read suggestions and votes on published songs (signing in is only for voting).
grant select on public.proposals, public.votes to anon;
create policy "public read proposals" on public.proposals
  for select to anon using (
    exists (select 1 from public.songs s where s.id = song_id and s.status = 'published')
  );
create policy "public read votes" on public.votes
  for select to anon using (
    exists (
      select 1 from public.proposals p join public.songs s on s.id = p.song_id
      where p.id = proposal_id and s.status = 'published'
    )
  );

-- ── revisions: full history of every published song is public ──────────────
create policy "read history of published songs" on public.revisions
  for select using (
    exists (select 1 from public.songs s where s.id = song_id and s.status = 'published')
  );

-- Revert: a new revision with the old text, so history is kept.
create or replace function public.revert_song(p_song_id uuid, p_revision_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  src public.revisions%rowtype;
  cur uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can revert' using errcode = '42501';
  end if;
  select * into src from public.revisions where id = p_revision_id and song_id = p_song_id;
  if not found then
    raise exception 'Revision not found for this song';
  end if;
  select current_revision_id into cur from public.songs where id = p_song_id for update;
  if cur = p_revision_id then
    raise exception 'That is already the live version';
  end if;
  return public.publish_chart(
    p_song_id, src.chart_text, auth.uid(), 'human',
    'Reverted to the version from ' || to_char(src.created_at at time zone 'America/Chicago', 'Mon FMDD, YYYY HH12:MI am')
  );
end;
$$;
revoke execute on function public.revert_song from public, anon;
grant execute on function public.revert_song to authenticated;

-- ── reports ─────────────────────────────────────────────────────────────────
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  voter_id uuid references public.profiles (id) on delete cascade, -- set when reporting a vote comment
  reason text not null check (reason in ('spam', 'lyrics', 'wrong', 'abusive', 'other')),
  details text check (char_length(details) <= 300),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);
create unique index reports_once on public.reports
  (reporter_id, proposal_id, coalesce(voter_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index reports_open on public.reports (created_at desc) where status = 'open';

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant select, insert on public.reports to authenticated;
grant update (status, resolved_at, resolved_by) on public.reports to authenticated;
create policy "report as yourself" on public.reports
  for insert to authenticated with check (
    reporter_id = auth.uid() and status = 'open' and resolved_at is null and resolved_by is null
    and not public.is_blocked(auth.uid())
  );
create policy "admins and reporters read reports" on public.reports
  for select to authenticated using (public.is_admin() or reporter_id = auth.uid());
create policy "admins resolve reports" on public.reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── personal chart versions (private to their owner) ─────────────────────────
create table public.personal_chart_versions (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  based_on_revision_id uuid references public.revisions (id) on delete set null,
  chart_text text not null check (char_length(chart_text) between 1 and 20000),
  note text check (char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

create or replace function public.check_personal_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.chart_has_long_cue(new.chart_text) then
    raise exception 'A cue is longer than 6 words. Cues only, never lyrics.';
  end if;
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.updated_at := now();
  return new;
end;
$$;

create trigger personal_versions_check
  before insert or update on public.personal_chart_versions
  for each row execute function public.check_personal_version();

alter table public.personal_chart_versions enable row level security;
revoke all on public.personal_chart_versions from anon, authenticated;
grant select, insert, update, delete on public.personal_chart_versions to authenticated;
create policy "owner reads own versions" on public.personal_chart_versions
  for select to authenticated using (user_id = auth.uid());
create policy "owner adds own versions" on public.personal_chart_versions
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.songs s where s.id = song_id and s.status = 'published')
  );
create policy "owner edits own versions" on public.personal_chart_versions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner deletes own versions" on public.personal_chart_versions
  for delete to authenticated using (user_id = auth.uid());

-- ── admin dashboard: add open reports ───────────────────────────────────────
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
    'people',         (select count(*) from public.profiles)
  );
end;
$$;
revoke execute on function public.admin_dashboard from public, anon;
grant execute on function public.admin_dashboard to authenticated;
