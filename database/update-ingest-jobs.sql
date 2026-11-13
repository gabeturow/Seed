-- Background queue for "Add an article". Run once in Supabase (SQL editor). Admin only.
create table if not exists public.ingest_jobs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url         text,
  pdf_path    text,
  label       text,
  status      text not null default 'queued' check (status in ('queued','running','done','failed')),
  article_id  bigint references public.articles(id) on delete set null,
  message     text,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz,
  check (url is not null or pdf_path is not null)
);
create index if not exists ingest_jobs_status_idx on public.ingest_jobs (status, id);
alter table public.ingest_jobs enable row level security;
drop policy if exists "ingest_jobs: admin" on public.ingest_jobs;
create policy "ingest_jobs: admin" on public.ingest_jobs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
