create table public.hub_members (
  id uuid primary key references auth.users on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  is_tester boolean not null default false,
  role text not null check (role in ('Admin','Developer','Team Member','Viewer')),
  created_at timestamptz not null default now()
);
create table public.hub_apps (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.hub_access (
  app_id uuid references public.hub_apps on delete cascade,
  member_id uuid references public.hub_members on delete cascade,
  primary key (app_id, member_id)
);
create table public.hub_reports (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  app_id uuid not null references public.hub_apps,
  kind text not null,
  title text not null check (length(trim(title)) between 1 and 180),
  description text not null check (length(trim(description)) between 1 and 12000),
  status text not null,
  rank text not null check (rank in ('Critical','High','Medium','Low') and (rank <> 'Critical' or kind = 'bug')),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object' and length(details::text) <= 24000),
  author uuid not null default auth.uid() references public.hub_members,
  assignee uuid references public.hub_members,
  source_id uuid references public.hub_reports on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, kind),
  check (
    (kind = 'bug' and status in ('Open','Acknowledged','In Progress','Fixed','Verified','Closed')) or
    (kind = 'feature' and status in ('Proposed','Under Review','Approved','Rejected','Planned','In Development','Completed','Released')) or
    (kind = 'feedback' and status in ('New','Reviewing','Action Required','Resolved','Closed'))
  )
);
create index hub_reports_app_kind_date on public.hub_reports(app_id, kind, created_at desc);
create index hub_reports_assignee on public.hub_reports(assignee);
create table public.hub_comments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.hub_reports on delete cascade,
  author uuid not null default auth.uid() references public.hub_members,
  body text not null check (length(trim(body)) between 1 and 6000),
  resolution boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.hub_history (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.hub_reports on delete cascade,
  actor uuid references public.hub_members,
  previous text,
  status text not null,
  created_at timestamptz not null default now()
);
create table public.hub_votes (
  report_id uuid references public.hub_reports on delete cascade,
  member_id uuid default auth.uid() references public.hub_members on delete cascade,
  primary key (report_id, member_id)
);
create index hub_comments_report on public.hub_comments(report_id, created_at);
create index hub_history_report on public.hub_history(report_id, created_at);

create function public.hub_role() returns text language sql stable security definer set search_path = ''
as $$ select role from public.hub_members where id = (select auth.uid()) $$;
create function public.hub_can_access(app uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.hub_role() = 'Admin' or exists (
  select 1 from public.hub_access where app_id = app and member_id = (select auth.uid())
), false) $$;

alter table public.hub_members enable row level security;
alter table public.hub_apps enable row level security;
alter table public.hub_access enable row level security;
alter table public.hub_reports enable row level security;
alter table public.hub_comments enable row level security;
alter table public.hub_history enable row level security;
alter table public.hub_votes enable row level security;

create policy hub_members_read on public.hub_members for select to authenticated using ((select public.hub_role()) is not null);
create policy hub_members_admin on public.hub_members for all to authenticated using ((select public.hub_role()) = 'Admin') with check ((select public.hub_role()) = 'Admin');
create policy hub_apps_read on public.hub_apps for select to authenticated using (public.hub_can_access(id));
create policy hub_apps_admin on public.hub_apps for all to authenticated using ((select public.hub_role()) = 'Admin') with check ((select public.hub_role()) = 'Admin');
create policy hub_access_admin on public.hub_access for all to authenticated using ((select public.hub_role()) = 'Admin') with check ((select public.hub_role()) = 'Admin');
create policy hub_reports_read on public.hub_reports for select to authenticated using (
  public.hub_can_access(app_id) and ((select public.hub_role()) <> 'Developer' or assignee = (select auth.uid()))
);
create policy hub_reports_insert on public.hub_reports for insert to authenticated with check (
  author = (select auth.uid()) and public.hub_can_access(app_id)
  and exists (select 1 from public.hub_apps where id = app_id and not archived)
  and ((select public.hub_role()) = 'Admin' or (
    (select public.hub_role()) = 'Team Member' and assignee is null and source_id is null
    and status = case kind when 'bug' then 'Open' when 'feature' then 'Proposed' else 'New' end
  ))
);
create policy hub_reports_update on public.hub_reports for update to authenticated using (
  (select public.hub_role()) = 'Admin' or ((select public.hub_role()) = 'Developer'
  and kind in ('bug','feature') and public.hub_can_access(app_id) and assignee = (select auth.uid()))
  or ((select public.hub_role()) = 'Team Member' and kind = 'bug' and public.hub_can_access(app_id)
    and assignee is distinct from (select auth.uid())
    and exists (select 1 from public.hub_members where id = (select auth.uid()) and is_tester))
);
create policy hub_reports_delete on public.hub_reports for delete to authenticated using ((select public.hub_role()) = 'Admin');
create policy hub_comments_read on public.hub_comments for select to authenticated using (
  exists (select 1 from public.hub_reports where id = report_id)
  and ((select public.hub_role()) in ('Admin','Developer') or
    (not resolution and exists (select 1 from public.hub_reports where id = report_id and kind = 'feature')))
);
create policy hub_comments_insert on public.hub_comments for insert to authenticated with check (
  author = (select auth.uid()) and exists (select 1 from public.hub_reports where id = report_id)
  and ((select public.hub_role()) in ('Admin','Developer') or
    ((select public.hub_role()) = 'Team Member' and not resolution and exists (
      select 1 from public.hub_reports where id = report_id and kind = 'feature')))
);
create policy hub_history_read on public.hub_history for select to authenticated using (exists (select 1 from public.hub_reports where id = report_id));
create policy hub_votes_read on public.hub_votes for select to authenticated using (exists (select 1 from public.hub_reports where id = report_id));
create policy hub_votes_insert on public.hub_votes for insert to authenticated with check (
  member_id = (select auth.uid()) and (select public.hub_role()) in ('Admin','Developer','Team Member')
  and exists (select 1 from public.hub_reports where id = report_id and kind = 'feature')
);
create policy hub_votes_delete on public.hub_votes for delete to authenticated using (member_id = (select auth.uid()) and (select public.hub_role()) <> 'Viewer');

