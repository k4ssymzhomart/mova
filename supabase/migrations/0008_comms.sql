-- 0008_comms.sql
-- Care-team messaging, per-user notifications, and consent records.

-- Messages (care-team thread, per patient) -----------------------------------
create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics (id) on delete cascade,
  patient_id   uuid not null references public.patients (id) on delete cascade,
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid references public.profiles (id) on delete set null,  -- null = whole care team
  kind         public.message_kind not null default 'text',
  body         text,
  attachments  jsonb not null default '[]'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.messages is 'Care-team messages scoped to a patient thread.';
create index messages_patient_idx on public.messages (patient_id, created_at desc);
create index messages_sender_idx on public.messages (sender_id);
create index messages_recipient_idx on public.messages (recipient_id);

-- Notifications (per recipient profile) --------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  clinic_id    uuid references public.clinics (id) on delete set null,
  type         public.notification_type not null,
  title        text not null,
  body         text,
  payload      jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
comment on table public.notifications is 'Per-user notifications: reminders, achievements, messages, clinical alerts.';
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

-- Consents (compliance record) -----------------------------------------------
create table public.consents (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  patient_id uuid references public.patients (id) on delete cascade,
  clinic_id  uuid references public.clinics (id) on delete set null,
  type       public.consent_type not null,
  status     public.consent_status not null default 'granted',
  version    text,  -- policy version the user agreed to
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.consents is 'Consent capture (data, camera, sharing, research) with policy version + audit trail.';
create index consents_profile_idx on public.consents (profile_id);
create index consents_patient_idx on public.consents (patient_id);

create trigger touch_messages before update on public.messages
  for each row execute function app.touch_updated_at();
create trigger touch_consents before update on public.consents
  for each row execute function app.touch_updated_at();
