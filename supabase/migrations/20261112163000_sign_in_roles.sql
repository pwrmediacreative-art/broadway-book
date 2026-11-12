-- Sign-in and roles.
-- Roles: 'contributor' (default) and 'admin'. The server copies the ADMIN_EMAILS env var into
-- profiles.role (service role) on each sign-in and /admin visit. Every admin check in the
-- database goes through public.is_admin(), which reads profiles.role.
-- Users can't change their own role: only display_name and instrument are granted to
-- `authenticated` (see init migration). The guard trigger below backs that up.

-- ── profile limits ──────────────────────────────────────────────────────────
alter table public.profiles
  add constraint profiles_display_name_len
    check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  add constraint profiles_instrument_list
    check (instrument is null or instrument in
      ('guitar', 'bass', 'keys', 'drums', 'fiddle', 'steel', 'vocals', 'other'));

-- ── role guard: only the service role (or a direct DB session) may change roles ──
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'role can only be changed by the server' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ── admin dashboard (admins only, enforced here, not just in the UI) ─────────
create or replace function public.admin_dashboard()
returns json
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return json_build_object(
    'songs',          (select count(*) from public.songs),
    'published',      (select count(*) from public.songs where status = 'published'),
    'open_proposals', (select count(*) from public.proposals where status = 'open'),
    'imports',        (select count(*) from public.import_files),
    'people',         (select count(*) from public.profiles)
  );
end;
$$;

revoke execute on function public.admin_dashboard from public, anon;
grant execute on function public.admin_dashboard to authenticated;
