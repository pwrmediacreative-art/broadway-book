-- Per-song lyrics under the bar rows (Q18). NO LYRIC TEXT IS EVER STORED HERE: lyrics still come
-- live from LRCLIB (lib/lyrics, /api/lyrics) and are cached only on the viewer's device.
--
-- * lyrics_song_prefs: one row per player per song (owner-only), written only through
--   lyrics_save_mine() and only while the /admin lyrics audience includes the player:
--     shown       the song's Lyrics button is on
--     placements  "Adjust lyrics": where the player moved lines. A flat integer array, 4 numbers
--                 per moved line: [line, section_hash, section_nth, bar_row]
--                   line         0..499  the line's number in the lyrics as the provider sends them
--                   section_hash          32-bit hash of the section label ("C", "V2"), so the
--                                         reference survives sections added or removed elsewhere
--                   section_nth  0..49   which section with that label (the 2nd "C" = 1)
--                   bar_row      0..199  bar row inside that section (rows that have bars)
--                 Integers only: the column can't hold words.
--     lrclib_id   the lyrics record the placements were made against (another record = start over)
--     changed_at  when the player last changed it (device clock, newest of device/account wins)
-- * lyrics_mine(slug): the signed-in player's row for one published song (+ its id).
-- * user_prefs.lyrics_panel: the desktop "Side panel" switch, per player.

create or replace function public._lyrics_placements_ok(p integer[]) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null
     and coalesce(array_ndims(p), 1) = 1
     and coalesce(array_lower(p, 1), 1) = 1
     and coalesce(cardinality(p), 0) <= 2000
     and coalesce(cardinality(p), 0) % 4 = 0
     and not exists (
       select 1 from generate_series(1, coalesce(cardinality(p), 0), 4) as g(i)
       where p[g.i] is null or p[g.i] not between 0 and 499
          or p[g.i + 1] is null
          or p[g.i + 2] is null or p[g.i + 2] not between 0 and 49
          or p[g.i + 3] is null or p[g.i + 3] not between 0 and 199
     )
$$;
-- (Pure check, also used by the table's CHECK constraint, so it stays callable.)

create table public.lyrics_song_prefs (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  shown boolean not null default false,
  placements integer[] not null default '{}' check (public._lyrics_placements_ok(placements)),
  lrclib_id bigint check (lrclib_id > 0),
  changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, song_id)
);
alter table public.lyrics_song_prefs enable row level security;
revoke all on public.lyrics_song_prefs from anon, authenticated;
grant select, delete on public.lyrics_song_prefs to authenticated;
-- Players may always see and delete their own numbers; the app reads them through lyrics_mine(),
-- which (like saving) follows the audience setting.
create policy "own lyrics prefs: read" on public.lyrics_song_prefs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own lyrics prefs: remove" on public.lyrics_song_prefs for delete to authenticated
  using (user_id = (select auth.uid()));

-- The signed-in player's choices for one published song; no row when the audience leaves them out.
create or replace function public.lyrics_mine(p_slug text)
returns table (song_id uuid, shown boolean, placements integer[], lrclib_id bigint, changed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, p.shown, p.placements, p.lrclib_id, p.changed_at
  from public.songs s
  left join public.lyrics_song_prefs p on p.song_id = s.id and p.user_id = (select auth.uid())
  where s.slug = p_slug and s.status = 'published'
    and (select auth.uid()) is not null and public.lyrics_allowed()
$$;
revoke all on function public.lyrics_mine(text) from public, anon;
grant execute on function public.lyrics_mine(text) to authenticated;

-- Save the player's whole record for one song (on/off + placements). Returns the time kept.
create or replace function public.lyrics_save_mine(
  p_song uuid, p_shown boolean, p_placements integer[], p_lrclib_id bigint, p_at timestamptz
) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz := least(coalesce(p_at, now()), now() + interval '5 minutes');
  v_p integer[] := coalesce(p_placements, '{}');
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not public.lyrics_allowed() then raise exception 'Lyrics are off' using errcode = '42501'; end if;
  if not exists (select 1 from public.songs where id = p_song and status = 'published') then
    raise exception 'No such song';
  end if;
  if not public._lyrics_placements_ok(v_p) then raise exception 'Placements must be line/row numbers'; end if;
  if p_lrclib_id is not null and p_lrclib_id <= 0 then raise exception 'Bad lyrics record'; end if;
  insert into public.lyrics_song_prefs (user_id, song_id, shown, placements, lrclib_id, changed_at, updated_at)
  values (auth.uid(), p_song, coalesce(p_shown, false), v_p, p_lrclib_id, v_at, now())
  on conflict (user_id, song_id) do update
    set shown = excluded.shown, placements = excluded.placements, lrclib_id = excluded.lrclib_id,
        changed_at = excluded.changed_at, updated_at = now();
  return v_at;
end $$;
revoke all on function public.lyrics_save_mine(uuid, boolean, integer[], bigint, timestamptz) from public, anon;
grant execute on function public.lyrics_save_mine(uuid, boolean, integer[], bigint, timestamptz) to authenticated;

-- Desktop "Side panel" switch (1280px+), per player. Owner-only like the rest of user_prefs.
alter table public.user_prefs add column lyrics_panel boolean;
grant update (lyrics_panel) on public.user_prefs to authenticated;
