-- Verified status. A chart is Verified only when an admin has checked that exact revision
-- against the original. Rules (all enforced here, not in the UI):
--   * Only admins set or clear verification. A trusted reviewer's publish is Unverified.
--   * Verification belongs to one revision. When the live revision changes without an admin
--     verifying it in the same step (community merge, even an admin-approved one; a re-import;
--     a reviewer's edit), the song goes back to Unverified by itself.
--   * An admin revert to a version that was verified before restores Verified.
--   * Example songs sit outside verification (no badge, not in the queue or the counts).
--   * Every change is written to verification_log (who, when, why) for the history page.
-- songs.unverified (the flag the search index, song page and offline copy already read) is
-- kept in step: true = a chart nobody has verified, false = verified or an example.

alter table public.songs
  add column verified_at timestamptz,
  add column verified_by uuid references public.profiles (id) on delete set null,
  add column verified_revision_id uuid references public.revisions (id) on delete set null,
  add column unverified_since timestamptz; -- when a live chart became (or was published) unverified

create table public.verification_log (
  id bigint generated always as identity primary key,
  song_id uuid not null references public.songs (id) on delete cascade,
  revision_id uuid references public.revisions (id) on delete set null,
  status text not null check (status in ('verified', 'unverified')),
  by_id uuid references public.profiles (id) on delete set null,
  reason text not null check (char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
create index verification_log_song on public.verification_log (song_id, created_at);
alter table public.verification_log enable row level security;
revoke all on public.verification_log from anon, authenticated;
grant select on public.verification_log to anon, authenticated;
-- Readable like the revision history: for published songs (admins: any song). Never writable
-- from the API; only the functions and the trigger below add rows.
create policy "read status history of published songs" on public.verification_log
  for select using (
    public.is_admin()
    or exists (select 1 from public.songs s where s.id = song_id and s.status = 'published')
  );

-- Who may set or clear verification: an admin, or the database itself (migrations, the
-- service role). Signed-in players and trusted reviewers never.
create or replace function public.can_verify()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin() or coalesce(auth.role(), 'service_role') = 'service_role';
$$;
revoke execute on function public.can_verify from public, anon, authenticated;

-- One trigger keeps the rules true no matter which function or query touches a song.
create or replace function public.songs_set_verification()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  rev public.revisions;
  why text;
begin
  if tg_op = 'UPDATE' then
    -- The live revision changed and nobody verified the new one in this same update.
    if new.current_revision_id is distinct from old.current_revision_id
       and old.verified_at is not null
       and new.verified_revision_id is not distinct from old.verified_revision_id then
      new.verified_at := null;
      new.verified_by := null;
      new.verified_revision_id := null;
      -- 'bb.verifying' is set by the admin functions that verify right after this change.
      if coalesce(current_setting('bb.verifying', true), '') <> '1' then
        select * into rev from public.revisions where id = new.current_revision_id;
        why := case
          when rev.source = 'community' then 'Community edit merged'
          when rev.note like 'Reverted to %' then 'Reverted to a version that was not checked'
          when rev.source in ('ai', 'import') then 'Chart re-imported'
          else 'Chart edited'
        end;
        insert into public.verification_log (song_id, revision_id, status, by_id, reason)
        values (new.id, new.current_revision_id, 'unverified', auth.uid(), why);
      end if;
    elsif (new.verified_at, new.verified_by, new.verified_revision_id)
          is distinct from (old.verified_at, old.verified_by, old.verified_revision_id)
          and not public.can_verify() then
      raise exception 'Only admins can change verification' using errcode = '42501';
    end if;
  elsif new.verified_at is not null and not public.can_verify() then
    raise exception 'Only admins can change verification' using errcode = '42501';
  end if;

  if new.verified_at is not null then
    if new.is_example then
      raise exception 'Example songs are not verified';
    end if;
    if new.verified_revision_id is distinct from new.current_revision_id then
      raise exception 'A chart is verified at its live revision only';
    end if;
  else
    new.verified_by := null;
    new.verified_revision_id := null;
  end if;

  new.unverified := new.verified_at is null and not new.is_example;

  -- unverified_since: set when a chart goes live unverified or loses its verification.
  if new.status <> 'published' or not new.unverified then
    new.unverified_since := null;
  elsif tg_op = 'INSERT' then
    new.unverified_since := coalesce(new.unverified_since, now());
  elsif old.status = 'published' and old.unverified and old.unverified_since is not null then
    new.unverified_since := coalesce(new.unverified_since, old.unverified_since);
  elsif new.unverified_since is not distinct from old.unverified_since then
    new.unverified_since := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.songs_set_verification from public, anon, authenticated;

-- Named to run before songs_touch (triggers fire in name order), so updated_at sees the result.
create trigger songs_set_verification before insert or update on public.songs
  for each row execute function public.songs_set_verification();

-- ── backfill ────────────────────────────────────────────────────────────────
-- Songs published as verified through the review screen become Verified, by the reviewer
-- the log recorded, provided the live revision is the one they published.
with last_log as (
  select distinct on (l.song_id) l.song_id, l.user_id, l.action, l.created_at
  from public.review_log l
  where l.action in ('verified', 'unverified')
  order by l.song_id, l.created_at desc
)
update public.songs s
set verified_at = ll.created_at, verified_by = ll.user_id, verified_revision_id = s.current_revision_id
from last_log ll, public.revisions r
where ll.song_id = s.id and ll.action = 'verified'
  and s.status = 'published' and not s.is_example
  and r.id = s.current_revision_id and r.created_at <= ll.created_at;

insert into public.verification_log (song_id, revision_id, status, by_id, reason, created_at)
select id, verified_revision_id, 'verified', verified_by, 'Checked against the original', verified_at
from public.songs where verified_at is not null;

-- Everything else is Unverified (examples aside). For charts already live, the time they
-- became unverified is the last time the song changed (no publish time was recorded).
update public.songs set unverified = (verified_at is null and not is_example)
where unverified is distinct from (verified_at is null and not is_example);
update public.songs set unverified_since = updated_at
where status = 'published' and unverified;

-- ── admin actions ───────────────────────────────────────────────────────────
-- Mark the live revision Verified (shared by Publish, "Verify as is", bulk verify, revert).
create or replace function public._verify_song(p_song_id uuid, p_reason text, p_count boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.songs;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select * into s from public.songs where id = p_song_id for update;
  if not found or s.status <> 'published' then
    raise exception 'Only live charts can be verified';
  end if;
  if s.is_example then
    raise exception 'Example songs are not verified';
  end if;
  if public.unclear_count((select chart_text from public.revisions where id = s.current_revision_id)) > 0 then
    raise exception 'Fix or delete every "# UNCLEAR" note before verifying';
  end if;
  update public.songs
  set verified_at = now(), verified_by = auth.uid(), verified_revision_id = s.current_revision_id
  where id = s.id;
  insert into public.verification_log (song_id, revision_id, status, by_id, reason)
  values (s.id, s.current_revision_id, 'verified', auth.uid(), p_reason);
  update public.chart_flags set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
  where song_id = s.id and status = 'open';
  if p_count then
    insert into public.review_log (song_id, user_id, action) values (s.id, auth.uid(), 'verified');
  end if;
end;
$$;
revoke execute on function public._verify_song from public, anon, authenticated;

-- Publish from the review screen. Verified publishing is now admins only; a trusted
-- reviewer publishes as Unverified. Publishing unverified never clears a verification by
-- itself: only a change to the chart does (the trigger).
create or replace function public.review_publish(p_song_id uuid, p_chart text, p_verified boolean, p_base_revision uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  s public.songs;
  cur text;
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  if p_verified and not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  perform public.review_take(p_song_id);
  select * into s from public.songs where id = p_song_id for update;
  if not found or s.status not in ('needs_review', 'published', 'imported') then
    raise exception 'Song not found or not reviewable';
  end if;
  if s.current_revision_id is distinct from p_base_revision then
    raise exception 'This chart changed since you opened it. Reload and check again.';
  end if;
  if p_chart is null or char_length(p_chart) > 20000 or btrim(p_chart) = '' then
    raise exception 'Chart is empty or too long';
  end if;
  if public.chart_has_long_cue(p_chart) then
    raise exception 'A cue is over 6 words (lyrics aren''t allowed)';
  end if;
  if p_verified and public.unclear_count(p_chart) > 0 then
    raise exception 'Fix or delete every "# UNCLEAR" note before publishing as verified';
  end if;
  if p_verified and s.is_example then
    raise exception 'Example songs are not verified';
  end if;

  if p_verified then
    perform set_config('bb.verifying', '1', true);
  end if;
  select chart_text into cur from public.revisions where id = s.current_revision_id;
  if cur is distinct from p_chart then
    perform public.publish_chart(s.id, p_chart, auth.uid(), 'human',
      case when p_verified then 'Checked against the original' else 'Reviewed' end);
  end if;
  update public.songs set status = 'published', review_hold = false, updated_at = now()
  where id = s.id;
  update public.import_files set status = 'done', updated_at = now()
  where song_id = s.id and status in ('needs_review', 'needs_manual');
  if p_verified then
    perform public._verify_song(s.id, 'Checked against the original', true);
    perform set_config('bb.verifying', '', true);
  else
    insert into public.review_log (song_id, user_id, action) values (s.id, auth.uid(), 'unverified');
  end if;
  delete from public.review_drafts where song_id = s.id;
  delete from public.review_claims where song_id = s.id;
  return case when p_verified then 'verified' else 'unverified' end;
end;
$$;
revoke execute on function public.review_publish from public, anon;
grant execute on function public.review_publish to authenticated;

-- "Verify as is": the live chart is right as it stands.
create or replace function public.review_verify(p_song_id uuid, p_base_revision uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  perform public.review_take(p_song_id);
  if (select current_revision_id from public.songs where id = p_song_id) is distinct from p_base_revision then
    raise exception 'This chart changed since you opened it. Reload and check again.';
  end if;
  perform public._verify_song(p_song_id, 'Checked against the original', true);
  delete from public.review_claims where song_id = p_song_id;
end;
$$;
revoke execute on function public.review_verify from public, anon;
grant execute on function public.review_verify to authenticated;

-- "Mark unverified": undo a mistake. p_reason: mistake | original_changed | other.
create or replace function public.review_unverify(p_song_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.songs;
  why text := case p_reason
    when 'mistake' then 'Verified by mistake'
    when 'original_changed' then 'Original changed'
    when 'other' then 'Marked unverified by an admin'
  end;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if why is null then
    raise exception 'Pick a reason';
  end if;
  select * into s from public.songs where id = p_song_id for update;
  if not found or s.verified_at is null then
    raise exception 'This chart is not verified';
  end if;
  update public.songs set verified_at = null, verified_by = null, verified_revision_id = null where id = s.id;
  insert into public.verification_log (song_id, revision_id, status, by_id, reason)
  values (s.id, s.current_revision_id, 'unverified', auth.uid(), why);
  delete from public.review_claims where song_id = s.id and user_id = auth.uid();
end;
$$;
revoke execute on function public.review_unverify from public, anon;
grant execute on function public.review_unverify to authenticated;

-- Bulk verify: up to 20 charts in one tap. p_items = [{id, revision_id}] exactly as shown on
-- the bulk screen, so a chart that changed since it was shown is skipped, as are charts
-- someone else is reviewing, charts with unclear notes, and anything not live.
-- Returns {verified: n, skipped: [{id, why}]}. Each one is logged like a single verify.
create or replace function public.review_bulk_verify(p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  it jsonb;
  sid uuid;
  s public.songs;
  n int := 0;
  skipped jsonb := '[]';
  why text;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Pick at least one chart';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'Verify at most 20 charts at a time';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    sid := (it->>'id')::uuid;
    select * into s from public.songs where id = sid for update;
    why := case
      when not found then 'not found'
      when s.status <> 'published' or s.is_example then 'not a live chart'
      when s.verified_at is not null then 'already verified'
      when s.current_revision_id is distinct from (it->>'revision_id')::uuid then 'changed since it was shown'
      when exists (select 1 from public.review_claims c
                   where c.song_id = sid and c.expires_at > now() and c.user_id <> auth.uid()) then 'someone is reviewing it'
      when public.unclear_count((select chart_text from public.revisions where id = s.current_revision_id)) > 0 then 'has unclear notes'
    end;
    if why is not null then
      skipped := skipped || jsonb_build_object('id', sid, 'why', why);
    else
      perform public._verify_song(sid, 'Checked against the original (bulk)', true);
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('verified', n, 'skipped', skipped);
end;
$$;
revoke execute on function public.review_bulk_verify from public, anon;
grant execute on function public.review_bulk_verify to authenticated;

-- The bulk screen's cards: unverified live charts, longest-unverified first, each with its
-- chart text and the PDF to check it against.
create or replace function public.review_bulk_cards(p_limit int, p_offset int)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.songs where status = 'published' and unverified),
    'cards', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.unverified_since, x.title)
      from (
        select s.id, s.slug, s.title, s.artist, s.unverified_since, s.current_revision_id revision_id,
               v.chart_text, public.unclear_count(v.chart_text) unclear,
               (select f.id from public.import_files f where f.song_id = s.id and not f.missing
                order by f.updated_at desc limit 1) file_id,
               exists (select 1 from public.review_claims c
                       where c.song_id = s.id and c.expires_at > now() and c.user_id <> auth.uid()) claimed
        from public.songs s join public.revisions v on v.id = s.current_revision_id
        where s.status = 'published' and s.unverified
        order by s.unverified_since, s.title
        limit least(greatest(coalesce(p_limit, 20), 1), 20) offset greatest(coalesce(p_offset, 0), 0)
      ) x), '[]'));
end;
$$;
revoke execute on function public.review_bulk_cards from public, anon;
grant execute on function public.review_bulk_cards to authenticated;

-- Admin revert: a version that was verified before comes back Verified; any other version
-- is Unverified (the trigger logs that).
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
  select * into src from public.revisions where id = p_revision_id and song_id = p_song_id;
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

-- ── queue ───────────────────────────────────────────────────────────────────
-- Two more filters: 'unverified' (live, nobody has verified it) and 'verified'.
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
           s.verified_at,
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
    when 'unverified' then b.status = 'published' and b.unverified
    when 'verified' then b.status = 'published' and b.verified_at is not null
    else (b.status = 'needs_review' and coalesce(b.file_status, '') <> 'needs_manual')
         or (b.status = 'published' and b.flags >= (select n from alert))
  end;
$$;
revoke execute on function public.review_items from public, anon, authenticated;

create or replace function public.review_list(p_filter text, p_order text, p_q text, p_limit int, p_offset int)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  q text := nullif(trim(coalesce(p_q, '')), '');
  result jsonb;
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  with items as (
    select * from public.review_items(p_filter) i
    where q is null or i.title ilike '%' || q || '%' or i.artist ilike '%' || q || '%'
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'unverified', (select count(*) from public.songs where status = 'published' and unverified),
      'verified', (select count(*) from public.songs where status = 'published' and verified_at is not null),
      'needs_review', (select count(*) from public.review_items('needs_review')),
      'needs_manual', (select count(*) from public.review_items('needs_manual')),
      'duplicates', (select count(*) from public.review_items('duplicates')),
      'manual_files_without_song', (select count(*) from public.import_files
                                    where status = 'needs_manual' and song_id is null and not missing)),
    'matches', (select count(*) from items),
    'songs', coalesce((
      select jsonb_agg((to_jsonb(x) - 'ord' - 'claimed_by') || jsonb_build_object('claimed_by_me', x.claimed_by = auth.uid()))
      from (
        select *, row_number() over (
          order by flagged desc, review_hold,
                   public.review_order_key(p_order, confidence),
                   case when p_order = 'artist' then lower(coalesce(artist, '')) end,
                   lower(title), id) ord
        from items
        order by ord
        limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
      ) x), '[]')
  ) into result;
  return result;
end;
$$;
revoke execute on function public.review_list from public, anon;
grant execute on function public.review_list to authenticated;

-- Progress: Verified out of every Dropbox chart, what is live but unverified, what is still
-- waiting for review, how many each admin verified (all-time and today, Nashville time),
-- and the five charts that have been live and unverified the longest.
create or replace function public.review_progress()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  result jsonb;
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'total', (select count(*) from public.import_files where not missing),
    'verified', (select count(*) from public.songs where status = 'published' and dropbox_path is not null and verified_at is not null),
    'unverified', (select count(*) from public.songs where status = 'published' and unverified),
    'waiting', (select count(*) from public.songs where status in ('needs_review', 'imported')),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'total', x.total, 'today', x.today, 'me', x.me)
                       order by x.total desc, x.name)
      from (
        select coalesce(nullif(p.display_name, ''), 'Unnamed') name, count(*) total,
               count(*) filter (where (l.created_at at time zone 'America/Chicago')::date = today) today,
               l.user_id = auth.uid() me
        from public.review_log l join public.profiles p on p.id = l.user_id
        where l.action = 'verified'
        group by l.user_id, p.display_name
      ) x), '[]'),
    'oldest', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'artist', o.artist, 'since', o.unverified_since)
                       order by o.unverified_since, o.title)
      from (
        select id, title, artist, unverified_since from public.songs
        where status = 'published' and unverified
        order by unverified_since, title limit 5
      ) o), '[]')
  ) into result;
  return result;
