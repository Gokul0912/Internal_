-- Every authenticated workspace member may delete unused projects, including
-- Viewers. Product/type deletion retains its existing Admin-only permission.
begin;

create or replace function public.delete_catalog_entry(p_kind text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_kind = 'project' then
    if not public.board_member() then raise exception 'Workspace membership required' using errcode = '42501'; end if;
  elsif public.hub_role() is distinct from 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(73102946);
  if p_kind = 'project' then
    if exists(select 1 from public.board_reports where lower(project) = lower(p_name)) then raise exception 'Project is linked to reports'; end if;
    delete from public.board_projects where name = p_name;
  elsif p_kind = 'type' then
    if exists(select 1 from public.board_reports where type = p_name) then raise exception 'Report type is in use'; end if;
    delete from public.board_types where name = p_name;
  elsif p_kind = 'product' then
    if exists(select 1 from public.clients where p_name = any(products)) then raise exception 'Product is linked to clients'; end if;
    delete from public.client_products where name = p_name;
  else raise exception 'Unknown entry type';
  end if;
end $$;
revoke all on function public.delete_catalog_entry(text,text) from public, anon;
grant execute on function public.delete_catalog_entry(text,text) to authenticated;

commit;
