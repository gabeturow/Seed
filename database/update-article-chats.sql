-- The Seed: saves each person's conversation about an article to their own account, so it is there next time.
-- Paste this whole file into Supabase > SQL Editor and click Run. It's safe to run more than once.
-- Private: each person can see and change only their own conversations (not even admins can read them).

create table if not exists public.article_chats (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  article_id  bigint not null references public.articles(id) on delete cascade,
  messages    jsonb not null,
  updated_at  timestamptz not null default now(),
  unique (user_id, article_id)
);

alter table public.article_chats enable row level security;

drop policy if exists "article_chats: own" on public.article_chats;
create policy "article_chats: own" on public.article_chats
  for all to authenticated
  using (user_id = auth.uid() and public.is_approved_user())
  with check (
    user_id = auth.uid() and public.is_approved_user()
    and exists (select 1 from public.articles a where a.id = article_id)   -- only articles this person can see
  );
