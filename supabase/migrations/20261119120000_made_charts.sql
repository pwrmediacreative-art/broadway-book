-- Make your own charts (Q16): a tap-to-build editor for any signed-in player.
--
-- * A made chart is a private song (status 'private' + owner_id, like an upload) with a
--   made_charts row. Only its owner reads it (plus, like uploads, other admins for an admin's
--   chart). It is never in offline_sync(), the search index, votes or confirmations while
--   private. Not gated by the upload setting. Each player keeps up to 500.
-- * Writes only through chart_create / chart_save / chart_delete (owner checked here).
-- * "Submit to library" (chart_submit) opens a proposal of kind 'new_song' holding the chart
--   text. It counts as one of the player's open suggestions (max_open_proposals), shows in
--   Community and on the voters' badge, and goes live after approvals_needed approvals from
--   other players (or an admin's "Approve now"); rejections_needed rejections close it.
-- * While it waits the chart is locked: no new revision, no change to the song row, no
--   delete (triggers, so every write path refuses, uploads' functions included). Withdraw
--   (withdraw_proposal / chart_withdraw) or a close unlocks it; it stays private, and the
--   closed suggestion (text, votes) is hidden again from everyone but its maker and admins.
-- * Approved: the same song row becomes a library song, live as Unverified (the verification
--   trigger sees to that), with a public slug; the private slug redirects. Only the approved
--   text becomes public (a fresh revision): the autosaves before it stay private drafts. The made_charts row
--   goes, so the creator has no special rights any more. When a library song with the same
--   title + artist already exists, it becomes a separate entry: version_of points at the
--   original and version_by at the creator ("Version by <display name>", never an email).
-- All counting and publishing happens here (security definer), never in the client.

-- ── tables / columns ─────────────────────────────────────────────────────────
create table public.made_charts (
  song_id uuid primary key references public.songs (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index made_charts_owner on public.made_charts (owner_id, created_at desc);
alter table public.made_charts enable row level security;
revoke all on public.made_charts from anon, authenticated;
grant select on public.made_charts to authenticated;
create policy "owners read made charts" on public.made_charts
  for select to authenticated using (owner_id = auth.uid() or public._admin_sees_upload(owner_id));

alter table public.proposals add column kind text not null default 'edit'
  check (kind in ('edit', 'new_song'));
create index proposals_new_song_open on public.proposals (song_id) where status = 'open' and kind = 'new_song';

alter table public.songs
  add column version_of uuid references public.songs (id) on delete set null,
  add column version_by uuid references public.profiles (id) on delete set null;

-- ── helpers ──────────────────────────────────────────────────────────────────
-- Waiting for library votes = locked.
create or replace function public._chart_locked(p_song uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.proposals p where p.song_id = p_song and p.status = 'open' and p.kind = 'new_song');
$$;
-- Internal: only security definer functions and triggers call it.
revoke all on function public._chart_locked(uuid) from public, anon, authenticated;

-- The signed-in player's own made chart that is still private (row locked for the caller).
create or replace function public._own_made_chart(p_song uuid)
returns public.songs
language plpgsql security definer set search_path = ''
as $$
declare s public.songs;
begin
  select s2.* into s from public.songs s2
  join public.made_charts m on m.song_id = s2.id
  where s2.id = p_song and s2.status = 'private' and s2.owner_id = auth.uid() and m.owner_id = auth.uid()
  for update of s2;
  if not found then raise exception 'Chart not found.' using errcode = '42501'; end if;
  return s;
end;
$$;
revoke all on function public._own_made_chart(uuid) from public, anon, authenticated;

-- ── private drafts never become public ───────────────────────────────────────
-- Every revision written while its song is private (each autosave of a made chart, every
-- upload edit) is a private draft, set once when it is written. When a made chart is
-- approved, publishing writes a fresh revision with the approved text; the drafts before it
-- stay unreadable (not in the public history, not for admins, not for revert).
alter table public.revisions add column private_draft boolean not null default false;
grant select (private_draft) on public.revisions to anon, authenticated;
update public.revisions r set private_draft = true
  from public.songs s where s.id = r.song_id and s.status = 'private';

drop policy "read history of published songs" on public.revisions;
create policy "read history of published songs" on public.revisions
  for select using (
    not revisions.private_draft
    and exists (select 1 from public.songs s where s.id = song_id and s.status = 'published')
  );

-- Same as 20261117110000_admin_shared_uploads.sql, except admins no longer read private drafts.
drop policy "read current revision" on public.revisions;
create policy "read current revision" on public.revisions
  for select using (
    (public.is_admin() and not public._is_private_song(song_id) and not revisions.private_draft)
    or exists (
      select 1 from public.songs s
      where s.id = song_id and s.status = 'published' and s.current_revision_id = revisions.id
    )
    or exists (
      select 1 from public.songs s
      where s.id = song_id and s.status = 'private' and s.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.songs s
      where s.id = song_id and s.status = 'private' and s.current_revision_id = revisions.id
        and public._admin_sees_upload(s.owner_id)
    )
  );

-- ── lock: refuse every change while a chart waits for votes ──────────────────
-- (The same trigger marks private drafts.)
create or replace function public.made_lock_revisions()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public._chart_locked(new.song_id) then
    raise exception 'This chart is waiting for library votes. Withdraw it to make changes.' using errcode = '42501';
  end if;
  new.private_draft := exists (select 1 from public.songs s where s.id = new.song_id and s.status = 'private');
  return new;
end;
$$;
revoke execute on function public.made_lock_revisions() from public, anon, authenticated;
create trigger revisions_made_lock before insert on public.revisions
  for each row execute function public.made_lock_revisions();

create or replace function public.made_lock_songs()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Cascades (an account being deleted) still go through.
    if old.status = 'private' and pg_trigger_depth() = 1 and public._chart_locked(old.id) then
      raise exception 'This chart is waiting for library votes. Withdraw it first.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status = 'private' and public._chart_locked(old.id)
     and (new.slug, new.title, new.artist, new.key, new.bpm, new.time_sig, new.current_revision_id, new.status, new.owner_id)
         is distinct from
         (old.slug, old.title, old.artist, old.key, old.bpm, old.time_sig, old.current_revision_id, old.status, old.owner_id) then
    raise exception 'This chart is waiting for library votes. Withdraw it to make changes.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.made_lock_songs() from public, anon, authenticated;
create trigger songs_made_lock before update or delete on public.songs
  for each row execute function public.made_lock_songs();

-- Community shows a submission's name from the text that was sent (proposal computed
-- column: select=...,sent_name). The song row itself stays private: songs RLS is not
-- widened, since setlist_add / setlist_save, slug redirects, renames and the same-name
-- check all rely on it showing a private song only to its owner (and admins, for admins').
create or replace function public.sent_name(p public.proposals)
returns jsonb
language sql stable set search_path = ''
as $$
  select case when p.kind = 'new_song' then jsonb_build_object(
    'title', coalesce(public.chart_tag(public.chart_header(p.chart_text), 'title'), 'Untitled'),
    'artist', public.chart_tag(public.chart_header(p.chart_text), 'artist'))
  end;
$$;
grant execute on function public.sent_name(public.proposals) to anon, authenticated;

-- Same as 20261112190000_community_edits.sql, but security definer: voters can't read a
-- submission's private song row, and without it every submission would look out of date.
-- It only ever answers yes/no for a proposal the caller can already read.
create or replace function public.out_of_date(p public.proposals)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p.base_revision_id is distinct from (select s.current_revision_id from public.songs s where s.id = p.song_id);
$$;

-- A new-song submission is readable by signed-in players only while it waits (open) and once
-- it is approved (then it's a library song). Withdrawn or closed, the chart is private again:
-- the suggestion, its chart text (and so sent_name) and its votes are hidden from everyone but
-- its maker and admins. Suggested edits to library songs read as before (every signed-in player).
-- Visitors: "public read proposals" / "public read votes" (community_edits) already need a
-- published song, which a withdrawn or closed submission never has.
drop policy "signed-in read proposals" on public.proposals;
create policy "signed-in read proposals" on public.proposals
  for select to authenticated using (
    kind <> 'new_song'
    or status in ('open', 'approved')
    or author_id = auth.uid()
    or public.is_admin()
  );

-- Votes (and their comments) follow the suggestion: readable only when it is (proposals RLS decides).
drop policy "signed-in read votes" on public.votes;
create policy "signed-in read votes" on public.votes
  for select to authenticated using (
    exists (select 1 from public.proposals p where p.id = proposal_id)
  );

-- ── create / save / delete ───────────────────────────────────────────────────
create or replace function public.chart_create(p_title text, p_artist text, p_chart text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_song uuid := gen_random_uuid();
  v_rev uuid := gen_random_uuid();
  v_slug text;
  v_title text := public._clean_name(p_title);
  v_artist text := public._clean_name(p_artist);
  v_header text := public.chart_header(p_chart);
  v_bpm text := public.chart_tag(v_header, 'bpm');
begin
  if me is null then raise exception 'Sign in to make a chart.' using errcode = '42501'; end if;
  if v_title is null or char_length(v_title) > 200 then raise exception 'Give the song a title.'; end if;
  if char_length(coalesce(v_artist, '')) > 200 then raise exception 'Artist is too long.'; end if;
  perform public._check_private_chart(p_chart);
  perform pg_advisory_xact_lock(hashtext('made_charts:' || me::text));
  if (select count(*) from public.made_charts where owner_id = me) >= 500 then
    raise exception 'You have 500 charts already. Delete one to make another.';
  end if;

  v_slug := public._private_slug(v_title);
  insert into public.songs (id, slug, title, artist, key, bpm, time_sig, status, owner_id)
  values (v_song, v_slug, v_title, v_artist, public.chart_tag(v_header, 'key'),
          case when v_bpm ~ '^\d{2,3}$' then case when v_bpm::int between 20 and 400 then v_bpm::int end end,
          public.chart_tag(v_header, 'time'), 'private', me);
  insert into public.revisions (id, song_id, chart_text, author_id, source, note)
  values (v_rev, v_song, p_chart, me, 'human', 'New chart');
  update public.songs set current_revision_id = v_rev where id = v_song;
  insert into public.made_charts (song_id, owner_id) values (v_song, me);
  return jsonb_build_object('id', v_song, 'slug', v_slug);
end;
$$;
revoke execute on function public.chart_create(text, text, text) from public, anon;
grant execute on function public.chart_create(text, text, text) to authenticated;

-- Autosave. A new revision only when the text changed; the song row follows the header.
create or replace function public.chart_save(p_song uuid, p_chart text, p_title text, p_artist text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.songs;
  v_rev uuid;
  v_title text := public._clean_name(p_title);
  v_artist text := public._clean_name(p_artist);
  v_header text := public.chart_header(p_chart);
  v_bpm text := public.chart_tag(v_header, 'bpm');
  v_same boolean;
begin
  s := public._own_made_chart(p_song);
  if public._chart_locked(p_song) then
    raise exception 'This chart is waiting for library votes. Withdraw it to make changes.' using errcode = '42501';
  end if;
  if v_title is null or char_length(v_title) > 200 then raise exception 'Give the song a title.'; end if;
  if char_length(coalesce(v_artist, '')) > 200 then raise exception 'Artist is too long.'; end if;
  perform public._check_private_chart(p_chart);

  select r.chart_text = p_chart into v_same from public.revisions r where r.id = s.current_revision_id;
  v_rev := s.current_revision_id;
  if not coalesce(v_same, false) then
    v_rev := gen_random_uuid();
    insert into public.revisions (id, song_id, chart_text, author_id, source, note)
    values (v_rev, p_song, p_chart, auth.uid(), 'human', 'Edited');
  end if;
  update public.songs set
    current_revision_id = v_rev,
    title = v_title,
    artist = v_artist,
    key = public.chart_tag(v_header, 'key'),
    bpm = case when v_bpm ~ '^\d{2,3}$' then case when v_bpm::int between 20 and 400 then v_bpm::int end end,
    time_sig = public.chart_tag(v_header, 'time')
  where id = p_song;
  update public.made_charts set updated_at = now() where song_id = p_song;
  return jsonb_build_object('revision', v_rev, 'saved_at', now());
end;
$$;
revoke execute on function public.chart_save(uuid, text, text, text) from public, anon;
grant execute on function public.chart_save(uuid, text, text, text) to authenticated;

create or replace function public.chart_delete(p_song uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public._own_made_chart(p_song);
  if public._chart_locked(p_song) then
    raise exception 'This chart is waiting for library votes. Withdraw it first.' using errcode = '42501';
  end if;
  delete from public.songs where id = p_song;
end;
$$;
revoke execute on function public.chart_delete(uuid) from public, anon;
grant execute on function public.chart_delete(uuid) to authenticated;

-- ── submit / withdraw ────────────────────────────────────────────────────────
create or replace function public.chart_submit(p_song uuid, p_note text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  s public.songs;
  v_text text;
  v_id uuid;
begin
  s := public._own_made_chart(p_song);
  if public._chart_locked(p_song) then raise exception 'This chart is already waiting for votes.'; end if;
  select r.chart_text into v_text from public.revisions r where r.id = s.current_revision_id;
  if v_text is null then raise exception 'Chart not found.'; end if;
  insert into public.proposals (song_id, base_revision_id, chart_text, note, author_id, kind)
  values (p_song, s.current_revision_id, v_text,
          coalesce(nullif(left(btrim(coalesce(p_note, '')), 500), ''), 'New song for the library'),
          auth.uid(), 'new_song')
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.chart_submit(uuid, text) from public, anon;
grant execute on function public.chart_submit(uuid, text) to authenticated;

create or replace function public.chart_withdraw(p_song uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  select p.id into v_id from public.proposals p
  where p.song_id = p_song and p.kind = 'new_song' and p.status = 'open' and p.author_id = auth.uid();
  if v_id is null then raise exception 'Nothing to withdraw.' using errcode = '42501'; end if;
  perform public.withdraw_proposal(v_id);
end;
$$;
revoke execute on function public.chart_withdraw(uuid) from public, anon;
grant execute on function public.chart_withdraw(uuid) to authenticated;

-- ── proposals: new-song submissions ──────────────────────────────────────────
-- Same as 20261112190000_community_edits.sql, plus: a 'new_song' proposal must be for the
-- author's own private made chart, holds its current text (so "nothing changed" doesn't
-- apply) and is the only open one for that chart.
create or replace function public.check_new_proposal()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  cur uuid;
  open_count int;
begin
  if public.is_blocked(new.author_id) then
    raise exception 'Your account can''t suggest changes right now' using errcode = '42501';
  end if;
  new.note := btrim(coalesce(new.note, ''));
  if char_length(new.note) < 3 then
    raise exception 'Add a short note saying what you changed';
  end if;
  if public.chart_has_long_cue(new.chart_text) then
    raise exception 'A cue is longer than 6 words. Cues only, never lyrics.';
  end if;
  select current_revision_id into cur from public.songs where id = new.song_id;
  if new.base_revision_id is null then
    new.base_revision_id := cur;
  elsif new.base_revision_id is distinct from cur then
    raise exception 'The chart changed while you were editing. Reload to start from the newest version.'
      using hint = 'stale';
  end if;
  if new.kind = 'new_song' then
    if not exists (
      select 1 from public.songs s join public.made_charts m on m.song_id = s.id
      where s.id = new.song_id and s.status = 'private' and s.owner_id = new.author_id
    ) then
      raise exception 'Only your own charts can be sent to the library' using errcode = '42501';
    end if;
    if not exists (select 1 from public.revisions r where r.id = cur and r.chart_text = new.chart_text) then
      raise exception 'The chart changed while you were sending it. Try again.' using hint = 'stale';
    end if;
    if public._chart_locked(new.song_id) then
      raise exception 'This chart is already waiting for votes.';
    end if;
  elsif exists (select 1 from public.revisions r where r.id = cur and r.chart_text = new.chart_text) then
    raise exception 'Nothing changed yet. Edit the chart first.';
  end if;
  -- Serialise this author's inserts so two at once can't slip past the limit.
  perform pg_advisory_xact_lock(hashtext('proposals:' || new.author_id::text));
  select count(*) into open_count from public.proposals where author_id = new.author_id and status = 'open';
  if open_count >= public.app_setting('max_open_proposals') then
    raise exception 'You already have % open suggestions. Wait for votes or withdraw one.', open_count;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- A submission's text is what people vote on; the author withdraws to change it.
-- Same as 20261112190000_community_edits.sql plus the new_song refusal.
create or replace function public.update_proposal(p_id uuid, p_chart text, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.proposals%rowtype;
  cur uuid;
begin
  select * into p from public.proposals where id = p_id for update;
  if not found or p.author_id is distinct from auth.uid() then
    raise exception 'Only the author can update this suggestion' using errcode = '42501';
  end if;
  if p.status <> 'open' then
    raise exception 'This suggestion is already closed';
  end if;
  if p.kind = 'new_song' then
    raise exception 'Withdraw this chart to change it, then send it again.' using errcode = '42501';
  end if;
  if public.is_blocked(auth.uid()) then
    raise exception 'Your account can''t suggest changes right now' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Add a short note saying what you changed';
  end if;
  if p_chart is null or char_length(p_chart) > 20000 then
    raise exception 'Chart is empty or too long';
  end if;
  if public.chart_has_long_cue(p_chart) then
    raise exception 'A cue is longer than 6 words. Cues only, never lyrics.';
  end if;
  select current_revision_id into cur from public.songs where id = p.song_id for update;
  update public.proposals
    set chart_text = p_chart, note = btrim(p_note), base_revision_id = cur, updated_at = now()
    where id = p_id;
  delete from public.votes where proposal_id = p_id;
  update public.notifications set read_at = now()
    where proposal_id = p_id and kind = 'out_of_date' and read_at is null;
end;
$$;
revoke execute on function public.update_proposal from public, anon;
grant execute on function public.update_proposal to authenticated;

-- Same as 20261118100000_song_rename.sql, except key, time and bpm come from the header only.
-- A chart with no {key:} (made charts may have none) and a key change in its body
-- ({key: B} after a section) kept taking that inline key as the song's key. For every chart
-- that has a header key nothing changes (the header's tag is always the first one).
create or replace function public.publish_chart(
  p_song_id uuid, p_chart text, p_author uuid, p_source public.revision_source, p_note text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  rev_id uuid;
  header text := public.chart_header(p_chart);
  bpm_text text := public.chart_tag(header, 'bpm');
  renamed boolean := exists (select 1 from public.song_renames where song_id = p_song_id);
begin
  insert into public.revisions (song_id, chart_text, author_id, source, note)
  values (p_song_id, p_chart, p_author, p_source, p_note)
  returning id into rev_id;

  update public.songs set
    current_revision_id = rev_id,
    title = case when renamed then title else coalesce(public.chart_tag(p_chart, 'title'), title) end,
    artist = case when renamed then artist else coalesce(public.chart_tag(p_chart, 'artist'), artist) end,
    key = coalesce(public.chart_tag(header, 'key'), key),
    bpm = case when bpm_text ~ '^\d{2,3}$' then bpm_text::int else bpm end,
    time_sig = coalesce(public.chart_tag(header, 'time'), time_sig),
    feel = coalesce(lower(left(public.chart_tag(header, 'feel'), 60)), feel),
    tags = coalesce(public.chart_tags(p_chart), tags),
    updated_at = now()
  where id = p_song_id;

  return rev_id;
end;
$$;
revoke execute on function public.publish_chart from public, anon, authenticated;

-- Same as 20261113200000_verification.sql, plus: a private draft can't be brought back
-- (that would publish text that was never approved).
create or replace function public.revert_song(p_song_id uuid, p_revision_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  src public.revisions%rowtype;
  cur uuid;
  new_rev uuid;
  checked boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can revert' using errcode = '42501';
  end if;
  select * into src from public.revisions where id = p_revision_id and song_id = p_song_id and not private_draft;
  if not found then
    raise exception 'Revision not found for this song';
  end if;
  select current_revision_id into cur from public.songs where id = p_song_id for update;
  if cur = p_revision_id then
    raise exception 'That is already the live version';
  end if;
  checked := exists (
    select 1 from public.verification_log l join public.revisions r on r.id = l.revision_id
    where l.song_id = p_song_id and l.status = 'verified' and r.chart_text = src.chart_text
  ) and coalesce((select status = 'published' and not is_example from public.songs where id = p_song_id), false);
  if checked then
    perform set_config('bb.verifying', '1', true);
  end if;
  new_rev := public.publish_chart(
    p_song_id, src.chart_text, auth.uid(), 'human',
    'Reverted to the version from ' || to_char(src.created_at at time zone 'America/Chicago', 'Mon FMDD, YYYY HH12:MI am')
  );
  if checked then
    perform public._verify_song(p_song_id, 'Reverted to a checked version', false);
    perform set_config('bb.verifying', '', true);
  end if;
  return new_rev;
end;
$$;
revoke execute on function public.revert_song from public, anon;
grant execute on function public.revert_song to authenticated;

-- Approved submission -> library song. Internal (decide_proposal). Returns the new revision:
-- a fresh, public one holding the approved text (the private drafts before it stay private).
create or replace function public._publish_made_chart(p_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  p public.proposals%rowtype;
  s public.songs;
  t text;
  a text;
  base text;
  v_slug text;
  n int := 1;
  v_orig uuid;
begin
  select * into p from public.proposals where id = p_id;
  select * into s from public.songs where id = p.song_id for update;
  if s.status <> 'private' then raise exception 'This chart is already in the library.'; end if;
  t := public._clean_name(s.title);
  a := public._clean_name(s.artist);

  -- Same title + artist already in the library: this becomes a separate version of it.
  select coalesce(o.version_of, o.id) into v_orig from public.songs o
  where o.status = 'published' and o.id <> s.id
    and lower(o.title) = lower(t) and lower(coalesce(o.artist, '')) = lower(coalesce(a, ''))
  order by (o.version_of is null) desc, o.created_at
  limit 1;

  base := trim(both '-' from left(public.slugify(t || ' ' || coalesce(a, '')), 80));
  if base = '' then base := 'song'; end if;
  v_slug := base;
  while exists (select 1 from public.songs where slug = v_slug and id <> s.id)
        or exists (select 1 from public.song_slug_redirects where old_slug = v_slug and song_id <> s.id) loop
    n := n + 1;
    v_slug := base || '-' || n;
  end loop;

  -- The private address keeps working for the creator's setlists and saved copies.
  insert into public.song_slug_redirects (old_slug, song_id) values (s.slug, s.id)
    on conflict (old_slug) do update set song_id = excluded.song_id, created_at = now();
  update public.songs set
    status = 'published', owner_id = null, slug = v_slug,
    version_of = v_orig, version_by = case when v_orig is not null then p.author_id end
  where id = s.id;
  delete from public.made_charts where song_id = s.id;
  return public.publish_chart(s.id, p.chart_text, p.author_id, 'community', p.note);
end;
$$;
revoke all on function public._publish_made_chart(uuid) from public, anon, authenticated;

-- Same as 20261112190000_community_edits.sql, plus the new-song branch.
create or replace function public.decide_proposal(p_id uuid, p_approve boolean, p_by uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.proposals%rowtype;
  cur uuid;
  rev_id uuid;
begin
  select * into p from public.proposals where id = p_id for update;
  if not found or p.status <> 'open' then return; end if;
  select current_revision_id into cur from public.songs where id = p.song_id for update;

  if p_approve and p.base_revision_id is distinct from cur then
    raise exception 'This suggestion is out of date: the chart changed after it was made. The author needs to update it first.'
      using hint = 'stale';
  end if;

  -- Close it first, so the out-of-date notifier skips this one (and a submission unlocks).
  update public.proposals set
    status = case when p_approve then 'approved'::public.proposal_status else 'rejected' end,
    decided_at = now(),
    decided_by = p_by
  where id = p_id;

  if p_approve then
    if p.kind = 'new_song' then
      rev_id := public._publish_made_chart(p.id);
    else
      rev_id := public.publish_chart(p.song_id, p.chart_text, p.author_id, 'community', p.note);
    end if;
    update public.proposals set resulting_revision_id = rev_id where id = p_id;
  end if;

  if p_by is distinct from p.author_id then
    insert into public.notifications (user_id, kind, proposal_id, song_id)
    values (p.author_id, case when p_approve then 'merged' else 'closed' end, p.id, p.song_id);
  end if;
end;
$$;
revoke execute on function public.decide_proposal from public, anon, authenticated;

-- ── reading ──────────────────────────────────────────────────────────────────
-- Charts this player can open from uploads and made charts: their own, plus (admins) every
-- admin's. Same as 20261117110000_admin_shared_uploads.sql plus made / locked / created_at.
create or replace function public.upload_charts_visible()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'slug', s.slug, 'title', s.title, 'artist', s.artist, 'key', s.key,
    'chart_text', r.chart_text, 'mine', s.owner_id = auth.uid(),
    'by', case when s.owner_id = auth.uid() then null else coalesce(p.display_name, 'another admin') end,
    'made', m.song_id is not null,
    'locked', m.song_id is not null and public._chart_locked(s.id),
    'created_at', s.created_at)
    order by s.title), '[]'::jsonb)
  from public.songs s
  join public.revisions r on r.id = s.current_revision_id
  left join public.profiles p on p.id = s.owner_id
  left join public.made_charts m on m.song_id = s.id
  where s.status = 'private'
    and (s.owner_id = auth.uid() or public._admin_sees_upload(s.owner_id));
$$;
revoke execute on function public.upload_charts_visible from public, anon;
grant execute on function public.upload_charts_visible to authenticated;

-- "Version by <name>" for a library song that is another player's version of an existing one.
-- PostgREST computed column: select=...,version_line
create or replace function public.version_line(s public.songs)
returns text
language sql stable security definer set search_path = ''
as $$
  select case when s.status = 'published' and s.version_of is not null then
    'Version by ' || coalesce(
      (select nullif(btrim(p.display_name), '') from public.profiles p where p.id = s.version_by),
      'a player')
  end;
$$;
grant execute on function public.version_line(public.songs) to anon, authenticated;

-- New chart screen: the key of a library song with this exact title + artist, if any.
create or replace function public.library_key(p_title text, p_artist text)
returns text
language sql stable security invoker set search_path = ''
as $$
  select s.key from public.songs s
  where s.status = 'published' and s.key is not null
    and lower(s.title) = lower(public._clean_name(p_title))
    and lower(coalesce(s.artist, '')) = lower(coalesce(public._clean_name(p_artist), ''))
  order by (s.version_of is null) desc, s.created_at
  limit 1;
$$;
grant execute on function public.library_key(text, text) to anon, authenticated;
