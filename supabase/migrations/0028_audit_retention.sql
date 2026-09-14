-- 0028_audit_retention.sql
-- audit_log (0010) stores full to_jsonb(old/new) PHI row snapshots for 14 tables via
-- app.audit_row() triggers, with no retention/purge mechanism anywhere -- confirmed:
-- 0001_extensions.sql enables only pgcrypto/citext/pg_trgm, no pg_cron. It grows
-- unbounded. It also misses several PHI/clinically-relevant tables from its trigger
-- coverage.

create or replace function app.purge_audit_log(p_retain_days integer default 365)
returns bigint
language sql
security definer set search_path = ''
as $$
  with deleted as (
    delete from public.audit_log
    where occurred_at < now() - (p_retain_days || ' days')::interval
    returning 1
  )
  select count(*) from deleted;
$$;
comment on function app.purge_audit_log(integer) is
  'Delete audit_log rows older than p_retain_days. Invoke on a schedule (pg_cron if available; '
  'otherwise a service_role-authenticated call from Supabase Cron Jobs / an external scheduler).';
revoke all on function app.purge_audit_log(integer) from public, anon, authenticated;
grant execute on function app.purge_audit_log(integer) to service_role;

-- Best-effort: schedule the purge via pg_cron if the project's plan allows enabling
-- it. If pg_cron cannot be enabled here, this block is a no-op and the fallback is
-- invoking app.purge_audit_log() from Supabase's dashboard Cron Jobs feature or an
-- external scheduler hitting a service_role-authenticated RPC on a timer.
do $$
begin
  create extension if not exists pg_cron with schema extensions;
  perform cron.schedule('purge-audit-log', '0 3 * * *', $c$select app.purge_audit_log()$c$);
exception when others then
  raise notice 'pg_cron unavailable on this project -- schedule app.purge_audit_log() externally: %', sqlerrm;
end;
$$;

-- Coverage gaps: attach app.audit_row() to tables that carry PHI/clinically-relevant
-- data but currently have no audit trigger. session_frames is scoped to UPDATE/DELETE
-- only -- inserts are the high-volume hot path and rows are otherwise write-once, so
-- an insert audit trigger there would double write volume for no benefit.
create trigger audit_session_frames after update or delete on public.session_frames
  for each row execute function app.audit_row();
create trigger audit_xp_ledger after insert or update or delete on public.xp_ledger
  for each row execute function app.audit_row();
create trigger audit_achievements after insert or update or delete on public.achievements
  for each row execute function app.audit_row();
create trigger audit_streaks after insert or update or delete on public.streaks
  for each row execute function app.audit_row();
create trigger audit_care_plan_overrides after insert or update or delete on public.care_plan_overrides
  for each row execute function app.audit_row();
create trigger audit_clinics after insert or update or delete on public.clinics
  for each row execute function app.audit_row();
create trigger audit_schedules after insert or update or delete on public.schedules
  for each row execute function app.audit_row();
create trigger audit_notifications after insert or update or delete on public.notifications
  for each row execute function app.audit_row();
