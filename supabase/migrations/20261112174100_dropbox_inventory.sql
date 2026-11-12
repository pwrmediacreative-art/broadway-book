-- Dropbox inventory: one import_files row per PDF in the shared folder.
-- The server lists Dropbox and parses filenames; these functions store the result.
-- Rows are matched by Dropbox file id (survives renames), then by path, so a re-scan
-- never creates duplicates. Nothing is ever deleted: gone files are flagged `missing`.

alter table public.import_files
  add column dropbox_file_id text unique,
  add column file_name text,
  add column size_bytes bigint,
  add column server_modified timestamptz,
  add column title text check (char_length(title) <= 200),
  add column artist text check (char_length(artist) <= 200),
  add column name_fixed boolean not null default false,  -- an admin set title/artist by hand
  add column missing boolean not null default false,     -- not seen in the last full scan
  add column last_seen_at timestamptz,
  add column hash_changed_at timestamptz;                -- last time the PDF's content changed

create index import_files_name on public.import_files (lower(title), lower(artist));

-- 'Don't Rock the Jukebox' -> 'dont-rock-the-jukebox'
create or replace function public.slugify(t text)
returns text
language sql immutable set search_path = ''
as $$
  select coalesce(nullif(trim(both '-' from regexp_replace(
    regexp_replace(lower(coalesce(t, '')), '[''’]', '', 'g'),
    '[^a-z0-9]+', '-', 'g')), ''), 'song');
$$;