end;
$$;
revoke execute on function public.review_progress from public, anon;
grant execute on function public.review_progress to authenticated;

-- One song for the review screen: now also says whether it is verified, when, by whom,
-- and whether it is an example (examples can't be verified).
create or replace function public.review_song(p_song_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  admin boolean := public.is_admin();
  f public.import_files;
  result jsonb;
begin
  if not public.can_review() then
    raise exception 'reviewers only' using errcode = '42501';
  end if;
  select * into f from public.import_files where song_id = p_song_id
  order by missing, updated_at desc limit 1;
  select jsonb_build_object(
    'id', s.id, 'slug', s.slug, 'title', s.title, 'artist', s.artist, 'status', s.status,
    'unverified', s.unverified, 'review_hold', s.review_hold,
    'verified_at', s.verified_at, 'is_example', s.is_example,
    'verified_by', (select coalesce(nullif(display_name, ''), 'an admin') from public.profiles where id = s.verified_by),
    'revision_id', s.current_revision_id, 'chart_text', v.chart_text, 'source', v.source,
    'confidence', v.ai_confidence, 'notes', v.ai_raw->>'notes',
    'import_file_id', f.id, 'file_status', f.status, 'file_name', f.file_name,
    'is_admin', admin,
    'draft', (select jsonb_build_object('chart_text', d.chart_text, 'base_revision_id', d.base_revision_id,
                                        'updated_at', d.updated_at,
                                        'by', coalesce(nullif(p.display_name, ''), 'a reviewer'))
              from public.review_drafts d left join public.profiles p on p.id = d.updated_by
              where d.song_id = s.id),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object('reason', fl.reason, 'details', fl.details, 'created_at', fl.created_at,
                                          'by', case when admin then p.display_name end) order by fl.created_at)
      from public.chart_flags fl left join public.profiles p on p.id = fl.reporter_id
      where fl.song_id = s.id and fl.status = 'open'), '[]'),
    'duplicates', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'artist', o.artist, 'status', o.status,
                                          'file_name', df.file_name) order by df.file_name)
      from public.import_files df join public.songs o on o.id = df.song_id
      where f.title is not null and f.artist is not null and not df.missing
        and lower(df.title) = lower(f.title) and lower(df.artist) = lower(f.artist)
        and o.id <> s.id and o.status <> 'archived'), '[]')
  ) into result
  from public.songs s
  left join public.revisions v on v.id = s.current_revision_id
  where s.id = p_song_id;
  if result is null then
    raise exception 'Song not found';
  end if;
  return result;
