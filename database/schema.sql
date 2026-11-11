-- ============================================================
-- The Seed: database structure
-- Paste-ready for the Supabase SQL editor (via setup.sql).
-- ============================================================

-- ---------- People ----------
-- One row per person who signs up. New sign-ups wait for the admin's approval.
-- The very first person to sign up becomes admin automatically.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'partner' check (role in ('admin', 'partner')),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  tier        text not null default 'public' check (tier in ('staff', 'public')),  -- staff see internal materials too
  created_at  timestamptz not null default now()
);

-- ---------- Email lists ----------
-- Emails the admin has pre-approved, as BITE staff or as public members.
-- Someone on a list is approved automatically once they confirm their email address.
create table if not exists public.access_emails (
  email     text primary key check (email = lower(btrim(email))),
  tier      text not null check (tier in ('staff', 'public')),
  added_at  timestamptz not null default now()
);

-- ---------- Sources ----------
-- A publication, journal, or organization that articles come from.
-- The scout fields are for the future weekly scout.
create table if not exists public.sources (
  id               bigint generated always as identity primary key,
  name             text not null unique,
  website_url      text,
  notes            text,
  scout_enabled    boolean not null default true,   -- future: should the weekly scout check this source?
  scout_feed_url   text,                             -- future: RSS feed or page the scout reads
  last_scouted_at  timestamptz,                      -- future: when the scout last checked
  created_at       timestamptz not null default now()
);

-- ---------- Topics ----------
-- The shared tag list. Only the admin can add, rename, or remove topics.
create table if not exists public.topics (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  created_at  timestamptz not null default now()
);

-- ---------- Articles ----------
-- Every article, whether pending, approved, or rejected.
-- Only approved articles appear in the library (and, later, in the AI agent's answers).
create table if not exists public.articles (
  id                     bigint generated always as identity primary key,
  url                    text not null,
  title                  text,
  authors                text,
  publication_date       date,            -- full date, when known
  publication_year       int,             -- year only, when that's all we know
  publication_details    text,            -- e.g. journal volume and pages
  source_id              bigint references public.sources(id) on delete set null,
  related_organizations  text,            -- co-publishers, partners, author affiliations
  resource_type          text,            -- report, journal article, toolkit, ...
  summary                text,            -- blank means "summary still to be written"
  summary_origin         text check (summary_origin in ('abstract', 'human', 'ai_draft')),
  summary_needs_review   boolean not null default false,
  admin_notes            text,            -- private notes for the admin
  full_text              text,            -- the article's text, for the research assistant
  internal               boolean not null default false,  -- true = BITE staff only

  status                 text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  origin                 text not null default 'partner' check (origin in ('import', 'partner', 'admin', 'scout')),
  submitted_by           uuid references public.profiles(id) on delete set null,
  submission_note        text,            -- the partner's note on why it belongs
  reviewed_by            uuid references public.profiles(id) on delete set null,
  reviewed_at            timestamptz,
  review_note            text,            -- admin's note back to the submitter (e.g. why rejected)

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Keyword search index across title, authors, summary, and organizations.
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(authors, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(related_organizations, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'C')
  ) stored
);

create index if not exists articles_search_idx on public.articles using gin (search);
create index if not exists articles_status_idx on public.articles (status);
create index if not exists articles_source_idx on public.articles (source_id);

-- ---------- Article <-> Topic links ----------
create table if not exists public.article_topics (
  article_id  bigint not null references public.articles(id) on delete cascade,
  topic_id    bigint not null references public.topics(id) on delete cascade,
  primary key (article_id, topic_id)
);
create index if not exists article_topics_topic_idx on public.article_topics (topic_id);

-- ============================================================
-- Helper checks used by the permission rules
-- ============================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'approved'
  );
$$;

create or replace function public.is_approved_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
  );
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved' and (role = 'admin' or tier = 'staff')
  );
$$;

-- Approve someone automatically if their email is on a list.
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

-- When someone signs up, create their profile.
-- The first person ever becomes an approved admin; everyone else waits for approval,
-- unless their email is on one of the admin's lists.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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

-- Keep updated_at current.
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists articles_touch on public.articles;
create trigger articles_touch before update on public.articles
  for each row execute function public.touch_updated_at();

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

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ============================================================
-- Search: keyword + optional topic + optional source.
-- Runs with the caller's permissions, so partners only ever see approved articles.
-- ============================================================
create or replace function public.search_articles(
  q text default null,
  topic bigint default null,
  source bigint default null,
  only_status text default 'approved'
)
returns setof public.articles
language sql stable security invoker set search_path = public as $$
  select a.*
  from public.articles a
  where a.status = only_status
    and (source is null or a.source_id = source)
    and (topic is null or exists (
          select 1 from public.article_topics t
          where t.article_id = a.id and t.topic_id = topic))
    and (
      q is null or btrim(q) = ''
      or a.search @@ websearch_to_tsquery('english', q)
      or a.title ilike '%' || btrim(q) || '%'
      or a.authors ilike '%' || btrim(q) || '%'
      or a.summary ilike '%' || btrim(q) || '%'
      or exists (select 1 from public.article_topics at2
                 join public.topics tp on tp.id = at2.topic_id
                 where at2.article_id = a.id and tp.name ilike '%' || btrim(q) || '%')
      or exists (select 1 from public.sources s
                 where s.id = a.source_id and s.name ilike '%' || btrim(q) || '%')
    )
  order by
    case when q is null or btrim(q) = '' then 0
         else ts_rank(a.search, websearch_to_tsquery('english', q)) end desc,
    coalesce(a.publication_year, extract(year from a.publication_date)::int) desc nulls last,
    a.title asc;
