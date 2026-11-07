create table public.employee_profiles (
  member_id uuid primary key references public.hub_members(id) on delete cascade,
  job_title text not null default '' check (char_length(job_title) <= 100),
  department text not null default '' check (char_length(department) <= 100),
  phone text not null default '' check (char_length(phone) <= 60)
);
alter table public.employee_profiles enable row level security;
revoke all on public.employee_profiles from anon, authenticated;
grant select on public.employee_profiles to authenticated;
create policy employee_profile_read on public.employee_profiles for select to authenticated using (member_id = (select auth.uid()));

create function public.save_employee_profile(p_name text, p_job_title text, p_department text, p_phone text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.board_member() then raise exception 'Workspace membership required' using errcode = '42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then raise exception 'Enter a name up to 120 characters'; end if;
  update public.hub_members set name = btrim(p_name) where id = auth.uid();
  insert into public.employee_profiles (member_id, job_title, department, phone)
  values (auth.uid(), btrim(p_job_title), btrim(p_department), btrim(p_phone))
  on conflict (member_id) do update set
    job_title = excluded.job_title, department = excluded.department, phone = excluded.phone;
end $$;
revoke all on function public.save_employee_profile(text,text,text,text) from public;
grant execute on function public.save_employee_profile(text,text,text,text) to authenticated;
