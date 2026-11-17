-- Tightens the Song details count (20261118220000_song_detail_adds.sql) so only real
-- "+ Add…" saves count:
-- * song_details_log is gone: plain chart-editor saves no longer count, and nothing can
--   log without saving a changed chart.
-- * song_details_save logs only when the chart text actually changes, and refuses section
--   fields ("solo:7") beyond the saved chart's number of sections, and more fields than
--   the chart can have (start + ending + 3 per section).
-- * Each (player, song, field) still counts once (the table's primary key).

drop function if exists public.song_details_log(uuid, text[]);

-- Number of sections in a chart: lines that start with a [label].
create or replace function public._chart_sections(p_chart text)
returns int
language sql immutable set search_path = ''
as $$
  select count(*)::int from regexp_split_to_table(coalesce(p_chart, ''), E'\n') l where l ~ '^\s*\[';
$$;
revoke all on function public._chart_sections(text) from public, anon, authenticated;

create or replace function public._log_details(p_song uuid, p_fields text[], p_sections int)
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  if p_fields is null or cardinality(p_fields) = 0 then return 0; end if;
  if cardinality(p_fields) > 2 + 3 * p_sections then raise exception 'Too many details at once.'; end if;
  if exists (
    select 1 from unnest(p_fields) f
    where f !~ '^(start|ending|(solo|stop|key):[0-9]{1,3})$'
       or case when f ~ '^(solo|stop|key):[0-9]{1,3}$' then split_part(f, ':', 2)::int >= p_sections else false end) then
    raise exception 'That section isn''t in the chart.';
  end if;
  insert into public.song_detail_adds (user_id, song_id, field)
  select distinct auth.uid(), p_song, f from unnest(p_fields) f
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public._log_details(uuid, text[], int) from public, anon, authenticated;

create or replace function public.song_details_save(p_song uuid, p_chart text, p_meta jsonb, p_fields text[])
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_rev uuid;
  v_old text;
  v_bpm int := nullif(p_meta ->> 'bpm', '')::int;
begin
  if not public._may_add_details(p_song) then
    raise exception 'Chart not found.' using errcode = '42501';
  end if;
  select s.current_revision_id, r.chart_text into v_rev, v_old
  from public.songs s left join public.revisions r on r.id = s.current_revision_id
  where s.id = p_song;
  -- nothing changed (a repeat save): no new revision, nothing counted
  if v_old is not distinct from p_chart then return v_rev; end if;
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
  perform public._log_details(p_song, p_fields, public._chart_sections(p_chart));
  return v_rev;
end;
$$;
revoke execute on function public.song_details_save from public, anon;
grant execute on function public.song_details_save to authenticated;

drop function if exists public._log_details(uuid, text[]);
