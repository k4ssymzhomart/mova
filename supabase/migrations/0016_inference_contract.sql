-- 0016_inference_contract.sql
-- The DB surface of the Supabase <-> Python inference contract. The Edge Function
-- enqueues a job (typed request), the Python service (service_role) updates it with the
-- typed result, and a trigger fans the result out to fog_events / session_metrics.
-- The off-DB contract (JSON Schema + Pydantic + TS types) lives in contracts/inference/.
-- PRIVACY: request/result carry DERIVED windows + metrics only — never raw video.

create table public.inference_jobs (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid references public.sessions (id) on delete cascade,
  patient_id   uuid not null references public.patients (id) on delete cascade,
  clinic_id    uuid not null references public.clinics (id) on delete cascade,
  task         public.inference_task not null,
  status       public.inference_status not null default 'queued',
  model_id     uuid references public.model_registry (id) on delete set null,
  request      jsonb not null,        -- InferenceRequest (contracts/inference/v1)
  result       jsonb,                 -- InferenceResponse (contracts/inference/v1)
  error        text,
  requested_by uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
comment on table public.inference_jobs is 'Typed handoff to the Python inference service; result fans out to clinical tables.';
create index inference_jobs_session_idx on public.inference_jobs (session_id);
create index inference_jobs_patient_idx on public.inference_jobs (patient_id, created_at desc);
create index inference_jobs_status_idx on public.inference_jobs (status) where status in ('queued', 'running');

create trigger touch_inference_jobs before update on public.inference_jobs
  for each row execute function app.touch_updated_at();
create trigger audit_inference_jobs after insert or update or delete on public.inference_jobs
  for each row execute function app.audit_row();

-- RLS + grants (this table postdates the blanket grants in 0012) --------------
alter table public.inference_jobs enable row level security;
create policy inference_jobs_rw on public.inference_jobs for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));

grant select, insert, update, delete on public.inference_jobs to authenticated;
grant all on public.inference_jobs to service_role;
