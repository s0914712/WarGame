-- Move RLS helper functions out of the exposed `public` API schema
-- (advisor lints 0028/0029). Policies keep working: ALTER FUNCTION SET SCHEMA
-- keeps the same function OID the policies reference.
create schema if not exists wg_private;
grant usage on schema wg_private to authenticated;

alter function public.wg_is_member(uuid) set schema wg_private;
alter function public.wg_is_host(uuid) set schema wg_private;
alter function public.wg_room_status(uuid) set schema wg_private;
alter function public.wg_topic_room(text) set schema wg_private;
alter function public.wg_handle_new_user() set schema wg_private;

revoke execute on all functions in schema wg_private from public, anon;
grant execute on function wg_private.wg_is_member(uuid) to authenticated;
grant execute on function wg_private.wg_is_host(uuid) to authenticated;
grant execute on function wg_private.wg_room_status(uuid) to authenticated;
grant execute on function wg_private.wg_topic_room(text) to authenticated;
revoke execute on function wg_private.wg_handle_new_user() from authenticated;
