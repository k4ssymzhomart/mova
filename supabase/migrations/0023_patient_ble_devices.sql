-- 0023_patient_ble_devices.sql
-- Real BLE sensor pairing: which physical WT901BLE68 is bound to which body-site role
-- for a given patient. Web Bluetooth never exposes a MAC address, so `device_id` is the
-- browser-scoped id the platform assigns per (origin, device) pair -- stable across
-- reconnects on the same browser, but not a hardware identity. Role assignment is always
-- explicit (the patient picks a device from the native chooser per role); this table is
-- what makes that explicit binding durable across reloads/browsers and visible to clinicians,
-- instead of the localStorage-only approach used elsewhere.
--
-- Role reuses the existing body_site ontology (0002_schemas_and_enums.sql) rather than a
-- new enum, since body_site already "drives placement-aware sensor handling" -- constrained
-- here to the three sites a post-TKA rehab session actually straps a sensor to.

create table public.patient_ble_devices (
  patient_id        uuid not null references public.patients (id) on delete cascade,
  role              public.body_site not null
                      check (role in ('l_thigh', 'r_thigh', 'l_shank', 'r_shank', 'l_foot', 'r_foot')),
  device_id         text not null,  -- browser-scoped Web Bluetooth id, not a MAC
  device_name       text,           -- as advertised by the browser chooser; may be null
  model             text not null default 'WT901BLE68',
  last_connected_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (patient_id, role)
);
comment on table public.patient_ble_devices is
  'Durable role<->device pairing for real BLE IMU sensors. No battery column: the WT901BLE68 20-byte notify frame carries none, and no separate read path for it exists yet -- surface "not available" in the UI rather than fabricating a value.';

-- One physical device should not silently double up as two roles for the same patient.
create unique index patient_ble_devices_patient_device_idx
  on public.patient_ble_devices (patient_id, device_id);

alter table public.patient_ble_devices enable row level security;

create policy patient_ble_devices_rw on public.patient_ble_devices for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));

create trigger touch_patient_ble_devices before update on public.patient_ble_devices
  for each row execute function app.touch_updated_at();
