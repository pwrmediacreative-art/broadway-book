-- Search fields: feel + tags come from the chart header, like key/bpm/time already do.
-- Header = everything before the first section line ("[Verse]..."), so an inline
-- {feel: half time} inside a section never becomes the song's feel.

alter table public.songs add column if not exists feel text check (char_length(feel) <= 60);

create or replace function public.chart_header(chart text)
returns text
language sql immutable set search_path = ''
as $$
  select regexp_replace(chart, '\n[ \t]*\[.*$', '');
$$;

-- {tags: country, 90s} -> {country,90s} (trimmed, lowercased, de-duplicated). Null when no tag.
create or replace function public.chart_tags(chart text)
returns text[]
language sql immutable set search_path = ''
as $$
  select case when raw is null then null else coalesce((
    select array_agg(t order by first_pos)
    from (
      select lower(trim(x)) as t, min(pos) as first_pos
      from unnest(string_to_array(raw, ',')) with ordinality as u(x, pos)
      where trim(x) <> ''
      group by lower(trim(x))
    ) d
  ), '{}') end
  from (select public.chart_tag(public.chart_header(chart), 'tags') as raw) r;
$$;

create or replace function public.publish_chart(
  p_song_id uuid, p_chart text, p_author uuid, p_source public.revision_source, p_note text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  rev_id uuid;
  bpm_text text := public.chart_tag(p_chart, 'bpm');
  header text := public.chart_header(p_chart);
begin
  insert into public.revisions (song_id, chart_text, author_id, source, note)
  values (p_song_id, p_chart, p_author, p_source, p_note)
  returning id into rev_id;

  update public.songs set
    current_revision_id = rev_id,
    title = coalesce(public.chart_tag(p_chart, 'title'), title),
    artist = coalesce(public.chart_tag(p_chart, 'artist'), artist),
    key = coalesce(public.chart_tag(p_chart, 'key'), key),
    bpm = case when bpm_text ~ '^\d{2,3}$' then bpm_text::int else bpm end,
    time_sig = coalesce(public.chart_tag(p_chart, 'time'), time_sig),
    feel = coalesce(lower(left(public.chart_tag(header, 'feel'), 60)), feel),
    tags = coalesce(public.chart_tags(p_chart), tags),
    updated_at = now()
  where id = p_song_id;

  return rev_id;
end;
$$;
revoke execute on function public.publish_chart from public, anon, authenticated;

-- Backfill from each song's live revision.
update public.songs s set
  feel = coalesce(lower(left(public.chart_tag(public.chart_header(r.chart_text), 'feel'), 60)), s.feel),
  tags = coalesce(public.chart_tags(r.chart_text), s.tags)
from public.revisions r
where r.id = s.current_revision_id;
