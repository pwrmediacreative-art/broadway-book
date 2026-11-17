-- A chart sent back to review (auto_approvals.pulled_back_at set by "Send back to review",
-- pull back, or the bulk undo) is no longer approved as is: clear its mark, so it doesn't
-- sort last or show "clean" in Needs review. Publishing it again marks it again.
create or replace function public.auto_approvals_mark_clean()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.pulled_back_at is not null then
    update public.approved_as_is set undone_at = now()
      where revision_id = new.revision_id and undone_at is null;
  else
    insert into public.approved_as_is (song_id, revision_id, confidence, run_id)
    select new.song_id, v.id, v.ai_confidence, new.run_id
    from public.revisions v
    where v.id = new.revision_id
      and public.is_clean_reading(v.source::text, v.chart_text, v.ai_confidence)
    on conflict (revision_id) where undone_at is null do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.auto_approvals_mark_clean from public, anon, authenticated;

update public.approved_as_is m set undone_at = now()
  from public.auto_approvals a
  where a.revision_id = m.revision_id and a.pulled_back_at is not null and m.undone_at is null;
