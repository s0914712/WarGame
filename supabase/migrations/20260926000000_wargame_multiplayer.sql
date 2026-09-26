-- Wargame multiplayer (host-authoritative)
-- Applied to project fyvaqwqnwgfutwfaaeei. All objects prefixed wg_ — the
-- project hosts other apps' tables; do not touch those.
--
-- Realtime topics:
--   wg:room:<room_id>:state    — host broadcasts snapshots (only host may send)
--   wg:room:<room_id>:presence — every member tracks presence
-- Commands go through the wg_commands table (RLS authenticates the issuer),
-- not broadcast, because broadcast payloads cannot prove who sent them.

-- ── Tables ─────────────────────────────────────────────────────────

create table public.wg_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.wg_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  scenario_id text not null,
  status text not null default 'lobby' check (status in ('lobby', 'running', 'ended')),
  snapshot jsonb,
  snapshot_at timestamptz,
  created_at timestamptz not null default now()
);
create index wg_rooms_host_idx on public.wg_rooms(host_user_id);

create table public.wg_room_players (
  room_id uuid not null references public.wg_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  side_id text check (side_id in ('blue', 'red', 'neutral', 'us', 'japan')),
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create unique index wg_room_players_side_uniq
  on public.wg_room_players(room_id, side_id) where side_id is not null;
create index wg_room_players_user_idx on public.wg_room_players(user_id);

create table public.wg_commands (
  id bigserial primary key,
  room_id uuid not null references public.wg_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  side_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index wg_commands_room_idx on public.wg_commands(room_id, id);
create index wg_commands_user_idx on public.wg_commands(user_id);

create table public.wg_match_results (
  room_id uuid primary key references public.wg_rooms(id) on delete cascade,
  scenario_id text not null,
  outcome jsonb not null,
  players jsonb not null,
  ended_at timestamptz not null default now()
);

-- ── Helpers (security definer → avoid RLS recursion) ─────────────────

create or replace function public.wg_is_member(p_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wg_room_players
    where room_id = p_room and user_id = (select auth.uid())
  );
$$;

create or replace function public.wg_is_host(p_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wg_rooms
    where id = p_room and host_user_id = (select auth.uid())
  );
$$;

create or replace function public.wg_room_status(p_room uuid)
returns text language sql stable security definer set search_path = '' as $$
  select status from public.wg_rooms where id = p_room;
$$;

-- Parse "wg:room:<uuid>:<kind>" → uuid (null if not a wargame topic)
create or replace function public.wg_topic_room(p_topic text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  if p_topic ~ '^wg:room:[0-9a-f-]{36}:(state|presence)$' then
    return split_part(p_topic, ':', 3)::uuid;
  end if;
  return null;
end;
$$;

-- ── Profile auto-create ─────────────────────────────────────────────

create or replace function public.wg_handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.wg_profiles (user_id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(coalesce(new.email, 'player'), '@', 1)
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger wg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.wg_handle_new_user();

-- ── RPCs ───────────────────────────────────────────────────────────

-- Create a room with a random 6-char code; caller becomes host + first player.
create or replace function public.wg_create_room(p_scenario_id text)
returns public.wg_rooms language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_room public.wg_rooms;
  v_code text;
  i int := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select display_name into v_name from public.wg_profiles where user_id = v_uid;
  loop
    v_code := upper(substr(translate(encode(extensions.gen_random_bytes(6), 'base64'), '+/=0O1I', ''), 1, 6));
    begin
      insert into public.wg_rooms (code, host_user_id, scenario_id)
      values (v_code, v_uid, p_scenario_id)
      returning * into v_room;
      exit;
    exception when unique_violation then
      i := i + 1;
      if i > 10 then raise; end if;
    end;
  end loop;
  insert into public.wg_room_players (room_id, user_id, display_name)
  values (v_room.id, v_uid, coalesce(v_name, 'host'));
  return v_room;
end;
$$;

-- Join by code. Lobby → joins as spectator (side null). Running → rejoin only
-- if already a member (reconnect).
create or replace function public.wg_join_room(p_code text)
returns public.wg_rooms language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_room public.wg_rooms;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.wg_rooms where code = upper(trim(p_code));
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.status = 'ended' then raise exception 'room ended'; end if;
  if exists (select 1 from public.wg_room_players where room_id = v_room.id and user_id = v_uid) then
    return v_room;
  end if;
  select display_name into v_name from public.wg_profiles where user_id = v_uid;
  -- Late joiners (running) enter as spectators
  insert into public.wg_room_players (room_id, user_id, display_name)
  values (v_room.id, v_uid, coalesce(v_name, 'player'));
  return v_room;
end;
$$;

revoke execute on function public.wg_create_room(text) from public, anon;
revoke execute on function public.wg_join_room(text) from public, anon;
grant execute on function public.wg_create_room(text) to authenticated;
grant execute on function public.wg_join_room(text) to authenticated;

-- ── RLS ────────────────────────────────────────────────────────────

alter table public.wg_profiles enable row level security;
alter table public.wg_rooms enable row level security;
alter table public.wg_room_players enable row level security;
alter table public.wg_commands enable row level security;
alter table public.wg_match_results enable row level security;

-- profiles
create policy wg_profiles_select on public.wg_profiles
  for select to authenticated using (true);
create policy wg_profiles_update on public.wg_profiles
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- rooms: members read; host updates (insert only via wg_create_room)
create policy wg_rooms_select on public.wg_rooms
  for select to authenticated using (public.wg_is_member(id));
create policy wg_rooms_update on public.wg_rooms
  for update to authenticated
  using (host_user_id = (select auth.uid()))
  with check (host_user_id = (select auth.uid()));
create policy wg_rooms_delete on public.wg_rooms
  for delete to authenticated using (host_user_id = (select auth.uid()));

-- room players
create policy wg_players_select on public.wg_room_players
  for select to authenticated using (public.wg_is_member(room_id));
-- claim side / ready: own row, lobby only
create policy wg_players_update on public.wg_room_players
  for update to authenticated
  using (user_id = (select auth.uid()) and public.wg_room_status(room_id) = 'lobby')
  with check (user_id = (select auth.uid()) and public.wg_room_status(room_id) = 'lobby');
-- leave (self) or kick (host)
create policy wg_players_delete on public.wg_room_players
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.wg_is_host(room_id));

-- commands: only for the side you hold, only while running
create policy wg_commands_select on public.wg_commands
  for select to authenticated using (public.wg_is_member(room_id));
create policy wg_commands_insert on public.wg_commands
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.wg_room_status(room_id) = 'running'
    and exists (
      select 1 from public.wg_room_players p
      where p.room_id = wg_commands.room_id
        and p.user_id = (select auth.uid())
        and p.side_id = wg_commands.side_id
    )
  );

-- match results
create policy wg_results_select on public.wg_match_results
  for select to authenticated using (public.wg_is_member(room_id));
create policy wg_results_insert on public.wg_match_results
  for insert to authenticated with check (public.wg_is_host(room_id));

-- ── Realtime ───────────────────────────────────────────────────────

alter publication supabase_realtime add table public.wg_commands;
alter publication supabase_realtime add table public.wg_room_players;
alter publication supabase_realtime add table public.wg_rooms;

-- Receive: any member, on either wargame topic
create policy wg_realtime_receive on realtime.messages
  for select to authenticated
  using (
    public.wg_topic_room(realtime.topic()) is not null
    and public.wg_is_member(public.wg_topic_room(realtime.topic()))
  );

-- Send: presence → any member; state → host only
create policy wg_realtime_send on realtime.messages
  for insert to authenticated
  with check (
    public.wg_topic_room(realtime.topic()) is not null
    and (
      (realtime.topic() like '%:presence' and public.wg_is_member(public.wg_topic_room(realtime.topic())))
      or
      (realtime.topic() like '%:state' and public.wg_is_host(public.wg_topic_room(realtime.topic())))
    )
  );
