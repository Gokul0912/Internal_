-- Membership is created automatically after verified Gmail registration or Google sign-in.
-- Create the matching employee profile without replacing existing employee details.
create or replace function public.initialize_employee_profile() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.employee_profiles (member_id)
  values (new.id)
  on conflict (member_id) do nothing;
  return new;
end $$;
revoke all on function public.initialize_employee_profile() from public;
create or replace trigger initialize_employee_profile
after insert on public.hub_members
for each row execute function public.initialize_employee_profile();

insert into public.employee_profiles (member_id)
select id from public.hub_members
on conflict (member_id) do nothing;
