-- The Seed: complete setup. Paste this whole file into Supabase > SQL Editor and click Run.

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


-- ============================================================
-- The Seed: starting data (generated by scripts/build-setup-sql.mjs)
-- Safe to run more than once: nothing is duplicated.
-- ============================================================

-- Sources (102)
insert into public.sources (name) values
  ('American College of Lifestyle Medicine'),
  ('American Heart Association'),
  ('Anthesis'),
  ('ATNI (Access to Nutrition Initiative)'),
  ('B Lab (GreenSHOUTING Guide)'),
  ('Bain & Company'),
  ('Balanced'),
  ('Balanced Protein Consortium'),
  ('BCG (Boston Consulting Group)'),
  ('Behavior Global'),
  ('Better Food Foundation'),
  ('BSR (Business for Social Responsibility)'),
  ('Ceres'),
  ('Climate Power'),
  ('Compassion in World Farming'),
  ('Creatives for Climate'),
  ('Culinary Institute of America'),
  ('Datassential'),
  ('Deloitte'),
  ('Eat Well Global'),
  ('Edelman'),
  ('Environmental Defense Fund'),
  ('Environmental Polling Consortium'),
  ('Farm Forward'),
  ('Fenton'),
  ('Food DisInfo Lab'),
  ('Food Insight Group'),
  ('Food + Planet'),
  ('Food System Innovations'),
  ('Food Systems Foresight'),
  ('Foodminds'),
  ('Fortnight Collective'),
  ('Friends of the Earth'),
  ('Futerra'),
  ('GAIN (Global Alliance for Improved Nutrition)'),
  ('Global Impact Collective'),
  ('GMMB'),
  ('Good Food Institute'),
  ('Good Food Purchasing Program'),
  ('Greener by Default'),
  ('Greenworks'),
  ('Hartman Group'),
  ('Hubbub'),
  ('Humane World for Animals'),
  ('James Beard Foundation'),
  ('Ketchum'),
  ('KitchenTown'),
  ('KK&P (Karen Karp & Partners)'),
  ('KPMG'),
  ('Littlefoot Ventures'),
  ('Luminas'),
  ('Mattson'),
  ('McKinsey & Company'),
  ('Menus of Change University Research Collaborative'),
  ('Mercy For Animals'),
  ('Natural Resources Defense Council'),
  ('New Roots Institute'),
  ('NielsenIQ'),
  ('NNOCCI'),
  ('Nutrition Business Advisors'),
  ('Ogilvy'),
  ('One Kitchen (Wholesome Wave)'),
  ('People for Better Food'),
  ('Plant Futures'),
  ('Pollock Communications'),
  ('Porter Novelli'),
  ('ProVeg'),
  ('Raising Nutrition'),
  ('Rare'),
  ('Real Food Challenge'),
  ('ReFED'),
  ('Rising Tide'),
  ('Rouxbe'),
  ('Smoketown'),
  ('Spitfire Strategies'),
  ('Sustainable America'),
  ('Sustainable Restaurant Association'),
  ('The Culinary Edge'),
  ('The Food Group'),
  ('Topos Partners'),
  ('UPGRADE Dining (Food 4 Thought Innovations)'),
  ('UpRoot'),
  ('Weber Shandwick'),
  ('Workforce Nutrition Association (GAIN)'),
  ('World Resources Institute'),
  ('World Wildlife Fund'),
  ('WRAP Americas'),
  ('YouGov'),
  ('Appetite (Elsevier)'),
  ('Food and Agriculture Organization of the United Nations (FAO)'),
  ('Knorr'),
  ('Nature'),
  ('The Lancet'),
  ('United Nations Environment Programme (UNEP)'),
  ('World Business Council for Sustainable Development (WBCSD)'),
  ('Berkeley Food Institute (University of California, Berkeley)'),
  ('BITE: Building Impact Through Eaters'),
  ('Ecological Economics (Elsevier)'),
  ('Food for Climate League'),
  ('JAMA Internal Medicine'),
  ('Nature Climate Change'),
  ('Psychological Science')
on conflict (name) do nothing;

-- Topics (53), taken from the starter articles' tags
insert into public.topics (name) values
  ('2050 scenarios'),
  ('agriculture'),
  ('agrifood companies'),
  ('agrobiodiversity'),
  ('alternative proteins'),
  ('aquatic foods'),
  ('behavior change'),
  ('behavior change techniques'),
  ('biodiversity'),
  ('blue foods'),
  ('business case'),
  ('carbon labeling'),
  ('chefs'),
  ('climate'),
  ('climate communication'),
  ('defaults'),
  ('diversified diets'),
  ('eat-lancet'),
  ('eco-label'),
  ('environmental impact'),
  ('food systems'),
  ('foodservice'),
  ('genetic resources'),
  ('greenhouse gas emissions'),
  ('healthy diets'),
  ('innovation'),
  ('institutional dining'),
  ('interventions'),
  ('land use'),
  ('menu design'),
  ('menu language'),
  ('narrative design'),
  ('novel animal-product alternatives'),
  ('nudges'),
  ('nutrition'),
  ('placement'),
  ('planetary boundaries'),
  ('planetary health'),
  ('plant foods'),
  ('plant-based'),
  ('plant-based menus'),
  ('plant-forward'),
  ('policy'),
  ('pricing'),
  ('protein'),
  ('retail'),
  ('seafood'),
  ('sustainable diets'),
  ('sustainable food consumption'),
  ('sustainable food systems'),
  ('taste-focused labeling'),
  ('university dining'),
  ('vegetables')
