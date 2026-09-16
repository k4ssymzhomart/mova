-- 0029_invitations.sql
-- Clinic-issued patient invitations (NTZ WF-02: invite/QR onboarding). No invitations endpoint existed
-- anywhere in this repo before this migration (confirmed by grep across services/api,
-- services/frontend, supabase/ during planning) — built as Supabase RPCs, matching every other
-- backend feature here (self-serve provisioning, sessions, gamification), not a new services/api
-- surface, which today does ONNX inference only and has no auth-adjacent code at all.
--
-- Only a SHA-256 hash of the invite token is ever stored — the raw token is returned exactly once, to
-- the inviting clinician at creation time, the same way you'd never store a plaintext password. A leaked
-- database dump can't be used to accept invitations.

create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics (id) on delete cascade,
  token_hash   text not null unique,
  email        extensions.citext,
  role         public.app_role not null default 'patient',
  condition_id uuid references public.conditions (id) on delete set null,
  created_by   uuid references public.clinicians (id) on delete set null,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  used_by      uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  -- Patient-only for now: accept_invitation only knows how to provision a patients row on accept.
  -- Clinician onboarding is a different, higher-trust workflow (license verification etc.) that a bare
  -- token isn't an honest substitute for — deferred rather than half-built. clinic_admin/admin are never
  -- issued via self-serve invite either way.
  check (role = 'patient')
);
comment on table public.invitations is
  'Clinic-issued onboarding invitations. token_hash is sha256(raw token) -- the raw token is never stored.';
create index invitations_clinic_idx on public.invitations (clinic_id);
create index invitations_unused_idx on public.invitations (token_hash) where used_at is null;

alter table public.invitations enable row level security;

-- Only clinic members can see their own clinic's invitations (e.g. a "pending invites" list in the
-- portal). Accepting/validating a token happens through the SECURITY DEFINER RPCs below instead, since
-- the person accepting isn't authenticated as a clinic member (often not authenticated at all yet).
drop policy if exists invitations_read on public.invitations;
create policy invitations_read on public.invitations
  for select using (app.is_clinic_member(clinic_id));

-- Issue a new patient invitation for the caller's clinic. Clinician-only. Returns the raw token — the
-- ONLY time it is ever available; the caller is responsible for delivering it (email/SMS/QR), out of
-- scope here. Default validity: 7 days.
create or replace function public.create_invitation(
  p_email          extensions.citext default null,
  p_condition_slug text default null,
  p_expires_hours  integer default 168
)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_clinician public.clinicians;
  v_condition uuid;
  v_token     text;
  v_row       public.invitations;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_clinician from public.clinicians where profile_id = v_uid;
  if v_clinician.id is null then
    raise exception 'caller is not a clinician' using errcode = '42501';
  end if;

  if p_condition_slug is not null then
    select cnd.id into v_condition from public.conditions cnd where cnd.slug = p_condition_slug;
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.invitations (clinic_id, token_hash, email, role, condition_id, created_by, expires_at)
  values (
    v_clinician.clinic_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_email,
    'patient',
    v_condition,
    v_clinician.id,
    now() + make_interval(hours => greatest(1, coalesce(p_expires_hours, 168)))
  )
  returning * into v_row;

  return query select v_row.id, v_token, v_row.expires_at;
end;
$$;
comment on function public.create_invitation(extensions.citext, text, integer) is
  'Issue a patient invitation for the caller''s clinic; returns the raw token once. Clinician-only. SECURITY DEFINER.';

grant execute on function public.create_invitation(extensions.citext, text, integer) to authenticated;

-- Public, unauthenticated: check a token before the person has signed in/up, so the onboarding page can
-- show "you're invited to <clinic>" without requiring auth first. Never reveals the token hash itself.
create or replace function public.validate_invitation(p_token text)
returns table (valid boolean, clinic_name text, role text, expires_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  with match as (
    select i.used_at, i.expires_at, i.role, c.name as clinic_name
    from public.invitations i
    join public.clinics c on c.id = i.clinic_id
    where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    limit 1
  )
  select
    coalesce(m.used_at is null and m.expires_at > now(), false) as valid,
    m.clinic_name,
    m.role::text,
    m.expires_at
  from (select 1) as one
  left join match m on true;
$$;
comment on function public.validate_invitation(text) is
  'Unauthenticated token check for the onboarding preview screen. Never exposes token_hash. SECURITY DEFINER.';

grant execute on function public.validate_invitation(text) to anon, authenticated;

-- Accept an invitation as the now-signed-in caller: attaches them to the inviting clinic as a patient,
-- links them to the inviting clinician via care_team_links, and marks the invitation used (single-use,
-- atomic against a race via the used_at is null guard + row lock).
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_existing_role public.app_role;
  v_inv  public.invitations;
  v_patient uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- A clinician/admin account accepting a patient invite would otherwise end up with a stray patients
  -- row alongside their real role — reject rather than produce confusing dual-identity data.
  select role into v_existing_role from public.profiles where id = v_uid;
  if v_existing_role is not null and v_existing_role <> 'patient' then
    raise exception 'this account is not a patient account' using errcode = '42501';
  end if;

  select * into v_inv from public.invitations
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and used_at is null and expires_at > now()
  for update;

  if v_inv.id is null then
    raise exception 'invitation is invalid, used, or expired' using errcode = '22023';
  end if;

  update public.invitations set used_at = now(), used_by = v_uid where id = v_inv.id;

  insert into public.profiles (id, role, clinic_id)
  values (v_uid, 'patient', v_inv.clinic_id)
  on conflict (id) do update set clinic_id = excluded.clinic_id;

  insert into public.patients (profile_id, clinic_id, enrollment_status, primary_condition_id)
  values (v_uid, v_inv.clinic_id, 'active', v_inv.condition_id)
  on conflict (profile_id) do update set clinic_id = excluded.clinic_id
  returning id into v_patient;

  if v_inv.created_by is not null then
    insert into public.care_team_links (clinic_id, clinician_id, patient_id, relationship)
    values (v_inv.clinic_id, v_inv.created_by, v_patient, 'primary')
    on conflict (clinician_id, patient_id) do nothing;
  end if;

  return v_inv.clinic_id;
end;
$$;
comment on function public.accept_invitation(text) is
  'Attach the signed-in caller to the inviting clinic and mark the invitation used. SECURITY DEFINER.';

grant execute on function public.accept_invitation(text) to authenticated;
