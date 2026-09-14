-- schema_guards_test.sql — structural guardrails, not scenario tests. Catches the
-- "forgot RLS on a new table" footgun: the 0012 blanket grant
-- (`grant ... on all tables in schema public to authenticated`) only ever applied
-- once, at migration time -- a later migration that grants broad access but forgets
-- `enable row level security` on a new table would otherwise go unnoticed until a
-- real PHI leak. Run with:  supabase test db

begin;
select plan(1);

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every table in the public schema has row level security enabled'
);

select * from finish();
rollback;
