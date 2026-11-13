-- AI reading of the Dropbox PDFs (Claude via the Anthropic API, server side only).
--
-- One ai_readings row per PDF *content* (content_hash, unique): a file is never billed
-- twice, and re-runs pick up where they stopped. Spending is reserved BEFORE a request
-- goes out, under a cap the server passes in (MAX_AI_SPEND_USD), inside one locked
-- transaction, so two tabs can't both spend the last dollar. Results become an 'ai'
-- revision on a song in 'needs_review'. Nothing is published here.

-- ── revisions: what the AI said, next to the chart it produced ──────────────
alter table public.revisions
  add column ai_confidence numeric(3,2) check (ai_confidence between 0 and 1),
  add column ai_raw jsonb check (ai_raw is null or pg_column_size(ai_raw) <= 100000);

-- ── ai_readings ─────────────────────────────────────────────────────────────
create table public.ai_readings (
  id uuid primary key default gen_random_uuid(),
  content_hash text not null unique,
  import_file_id uuid not null references public.import_files (id) on delete cascade,
  mode text not null check (mode in ('pilot', 'batch')),
  status text not null default 'reserved'
    check (status in ('reserved', 'submitted', 'ok', 'ok_after_retry', 'needs_manual', 'refused', 'error')),
  model text not null check (char_length(model) <= 60),
  batch_id text check (char_length(batch_id) <= 100),
  reserved_usd numeric(10,6) not null default 0 check (reserved_usd >= 0),
  cost_usd numeric(10,6) not null default 0 check (cost_usd >= 0),
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  confidence numeric(3,2) check (confidence between 0 and 1),
  unclear jsonb,
  raw jsonb check (raw is null or pg_column_size(raw) <= 100000), -- only when no revision holds it
  error text check (char_length(error) <= 2000),
  revision_id uuid references public.revisions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_readings_open on public.ai_readings (batch_id) where status = 'submitted';
create index ai_readings_mode on public.ai_readings (mode, created_at);

-- One row: has an admin approved the pilot? The full batch refuses to start until then.
create table public.ai_state (
  id boolean primary key default true check (id),
  pilot_approved_at timestamptz,
  pilot_approved_by uuid references public.profiles (id) on delete set null
);
insert into public.ai_state default values;

alter table public.ai_readings enable row level security;
alter table public.ai_state enable row level security;
create policy "admins read ai readings" on public.ai_readings for select using (public.is_admin());
create policy "admins read ai state" on public.ai_state for select using (public.is_admin());
-- Only the functions below write. Drop Supabase's default table grants.
revoke all on public.ai_readings, public.ai_state from anon, authenticated;
grant select on public.ai_readings, public.ai_state to authenticated;

-- Billed + reserved so far. Internal.
create or replace function public.ai_spent()
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(cost_usd + reserved_usd), 0) from public.ai_readings;
$$;
revoke execute on function public.ai_spent from public, anon, authenticated;

-- Can this file's current content be read? True when it has no reading, or only one
-- that failed before anything was billed. Internal.
create or replace function public.ai_readable(p_hash text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_hash is not null and not exists (
    select 1 from public.ai_readings r
    where r.content_hash = p_hash and not (r.status = 'error' and r.cost_usd = 0)
  );
$$;
revoke execute on function public.ai_readable from public, anon, authenticated;

-- Every file that can be read now (named, present, not read yet), for picking.
create or replace function public.ai_candidates()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'size', f.size_bytes)
                     order by f.file_name)
    from public.import_files f
    where not f.missing and f.title is not null and f.artist is not null
      and public.ai_readable(f.content_hash)
  ), '[]');
end;
$$;
revoke execute on function public.ai_candidates from public, anon;
grant execute on function public.ai_candidates to authenticated;

-- Reserve spending for files about to be read. p_items: [{import_file_id, est_usd}]
-- (est_usd = the worst case for one request). Skips files that can't be read (see
-- ai_readable). Stops at the first file that would push spent + reserved over p_cap.
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
    if had_row then -- an earlier unbilled error: reuse its row
      update public.ai_readings set
        import_file_id = f.id, mode = p_mode, model = p_model, status = 'reserved',
        reserved_usd = est, batch_id = null, error = null, raw = null, updated_at = now()
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

