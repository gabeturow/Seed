-- Adds the topics used by database/drive-import.json that are not yet in the topics table.
-- Safe to run more than once. Run this in the Supabase SQL editor before importing.
insert into public.topics (name) values
  ('behavioral economics'),
  ('behavioral science'),
  ('choice architecture'),
  ('climate messaging'),
  ('farming'),
  ('meta-analysis'),
  ('public opinion'),
  ('regenerative agriculture'),
  ('supply chains')
on conflict (name) do nothing;
