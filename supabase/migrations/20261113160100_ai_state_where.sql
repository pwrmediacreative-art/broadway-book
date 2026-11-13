-- Supabase rejects an UPDATE without a WHERE clause ("UPDATE requires a WHERE clause"),
-- so "Approve pilot" (20261112200100) and "Continue full batch" (20261113160000) failed.
-- Same functions, with WHERE id on the one-row ai_state table.

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
  where id
  returning pilot_approved_at into t;
  return t;
end;
$$;
revoke execute on function public.ai_approve_pilot from public, anon;
grant execute on function public.ai_approve_pilot to authenticated;

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
  where id
  returning first_chunk_ok_at into t;
  return t;
end;
$$;
revoke execute on function public.ai_confirm_first_chunk from public, anon;
grant execute on function public.ai_confirm_first_chunk to authenticated;