on conflict (name) do nothing;

-- Starter articles (12), loaded straight into the library as approved

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, status, origin)
select 'https://drive.google.com/file/d/1XCAfA7emBxe4rOm7p0XGftkXrxKBwjNs/view?usp=drivesdk', 'Identifying behaviour change techniques for sustainable food consumption: A systematic review using the BCTTv1', 'Anna S. C. Tirion; Danielle D''Lima; Julia Terlet; Ramya Rao; Leslie M. Gutman', 2025, null,
  (select id from public.sources where name = 'Appetite (Elsevier)'), null,
  'Journal article (systematic review)', 'A systematic review of 26 interventions across 19 articles that tried to shift eaters toward sustainable food choices in supermarkets, restaurants, and cafeterias. The authors coded the interventions with the Behaviour Change Technique Taxonomy and found 13 techniques in use. Restructuring the physical environment, such as changing menu defaults or product placement, appeared in the most effective interventions. Social comparison messages had smaller, less predictable effects and sometimes backfired. The authors treat their conclusions as tentative because most interventions combined several techniques.', 'ai_draft', true, 'AI-drafted from the full text. Needs review.', 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1XCAfA7emBxe4rOm7p0XGftkXrxKBwjNs/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1XCAfA7emBxe4rOm7p0XGftkXrxKBwjNs/view?usp=drivesdk' and t.name in ('behavior change', 'sustainable food consumption', 'interventions', 'foodservice', 'retail', 'nudges')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, status, origin)
select 'https://drive.google.com/file/d/1tHfFnEI_pVO3GKgwx83-qZgHopeeiPRS/view?usp=drivesdk', 'Four ways blue foods can help achieve food system ambitions across nations', 'Beatrice I. Crona; Emmy Wassénius; Malin Jonell; and others', 2023, null,
  (select id from public.sources where name = 'Nature'), null,
  'Journal article', 'Integrates findings from the Blue Food Assessment into four policy objectives for national food systems: ensuring supplies of critical nutrients, providing healthy alternatives to terrestrial meat, reducing dietary environmental footprints, and safeguarding blue food contributions to nutrition and livelihoods under a changing climate. The authors assess how relevant each objective is for individual countries. They find that in many African and South American nations, culturally relevant blue foods could help address vitamin B12 and omega-3 deficiencies.', 'ai_draft', true, 'AI-drafted from the abstract, which was partly cut off. Needs review.', 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1tHfFnEI_pVO3GKgwx83-qZgHopeeiPRS/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1tHfFnEI_pVO3GKgwx83-qZgHopeeiPRS/view?usp=drivesdk' and t.name in ('blue foods', 'aquatic foods', 'nutrition', 'policy', 'climate', 'food systems')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, status, origin)
select 'https://drive.google.com/file/d/1IWagZOMhnSd_MnqVVuBZbdWyU7xs3TDI/view?usp=drivesdk', 'The plant-forward opportunity: A business playbook to meet consumer demand within planetary boundaries', 'World Business Council for Sustainable Development (WBCSD), with Deloitte Consulting LLP', null, null,
  (select id from public.sources where name = 'World Business Council for Sustainable Development (WBCSD)'), 'Deloitte Consulting LLP',
  'Business playbook', 'A business playbook for agrifood companies on the value of expanding plant-forward foods, meaning foods with a high share and diversity of plant-derived ingredients, including blends with animal-based ingredients. It is organized in three parts: identifying business value, building innovation pathways, and activating plant-forward agendas. It cites Project Drawdown''s finding that a shift to plant-rich diets has the highest climate potential among food and agriculture solutions.', 'ai_draft', true, 'AI-drafted from the preface and contents. Publication year not shown. Needs review.', 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1IWagZOMhnSd_MnqVVuBZbdWyU7xs3TDI/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1IWagZOMhnSd_MnqVVuBZbdWyU7xs3TDI/view?usp=drivesdk' and t.name in ('plant-forward', 'business case', 'innovation', 'agrifood companies', 'planetary boundaries')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, status, origin)
