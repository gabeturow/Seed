-- The Seed: update for the research assistant and the scout.
-- Paste this whole file into Supabase > SQL Editor and click Run. It's safe to run more than once.

-- 1. A place to keep each article's full text, so the research assistant can read it.
alter table public.articles add column if not exists full_text text;

-- 2. Website addresses for the vetted sources. The assistant searches only these sites,
--    and the scout checks them for new research. You can fix or add any of these on the Sources page.
update public.sources s set website_url = v.url
from (values
  ('American College of Lifestyle Medicine', 'https://lifestylemedicine.org'),
  ('American Heart Association', 'https://heart.org'),
  ('Anthesis', 'https://anthesisgroup.com'),
  ('ATNI (Access to Nutrition Initiative)', 'https://accesstonutrition.org'),
  ('B Lab (GreenSHOUTING Guide)', 'https://bcorporation.net'),
  ('Bain & Company', 'https://bain.com'),
  ('BCG (Boston Consulting Group)', 'https://bcg.com'),
  ('Better Food Foundation', 'https://betterfoodfoundation.org'),
  ('BSR (Business for Social Responsibility)', 'https://bsr.org'),
  ('Ceres', 'https://ceres.org'),
  ('Climate Power', 'https://climatepower.us'),
  ('Compassion in World Farming', 'https://ciwf.org.uk'),
  ('Creatives for Climate', 'https://creativesforclimate.co'),
  ('Culinary Institute of America', 'https://ciachef.edu'),
  ('Datassential', 'https://datassential.com'),
  ('Deloitte', 'https://deloitte.com'),
  ('Eat Well Global', 'https://eatwellglobal.com'),
  ('Edelman', 'https://edelman.com'),
  ('Environmental Defense Fund', 'https://edf.org'),
  ('Farm Forward', 'https://farmforward.com'),
  ('Fenton', 'https://fenton.com'),
  ('Food + Planet', 'https://foodandplanet.org'),
  ('Food System Innovations', 'https://foodsysteminnovations.org'),
  ('Foodminds', 'https://foodminds.com'),
  ('Fortnight Collective', 'https://fortnightcollective.com'),
  ('Friends of the Earth', 'https://foe.org'),
  ('Futerra', 'https://wearefuterra.com'),
  ('GAIN (Global Alliance for Improved Nutrition)', 'https://gainhealth.org'),
  ('GMMB', 'https://gmmb.com'),
  ('Good Food Institute', 'https://gfi.org'),
  ('Good Food Purchasing Program', 'https://goodfoodpurchasing.org'),
  ('Greener by Default', 'https://greenerbydefault.com'),
  ('Hartman Group', 'https://hartman-group.com'),
  ('Hubbub', 'https://hubbub.org.uk'),
  ('Humane World for Animals', 'https://humaneworld.org'),
  ('James Beard Foundation', 'https://jamesbeard.org'),
  ('Ketchum', 'https://ketchum.com'),
  ('KitchenTown', 'https://kitchentown.com'),
  ('KK&P (Karen Karp & Partners)', 'https://karenkarp.com'),
  ('KPMG', 'https://kpmg.com'),
  ('Mattson', 'https://mattson.com'),
  ('McKinsey & Company', 'https://mckinsey.com'),
  ('Menus of Change University Research Collaborative', 'https://moccollaborative.org'),
  ('Mercy For Animals', 'https://mercyforanimals.org'),
  ('Natural Resources Defense Council', 'https://nrdc.org'),
  ('New Roots Institute', 'https://newrootsinstitute.org'),
  ('NielsenIQ', 'https://nielseniq.com'),
  ('NNOCCI', 'https://nnocci.org'),
  ('Ogilvy', 'https://ogilvy.com'),
  ('One Kitchen (Wholesome Wave)', 'https://wholesomewave.org'),
  ('Porter Novelli', 'https://porternovelli.com'),
  ('ProVeg', 'https://proveg.org'),
  ('Rare', 'https://rare.org'),
  ('Real Food Challenge', 'https://realfoodchallenge.org'),
  ('ReFED', 'https://refed.org'),
  ('Rouxbe', 'https://rouxbe.com'),
  ('Spitfire Strategies', 'https://spitfirestrategies.com'),
  ('Sustainable America', 'https://sustainableamerica.org'),
  ('Sustainable Restaurant Association', 'https://thesra.org'),
  ('The Culinary Edge', 'https://culinaryedge.com'),
  ('Topos Partners', 'https://topospartnership.com'),
  ('Weber Shandwick', 'https://webershandwick.com'),
  ('World Resources Institute', 'https://wri.org'),
  ('World Wildlife Fund', 'https://worldwildlife.org'),
  ('WRAP Americas', 'https://wrap.ngo'),
  ('YouGov', 'https://yougov.com'),
  ('Appetite (Elsevier)', 'https://sciencedirect.com'),
  ('Food and Agriculture Organization of the United Nations (FAO)', 'https://fao.org'),
  ('Knorr', 'https://knorr.com'),
  ('Nature', 'https://nature.com'),
  ('The Lancet', 'https://thelancet.com'),
  ('United Nations Environment Programme (UNEP)', 'https://unep.org'),
  ('World Business Council for Sustainable Development (WBCSD)', 'https://wbcsd.org'),
  ('Berkeley Food Institute (University of California, Berkeley)', 'https://food.berkeley.edu'),
  ('BITE: Building Impact Through Eaters', 'https://wearebite.org'),
  ('Ecological Economics (Elsevier)', 'https://sciencedirect.com'),
  ('Food for Climate League', 'https://foodforclimateleague.org'),
  ('JAMA Internal Medicine', 'https://jamanetwork.com'),
  ('Nature Climate Change', 'https://nature.com'),
  ('Psychological Science', 'https://journals.sagepub.com')
) as v(name, url)
where s.name = v.name and (s.website_url is null or s.website_url = '');

-- 3. Share links for the research assistant's answers.
-- (If you have already run update-access.sql, run it again after this file: it puts the staff-only rule back on shared answers.)
-- ---------- Shared answers ----------
-- Answers from the research assistant that someone chose to share by link.
create table if not exists public.shared_answers (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  doc         jsonb not null
);

-- Any approved member can open one by its link; you can share as yourself; you (or the admin) can remove yours.
alter table public.shared_answers enable row level security;
drop policy if exists "shared_answers: read" on public.shared_answers;
create policy "shared_answers: read" on public.shared_answers
  for select to authenticated using (public.is_approved_user());
drop policy if exists "shared_answers: share" on public.shared_answers;
create policy "shared_answers: share" on public.shared_answers
  for insert to authenticated with check (public.is_approved_user() and created_by = auth.uid());
drop policy if exists "shared_answers: delete own or admin" on public.shared_answers;
create policy "shared_answers: delete own or admin" on public.shared_answers
  for delete to authenticated using (created_by = auth.uid() or public.is_admin());

grant select, insert, delete on public.shared_answers to authenticated;
