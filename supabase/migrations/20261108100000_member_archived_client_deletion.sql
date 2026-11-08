-- All signed-in workspace members may delete archived clients after confirmation.
-- Active clients remain protected. No other client permissions change.
begin;

create or replace function public.delete_archived_client(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.board_member() then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;
  delete from public.clients where id = p_id and archived;
  if not found then raise exception 'Archive the client before deleting it'; end if;
end $$;
revoke all on function public.delete_archived_client(uuid) from public, anon;
grant execute on function public.delete_archived_client(uuid) to authenticated;

commit;
