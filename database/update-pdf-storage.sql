-- Stores article PDFs on the site itself (Supabase Storage). Run once in the Supabase SQL Editor.
alter table public.articles add column if not exists pdf_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('article-pdfs', 'article-pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

-- Anyone who can see an article (the articles table's own rules apply, so internal ones stay hidden) can open its PDF.
drop policy if exists "article pdfs: read what the article allows" on storage.objects;
create policy "article pdfs: read what the article allows" on storage.objects for select to authenticated
  using (bucket_id = 'article-pdfs' and (
    public.is_admin() or exists (select 1 from public.articles a where a.pdf_path = storage.objects.name)));

drop policy if exists "article pdfs: admins add" on storage.objects;
create policy "article pdfs: admins add" on storage.objects for insert to authenticated
  with check (bucket_id = 'article-pdfs' and public.is_admin());
drop policy if exists "article pdfs: admins change" on storage.objects;
create policy "article pdfs: admins change" on storage.objects for update to authenticated
  using (bucket_id = 'article-pdfs' and public.is_admin());
drop policy if exists "article pdfs: admins remove" on storage.objects;
create policy "article pdfs: admins remove" on storage.objects for delete to authenticated
  using (bucket_id = 'article-pdfs' and public.is_admin());
