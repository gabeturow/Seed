-- The Seed: a shared cache for outside web searches and article readings, so the same lookup isn't repeated.
-- Paste this whole file into Supabase > SQL Editor and click Run. It's safe to run more than once.
--
-- Safety: every row is signed by the server with CACHE_SECRET (in .env.local and in Vercel). A row with a missing or wrong
-- signature is ignored, so nobody can plant fake results. Rows from internal articles are readable by staff only.
-- Keys are hashes, so nobody's questions are stored in readable form.

create table if not exists public.lookup_cache (
  key         text primary key,                 -- a hash of the lookup
  internal    boolean not null default false,   -- came from an internal article: staff only
  payload     text not null,                    -- the result, as JSON text
  sig         text not null,                    -- HMAC signature made by the server
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

alter table public.lookup_cache enable row level security;

drop policy if exists "lookup_cache: read" on public.lookup_cache;
create policy "lookup_cache: read" on public.lookup_cache
  for select to authenticated
  using (public.is_approved_user() and expires_at > now() and (not internal or public.is_staff()));

drop policy if exists "lookup_cache: write" on public.lookup_cache;
create policy "lookup_cache: write" on public.lookup_cache
  for insert to authenticated
  with check (public.is_approved_user() and (not internal or public.is_staff()));

-- Anyone approved can clear out expired rows. Nothing else can be changed or removed except by the admin.
drop policy if exists "lookup_cache: clear expired" on public.lookup_cache;
create policy "lookup_cache: clear expired" on public.lookup_cache
  for delete to authenticated
  using (expires_at < now() or public.is_admin());

grant select, insert, delete on public.lookup_cache to authenticated;
revoke all on public.lookup_cache from anon;
