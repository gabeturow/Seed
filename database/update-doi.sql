-- Each article's DOI and its original web link, kept apart from the stored PDF. Run once in Supabase (SQL editor).
alter table public.articles add column if not exists doi text;
alter table public.articles add column if not exists source_url text;          -- the article's own web page, if any
alter table public.articles add column if not exists doi_checked_at timestamptz; -- set once the DOI lookup has tried

-- Fill source_url from the link, or (for articles whose link was replaced by a stored PDF) from the admin note.
update public.articles set source_url = url where source_url is null and url is not null and url not like '/library/%';
update public.articles set source_url = substring(admin_notes from 'Original link: (\S+)')
  where source_url is null and url like '/library/%' and admin_notes ~ 'Original link: \S+';