$$;

-- Is this link already in the Seed? Returns 'approved', 'pending', 'rejected', or null.
-- Lets a partner know about duplicates without exposing other people's submissions.
create or replace function public.article_url_status(u text) returns text
language sql stable security definer set search_path = public as $$
  select a.status from public.articles a
  where public.is_approved_user()
    and (not a.internal or public.is_staff())
    and rtrim(lower(btrim(a.url)), '/') = rtrim(lower(btrim(u)), '/')
  order by case a.status when 'approved' then 0 when 'pending' then 1 else 2 end
  limit 1;
$$;

-- ---------- Shared answers ----------
-- Answers from the research assistant that someone chose to share by link.
create table if not exists public.shared_answers (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  doc         jsonb not null,
  internal    boolean not null default false   -- true when it draws on internal articles: staff only
);

-- ============================================================
-- Permission rules (row-level security)
-- ============================================================
alter table public.profiles       enable row level security;
alter table public.access_emails  enable row level security;
alter table public.sources        enable row level security;
alter table public.topics         enable row level security;
alter table public.articles       enable row level security;
alter table public.article_topics enable row level security;

-- Profiles: you can see your own; the admin sees and manages everyone.
drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles: update own name or admin" on public.profiles;
create policy "profiles: update own name or admin" on public.profiles
  for update to authenticated using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists "profiles: admin delete" on public.profiles;
create policy "profiles: admin delete" on public.profiles
  for delete to authenticated using (public.is_admin());

-- Sources and topics: approved users can read; only the admin can change.
drop policy if exists "sources: read" on public.sources;
create policy "sources: read" on public.sources
  for select to authenticated using (public.is_approved_user());
drop policy if exists "sources: admin write" on public.sources;
create policy "sources: admin write" on public.sources
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "topics: read" on public.topics;
create policy "topics: read" on public.topics
  for select to authenticated using (public.is_approved_user());
drop policy if exists "topics: admin write" on public.topics;
create policy "topics: admin write" on public.topics
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Email lists: only the admin.
drop policy if exists "access_emails: admin only" on public.access_emails;
create policy "access_emails: admin only" on public.access_emails
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Articles: approved users see approved articles plus their own submissions.
-- Internal articles are for staff (and the admin) only.
drop policy if exists "articles: read" on public.articles;
create policy "articles: read" on public.articles
  for select to authenticated using (
    public.is_admin()
    or (public.is_approved_user() and (
         submitted_by = auth.uid()
         or (status = 'approved' and (not internal or public.is_staff()))
       ))
  );

-- Partners can only add new articles to the pending queue, in their own name.
drop policy if exists "articles: partner submit" on public.articles;
create policy "articles: partner submit" on public.articles
  for insert to authenticated with check (
    public.is_admin()
    or (public.is_approved_user()
        and status = 'pending' and origin = 'partner' and submitted_by = auth.uid()
        and not internal
        and reviewed_by is null and reviewed_at is null)
  );

-- Only the admin can edit or delete articles.
drop policy if exists "articles: admin update" on public.articles;
create policy "articles: admin update" on public.articles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "articles: admin delete" on public.articles;
create policy "articles: admin delete" on public.articles
  for delete to authenticated using (public.is_admin());

-- Topic links: visible when the article is visible. Partners may suggest topics
-- only on their own pending submissions. The admin manages everything.
drop policy if exists "article_topics: read" on public.article_topics;
create policy "article_topics: read" on public.article_topics
  for select to authenticated using (
    exists (select 1 from public.articles a where a.id = article_id)
  );
drop policy if exists "article_topics: partner suggest" on public.article_topics;
create policy "article_topics: partner suggest" on public.article_topics
  for insert to authenticated with check (
    public.is_admin()
    or exists (select 1 from public.articles a
               where a.id = article_id and a.submitted_by = auth.uid() and a.status = 'pending')
  );
drop policy if exists "article_topics: admin delete" on public.article_topics;
create policy "article_topics: admin delete" on public.article_topics
  for delete to authenticated using (public.is_admin());

-- Shared answers: any approved member can open one by its link (staff only if it uses internal articles); you can share as yourself; you (or the admin) can remove yours.
alter table public.shared_answers enable row level security;
drop policy if exists "shared_answers: read" on public.shared_answers;
create policy "shared_answers: read" on public.shared_answers
  for select to authenticated using (public.is_approved_user() and (not internal or public.is_staff()));
drop policy if exists "shared_answers: share" on public.shared_answers;
create policy "shared_answers: share" on public.shared_answers
  for insert to authenticated with check (public.is_approved_user() and created_by = auth.uid());
drop policy if exists "shared_answers: delete own or admin" on public.shared_answers;
create policy "shared_answers: delete own or admin" on public.shared_answers
  for delete to authenticated using (created_by = auth.uid() or public.is_admin());

-- Signed-in users may use the tables (the rules above still apply); signed-out visitors get nothing.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.search_articles(text, bigint, bigint, text) to authenticated;
grant execute on function public.article_url_status(text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_approved_user() to authenticated;
grant execute on function public.is_staff() to authenticated;
revoke all on all tables in schema public from anon;