select 'https://drive.google.com/file/d/1Blofr1N-VkCFd1QscR1-yx22NhWQ1OJx/view?usp=drivesdk', 'Creating a Sustainable Food Future: A Menu of Solutions to Feed Nearly 10 Billion People by 2050 (Final Report)', 'Tim Searchinger; Richard Waite; Craig Hanson; Janet Ranganathan', 2019, null,
  (select id from public.sources where name = 'World Resources Institute'), null,
  'Report', 'The final report of a multiyear partnership among the World Resources Institute, the World Bank Group, the UN Environment Programme, the UN Development Programme, and two French research institutes. It lays out technical opportunities and policies for meeting food, land-use, and greenhouse gas goals in 2050 cost-effectively, in ways that can also help reduce poverty and avoid worsening water challenges. The focus is global, and the report notes that it does not cover many ethical, cultural, and socioeconomic factors.', 'ai_draft', true, 'AI-drafted from the front matter. Needs review.', 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1Blofr1N-VkCFd1QscR1-yx22NhWQ1OJx/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1Blofr1N-VkCFd1QscR1-yx22NhWQ1OJx/view?usp=drivesdk' and t.name in ('food systems', 'land use', 'greenhouse gas emissions', '2050 scenarios', 'agriculture')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, status, origin)
select 'https://drive.google.com/file/d/1BohNi8oKmRlt6kjV3syQequZVgcQNwoB/view?usp=drivesdk', 'The Protein Flip: A Delicious Strategy for Change', 'The Culinary Institute of America, in collaboration with the Department of Nutrition, Harvard T.H. Chan School of Public Health', 2018, null,
  (select id from public.sources where name = 'Culinary Institute of America'), 'Menus of Change; Department of Nutrition, Harvard T.H. Chan School of Public Health',
  'Strategy guide for chefs', 'A strategy guide urging chefs to flip the role of protein on menus: feed plants and grains directly to diners, with much smaller amounts of animal protein alongside. It argues that chefs should stop treating protein as a synonym for meat, and it asks how chefs, behavioral specialists, and designers can create menus that eaters fully accept. It is part of the Menus of Change educational effort.', 'ai_draft', true, 'AI-drafted from the opening pages. Needs review.', 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1BohNi8oKmRlt6kjV3syQequZVgcQNwoB/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1BohNi8oKmRlt6kjV3syQequZVgcQNwoB/view?usp=drivesdk' and t.name in ('protein', 'foodservice', 'menu design', 'plant-forward', 'chefs')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, status, origin)
select 'https://drive.google.com/file/d/1BoLzuiFW7K-f0R5p84yr3Dti7X_-jVYY/view?usp=drivesdk', 'What''s Cooking? An assessment of the potential impacts of selected novel alternatives to conventional animal products (Frontiers 2023)', 'United Nations Environment Programme (UNEP)', 2023, null,
  (select id from public.sources where name = 'United Nations Environment Programme (UNEP)'), 'Stockholm Environment Institute; Good Food Institute',
  'Report (Frontiers 2023 special issue)', 'A UNEP assessment, published as the Frontiers 2023 special issue, of the potential impacts of selected novel alternatives to conventional animal products. Lead authors include researchers from the Stockholm Environment Institute and the Good Food Institute.', 'ai_draft', true, 'Based on the title page and acknowledgments only. Needs a full read and the complete author list.', 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1BoLzuiFW7K-f0R5p84yr3Dti7X_-jVYY/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1BoLzuiFW7K-f0R5p84yr3Dti7X_-jVYY/view?usp=drivesdk' and t.name in ('alternative proteins', 'novel animal-product alternatives', 'environmental impact', 'policy')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, status, origin)
select 'https://drive.google.com/file/d/1BkYNSaht7z70uLUBylqDZgZVUjOFyQHz/view?usp=drivesdk', 'Greener by Default Resource Guide', 'Greener by Default (Farm Forward and Better Food Foundation)', 2023, null,
  (select id from public.sources where name = 'Greener by Default'), 'Farm Forward; Better Food Foundation',
  'Resource guide', 'A resource guide to Greener by Default, a strategy that makes plant-based meals the default on menus while letting diners opt into meat or dairy. It covers how to implement the approach in any dining setting, why defaults work, carbon and water calculations, and inclusivity. The guide says the approach is cost-neutral and in many cases saves money.', 'ai_draft', true, 'AI-drafted from the contents and introduction. Year taken from the file name. Needs review.', 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1BkYNSaht7z70uLUBylqDZgZVUjOFyQHz/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1BkYNSaht7z70uLUBylqDZgZVUjOFyQHz/view?usp=drivesdk' and t.name in ('defaults', 'plant-based menus', 'foodservice', 'institutional dining', 'behavior change')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, status, origin)
