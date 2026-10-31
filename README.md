# GeoWrisX AD — V2

แดชบอร์ดผู้ดูแล (caregiver console) สำหรับต้นแบบ GeoWrisX AD ย้ายจาก **Netlify + Supabase**
มาอยู่บน **Cloudflare Pages + Neon Postgres + Clerk + Resend + Cloudflare R2**

> V2 นี้เป็นโปรเจกต์ใหม่ (`GeoWrisX-AD-V2`) ไม่ได้แก้ไข repository เดิม
> โค้ดแอปอยู่ในรากของ repository (ไม่มีโฟลเดอร์ `geowrisx-web/` แล้ว)

---

## 1. Stack

| ชั้น | บริการ | หมายเหตุ |
| --- | --- | --- |
| Hosting | Cloudflare Pages | Static build + Pages Functions (`functions/api`) |
| Database | Neon Postgres | เชื่อมผ่าน HTTP driver `@neondatabase/serverless` |
| Auth | Clerk | `@clerk/react` ฝั่งเว็บ + `@clerk/backend` ตรวจ token ฝั่งเซิร์ฟเวอร์ |
| Email | Resend | แจ้งเตือนเหตุการณ์และคำขอเปิดกล่องยา (best effort) |
| Storage | Cloudflare R2 | ไฟล์แนบผู้ป่วย สูงสุด 25 MB/ไฟล์ |
| Frontend | React 19 + Vite 7 + Tailwind CSS v4 | UI ภาษาไทย |

---

## 2. สถาปัตยกรรม

```
Browser (React + Clerk)
   │  Authorization: Bearer <Clerk session token>
   ▼
Cloudflare Pages Functions  /api/*
   ├─ _middleware.js      CORS allowlist + security headers + preflight
   ├─ _lib/auth.js        verifyToken() → Clerk user id (user_...)
   ├─ _lib/db.js          Neon HTTP driver (parameterised SQL)
   ├─ _lib/email.js       Resend REST API
   └─ R2 binding FILES    env.FILES.put/get/delete
        │
        ├── Neon Postgres   (patients, devices, alerts, approvals, …)
        ├── Clerk Backend   (อ่านอีเมลผู้ดูแลเมื่อต้องส่งอีเมล)
        └── Resend          (อีเมลแจ้งเตือน)
```

**เรื่องสิทธิ์การเข้าถึงข้อมูล**

Supabase RLS แบบ `auth.uid()` ใช้ไม่ได้แล้ว เพราะเบราว์เซอร์ไม่ได้เชื่อมต่อฐานข้อมูลโดยตรง
ทุกคำสั่ง SQL จึงถูกเขียนให้ตรวจเจ้าของข้อมูลเอง เช่น `where owner_id = $1` หรือ
`join patients p ... where p.owner_id = $1` โดย `$1` คือ Clerk user id ที่ผ่านการตรวจ token แล้ว
และการอนุมัติกล่องยาใช้ฟังก์ชัน Postgres แบบ atomic ที่ตรวจเจ้าของ + สถานะ + BLE + เวลาหมดอายุในครั้งเดียว

---

## 3. โครงสร้างโปรเจกต์

```
├─ functions/api/
│  ├─ _middleware.js          CORS / security headers
│  ├─ _lib/                   shared helpers (ไม่ถูกนับเป็น route)
│  ├─ dashboard.js            GET
│  ├─ create-patient.js       POST
│  ├─ update-patient.js       PATCH
│  ├─ archive-patient.js      POST
│  ├─ caregiver-profile.js    GET / PUT
│  ├─ approve-pillbox.js      POST
│  ├─ device-event.js         POST (device gateway, shared secret)
│  ├─ files.js                GET / POST / DELETE (R2)
│  ├─ file-download.js        GET (stream จาก R2)
│  └─ health.js               GET (readiness probe)
├─ src/
│  ├─ App.jsx                 หน้าจอผู้ดูแลทั้งหมด
│  ├─ components/SetupNotice.jsx
│  ├─ lib/api.js              apiRequest / apiUpload / apiDownload
│  ├─ lib/clerk.js            ตรวจ VITE_CLERK_PUBLISHABLE_KEY
│  └─ index.css
├─ db/schema.sql              ตาราง + ฟังก์ชัน approve_pillbox_request
├─ db/seed.dev.sql            ข้อมูลตัวอย่างสำหรับ branch dev
├─ wrangler.toml              Pages config + R2 binding
├─ .env.example               ตัวแปรฝั่งเบราว์เซอร์
├─ .dev.vars.example          ตัวแปรฝั่งเซิร์ฟเวอร์ (local)
└─ docs/MIGRATION.md          สรุปการย้ายจาก V1
```

