-- Broadway Book: initial schema + Row Level Security.
-- Public can read published songs and their current revision only. All writes need auth.

create extension if not exists pg_trgm with schema extensions;

create type public.song_status as enum ('draft', 'review', 'published', 'archived');
create type public.revision_source as enum ('import', 'ai', 'human', 'community');
create type public.user_role as enum ('contributor', 'admin');
create type public.proposal_status as enum ('open', 'approved', 'rejected', 'withdrawn');
create type public.vote_value as enum ('approve', 'reject');
create type public.import_status as enum ('pending', 'processing', 'needs_review', 'done', 'error');

-- ── profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 60),
  instrument text check (char_length(instrument) <= 40),
  role public.user_role not null default 'contributor',
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Create a profile for every new auth user. No email is copied (profiles are public).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── songs + revisions ───────────────────────────────────────────────────────
create table public.songs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  artist text,
  key text,
  bpm int check (bpm between 20 and 400),
  time_sig text,
  tags text[] not null default '{}',
  status public.song_status not null default 'draft',
  is_example boolean not null default false,
  current_revision_id uuid,
  dropbox_path text unique,
  dropbox_content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index songs_title_trgm on public.songs using gin (title extensions.gin_trgm_ops);
create index songs_artist_trgm on public.songs using gin (artist extensions.gin_trgm_ops);
create index songs_status on public.songs (status);

create table public.revisions (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  chart_text text not null check (char_length(chart_text) <= 20000),
  author_id uuid references public.profiles (id) on delete set null,
  source public.revision_source not null,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index revisions_song on public.revisions (song_id, created_at desc);

alter table public.songs
  add constraint songs_current_revision_fk
  foreign key (current_revision_id) references public.revisions (id)
  on delete set null deferrable initially deferred;

-- ── proposals + votes ───────────────────────────────────────────────────────
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  base_revision_id uuid references public.revisions (id) on delete set null,
  chart_text text not null check (char_length(chart_text) <= 20000),
  note text check (char_length(note) <= 500),
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status public.proposal_status not null default 'open',
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  resulting_revision_id uuid references public.revisions (id) on delete set null,
  created_at timestamptz not null default now()
);

create index proposals_song on public.proposals (song_id, status);

create table public.votes (
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  voter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  value public.vote_value not null,
  created_at timestamptz not null default now(),
  primary key (proposal_id, voter_id)
);