select 'https://drive.google.com/file/d/1BjmzLO45wmqwppCB4o-2JZZmqej7PCwo/view?usp=drivesdk', 'The State of the World''s Biodiversity for Food and Agriculture', 'J. Bélanger and D. Pilling (eds.)', 2019, null,
  (select id from public.sources where name = 'Food and Agriculture Organization of the United Nations (FAO)'), 'FAO Commission on Genetic Resources for Food and Agriculture',
  'Global assessment (572 pages)', 'A 572-page assessment from the FAO Commission on Genetic Resources for Food and Agriculture of the state of biodiversity for food and agriculture worldwide.', 'ai_draft', true, 'Based on the title page only. Needs a full read.', 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1BjmzLO45wmqwppCB4o-2JZZmqej7PCwo/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1BjmzLO45wmqwppCB4o-2JZZmqej7PCwo/view?usp=drivesdk' and t.name in ('biodiversity', 'agriculture', 'genetic resources', 'food systems')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, status, origin)
select 'https://drive.google.com/file/d/1KiDqHBx-uMCsXTaMOHnWBjbjz1s8oXVm/view?usp=drivesdk', 'The food service playbook for promoting sustainable food choices (version 1.1)', 'Daniele Pollicino; Stacy Blondin; Sophie Attwood', 2024, null,
  (select id from public.sources where name = 'World Resources Institute'), null,
  'Report (playbook)', 'Version 1.1 of a playbook for promoting sustainable food choices in foodservice, built by identifying and prioritizing behavior change techniques from past interventions. The techniques are grouped under six headings: product, presentation, people, promotion, price, and placement. The report closes with key findings and recommendations for stakeholders.', 'ai_draft', true, 'AI-drafted from the authors page and contents. Needs review.', 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1KiDqHBx-uMCsXTaMOHnWBjbjz1s8oXVm/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1KiDqHBx-uMCsXTaMOHnWBjbjz1s8oXVm/view?usp=drivesdk' and t.name in ('foodservice', 'behavior change techniques', 'sustainable diets', 'menu design', 'pricing', 'placement')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, status, origin)
select 'https://drive.google.com/file/d/1qYjNGQkbhZrlUeEBRlf-w7Psm4APEziB/view?usp=drivesdk', 'Future 50 Foods: 50 foods for healthier people and a healthier planet', 'Knorr', null, null,
  (select id from public.sources where name = 'Knorr'), null,
  'Industry report', 'A report that makes the case for diversifying what eaters eat. It notes that 75% of the global food supply comes from only 12 plant and five animal species, and it argues that narrow diets harm both health and the resilience of the food system. It spotlights 50 foods chosen for health and sustainability.', 'ai_draft', true, 'AI-drafted from the introduction. Publication year not shown. Needs review.', 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1qYjNGQkbhZrlUeEBRlf-w7Psm4APEziB/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1qYjNGQkbhZrlUeEBRlf-w7Psm4APEziB/view?usp=drivesdk' and t.name in ('diversified diets', 'agrobiodiversity', 'plant foods', 'food systems')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, status, origin)
select 'https://drive.google.com/file/d/1Zz8XJYz6C7hYF6VrVIX2nJ-GWFOt_y40/view?usp=drivesdk', 'Food in the Anthropocene: the EAT-Lancet Commission on healthy diets from sustainable food systems', 'Walter Willett; Johan Rockström; Brent Loken; Marco Springmann; Tim Lang; and others', 2019, 'The Lancet 393 (10170): 447–492',
  (select id from public.sources where name = 'The Lancet'), null,
  'Journal article (commission report, accepted manuscript)', 'The EAT-Lancet Commission''s report on healthy diets from sustainable food systems. Its executive summary opens by stating that food has the potential to nurture human health and support environmental sustainability.', 'ai_draft', true, 'Based on the title page and the opening of the executive summary only. This copy is the accepted manuscript from City Research Online. Needs a full read.', 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1Zz8XJYz6C7hYF6VrVIX2nJ-GWFOt_y40/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1Zz8XJYz6C7hYF6VrVIX2nJ-GWFOt_y40/view?usp=drivesdk' and t.name in ('healthy diets', 'sustainable food systems', 'planetary health', 'eat-lancet')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, status, origin)
select 'https://drive.google.com/file/d/1OY3wjQkm-PojjzTELTu1xW4W-mu0LdAh/view?usp=drivesdk', 'Edgy Veggies Toolkit: How to incorporate taste-focused labeling to encourage healthier eating', 'Menus of Change University Research Collaborative (MCURC)', null, null,
  (select id from public.sources where name = 'Menus of Change University Research Collaborative'), null,
  'Toolkit', 'A toolkit for restaurant managers, chefs, parents, and others who influence what people eat. Its core idea is that describing the tasty, enjoyable attributes of healthy foods makes people more likely to choose them. Taste-focused labels name specific flavors and signal a positive experience with words that are indulgent, exciting, traditional, or location-based. The toolkit warns against touting health qualities, merely listing ingredients, using vague positives, or using fancy language.', 'ai_draft', true, 'AI-drafted from the first pages. Publication year not shown. Needs review.', 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1OY3wjQkm-PojjzTELTu1xW4W-mu0LdAh/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1OY3wjQkm-PojjzTELTu1xW4W-mu0LdAh/view?usp=drivesdk' and t.name in ('taste-focused labeling', 'menu language', 'vegetables', 'plant-based', 'foodservice', 'behavior change')
