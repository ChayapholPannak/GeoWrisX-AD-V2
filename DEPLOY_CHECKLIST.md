# Deploy checklist — GeoWrisX AD V2

Checklist นี้ไล่จากศูนย์จนได้ URL ที่ใช้งานได้จริง ทำเครื่องหมายเมื่อเสร็จแต่ละข้อ

---

## A. เตรียมบัญชีและทรัพยากร

- [ ] Cloudflare account + `npx wrangler login`
- [ ] Neon project สร้างแล้ว (region ใกล้ผู้ใช้)
- [ ] Clerk application สร้างแล้ว
- [ ] Resend domain ยืนยันแล้ว + API key
- [ ] GitHub repo `GeoWrisX-AD-V2` พร้อม push

## B. ฐานข้อมูล (Neon)

- [ ] คัดลอก pooled connection string (ลงท้าย `?sslmode=require`)
- [ ] รัน `db/schema.sql` (SQL Editor หรือ `psql`)
- [ ] ตรวจตารางทั้ง 7: `patients`, `devices`, `alerts`, `pillbox_approvals`,
      `device_commands`, `caregiver_profiles`, `patient_files`
- [ ] ตรวจฟังก์ชัน:
      ```sql
      select proname, pronargs
      from pg_proc
      where proname = 'approve_pillbox_request';
      ```
      ต้องได้ `approve_pillbox_request | 2`
- [ ] (ไม่บังคับ) เพิ่มอุปกรณ์ทดสอบ:
      ```sql
      insert into public.devices (patient_id, device_type, device_name)
      values ('<patient uuid>', 'wristband', 'Wristband A-01');
      ```

## C. Clerk

- [ ] คัดลอก Publishable key (`pk_...`) และ Secret key (`sk_...`)
- [ ] Allowed origins มี `http://localhost:5173`, `http://localhost:8788`
      และ URL ของ Pages/custom domain
- [ ] เลือก sign-in methods ที่ต้องการ
- [ ] (แนะนำ) เปิด MFA สำหรับบัญชีผู้ดูแลจริง
- [ ] (ถ้าใช้) คัดลอก PEM public key มาเป็น `CLERK_JWT_KEY` เพื่อเลี่ยง JWKS fetch

## D. Cloudflare KV

- [ ] `npx wrangler kv namespace create FILES`
- [ ] คัดลอก `id` ที่ได้ ไปใส่ใน `wrangler.toml` (`[[kv_namespaces]]` binding `FILES`)
- [ ] ถ้าใช้ namespace อื่น: แก้ `id` และ/หรือเพิ่ม binding ใน Pages dashboard
      (Settings → Functions → KV namespace bindings, Variable name: `FILES`)

## E. Resend

- [ ] เพิ่ม DNS records ของโดเมนและสถานะ Verified
- [ ] สร้าง API key (`re_...`)
- [ ] ตั้ง `RESEND_FROM` เป็นผู้ส่งที่ยืนยันแล้ว
- [ ] (ไม่บังคับ) ตั้ง `ALERT_NOTIFY_TO` เพื่อรวมอีเมลทดสอบไปที่กล่องเดียว

## F. Cloudflare Pages

- [ ] สร้าง Pages project จาก GitHub repo
- [ ] Build command: `npm run build`
- [ ] Build output directory: `dist`
- [ ] Root directory: `/`
- [ ] เพิ่ม Environment variables ครบ (Production + Preview):

  - [ ] `VITE_CLERK_PUBLISHABLE_KEY`
  - [ ] `NEON_DATABASE_URL` (Secret)
  - [ ] `CLERK_SECRET_KEY` (Secret)
  - [ ] `CLERK_AUTHORIZED_PARTIES`
  - [ ] `RESEND_API_KEY` (Secret)
  - [ ] `RESEND_FROM`
  - [ ] `DEVICE_INGEST_SECRET` (Secret, สุ่ม ≥ 32 ตัวอักษร)
  - [ ] `CRON_SECRET` (Secret, สุ่ม ≥ 32 ตัวอักษร — ใช้โดย endpoint ยาพลาด เทียบกับ header `x-cron-secret`)
  - [ ] `ALERT_NOTIFY_TO` (ไม่บังคับ)
  - [ ] `ALLOWED_ORIGINS` (ไม่บังคับ)

