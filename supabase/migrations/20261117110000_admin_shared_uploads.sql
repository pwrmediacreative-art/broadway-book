-- Admins share uploads: every admin can see every admin's uploaded (private) charts, to
-- read, play in stage mode, add to setlists and keep offline. Only the uploader can edit,
-- share, delete or hear the audio (uploads row and audio storage stay owner-only).
-- Charts uploaded by non-admins (Pro, later) stay private to their uploader.
-- The public and non-admin players still see nothing.

create or replace function public._admin_sees_upload(p_owner uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin()
     and exists (select 1 from public.profiles p where p.id = p_owner and p.role = 'admin');
$$;
revoke all on function public._admin_sees_upload(uuid) from public;
grant execute on function public._admin_sees_upload(uuid) to anon, authenticated;

drop policy "read published songs" on public.songs;
create policy "read published songs" on public.songs
  for select using (
    status = 'published'
    or (status <> 'private' and public.is_admin())
    or (status = 'private' and (owner_id = auth.uid() or public._admin_sees_upload(owner_id)))
  );

drop policy "read current revision" on public.revisions;
create policy "read current revision" on public.revisions
  for select using (
    (public.is_admin() and not public._is_private_song(song_id))
    or exists (
      select 1 from public.songs s
      where s.id = song_id and s.status = 'published' and s.current_revision_id = revisions.id
    )
    or exists (
      select 1 from public.songs s
      where s.id = song_id and s.status = 'private' and s.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.songs s
      where s.id = song_id and s.status = 'private' and s.current_revision_id = revisions.id
        and public._admin_sees_upload(s.owner_id)
    )
  );

-- Charts this player can open from uploads: their own, plus (admins) every admin's.
create or replace function public.upload_charts_visible()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'slug', s.slug, 'title', s.title, 'artist', s.artist, 'key', s.key,
    'chart_text', r.chart_text, 'mine', s.owner_id = auth.uid(),
    'by', case when s.owner_id = auth.uid() then null else coalesce(p.display_name, 'another admin') end)
    order by s.title), '[]'::jsonb)
  from public.songs s
  join public.revisions r on r.id = s.current_revision_id
  left join public.profiles p on p.id = s.owner_id
  where s.status = 'private'
    and (s.owner_id = auth.uid() or public._admin_sees_upload(s.owner_id));
$$;
revoke execute on function public.upload_charts_visible from public, anon;
grant execute on function public.upload_charts_visible to authenticated;

-- Setlists: a chart you can see plays; anyone else gets the "Private chart" placeholder.
create or replace function public._setlist_song(p_song uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
    when s.status = 'published' or s.owner_id = (select auth.uid()) or public._admin_sees_upload(s.owner_id)
      then jsonb_build_object('slug', s.slug, 'title', s.title, 'artist', s.artist, 'key', s.key,
                              'chart_text', r.chart_text,
                              'private_id', case when s.status = 'private' then s.id end)
    else jsonb_build_object('slug', null, 'title', 'Private chart', 'artist', null, 'key', null,
                            'chart_text', null, 'hidden', true)
  end
  from public.songs s
  join public.revisions r on r.id = s.current_revision_id
  where s.id = p_song and s.status in ('published', 'private')
$$;
revoke all on function public._setlist_song(uuid) from public, anon, authenticated;

create or replace function public.songs_bundle(p_slugs text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.j), '[]'::jsonb)
  from (select distinct u.slug from unnest(p_slugs[1:100]) as u(slug)) q
  join public.songs s on s.slug = q.slug
   and (s.status = 'published'
        or (s.status = 'private' and (s.owner_id = (select auth.uid()) or public._admin_sees_upload(s.owner_id))))
  cross join lateral (select public._setlist_song(s.id) as j) x
  where x.j is not null
$$;
