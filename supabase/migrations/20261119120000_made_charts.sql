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
--   (withdraw_proposal / chart_withdraw) or a close unlocks it; it stays private.
-- * Approved: the same song row becomes a library song, live as Unverified (the verification
--   trigger sees to that), with a public slug; the private slug redirects. The made_charts row
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
revoke all on function public._chart_locked(uuid) from public;
grant execute on function public._chart_locked(uuid) to anon, authenticated;

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

-- ── lock: refuse every change while a chart waits for votes ──────────────────
create or replace function public.made_lock_revisions()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public._chart_locked(new.song_id) then
    raise exception 'This chart is waiting for library votes. Withdraw it to make changes.' using errcode = '42501';
  end if;
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

-- Signed-in players can read the song row (title, artist) of a chart waiting for their
-- vote, so Community can list it. Its chart text is in the proposal; its revisions stay private.
create policy "signed-in read submitted charts" on public.songs
  for select to authenticated using (status = 'private' and public._chart_locked(id));

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

-- Approved submission -> library song. Internal (decide_proposal). Returns the new revision.
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
