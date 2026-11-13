-- Saved Ask conversations. Run this once in Supabase (SQL editor).
-- Each person's questions, answers and follow-ups are saved to their own account and are private to them
-- (not even admins can read them). A conversation that drew on internal articles is hidden again if the person
-- is no longer staff.

create table if not exists public.ask_threads (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question    text not null,
  turns       jsonb not null,                       -- [{ question, answer, library, outside }, ...]
  internal    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ask_threads_user_idx on public.ask_threads (user_id, updated_at desc);

alter table public.ask_threads enable row level security;

drop policy if exists "ask_threads: own" on public.ask_threads;
create policy "ask_threads: own" on public.ask_threads
  for all to authenticated
  using (user_id = auth.uid() and public.is_approved_user() and (not internal or public.is_staff()))
  with check (user_id = auth.uid() and public.is_approved_user() and (not internal or public.is_staff()));