on conflict do nothing;

-- Resources from the shared Drive folder (13): published research goes in the library;
-- BITE and Food for Climate League's own materials wait in the review queue.

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, submission_note, status, origin)
select 'https://drive.google.com/file/d/15LyWmTkXQ3FiT3XIWPm6sExkR8WAv5G6/view?usp=drivesdk', 'The Language of Sustainable Diets: A Field Study Exploring the Impact of Renaming Vegetarian Dishes on U.K. Café Menus', 'Linda Bacon; Jonathan Wise; Sophie Attwood; Daniel Vennard', 2018, 'Technical note, December 2018',
  (select id from public.sources where name = 'World Resources Institute'), 'Better Buying Lab',
  'Technical note (field experiment)', 'A field experiment in a chain of cafés in the United Kingdom tested which menu language leads more eaters to choose plant-based dishes. Compared with names that highlighted the absence of meat, such as "meat-free" or "vegetarian," names that emphasized taste or origin (such as "Cumberland-spiced") or used appealing words for plant-based options (such as "field-grown" or "garden") significantly increased sales of the target vegetarian dishes. General positive words like "better" or "feel good" had no significant effect. The authors encourage foodservice managers to test more appealing names, an easy and inexpensive way to make menus more sustainable.', 'ai_draft', true, 'From the shared Drive folder. AI-drafted from the abstract. Needs review.', null, 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/15LyWmTkXQ3FiT3XIWPm6sExkR8WAv5G6/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/15LyWmTkXQ3FiT3XIWPm6sExkR8WAv5G6/view?usp=drivesdk' and t.name in ('menu language', 'plant-based', 'foodservice', 'behavior change')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, submission_note, status, origin)
select 'https://drive.google.com/file/d/1YD0dCrgXZeJ6-n1lAGhBBON3QhhXukuO/view?usp=drivesdk', 'Association Between Indulgent Descriptions and Vegetable Consumption: Twisted Carrots and Dynamite Beets', 'Bradley P. Turnwald; Danielle Z. Boles; Alia J. Crum', 2017, null,
  (select id from public.sources where name = 'JAMA Internal Medicine'), 'Stanford University',
  'Journal article (research letter)', 'A research letter on a study in a large Stanford University cafeteria that served about 600 diners each weekday lunch. Over 46 days, one featured vegetable each day was labeled in one of four ways (basic, healthy restrictive, healthy positive, or indulgent) with no change to how it was prepared or served. Indulgent labels led 25% more diners to choose the vegetable than basic labels and 41% more than healthy restrictive labels. The authors conclude that the flavorful, exciting descriptions usually reserved for less healthy foods can increase vegetable consumption.', 'ai_draft', true, 'From the shared Drive folder. AI-drafted from the first page. Authors and year taken from the file name and the masterclass citation (Turnwald, Boles, and Crum 2017). Please confirm. Needs review.', null, 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1YD0dCrgXZeJ6-n1lAGhBBON3QhhXukuO/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1YD0dCrgXZeJ6-n1lAGhBBON3QhhXukuO/view?usp=drivesdk' and t.name in ('menu language', 'taste-focused labeling', 'vegetables', 'university dining')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, submission_note, status, origin)
select 'https://drive.google.com/file/d/17XMZfC6Tl_LlqfBBQboQ0DuGU2k_3DA-/view?usp=drivesdk', 'Eating for the Climate: Research Findings and Recommendations for a Low-Carbon Food Initiative', 'Alejandra Marquez; Samantha Derrick; Kristine Madsen; Ricardo San Martin', null, null,
  (select id from public.sources where name = 'Berkeley Food Institute (University of California, Berkeley)'), 'School of Public Health and Sutardja Center for Entrepreneurship & Technology, University of California, Berkeley',
  'Report', 'A report from University of California, Berkeley researchers on how foodservice institutions can advance plant-forward eating, written to guide a low-carbon food initiative for campus dining. It reviews consumption trends among young people, barriers and motivations for climate-friendly eating, and the unconscious nature of food choices. It profiles initiatives at Boston University, the University of North Texas, and Harvard University, and it groups communication strategies under language, placement, presentation, promotion, and people.', 'ai_draft', true, 'From the shared Drive folder. AI-drafted from the contents and executive summary. Publication year not shown. Needs review.', null, 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/17XMZfC6Tl_LlqfBBQboQ0DuGU2k_3DA-/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/17XMZfC6Tl_LlqfBBQboQ0DuGU2k_3DA-/view?usp=drivesdk' and t.name in ('plant-forward', 'university dining', 'climate communication', 'behavior change', 'foodservice')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, submission_note, status, origin)
