-- Auto-approve, follow-up to 20261114100000_auto_approve.sql (already applied; unchanged).
-- A reading that hit a technical failure and was re-sent gets its failures count reset to 0
-- once it succeeds, so the "existing drafts" button could not tell. ai_readings.had_failure
-- keeps that fact for good, and the one rule (auto_approve_candidates) checks it, so
-- ai_finish and the button agree. Readings saved before this have no such record.

alter table public.ai_readings add column had_failure boolean not null default false;

-- Same as 20261114100000 plus "not r.had_failure".
create or replace function public.auto_approve_candidates(p_song_id uuid default null)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select s.id
  from public.songs s
  join public.revisions v on v.id = s.current_revision_id
  join public.ai_readings r on r.revision_id = v.id
  where (p_song_id is null or s.id = p_song_id)
    and s.status = 'needs_review' and not s.review_hold
    and s.verified_at is null and not s.is_example
    and v.source = 'ai'
    and r.status = 'ok' and r.admin_retries = 0 and r.failures = 0 and not r.had_failure
    and public.auto_approve_over(v.ai_confidence, public.setting('auto_approve_min_confidence', 75))
    and public.unclear_count(v.chart_text) = 0
    and char_length(v.chart_text) <= 20000
    and not public.chart_has_long_cue(v.chart_text)
    and not exists (select 1 from public.auto_approvals x where x.song_id = s.id)
    and not exists (select 1 from public.review_claims c where c.song_id = s.id and c.expires_at > now())
    and not exists (select 1 from public.review_drafts d where d.song_id = s.id)
    and (select count(*) from public.import_files f
         where not f.missing and f.title is not null and f.artist is not null
           and lower(f.title) = lower(s.title) and lower(f.artist) = lower(s.artist)) <= 1;
$$;
revoke execute on function public.auto_approve_candidates from public, anon, authenticated;

-- Same as 20261114100000 plus had_failure kept on the reading.
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
    had_failure = had_failure or r.failures > 0 or fails > 0,
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

  -- New: with the switch on, a reading that passes the rule goes live as Unverified.
  -- r.failures is the count before this save (a technical failure that was re-sent).
  if rev is not null and r.failures = 0 and public.setting('auto_approve_enabled', 0) = 1
     and exists (select 1 from public.auto_approve_candidates(sid)) then
    perform public.auto_approve_publish(array[sid]);
  end if;

  return st;
end;
$$;
revoke execute on function public.ai_finish from public, anon;
grant execute on function public.ai_finish to authenticated;
