-- Q13: renaming is for uploaded songs. Players can no longer rename or suggest names for known
-- library songs; admins still rename them (rename_song: admins any song, owners their uploads,
-- unchanged). Past renames, the rename log and old-link redirects stay as they are.

-- Name suggestions for library songs are closed to players.
create or replace function public.propose_rename(p_song uuid, p_title text, p_artist text, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Library song names are set by admins. Use "Suggest a change" for chart fixes.' using errcode = '42501';
end $$;
revoke all on function public.propose_rename(uuid, text, text, text) from public, anon;
grant execute on function public.propose_rename(uuid, text, text, text) to authenticated;

-- Votes can no longer rename a library song either (admins can still decide any old suggestion).
create or replace function public.vote_rename(p_id uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Name suggestions are closed. Admins rename library songs.' using errcode = '42501';
end $$;
revoke all on function public.vote_rename(uuid, boolean) from public, anon;
grant execute on function public.vote_rename(uuid, boolean) to authenticated;

-- Close any suggestion still open (there were none when this shipped).
update public.rename_proposals set status = 'withdrawn', decided_at = now() where status = 'open';

-- Admins: library songs renamed by a player (community vote) or by a non-admin, for review.
create or replace function public.renames_to_review() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'song_id', r.song_id, 'slug', s.slug, 'old_title', r.old_title, 'old_artist', r.old_artist,
    'new_title', r.new_title, 'new_artist', r.new_artist, 'via', r.via, 'at', r.created_at,
    'by', coalesce(nullif(p.display_name, ''), 'A player')
  ) order by r.created_at desc), '[]'::jsonb)
  from public.song_renames r
  join public.songs s on s.id = r.song_id and s.status <> 'private'
  left join public.profiles p on p.id = r.by_id
  where public.is_admin()
    and (r.via = 'community' or (r.via <> 'owner' and (p.role is null or p.role <> 'admin')))
$$;
revoke all on function public.renames_to_review() from public, anon;
grant execute on function public.renames_to_review() to authenticated;
