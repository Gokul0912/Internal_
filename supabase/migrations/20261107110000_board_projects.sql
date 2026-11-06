create table public.board_projects (
  name text primary key check (char_length(btrim(name)) between 1 and 80)
);
create unique index board_projects_name_ci on public.board_projects (lower(name));
insert into public.board_projects (name)
select distinct on (lower(project)) project
from public.board_reports
order by lower(project), created_at, id;

alter table public.board_projects enable row level security;
revoke all on public.board_projects from anon, authenticated;
grant select, insert on public.board_projects to authenticated;
create policy board_projects_read on public.board_projects for select to authenticated using (public.board_member());
create policy board_projects_add on public.board_projects for insert to authenticated with check (public.board_member());
