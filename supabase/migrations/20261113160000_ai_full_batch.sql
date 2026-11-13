-- Full AI batch: limited automatic re-sends, "Retry failed", a check after the first
-- chunk, and the numbers the /admin/import panel shows (skipped, run summary).
-- Replaces some functions from 20261112200100_ai_reading.sql; that file is unchanged.

-- failures: technical failures in a row that billed nothing (Dropbox download, batch
--   request errored/expired). One automatic re-send; the second makes it needs_manual.
-- queued: an admin pressed "Retry failed"; the next run reads this file once more.
-- admin_retries: how many times "Retry failed" re-read it. After one, any result
--   without a chart ends as needs_manual.
alter table public.ai_readings
  add column failures int not null default 0 check (failures >= 0),
  add column queued boolean not null default false,
  add column admin_retries int not null default 0 check (admin_retries >= 0);

-- The full batch stops after its first chunk until an admin has checked those charts.
alter table public.ai_state
  add column first_chunk_ok_at timestamptz,
  add column first_chunk_ok_by uuid references public.profiles (id) on delete set null;

-- Can this file's current content be read? True when it has no reading, when an admin
-- queued it with "Retry failed", or when it failed once without being billed.
-- A reading that was billed (ok, needs_manual, refused, or stale and counted as spent)
-- is never sent again on its own. Internal.
create or replace function public.ai_readable(p_hash text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_hash is not null and not exists (
    select 1 from public.ai_readings r
    where r.content_hash = p_hash
      and not (r.queued or (r.status = 'error' and r.failures = 1))
  );
$$;
revoke execute on function public.ai_readable from public, anon, authenticated;

-- Same as before, plus: a batch can't be reserved while the first chunk waits for its
-- check, and a queued retry counts as an admin retry.
create or replace function public.ai_reserve(p_items jsonb, p_mode text, p_model text, p_cap numeric)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  e jsonb;
  f public.import_files;
  r public.ai_readings;
  had_row boolean;
  est numeric;
  total numeric;
  rows_out jsonb := '[]';
  capped boolean := false;
  skipped int := 0;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('pilot', 'batch') then
    raise exception 'mode must be pilot or batch';
  end if;
  if p_cap is null or p_cap <= 0 then
    raise exception 'no spending cap set';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'p_items must be an array of at most 200 files';
  end if;
  if p_mode = 'batch' and (select pilot_approved_at from public.ai_state) is null then
    raise exception 'approve the pilot first';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.ai_reserve'));
  if p_mode = 'batch' and (select first_chunk_ok_at from public.ai_state) is null
     and exists (select 1 from public.ai_readings where mode = 'batch') then
    raise exception 'check the first chunk first';
  end if;
  total := public.ai_spent();

  for e in select value from jsonb_array_elements(p_items) loop
    est := (e->>'est_usd')::numeric;
    if est is null or est <= 0 or est > 5 then
      raise exception 'est_usd must be between 0 and 5';
    end if;
    select * into f from public.import_files where id = (e->>'import_file_id')::uuid;
    if not found or f.missing or f.title is null or f.artist is null
       or not public.ai_readable(f.content_hash) then
      skipped := skipped + 1;
      continue;
    end if;
    if total + est > p_cap then
      capped := true;
      exit;
    end if;
    total := total + est;

    select * into r from public.ai_readings where content_hash = f.content_hash;
    had_row := found;
    if had_row then -- a queued retry or one unbilled failure: reuse its row (cost adds up)
      update public.ai_readings set
        import_file_id = f.id, mode = p_mode, model = p_model, status = 'reserved',
        reserved_usd = est, batch_id = null, error = null, raw = null,
        admin_retries = admin_retries + (case when queued then 1 else 0 end),
        failures = (case when queued then 0 else failures end),
        queued = false, updated_at = now()
      where id = r.id
      returning * into r;
    else
      insert into public.ai_readings (content_hash, import_file_id, mode, model, reserved_usd)
      values (f.content_hash, f.id, p_mode, p_model, est)
      returning * into r;
    end if;
    update public.import_files set status = 'processing', error = null, updated_at = now() where id = f.id;

    rows_out := rows_out || jsonb_build_object(
      'reading_id', r.id, 'import_file_id', f.id, 'dropbox', coalesce(f.dropbox_file_id, f.dropbox_path),
      'file_name', f.file_name, 'title', f.title, 'artist', f.artist, 'size', f.size_bytes);
  end loop;

  return jsonb_build_object('reserved', rows_out, 'capped', capped, 'skipped', skipped, 'spent', total);
end;
$$;
revoke execute on function public.ai_reserve from public, anon;
grant execute on function public.ai_reserve to authenticated;

-- Nothing was sent or billed (download or submit failed): free the reservation.
-- The first time, the file is sent again later on its own; the second time it's needs_manual.
create or replace function public.ai_release(p_ids uuid[], p_error text)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  with released as (
    update public.ai_readings set
      failures = failures + 1,
      status = (case when failures + 1 >= 2 then 'needs_manual' else 'error' end),
      reserved_usd = 0,
      error = left(p_error || (case when failures + 1 >= 2 then ' (failed twice; needs a person)' else '' end), 2000),
      updated_at = now()
    where id = any (p_ids) and status = 'reserved'
    returning import_file_id, status, error
  )
  update public.import_files f set
    status = (case when x.status = 'needs_manual' then 'needs_manual' else 'error' end)::public.import_status,
    error = x.error, updated_at = now()
  from released x
  where f.id = x.import_file_id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.ai_release from public, anon;
grant execute on function public.ai_release to authenticated;

-- Record one finished reading (see the first version). New here:
--   * 'error' with no cost = a technical failure: one automatic re-send, then needs_manual.
--   * after an admin "Retry failed", anything without a chart ends as needs_manual.
create or replace function public.ai_finish(p_id uuid, p_status text, p_result jsonb)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r public.ai_readings;
  f public.import_files;
  s public.songs;
  st text := p_status;
  err text := left(p_result->>'error', 2000);
  chart text := p_result->>'chart_text';
  conf numeric := least(greatest((p_result->>'confidence')::numeric, 0), 1);
  cost numeric := coalesce((p_result->>'cost_usd')::numeric, 0);
  fails int;
  bpm_text text;
  sid uuid;
  rev uuid;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if st is null or st not in ('ok', 'ok_after_retry', 'needs_manual', 'refused', 'error') then
    raise exception 'bad status';
  end if;
  if cost < 0 or cost > 5 then
    raise exception 'cost_usd must be between 0 and 5';
  end if;
  select * into r from public.ai_readings where id = p_id for update;
  if not found then
    raise exception 'reading not found';
  end if;
  if r.status not in ('reserved', 'submitted') then
    return r.status;
  end if;
  select * into f from public.import_files where id = r.import_file_id;

  fails := case when st = 'error' and cost = 0 then r.failures + 1 else 0 end;
  if fails >= 2 then
    st := 'needs_manual';
    err := left(coalesce(err, 'Failed') || ' (failed twice; needs a person)', 2000);
  elsif st in ('error', 'refused') and fails = 0 and r.admin_retries > 0 then
    st := 'needs_manual';
  end if;

  -- The database repeats the lyrics guard instead of trusting the server.
  if st in ('ok', 'ok_after_retry') and (chart is null or char_length(chart) > 20000
                                          or public.chart_has_long_cue(chart)) then
    st := 'needs_manual';
    err := 'Chart missing, too long, or has a cue over 6 words.';
  end if;

  if st in ('ok', 'ok_after_retry') then
    sid := coalesce(f.song_id, public.import_ensure_song(f.id));
    select * into s from public.songs where id = sid for update;
    if sid is null then
      st := 'needs_manual';
      err := 'No song for this file (set its title and artist).';
    elsif s.status not in ('imported', 'draft', 'review', 'needs_review') then
      -- A live or archived song keeps its chart; don't add an unreviewed revision to
      -- its public history. The reading stays on this row.
      err := 'Song is ' || s.status || '; reading kept here, not attached.';
    else
      insert into public.revisions (song_id, chart_text, author_id, source, note, ai_confidence, ai_raw)
      values (sid, chart, auth.uid(), 'ai', left('AI reading of ' || coalesce(f.file_name, f.dropbox_path), 500),
              conf, p_result->'raw')
      returning id into rev;
      bpm_text := public.chart_tag(chart, 'bpm');
      update public.songs set
        current_revision_id = rev,
        status = 'needs_review',
        key = coalesce(public.chart_tag(chart, 'key'), key),
        bpm = case when bpm_text ~ '^\d{2,3}$' and bpm_text::int between 20 and 400 then bpm_text::int else bpm end,
        time_sig = coalesce(public.chart_tag(chart, 'time'), time_sig),
        dropbox_content_hash = r.content_hash,
        updated_at = now()
      where id = sid;
    end if;
  end if;

  update public.ai_readings set
    status = st,
    failures = fails,
    reserved_usd = 0,
    cost_usd = cost_usd + cost,
    input_tokens = input_tokens + coalesce((p_result->>'input_tokens')::int, 0),
    output_tokens = output_tokens + coalesce((p_result->>'output_tokens')::int, 0),
    cache_read_tokens = cache_read_tokens + coalesce((p_result->>'cache_read_tokens')::int, 0),
    cache_write_tokens = cache_write_tokens + coalesce((p_result->>'cache_write_tokens')::int, 0),
    confidence = conf,
    unclear = p_result->'unclear',
    raw = case when rev is null then p_result->'raw' end,
    error = err,
    revision_id = coalesce(rev, revision_id),
    updated_at = now()
  where id = p_id;

  update public.import_files set
    status = (case when st in ('ok', 'ok_after_retry') then 'needs_review'
                   when st = 'needs_manual' then 'needs_manual'
                   else 'error' end)::public.import_status,
    error = err,
    attempts = attempts + 1,
    song_id = coalesce(sid, song_id),
    updated_at = now()
  where id = f.id;

  return st;
end;
$$;
revoke execute on function public.ai_finish from public, anon;
grant execute on function public.ai_finish to authenticated;

-- Readings "Retry failed" may touch: no chart came out (needs_manual, refused, or an
-- error that won't be re-sent on its own), the file is still there and named, and its
-- song isn't live or archived (a reading there would never be attached). Internal.
create or replace function public.ai_retryable()
returns setof public.ai_readings
language sql stable security definer set search_path = ''
as $$
  select r.* from public.ai_readings r
  join public.import_files f on f.id = r.import_file_id
  left join public.songs s on s.id = f.song_id
  where not r.queued
    and (r.status in ('needs_manual', 'refused') or (r.status = 'error' and r.failures <> 1))
    and not f.missing and f.title is not null and f.artist is not null
    and f.content_hash = r.content_hash
    and (s.id is null or s.status in ('imported', 'draft', 'review', 'needs_review'));
$$;
revoke execute on function public.ai_retryable from public, anon, authenticated;

-- "Retry failed": queue every retryable reading for one more read. Returns how many.
create or replace function public.ai_retry_failed()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.ai_reserve'));
  update public.ai_readings set queued = true, updated_at = now()
  where id in (select id from public.ai_retryable());
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.ai_retry_failed from public, anon;
grant execute on function public.ai_retry_failed to authenticated;

-- The admin checked the first chunk's charts: the rest of the full batch may go.
create or replace function public.ai_confirm_first_chunk()
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if exists (select 1 from public.ai_readings where mode = 'batch' and status in ('reserved', 'submitted')) then
    raise exception 'the first chunk is still being read';
  end if;
  update public.ai_state set
    first_chunk_ok_at = coalesce(first_chunk_ok_at, now()),
    first_chunk_ok_by = coalesce(first_chunk_ok_by, auth.uid())
  returning first_chunk_ok_at into t;
  return t;
end;
$$;
revoke execute on function public.ai_confirm_first_chunk from public, anon;
grant execute on function public.ai_confirm_first_chunk to authenticated;

-- Everything the AI panel on /admin/import shows. Adds: skipped counts, the full batch
-- totals, the first-chunk check, and how many files "Retry failed" would touch.
create or replace function public.ai_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'spent', (select coalesce(sum(cost_usd), 0) from public.ai_readings),
    'reserved', (select coalesce(sum(reserved_usd), 0) from public.ai_readings),
    'counts', coalesce((select jsonb_object_agg(status, n)
                        from (select status, count(*) n from public.ai_readings group by status) c), '{}'),
    'batch_avg', (select avg(cost_usd) from public.ai_readings
                  where mode = 'batch' and cost_usd > 0 and status not in ('reserved', 'submitted')),
    'pilot_avg', (select avg(cost_usd) from public.ai_readings
                  where mode = 'pilot' and cost_usd > 0 and status not in ('reserved', 'submitted')),
    'remaining', (select count(distinct content_hash) from public.import_files
                  where not missing and title is not null and artist is not null
                    and public.ai_readable(content_hash)),
    'unnamed', (select count(*) from public.import_files
                where not missing and (title is null or artist is null)),
    'skipped', jsonb_build_object(
      -- read by the pilot, so the full batch never sends them
      'already_read', (select count(distinct r.content_hash) from public.ai_readings r
                       where r.mode = 'pilot' and r.status not in ('reserved', 'submitted')
                         and exists (select 1 from public.import_files f
                                     where f.content_hash = r.content_hash and not f.missing)),
      -- named files whose PDF is the same as another named file's: read once
      'duplicates', (select count(*) - count(distinct content_hash) from public.import_files
                     where not missing and title is not null and artist is not null),
      'unnamed', (select count(*) from public.import_files
                  where not missing and (title is null or artist is null))),
    'batch', (select jsonb_build_object(
                'total', count(*),
                'read', count(*) filter (where status in ('ok', 'ok_after_retry')),
                'failed', count(*) filter (where status in ('needs_manual', 'refused', 'error')),
                'open', count(*) filter (where status in ('reserved', 'submitted')),
                'cost', coalesce(sum(cost_usd), 0))
              from public.ai_readings where mode = 'batch'),
    'first_chunk_ok_at', (select first_chunk_ok_at from public.ai_state),
    'retryable', (select count(*) from public.ai_retryable()),
    'queued', (select count(*) from public.ai_readings where queued),
    'open_batches', coalesce((select jsonb_agg(distinct batch_id) from public.ai_readings
                              where status = 'submitted' and batch_id is not null), '[]'),
    'pilot_approved_at', (select pilot_approved_at from public.ai_state),
    'pilot', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'status', r.status, 'cost_usd', r.cost_usd, 'confidence', r.confidence,
        'unclear', r.unclear, 'error', r.error, 'import_file_id', r.import_file_id,
        'file_name', f.file_name, 'title', f.title, 'artist', f.artist, 'slug', s.slug,
        'chart_text', coalesce(v.chart_text, r.raw->>'chart_text'),
        'notes', coalesce(v.ai_raw, r.raw)->>'notes',
        'handwriting', coalesce(v.ai_raw, r.raw)->>'handwriting')
        order by r.created_at, f.file_name)
      from public.ai_readings r
      join public.import_files f on f.id = r.import_file_id
      left join public.revisions v on v.id = r.revision_id
      left join public.songs s on s.id = f.song_id
      where r.mode = 'pilot'), '[]')
  ) into result;
  return result;
end;
$$;
revoke execute on function public.ai_overview from public, anon;
grant execute on function public.ai_overview to authenticated;
