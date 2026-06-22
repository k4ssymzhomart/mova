-- 0010_audit.sql
-- Append-only audit trail for PHI-bearing tables. The trigger is SECURITY DEFINER so
-- authenticated callers (who have no direct write on audit_log) still record an entry.

create table public.audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,            -- auth.uid() at write time (null for service-role/system)
  action      public.audit_action not null,
  table_name  text not null,
  row_id      text,
  clinic_id   uuid,            -- best-effort tenant key for clinic-scoped review
  old_data    jsonb,
  new_data    jsonb
);
comment on table public.audit_log is 'Append-only audit trail. Inserted only by app.audit_row(); clients cannot write it.';
create index audit_log_table_time_idx on public.audit_log (table_name, occurred_at desc);
create index audit_log_clinic_time_idx on public.audit_log (clinic_id, occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id);

-- Generic row auditor. search_path is pinned empty so every reference is explicit.
create or replace function app.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_clinic uuid;
  v_row_id text;
begin
  if tg_op = 'DELETE' then
    v_clinic := nullif(to_jsonb(old) ->> 'clinic_id', '')::uuid;
    v_row_id := to_jsonb(old) ->> 'id';
    insert into public.audit_log (actor_id, action, table_name, row_id, clinic_id, old_data)
      values (v_actor, 'delete', tg_table_name, v_row_id, v_clinic, to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    v_clinic := nullif(to_jsonb(new) ->> 'clinic_id', '')::uuid;
    v_row_id := to_jsonb(new) ->> 'id';
    insert into public.audit_log (actor_id, action, table_name, row_id, clinic_id, old_data, new_data)
      values (v_actor, 'update', tg_table_name, v_row_id, v_clinic, to_jsonb(old), to_jsonb(new));
    return new;
  else
    v_clinic := nullif(to_jsonb(new) ->> 'clinic_id', '')::uuid;
    v_row_id := to_jsonb(new) ->> 'id';
    insert into public.audit_log (actor_id, action, table_name, row_id, clinic_id, new_data)
      values (v_actor, 'insert', tg_table_name, v_row_id, v_clinic, to_jsonb(new));
    return new;
  end if;
end;
$$;
comment on function app.audit_row() is 'AFTER trigger: append the row change to public.audit_log.';

-- Attach to PHI-bearing tables.
create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function app.audit_row();
create trigger audit_patients after insert or update or delete on public.patients
  for each row execute function app.audit_row();
create trigger audit_clinicians after insert or update or delete on public.clinicians
  for each row execute function app.audit_row();
create trigger audit_care_team_links after insert or update or delete on public.care_team_links
  for each row execute function app.audit_row();
create trigger audit_programs after insert or update or delete on public.programs
  for each row execute function app.audit_row();
create trigger audit_prescriptions after insert or update or delete on public.prescriptions
  for each row execute function app.audit_row();
create trigger audit_goals after insert or update or delete on public.goals
  for each row execute function app.audit_row();
create trigger audit_sessions after insert or update or delete on public.sessions
  for each row execute function app.audit_row();
create trigger audit_session_metrics after insert or update or delete on public.session_metrics
  for each row execute function app.audit_row();
create trigger audit_fog_events after insert or update or delete on public.fog_events
  for each row execute function app.audit_row();
create trigger audit_rom_measurements after insert or update or delete on public.rom_measurements
  for each row execute function app.audit_row();
create trigger audit_consents after insert or update or delete on public.consents
  for each row execute function app.audit_row();
create trigger audit_messages after insert or update or delete on public.messages
  for each row execute function app.audit_row();