-- ── setlists ────────────────────────────────────────────────────────────────
create table public.setlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.setlist_items (
  id uuid primary key default gen_random_uuid(),
  setlist_id uuid not null references public.setlists (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  position int not null,
  key_override text,
  note text check (char_length(note) <= 200),
  unique (setlist_id, position) deferrable initially deferred
);

-- ── import_files (Dropbox PDF import log) ──────────────────────────────────
create table public.import_files (
  id uuid primary key default gen_random_uuid(),
  dropbox_path text not null unique,
  content_hash text,
  status public.import_status not null default 'pending',
  song_id uuid references public.songs (id) on delete set null,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Publishing logic (runs as definer, so clients can't fake it) ───────────
-- Pull a header tag value out of chart text: {key: A} -> 'A'
create or replace function public.chart_tag(chart text, tag text)
returns text
language sql immutable set search_path = ''
as $$
  select nullif(trim(substring(chart from '\{' || tag || ':\s*([^{}]*?)\s*\}')), '');
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
    updated_at = now()
  where id = p_song_id;

  return rev_id;
end;
$$;
revoke execute on function public.publish_chart from public, anon, authenticated;

create or replace function public.decide_proposal(p_id uuid, p_approve boolean, p_by uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.proposals%rowtype;
  rev_id uuid;
begin
  select * into p from public.proposals where id = p_id for update;
  if p.status <> 'open' then return; end if;

  if p_approve then
    rev_id := public.publish_chart(p.song_id, p.chart_text, p.author_id, 'community', p.note);
  end if;

  update public.proposals set
    status = case when p_approve then 'approved'::public.proposal_status else 'rejected' end,
    decided_at = now(),
    decided_by = p_by,
    resulting_revision_id = rev_id
  where id = p_id;
end;
$$;
revoke execute on function public.decide_proposal from public, anon, authenticated;

-- After each vote: an admin's vote decides at once; otherwise 3 approvals publish
-- and 3 rejections close. Only votes from non-authors count.
create or replace function public.tally_vote()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  voter_is_admin boolean;
  approvals int;
  rejections int;
  author uuid;
begin
  select role = 'admin' into voter_is_admin from public.profiles where id = new.voter_id;
  if voter_is_admin then
    perform public.decide_proposal(new.proposal_id, new.value = 'approve', new.voter_id);
    return new;
  end if;

  select author_id into author from public.proposals where id = new.proposal_id;
  select
    count(*) filter (where value = 'approve'),
    count(*) filter (where value = 'reject')
  into approvals, rejections
  from public.votes
  where proposal_id = new.proposal_id and voter_id <> author;

  if approvals >= 3 then
    perform public.decide_proposal(new.proposal_id, true, null);
  elsif rejections >= 3 then
    perform public.decide_proposal(new.proposal_id, false, null);
  end if;
  return new;
end;
$$;

create trigger votes_tally
  after insert on public.votes
  for each row execute function public.tally_vote();

-- Admin: put an earlier revision back live (as a new revision, so history is kept).
create or replace function public.revert_song(p_song_id uuid, p_revision_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  old_text text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can revert' using errcode = '42501';
  end if;
  select chart_text into old_text from public.revisions
  where id = p_revision_id and song_id = p_song_id;
  if old_text is null then
    raise exception 'Revision not found for this song';
  end if;
  return public.publish_chart(p_song_id, old_text, auth.uid(), 'human', 'Revert to ' || p_revision_id);
end;
$$;
revoke execute on function public.revert_song from public, anon;
grant execute on function public.revert_song to authenticated;

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.songs enable row level security;
alter table public.revisions enable row level security;
alter table public.proposals enable row level security;
alter table public.votes enable row level security;
alter table public.setlists enable row level security;
alter table public.setlist_items enable row level security;
alter table public.import_files enable row level security;

-- Explicit table grants (RLS policies below decide which rows).
grant select on public.songs, public.revisions, public.profiles, public.setlists, public.setlist_items to anon, authenticated;
grant select, insert on public.proposals, public.votes to authenticated;
grant insert, update, delete on public.setlists, public.setlist_items to authenticated;
grant insert, update, delete on public.songs, public.import_files to authenticated;
grant select on public.import_files to authenticated;
grant insert on public.revisions to authenticated;
revoke update on public.profiles from anon, authenticated;
grant update (display_name, instrument) on public.profiles to authenticated;

-- profiles: public names; you can edit your own name/instrument (not your role).
create policy "profiles are public" on public.profiles
  for select using (true);
create policy "edit own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- songs: everyone reads published; admins read and write everything.
create policy "read published songs" on public.songs
  for select using (status = 'published' or public.is_admin());
create policy "admins insert songs" on public.songs
  for insert to authenticated with check (public.is_admin());
create policy "admins update songs" on public.songs
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete songs" on public.songs
  for delete to authenticated using (public.is_admin());

-- revisions: everyone reads the current revision of a published song; admins read all.
-- Revisions are never updated or deleted.
create policy "read current revision" on public.revisions
  for select using (
    public.is_admin() or exists (
      select 1 from public.songs s
      where s.id = song_id and s.status = 'published' and s.current_revision_id = revisions.id
    )
  );
create policy "admins add revisions" on public.revisions
  for insert to authenticated with check (public.is_admin());

-- proposals: signed-in users read them and open new ones for published songs.
create policy "signed-in read proposals" on public.proposals
  for select to authenticated using (true);
create policy "signed-in propose" on public.proposals
  for insert to authenticated with check (
    author_id = auth.uid()
    and status = 'open'
    and decided_at is null and decided_by is null and resulting_revision_id is null
    and exists (select 1 from public.songs s where s.id = song_id and s.status = 'published')
  );

-- votes: one vote per user per open proposal, never on your own (admins excepted).
create policy "signed-in read votes" on public.votes
  for select to authenticated using (true);
create policy "signed-in vote" on public.votes
  for insert to authenticated with check (
    voter_id = auth.uid()
    and exists (
      select 1 from public.proposals p
      where p.id = proposal_id and p.status = 'open'
        and (p.author_id <> auth.uid() or public.is_admin())
    )
  );

-- setlists: owners manage their own; public setlists are readable by anyone.
create policy "read own or public setlists" on public.setlists
  for select using (is_public or owner_id = auth.uid());
create policy "create own setlists" on public.setlists
  for insert to authenticated with check (owner_id = auth.uid());
create policy "update own setlists" on public.setlists
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "delete own setlists" on public.setlists
  for delete to authenticated using (owner_id = auth.uid());

create policy "read items of visible setlists" on public.setlist_items
  for select using (
    exists (select 1 from public.setlists l where l.id = setlist_id and (l.is_public or l.owner_id = auth.uid()))
  );
create policy "manage items of own setlists" on public.setlist_items
  for all to authenticated
  using (exists (select 1 from public.setlists l where l.id = setlist_id and l.owner_id = auth.uid()))
  with check (exists (select 1 from public.setlists l where l.id = setlist_id and l.owner_id = auth.uid()));

-- import_files: admins only.
create policy "admins manage imports" on public.import_files
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
