-- Development fixtures only. Run after the Product Hub migration.
insert into public.hub_apps (id, name, description)
values ('a16d2639-8d57-4f48-9789-916d68954f46', 'Sample Product', 'Development fixture')
on conflict (id) do nothing;

do $$
declare
  admin_id uuid;
begin
  select id into admin_id from auth.users where email = 'hub-admin@example.test';
  if admin_id is null then
    raise exception 'Create the hub-admin@example.test development auth user first';
  end if;
  insert into public.hub_members (id, name, role) values (admin_id, 'Sample Admin', 'Admin')
    on conflict (id) do nothing;

  insert into public.hub_reports (id, app_id, kind, title, description, status, rank, author, details)
  values
    ('7cdf4fef-bcc5-4dd3-9be1-078774cb6b49', 'a16d2639-8d57-4f48-9789-916d68954f46',
      'bug', 'Search loses filters after refreshing', 'Application filters reset after a browser refresh.', 'Open', 'High', admin_id, '{"Module":"Search"}'),
    ('b2a10635-17df-4b0a-9962-df443d297bbc', 'a16d2639-8d57-4f48-9789-916d68954f46',
      'feature', 'Save frequently used searches', 'Allow teams to save and reopen filter combinations.', 'Proposed', 'Medium', admin_id, '{"Complexity":"Moderate"}'),
    ('92777fd0-e9ee-4da4-8445-1970cb5ec5af', 'a16d2639-8d57-4f48-9789-916d68954f46',
      'feedback', 'Status labels are hard to distinguish', 'More contrast would help when scanning the queue.', 'New', 'Medium', admin_id, '{"Category":"UI/UX","User type":"Tester"}')
  on conflict (id) do nothing;
end $$;