select 'https://drive.google.com/file/d/1tVgmt6krm3_mivEEsWNFj0B0AUJ5w8tL/view?usp=drivesdk', 'Delicious Impressions Support Healthy Eating (DISH) Study: Executive Summary', 'Menus of Change University Research Collaborative', null, null,
  (select id from public.sources where name = 'Menus of Change University Research Collaborative'), 'Stanford Prevention Research Center; Stanford University Residential & Dining Enterprises; Culinary Institute of America',
  'Executive summary (multisite study)', 'The executive summary of the Delicious Impressions Support Healthy Eating study, the first multisite study to use campus dining halls as living laboratories for research on eating behaviors. Researchers at five colleges and universities in the United States tracked nearly 140,000 diner decisions over 185 days to test whether taste-focused labels lead more people to choose vegetables. The summary covers the background, research model, key insights, and opportunities for impact.', 'ai_draft', true, 'From the shared Drive folder. AI-drafted from the opening pages. Publication year not shown. The full study is the Psychological Science article by Turnwald and colleagues (2019). Needs review.', null, 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1tVgmt6krm3_mivEEsWNFj0B0AUJ5w8tL/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1tVgmt6krm3_mivEEsWNFj0B0AUJ5w8tL/view?usp=drivesdk' and t.name in ('taste-focused labeling', 'vegetables', 'university dining', 'menu language')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, submission_note, status, origin)
select 'https://drive.google.com/file/d/1gg31hC7fQgsTnmwpufmXjjT_3BGMHLI3/view?usp=drivesdk', 'Consumers underestimate the emissions associated with food but are aided by labels', 'Adrian R. Camilleri; Richard P. Larrick; Shajuti Hossain; Dalia Patino-Echeverri', 2019, 'doi:10.1038/s41558-018-0354-z',
  (select id from public.sources where name = 'Nature Climate Change'), null,
  'Journal article', 'Two studies on how well eaters understand the climate impact of food. In the first, participants significantly underestimated the energy use and greenhouse gas emissions of foods, which the authors call a blind spot suited to intervention. In the second, labels that expressed a food''s life-cycle emissions in a familiar unit, minutes of running a light bulb, shifted actual purchases away from higher-emission options. The authors conclude that a well-designed carbon label is a promising, simple intervention.', 'ai_draft', true, 'From the shared Drive folder. AI-drafted from the abstract. Year is the journal issue year, not shown in the file. Please confirm. Needs review.', null, 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1gg31hC7fQgsTnmwpufmXjjT_3BGMHLI3/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1gg31hC7fQgsTnmwpufmXjjT_3BGMHLI3/view?usp=drivesdk' and t.name in ('carbon labeling', 'eco-label', 'greenhouse gas emissions', 'climate communication', 'retail')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, submission_note, status, origin)
select 'https://drive.google.com/file/d/13wtkyvkUY-jwgcC87ajth07BgrmvQUvl/view?usp=drivesdk', 'Food labeling and eco-friendly consumption: Experimental evidence from a Belgian supermarket', 'Pieter Vlaeminck; Ting Jiang; Liesbet Vranken', 2014, 'Ecological Economics 108: 180–190',
  (select id from public.sources where name = 'Ecological Economics (Elsevier)'), 'KU Leuven; University of Pennsylvania',
  'Journal article (field experiment)', 'A framed field experiment in a Belgian supermarket on whether eaters buy more eco-friendly food when information about a product''s environmental impact is easier to use. An online survey first picked the most accessible of six label designs, some of which added a single overall environmental score. In the experimental market, that label made purchases about 5.3% more eco-friendly than the label the supermarket already used, and it also beat a label that showed the raw environmental data.', 'ai_draft', true, 'From the shared Drive folder. AI-drafted from the abstract. Needs review.', null, 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/13wtkyvkUY-jwgcC87ajth07BgrmvQUvl/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/13wtkyvkUY-jwgcC87ajth07BgrmvQUvl/view?usp=drivesdk' and t.name in ('eco-label', 'retail', 'behavior change', 'sustainable food consumption')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, submission_note, status, origin)
