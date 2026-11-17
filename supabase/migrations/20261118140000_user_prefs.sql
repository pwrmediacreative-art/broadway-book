-- Per-player settings that follow them across devices (owner-only; profiles are public, so
-- these live in their own table). First one: how the player reads charts.
--   chart_display: 'numbers' | 'chords'; chart_display_at: when it was last changed (the
--   device's clock). The app keeps the most recent of device and account and copies it to
--   the other (lib/display.ts).
create table public.user_prefs (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  chart_display text check (chart_display in ('numbers', 'chords')),
  chart_display_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.user_prefs enable row level security;
revoke all on public.user_prefs from anon, authenticated;
grant select, insert on public.user_prefs to authenticated;
grant update (chart_display, chart_display_at, updated_at) on public.user_prefs to authenticated;
create policy "own prefs: read" on public.user_prefs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own prefs: add" on public.user_prefs for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own prefs: change" on public.user_prefs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
