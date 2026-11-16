-- Private charts from uploads (MusicXML now, audio analysis later).
--
-- * A private chart is a songs row with status 'private' and an owner. Only the owner can
--   read it or its revisions: not anon, not other signed-in users, not other admins.
--   It is never in the search index, offline_sync(), proposals, votes, flags or
--   confirmations (those all read published songs only).
-- * uploads: one row per private chart (source, audio file, the parsed analysis used to
--   rebuild the chart, play-marker sync, confidence, share code). Owner only.
-- * Storage bucket 'audio': private. Files live under <owner id>/...; only the owner can
--   read or delete them. New uploads need upload_access().
-- * Who may upload: setting 'audio_upload_access' (0 off, 1 admins only, 2 admins + Pro),
--   changed on /admin with set_upload_access(). Pro = profiles.is_pro, copied by the server
--   from the PRO_EMAILS env var (like ADMIN_EMAILS). Users can't change it.
-- * Every write goes through the functions below (security definer, owner checked).

-- ── Pro flag ─────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists is_pro boolean not null default false;

create or replace function public.guard_profile_pro()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_pro is distinct from old.is_pro
     and coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'Pro can only be changed by the server' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger profiles_guard_pro before update on public.profiles
  for each row execute function public.guard_profile_pro();

-- ── setting: who may upload ──────────────────────────────────────────────────
insert into public.settings (key, value, label)
values ('audio_upload_access', 1, 'Audio upload: 0 off, 1 admins only, 2 admins + Pro')
on conflict (key) do nothing;

create or replace function public.upload_access()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and case coalesce(public.app_setting('audio_upload_access'), 1)
    when 0 then false
    when 1 then public.is_admin()
    else public.is_admin() or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.is_pro and not p.blocked)
  end;
$$;
revoke execute on function public.upload_access from public, anon;
grant execute on function public.upload_access to authenticated;

create or replace function public.set_upload_access(p_value int)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change this' using errcode = '42501';
  end if;
  if p_value is null or p_value not in (0, 1, 2) then
    raise exception 'Pick Off, Admins only or Admins + Pro';
  end if;
  update public.settings set value = p_value, updated_at = now(), updated_by = auth.uid()
  where key = 'audio_upload_access';
end;
$$;
revoke execute on function public.set_upload_access from public, anon;
grant execute on function public.set_upload_access to authenticated;

-- ── songs: owner ─────────────────────────────────────────────────────────────
alter table public.songs add column if not exists owner_id uuid references public.profiles (id) on delete cascade;
alter table public.songs add constraint songs_private_owner
  check ((status = 'private') = (owner_id is not null));
create index if not exists songs_owner on public.songs (owner_id) where owner_id is not null;

-- Private charts are hidden from other admins too: admin policies skip them.
drop policy "read published songs" on public.songs;
create policy "read published songs" on public.songs
  for select using (
    status = 'published'
    or (status <> 'private' and public.is_admin())
    or (status = 'private' and owner_id = auth.uid())
  );
drop policy "admins insert songs" on public.songs;
create policy "admins insert songs" on public.songs
  for insert to authenticated with check (public.is_admin() and status <> 'private');
drop policy "admins update songs" on public.songs;
create policy "admins update songs" on public.songs
  for update to authenticated
  using (public.is_admin() and status <> 'private')
  with check (public.is_admin() and status <> 'private');
drop policy "admins delete songs" on public.songs;
create policy "admins delete songs" on public.songs
  for delete to authenticated using (public.is_admin() and status <> 'private');

create or replace function public._is_private_song(p_song uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.songs s where s.id = p_song and s.status = 'private');
$$;
revoke all on function public._is_private_song(uuid) from public;
grant execute on function public._is_private_song(uuid) to anon, authenticated;

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
  );
drop policy "admins add revisions" on public.revisions;
create policy "admins add revisions" on public.revisions
  for insert to authenticated with check (public.is_admin() and not public._is_private_song(song_id));