select 'https://drive.google.com/file/d/1q_ktWKGHK7W5gSIA7vpIHqDjqVNWWvgP/view?usp=drivesdk', 'Increasing Vegetable Intake by Emphasizing Tasty and Enjoyable Attributes: A Randomized Controlled Multisite Intervention for Taste-Focused Labeling', 'Bradley P. Turnwald; Jaclyn D. Bertoldo; Margaret A. Perry; Alia J. Crum; and others', 2019, 'doi:10.1177/0956797619872191',
  (select id from public.sources where name = 'Psychological Science'), 'Menus of Change University Research Collaborative; Stanford University',
  'Journal article (preregistered intervention)', 'A preregistered intervention at five university dining halls in the United States tested whether taste-focused labels increase vegetable intake compared with health-focused labels. Across 137,842 diner decisions, 185 days, and 24 types of vegetables, taste-focused labels increased vegetable selection by 29% compared with health-focused labels and by 14% compared with basic labels, and vegetable consumption also rose. Expectations of a positive taste experience explained the effect, which was larger where the vegetable recipes were tastier. Taste-focused labels outperformed labels with merely positive words, fancy words, or lists of ingredients.', 'ai_draft', true, 'From the shared Drive folder. AI-drafted from the abstract. Needs review.', null, 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1q_ktWKGHK7W5gSIA7vpIHqDjqVNWWvgP/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1q_ktWKGHK7W5gSIA7vpIHqDjqVNWWvgP/view?usp=drivesdk' and t.name in ('taste-focused labeling', 'vegetables', 'university dining', 'menu language', 'behavior change')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, submission_note, status, origin)
select 'https://drive.google.com/file/d/1OvpKT-I2SMtvN5sevO-Y2XUcjgQZfCBG/view?usp=drivesdk', 'It''s All in a Name: How to Boost the Sales of Plant-based Menu Items', 'Better Buying Lab, World Resources Institute', 2019, 'February 2019',
  (select id from public.sources where name = 'World Resources Institute'), 'Better Buying Lab',
  'Commentary', 'A short commentary from the World Resources Institute''s Better Buying Lab on menu language that suppresses or boosts appetite for plant-rich dishes among mainstream diners in the United States and the United Kingdom. It advises against "meat-free," "vegan," "vegetarian," and healthy restrictive terms like "low fat," noting that sales of two Sainsbury''s dishes rose 76% when "meat free" was replaced with a more appealing name. It recommends highlighting provenance and flavor instead.', 'ai_draft', true, 'From the shared Drive folder. AI-drafted from the first pages. Needs review.', null, 'approved', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1OvpKT-I2SMtvN5sevO-Y2XUcjgQZfCBG/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1OvpKT-I2SMtvN5sevO-Y2XUcjgQZfCBG/view?usp=drivesdk' and t.name in ('menu language', 'plant-based', 'foodservice', 'retail')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, submission_note, status, origin)
select 'https://docs.google.com/document/d/1XZEGCLlytkpdD16p3Y_X3sfnGxggi5hVvMysPLVHwQw/edit', 'The Language of Climate-Smart Food: An Insights Repository', 'Food for Climate League', 2023, null,
  (select id from public.sources where name = 'Food for Climate League'), null,
  'Curated research guide', 'A curated guide from the Food for Climate League to research, insights, case studies, and strategies on how best to talk about climate-beneficial food. It accompanies a shared folder of reports for the league''s research collaborators, with links and summary notes for each item, and it marks key takeaways in bold.', 'ai_draft', true, 'AI-drafted from the opening paragraph. Year taken from the file name.', 'From the shared Drive folder. This is the Food for Climate League''s own curated guide, and it mentions keeping proprietary or confidential items in a separate folder. Please decide whether partners should see it.', 'pending', 'import'
where not exists (select 1 from public.articles where url = 'https://docs.google.com/document/d/1XZEGCLlytkpdD16p3Y_X3sfnGxggi5hVvMysPLVHwQw/edit');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://docs.google.com/document/d/1XZEGCLlytkpdD16p3Y_X3sfnGxggi5hVvMysPLVHwQw/edit' and t.name in ('climate communication', 'menu language')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, submission_note, status, origin)
select 'https://drive.google.com/file/d/1Tzx0jNNh8kojPff20043XHWHktvmLLhe/view?usp=drivesdk', 'Flip Dish Toolkit: A Step-by-Step Guide to Choosing a Sustainable Seafood or Plant-Based Flip Dish', 'Food for Climate League; Sodexo Future Food Collective', null, null,
  (select id from public.sources where name = 'Food for Climate League'), 'Sodexo',
  'Toolkit', 'A step-by-step guide for Sodexo culinary teams on choosing which meat and poultry dishes to "flip" to sustainable seafood or plant-based versions without losing brand or customer satisfaction. It ties the work to Sodexo''s Better Tomorrow 2025 strategy, which aims to cut carbon emissions by 34% and food waste by 50% and to source 100% sustainable seafood by 2025.', 'ai_draft', true, 'AI-drafted from the opening page. Publication year not shown.', 'From the shared Drive folder. Made for a client (Sodexo), so please check whether it can be shared with partners.', 'pending', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1Tzx0jNNh8kojPff20043XHWHktvmLLhe/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1Tzx0jNNh8kojPff20043XHWHktvmLLhe/view?usp=drivesdk' and t.name in ('seafood', 'plant-based', 'foodservice', 'menu design')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, submission_note, status, origin)
