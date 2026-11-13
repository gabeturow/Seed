-- Background runs of the scout and "Update the library". Run once in Supabase (SQL editor). Admin only.
create table if not exists public.bg_runs (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('scout','update')),
  params       jsonb not null default '{}'::jsonb,
  progress     jsonb not null default '{}'::jsonb,
  status       text not null default 'queued' check (status in ('queued','running','done','failed')),
  phase        text,
  message      text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index if not exists bg_runs_status_idx on public.bg_runs (status, id);
alter table public.bg_runs enable row level security;
drop policy if exists "bg_runs: admin" on public.bg_runs;
create policy "bg_runs: admin" on public.bg_runs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