-- ── uploads ──────────────────────────────────────────────────────────────────
create table public.uploads (
  song_id uuid primary key references public.songs (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  source text not null check (source in ('musicxml', 'audio')),
  status text not null default 'ready' check (status in ('queued', 'analyzing', 'building', 'ready', 'failed')),
  error text check (char_length(error) <= 500),
  audio_path text check (audio_path is null or audio_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  audio_seconds numeric check (audio_seconds is null or audio_seconds between 0 and 3600),
  analysis jsonb,                -- parsed chord timeline used to rebuild (no lyrics, ever)
  sync jsonb,                    -- play marker: {"start": seconds} (tap sync) or {"bars": [...]}
  confidence real check (confidence is null or confidence between 0 and 1),
  confidence_estimated boolean not null default true,
  edited boolean not null default false, -- the owner saved changes since the last build
  share_code text unique check (share_code is null or share_code ~ '^[A-Za-z0-9_-]{16,}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pg_column_size(analysis) <= 400000)
);
create index uploads_owner on public.uploads (owner_id, created_at desc);

alter table public.uploads enable row level security;
revoke all on public.uploads from anon, authenticated;
grant select on public.uploads to authenticated;
create policy "owners read uploads" on public.uploads
  for select to authenticated using (owner_id = auth.uid());

-- ── storage: private audio bucket ────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', false, 52428800,
        array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac',
              'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "audio: owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "audio: uploader adds" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text
              and public.upload_access());
create policy "audio: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── helpers ──────────────────────────────────────────────────────────────────
create or replace function public._private_slug(p_title text)
returns text
language sql volatile set search_path = ''
as $$
  select coalesce(nullif(trim(both '-' from left(
           trim(both '-' from regexp_replace(lower(coalesce(p_title, '')), '[^a-z0-9]+', '-', 'g')), 60)), ''), 'chart')
         || '-' || substr(md5(gen_random_uuid()::text), 1, 8);
$$;
revoke all on function public._private_slug(text) from public, anon, authenticated;

create or replace function public._check_private_chart(p_chart text)
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if p_chart is null or char_length(p_chart) not between 1 and 20000 then
    raise exception 'The chart is empty or too long.';
  end if;
  if public.chart_has_long_cue(p_chart) then
    raise exception 'A cue is longer than 6 words. Cues only, never lyrics.';
  end if;
end;
$$;
revoke all on function public._check_private_chart(text) from public, anon, authenticated;

-- ── create ───────────────────────────────────────────────────────────────────
-- p_meta: {"key": "A", "bpm": 120, "time": "4/4"} (read from the chart by the server).
create or replace function public.upload_create(
  p_title text, p_artist text, p_source text, p_chart text, p_meta jsonb,
  p_analysis jsonb, p_confidence real, p_estimated boolean,
  p_audio_path text default null, p_audio_seconds numeric default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_song uuid := gen_random_uuid();
  v_rev uuid := gen_random_uuid();
  v_slug text;
  v_bpm int := nullif(p_meta ->> 'bpm', '')::int;
begin
  if not public.upload_access() then
    raise exception 'Uploading isn''t open to your account.' using errcode = '42501';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then
    raise exception 'Give the song a title.';
  end if;
  if p_artist is not null and char_length(p_artist) > 200 then
    raise exception 'Artist is too long.';
  end if;
  if p_audio_path is not null and split_part(p_audio_path, '/', 1) <> auth.uid()::text then
    raise exception 'That audio file isn''t yours.' using errcode = '42501';
  end if;
  perform public._check_private_chart(p_chart);
  if v_bpm is not null and v_bpm not between 20 and 400 then v_bpm := null; end if;

  v_slug := public._private_slug(p_title);
  insert into public.songs (id, slug, title, artist, key, bpm, time_sig, status, owner_id)
  values (v_song, v_slug, trim(p_title), nullif(trim(coalesce(p_artist, '')), ''),
          nullif(p_meta ->> 'key', ''), v_bpm, nullif(p_meta ->> 'time', ''), 'private', auth.uid());
  insert into public.revisions (id, song_id, chart_text, author_id, source, note)
  values (v_rev, v_song, p_chart, auth.uid(), 'upload', 'Draft from ' || p_source);
  update public.songs set current_revision_id = v_rev where id = v_song;
  insert into public.uploads (song_id, owner_id, source, status, audio_path, audio_seconds,
                              analysis, confidence, confidence_estimated)
  values (v_song, auth.uid(), p_source, 'ready', p_audio_path, p_audio_seconds,
          p_analysis, p_confidence, coalesce(p_estimated, true));
  return jsonb_build_object('id', v_song, 'slug', v_slug);
end;
$$;
revoke execute on function public.upload_create from public, anon;
grant execute on function public.upload_create to authenticated;

-- ── save (owner edits, rebuilds) ─────────────────────────────────────────────
create or replace function public.private_save(
  p_song uuid, p_chart text, p_meta jsonb, p_title text default null, p_artist text default null,
  p_note text default null, p_rebuilt boolean default false, p_confidence real default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_rev uuid := gen_random_uuid();
  v_bpm int := nullif(p_meta ->> 'bpm', '')::int;
begin
  if not exists (select 1 from public.songs s where s.id = p_song and s.status = 'private' and s.owner_id = auth.uid()) then
    raise exception 'Chart not found.' using errcode = '42501';
  end if;
  perform public._check_private_chart(p_chart);
  if v_bpm is not null and v_bpm not between 20 and 400 then v_bpm := null; end if;
  if p_title is not null and char_length(trim(p_title)) not between 1 and 200 then
    raise exception 'Give the song a title.';
  end if;
  insert into public.revisions (id, song_id, chart_text, author_id, source, note)
  values (v_rev, p_song, p_chart, auth.uid(), 'upload', left(p_note, 500));
  update public.songs set
    current_revision_id = v_rev,
    title = coalesce(nullif(trim(p_title), ''), title),
    artist = case when p_artist is null then artist else nullif(trim(p_artist), '') end,
    key = nullif(p_meta ->> 'key', ''), bpm = v_bpm, time_sig = nullif(p_meta ->> 'time', '')
  where id = p_song;
  update public.uploads set
    edited = not p_rebuilt,
    confidence = case when p_rebuilt then p_confidence else confidence end,
    updated_at = now()
  where song_id = p_song;
  return v_rev;
end;
$$;
revoke execute on function public.private_save from public, anon;
grant execute on function public.private_save to authenticated;

-- Play-marker sync: {"start": seconds} (tap sync) or {"bars": [seconds...]}.
create or replace function public.upload_set_sync(p_song uuid, p_sync jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_sync is not null and pg_column_size(p_sync) > 100000 then raise exception 'Sync data too large.'; end if;
  update public.uploads set sync = p_sync, updated_at = now()
  where song_id = p_song and owner_id = auth.uid();
  if not found then raise exception 'Chart not found.' using errcode = '42501'; end if;
end;
$$;
revoke execute on function public.upload_set_sync from public, anon;
grant execute on function public.upload_set_sync to authenticated;

-- Attach audio to a chart that has none (MusicXML upload, audio added later).
create or replace function public.upload_set_audio(p_song uuid, p_audio_path text, p_audio_seconds numeric)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.upload_access() then
    raise exception 'Uploading isn''t open to your account.' using errcode = '42501';
  end if;
  if split_part(p_audio_path, '/', 1) <> auth.uid()::text then
    raise exception 'That audio file isn''t yours.' using errcode = '42501';
  end if;
  update public.uploads set audio_path = p_audio_path, audio_seconds = p_audio_seconds, sync = null, updated_at = now()
  where song_id = p_song and owner_id = auth.uid() and audio_path is null;
  if not found then raise exception 'Chart not found, or it already has audio.' using errcode = '42501'; end if;
end;
$$;
revoke execute on function public.upload_set_audio from public, anon;
grant execute on function public.upload_set_audio to authenticated;

-- ── delete ───────────────────────────────────────────────────────────────────
-- Both return the audio file path; the server removes the stored file right after.
create or replace function public.upload_delete_audio(p_song uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_path text;
begin
  select audio_path into v_path from public.uploads where song_id = p_song and owner_id = auth.uid();
  if not found then raise exception 'Chart not found.' using errcode = '42501'; end if;
  update public.uploads set audio_path = null, audio_seconds = null, sync = null,
    analysis = case when source = 'audio' then null else analysis end, updated_at = now()
  where song_id = p_song;
  return v_path;
end;
$$;
revoke execute on function public.upload_delete_audio from public, anon;
grant execute on function public.upload_delete_audio to authenticated;

create or replace function public.upload_delete(p_song uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_path text;
begin
  select u.audio_path into v_path from public.uploads u where u.song_id = p_song and u.owner_id = auth.uid();
  delete from public.songs where id = p_song and status = 'private' and owner_id = auth.uid();
  if not found then raise exception 'Chart not found.' using errcode = '42501'; end if;
  return v_path;
end;
$$;
revoke execute on function public.upload_delete from public, anon;
grant execute on function public.upload_delete to authenticated;

-- ── sharing (structure card + chart only, never audio) ───────────────────────
create or replace function public.upload_share(p_song uuid, p_on boolean)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_code text;
begin
  if p_on then
    v_code := left(translate(encode(decode(md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), 'hex'), 'base64'),
                             '+/=' || chr(10), '-_'), 22);
  end if;
  update public.uploads set share_code = v_code, updated_at = now()
  where song_id = p_song and owner_id = auth.uid();
  if not found then raise exception 'Chart not found.' using errcode = '42501'; end if;
  return v_code;
end;
$$;
revoke execute on function public.upload_share from public, anon;
grant execute on function public.upload_share to authenticated;

create or replace function public.upload_shared(p_code text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('title', s.title, 'artist', s.artist, 'chart_text', r.chart_text)
  from public.uploads u
  join public.songs s on s.id = u.song_id and s.status = 'private'
  join public.revisions r on r.id = s.current_revision_id
  where p_code is not null and length(p_code) >= 16 and u.share_code = p_code;
$$;
revoke execute on function public.upload_shared from public;
grant execute on function public.upload_shared to anon, authenticated;

-- ── my private charts (search "Yours", offline copy, My uploads) ─────────────
create or replace function public.my_private_charts()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'slug', s.slug, 'title', s.title, 'artist', s.artist, 'key', s.key,
    'updated_at', s.updated_at, 'chart_text', r.chart_text,
    'source', u.source, 'status', u.status, 'has_audio', u.audio_path is not null,
    'confidence', u.confidence, 'created_at', u.created_at) order by u.created_at desc), '[]'::jsonb)
  from public.songs s
  join public.uploads u on u.song_id = s.id
  left join public.revisions r on r.id = s.current_revision_id
  where s.status = 'private' and s.owner_id = auth.uid();
$$;
revoke execute on function public.my_private_charts from public, anon;
grant execute on function public.my_private_charts to authenticated;

-- ── setlists: your own private charts play like any other chart ──────────────
-- Others (shared setlist links) get a "Private chart" placeholder, never the chart.
create or replace function public._setlist_song(p_song uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
    when s.status = 'published' or s.owner_id = (select auth.uid())
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
   and (s.status = 'published' or (s.status = 'private' and s.owner_id = (select auth.uid())))
  cross join lateral (select public._setlist_song(s.id) as j) x
  where x.j is not null
$$;

-- Your own private charts can be added to your setlists (security invoker: RLS shows a
-- private song only to its owner).
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
  -- A slug that isn't a published song or your own private chart (e.g. from an old device list) is skipped.
  insert into public.setlist_items (setlist_id, song_id, position, key_override, note)
  select p_id, y.sid, y.o, y.k, y.n from (
    select coalesce((x.e->>'song_id')::uuid, (select s.id from public.songs s where s.slug = x.e->>'slug' and s.status in ('published', 'private'))) as sid,
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
  select id into sid from public.songs where slug = p_slug and status in ('published', 'private');
  if sid is null then raise exception 'Song not found' using errcode = 'no_data_found'; end if;
  update public.setlists set updated_at = now() where id = p_id and owner_id = (select auth.uid());
  if not found then raise exception 'Setlist not found' using errcode = 'no_data_found'; end if;
  select coalesce(max(position), 0) + 1 into pos from public.setlist_items where setlist_id = p_id;
  insert into public.setlist_items (setlist_id, song_id, position) values (p_id, sid, pos);
  return pos;
end $$;
