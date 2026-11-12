-- Tracks which works the library's articles cite, so the app can suggest the most-cited ones. Run once in the Supabase SQL Editor.
alter table public.articles add column if not exists refs_scanned_at timestamptz;

create table if not exists public.cited_works (
  id bigint generated always as identity primary key,
  key text not null unique,
  title text not null,
  authors text,
  year int,
  cited_by bigint[] not null default '{}',
  status text not null default 'new' check (status in ('new','added','not_found')),
  article_id bigint,
  created_at timestamptz not null default now()
);
alter table public.cited_works enable row level security;
drop policy if exists "cited works: admins" on public.cited_works;
create policy "cited works: admins" on public.cited_works for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
