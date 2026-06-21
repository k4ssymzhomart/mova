-- 0011_rls_helpers.sql
-- SECURITY DEFINER predicates used by every RLS policy. They read the identity tables
-- with RLS bypassed (definer = postgres), which (a) breaks the policy<->table recursion
-- and (b) centralizes the access model. STABLE so the planner can cache them per query.
-- All are pinned to an empty search_path and fully-qualify every reference.

-- Caller's app role (null if unauthenticated) --------------------------------
create or replace function app.user_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function app.user_clinic_id()
returns uuid
language sql stable security definer set search_path = ''
as $$ select clinic_id from public.profiles where id = auth.uid() $$;

create or replace function app.user_patient_id()
returns uuid
language sql stable security definer set search_path = ''
as $$ select id from public.patients where profile_id = auth.uid() $$;

create or replace function app.user_clinician_id()
returns uuid
language sql stable security definer set search_path = ''
as $$ select id from public.clinicians where profile_id = auth.uid() $$;

-- Role predicates ------------------------------------------------------------
create or replace function app.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select role from public.profiles where id = auth.uid()) = 'admin', false) $$;

create or replace function app.is_clinic_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select role from public.profiles where id = auth.uid()) = 'clinic_admin', false) $$;

create or replace function app.is_clinician()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) in ('clinician', 'clinic_admin'),
    false
  )
$$;

-- Caller belongs to (or administers) the given clinic ------------------------
create or replace function app.is_clinic_member(p_clinic uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_admin()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and clinic_id = p_clinic
    )
$$;

-- The central authorization gate for per-patient rows ------------------------
-- True when the caller is: a platform admin; the patient themselves; a clinician
-- actively linked to the patient; or a clinic_admin of the patient's clinic.
create or replace function app.can_access_patient(p_patient uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    app.is_admin()
    or exists (
      select 1 from public.patients pt
      where pt.id = p_patient and pt.profile_id = auth.uid()
    )
    or exists (
      select 1
      from public.care_team_links l
      join public.clinicians c on c.id = l.clinician_id
      where l.patient_id = p_patient
        and l.is_active
        and c.profile_id = auth.uid()
    )
    or exists (
      select 1
      from public.patients pt
      join public.profiles pr on pr.id = auth.uid()
      where pt.id = p_patient
        and pr.role = 'clinic_admin'
        and pr.clinic_id = pt.clinic_id
    );
$$;
comment on function app.can_access_patient(uuid) is
  'RLS gate: admin | the patient | a linked clinician | the patient''s clinic_admin.';

-- Guard: only an admin may change a profile''s role or home clinic ------------
create or replace function app.enforce_profile_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'role is not self-editable' using errcode = '42501';
    end if;
    if new.clinic_id is distinct from old.clinic_id then
      raise exception 'clinic_id is not self-editable' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

grant usage on schema app to anon, authenticated, service_role;
grant execute on all functions in schema app to anon, authenticated, service_role;
