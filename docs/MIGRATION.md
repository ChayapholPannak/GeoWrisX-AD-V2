# Migration notes — V1 (Netlify + Supabase) → V2 (Cloudflare + Neon + Clerk)

เอกสารนี้สรุปสิ่งที่เปลี่ยน และสิ่งที่ต้องทำถ้าต้องการย้ายข้อมูลเดิม

---

## 1. ตารางเทียบ stack

| ความสามารถ | V1 | V2 |
| --- | --- | --- |
| Hosting | Netlify | Cloudflare Pages |
| API | Netlify Functions (`netlify/functions/*.mjs`) | Pages Functions (`functions/api/*.js`) |
| Database | Supabase Postgres + RLS | Neon Postgres (HTTP driver) |
| Auth | Supabase Auth (email/password) | Clerk (`<SignIn routing="hash">`) |
| สิทธิ์ข้อมูล | RLS + `auth.uid()` | ตรวจ `owner_id = $clerkUserId` ในทุก query |
| Storage | Supabase Storage (ไม่มีใน V1) | Cloudflare R2 binding `FILES` |
| Email | ไม่มี | Resend |
| Frontend | React 19 + Vite 6 | React 19 + Vite 7 |
| Auth package | `@supabase/supabase-js` | `@clerk/react`, `@clerk/backend`, `@clerk/localizations` |

---

## 2. Environment variables

### ลบออก

```
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
ALLOWED_ORIGIN          # V1 ใช้ตัวเดียว, V2 ใช้ ALLOWED_ORIGINS (มี s)
```

### เพิ่มใหม่

| ตัวแปร | ฝั่ง | ใช้ทำอะไร |
| --- | --- | --- |
| `VITE_CLERK_PUBLISHABLE_KEY` | build (เบราว์เซอร์) | ให้ ClerkProvider ทำงาน |
| `CLERK_SECRET_KEY` | server secret | ตรวจ token (JWKS) + อ่านอีเมลผู้ใช้ |
| `CLERK_JWT_KEY` | server (ไม่บังคับ) | ตรวจ token แบบ networkless |
| `CLERK_AUTHORIZED_PARTIES` | server | จำกัด origin ของ token |
| `NEON_DATABASE_URL` | server secret | เชื่อม Neon |
| `RESEND_API_KEY` | server secret | ส่งอีเมล |
| `RESEND_FROM` | server | ผู้ส่งที่ยืนยันแล้ว |
| `ALERT_NOTIFY_TO` | server (ไม่บังคับ) | รวมอีเมลแจ้งเตือน |
| `DEVICE_INGEST_SECRET` | server secret | gateway ของอุปกรณ์ |
| `ALLOWED_ORIGINS` | server (ไม่บังคับ) | CORS allowlist |

`VITE_*` ถูกฝังใน bundle ห้ามใส่ secret

---

## 3. เปลี่ยนรูปแบบข้อมูล identity

V1 ใช้ `uuid` จาก `auth.users` เป็น foreign key ส่วน V2 ใช้ Clerk user id
ซึ่งเป็นสตริงรูปแบบ `user_xxxxxxxx`

| เดิม | ใหม่ |
| --- | --- |
| `patients.owner_id uuid references auth.users(id)` | `patients.owner_id text` |
| `caregiver_profiles.user_id uuid` | `caregiver_profiles.user_id text` |
| `alerts.acknowledged_by uuid` | `alerts.acknowledged_by text` |
| `pillbox_approvals.approved_by uuid` | `pillbox_approvals.approved_by text` |
| `auth.uid()` ใน RPC | พารามิเตอร์ `p_user_id text` |

ไม่มีตาราง `auth.users` อีกต่อไป ผู้ใช้ถูกสร้าง/จัดการใน Clerk
ข้อมูลโปรไฟล์ที่แอปต้องใช้เก็บใน `caregiver_profiles`

---

## 4. RLS → application-level authorization

V1 พึ่ง RLS policies หลายตัว ถูกถอดออกทั้งหมดใน V2 เพราะ:

- เบราว์เซอร์ไม่เคยเชื่อมต่อ Neon โดยตรง (ไม่มี anon key)
- Pages Functions มี DB credential เดียว และรู้ user id จาก token ที่ตรวจแล้ว

รูปแบบที่ใช้แทน:

```sql
-- patients
select ... from public.patients where owner_id = $1;
update public.patients set ... where id = $2 and owner_id = $1;

-- ตารางลูก
select ... from public.alerts a
  join public.patients p on p.id = a.patient_id
 where p.owner_id = $1;
```

ถ้าเพิ่ม endpoint ใหม่ **ต้อง** ใส่เงื่อนไขเจ้าของข้อมูลด้วยเสมอ

---

## 5. ฟังก์ชันอนุมัติกล่องยา

V1:

