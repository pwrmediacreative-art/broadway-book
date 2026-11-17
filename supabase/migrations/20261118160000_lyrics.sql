-- Lyrics from LRCLIB, shown live (Q7). NO LYRIC TEXT IS EVER STORED HERE: these tables hold
-- who may see lyrics, which songs are hidden, and which LRCLIB record (an id) an admin picked.
-- The text is fetched live by the server (lib/lyrics) and cached only on the viewer's device.
--
-- * settings 'lyrics_audience': 0 Off (kill switch), 1 Admins only (start), 2 Signed-in
--   players, 3 Everyone. Edited on /admin only; hidden from the /admin/community form.
-- * lyrics_allowed(): the one rule, used by the server route before it fetches anything.
-- * lyrics_hidden: per-song takedown (admins). lyrics_picks: "Wrong lyrics? Pick another".
-- * lyrics_log: who hid, showed or picked what, and when.

insert into public.settings (key, value, label) values
  ('lyrics_audience', 1, 'Lyrics: 0 off, 1 admins, 2 signed-in, 3 everyone')
on conflict (key) do nothing;

create or replace function public.lyrics_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select case coalesce((select value from public.settings where key = 'lyrics_audience'), 0)
    when 1 then public.is_admin()
    when 2 then (select auth.uid()) is not null
    when 3 then true
    else false
  end
$$;
revoke all on function public.lyrics_allowed() from public;
grant execute on function public.lyrics_allowed() to anon, authenticated;

create table public.lyrics_hidden (
  song_id uuid primary key references public.songs (id) on delete cascade,
  hidden_by uuid references public.profiles (id) on delete set null,
  hidden_at timestamptz not null default now()
);
create table public.lyrics_picks (
  song_id uuid primary key references public.songs (id) on delete cascade,
  lrclib_id bigint not null check (lrclib_id > 0),
  picked_by uuid references public.profiles (id) on delete set null,
  picked_at timestamptz not null default now()
);
create table public.lyrics_log (
  id bigint generated always as identity primary key,
  song_id uuid references public.songs (id) on delete cascade,
  action text not null check (action in ('hide', 'show', 'pick', 'unpick', 'audience')),
  detail text,
  by_id uuid references public.profiles (id) on delete set null,
  at timestamptz not null default now()
);
create index lyrics_log_song on public.lyrics_log (song_id, at desc);
alter table public.lyrics_hidden enable row level security;
alter table public.lyrics_picks enable row level security;
alter table public.lyrics_log enable row level security;
revoke all on public.lyrics_hidden, public.lyrics_picks, public.lyrics_log from anon, authenticated;
grant select on public.lyrics_hidden, public.lyrics_picks, public.lyrics_log to authenticated;
create policy "admins read lyrics_hidden" on public.lyrics_hidden for select to authenticated using (public.is_admin());
create policy "admins read lyrics_picks" on public.lyrics_picks for select to authenticated using (public.is_admin());
create policy "admins read lyrics_log" on public.lyrics_log for select to authenticated using (public.is_admin());

-- What the server needs for one song, only when the viewer may see lyrics.
create or replace function public.lyrics_song(p_slug text)
returns table (song_id uuid, title text, artist text, hidden boolean, lrclib_id bigint, admin boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.title, s.artist,
         exists (select 1 from public.lyrics_hidden h where h.song_id = s.id),
         (select p.lrclib_id from public.lyrics_picks p where p.song_id = s.id),
         public.is_admin()
  from public.songs s
  where s.slug = p_slug and s.status = 'published' and public.lyrics_allowed()
$$;
revoke all on function public.lyrics_song(text) from public;
grant execute on function public.lyrics_song(text) to anon, authenticated;

-- Admins: who may see lyrics (0..3). Logged.
create or replace function public.lyrics_set_audience(p_value int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_value not between 0 and 3 then raise exception 'Audience must be 0 to 3'; end if;
  update public.settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = 'lyrics_audience';
  insert into public.lyrics_log (song_id, action, detail, by_id) values (null, 'audience', p_value::text, auth.uid());
end $$;
revoke all on function public.lyrics_set_audience(int) from public, anon;
grant execute on function public.lyrics_set_audience(int) to authenticated;

-- Admins: hide or show one song's lyrics (takedowns). Logged.
create or replace function public.lyrics_set_hidden(p_song uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_hidden then
    insert into public.lyrics_hidden (song_id, hidden_by) values (p_song, auth.uid()) on conflict (song_id) do nothing;
  else
    delete from public.lyrics_hidden where song_id = p_song;
  end if;
  insert into public.lyrics_log (song_id, action, by_id) values (p_song, case when p_hidden then 'hide' else 'show' end, auth.uid());
end $$;
revoke all on function public.lyrics_set_hidden(uuid, boolean) from public, anon;
grant execute on function public.lyrics_set_hidden(uuid, boolean) to authenticated;

-- Admins: pin the LRCLIB record for a song (null = back to automatic). Logged.
create or replace function public.lyrics_set_pick(p_song uuid, p_lrclib_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_lrclib_id is null then
    delete from public.lyrics_picks where song_id = p_song;
  else
    insert into public.lyrics_picks (song_id, lrclib_id, picked_by) values (p_song, p_lrclib_id, auth.uid())
    on conflict (song_id) do update set lrclib_id = excluded.lrclib_id, picked_by = excluded.picked_by, picked_at = now();
  end if;
  insert into public.lyrics_log (song_id, action, detail, by_id)
  values (p_song, case when p_lrclib_id is null then 'unpick' else 'pick' end, p_lrclib_id::text, auth.uid());
end $$;
revoke all on function public.lyrics_set_pick(uuid, bigint) from public, anon;
grant execute on function public.lyrics_set_pick(uuid, bigint) to authenticated;
