-- The Seed: longer summaries behind a "Go deeper" button.
-- Paste this whole file into Supabase > SQL Editor and click Run. It's safe to run more than once.
-- Each article gets up to two extra summaries, written from its full text: about one page and about five pages.
-- They follow the article's own access rules (internal articles stay staff-only).
alter table public.articles add column if not exists summary_page text;   -- about one page
alter table public.articles add column if not exists summary_long text;   -- about five pages