- [ ] Deploy สำเร็จ (build log ไม่มี error)
- [ ] KV binding `FILES` ปรากฏใน Settings → Functions → KV namespace bindings

## G. ตรวจหลัง deploy

- [ ] `GET https://<project>.pages.dev/api/health` → `200` และ `"ok": true`
- [ ] เปิดหน้าเว็บ → เห็นหน้า Clerk sign-in ภาษาไทย
- [ ] สมัคร/เข้าสู่ระบบ → เห็นแดชบอร์ด ไม่มี error สีแดง
- [ ] บันทึกโปรไฟล์ผู้ดูแล → รีเฟรชแล้วค่าอยู่
- [ ] เพิ่มผู้ป่วย → แก้ไข → เก็บเข้าคลัง → กู้คืน
- [ ] อัปโหลดไฟล์แนบ → ดาวน์โหลด → ลบ
- [ ] ตรวจ KV ว่ามี key ภายใต้ `patient-files/<patient uuid>/...` (Dashboard → KV)
- [ ] ส่ง `DEVICE_STATUS` จาก gateway → สถานะ/แบตเตอรี่เปลี่ยน
- [ ] ส่ง `TAMPER` → มี alert + อีเมล (ถ้าตั้ง Resend)
- [ ] ส่ง `PILLBOX_REQUEST` ด้วย `ble_proximity_verified: true` → อนุมัติได้
- [ ] ส่ง `PILLBOX_REQUEST` ด้วย `ble_proximity_verified: false` → ปุ่มอนุมัติถูกปิด/ได้ 409
- [ ] ตรวจว่า `device_commands` มีแถว `queued` หลังอนุมัติ

## K. P3 — Care log (นอน/ชีพจร/ยา) ตรวจเพิ่มเติม (8 พ.ย. 2569)

### ตารางใหม่ (idempotent จาก `db/schema.sql`)

- [ ] `sleep_nights`, `hr_samples`, `med_schedules`, `med_intakes` มีครบ
- [ ] constraint `alerts_alert_type_check` รวม `PILL_NOT_TAKEN`:
      ```sql
      select pg_get_constraintdef(oid) from pg_constraint where conname = 'alerts_alert_type_check';
      ```
      (ถ้ายังเป็นของเก่า — endpoint ยาพลาดจะ 500 ทันที แก้ด้วย drop + re-add ตาม schema)

### Cron ยาพลาด (Cloudflare Worker)

- [ ] Deploy worker: `workers/med-cron/` มี `wrangler.toml` ของตัวเอง
      ```bash
      # รันจากโฟลเดอร์อื่น (parent มี wrangler.jsonc ของโปรเจ็กต์อื่น ไม่ให้แตะ)
      cd <repo>/workers/med-cron
      npx wrangler deploy    # หรือ npx wrangler deploy --config <repo>/workers/med-cron/wrangler.toml
      ```
- [ ] ตั้ง secret ให้ worker: `npx wrangler secret put CRON_SECRET --name geowrisx-med-cron`
      (ค่าต้องตรงกับ `CRON_SECRET` ของ Pages ที่เก็บไว้ใน `.dev.vars`)
- [ ] Trigger `*/15 * * * *` ตรวจได้ที่ dashboard → worker → Triggers
- [ ] ทดสอบมือได้: `node scripts/cron-missed.mjs` (อ่าน CRON_SECRET จาก `.dev.vars`, ไม่พิมพ์ค่า)
      ผลลัพธ์รูปแบบ `{"ok":true,"checked":N,"created_alerts":X,"alerts":[...]}`

### Endpoint ใหม่ที่ต้องมี

| Endpoint | สิทธิ์ | หน้าที่ |
|---|---|---|
| `POST /api/device-event` (+ `SLEEP_SUMMARY`, `HR_BATCH`, `MED_EVENT`) | device secret | ingest นอน/ชีพจร/ยา |
| `GET/POST/PATCH/DELETE /api/med-schedules` | primary จัดการ, member ดู | เวลายา |
| `GET /api/care-log?patient_id=..&days=..` | member | ข้อมูลหลับ/ชีพจร/ยา + rollup |
| `PATCH /api/alerts?id=..` | member | รับทราบ / เปิดซ้ำ |
| `POST /api/cron/missed-meds` | `x-cron-secret` = `CRON_SECRET` | ยาพลาด → `PILL_NOT_TAKEN` |

