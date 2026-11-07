-- Grant shared workspace membership only after Gmail email verification.
create function public.enroll_verified_gmail() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null
    and lower(split_part(new.email, '@', 2)) = 'gmail.com' then
    insert into public.hub_members (id, name, role)
    values (
      new.id,
      left(coalesce(nullif(btrim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)), 120),
      'Team Member'
    )
    on conflict (id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.enroll_verified_gmail() from public;
create trigger enroll_verified_gmail
after insert or update of email_confirmed_at on auth.users
for each row execute function public.enroll_verified_gmail();

insert into public.hub_members (id, name, role)
select id, left(coalesce(nullif(btrim(raw_user_meta_data->>'name'), ''), split_part(email, '@', 1)), 120), 'Team Member'
from auth.users
where email_confirmed_at is not null and lower(split_part(email, '@', 2)) = 'gmail.com'
on conflict (id) do nothing;
