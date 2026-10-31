-- =====================================================================
-- GeoWrisX AD V2 — Neon Postgres schema
-- Identity: Clerk user ids (`user_...`) stored as text.
-- Access:   every query runs inside Cloudflare Pages Functions with the
--           authenticated Clerk user id. There is no browser -> database
--           connection, so authorization lives in the API queries and in
--           approve_pillbox_request(). No Supabase RLS policies are used.
--
-- Run:      psql "$NEON_DATABASE_URL" -f db/schema.sql
-- Safe to re-run (idempotent).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- patients
create table if not exists public.patients (
  id            uuid primary key default gen_random_uuid(),
  owner_id      text not null,
  display_name  text not null,
  relationship  text,
  date_of_birth date,
  is_archived   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.patients
  add column if not exists relationship  text,
  add column if not exists date_of_birth date,
  add column if not exists is_archived   boolean not null default false,
  add column if not exists updated_at    timestamptz not null default now();

alter table public.patients drop constraint if exists patients_owner_id_check;
alter table public.patients
  add constraint patients_owner_id_check
  check (char_length(owner_id) between 1 and 64);

alter table public.patients drop constraint if exists patients_display_name_length_check;
alter table public.patients
  add constraint patients_display_name_length_check
  check (char_length(btrim(display_name)) between 2 and 100);

alter table public.patients drop constraint if exists patients_relationship_length_check;
alter table public.patients
  add constraint patients_relationship_length_check
  check (relationship is null or char_length(btrim(relationship)) <= 80);

alter table public.patients drop constraint if exists patients_date_of_birth_check;
alter table public.patients
  add constraint patients_date_of_birth_check
  check (date_of_birth is null or date_of_birth <= current_date);

-- ---------------------------------------------------------------- devices
create table if not exists public.devices (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients(id) on delete cascade,
  device_type     text not null check (device_type in ('wristband', 'pillbox', 'gateway')),
  device_name     text not null check (char_length(btrim(device_name)) between 1 and 120),
  status          text not null default 'unknown' check (status in ('online', 'offline', 'unknown')),
  battery_percent integer check (battery_percent between 0 and 100),
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- alerts
create table if not exists public.alerts (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients(id) on delete cascade,
  device_id       uuid references public.devices(id) on delete set null,
  alert_type      text not null check (alert_type in ('GEOFENCE_EXIT', 'TAMPER', 'LOW_BATTERY', 'BLE_DISCONNECTED', 'OTHER')),
  severity        text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  message         text not null check (char_length(btrim(message)) between 1 and 300),
  occurred_at     timestamptz not null default now(),
  acknowledged_at timestamptz,
  -- Clerk user id (previously auth.users uuid in the Supabase build)
  acknowledged_by text
);

-- -------------------------------------------------------- pillbox approvals
create table if not exists public.pillbox_approvals (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients(id) on delete cascade,
  compartment_no integer not null check (compartment_no between 1 and 3),
  status         text not null default 'pending' check (status in ('pending', 'approved', 'expired', 'rejected')),
  -- Written only by the trusted device ingestion function after local BLE verification.
  ble_verified   boolean not null default false,
  requested_at   timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '60 seconds'),
  approved_at    timestamptz,
  approved_by    text
);

-- --------------------------------------------------------- device commands
create table if not exists public.device_commands (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients(id) on delete cascade,
  approval_id    uuid unique references public.pillbox_approvals(id) on delete cascade,
  command_type   text not null check (command_type in ('UNLOCK_COMPARTMENT')),
  compartment_no integer not null check (compartment_no between 1 and 3),
  status         text not null default 'queued' check (status in ('queued', 'sent', 'executed', 'failed', 'expired')),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);

-- ------------------------------------------------------ caregiver profiles
create table if not exists public.caregiver_profiles (
  user_id                 text primary key,
  full_name               text not null check (char_length(btrim(full_name)) between 2 and 100),
  phone                   text,
  relationship_to_patient text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint caregiver_profiles_phone_length_check
    check (phone is null or char_length(btrim(phone)) <= 30),
  constraint caregiver_profiles_relationship_length_check
    check (relationship_to_patient is null or char_length(btrim(relationship_to_patient)) <= 80)
);

-- ----------------------------------------------------------- patient files
-- Metadata for objects stored in the Cloudflare R2 bucket bound as FILES.
create table if not exists public.patient_files (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients(id) on delete cascade,
  object_key   text not null unique,
  file_name    text not null check (char_length(file_name) between 1 and 200),
  content_type text not null default 'application/octet-stream',
  size_bytes   bigint not null check (size_bytes > 0),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes
create index if not exists patients_owner_created_idx
  on public.patients (owner_id, created_at desc);
create index if not exists patients_owner_archived_created_idx
  on public.patients (owner_id, is_archived, created_at desc);
create index if not exists devices_patient_id_idx
  on public.devices (patient_id);
create index if not exists alerts_patient_time_idx
  on public.alerts (patient_id, occurred_at desc);
create index if not exists approvals_patient_time_idx
  on public.pillbox_approvals (patient_id, requested_at desc);
create index if not exists commands_patient_time_idx
  on public.device_commands (patient_id, created_at desc);
create index if not exists patient_files_patient_time_idx
  on public.patient_files (patient_id, created_at desc);

-- ----------------------------------------------------------- updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists patients_set_updated_at on public.patients;
create trigger patients_set_updated_at
  before update on public.patients
  for each row execute function public.set_updated_at();

drop trigger if exists caregiver_profiles_set_updated_at on public.caregiver_profiles;
create trigger caregiver_profiles_set_updated_at
  before update on public.caregiver_profiles
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Atomic pillbox approval
-- Validates owner + pending state + non-expired request + BLE proof, then
-- queues a short-lived command. It does NOT actuate a physical lock.
-- Error codes are mapped to HTTP responses in functions/api/approve-pillbox.js.
-- =====================================================================
create or replace function public.approve_pillbox_request(
  p_request_id uuid,
  p_user_id    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request    public.pillbox_approvals%rowtype;
  v_command_id uuid;
begin
  if p_user_id is null or btrim(p_user_id) = '' then
    raise exception using message = 'REQUEST_NOT_FOUND', errcode = 'P0002';
  end if;

  select a.* into v_request
  from public.pillbox_approvals a
  join public.patients p on p.id = a.patient_id
  where a.id = p_request_id
    and p.owner_id = p_user_id
  for update of a;

  if not found then
    raise exception using message = 'REQUEST_NOT_FOUND', errcode = 'P0002';
  end if;

  if v_request.status <> 'pending' then
    raise exception using message = 'REQUEST_NOT_PENDING', errcode = 'P0001';
  end if;

  if v_request.ble_verified is not true then
    raise exception using message = 'BLE_NOT_VERIFIED', errcode = 'P0001';
  end if;

  if v_request.expires_at <= now() then
    raise exception using message = 'REQUEST_EXPIRED', errcode = 'P0001';
  end if;

  update public.pillbox_approvals
     set status = 'approved',
         approved_at = now(),
         approved_by = p_user_id
   where id = v_request.id;

  insert into public.device_commands
    (patient_id, approval_id, command_type, compartment_no, status, expires_at)
  values
    (v_request.patient_id, v_request.id, 'UNLOCK_COMPARTMENT', v_request.compartment_no,
     'queued', least(v_request.expires_at, now() + interval '30 seconds'))
  returning id into v_command_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'queued',
    'command_id', v_command_id
  );
end;
$$;

-- =====================================================================
-- Optional: register a device for a patient (replace the placeholders and
-- run once per prototype device, or use the SQL editor).
--
-- insert into public.devices (patient_id, device_type, device_name)
-- values ('<patient uuid>', 'wristband', 'Wristband A-01');
-- =====================================================================
