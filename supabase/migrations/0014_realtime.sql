-- 0014_realtime.sql
-- Realtime channels: add the live-session + messaging tables to the supabase_realtime
-- publication. RLS still applies to realtime, so subscribers only receive rows they may
-- read. REPLICA IDENTITY FULL ensures UPDATE/DELETE payloads carry the full row.

do $$
declare
  t text;
  realtime_tables text[] := array[
    'sessions', 'session_metrics', 'fog_events', 'notifications', 'messages'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array realtime_tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
