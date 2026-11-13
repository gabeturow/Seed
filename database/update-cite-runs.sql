-- Background runs of "Find papers your library cites". Run once in Supabase (SQL editor). Admin only.
create table if not exists public.cite_runs (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status       text not null default 'queued' check (status in ('queued','running','done','failed')),
  how_many     int not null default 6,
  min_cites    int not null default 2,
  scanned      int not null default 0,
  processed    int not null default 0,
  added        int not null default 0,
  not_found    int not null default 0,
  phase        text,
  message      text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index if not exists cite_runs_status_idx on public.cite_runs (status, id);
alter table public.cite_runs enable row level security;
drop policy if exists "cite_runs: admin" on public.cite_runs;
create policy "cite_runs: admin" on public.cite_runs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
