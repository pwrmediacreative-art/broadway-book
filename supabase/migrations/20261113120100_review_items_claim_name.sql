-- Fix: review_items (20261113120000) gave every unclaimed song a claimer name
-- ("Another reviewer"), so the queue list showed them all as being reviewed. The name is
-- now null unless someone holds a live claim. Claims themselves were never affected.
create or replace function public.review_items(p_filter text)
returns table (
  id uuid, slug text, title text, artist text, status text, unverified boolean, review_hold boolean,
  unclear int, confidence numeric, flags int, flagged boolean, has_draft boolean,
  claimed_by uuid, claimed_name text, claim_expires timestamptz, file_id uuid
)
language sql stable security definer set search_path = ''
as $$
  with alert as (select public.setting('flags_to_alert', 3) n),
  live_files as (
    select f.* from public.import_files f where not f.missing
  ),
  dup_keys as (
    select lower(title) lt, lower(artist) la from live_files
    where title is not null and artist is not null
    group by 1, 2 having count(*) > 1
  ),
  base as (
    select s.id, s.slug, s.title, s.artist, s.status::text status, s.unverified, s.review_hold,
           public.unclear_count(v.chart_text) unclear, v.ai_confidence confidence,
           (select count(*)::int from public.chart_flags fl where fl.song_id = s.id and fl.status = 'open') flags,
           exists (select 1 from public.review_drafts d where d.song_id = s.id) has_draft,
           f.id file_id, f.status::text file_status, f.title f_title, f.artist f_artist
    from public.songs s
    left join public.revisions v on v.id = s.current_revision_id
    left join lateral (
      select lf.id, lf.status, lf.title, lf.artist from live_files lf where lf.song_id = s.id
      order by lf.updated_at desc limit 1
    ) f on true
    where s.status in ('needs_review', 'published', 'imported')
  )
  select b.id, b.slug, b.title, b.artist, b.status, b.unverified, b.review_hold, b.unclear, b.confidence,
         b.flags, b.flags >= (select n from alert), b.has_draft,
         c.user_id,
         case when c.user_id is not null then coalesce(nullif(p.display_name, ''), 'Another reviewer') end,
         c.expires_at, b.file_id
  from base b
  left join public.review_claims c on c.song_id = b.id and c.expires_at > now()
  left join public.profiles p on p.id = c.user_id
  where case coalesce(p_filter, 'needs_review')
    when 'needs_manual' then b.file_status = 'needs_manual' and b.status <> 'published'
    when 'duplicates' then exists (select 1 from dup_keys k where k.lt = lower(b.f_title) and k.la = lower(b.f_artist))
    else (b.status = 'needs_review' and coalesce(b.file_status, '') <> 'needs_manual')
         or (b.status = 'published' and b.flags >= (select n from alert))
  end;
$$;
revoke execute on function public.review_items from public, anon, authenticated;
