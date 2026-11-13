-- Personal flags: a player marks one spot on a chart (one number/chord in one bar) for
-- themselves, with an optional short note. Private to the owner: nobody else can read them,
-- admins included, and they never touch proposals or votes. (Not the public chart_flags.)
--
-- The spot is stored by position (section, bar within the section, chord within the bar) plus
-- the section label and the chord exactly as written. The app compares those with the current
-- chart and shows "chart changed since you flagged this" when they no longer match.

create table public.personal_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  -- The public revision on screen when flagged; null when flagged on the player's own version.
  revision_id uuid references public.revisions (id) on delete set null,
  section_index integer not null check (section_index between 0 and 199),
  section_label text not null check (char_length(section_label) between 1 and 20),
  bar_index integer not null check (bar_index between 0 and 999),
  beat_index integer not null check (beat_index between 0 and 15),
  item_text text not null check (char_length(item_text) between 1 and 40),
  note text check (char_length(note) <= 60),
  created_at timestamptz not null default now(),
  unique (user_id, song_id, section_index, bar_index, beat_index)
);

create or replace function public.check_personal_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  if tg_op = 'INSERT' then
    if new.revision_id is not null
       and not exists (select 1 from public.revisions r where r.id = new.revision_id and r.song_id = new.song_id) then
      raise exception 'That revision is not part of this song.';
    end if;
    if (select count(*) from public.personal_flags f where f.user_id = new.user_id and f.song_id = new.song_id) >= 200 then
      raise exception 'You can keep up to 200 flags on one song.';
    end if;
  else
    -- Only the note can change; the spot, song and owner stay as flagged.
    new.user_id := old.user_id;
    new.song_id := old.song_id;
    new.revision_id := old.revision_id;
    new.section_index := old.section_index;
    new.section_label := old.section_label;
    new.bar_index := old.bar_index;
    new.beat_index := old.beat_index;
    new.item_text := old.item_text;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger personal_flags_check
  before insert or update on public.personal_flags
  for each row execute function public.check_personal_flag();

alter table public.personal_flags enable row level security;
revoke all on public.personal_flags from anon, authenticated;
grant select, insert, update, delete on public.personal_flags to authenticated;
create policy "owner reads own flags" on public.personal_flags
  for select to authenticated using (user_id = auth.uid());
create policy "owner adds own flags" on public.personal_flags
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.songs s where s.id = song_id and s.status = 'published')
  );
create policy "owner edits own flags" on public.personal_flags
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner deletes own flags" on public.personal_flags
  for delete to authenticated using (user_id = auth.uid());
