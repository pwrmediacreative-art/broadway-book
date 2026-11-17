-- Rename songs (title and artist).
--
-- * Admins rename any song at once (rename_song). The owner of an uploaded (private) chart
--   renames it at once too.
-- * Signed-in players suggest a new name for a published song (propose_rename). It goes
--   live after `approvals_needed` approvals from other players and closes after
--   `rejections_needed` rejections (same settings as chart suggestions). Admins decide at
--   once (admin_decide_rename).
-- * A rename gets a new slug; the old one is kept in song_slug_redirects so old links
--   (song pages, device setlists, snapshot links) keep working.
-- * Every rename is logged in song_renames (old name, new name, who, when, how).
-- * Once a song has been renamed, publishing a chart no longer copies {title:}/{artist:}
--   from the chart text onto the song (publish_chart), so the new name sticks.
-- * Only the name in the app changes: Dropbox files and uploaded audio are never touched.
--   The import list's name for the song's file is updated and marked fixed by hand, so a
--   Dropbox re-scan doesn't bring the old name back.

-- Old slug -> song. A slug that is in use by a song is never also a redirect.
create table public.song_slug_redirects (
  old_slug text primary key,
  song_id uuid not null references public.songs (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index song_slug_redirects_song on public.song_slug_redirects (song_id);
alter table public.song_slug_redirects enable row level security;
revoke all on public.song_slug_redirects from anon, authenticated;
grant select on public.song_slug_redirects to anon, authenticated;
create policy "redirects follow song visibility" on public.song_slug_redirects for select
  using (exists (select 1 from public.songs s where s.id = song_id));

create table public.song_renames (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  old_title text not null,
  old_artist text,
  new_title text not null,
  new_artist text,
  old_slug text not null,
  new_slug text not null,
  by_id uuid references public.profiles (id) on delete set null,
  via text not null check (via in ('admin', 'owner', 'community')),
  proposal_id uuid,
  created_at timestamptz not null default now()
);
create index song_renames_song on public.song_renames (song_id, created_at desc);
alter table public.song_renames enable row level security;
revoke all on public.song_renames from anon, authenticated;
grant select on public.song_renames to anon, authenticated;
-- Same visibility as the song itself (songs RLS decides: published to all, private to owner/admins).
create policy "renames follow song visibility" on public.song_renames for select
  using (exists (select 1 from public.songs s where s.id = song_id));

create table public.rename_proposals (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  base_title text not null,
  base_artist text,
  new_title text not null,
  new_artist text,
  note text,
  status text not null default 'open' check (status in ('open', 'approved', 'rejected', 'withdrawn')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index rename_proposals_open on public.rename_proposals (created_at desc) where status = 'open';
create index rename_proposals_song on public.rename_proposals (song_id);
alter table public.rename_proposals enable row level security;
revoke all on public.rename_proposals from anon, authenticated;
grant select on public.rename_proposals to anon, authenticated;
create policy "rename suggestions follow song visibility" on public.rename_proposals for select
  using (exists (select 1 from public.songs s where s.id = song_id));

create table public.rename_votes (
  proposal_id uuid not null references public.rename_proposals (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  value text not null check (value in ('approve', 'reject')),
  created_at timestamptz not null default now(),
  primary key (proposal_id, voter_id)
);
create index rename_votes_voter on public.rename_votes (voter_id, created_at);
alter table public.rename_votes enable row level security;
revoke all on public.rename_votes from anon, authenticated;
grant select on public.rename_votes to anon, authenticated;
create policy "rename votes are public" on public.rename_votes for select using (true);

-- Clean a name part: trimmed, inner whitespace collapsed, empty -> null.
create or replace function public._clean_name(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), '')
$$;

-- The one place a rename happens. Internal: callers check who may do it. Returns the new slug.
create or replace function public._apply_rename(
  p_song uuid, p_title text, p_artist text, p_by uuid, p_via text, p_proposal uuid
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.songs;
  t text := public._clean_name(p_title);
  a text := public._clean_name(p_artist);
  base text;
  v_slug text;
  n int := 1;
begin
  select * into s from public.songs where id = p_song for update;
  if not found then raise exception 'Song not found' using errcode = 'no_data_found'; end if;
  if t is null then raise exception 'The title can''t be empty'; end if;
  if length(t) > 200 or length(coalesce(a, '')) > 200 then
    raise exception 'Keep the title and artist under 200 characters';
  end if;
  if t = s.title and a is not distinct from s.artist then
    raise exception 'That''s already the song''s name';
  end if;

  if s.status = 'private' then
    v_slug := s.slug; -- uploaded charts are opened by id; their slug stays
  else
    base := trim(both '-' from left(public.slugify(t || ' ' || coalesce(a, '')), 80));
    if base = '' then base := 'song'; end if;
    v_slug := base;
    while exists (select 1 from public.songs where slug = v_slug and id <> s.id) loop
      n := n + 1;
      v_slug := base || '-' || n;
    end loop;
  end if;

  if v_slug <> s.slug then
    -- The new slug is live again, so it can't also redirect; the old one now does.
    delete from public.song_slug_redirects where old_slug = v_slug;
    insert into public.song_slug_redirects (old_slug, song_id) values (s.slug, s.id)
      on conflict (old_slug) do update set song_id = excluded.song_id, created_at = now();
  end if;

  update public.songs set title = t, artist = a, slug = v_slug where id = s.id;
  update public.import_files set title = t, artist = a, name_fixed = true where song_id = s.id;

  insert into public.song_renames (song_id, old_title, old_artist, new_title, new_artist, old_slug, new_slug, by_id, via, proposal_id)
  values (s.id, s.title, s.artist, t, a, s.slug, v_slug, p_by, p_via, p_proposal);

  -- Any other open suggestion for this song was made against the old name.
  update public.rename_proposals set status = 'rejected', decided_at = now()
    where song_id = s.id and status = 'open' and id is distinct from p_proposal;

  return v_slug;
end $$;
revoke all on function public._apply_rename(uuid, text, text, uuid, text, uuid) from public, anon, authenticated;

-- Admins: any song. Owners: their own uploaded (private) chart.
create or replace function public.rename_song(p_song uuid, p_title text, p_artist text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s public.songs;
begin
  if me is null then raise exception 'Sign in to rename songs' using errcode = '42501'; end if;
  select * into s from public.songs where id = p_song;
  if not found then raise exception 'Song not found' using errcode = 'no_data_found'; end if;
  if public.is_admin() then
    return public._apply_rename(p_song, p_title, p_artist, me, 'admin', null);
  elsif s.status = 'private' and s.owner_id = me then
    return public._apply_rename(p_song, p_title, p_artist, me, 'owner', null);
  end if;
  raise exception 'Only admins can rename this song. Suggest a new name instead.' using errcode = '42501';
end $$;
revoke all on function public.rename_song(uuid, text, text) from public, anon;
grant execute on function public.rename_song(uuid, text, text) to authenticated;

create or replace function public.propose_rename(p_song uuid, p_title text, p_artist text, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s public.songs;
  t text := public._clean_name(p_title);
  a text := public._clean_name(p_artist);
  open_count int;
  pid uuid;
begin
  if me is null then raise exception 'Sign in to suggest a new name' using errcode = '42501'; end if;
  if public.is_blocked(me) then raise exception 'Your account can''t suggest changes right now' using errcode = '42501'; end if;
  select * into s from public.songs where id = p_song;
  if not found or s.status <> 'published' then raise exception 'Song not found' using errcode = 'no_data_found'; end if;
  if t is null then raise exception 'The title can''t be empty'; end if;
  if length(t) > 200 or length(coalesce(a, '')) > 200 then
    raise exception 'Keep the title and artist under 200 characters';
  end if;
  if t = s.title and a is not distinct from s.artist then
    raise exception 'That''s already the song''s name';
  end if;
  if exists (select 1 from public.rename_proposals where song_id = s.id and author_id = me and status = 'open') then
    raise exception 'You already have a name suggestion open for this song';
  end if;
  perform pg_advisory_xact_lock(hashtext('rename-proposals:' || me::text));
  select count(*) into open_count from public.rename_proposals where author_id = me and status = 'open';
  if open_count >= public.app_setting('max_open_proposals') then
    raise exception 'You have % open name suggestions. Wait for one to close first.', open_count;
  end if;
  insert into public.rename_proposals (song_id, author_id, base_title, base_artist, new_title, new_artist, note)
  values (s.id, me, s.title, s.artist, t, a, left(public._clean_name(p_note), 500))
  returning id into pid;
  return pid;
end $$;
revoke all on function public.propose_rename(uuid, text, text, text) from public, anon;
grant execute on function public.propose_rename(uuid, text, text, text) to authenticated;

-- Close or publish one suggestion. Internal. Returns the new slug when approved.
create or replace function public._decide_rename(p_id uuid, p_approve boolean, p_by uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  p public.rename_proposals;
  v_slug text;
begin
  select * into p from public.rename_proposals where id = p_id for update;
  if not found or p.status <> 'open' then raise exception 'This suggestion is already closed'; end if;
  if p_approve then
    v_slug := public._apply_rename(p.song_id, p.new_title, p.new_artist, p.author_id, 'community', p.id);
  end if;
  update public.rename_proposals
    set status = case when p_approve then 'approved' else 'rejected' end, decided_by = p_by, decided_at = now()
    where id = p.id;
  return v_slug;
end $$;
revoke all on function public._decide_rename(uuid, boolean, uuid) from public, anon, authenticated;

-- One vote per player (changeable while open). Returns the suggestion's status afterwards.
create or replace function public.vote_rename(p_id uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  p public.rename_proposals;
  s public.songs;
  recent int;
  approvals int;
  rejections int;
begin
  if me is null then raise exception 'Sign in to vote' using errcode = '42501'; end if;
  select * into p from public.rename_proposals where id = p_id for update;
  if not found then raise exception 'Suggestion not found' using errcode = 'no_data_found'; end if;
  if p.status <> 'open' then raise exception 'Voting has closed on this suggestion'; end if;
  if p.author_id = me then raise exception 'You can''t vote on your own suggestion' using errcode = '42501'; end if;
  if public.is_blocked(me) then raise exception 'Your account can''t vote right now' using errcode = '42501'; end if;
  select * into s from public.songs where id = p.song_id;
  if s.title <> p.base_title or s.artist is distinct from p.base_artist then
    raise exception 'The song was renamed since this suggestion was made';
  end if;
  perform pg_advisory_xact_lock(hashtext('votes:' || me::text));
  select (select count(*) from public.votes where voter_id = me and created_at > now() - interval '1 hour')
       + (select count(*) from public.rename_votes where voter_id = me and created_at > now() - interval '1 hour')
    into recent;
  if recent >= public.app_setting('votes_per_hour') then
    raise exception 'That''s the vote limit for now (% an hour). Try again later.', public.app_setting('votes_per_hour');
  end if;

  insert into public.rename_votes (proposal_id, voter_id, value)
  values (p.id, me, case when p_approve then 'approve' else 'reject' end)
  on conflict (proposal_id, voter_id) do update set value = excluded.value, created_at = now();

  select count(*) filter (where value = 'approve'), count(*) filter (where value = 'reject')
    into approvals, rejections
    from public.rename_votes where proposal_id = p.id and voter_id <> p.author_id;
  if approvals >= public.app_setting('approvals_needed') then
    perform public._decide_rename(p.id, true, null);
    return 'approved';
  elsif rejections >= public.app_setting('rejections_needed') then
    perform public._decide_rename(p.id, false, null);
    return 'rejected';
  end if;
  return 'open';
end $$;
revoke all on function public.vote_rename(uuid, boolean) from public, anon;
grant execute on function public.vote_rename(uuid, boolean) to authenticated;

create or replace function public.admin_decide_rename(p_id uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return public._decide_rename(p_id, p_approve, auth.uid());
end $$;
revoke all on function public.admin_decide_rename(uuid, boolean) from public, anon;
grant execute on function public.admin_decide_rename(uuid, boolean) to authenticated;

create or replace function public.withdraw_rename(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.rename_proposals set status = 'withdrawn', decided_at = now()
    where id = p_id and author_id = auth.uid() and status = 'open';
  if not found then raise exception 'Suggestion not found' using errcode = 'no_data_found'; end if;
end $$;
revoke all on function public.withdraw_rename(uuid) from public, anon;
grant execute on function public.withdraw_rename(uuid) to authenticated;

-- Old slug -> current slug of a published song (null when unknown).
create or replace function public.resolve_slug(p_slug text) returns text
language sql stable security definer set search_path = '' as $$
  select s.slug from public.song_slug_redirects r
  join public.songs s on s.id = r.song_id and s.status = 'published'
  where r.old_slug = p_slug
$$;
revoke all on function public.resolve_slug(text) from public;
grant execute on function public.resolve_slug(text) to anon, authenticated;

-- Device setlists and snapshot links hold slugs: follow renames. A song found through an
-- old slug carries `asked` (the slug the caller used) so the client can match it up.
create or replace function public.songs_bundle(p_slugs text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(case when q.slug <> s.slug then x.j || jsonb_build_object('asked', q.slug) else x.j end), '[]'::jsonb)
  from (select distinct u.slug from unnest(p_slugs[1:100]) as u(slug)) q
  left join public.song_slug_redirects r on r.old_slug = q.slug
  join public.songs s on (s.slug = q.slug or s.id = r.song_id)
   and (s.status = 'published'
        or (s.status = 'private' and (s.owner_id = (select auth.uid()) or public._admin_sees_upload(s.owner_id))))
  cross join lateral (select public._setlist_song(s.id) as j) x
  where x.j is not null
$$;

-- After a rename the song's name wins over the chart's {title:}/{artist:} lines.
create or replace function public.publish_chart(
  p_song_id uuid, p_chart text, p_author uuid, p_source public.revision_source, p_note text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  rev_id uuid;
  bpm_text text := public.chart_tag(p_chart, 'bpm');
  header text := public.chart_header(p_chart);
  renamed boolean := exists (select 1 from public.song_renames where song_id = p_song_id);
begin
  insert into public.revisions (song_id, chart_text, author_id, source, note)
  values (p_song_id, p_chart, p_author, p_source, p_note)
  returning id into rev_id;

  update public.songs set
    current_revision_id = rev_id,
    title = case when renamed then title else coalesce(public.chart_tag(p_chart, 'title'), title) end,
    artist = case when renamed then artist else coalesce(public.chart_tag(p_chart, 'artist'), artist) end,
    key = coalesce(public.chart_tag(p_chart, 'key'), key),
    bpm = case when bpm_text ~ '^\d{2,3}$' then bpm_text::int else bpm end,
    time_sig = coalesce(public.chart_tag(p_chart, 'time'), time_sig),
    feel = coalesce(lower(left(public.chart_tag(header, 'feel'), 60)), feel),
    tags = coalesce(public.chart_tags(p_chart), tags),
    updated_at = now()
  where id = p_song_id;

  return rev_id;
end;
$$;
revoke execute on function public.publish_chart from public, anon, authenticated;
