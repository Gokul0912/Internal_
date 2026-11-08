-- Any signed-in workspace member can delete active or archived clients.
-- The UI confirms the permanent action. No bulk deletion or anonymous access.
begin;

create or replace function public.delete_client(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.board_member() then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;
  delete from public.clients where id = p_id;
  if not found then raise exception 'Client unavailable or already deleted'; end if;
end $$;
revoke all on function public.delete_client(uuid) from public, anon;
grant execute on function public.delete_client(uuid) to authenticated;

-- Update the old endpoint too, so deployed older clients no longer require Admin.
create or replace function public.delete_archived_client(p_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select public.delete_client(p_id);
$$;
revoke all on function public.delete_archived_client(uuid) from public, anon;
grant execute on function public.delete_archived_client(uuid) to authenticated;

commit;
