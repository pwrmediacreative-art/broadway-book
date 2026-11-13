-- Setlists for gigs: optional date, private by default, view-only share by secret code.
-- Owners read/write their own setlists. A shared setlist is readable ONLY through its code
-- (setlist_bundle), never listable. Each setlist + every chart in it loads in one call.

-- ── columns and limits ─────────────────────────────────────────────────────
alter table public.setlists
  add column gig_date date,
  add column share_code text unique check (share_code is null or share_code ~ '^[A-Za-z0-9_-]{16,}$');

alter table public.setlist_items
  add constraint setlist_items_note_short check (note is null or char_length(note) <= 60),
  add constraint setlist_items_key_short check (key_override is null or char_length(key_override) <= 4);

create index if not exists setlists_owner_idx on public.setlists (owner_id, updated_at desc);
create index if not exists setlist_items_setlist_idx on public.setlist_items (setlist_id, position);

-- At most 100 songs per setlist.
create or replace function public.setlist_items_cap() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.setlist_items where setlist_id = new.setlist_id) >= 100 then
    raise exception 'A setlist holds at most 100 songs' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger setlist_items_cap before insert on public.setlist_items
  for each row execute function public.setlist_items_cap();

-- ── access ─────────────────────────────────────────────────────────────────
-- Old rule let anyone list every is_public setlist. Replace with owner-only; sharing is by code.
drop policy if exists "read own or public setlists" on public.setlists;
drop policy if exists "read items of visible setlists" on public.setlist_items;
alter table public.setlists drop column is_public;

create policy "read own setlists" on public.setlists
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "read items of own setlists" on public.setlist_items
  for select to authenticated
  using (exists (select 1 from public.setlists l where l.id = setlist_id and l.owner_id = (select auth.uid())));

revoke select on public.setlists, public.setlist_items from anon;
-- Owners may rename/re-date; owner_id and share_code change only through the functions below.
revoke update on public.setlists from authenticated;
grant update (name, gig_date, updated_at) on public.setlists to authenticated;

-- ── one-call reads ─────────────────────────────────────────────────────────
-- Song fields a setlist needs; null when the song isn't published (shown as "Not available").
create or replace function public._setlist_song(p_song uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('slug', s.slug, 'title', s.title, 'artist', s.artist, 'key', s.key, 'chart_text', r.chart_text)
  from public.songs s
  join public.revisions r on r.id = s.current_revision_id
  where s.id = p_song and s.status = 'published'
$$;
revoke all on function public._setlist_song(uuid) from public, anon, authenticated;

-- A whole setlist with every chart in it. By id: owner only. By code: anyone with the code.
create or replace function public.setlist_bundle(p_id uuid default null, p_code text default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', case when l.owner_id = (select auth.uid()) then l.id end,
    'name', l.name,
    'gig_date', l.gig_date,
    'updated_at', l.updated_at,
    'share_code', case when l.owner_id = (select auth.uid()) then l.share_code end,
    'mine', l.owner_id is not distinct from (select auth.uid()),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'song_id', i.song_id, 'key_override', i.key_override, 'note', i.note,
        'song', public._setlist_song(i.song_id)) order by i.position)
      from public.setlist_items i where i.setlist_id = l.id), '[]'::jsonb))
  from public.setlists l
  where (p_id is not null and l.id = p_id and l.owner_id = (select auth.uid()))
     or (p_code is not null and p_id is null and l.share_code is not null and l.share_code = p_code)
$$;

-- Published songs (with charts) by slug. For device setlists and snapshot links.
create or replace function public.songs_bundle(p_slugs text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.j), '[]'::jsonb)
  from (select distinct u.slug from unnest(p_slugs[1:100]) as u(slug)) q
  join public.songs s on s.slug = q.slug and s.status = 'published'
  cross join lateral (select public._setlist_song(s.id) as j) x
  where x.j is not null
$$;

-- ── writes (owner only; RLS still applies: security invoker) ────────────────
-- Replace a setlist's name, date and full ordered song list in one go.
-- p_items: [{song_id?, slug?, key?, note?}] — slug is resolved to a published song.
create or replace function public.setlist_save(p_id uuid, p_name text, p_date date, p_items jsonb) returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare t timestamptz;
begin
  if jsonb_array_length(p_items) > 100 then
    raise exception 'A setlist holds at most 100 songs' using errcode = 'check_violation';
  end if;
  update public.setlists set name = btrim(p_name), gig_date = p_date, updated_at = now()
    where id = p_id and owner_id = (select auth.uid()) returning updated_at into t;
  if t is null then raise exception 'Setlist not found' using errcode = 'no_data_found'; end if;
  delete from public.setlist_items where setlist_id = p_id;
  -- A slug that isn't a published song (e.g. from an old device list) is skipped.
  insert into public.setlist_items (setlist_id, song_id, position, key_override, note)
  select p_id, y.sid, y.o, y.k, y.n from (
    select coalesce((x.e->>'song_id')::uuid, (select s.id from public.songs s where s.slug = x.e->>'slug' and s.status = 'published')) as sid,
           x.o::int as o, nullif(btrim(x.e->>'key'), '') as k, nullif(btrim(x.e->>'note'), '') as n
    from jsonb_array_elements(p_items) with ordinality as x(e, o)) y
  where y.sid is not null;
  return t;
end $$;

-- Append one published song (by slug) to the end of a setlist.
create or replace function public.setlist_add(p_id uuid, p_slug text) returns int
language plpgsql security invoker set search_path = '' as $$
declare sid uuid; pos int;
begin
  select id into sid from public.songs where slug = p_slug and status = 'published';
  if sid is null then raise exception 'Song not found' using errcode = 'no_data_found'; end if;
  update public.setlists set updated_at = now() where id = p_id and owner_id = (select auth.uid());
  if not found then raise exception 'Setlist not found' using errcode = 'no_data_found'; end if;
  select coalesce(max(position), 0) + 1 into pos from public.setlist_items where setlist_id = p_id;
  insert into public.setlist_items (setlist_id, song_id, position) values (p_id, sid, pos);
  return pos;
end $$;

-- Turn sharing on (new random code) or off (code removed: the old link stops working).
create or replace function public.setlist_share(p_id uuid, p_on boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if p_on then
    c := translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/=', '-_');
  end if;
  update public.setlists set share_code = c, updated_at = now()
    where id = p_id and owner_id = (select auth.uid());
  if not found then raise exception 'Setlist not found' using errcode = 'no_data_found'; end if;
  return c;
end $$;

-- ── who may call what ──────────────────────────────────────────────────────
revoke all on function public.setlist_bundle(uuid, text) from public;
revoke all on function public.songs_bundle(text[]) from public;
revoke all on function public.setlist_save(uuid, text, date, jsonb) from public, anon;
revoke all on function public.setlist_add(uuid, text) from public, anon;
revoke all on function public.setlist_share(uuid, boolean) from public, anon;
revoke all on function public.setlist_items_cap() from public, anon, authenticated;
grant execute on function public.setlist_bundle(uuid, text) to anon, authenticated;
grant execute on function public.songs_bundle(text[]) to anon, authenticated;
grant execute on function public.setlist_save(uuid, text, date, jsonb) to authenticated;
grant execute on function public.setlist_add(uuid, text) to authenticated;
grant execute on function public.setlist_share(uuid, boolean) to authenticated;
