-- Let working team members maintain the directory; Viewers remain read-only.
-- Re-running this migration is safe and does not change data or account roles.
begin;

alter policy clients_add on public.clients
  with check ((select public.hub_role()) in ('Admin', 'Developer', 'Team Member'));

alter policy clients_edit on public.clients
  using ((select public.hub_role()) in ('Admin', 'Developer', 'Team Member'))
  with check ((select public.hub_role()) in ('Admin', 'Developer', 'Team Member'));

alter policy client_products_add on public.client_products
  with check ((select public.hub_role()) in ('Admin', 'Developer', 'Team Member'));

commit;
