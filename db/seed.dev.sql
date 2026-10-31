-- =====================================================================
-- GeoWrisX AD V2 — sample data for the Neon `dev` branch
--
-- Owner id below is a placeholder. Replace 'user_seed_demo_caregiver' with
-- a real Clerk user id (starts with `user_`) before signing in and testing,
-- or sign in once with Clerk and copy the id from the dashboard payload.
--
-- Apply:
--   psql "$DATABASE_URL" -f db/seed.dev.sql
--   # or point DATABASE_URL at the Neon `dev` branch and run the same file
--
-- Safe to re-run: the seed caregiver's patients and profile are deleted
-- first (patients cascade to devices, alerts, approvals, commands, files).
-- =====================================================================

begin;

delete from public.patients
 where owner_id = 'user_seed_demo_caregiver';

delete from public.caregiver_profiles
 where user_id = 'user_seed_demo_caregiver';

insert into public.caregiver_profiles
  (user_id, full_name, phone, relationship_to_patient)
values
  ('user_seed_demo_caregiver', 'ชยพล พันธ์นาค', '0812345678', 'ลูก');

insert into public.patients
  (id, owner_id, display_name, relationship, date_of_birth, is_archived, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', 'user_seed_demo_caregiver',
   'คุณสมชาย ใจดี', 'พ่อ', '1948-03-12', false,
   now() - interval '30 days', now() - interval '2 days'),
  ('22222222-2222-4222-8222-222222222222', 'user_seed_demo_caregiver',
   'คุณมาลี ศรีสุข', 'แม่', '1952-07-04', false,
   now() - interval '21 days', now() - interval '5 days'),
  ('33333333-3333-4333-8333-333333333333', 'user_seed_demo_caregiver',
   'คุณประเสริฐ มั่นคง', 'ลุง', '1945-11-20', true,
   now() - interval '60 days', now() - interval '40 days');

insert into public.devices
  (id, patient_id, device_type, device_name, status, battery_percent, last_seen_at, created_at)
values
  ('d0000001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'wristband', 'Wristband A-01', 'online', 82, now() - interval '2 minutes', now() - interval '30 days'),
  ('d0000002-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'pillbox', 'Pillbox B-02', 'online', 64, now() - interval '5 minutes', now() - interval '30 days'),
  ('d0000003-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   'gateway', 'Gateway G-01', 'online', null, now() - interval '1 minute', now() - interval '30 days'),
  ('d0000004-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222',
   'wristband', 'Wristband A-02', 'offline', 15, now() - interval '6 hours', now() - interval '21 days');

insert into public.alerts
  (id, patient_id, device_id, alert_type, severity, message, occurred_at, acknowledged_at, acknowledged_by)
values
  ('e0000001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'd0000001-0000-4000-8000-000000000001', 'GEOFENCE_EXIT', 'critical',
   'สายรัดตรวจพบการออกนอกพื้นที่ที่กำหนด', now() - interval '15 minutes', null, null),
  ('e0000002-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'd0000002-0000-4000-8000-000000000002', 'LOW_BATTERY', 'warning',
   'แบตเตอรี่กล่องยาเหลือ 18%', now() - interval '3 hours',
   now() - interval '2 hours', 'user_seed_demo_caregiver'),
  ('e0000003-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222',
   'd0000004-0000-4000-8000-000000000004', 'BLE_DISCONNECTED', 'warning',
   'การเชื่อมต่อ BLE ขาดหาย', now() - interval '1 day',
   now() - interval '20 hours', 'user_seed_demo_caregiver');

-- One live request (approve it from the UI), one expired, one without BLE proof,
-- and one already-approved request with its queued command for history.
-- Demo requests live 15 minutes instead of the production 60 seconds so the
-- seed stays usable while you test the dashboard.
insert into public.pillbox_approvals
  (id, patient_id, compartment_no, status, ble_verified, requested_at, expires_at, approved_at, approved_by)
values
  ('a0000001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   2, 'pending', true, now() - interval '10 seconds', now() + interval '15 minutes', null, null),
  ('a0000002-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   1, 'expired', true, now() - interval '2 hours', now() - interval '119 minutes', null, null),
  ('a0000003-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222',
   3, 'pending', false, now() - interval '5 seconds', now() + interval '15 minutes', null, null),
  ('a0000004-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
   3, 'approved', true, now() - interval '1 day', now() - interval '1439 minutes',
   now() - interval '1439 minutes', 'user_seed_demo_caregiver');

insert into public.device_commands
  (id, patient_id, approval_id, command_type, compartment_no, status, created_at, expires_at)
values
  ('c0000001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'a0000004-0000-4000-8000-000000000004', 'UNLOCK_COMPARTMENT', 3, 'executed',
   now() - interval '1 day', now() - interval '1439 minutes');

commit;
