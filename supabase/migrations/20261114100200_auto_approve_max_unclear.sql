-- Auto-approve: allow up to N "# UNCLEAR" notes (owner's choice, 2026-11-14; starts at 1).
-- Follow-up to 20261114100000 and 20261114100100 (applied; unchanged). 0 = the old rule
-- (any unclear note keeps a chart in review). Admins change it on /admin/import (0 to 10).
-- The song page still doesn't show which bars were unclear (see FIX_LATER.md).

insert into public.settings (key, value, label) values
  ('auto_approve_max_unclear', 1, 'Auto-approve: most unclear spots allowed')
on conflict (key) do nothing;

-- Same as 20261114100100, with "at most N unclear notes" instead of "none".
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
    and public.unclear_count(v.chart_text) <= public.setting('auto_approve_max_unclear', 0)
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

-- Same as 20261114100000 plus max_unclear.
create or replace function public.auto_approve_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'enabled', public.setting('auto_approve_enabled', 0) = 1,
    'min_confidence', public.setting('auto_approve_min_confidence', 75),
    'max_unclear', public.setting('auto_approve_max_unclear', 0),
    'would_publish', (select count(*) from public.auto_approve_candidates()),
    'live', (select count(*) from public.auto_approved_songs()),
    -- full-batch readings that went live by themselves (for the run summary)
    'batch_auto', (select count(*) from public.auto_approvals a
                   join public.ai_readings r on r.revision_id = a.revision_id where r.mode = 'batch'),
    'needs_review', (select count(*) from public.songs where status = 'needs_review'));
end;
$$;
revoke execute on function public.auto_approve_overview from public, anon;
grant execute on function public.auto_approve_overview to authenticated;

-- Now also sets the unclear-spot limit. p_max_unclear null = leave it as it is, so the
-- two-argument call the live site makes until this deploy lands keeps working.
drop function public.auto_approve_set(boolean, int);
create function public.auto_approve_set(p_enabled boolean, p_min_confidence int, p_max_unclear int default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_enabled is null or p_min_confidence is null or p_min_confidence < 50 or p_min_confidence > 99 then
    raise exception 'Cutoff: a whole percent from 50 to 99';
  end if;
  if p_max_unclear is not null and (p_max_unclear < 0 or p_max_unclear > 10) then
    raise exception 'Unclear spots: 0 to 10';
  end if;
  update public.settings set value = v.value, updated_at = now(), updated_by = auth.uid()
  from (values ('auto_approve_enabled', case when p_enabled then 1 else 0 end),
               ('auto_approve_min_confidence', p_min_confidence),
               ('auto_approve_max_unclear', coalesce(p_max_unclear, public.setting('auto_approve_max_unclear', 0)))) v (key, value)
  where public.settings.key = v.key;
end;
$$;
revoke execute on function public.auto_approve_set from public, anon;
grant execute on function public.auto_approve_set to authenticated;
