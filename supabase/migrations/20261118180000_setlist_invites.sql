-- Send a copy of a setlist to another player (Q8).
--
-- * The owner makes an invite link (setlist_invite_create). One recipient: the first player
--   who accepts uses it up. Links expire after 7 days and the owner can turn one off.
-- * Opening the link signed in records it as waiting for that player (setlist_invite_open), so
--   it shows as an Accept/Decline card on /setlists and a badge on Setlists until answered.
-- * Accept (setlist_invite_accept) makes a full, independent copy for the recipient: name, gig
--   date, song order, per-song key overrides and notes, marked "Copied from <sender> on <date>".
--   Nothing links the two afterwards. Private (uploaded) charts keep their place but show as
--   "Private song, not shared" (setlist_bundle / _setlist_song already hide them).
-- * The preview shows only the setlist name, the sender's display name and the song count:
--   never song titles, so nothing private leaks before or after accepting.
-- * The existing view-only share link (share_code) is unchanged.

alter table public.setlists
  add column copied_from_name text check (copied_from_name is null or char_length(copied_from_name) <= 100),
  add column copied_at timestamptz;

create table public.setlist_invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9_-]{16,}$'),
  setlist_id uuid not null references public.setlists (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  copy_id uuid references public.setlists (id) on delete set null
);
create index setlist_invites_setlist on public.setlist_invites (setlist_id, created_at desc);

create table public.setlist_invite_seen (
  invite_id uuid not null references public.setlist_invites (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now(),
  declined_at timestamptz,
  primary key (invite_id, user_id)
);
create index setlist_invite_seen_user on public.setlist_invite_seen (user_id) where declined_at is null;

-- Everything goes through the functions below.
alter table public.setlist_invites enable row level security;
alter table public.setlist_invite_seen enable row level security;
revoke all on public.setlist_invites, public.setlist_invite_seen from anon, authenticated;

-- open | used | expired | off
create or replace function public._invite_state(i public.setlist_invites) returns text
language sql stable set search_path = '' as $$
  select case
    when i.accepted_at is not null then 'used'
    when i.revoked_at is not null then 'off'
    when i.expires_at <= now() then 'expired'
    else 'open'
  end
$$;
revoke all on function public._invite_state(public.setlist_invites) from public, anon, authenticated;

-- Owner: how many songs in this setlist other players can't see (uploaded private charts).
create or replace function public.setlist_private_count(p_setlist uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from public.setlist_items i
  join public.setlists l on l.id = i.setlist_id and l.owner_id = (select auth.uid())
  join public.songs s on s.id = i.song_id
  where i.setlist_id = p_setlist and s.status <> 'published'
$$;
revoke all on function public.setlist_private_count(uuid) from public, anon;
grant execute on function public.setlist_private_count(uuid) to authenticated;

-- Owner: a new invite link for one recipient. Returns the code.
create or replace function public.setlist_invite_create(p_setlist uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c text;
  n int;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.setlists where id = p_setlist and owner_id = me) then
    raise exception 'Setlist not found' using errcode = 'no_data_found';
  end if;
  select count(*) into n from public.setlist_invites
    where sender_id = me and created_at > now() - interval '1 day';
  if n >= 50 then raise exception 'That''s a lot of links today. Try again tomorrow.'; end if;
  c := translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/=', '-_');
  insert into public.setlist_invites (code, setlist_id, sender_id) values (c, p_setlist, me);
  return c;
end $$;
revoke all on function public.setlist_invite_create(uuid) from public, anon;
grant execute on function public.setlist_invite_create(uuid) to authenticated;

-- Owner: this setlist's links, newest first, with who accepted.
create or replace function public.setlist_invites_for(p_setlist uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'code', i.code, 'created_at', i.created_at, 'expires_at', i.expires_at,
    'state', public._invite_state(i), 'accepted_at', i.accepted_at,
    'accepted_name', case when i.accepted_by is not null then coalesce(nullif(p.display_name, ''), 'A player') end
  ) order by i.created_at desc), '[]'::jsonb)
  from public.setlist_invites i
  join public.setlists l on l.id = i.setlist_id and l.owner_id = (select auth.uid())
  left join public.profiles p on p.id = i.accepted_by
  where i.setlist_id = p_setlist
$$;
revoke all on function public.setlist_invites_for(uuid) from public, anon;
grant execute on function public.setlist_invites_for(uuid) to authenticated;