### กติกาเวลา

- ทุกการคำนวณเวลายาเป็น **เวลาไทย (UTC+7)** — MED_EVENT auto-match ±45 นาที, cron รอ 60 นาทีสูงสุด 12 ชม.
- MED กล่องยา auto-match ด้วย `compartment_no` 1–3 และ `schedule_id` (แนบเมื่อตรงเวลา)
- Cron นับ "ขวางเตือนซ้ำ" ด้วย open alert + message prefix แบบเดียวกับ GEOFENCE_EXIT

### ทดสอบ mock (ทั้งหมดผ่าน production 8 พ.ย. 2569)

- [ ] `scripts/mock-care.mjs sleep|hr|med` — ingest ทั้ง 3 เหตุการณ์ HTTP 201
- [ ] `scripts/mock-gps.mjs` — วง polygon: จุดใน = 0, จุดนอกติดกัน ≥2 จุดเว้น ≥60 วิ = `geofence_alerts:1`, รันซ้ำ dedupe = 0
- [ ] หน้า "บันทึกการดูแล" แสดง 4 การ์ดสรุป + กราฟ 7 วัน + เพิ่ม/ลบเวลายาผ่าน UI
- [ ] ปุ่ม "รับทราบ" บน dashboard: counter ลด, `acknowledged_at` บันทึกลง DB

### วงเลิคีเฟอร์ (geofence) — เด็ดขาดใน TESTING

- gate breach ต้องมีจุดนอกเว้นกัน ≥60 วิในไทม์ไลน์ถัดไป — mock สองรอบยิงแบบ timestamp ย้อนหลังสลับกันจะ reset streak เงียบ ๆ (เจอจริงรอบ 8 พ.ย.)
- วง inactive: `/api/track` คืนทุกวง (แสดงบน UI + กลับมาเปิดได้) แต่การประเมิน breach ใช้ active เท่านั้น

### ปุ่ม Google OAuth (✅ ใช้ได้แล้ว 8 พ.ย. 2569)

- ทดสอบกดจริงผ่าน: Google ยืนยันตัวตน (device prompt) → Clerk callback → เข้า Dashboard สำเร็จ
  — บัญชีมีการ merge อัตโนมัติด้วย email (password + Google รวมเป็น user Clerk ตัวเดียว)
- error `authorization_invalid` เดิมคือปัญหา state cookie ของ session ไม่ใช่ config;
  ถ้าพังซ้ำให้ลอง Incognito ก่อน แล้วอ่าน `docs/GOOGLE-OAUTH-SETUP.md` (custom credentials)## H. ความปลอดภัยก่อนใช้งานจริง

- [ ] ไม่มี secret ใดอยู่ใน `.env`, `VITE_*`, หรือ commit history
- [ ] เปลี่ยน `DEVICE_INGEST_SECRET` จากค่า example
- [ ] จำกัด Clerk allowed origins เฉพาะโดเมนจริง
- [ ] ตั้ง backup/retention ของ Neon ตามนโยบายข้อมูลสุขภาพ
- [ ] ทำความเข้าใจว่า prototype นี้ยังไม่ใช่อุปกรณ์การแพทย์ที่ผ่านการรับรอง


## J. Auth ข้อควรรู้ (multi-caregiver, 3 พ.ย. 2569)

- [ ] CLERK_AUTHORIZED_PARTIES ใน wrangler.toml (และช่อง Environment variables กรณี secret) ต้องมีต้นทางที่ใช้ล็อกอิน ตรงตัวทีละข้อ (ไม่รองรับ wildcard)
- [ ] ทดสอบ/ใช้งานจริงบน https://geowrisx-ad-v2.pages.dev เท่านั้น — ล็อกอินจาก URL deploy ชั่วคราว (ย่อยระดับ hash เช่น 63b01e53.geowrisx-ad-v2.pages.dev) จะโดน 401 เพราะ azp ไม่ตรงลิสต์
- [ ] หลัง deploy รัน db/schema.sql ใหม่ได้ (idempotent): node scripts/run-schema.mjs พร้อม NEON_DATABASE_URL (สร้าง caregiver_links และ caregiver_invites)
- [ ] สมาชิกที่ถูกเชิญต้องตอบรับด้วยบัญชี Clerk ที่ใช้ EMAIL เดียวกับในคำเชิญเท่านั้น
