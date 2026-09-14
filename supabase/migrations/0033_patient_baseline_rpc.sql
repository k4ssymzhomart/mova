-- 0033_patient_baseline_rpc.sql
-- Phase C: the intake ROM-baseline capture only ever wrote to localStorage
-- (mova.profile.v1), never to Supabase, so patients.baseline stayed '{}' forever and
-- mapBaseline() in realData.ts always returned null -- a permanent, spurious "no
-- baseline" flag in the clinician portal. This RPC lets the intake flow persist the
-- captured baseline to the caller's own patient row.

create or replace function public.save_patient_baseline(p_baseline jsonb)
returns public.patients
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_patient uuid;
  v_row     public.patients;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  v_patient := public.provision_self_serve_patient();
  if v_patient is null then
    raise exception 'caller has no patient record' using errcode = '42501';
  end if;

  update public.patients
     set baseline = coalesce(p_baseline, '{}'::jsonb)
   where id = v_patient
   returning * into v_row;

  return v_row;
end;
$$;
comment on function public.save_patient_baseline(jsonb) is
  'Persist the caller''s intake ROM baseline to their own patient row. SECURITY DEFINER, scoped to the caller.';

grant execute on function public.save_patient_baseline(jsonb) to authenticated;