end;
$$;
revoke execute on function public.review_song from public, anon;
grant execute on function public.review_song to authenticated;

-- ── offline copy ────────────────────────────────────────────────────────────
-- The phone's saved chart also carries when it was verified, so the badge works with no signal.
create or replace function public.offline_sync(p_since timestamptz default null, p_after text default '', p_limit int default 400)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with pub as (
    select s.id, s.slug, s.title, s.artist, s.key, s.is_example, s.unverified, s.verified_at, s.updated_at, r.chart_text
    from public.songs s
    join public.revisions r on r.id = s.current_revision_id
    where s.status = 'published'
  )
  select jsonb_build_object(
    'now', now(),
    'total', (select count(*) from pub),
    'slugs', case when coalesce(p_after, '') = ''
      then (select coalesce(jsonb_agg(p.slug order by p.slug collate "C"), '[]'::jsonb) from pub p) end,
    'songs', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.slug collate "C"), '[]'::jsonb)
      from (
        select * from pub p
        where p.slug collate "C" > coalesce(p_after, '') collate "C"
          and (p_since is null or p.updated_at > p_since)
        order by p.slug collate "C"
        limit least(greatest(coalesce(p_limit, 400), 1), 500)
      ) x
    )
  )
$$;

-- updated_at must also move when only the verified date changes (same revision, verified
-- again), so phones pick up the new date.
create or replace function public.songs_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.slug, new.title, new.artist, new.key, new.bpm, new.time_sig, new.feel, new.tags,
      new.status, new.is_example, new.unverified, new.verified_at, new.current_revision_id)
     is distinct from
     (old.slug, old.title, old.artist, old.key, old.bpm, old.time_sig, old.feel, old.tags,
      old.status, old.is_example, old.unverified, old.verified_at, old.current_revision_id) then
    new.updated_at := now();
  end if;
  return new;
end $$;
