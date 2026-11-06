create table public.board_types (
  name text primary key check (char_length(btrim(name)) between 1 and 50)
);
create unique index board_types_name_ci on public.board_types (lower(name));
insert into public.board_types values ('Bug report'), ('Update report'), ('User feedback');

create table public.board_reports (
  id uuid primary key,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  details text not null check (char_length(details) <= 2000),
  type text not null references public.board_types(name),
  project text not null check (char_length(btrim(project)) between 1 and 80),
  done boolean not null default false,
  author uuid not null default auth.uid(),
  posted_by text not null,
  created_at timestamptz not null default now(),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  attachments jsonb not null default '[]' check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5)
);

create function public.board_member() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.hub_members where id = auth.uid()) $$;
revoke all on function public.board_member() from public;
grant execute on function public.board_member() to authenticated;

create function public.board_stamp_report() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  member_name text;
  member_role text;
begin
  select name, role::text into member_name, member_role from public.hub_members where id = auth.uid();
  if member_name is null then raise exception 'Workspace membership required' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then
    new.author := auth.uid();
    new.posted_by := member_name;
    new.created_at := now();
    if exists (
      select 1 from jsonb_array_elements(new.attachments) as file(entry)
      where jsonb_typeof(entry) is distinct from 'object'
        or coalesce(entry->>'name', '') = ''
        or coalesce(entry->>'type', '') not in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm')
        or not exists (
          select 1 from storage.objects
          where bucket_id = 'board-attachments' and name = entry->>'path'
            and (storage.foldername(name))[1] = auth.uid()::text
            and (storage.foldername(name))[2] = new.id::text
        )
    ) then raise exception 'Invalid report attachment' using errcode = '22023'; end if;
  elsif old.author <> auth.uid() and member_role <> 'Admin'
    and (new.title, new.details, new.type, new.project, new.attachments)
      is distinct from (old.title, old.details, old.type, old.project, old.attachments) then
    raise exception 'Only the author or an admin can edit report details' using errcode = '42501';
  end if;
  new.updated_by := member_name;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.board_stamp_report() from public;
create trigger board_stamp before insert or update on public.board_reports
for each row execute function public.board_stamp_report();

alter table public.board_types enable row level security;
alter table public.board_reports enable row level security;
revoke all on public.board_types, public.board_reports from anon, authenticated;
grant select, insert on public.board_types to authenticated;
grant select on public.board_reports to authenticated;
grant insert (id, title, details, type, project, attachments) on public.board_reports to authenticated;
grant update (title, details, type, project, done) on public.board_reports to authenticated;
create policy board_types_read on public.board_types for select to authenticated using (public.board_member());
create policy board_types_add on public.board_types for insert to authenticated with check (public.board_member());
create policy board_reports_read on public.board_reports for select to authenticated using (public.board_member());
create policy board_reports_add on public.board_reports for insert to authenticated with check (public.board_member() and author = auth.uid());
create policy board_reports_edit on public.board_reports for update to authenticated using (public.board_member()) with check (public.board_member());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('board-attachments', 'board-attachments', false, 26214400,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']);
create policy board_files_read on storage.objects for select to authenticated
using (bucket_id = 'board-attachments' and public.board_member() and (
  (storage.foldername(name))[1] = auth.uid()::text
  or exists (select 1 from public.board_reports where attachments @> jsonb_build_array(jsonb_build_object('path', name)))
));
create policy board_files_add on storage.objects for insert to authenticated
with check (bucket_id = 'board-attachments' and public.board_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy board_files_cleanup on storage.objects for delete to authenticated
using (bucket_id = 'board-attachments' and public.board_member() and (storage.foldername(name))[1] = auth.uid()::text
  and not exists (select 1 from public.board_reports where attachments @> jsonb_build_array(jsonb_build_object('path', name))));