-- Owner: turn a link off (stops new accepts; a copy already made stays with its recipient).
create or replace function public.setlist_invite_revoke(p_invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.setlist_invites set revoked_at = now()
    where id = p_invite and sender_id = auth.uid() and revoked_at is null and accepted_at is null;
  if not found then raise exception 'Link not found or already used' using errcode = 'no_data_found'; end if;
end $$;
revoke all on function public.setlist_invite_revoke(uuid) from public, anon;
grant execute on function public.setlist_invite_revoke(uuid) to authenticated;

-- Recipient: open a link. Records it as waiting for this player (when it can still be
-- accepted) and returns what the card shows. Never song titles.
create or replace function public.setlist_invite_open(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  i public.setlist_invites;
  st text;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into i from public.setlist_invites where code = p_code;
  if not found then return jsonb_build_object('state', 'missing'); end if;
  st := public._invite_state(i);
  if i.sender_id = me then st := 'yours'; end if;
  if st = 'used' and i.accepted_by = me then st := 'accepted'; end if;
  if st = 'open' then
    insert into public.setlist_invite_seen (invite_id, user_id) values (i.id, me)
      on conflict (invite_id, user_id) do nothing;
  end if;
  return (
    select jsonb_build_object(
      'state', st, 'code', i.code,
      'name', l.name,
      'sender', coalesce(nullif(p.display_name, ''), 'A player'),
      'count', (select count(*) from public.setlist_items x where x.setlist_id = l.id),
      'expires_at', i.expires_at,
      'copy_id', case when i.accepted_by = me then i.copy_id end)
    from public.setlists l left join public.profiles p on p.id = i.sender_id
    where l.id = i.setlist_id);
end $$;
revoke all on function public.setlist_invite_open(text) from public, anon;
grant execute on function public.setlist_invite_open(text) to authenticated;

-- Recipient: links opened but not answered yet, still open (the /setlists cards + badge).
create or replace function public.setlist_invites_waiting() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', i.code, 'name', l.name,
    'sender', coalesce(nullif(p.display_name, ''), 'A player'),
    'count', (select count(*) from public.setlist_items x where x.setlist_id = l.id),
    'expires_at', i.expires_at
  ) order by s.seen_at desc), '[]'::jsonb)
  from public.setlist_invite_seen s
  join public.setlist_invites i on i.id = s.invite_id
  join public.setlists l on l.id = i.setlist_id
  left join public.profiles p on p.id = i.sender_id
  where s.user_id = (select auth.uid()) and s.declined_at is null
    and public._invite_state(i) = 'open' and i.sender_id <> s.user_id
$$;
revoke all on function public.setlist_invites_waiting() from public, anon;
grant execute on function public.setlist_invites_waiting() to authenticated;

-- Recipient: decline (the card goes away; the link stays usable by someone else).
create or replace function public.setlist_invite_decline(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.setlist_invite_seen s set declined_at = now()
    from public.setlist_invites i
    where i.code = p_code and s.invite_id = i.id and s.user_id = auth.uid();
end $$;
revoke all on function public.setlist_invite_decline(text) from public, anon;
grant execute on function public.setlist_invite_decline(text) to authenticated;

-- Recipient: accept. Makes the independent copy and uses the link up. Returns the copy's id.
create or replace function public.setlist_invite_accept(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  i public.setlist_invites;
  src public.setlists;
  sender_name text;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if public.is_blocked(me) then raise exception 'Your account can''t do that right now' using errcode = '42501'; end if;
  select * into i from public.setlist_invites where code = p_code for update;
  if not found then raise exception 'This link doesn''t exist' using errcode = 'no_data_found'; end if;
  if i.sender_id = me then raise exception 'This is your own setlist'; end if;
  case public._invite_state(i)
    when 'used' then raise exception 'This link was already used';
    when 'off' then raise exception 'The sender turned this link off';
    when 'expired' then raise exception 'This link has expired. Ask for a new one.';
    else null;
  end case;
  select * into src from public.setlists where id = i.setlist_id;
  select coalesce(nullif(display_name, ''), 'A player') into sender_name from public.profiles where id = i.sender_id;

  insert into public.setlists (owner_id, name, gig_date, copied_from_name, copied_at)
  values (me, src.name, src.gig_date, left(sender_name, 100), now())
  returning id into new_id;
  insert into public.setlist_items (setlist_id, song_id, position, key_override, note)
  select new_id, x.song_id, x.position, x.key_override, x.note
  from public.setlist_items x where x.setlist_id = src.id order by x.position;

  update public.setlist_invites set accepted_by = me, accepted_at = now(), copy_id = new_id where id = i.id;
  insert into public.setlist_invite_seen (invite_id, user_id) values (i.id, me)
    on conflict (invite_id, user_id) do nothing;
  return new_id;
end $$;
revoke all on function public.setlist_invite_accept(text) from public, anon;
grant execute on function public.setlist_invite_accept(text) to authenticated;

-- setlist_bundle (20261113100000) plus "copied from" for the owner's copy.
create or replace function public.setlist_bundle(p_id uuid default null, p_code text default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', case when l.owner_id = (select auth.uid()) then l.id end,
    'name', l.name,
    'gig_date', l.gig_date,
    'updated_at', l.updated_at,
    'share_code', case when l.owner_id = (select auth.uid()) then l.share_code end,
    'mine', l.owner_id is not distinct from (select auth.uid()),
    'copied_from', case when l.owner_id = (select auth.uid()) then l.copied_from_name end,
    'copied_at', case when l.owner_id = (select auth.uid()) then l.copied_at end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'song_id', i.song_id, 'key_override', i.key_override, 'note', i.note,
        'song', public._setlist_song(i.song_id)) order by i.position)
      from public.setlist_items i where i.setlist_id = l.id), '[]'::jsonb))
  from public.setlists l
  where (p_id is not null and l.id = p_id and l.owner_id = (select auth.uid()))
     or (p_code is not null and p_id is null and l.share_code is not null and l.share_code = p_code)
$$;
