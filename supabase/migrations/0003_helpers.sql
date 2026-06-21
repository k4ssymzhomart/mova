-- 0003_helpers.sql
-- Generic trigger helpers used by every table. Defined before any table so the
-- triggers can attach as tables are created.

-- Keep updated_at honest on every UPDATE.
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
comment on function app.touch_updated_at() is 'BEFORE UPDATE trigger: stamp updated_at = now().';

-- Block client-side edits to columns the database owns (e.g. denormalized tenant
-- keys). Used where a column must be set by trigger/policy, not by the caller.
create or replace function app.freeze_columns()
returns trigger
language plpgsql
as $$
declare
  col text;
begin
  foreach col in array tg_argv loop
    if to_jsonb(new) -> col is distinct from to_jsonb(old) -> col then
      raise exception 'column % is immutable', col using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;
comment on function app.freeze_columns() is 'BEFORE UPDATE trigger: reject changes to the columns named in TG_ARGV.';