---

## 4. สิ่งที่ต้องเตรียม

1. บัญชี **Cloudflare** (Pages + R2)
2. โปรเจกต์ **Neon** (สร้างได้ที่ https://console.neon.tech)
3. แอป **Clerk** (สร้างได้ที่ https://dashboard.clerk.com)
4. บัญชี **Resend** + โดเมนที่ยืนยันแล้ว (หรือใช้ `onboarding@resend.dev` สำหรับทดลอง)
5. Node.js 20+ และ npm

---

## 5. ติดตั้งและ deploy

### 5.1 Neon

1. สร้างโปรเจกต์ใหม่ เลือก region ใกล้ผู้ใช้ (เช่น Singapore)
2. คัดลอก **pooled** connection string (`...-pooler...`) และเติม `?sslmode=require`
3. รัน schema — เลือกวิธีใดวิธีหนึ่ง
   - **SQL Editor ใน Neon:** เปิดไฟล์ `db/schema.sql` ทั้งไฟล์ วาง แล้ว Run
   - **psql:**
     ```powershell
     psql "$env:NEON_DATABASE_URL" -f db/schema.sql
     ```
4. ตรวจว่ามีตาราง `patients`, `devices`, `alerts`, `pillbox_approvals`,
   `device_commands`, `caregiver_profiles`, `patient_files` และฟังก์ชัน
   `approve_pillbox_request(uuid, text)`

5. (ทางเลือก) ข้อมูลตัวอย่างสำหรับทดสอบ — ควรใช้ branch `dev` แยกจาก `main`
   เพื่อไม่ให้ข้อมูลทดลองปนกับ production

   ```powershell
   neon branches create --name dev      # ถ้ายังไม่มี branch dev
   neon link --branch dev               # ให้ .env.local ชี้ไปที่ dev
   psql "$env:NEON_DATABASE_URL" -f db/seed.dev.sql
   ```

   - seed สร้างผู้ป่วย 3 คน (1 คน archived), อุปกรณ์ 4 ตัว, แจ้งเตือน 3 รายการ,
     คำขออนุมัติ 4 แบบ (pending / expired / ไม่มี BLE / approved) และโปรไฟล์ผู้ดูแล
   - `owner_id` ในไฟล์เป็น placeholder `user_seed_demo_caregiver`
     ต้องเปลี่ยนเป็น Clerk user id จริง (`user_...`) ก่อนล็อกอินทดสอบ
   - รันซ้ำได้เสมอ (ลบข้อมูลของ seed owner ก่อนแล้วใส่ใหม่)
   - คำขอ pending ใน seed มีอายุ 15 นาที (production จริง 60 วินาที)
     เพื่อให้กดอนุมัติทดสอบจากหน้าเว็บได้ทัน

### 5.2 Clerk

1. สร้างแอปพลิเคชันใหม่ (หรือใช้แอปเดิมของ V1 ถ้ามี)
2. คัดลอก **Publishable key** และ **Secret key**
3. เพิ่ม origins ที่อนุญาต (Allowed origins / Authorized parties)
   - Production: `https://<your-project>.pages.dev` และ custom domain
   - Local: `http://localhost:5173`, `http://localhost:8788`
4. ตั้งค่า sign-in methods ตามต้องการ (email + password, Google, OTP ฯลฯ)
   หน้า sign-in ใช้ `<SignIn routing="hash" />` จึงไม่ต้องตั้ง path เพิ่มเติม

### 5.3 Cloudflare R2

```powershell
npx wrangler login
npx wrangler r2 bucket create geowrisx-ad-v2-files
```

`wrangler.toml` ผูก bucket นี้เป็น binding ชื่อ `FILES` ให้แล้ว
ถ้าใช้ชื่อ bucket อื่น ให้แก้ `bucket_name` ให้ตรงกัน

### 5.4 Resend

1. เพิ่มและยืนยันโดเมน (DNS records)
2. สร้าง API key
3. ตั้ง `RESEND_FROM` เป็นผู้ส่งที่ยืนยันแล้ว เช่น `GeoWrisX AD <alerts@your-domain.com>`
   - ทดลองเร็ว ๆ ใช้ `GeoWrisX AD <onboarding@resend.dev>` ได้ แต่ส่งได้เฉพาะอีเมลเจ้าของบัญชี Resend

### 5.5 Cloudflare Pages

**วิธีหลัก — Git integration (แนะนำ)**

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
2. เลือก repository `GeoWrisX-AD-V2`
3. ตั้งค่า build
   - Framework preset: `Vite`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `/`
4. เพิ่ม Environment variables (Production **และ** Preview)

   | ชื่อ | ชนิด | ค่า |
   | --- | --- | --- |
   | `VITE_CLERK_PUBLISHABLE_KEY` | Text | `pk_live_...` / `pk_test_...` |
   | `NEON_DATABASE_URL` | Secret | pooled connection string |
   | `CLERK_SECRET_KEY` | Secret | `sk_live_...` / `sk_test_...` |
   | `CLERK_AUTHORIZED_PARTIES` | Text | origins คั่นด้วย comma |
   | `RESEND_API_KEY` | Secret | `re_...` |
   | `RESEND_FROM` | Text | `GeoWrisX AD <alerts@domain>` |
   | `ALERT_NOTIFY_TO` | Text | (ไม่บังคับ) รับอีเมลทั้งหมดที่อีเมลนี้ |
   | `DEVICE_INGEST_SECRET` | Secret | สุ่มยาว ๆ สำหรับ gateway |
   | `ALLOWED_ORIGINS` | Text | (ไม่บังคับ) origin พิเศษ |

   `CLERK_JWT_KEY` เป็นทางเลือก: ถ้าใส่ PEM public key จาก Clerk
   การตรวจ token จะไม่ต้องเรียก JWKS ทุกครั้ง (เร็วกว่า)

5. Save and Deploy
6. เปิด `https://<project>.pages.dev/api/health` ต้องได้ `{"ok":true,...}`

> R2 binding ถูกอ่านจาก `wrangler.toml` ตอน deploy ผ่าน Git เช่นกัน
> ถ้า dashboard ไม่แสดง binding ให้เพิ่มที่ Settings → Functions → R2 bucket bindings
> (Variable name: `FILES`)

**ทางเลือก — deploy จากเครื่อง**

```powershell
npm install
npm run build
npx wrangler pages deploy dist --project-name geowrisx-ad-v2
```

หรือใช้ GitHub Actions แบบ manual: `.github/workflows/deploy.yml`
(ต้องตั้ง secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)

---

## 6. รันในเครื่อง

```powershell
npm install

# 1) ตัวแปรฝั่งเบราว์เซอร์
Copy-Item .env.example .env
# แก้ VITE_CLERK_PUBLISHABLE_KEY

# 2) ตัวแปรฝั่งเซิร์ฟเวอร์
Copy-Item .dev.vars.example .dev.vars
# แก้ NEON_DATABASE_URL, CLERK_SECRET_KEY, RESEND_API_KEY, DEVICE_INGEST_SECRET

npm run dev
```

`npm run dev` จะ build แล้วเปิด

- Vite ที่ http://localhost:5173 (หน้าเว็บ)
- `wrangler pages dev dist --port 8788` (API + R2 local)
- Vite proxy `/api` → `127.0.0.1:8788` ให้เรียก API ได้แบบ same-origin

คำสั่งแยก:

```powershell
npm run dev:web   # เฉพาะ frontend
npm run dev:api   # เฉพาะ Pages Functions (ต้อง build ก่อน)
npm run build
```

> ครั้งแรกที่ `wrangler pages dev` ทำงาน อาจใช้เวลาสร้าง local R2 state สักครู่
> ถ้าเจอ `Unable to connect` ให้รอจนขึ้น `Ready on http://127.0.0.1:8788`

> **สำคัญ:** `wrangler pages dev` อ่าน `.dev.vars` ตอนเริ่มเท่านั้น ถ้าแก้ key
> (`CLERK_SECRET_KEY`, `NEON_DATABASE_URL`, ...) ต้อง **กด Ctrl+C แล้วรัน `npm run dev` ใหม่**
> — Vite จะ restart เองเมื่อ `.env.local` เปลี่ยน แต่ตัว API ไม่ restart ตาม
> อาการที่เจอถ้าลืม: sign-in ผ่านแต่ API ตอบ `401 เซสชันหมดอายุหรือ Token ไม่ถูกต้อง`
> เพราะฝั่ง API ยังตรวจ token ด้วย secret key เก่า

> อย่าเปิด `npm run dev` ซ้อนกันสองหน้าต่าง — ตัวที่สองจะไปเกาะ port 5174/8789
> แล้วเบราว์เซอร์อาจคุยกับชุดที่ใช้ env เก่า ให้ `Get-NetTCPConnection -LocalPort 5173,8788` เช็คก่อน

---

## 7. API

ทุก endpoint ยกเว้น `health` และ `device-event` ต้องมี header
`Authorization: Bearer <Clerk session token>`

| Method | Path | หน้าที่ |
| --- | --- | --- |
| GET | `/api/health` | ตรวจ env/DB/R2 (ไม่ต้อง auth) |
| GET | `/api/dashboard` | patients, devices, alerts, approvals, commands, files |
| POST | `/api/create-patient` | เพิ่มผู้ป่วย |
| PATCH | `/api/update-patient` | แก้ไขผู้ป่วย |
| POST | `/api/archive-patient` | เก็บเข้าคลัง / กู้คืน |
| GET | `/api/caregiver-profile` | โปรไฟล์ผู้ดูแล + อีเมลจาก Clerk |
| PUT | `/api/caregiver-profile` | บันทึกโปรไฟล์ผู้ดูแล |
| POST | `/api/approve-pillbox` | อนุมัติคำขอ (atomic, ต้องมี BLE proof) |
| GET | `/api/files?patient_id=` | รายการไฟล์ของผู้ป่วย |
| POST | `/api/files` | อัปโหลด (`multipart/form-data`: `patient_id`, `file`) |
| DELETE | `/api/files?file_id=` | ลบไฟล์ |
| GET | `/api/file-download?file_id=` | ดาวน์โหลดไฟล์ (stream จาก R2) |
| POST | `/api/device-event` | gateway ของอุปกรณ์ (shared secret) |

### ตัวอย่าง device gateway

```powershell
# เลี่ยงปัญหา escaping ของ PowerShell: เขียน body ลงไฟล์ก่อน
@'
{
  "event_type": "DEVICE_STATUS",
  "device_id": "00000000-0000-4000-8000-000000000000",
  "status": "online",
  "battery_percent": 82
}
'@ | Set-Content -Encoding utf8 body.json

curl.exe -s -X POST "https://<project>.pages.dev/api/device-event" `
  -H "Content-Type: application/json" `
  -H "x-device-ingest-secret: $env:DEVICE_INGEST_SECRET" `
  --data-binary "@body.json"
```

รองรับ `event_type`:

| ค่า | ผล |
| --- | --- |
| `DEVICE_STATUS` | อัปเดตสถานะ/แบตเตอรี่/`last_seen_at` |
| `PILLBOX_REQUEST` | สร้างคำขอ 60 วินาที + อีเมลแจ้งผู้ดูแล |
| `GEOFENCE_EXIT`, `TAMPER` | สร้าง alert ระดับ `critical` + อีเมล |
| `LOW_BATTERY`, `BLE_DISCONNECTED` | สร้าง alert ระดับ `warning` + อีเมล |

การลงทะเบียนอุปกรณ์ทำผ่าน SQL ครั้งเดียวต่ออุปกรณ์ (ยังไม่มี endpoint สำหรับ prototype นี้):

```sql
insert into public.devices (patient_id, device_type, device_name)
values ('<patient uuid>', 'wristband', 'Wristband A-01');
```

---

## 8. ความปลอดภัยและข้อจำกัด

- **ห้าม** ใส่ `CLERK_SECRET_KEY`, `NEON_DATABASE_URL` หรือ `DEVICE_INGEST_SECRET` ในตัวแปร `VITE_*`
  เพราะจะถูกฝังลง JS ฝั่งเบราว์เซอร์
- ทุก query ตรวจเจ้าของข้อมูลด้วย Clerk user id; ไม่มี RLS และไม่มีการเชื่อมต่อ DB จากเบราว์เซอร์
- ไฟล์แนบถูกดาวน์โหลดเป็น `attachment` พร้อม `X-Content-Type-Options: nosniff`
  เพื่อลดความเสี่ยง XSS จากไฟล์ที่ผู้ใช้อัปโหลด
- CORS จำกัดด้วย `ALLOWED_ORIGINS`; same-origin ไม่ต้องใช้
- `DEVICE_INGEST_SECRET` เป็น shared secret ของต้นแบบเท่านั้น
  ก่อนใช้งานจริงควรเปลี่ยนเป็น per-device credential + signature + replay protection
- การอนุมัติสร้าง **คำสั่งในคิว** (`device_commands`) ไม่ได้สั่งเปิดกลอนโดยตรง
  ต้องมีตัวอ่านคิว/MQTT ฝั่งเฟิร์มแวร์ และให้กล่องยาตรวจเงื่อนไขซ้ำก่อนขับ Solenoid
- ระบบนี้เป็นงานวิจัย/ต้นแบบ ไม่ใช่อุปกรณ์การแพทย์ที่ผ่านการรับรอง

---

## 9. แก้ปัญหา

| อาการ | ตรวจสอบ |
| --- | --- |
| หน้าเว็บขึ้น "ตั้งค่า GeoWrisX AD V2" | ยังไม่มี `VITE_CLERK_PUBLISHABLE_KEY` (หรือยังเป็น `REPLACE_ME`) — ต้อง rebuild |
| `/api/health` ได้ `ok:false` | ดู `checks` ว่า `auth` / `database` / `storage` ตัวไหน false |
| 401 ทุกครั้ง | token หมดอายุ, `CLERK_AUTHORIZED_PARTIES` ไม่ตรง origin, หรือใช้ key คนละ environment |
| 500 `NEON_DATABASE_URL` | ยังไม่ได้ใส่ secret หรือใส่ใน Pages แบบ Preview ไม่ครบ |
| 500 ตอนโหลด dashboard | ยังไม่ได้รัน `db/schema.sql` หรือชื่อ schema/ตารางไม่ตรง |
| อัปโหลดไฟล์ไม่ผ่าน | ใหญ่เกิน 25 MB, binding `FILES` ไม่มี, หรือไม่ได้สร้าง R2 bucket |
| ไม่ได้รับอีเมล | ยังไม่ยืนยันโดเมนใน Resend, `RESEND_FROM` ไม่ถูกต้อง, หรือไม่มีอีเมลผู้ใช้ใน Clerk |
| `Unable to connect` ตอน dev | รอให้ wrangler ขึ้น `Ready` ก่อน แล้วค่อยเปิด 5173 |

---

## 10. การย้ายจาก V1

รายละเอียดทั้งหมดอยู่ใน [`docs/MIGRATION.md`](docs/MIGRATION.md)
สรุปสั้น ๆ:

- Supabase Auth → Clerk (`owner_id`/`user_id` เปลี่ยนจาก uuid เป็น text `user_...`)
- Supabase Postgres + RLS → Neon + การตรวจสิทธิ์ใน API
- Netlify Functions (`.mjs`) → Cloudflare Pages Functions (`functions/api/*.js`)
- Supabase Storage → Cloudflare R2 (`FILES`)
- ไม่มี Netlify/Supabase package หรือ env var เหลืออยู่ในโค้ด V2
