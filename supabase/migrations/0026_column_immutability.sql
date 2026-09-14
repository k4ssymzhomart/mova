-- 0026_column_immutability.sql
-- app.freeze_columns() (0003_helpers.sql) was fully implemented but never attached to
-- any trigger -- dead code. patients_update's `with check (can_access_patient(id))`
-- never inspects clinic_id, and can_access_patient's self-branch only checks
-- profile_id = auth.uid(), so a patient's own `UPDATE patients SET clinic_id = ...`
-- passed today, letting a patient rewrite their own tenant key.
--
-- The original freeze_columns() had no bypass for trusted contexts, which would also
-- have blocked legitimate admin clinic transfers and 0023's own backfill. Add the
-- same bypass already proven in app.enforce_profile_guard() (0011): trusted contexts
-- (auth.uid() is null -- migrations, service_role, seed.sql -- or an admin) may still
-- change frozen columns; only an authenticated non-admin end user is blocked.

create or replace function app.freeze_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text;
begin
  if auth.uid() is null or app.is_admin() then
    return new;
  end if;
  foreach col in array tg_argv loop
    if to_jsonb(new) -> col is distinct from to_jsonb(old) -> col then
      raise exception 'column % is immutable', col using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;
comment on function app.freeze_columns() is
  'BEFORE UPDATE trigger: reject changes to TG_ARGV columns unless caller is admin or a trusted (auth.uid() null) context.';

create trigger guard_patients_clinic_id before update on public.patients
  for each row execute function app.freeze_columns('clinic_id');
