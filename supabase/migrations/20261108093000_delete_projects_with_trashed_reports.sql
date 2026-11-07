-- Trash does not block project deletion. Historical project text is retained
-- in Trash; restoring a report leaves it unassigned if that project is gone.
begin;

alter table public.board_reports alter column project drop not null;

create or replace function public.lock_cleanup_references() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(73102946);
  if tg_table_name = 'board_reports' then
    if tg_op = 'UPDATE' then
      if old.deleted_at is not null and new.deleted_at is null
        and not exists(select 1 from public.board_projects where lower(name) = lower(new.project)) then
        new.project := null;
      end if;
    end if;
    if new.deleted_at is null and new.project is not null then
      insert into public.board_projects(name) values(new.project) on conflict do nothing;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.lock_cleanup_references() from public;

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
    if exists(select 1 from public.board_reports where deleted_at is null and lower(project) = lower(p_name)) then raise exception 'Move active reports to another project first'; end if;
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
