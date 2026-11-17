-- A live slug is never also a redirect, whoever creates the song (import scan, uploads,
-- renames). Without this, a new song could take a renamed song's old slug and
-- songs_bundle would return both songs for it.

-- Any song taking a slug drops a redirect from that slug (the live song wins).
create or replace function public.songs_drop_slug_redirect() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.song_slug_redirects where old_slug = new.slug and song_id <> new.id;
  return new;
end $$;
revoke all on function public.songs_drop_slug_redirect() from public, anon, authenticated;

create trigger songs_drop_slug_redirect
  after insert or update of slug on public.songs
  for each row execute function public.songs_drop_slug_redirect();

-- Clean up any that already overlap.
delete from public.song_slug_redirects r
  where exists (select 1 from public.songs s where s.slug = r.old_slug and s.id <> r.song_id);

-- And songs_bundle only follows a redirect when no song has that slug now.
create or replace function public.songs_bundle(p_slugs text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(case when q.slug <> s.slug then x.j || jsonb_build_object('asked', q.slug) else x.j end), '[]'::jsonb)
  from (select distinct u.slug from unnest(p_slugs[1:100]) as u(slug)) q
  left join public.song_slug_redirects r
    on r.old_slug = q.slug and not exists (select 1 from public.songs live where live.slug = q.slug)
  join public.songs s on (s.slug = q.slug or s.id = r.song_id)
   and (s.status = 'published'
        or (s.status = 'private' and (s.owner_id = (select auth.uid()) or public._admin_sees_upload(s.owner_id))))
  cross join lateral (select public._setlist_song(s.id) as j) x
  where x.j is not null
$$;