-- Give a named import row its draft song (status 'imported'). Internal only.
create or replace function public.import_ensure_song(p_import_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  f public.import_files;
  base text;
  s text;
  n int := 1;
  sid uuid;
begin
  select * into f from public.import_files where id = p_import_id;
  if not found or f.song_id is not null or f.title is null or f.artist is null then
    return f.song_id;
  end if;
  select id into sid from public.songs where dropbox_path = f.dropbox_path;
  if sid is null then
    base := trim(both '-' from left(public.slugify(f.title || ' ' || f.artist), 80));
    s := base;
    while exists (select 1 from public.songs where slug = s) loop
      n := n + 1;
      s := base || '-' || n;
    end loop;
    insert into public.songs (slug, title, artist, status, dropbox_path, dropbox_content_hash)
    values (s, f.title, f.artist, 'imported', f.dropbox_path, f.content_hash)
    returning id into sid;
  end if;
  update public.import_files set song_id = sid, updated_at = now() where id = f.id;
  return sid;
end;
$$;
revoke execute on function public.import_ensure_song from public, anon, authenticated;

-- Store one batch of scanned files. p_files: [{id, path, name, hash, size, modified, title, artist}]
-- p_scan_at marks every file seen in this scan (import_scan_finish uses it).
create or replace function public.import_scan_apply(p_files jsonb, p_scan_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  e jsonb;
  f public.import_files;
  v_id text;
  v_path text;
  v_hash text;
  v_title text;
  v_artist text;
  c_new int := 0;
  c_changed int := 0;
  c_same int := 0;
  c_moved int := 0;
  c_songs int := 0;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) > 1000 then
    raise exception 'p_files must be an array of at most 1000 files';
  end if;

  for e in select value from jsonb_array_elements(p_files) loop
    v_id := e->>'id';
    v_path := e->>'path';
    v_hash := e->>'hash';
    v_title := nullif(trim(e->>'title'), '');
    v_artist := nullif(trim(e->>'artist'), '');
    if v_id is null or v_path is null then
      raise exception 'every file needs id and path';
    end if;

    select * into f from public.import_files where dropbox_file_id = v_id;
    if not found then
      -- Same path, new file id: the PDF was replaced in place.
      select * into f from public.import_files where dropbox_path = v_path;
    end if;

    if not found then
      insert into public.import_files
        (dropbox_path, dropbox_file_id, file_name, content_hash, size_bytes, server_modified,
         title, artist, last_seen_at)
      values
        (v_path, v_id, e->>'name', v_hash, (e->>'size')::bigint, (e->>'modified')::timestamptz,
         v_title, v_artist, p_scan_at)
      returning * into f;
      c_new := c_new + 1;
    else
      if f.dropbox_path <> v_path then
        c_moved := c_moved + 1;
        update public.songs set dropbox_path = v_path, updated_at = now() where id = f.song_id;
      end if;
      if f.content_hash is distinct from v_hash then
        c_changed := c_changed + 1;
      elsif f.dropbox_path = v_path then
        c_same := c_same + 1;
      end if;
      update public.import_files set
        dropbox_file_id = v_id,
        dropbox_path = v_path,
        file_name = e->>'name',
        content_hash = v_hash,
        size_bytes = (e->>'size')::bigint,
        server_modified = (e->>'modified')::timestamptz,
        hash_changed_at = case when content_hash is distinct from v_hash then now() else hash_changed_at end,
        -- A renamed file is re-parsed unless an admin fixed its name by hand.
        title = case when name_fixed then title else v_title end,
        artist = case when name_fixed then artist else v_artist end,
        missing = false,
        last_seen_at = p_scan_at,
        updated_at = case when content_hash is distinct from v_hash or dropbox_path <> v_path
                          then now() else updated_at end
      where id = f.id
      returning * into f;
    end if;

    if f.song_id is null and public.import_ensure_song(f.id) is not null then
      c_songs := c_songs + 1;
    end if;
  end loop;

  return jsonb_build_object('new', c_new, 'changed', c_changed, 'unchanged', c_same,
                            'moved', c_moved, 'songs_created', c_songs);
end;
$$;
revoke execute on function public.import_scan_apply from public, anon;
grant execute on function public.import_scan_apply to authenticated;

-- After a COMPLETE listing: flag every file this scan didn't see. Returns how many.
create or replace function public.import_scan_finish(p_scan_at timestamptz)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  update public.import_files set missing = true, updated_at = now()
  where not missing and last_seen_at is distinct from p_scan_at;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.import_scan_finish from public, anon;
grant execute on function public.import_scan_finish to authenticated;

-- An admin names a file by hand. Creates its draft song if it has none; keeps an
-- untouched 'imported' song in step. The fix survives every later scan.
create or replace function public.import_fix_name(p_id uuid, p_title text, p_artist text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t text := nullif(trim(p_title), '');
  a text := nullif(trim(p_artist), '');
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if t is null or a is null then
    raise exception 'title and artist are both required';
  end if;
  update public.import_files
  set title = t, artist = a, name_fixed = true, updated_at = now()
  where id = p_id;
  if not found then
    raise exception 'import file not found';
  end if;
  update public.songs s set title = t, artist = a, updated_at = now()
  from public.import_files f
  where f.id = p_id and s.id = f.song_id and s.status = 'imported';
  return public.import_ensure_song(p_id);
end;
$$;
revoke execute on function public.import_fix_name from public, anon;
grant execute on function public.import_fix_name to authenticated;

-- Everything /admin/import shows except search: counts and the four review lists.
create or replace function public.import_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;

  with live as (
    select * from public.import_files where not missing
  ),
  dup_groups as (
    select lower(title) lt, lower(artist) la
    from live
    where title is not null and artist is not null
    group by 1, 2
    having count(*) > 1
  ),
  dups as (
    select l.* from live l join dup_groups g on lower(l.title) = g.lt and lower(l.artist) = g.la
  ),
  changed as (
    select f.* from live f join public.songs s on s.id = f.song_id
    where s.dropbox_content_hash is distinct from f.content_hash
  )
  select jsonb_build_object(
    'total', (select count(*) from live),
    'parsed', (select count(*) from live where title is not null and artist is not null),
    'unparsed', (select count(*) from live where title is null or artist is null),
    'duplicates', (select count(*) from dups),
    'duplicate_groups', (select count(*) from dup_groups),
    'changed', (select count(*) from changed),
    'missing', (select count(*) from public.import_files where missing),
    'last_scan', (select max(last_seen_at) from public.import_files),
    'unparsed_list', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'file_name', file_name, 'title', title, 'artist', artist)
                       order by file_name)
      from live where title is null or artist is null), '[]'),
    'duplicate_list', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'file_name', d.file_name, 'title', d.title,
                                          'artist', d.artist, 'slug', s.slug)
                       order by lower(d.title), lower(d.artist), d.file_name)
      from dups d left join public.songs s on s.id = d.song_id), '[]'),
    'changed_list', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'file_name', file_name, 'changed_at', hash_changed_at)
                       order by hash_changed_at desc nulls last)
      from changed), '[]'),
    'missing_list', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'file_name', file_name, 'path', dropbox_path)
                       order by file_name)
      from public.import_files where missing), '[]')
  ) into result;
  return result;
end;
$$;
revoke execute on function public.import_overview from public, anon;
grant execute on function public.import_overview to authenticated;