-- Reserve a little more for one reading (its single parser-error retry). False when the
-- cap doesn't allow it; the reading then ends as needs_manual.
create or replace function public.ai_reserve_more(p_id uuid, p_est numeric, p_cap numeric)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_est is null or p_est <= 0 or p_est > 5 or p_cap is null or p_cap <= 0 then
    raise exception 'bad estimate or cap';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.ai_reserve'));
  if public.ai_spent() + p_est > p_cap then
    return false;
  end if;
  update public.ai_readings set reserved_usd = reserved_usd + p_est, updated_at = now()
  where id = p_id and status in ('reserved', 'submitted');
  return found;
end;
$$;
revoke execute on function public.ai_reserve_more from public, anon;
grant execute on function public.ai_reserve_more to authenticated;

-- The requests went out in one Message Batch.
create or replace function public.ai_mark_submitted(p_ids uuid[], p_batch_id text)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  update public.ai_readings set status = 'submitted', batch_id = p_batch_id, updated_at = now()
  where id = any (p_ids) and status = 'reserved';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.ai_mark_submitted from public, anon;
grant execute on function public.ai_mark_submitted to authenticated;

-- Nothing was sent or billed (download or submit failed): free the reservation. The
-- file stays readable on the next run.
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
  update public.import_files f set status = 'error', error = left(p_error, 2000), updated_at = now()
  from public.ai_readings r
  where r.id = any (p_ids) and r.status = 'reserved' and f.id = r.import_file_id;
  update public.ai_readings set status = 'error', reserved_usd = 0, error = left(p_error, 2000), updated_at = now()
  where id = any (p_ids) and status = 'reserved';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.ai_release from public, anon;
grant execute on function public.ai_release to authenticated;

-- Record one finished reading: actual cost replaces the reservation. A good chart
-- (status ok / ok_after_retry) becomes an 'ai' revision and the song goes to
-- needs_review. Safe to call twice (a batch collected again): the second call is a no-op.
-- p_result: {cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
--            confidence, unclear, chart_text, raw, error}
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
  select * into r from public.ai_readings where id = p_id for update;
  if not found then
    raise exception 'reading not found';
  end if;
  if r.status not in ('reserved', 'submitted') then
    return r.status;
  end if;
  select * into f from public.import_files where id = r.import_file_id;

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
    reserved_usd = 0,
    cost_usd = cost_usd + coalesce((p_result->>'cost_usd')::numeric, 0),
    input_tokens = input_tokens + coalesce((p_result->>'input_tokens')::int, 0),
    output_tokens = output_tokens + coalesce((p_result->>'output_tokens')::int, 0),
    cache_read_tokens = cache_read_tokens + coalesce((p_result->>'cache_read_tokens')::int, 0),
    cache_write_tokens = cache_write_tokens + coalesce((p_result->>'cache_write_tokens')::int, 0),
    confidence = conf,
    unclear = p_result->'unclear',
    raw = case when rev is null then p_result->'raw' end,
    error = err,
    revision_id = rev,
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

-- A request that never got recorded (the server stopped mid-run) leaves its row
-- 'reserved'. After 15 minutes, count its reservation as spent (it may have been billed)
-- and close it as an error, so it is never sent again on its own and the cap stays honest.
create or replace function public.ai_expire_stale()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  update public.import_files f set status = 'error', error = 'AI run stopped before saving a result.', updated_at = now()
  from public.ai_readings r
  where r.status = 'reserved' and r.updated_at < now() - interval '15 minutes' and f.id = r.import_file_id;
  update public.ai_readings set
    status = 'error', cost_usd = cost_usd + reserved_usd, reserved_usd = 0,
    error = 'The run stopped before saving a result; counted as spent.', updated_at = now()
  where status = 'reserved' and updated_at < now() - interval '15 minutes';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.ai_expire_stale from public, anon;
grant execute on function public.ai_expire_stale to authenticated;

create or replace function public.ai_approve_pilot()
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ai_readings
                 where mode = 'pilot' and status not in ('reserved', 'submitted')) then
    raise exception 'run the pilot first';
  end if;
  update public.ai_state set
    pilot_approved_at = coalesce(pilot_approved_at, now()),
    pilot_approved_by = coalesce(pilot_approved_by, auth.uid())
  returning pilot_approved_at into t;
  return t;
end;
$$;
revoke execute on function public.ai_approve_pilot from public, anon;
grant execute on function public.ai_approve_pilot to authenticated;

-- Everything the AI panel on /admin/import shows.
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
