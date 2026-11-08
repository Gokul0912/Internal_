begin;

create table if not exists public.client_sections (
  id uuid primary key default gen_random_uuid(),
  product text not null references public.client_products(name) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 60)
);
create unique index if not exists client_sections_product_name_ci on public.client_sections(product, lower(name));

create or replace function public.normalize_client_section() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.name := pg_catalog.regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  return new;
end $$;
revoke all on function public.normalize_client_section() from public;
create or replace trigger normalize_client_section before insert or update on public.client_sections
for each row execute function public.normalize_client_section();

alter table public.client_sections enable row level security;
revoke all on public.client_sections from anon, authenticated;
grant select, insert on public.client_sections to authenticated;
drop policy if exists client_sections_read on public.client_sections;
create policy client_sections_read on public.client_sections for select to authenticated using(public.board_member());
drop policy if exists client_sections_add on public.client_sections;
create policy client_sections_add on public.client_sections for insert to authenticated
with check((select public.hub_role()) in ('Admin','Developer','Team Member'));

alter table public.clients add column if not exists section_ids uuid[] not null default '{}';
create index if not exists clients_section_ids on public.clients using gin(section_ids);

create or replace function public.validate_client_sections() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- The existing cleanup_references trigger takes the shared reference lock first.
  if cardinality(new.section_ids) > 100
    or cardinality(new.section_ids) <> (select count(distinct sid) from unnest(new.section_ids) sid)
    or exists(select 1 from unnest(new.section_ids) sid
      where not exists(select 1 from public.client_sections s where s.id = sid and s.product = any(new.products))) then
    raise exception 'Choose sections belonging to the selected products' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public.validate_client_sections() from public;
create or replace trigger validate_client_sections before insert or update on public.clients
for each row execute function public.validate_client_sections();

create or replace function public.delete_client_section(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.board_member() then raise exception 'Workspace membership required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(73102946);
  if exists(select 1 from public.clients where section_ids @> array[p_id]) then
    raise exception 'This section is linked to clients. Move them to another section first.';
  end if;
  delete from public.client_sections where id = p_id;
end $$;
revoke all on function public.delete_client_section(uuid) from public, anon;
grant execute on function public.delete_client_section(uuid) to authenticated;

commit;
