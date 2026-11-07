begin;

alter table public.board_reports add column if not exists deleted_at timestamptz;
create index if not exists board_reports_deleted_at on public.board_reports(deleted_at) where deleted_at is not null;

-- Serialize directory references with catalog cleanup so concurrent writes cannot
-- attach a product/project after its usage check but before its deletion.
create or replace function public.lock_cleanup_references() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(73102946);
  if tg_table_name = 'board_reports' then
    insert into public.board_projects(name) values(new.project) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function public.lock_cleanup_references() from public;
create or replace trigger cleanup_references before insert or update on public.board_reports
for each row execute function public.lock_cleanup_references();
create or replace trigger cleanup_references before insert or update on public.clients
for each row execute function public.lock_cleanup_references();

create or replace function public.cleanup_report(p_id uuid, p_action text, p_path text default null)
returns public.board_reports language plpgsql security definer set search_path = '' as $$
declare item public.board_reports; actor_role text;
begin
  actor_role := public.hub_role();
  if actor_role is null or actor_role = 'Viewer' then raise exception 'Write access required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(73102946);
  select * into item from public.board_reports where id = p_id for update;
  if not found then raise exception 'Report unavailable'; end if;
  if item.author <> auth.uid() and actor_role <> 'Admin' then raise exception 'Only the author or an admin can manage this report' using errcode = '42501'; end if;
  if p_action = 'trash' then
    update public.board_reports set deleted_at = coalesce(deleted_at, now()) where id = p_id returning * into item;
  elsif p_action = 'restore' then
    if item.deleted_at < now() - interval '30 days' then raise exception 'The 30-day restore period has ended'; end if;
    update public.board_reports set deleted_at = null where id = p_id returning * into item;
  elsif p_action = 'purge' then
    if actor_role <> 'Admin' or item.deleted_at is null then raise exception 'Only admins can permanently delete reports from Trash' using errcode = '42501'; end if;
    if jsonb_array_length(item.attachments) > 0 then raise exception 'Remove attachments before permanently deleting this report'; end if;
    delete from public.board_reports where id = p_id;
  elsif p_action = 'remove_attachment' then
    if not exists(select 1 from jsonb_array_elements(item.attachments) f where f->>'path' = p_path) then raise exception 'Attachment unavailable'; end if;
    update public.board_reports set attachments = coalesce((select jsonb_agg(f) from jsonb_array_elements(attachments) f where f->>'path' <> p_path), '[]'::jsonb)
    where id = p_id returning * into item;
  else raise exception 'Unknown report action';
  end if;
  return item;
end $$;
revoke all on function public.cleanup_report(uuid,text,text) from public, anon;
grant execute on function public.cleanup_report(uuid,text,text) to authenticated;

create or replace function public.delete_catalog_entry(p_kind text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.hub_role() is distinct from 'Admin' then raise exception 'Admin access required' using errcode = '42501'; end if;
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

create or replace function public.delete_archived_client(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.hub_role() is distinct from 'Admin' then raise exception 'Admin access required' using errcode = '42501'; end if;
  delete from public.clients where id = p_id and archived;
  if not found then raise exception 'Archive the client before deleting it'; end if;
end $$;
revoke all on function public.delete_archived_client(uuid) from public, anon;
grant execute on function public.delete_archived_client(uuid) to authenticated;

-- An admin may clean detached files from any report, while authors may clean
-- their own files. Files referenced by any report remain protected.
drop policy if exists board_files_cleanup on storage.objects;
create policy board_files_cleanup on storage.objects for delete to authenticated
using (bucket_id = 'board-attachments' and public.board_member()
  and ((storage.foldername(name))[1] = auth.uid()::text or public.board_admin())
  and not exists(select 1 from public.board_reports where attachments @> jsonb_build_array(jsonb_build_object('path', name))));

commit;
