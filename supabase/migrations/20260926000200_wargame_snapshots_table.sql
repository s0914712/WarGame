-- Host's periodic reconnect snapshot lives in its own table (not in the
-- realtime publication) so the 30s write doesn't fan out a large
-- postgres_changes payload to every client through wg_rooms.
create table public.wg_room_snapshots (
  room_id uuid primary key references public.wg_rooms(id) on delete cascade,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.wg_room_snapshots enable row level security;

create policy wg_snapshots_select on public.wg_room_snapshots
  for select to authenticated using (wg_private.wg_is_member(room_id));
create policy wg_snapshots_insert on public.wg_room_snapshots
  for insert to authenticated with check (wg_private.wg_is_host(room_id));
create policy wg_snapshots_update on public.wg_room_snapshots
  for update to authenticated
  using (wg_private.wg_is_host(room_id)) with check (wg_private.wg_is_host(room_id));

alter table public.wg_rooms drop column snapshot, drop column snapshot_at;
