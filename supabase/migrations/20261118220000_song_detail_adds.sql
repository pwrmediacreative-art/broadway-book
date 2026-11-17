-- Song details "+ Add…" (lib/upload/details.ts): players fill in a missing detail of an
-- uploaded chart (how it starts, the ending, solo spots, stops and breaks, a key change).
--
-- * The detail is written into the chart text (one source of truth) and saved as a new
--   revision. The server works out which details were filled in (markAdded) and logs them
--   here, one row per player, song and detail, so saving again never counts twice.
-- * song_detail_adds: the player's own rows only (their profile shows the count).
--   Rows are written only by the functions below.
-- * Who can add instantly: the chart's owner (private_save) and admins on another admin's
--   upload (they can already open those, 20261117110000_admin_shared_uploads.sql). The
--   app's server applies the detail to the saved text itself, so this path only adds
--   details. Other players have no way in yet: uploads stay private.

create table if not exists public.song_detail_adds (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  field text not null check (field ~ '^(start|ending|(solo|stop|key):[0-9]{1,3})$'),
  created_at timestamptz not null default now(),
  primary key (user_id, song_id, field)
);
create index if not exists song_detail_adds_song on public.song_detail_adds (song_id);

alter table public.song_detail_adds enable row level security;
revoke all on public.song_detail_adds from anon, authenticated;
grant select on public.song_detail_adds to authenticated;
create policy song_detail_adds_own on public.song_detail_adds
  for select to authenticated using (user_id = (select auth.uid()));

-- May the signed-in user add details to this chart? Owner, or an admin on an admin's upload.
create or replace function public._may_add_details(p_song uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.songs s
    where s.id = p_song and s.status = 'private'
      and (s.owner_id = auth.uid() or public._admin_sees_upload(s.owner_id)));
$$;
revoke all on function public._may_add_details(uuid) from public, anon, authenticated;

create or replace function public._log_details(p_song uuid, p_fields text[])
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  if p_fields is null or cardinality(p_fields) = 0 then return 0; end if;
  if cardinality(p_fields) > 60 then raise exception 'Too many details at once.'; end if;
  insert into public.song_detail_adds (user_id, song_id, field)
  select auth.uid(), p_song, f from unnest(p_fields) f
  where f ~ '^(start|ending|(solo|stop|key):[0-9]{1,3})$'
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public._log_details(uuid, text[]) from public, anon, authenticated;

-- After the owner's own save (savePrivateChart -> private_save): log what they filled in.
-- Only counts when the live revision is theirs, i.e. right after they saved it.
create or replace function public.song_details_log(p_song uuid, p_fields text[])
returns int
language plpgsql security definer set search_path = ''
as $$
begin
  if not public._may_add_details(p_song) or not exists (
    select 1 from public.songs s join public.revisions r on r.id = s.current_revision_id
    where s.id = p_song and r.author_id = auth.uid()) then
    raise exception 'Chart not found.' using errcode = '42501';
  end if;
  return public._log_details(p_song, p_fields);
end;
$$;
revoke execute on function public.song_details_log from public, anon;
grant execute on function public.song_details_log to authenticated;

-- "+ Add…" save from Song details: a new revision with the detail written in, then the log.
-- The owner goes through private_save (title/artist kept). An admin on another admin's
-- upload gets a revision too (title and artist never change on this path).
create or replace function public.song_details_save(p_song uuid, p_chart text, p_meta jsonb, p_fields text[])
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_rev uuid;
  v_bpm int := nullif(p_meta ->> 'bpm', '')::int;
begin
  if not public._may_add_details(p_song) then
    raise exception 'Chart not found.' using errcode = '42501';
  end if;
  if exists (select 1 from public.songs s where s.id = p_song and s.owner_id = auth.uid()) then
    v_rev := public.private_save(p_song, p_chart, p_meta, null, null, 'Added song details');
  else
    perform public._check_private_chart(p_chart);
    if v_bpm is not null and v_bpm not between 20 and 400 then v_bpm := null; end if;
    v_rev := gen_random_uuid();
    insert into public.revisions (id, song_id, chart_text, author_id, source, note)
    values (v_rev, p_song, p_chart, auth.uid(), 'upload', 'Added song details');
    update public.songs set
      current_revision_id = v_rev,
      key = nullif(p_meta ->> 'key', ''), bpm = v_bpm, time_sig = nullif(p_meta ->> 'time', '')
    where id = p_song;
    update public.uploads set edited = true, updated_at = now() where song_id = p_song;
  end if;
  perform public._log_details(p_song, p_fields);
  return v_rev;
end;
$$;
revoke execute on function public.song_details_save from public, anon;
grant execute on function public.song_details_save to authenticated;