```sql
approve_pillbox_request(p_request_id uuid)          -- ใช้ auth.uid()
```

V2:

```sql
approve_pillbox_request(p_request_id uuid, p_user_id text)
```

- ยัง raise exception codes เดิม: `REQUEST_NOT_FOUND`, `REQUEST_NOT_PENDING`,
  `BLE_NOT_VERIFIED`, `REQUEST_EXPIRED`
- `functions/api/approve-pillbox.js` map เป็น 404/409 เหมือนเดิม
- ยังคง `for update` + ตรวจเจ้าของ + หมดอายุ + BLE ใน transaction เดียว
- ยังคงสร้าง `device_commands` อายุสั้น ไม่สั่งเปิดกลอนตรง ๆ

---

## 6. Endpoint mapping

| V1 (Netlify) | V2 (Pages) | เปลี่ยนอะไร |
| --- | --- | --- |
| `GET /.netlify/functions/dashboard` → `/api/dashboard` | `GET /api/dashboard` | เพิ่ม `files`, ตรวจเจ้าของด้วย join |
| `/api/create-patient` | เดิม | ใช้ `owner_id` = Clerk id |
| `/api/update-patient` (PATCH) | เดิม | ตรวจ `owner_id` ใน `where` |
| `/api/archive-patient` | เดิม | เดิม |
| `/api/caregiver-profile` GET/PUT | เดิม | อีเมลอ่านจาก Clerk แทน `auth.users` |
| `/api/approve-pillbox` | เดิม | ส่ง `p_user_id` เข้า RPC |
| `/api/device-event` | เดิม | ใช้ Neon + R2-free; `timingSafeEqual` → SHA-256 compare |
| — | `GET/POST/DELETE /api/files` | ใหม่ (R2) |
| — | `GET /api/file-download` | ใหม่ (R2) |
| — | `GET /api/health` | ใหม่ |

---

## 7. การย้ายข้อมูลจริง

> **แนะนำ:** เริ่มด้วยฐานข้อมูลใหม่สำหรับ V2 เพราะต้อง map Supabase user → Clerk user
> ซึ่งทำอัตโนมัติไม่ได้ถ้าไม่รู้ความสัมพันธ์ของบัญชี

ถ้าจำเป็นต้องย้ายข้อมูลจริง:

1. **สร้างผู้ใช้ใน Clerk** ให้ครบ และจด mapping `supabase_user_uuid → clerk_user_id`
2. **Export** จาก Supabase (CSV หรือ `pg_dump --data-only`)
3. **แปลง owner id** ก่อน import เช่น

   ```sql
   -- ตารางชั่วคราวสำหรับ mapping
   create table public._user_map (supabase_id uuid primary key, clerk_id text not null);

   -- หลัง import mapping แล้ว
   update public.patients p
      set owner_id = m.clerk_id
     from public._user_map m
    where p.owner_id::text = m.supabase_id::text;
   ```

   หรือทำ mapping ในสเปรดชีต/สคริปต์ก่อน import CSV

4. **Import ตามลำดับ FK:** `patients` → `devices` → `alerts` /
   `pillbox_approvals` → `device_commands` → `caregiver_profiles`
5. ตรวจว่าไม่มีแถวที่ `owner_id` ยังเป็น uuid (จะทำให้ผู้ใช้มองไม่เห็นข้อมูล)

   ```sql
   select count(*) from public.patients where owner_id !~ '^user_';
   ```

6. ไฟล์แนบ: V1 ไม่มี storage จึงไม่มีอะไรต้องย้าย (ถ้ามี bucket เดิมให้ดาวน์โหลด
   แล้วอัปโหลดใหม่ผ่าน UI)

---

## 8. สิ่งที่ถูกถอดออกจากโค้ด

- `src/lib/supabase.js`
- `netlify.toml`, `netlify/functions/*`
- หน้า `AuthScreen` แบบฟอร์มเอง (แทนด้วย Clerk `<SignIn>`)
- `supabase.auth.signUp` / `signInWithPassword` / `signOut` / `updateUser`
- RLS policies และ grants สำหรับ role `authenticated` / `anon`
- `supabase/setup.sql`, `supabase/migrations/*` (แทนด้วย `db/schema.sql`)

---

## 9. พฤติกรรมที่เหมือนเดิม

- ชื่อและเส้นทาง API หลัก (`/api/dashboard`, `/api/create-patient`, …)
- ข้อความ error ภาษาไทยและรหัส HTTP โดยประมาณ
- กติกาการอนุมัติ: ต้อง pending + BLE verified + ยังไม่หมดอายุ + เป็นเจ้าของ
- UI ภาษาไทย ธีม และเลย์เอาต์แดชบอร์ด
- ข้อจำกัดของต้นแบบ: อนุมัติ = เข้าคิวคำสั่ง ไม่ได้ขับกลอนจริง
