-- The Seed: update for BITE staff vs. public access.
-- Paste this whole file into Supabase > SQL Editor and click Run. It's safe to run more than once.
--
-- What it adds:
--   * Each person is either "staff" (sees everything, including internal materials) or "public".
--   * Each article can be marked "internal" (BITE staff only).
--   * Two email lists you manage on the People page. Someone whose email is on a list is approved
--     automatically, as staff or public, as soon as they confirm their email address.

-- 1. New columns.
alter table public.profiles       add column if not exists tier text not null default 'public' check (tier in ('staff', 'public'));
alter table public.articles       add column if not exists internal boolean not null default false;
alter table public.shared_answers add column if not exists internal boolean not null default false;
update public.profiles set tier = 'staff' where role = 'admin';

-- 2. The email lists.
create table if not exists public.access_emails (
  email     text primary key check (email = lower(btrim(email))),
  tier      text not null check (tier in ('staff', 'public')),
  added_at  timestamptz not null default now()
);
alter table public.access_emails enable row level security;
drop policy if exists "access_emails: admin only" on public.access_emails;
create policy "access_emails: admin only" on public.access_emails
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.access_emails to authenticated;

-- 3. Who counts as staff: approved admins and approved people on the staff tier.
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved' and (role = 'admin' or tier = 'staff')
  );
$$;
grant execute on function public.is_staff() to authenticated;

-- 4. Approve someone automatically if their email is on a list.
create or replace function public.apply_access_list(uid uuid, mail text) returns void
language plpgsql security definer set search_path = public as $$
declare
  entry public.access_emails;
begin
  select * into entry from public.access_emails where email = lower(btrim(mail));
  if not found then return; end if;
  update public.profiles
     set tier = entry.tier,
         status = case when status = 'pending' then 'approved' else status end
   where id = uid;
end;
$$;
revoke all on function public.apply_access_list(uuid, text) from public, anon, authenticated;

-- When someone signs up: the first person becomes admin; others wait, unless their email is listed.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  no_admin_yet boolean;
begin
  select not exists (select 1 from public.profiles where role = 'admin') into no_admin_yet;
  insert into public.profiles (id, email, full_name, role, status, tier)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    case when no_admin_yet then 'admin' else 'partner' end,
    case when no_admin_yet then 'approved' else 'pending' end,
    case when no_admin_yet then 'staff' else 'public' end
  );
  if new.email_confirmed_at is not null then
    perform public.apply_access_list(new.id, new.email);
  end if;
  return new;
end;
$$;

-- Listed emails are approved only after the person confirms they own the address.
create or replace function public.handle_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform public.apply_access_list(new.id, new.email);
  end if;
  return new;
end;
$$;
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.handle_user_confirmed();

-- A partner may not change their own role, approval, or access level.
-- (Changes made by the system itself, with nobody signed in, are allowed.)
create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.status := old.status;
    new.tier := old.tier;
    new.email := old.email;
  end if;
  return new;
end;
$$;

-- 5. Internal articles are visible to staff only.
drop policy if exists "articles: read" on public.articles;
create policy "articles: read" on public.articles
  for select to authenticated using (
    public.is_admin()
    or (public.is_approved_user() and (
         submitted_by = auth.uid()
         or (status = 'approved' and (not internal or public.is_staff()))
       ))
  );

drop policy if exists "articles: partner submit" on public.articles;
create policy "articles: partner submit" on public.articles
  for insert to authenticated with check (
    public.is_admin()
    or (public.is_approved_user()
        and status = 'pending' and origin = 'partner' and submitted_by = auth.uid()
        and not internal
        and reviewed_by is null and reviewed_at is null)
  );

-- The duplicate check shouldn't reveal that an internal article exists.
create or replace function public.article_url_status(u text) returns text
language sql stable security definer set search_path = public as $$
  select a.status from public.articles a
  where public.is_approved_user()
    and (not a.internal or public.is_staff())
    and rtrim(lower(btrim(a.url)), '/') = rtrim(lower(btrim(u)), '/')
  order by case a.status when 'approved' then 0 when 'pending' then 1 else 2 end
  limit 1;
$$;

-- 6. A shared answer that draws on internal articles can only be opened by staff.
drop policy if exists "shared_answers: read" on public.shared_answers;
create policy "shared_answers: read" on public.shared_answers
  for select to authenticated using (
    public.is_approved_user() and (not internal or public.is_staff())
  );

-- 7. Tell Supabase to pick up the new columns right away.
notify pgrst, 'reload schema';
