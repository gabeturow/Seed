-- Records that one article cites a list of works, in a single step: new works are added, known ones get the article
-- appended to cited_by. Reference lists are read in parallel, so doing this as separate read-then-write calls let two
-- articles collide (duplicate key on cited_works.key) or overwrite each other's citation. Runs with the caller's
-- permissions (admin only, by the cited_works policy). Run once in Supabase (SQL editor).
create or replace function public.note_cited_works(p_article bigint, p_works jsonb)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.cited_works (key, title, authors, year, cited_by)
  select w->>'key', w->>'title', nullif(w->>'authors', ''), (w->>'year')::int, array[p_article]
  from jsonb_array_elements(p_works) as w
  where coalesce(w->>'key', '') <> ''
  on conflict (key) do update
    set cited_by = case when p_article = any(public.cited_works.cited_by) then public.cited_works.cited_by
                        else array_append(public.cited_works.cited_by, p_article) end;
$$;
revoke all on function public.note_cited_works(bigint, jsonb) from public, anon;
grant execute on function public.note_cited_works(bigint, jsonb) to authenticated;
