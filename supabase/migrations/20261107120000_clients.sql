create function public.board_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.hub_members where id = auth.uid() and role = 'Admin') $$;
revoke all on function public.board_admin() from public;
grant execute on function public.board_admin() to authenticated;

create table public.client_products (
  name text primary key check (char_length(btrim(name)) between 1 and 80)
);
create unique index client_products_name_ci on public.client_products (lower(name));
create table public.clients (
  id uuid primary key,
  company text not null check (char_length(btrim(company)) between 1 and 120),
  website text not null default '' check (char_length(website) <= 300),
  address text not null default '' check (char_length(address) <= 500),
  notes text not null default '' check (char_length(notes) <= 4000),
  archived boolean not null default false,
  products text[] not null default '{}' check (cardinality(products) <= 100),
  contacts jsonb not null default '[]' check (jsonb_typeof(contacts) = 'array' and jsonb_array_length(contacts) <= 20),
  updated_at timestamptz not null default now()
);
create function public.validate_client() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if exists(select 1 from unnest(new.products) p where p is null or not exists(select 1 from public.client_products where name = p)) then
    raise exception 'Choose an existing product';
  end if;
  if exists(select 1 from jsonb_array_elements(new.contacts) c
    where jsonb_typeof(c) is distinct from 'object'
      or coalesce(length(c->>'name'),0) not between 1 and 120
      or coalesce(length(c->>'email'),0) > 254
      or coalesce(length(c->>'phone'),0) > 60
      or coalesce(length(c->>'role'),0) > 120) then raise exception 'Invalid contact'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger validate_client before insert or update on public.clients for each row execute function public.validate_client();
alter table public.clients enable row level security;
alter table public.client_products enable row level security;
revoke all on public.clients, public.client_products from anon, authenticated;
grant select, insert, update on public.clients to authenticated;
grant select, insert on public.client_products to authenticated;
create policy clients_read on public.clients for select to authenticated using (public.board_member());
create policy clients_add on public.clients for insert to authenticated with check (public.board_admin());
create policy clients_edit on public.clients for update to authenticated using (public.board_admin()) with check (public.board_admin());
create policy client_products_read on public.client_products for select to authenticated using (public.board_member());
create policy client_products_add on public.client_products for insert to authenticated with check (public.board_admin());