select 'https://docs.google.com/presentation/d/1bTorJ6tz_2LuK3JnJYC4pA-qFfcBAcaNYAEgC-ueum8/edit', 'Menu Language Toolkit: A Step-by-Step Guide to Optimizing Agrobiodiverse Recipe Descriptions', 'Food for Climate League; Sodexo', null, null,
  (select id from public.sources where name = 'Food for Climate League'), 'Sodexo',
  'Toolkit', 'A toolkit for chefs on naming and describing dishes that use a wider range of ingredients. It opens with the Knorr and World Wildlife Fund finding that 75% of the global food supply comes from only 12 plant and five animal species, though 250,000 to 300,000 edible plant species are known. It explains that a dish''s name and description appeal differently to different groups of diners and walks through how to write descriptions that make agrobiodiverse dishes craveable.', 'ai_draft', true, 'AI-drafted from the opening slides. Publication year not shown.', 'From the shared Drive folder. Made with a client (Sodexo), so please check whether it can be shared with partners.', 'pending', 'import'
where not exists (select 1 from public.articles where url = 'https://docs.google.com/presentation/d/1bTorJ6tz_2LuK3JnJYC4pA-qFfcBAcaNYAEgC-ueum8/edit');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://docs.google.com/presentation/d/1bTorJ6tz_2LuK3JnJYC4pA-qFfcBAcaNYAEgC-ueum8/edit' and t.name in ('agrobiodiversity', 'menu language', 'chefs', 'diversified diets')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, submission_note, status, origin)
select 'https://drive.google.com/file/d/1MRAdgWAGTMjSrnfdmRabAAGKMRxO0rBc/view?usp=drivesdk', 'Google Sustainable Dish Choice Case Study: Menu Descriptions and Iconography', 'Food for Climate League', 2020, null,
  (select id from public.sources where name = 'Food for Climate League'), 'Google',
  'Case study', 'A Food for Climate League case study with Google''s food program on what drives sustainable food choices and whether menu language and a climate icon can guide them. The team developed five narrative and iconography themes, tested dish titles and icons through Datassential, and measured purchase intent alongside other measures to see whether the titles or icons raised eater interest in climate-friendly dishes.', 'ai_draft', true, 'AI-drafted from the opening pages. The file name says 2020/2021.', 'From the shared Drive folder. A client case study (Google), so please check whether it can be shared with partners.', 'pending', 'import'
where not exists (select 1 from public.articles where url = 'https://drive.google.com/file/d/1MRAdgWAGTMjSrnfdmRabAAGKMRxO0rBc/view?usp=drivesdk');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://drive.google.com/file/d/1MRAdgWAGTMjSrnfdmRabAAGKMRxO0rBc/view?usp=drivesdk' and t.name in ('menu language', 'eco-label', 'climate communication', 'foodservice')
on conflict do nothing;

insert into public.articles
  (url, title, authors, publication_year, publication_details, source_id, related_organizations,
   resource_type, summary, summary_origin, summary_needs_review, admin_notes, submission_note, status, origin)
select 'https://docs.google.com/presentation/d/1o0iv0LAWKz9hhPCto3ZRsbzxCvRtcaSzriWp3_3BSpE/edit', 'Masterclass 1: How to Talk About Sustainable Foods on Your Menu', 'Gesina Beckert; Neeti Jain', null, null,
  (select id from public.sources where name = 'BITE: Building Impact Through Eaters'), null,
  'Slide deck (training)', 'A draft slide deck for the first session of the Sustainable Menus masterclass series from BITE: Building Impact Through Eaters (BITE), hosted by Director of Programs Gesina Beckert and Senior Partnerships Manager Neeti Jain. It teaches four techniques for naming sustainable dishes so they sell: build on current trends and familiarity, remove words that cue restriction or loss, highlight popularity or tradition, and add delicious descriptions. Examples include a 13% sales lift at Panera Bread when "Low-Fat Vegetarian Black Bean Soup" became "Cuban Black Bean Soup."', 'ai_draft', true, 'AI-drafted from the full deck.', 'Shared directly. The file is marked INTERNAL and is a draft, so please decide whether partners should see it.', 'pending', 'import'
where not exists (select 1 from public.articles where url = 'https://docs.google.com/presentation/d/1o0iv0LAWKz9hhPCto3ZRsbzxCvRtcaSzriWp3_3BSpE/edit');

insert into public.article_topics (article_id, topic_id)
select a.id, t.id from public.articles a, public.topics t
where a.url = 'https://docs.google.com/presentation/d/1o0iv0LAWKz9hhPCto3ZRsbzxCvRtcaSzriWp3_3BSpE/edit' and t.name in ('menu language', 'foodservice', 'narrative design', 'behavior change')
on conflict do nothing;
