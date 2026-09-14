-- 0032_protocol_versioning.sql
-- Phase B, part 4: versioned protocol/prescription changes (NTZ DOC-06, AC-08) --
-- every change must be versioned with author + timestamp + an audit event. Reuses the
-- existing `programs` table (a patient's overall rehab plan) rather than introducing a
-- parallel Phoenix-style protocol_assignments table: a protocol change inserts a NEW
-- programs row for the same patient with version+1 and marks the old row superseded,
-- it never mutates a program in place. app.audit_row() is already attached to
-- `programs` (0010_audit.sql), so DOC-06/AC-08's audit-event requirement is satisfied
-- by the existing trigger once callers follow the append+supersede convention below.

alter table public.programs add column if not exists version integer not null default 1;
alter table public.programs add column if not exists superseded_at timestamptz;
alter table public.programs add column if not exists superseded_by uuid references public.programs (id);

comment on column public.programs.version is
  'Protocol version for this patient. A protocol change inserts a new row with version+1; never mutate in place.';
comment on column public.programs.superseded_at is 'Set when a newer version (superseded_by) replaces this program.';
comment on column public.programs.superseded_by is 'The program row that superseded this one, if any.';

create index programs_patient_version_idx on public.programs (patient_id, version desc);