create function public.hub_guard_report() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.kind <> old.kind or new.author <> old.author or new.created_at <> old.created_at then
      raise exception 'Report identity is immutable';
    end if;
    if public.hub_role() = 'Team Member' and (
      (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at')
      or old.status <> 'Fixed' or new.status <> 'Verified'
    ) then raise exception 'Testers can only verify fixed bugs'; end if;
    if public.hub_role() = 'Developer' and (
      (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at')
      or (new.status <> old.status and not (
        (old.kind = 'bug' and (old.status,new.status) in (('Acknowledged','In Progress'),('In Progress','Fixed')))
        or (old.kind = 'feature' and (old.status,new.status) in (('Approved','In Development'),('Planned','In Development'),('In Development','Completed')))
      ))
    ) then raise exception 'This change requires a hub admin'; end if;
  end if;
  if new.assignee is not null and public.hub_role() = 'Admin' and not exists (
    select 1 from public.hub_members m where m.id = new.assignee
    and (m.role in ('Admin','Developer') or (new.kind = 'feedback' and m.role = 'Team Member')) and
    (m.role = 'Admin' or exists (select 1 from public.hub_access a where a.app_id = new.app_id and a.member_id = m.id))
  ) then raise exception 'Choose an eligible application member'; end if;
  if new.source_id is not null and not exists (
    select 1 from public.hub_reports r where r.id = new.source_id and r.app_id = new.app_id and r.kind = 'feedback'
  ) then raise exception 'Invalid feedback source'; end if;
  if exists (
    select 1 from jsonb_each(new.details) entry
    where jsonb_typeof(entry.value) <> 'string' or length(entry.value #>> '{}') > 3000
      or not (entry.key = any(case new.kind
        when 'bug' then array['Module','Steps to reproduce','Expected result','Actual result']
        when 'feature' then array['Problem being solved','Proposed solution','Complexity']
        else array['User name','User type','Category','Suggested improvement']
      end))
  ) then raise exception 'Invalid report details'; end if;
  if new.kind = 'feedback' and (
    coalesce(new.details->>'User type', '') not in ('Customer','Internal User','Tester')
    or coalesce(new.details->>'Category', '') not in ('UI/UX','Performance','Functionality','Bug','Feature Request','General')
  ) then raise exception 'Select a valid feedback category and user type'; end if;
  if new.kind = 'feature' and new.details ? 'Complexity'
    and new.details->>'Complexity' not in ('Easy','Moderate','Complex')
  then raise exception 'Select a valid complexity'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger hub_guard_report before insert or update on public.hub_reports for each row execute function public.hub_guard_report();

create function public.hub_log_status() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.hub_history(report_id, actor, status) values (new.id, auth.uid(), new.status);
  elsif new.status <> old.status then
    insert into public.hub_history(report_id, actor, previous, status) values (new.id, auth.uid(), old.status, new.status);
  end if;
  return new;
end $$;
create trigger hub_log_status after insert or update on public.hub_reports for each row execute function public.hub_log_status();

create function public.hub_summary(application uuid, since timestamptz, until_date timestamptz)
returns table(kind text, status text, rank text, category text, total bigint)
language sql stable set search_path = '' as $$
  select r.kind, r.status, r.rank, r.details->>'Category', count(*)
  from public.hub_reports r
  where (application is null or r.app_id = application)
    and (since is null or r.created_at >= since)
    and (until_date is null or r.created_at < until_date)
  group by 1,2,3,4
$$;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('hub-attachments','hub-attachments',false,10485760,array['image/png','image/jpeg','image/webp','video/mp4','video/webm']);
create policy hub_attachment_read on storage.objects for select to authenticated using (
  bucket_id = 'hub-attachments' and exists (
    select 1 from public.hub_reports r where r.id::text = (storage.foldername(name))[1] and r.kind = 'bug'
  )
);
create policy hub_attachment_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'hub-attachments' and exists (
    select 1 from public.hub_reports r where r.id::text = (storage.foldername(name))[1] and r.kind = 'bug'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](png|jpg|webp|mp4|webm)$'
    and ((select public.hub_role()) = 'Admin' or (r.author = (select auth.uid()) and (select public.hub_role()) = 'Team Member'))
  )
);
create policy hub_attachment_delete on storage.objects for delete to authenticated using (
  bucket_id = 'hub-attachments' and (select public.hub_role()) = 'Admin'
);

revoke all on public.hub_members, public.hub_apps, public.hub_access, public.hub_reports,
  public.hub_comments, public.hub_history, public.hub_votes from anon, authenticated;
grant select, insert, update on public.hub_members, public.hub_apps to authenticated;
grant select, insert, delete on public.hub_access, public.hub_votes to authenticated;
grant select, insert, update, delete on public.hub_reports to authenticated;
grant select, insert on public.hub_comments to authenticated;
grant select on public.hub_history to authenticated;
revoke execute on function public.hub_role(), public.hub_can_access(uuid),
  public.hub_summary(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.hub_role(), public.hub_can_access(uuid),
  public.hub_summary(uuid,timestamptz,timestamptz) to authenticated;

create function public.hub_convert_feedback(feedback_id uuid, target_kind text)
returns public.hub_reports language plpgsql set search_path = '' as $$
declare
  source public.hub_reports;
  converted public.hub_reports;
begin
  if public.hub_role() is distinct from 'Admin' or target_kind not in ('bug','feature') then
    raise exception 'Conversion requires a hub admin and a valid report type';
  end if;
  select * into strict source from public.hub_reports where id = feedback_id and kind = 'feedback' for update;
  select * into converted from public.hub_reports where source_id = feedback_id and kind = target_kind;
  if found then return converted; end if;
  insert into public.hub_reports(app_id, kind, title, description, status, rank, source_id)
  values (source.app_id, target_kind, source.title, source.description,
    case target_kind when 'bug' then 'Open' else 'Proposed' end, source.rank, source.id)
  returning * into converted;
  if source.status not in ('Resolved','Closed') then
    update public.hub_reports set status = 'Action Required' where id = source.id;
  end if;
  insert into public.hub_comments(report_id,body) values (source.id, 'Converted to ' ||
    case target_kind when 'bug' then 'BUG-' else 'REQ-' end || lpad(converted.number::text, greatest(4, length(converted.number::text)), '0'));
  return converted;
end $$;
revoke execute on function public.hub_convert_feedback(uuid,text) from public, anon;
grant execute on function public.hub_convert_feedback(uuid,text) to authenticated;



create function public.hub_recurring_feedback(application uuid, since timestamptz, until_date timestamptz)
returns table(title text, category text, total bigint)
language sql stable set search_path = '' as $$
  select min(r.title), r.details->>'Category', count(*)
  from public.hub_reports r
  where r.kind = 'feedback'
    and (application is null or r.app_id = application)
    and (since is null or r.created_at >= since)
    and (until_date is null or r.created_at < until_date)
  group by lower(regexp_replace(trim(r.title), '[[:space:]]+', ' ', 'g')), r.details->>'Category'
  having count(*) > 1
  order by count(*) desc, min(r.title), r.details->>'Category'
  limit 10
$$;
revoke execute on function public.hub_recurring_feedback(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.hub_recurring_feedback(uuid,timestamptz,timestamptz) to authenticated;
