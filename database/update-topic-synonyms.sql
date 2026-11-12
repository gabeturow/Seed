-- The Seed: topic synonyms, so a search for "recipe naming" finds articles tagged "menu language".
-- Paste this whole file into Supabase > SQL Editor and click Run. It's safe to run more than once.
-- Run database/add-topics.sql first if you haven't.

-- 1. The synonyms table. A synonym is another way to say a topic; searching it finds that topic's articles.
create table if not exists public.topic_synonyms (
  id        bigint generated always as identity primary key,
  topic_id  bigint not null references public.topics(id) on delete cascade,
  synonym   text not null check (synonym = lower(btrim(synonym))),
  unique (topic_id, synonym)
);
create index if not exists topic_synonyms_topic_idx on public.topic_synonyms (topic_id);
alter table public.topic_synonyms enable row level security;
drop policy if exists "topic_synonyms: read" on public.topic_synonyms;
create policy "topic_synonyms: read" on public.topic_synonyms
  for select to authenticated using (public.is_approved_user());
drop policy if exists "topic_synonyms: admin write" on public.topic_synonyms;
create policy "topic_synonyms: admin write" on public.topic_synonyms
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 2. Starting synonyms. Topics that don't exist are skipped.
insert into public.topic_synonyms (topic_id, synonym)
select t.id, s.synonym
from (values
  ('menu language',               'recipe naming'),
  ('menu language',               'dish naming'),
  ('menu language',               'menu naming'),
  ('menu language',               'dish names'),
  ('foodservice',                 'food service'),
  ('foodservice',                 'food-service'),
  ('sustainable food consumption','sustainable food choices'),
  ('regenerative agriculture',    'regenerative farming'),
  ('nudges',                      'nudging'),
  ('university dining',           'campus dining')
) as s(topic, synonym)
join public.topics t on t.name = s.topic
on conflict do nothing;

-- 2b. Clean-up, in case an earlier version of this file was run: these pairs mean different things,
--     so they are not synonyms.
delete from public.topic_synonyms
where synonym in ('farming', 'farmers', 'vegan', 'vegetarian', 'behavioral economics', 'labels', 'labeling',
  'climate messaging', 'behavioral science', 'applied behavioral science', 'behavioural science');

-- 3. Search now also matches a topic's synonyms. Matching ignores spaces and hyphens, so
--    "food service" also finds "foodservice".
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
                 where at2.article_id = a.id
                   and (regexp_replace(lower(tp.name), '[ -]', '', 'g') like '%' || regexp_replace(lower(btrim(q)), '[ -]', '', 'g') || '%'
                        or exists (select 1 from public.topic_synonyms sy
                                   where sy.topic_id = tp.id
                                     and regexp_replace(sy.synonym, '[ -]', '', 'g') like '%' || regexp_replace(lower(btrim(q)), '[ -]', '', 'g') || '%')))
      or exists (select 1 from public.sources s
                 where s.id = a.source_id and s.name ilike '%' || btrim(q) || '%')
    )
  order by
    case when q is null or btrim(q) = '' then 0
         else ts_rank(a.search, websearch_to_tsquery('english', q)) end desc,
    coalesce(a.publication_year, extract(year from a.publication_date)::int) desc nulls last,
    a.title asc;
$$;
grant execute on function public.search_articles(text, bigint, bigint, text) to authenticated;
