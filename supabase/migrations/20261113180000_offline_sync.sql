-- Offline step: every published chart is saved on the phone, then refreshed with
-- "only what changed since my last sync". Two things make that possible.

-- 1. songs.updated_at moves whenever something a player can see changes (until now it
--    only moved when a statement set it by hand). Bookkeeping columns don't touch it.
create or replace function public.songs_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.slug, new.title, new.artist, new.key, new.bpm, new.time_sig, new.feel, new.tags,
      new.status, new.is_example, new.unverified, new.current_revision_id)
     is distinct from
     (old.slug, old.title, old.artist, old.key, old.bpm, old.time_sig, old.feel, old.tags,
      old.status, old.is_example, old.unverified, old.current_revision_id) then
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke all on function public.songs_touch() from public, anon, authenticated;

drop trigger if exists songs_touch on public.songs;
create trigger songs_touch before update on public.songs
  for each row execute function public.songs_touch();

-- 2. One read for the phone: published charts changed since p_since (all of them when null),
--    in pages by slug. The first page (p_after = '') also lists every published slug, so the
--    phone can drop charts that are no longer published. Security invoker: RLS still applies,
--    and the query asks for published songs only.
create or replace function public.offline_sync(p_since timestamptz default null, p_after text default '', p_limit int default 400)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with pub as (
    select s.id, s.slug, s.title, s.artist, s.key, s.is_example, s.unverified, s.updated_at, r.chart_text
    from public.songs s
    join public.revisions r on r.id = s.current_revision_id
    where s.status = 'published'
  )
  select jsonb_build_object(
    'now', now(),
    'total', (select count(*) from pub),
    'slugs', case when coalesce(p_after, '') = ''
      then (select coalesce(jsonb_agg(p.slug order by p.slug collate "C"), '[]'::jsonb) from pub p) end,
    'songs', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.slug collate "C"), '[]'::jsonb)
      from (
        select * from pub p
        where p.slug collate "C" > coalesce(p_after, '') collate "C"
          and (p_since is null or p.updated_at > p_since)
        order by p.slug collate "C"
        limit least(greatest(coalesce(p_limit, 400), 1), 500)
      ) x
    )
  )
$$;
revoke all on function public.offline_sync(timestamptz, text, int) from public;
grant execute on function public.offline_sync(timestamptz, text, int) to anon, authenticated;
