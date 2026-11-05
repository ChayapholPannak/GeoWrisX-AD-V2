# GeoWrisX AD V2 — Roadmap ระบบติดตามผู้ป่วย + ฮาร์ดแวร์ + SDLC

> สถานะ: ข้อเสนอ (proposal) สำหรับ pain point ใหม่ — ฝั่งเว็บแอปทำเองได้บน free stack เดิมทั้งหมด
> (Cloudflare Pages/Functions + Neon Postgres + R2 + KV + Clerk + Resend) ไม่เพิ่มค่าใช้จ่าย
> ฝั่งฮาร์ดแวร์แนะนำเป็นชุดต้นแบบ (prototype) ประกอบง่าย ราคาประหยัด ส่งข้อมูลขึ้นเว็บแอปได้จริง
> Flowchart: เปิดไฟล์ `docs/flowchart.html`

---

## 0. สิ่งที่มีอยู่แล้ว — ต่อยอด ไม่ต้องรื้อ

| ของเดิม | ใช้ต่อยอดอย่างไร |
|---|---|
| `devices` (wristband / pillbox / gateway) | เพิ่มอุปกรณ์ใหม่ได้เลย ไม่ต้องเพิ่มชนิด |
| `device-event` gateway (HMAC ด้วย DEVICE_INGEST_SECRET) | รากฐานของทุกข้อมูลที่เครื่องส่งขึ้น — ขยาย ALLOWED_EVENTS เท่านั้น |
| `alerts` (GEOFENCE_EXIT / TAMPER / LOW_BATTERY / BLE_DISCONNECTED) | เพิ่มชนิด `FALL`, `PILL_NOT_TAKEN`, `HEART_RATE_ABNORMAL` |
| `pillbox_approvals` + BLE 60s + `device_commands` UNLOCK | งานกล่องยามีรากฐานครบ — เพิ่มแค่ตารางบันทึกการทานจริง |
| สิทธิ์ `caregiver_links` (primary / companion) | ทุก API ใหม่กดสิทธิ์ผ่าน access.js เดิมได้ทันที |

---

## 1. ฟีเจอร์ที่ 1 — เมนู "ตั้งค่า / จัดการบัญชี" (Settings)

เร็วที่สุด ไม่ต้องรอฮาร์ดแวร์

```
ตั้งค่า
├── โปรไฟล์ผู้ดูแล            → caregiver_profiles (มีอยู่) ย้ายมารวมที่นี่
├── การแจ้งเตือน              → ต่อช่องทาง: dashboard / อีเมล (Resend)
│        ต่อเรื่อง: SOS, Geofence, Anti-removal, Battery, ยาพลาดเวลา, สรุปรายวัน
├── ผู้ป่วยและอุปกรณ์          → ลงทะเบียน/แก้ไข/ลบ device, เลือก metric ที่โชว์
├── พื้นที่ปลอดภัย (Geofences)  → จัดการวงล้อม (เชื่อมฟีเจอร์ที่ 2)
├── ความเป็นส่วนตัวและข้อมูล    → เก็บเข้าคลัง / ลบถาวร, ดาวน์โหลดข้อมูลของฉัน
└── สมาชิกทีม                 → caregiver_invites (ซุกอยู่ในการ์ดผู้ป่วยปัจจุบัน)
```

ตารางใหม่เพียงตารางเดียว:
```sql
create table if not exists public.user_prefs (
  user_id    text primary key,
  prefs      jsonb not null default '{}'::jsonb,  -- {notify_email, channels:{...}, ui:{...}}
  updated_at timestamptz not null default now()
);
```
- API: `GET /api/prefs` + `PUT /api/prefs` (auth ด้วย Clerk user ปัจจุบัน)
- ทุกหมวดเป็น tab ภายในหน้า Settings เดียว — ไม่ยุ่ง routing

---

## 2. ฟีเจอร์ที่ 2 — ติดตามตำแหน่ง + Geofencing (GPS)

### 2.1 ตารางใหม่
```sql
create table if not exists public.gps_points (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients(id) on delete cascade,
  device_id   uuid references public.devices(id) on delete set null,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  acc_m       numeric(7,1),                        -- ความแม่นยำ (เมตร)
  speed_kmh   numeric(6,1),
  recorded_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  client_ref  text unique                          -- กันซ้ำเมื่อเครื่อง retry
);
create index if not exists gps_points_patient_time_idx
  on public.gps_points (patient_id, recorded_at desc);

create table if not exists public.geofences (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients(id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 1 and 80),
  kind        text not null default 'circle' check (kind in ('circle','polygon')),
  center_lat  double precision,                    -- กรณีวงกลม
  center_lng  double precision,
  radius_m    integer check (radius_m between 20 and 50000),
  polygon     jsonb,                               -- กรณี polygon: [[lat,lng],...]
  address     text,
  is_active   boolean not null default true,
  notify_all  boolean not null default true,       -- true = แจ้งสมาชิกทุกคน
  created_by  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint geofence_shape_check check (
    (kind = 'circle'   and center_lat is not null and center_lng is not null and radius_m is not null)
    or (kind = 'polygon' and polygon is not null and jsonb_array_length(polygon) >= 3)
  )
);
```

### 2.2 API
| Endpoint | สิทธิ์ | เรื่อง |
|---|---|---|
| `POST /api/device-event` (event_type=`GPS_BATCH`) | device secret (มีอยู่) | รับ 50 จุด/batch, dedup, ประเมิน geofence ฝั่ง backend |
| `GET /api/track` (?patient_id&from&to) | สมาชิกทุกคน | ทาง polyline + last-known |
| `GET /api/geofences` | สมาชิกทุกคน | รายการวงล้อม |
| `POST / PATCH / DELETE /api/geofences` | primary เท่านั้น | สร้าง/แก้/ปิด (ปิด = is_active false) |

### 2.3 UI แผนที่ (ฟรี 100% ไม่มี API key)
- **Leaflet + OpenStreetMap** ไม่ใช้ Google Maps เลี่ยงค่าใช้จ่ายและ key
- หน้าใหม่ใน sidebar "ตำแหน่งและพื้นที่ปลอดภัย":
  - marker pulse ทำหน้า **last-known position**
  - polyline บางสี teal ขนมา 24 ชม.
  - วงล้อม active = วงโปร่งแสน + chip สถานะ: อยู่ในเขต / ออกนอกเขต (นาที)
- แท็บจัดการวงล้อม: วาดวงกลม (ลาก marker ตั้งรัศมี) หรือ polygon (คลิกทีละจุด)

### 2.4 อัลกอริทึม geofence — หัวใจคือ Hysteresis (กัน alert กระพริบ)
```js
// วงกลม: เทียบระยะ haversine <= radius
// polygon: ray casting
function pointInPolygon(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > lng) !== (yj > lng) &&
        lat < (xj - xi) * (lng - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// เกณฑ์ "ออกเขต" ให้ยงตัดสินนสนุน
inside  = distance <= radius_m * 1.0;        // เขตของเขตตรงแบบกึ่ง
outside = distance >= radius_m * 1.15;       // margin 15% ไม่ลื่น
breach  = outsideStreak >= 2 && durationSec >= 60;
```
- ประเมินทุกจุดฝั่ง **backend** ตอน ingest (ไม่หนักเครื่อง กัน tamper firmware)
- ผ่านเกณฑ์: `INSERT alerts` (GEOFENCE_EXIT, severity critical) + notify ตาม prefs

---

## 3. ฟีเจอร์ที่ 3 — ติดตามการดูแล (Sleep / ยา / สัญญาณชีพ)

### 3.1 ตารางใหม่
```sql
-- ผลการนอนต่อคืน (เครื่องคำประมาณระหว่างรอบกลางคืน, ส่งต่างช่วงเช้าฝันคอยหลับรุ่ย)
create table if not exists public.sleep_nights (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients(id) on delete cascade,
  device_id     uuid references public.devices(id) on delete set null,
  night_date    date not null,                     -- วันที่ "เริ่มคืน"
  asleep_at     timestamptz not null,
  woke_at       timestamptz not null,
  duration_min  integer not null check (duration_min between 0 and 1440),
  restless_min  integer not null default 0,        -- ชอบบิดพลิก
  awake_min     integer not null default 0,        -- คย้องเมลือกตื่น
  quality       text not null default 'unknown'
                check (quality in ('good','fair','poor','unknown')),
  client_ref    text unique,
  created_at    timestamptz not null default now()
);
create index if not exists sleep_nights_patient_idx
  on public.sleep_nights (patient_id, night_date desc);

-- ชีพจร: ชุเวลาอัตโนมัติ (1 นาที/จุด, ส่ง batch 15 นาที)
create table if not exists public.hr_samples (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients(id) on delete cascade,
  device_id   uuid references public.devices(id) on delete set null,
  bpm         integer not null check (bpm between 30 and 200),
  spo2        integer check (spo2 between 50 and 100),
  recorded_at timestamptz not null,
  client_ref  text unique
);
create index if not exists hr_samples_patient_idx
  on public.hr_samples (patient_id, recorded_at desc);

-- โปรแกรมเวลายาของแต่ละผู้ป่วย
create table if not exists public.med_schedules (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients(id) on delete cascade,
  label       text not null,                        -- "ยาพารา - ช่วงเช้า"
  time_of_day time not null,                        -- '08:00'
  compart_no  smallint not null check (compart_no between 1 and 3),
  days        integer[] not null default '{0,1,2,3,4,5,6}',    -- 0=อา 6=ส
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- บันทึกการทานจริง (จากเครื่องเท่านั้น — มือไม่จับ)
create table if not exists public.med_intakes (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients(id) on delete cascade,
  pillbox_id  uuid references public.devices(id) on delete set null,
  schedule_id uuid references public.med_schedules(id) on delete set null,
  compart_no  smallint not null check (compart_no between 1 and 3),
  action      text not null check (action in ('taken','missed','unscheduled')),
  weight_g    numeric(6,1),
  taken_at    timestamptz not null,
  client_ref  text unique,
  created_at  timestamptz not null default now()
);
create index if not exists med_intakes_patient_idx
  on public.med_intakes (patient_id, taken_at desc);
```

### 3.2 API
| Endpoint | สิทธิ์ | เรื่อง |
|---|---|---|
| `POST /api/device-event` (+ `SLEEP_SUMMARY`, `HR_BATCH`, `MED_EVENT`) | device secret | รับแหล่งเดียว ทุกข้อมูลเครื่อง |
| `GET /api/care-log` (?patient_id) | สมาชิกทุกคน | สรุป 7 วัน: sleep + ยา + HR |
| `GET / POST / DELETE /api/med-schedules` | primary จัดการ ทุกคนดู | เวลายา |
| `POST /api/cron/missed-meds` | internal cron | ตรวจยาพลาด -> `PILL_NOT_TAKEN` |

### 3.3 UI
- **การ์ดรายวัน** ต่อจาก metric strip:
  - คืนนี้: ชั่วโมงนอน + แถบ quality (สีตาม severity) + "พลิกตัว 12 ครั้ง, ตื่น 2 ครั้ง"
  - ยา: รอบเช้า/บ่าย/เช้า + จุด taken/missed 7 วัน
  - ชีพจร: sparkline 24 ชม. + bpm ล่าสุด
- ข้อ `_indexes ในทุกรายgonarget:  assemblyทันทีเมื่อแตะขึ้น alert/email หลังเหตุการณ์เสร็จสมบูรณ์

---

## 4. โปรโตคอล: ฮาร์ดแวร์ → เว็บแอป

### 4.1 ทางเดินข้อมูลเดียว
```
ESP32 (wristband หรือ pillbox)
  ├─ WiFi บ้าน (ต้นแบบ — ง่ายและฟรี)
  └─ NB-IoT/GSM (SIM7000G) ตอนออกนอกบ้าน (ทางเลือกในรุ่นสมชกาชิก)
        POST https://geowrisx-ad-v2.pages.dev/api/device-event
        Authorization: Bearer DEVICE_INGEST_SECRET
        body: { device_id, event_type, client_ref (uuid v4), recorded_at, data: [...batch] }
```

**กฎร่วม 5 ข้อ (บังคับ firmware ทุกเครื่อง):**
1. **Batch + recorded_at เวลาเครื่อง** — ออฟไลน์ได้ ส่งชุด
2. **Store-and-forward** — ออฟไลน์เก็บใน NVM ได้ 2000 เหตุการณ์ส่งถอยหลังได้
3. **client_ref = uuid v4 ทุกเหตุการณ์** — backend dedup ผ่าน unique constraint
4. **CONFIG_FROM_SERVER** — flush รับ interval จากเซิรฟเวอร์ (เปลี่ยนความถี่ได้โดยไม่ต้อง flash)
5. **Rate limit ถึง 50 เหตุการณ์/batch** — (KV RATE_LIMIT มีอยู่แล้ว)

---

## 4.2 รายการส่วนประกอบ (BOM) — เครื่องต้นแบบจริง

### สายรัดข้อมือ (wristband) — เงิน 700–1,000 บาท/เครื่อง
| ส่วนประกอบ | ราคา บาท | ทำอะไร |
|---|---|---|
| ESP32-C3 SuperMini / Seeed XIAO C3 | 80–150 | MCU หลัก: อ่านเซนเซอร์ เก็บ ส่ง WiFi |
| MAX30102 (หัวใจ + SpO2) | 60–120 | BPM, SpO2 ทุก 1 นาที |
| MPU-6050 (accel+gyro) | 40–80 | พลิกตัว (นอน), ล้ม (fall), สวม/ถอด (anti-removal) |
| NEO-6M / ATGM336H GPS | 150–200 | ตำแหน่ง — จำเป็นสำหรับ geofencing |
| (เสริม) SIM7000G + NB-IoT SIM | 350–600 | ออกบ้านส่งได้ (รุ่นถัดไป) — ต้นแบบใช้ WiFi พอ |
| Li-Ion 500–1000mAh + TP4056 | 120–200 | อยู่ 24–48 ชม. + สวิตช์ตัดไฟ |
| ตัวถัง 3D-print + สายรัด | — | กันน้ำพอใช้ + label |

### กล่องยา (pillbox) — ต่อยอดจาก BLE เดิม 3 ช่อง
| ส่วนประกอบ | ราคา บาท | ทำอะไร |
|---|---|---|
| ESP32-C3 | 100–150 | BLE + WiFi + รับคำสั่ง unlock เดิม |
| HX711 + load cell (1 ชุด + ถาดหมุน หรือ 3 ชุด) | 60–200 | น้ำหนักยาลดลง = ทานแล้ว |
| Reed switch ประตู (2–3 ตัว) | 25–50 | open/close ต่อช่อง |
| RTC DS3231 + CR2032 | 50–80 | นับเวลายาได้ + WiFi ล้มหลังชืน |
| Buzzer + RGB LED | 20–30 | เสียง + ไฟเตือนยา |
| 18650 + TP4056 | 100–150 | โครงไฟเดียวกับสายรัด |
| OLED SS1306 (เสริม) | 30–50 | เวลายาถัดไป + ชื่อยาให้เห็นตาเปล่า |

**ป้ายเรียลของต้นแบบ: อยู่ได้ 1–2 วัน / ชาร์จ, ส่งจริงขึ้นเว็บแอปได้สัปดาห์แรกใน P4**

---

## 4.3 อัลกอริทึมหลักเครื่อง (pseudocode)

### (ก) วงจรหลัก — ประหยัดไฟ
```
loop:
  read_gps(): interval 15 นาที ในบ้าน / 1 นาที ใกล้ขอบเขต
  mag = |accel - 1g| ตรวจตลอด
  store_into ring_buffer({type, timestamp, client_ref=uuid4, data})
  if SOS or FALL:    flush_now()            )  เสี่ยง = ส่งชุดเลย
  elif buffer >= 10 or 15 นาที: flush()
  deep_sleep(90 s)                          )  ไปามายาสุด 24–48 ชม.
```

### (ข) Fall detection
```
mag = sqrt(ax^2 + ay^2 + az^2)     // ปกติ ~ 1g
if mag < 0.4g นาน 200ms            -> freefall
 if ตามด้วย 500ms มี mag > 2.5g     -> impact
 if ต่อ 3 วิ นิยง + ท้าตัวเอียงผิดปกติ -> FALL_CONFIRMED
before: ก่อนแจ้ง รอ 15 วิ ให้กดสบายดี (กัน false alarm)
none:   ไม่กด -> SOS พร้อมจุด GRS ล้าสุด ใน alerts + email
```

### (ค) นอนหลับ — 30 วิ/อีปอก
```
เล적จุกที่ 30 วิ:  accel_rms = RMS(a)
                  hr_delta = bpm - baseline
sleep epoch: accel_rrms < 0.02g 90% epoch + hr_delta < -5
คืนเริ่ม:     ต่อเนื่อง >= 20 epoch (10 นาที)
ตื่นกลางคืุน: ขยัยแรง >= เ 3 epoch ติด -> awake_min += 1.5
เช้า:        กลับมาสถานะเครื่องปลุกตั้งอาเท -> SLEEP_SUMMARY
quality:     >= 7 ชม + awake <= 20 นาที = good
             >= 6 ชม + awake <= 45 นาที = fair
             อื่นๆ = poor / unknown
```

### (ง) ยาทานจริง — แนวตั้งน้ำหนัก (HX711) หรือ reed switch
```
เปิดช่อง N            -> wake อ่านน้ำหนัก
W1 ก่อนเปิด  W2 หลังปิด
dose = W1 - W2
หาก dose >= 60% UNIT_DOSE
   -> ช่วง schedule ใกล้สุด ± 45 นาที ทานแล้ว
   -> MED_EVENT 'taken' (นอกเวลา => 'unscheduled'), weight = dose
cron 15 นาที: เวลายาผ่านไป 60 นาที แล้วไม่มี med_intake
   -> 'missed' + PILL_NOT_TAKEN  (ไม่แจ้งซ้ำข้ามคืน)
```

### (จ) Anti-removal / ถอดสาย
```
สายรัด: ตรวจสถานะว่าสวม เมื่อ:
  เซนเซอร์เริ่มสจัน (mpu) + MAX30102 ไม่มีสนัญาณ 60 วิ ติด
  = ถอดออก -> TAMPER + จุด GPS ระหว่างถอด (ล่าสุด)
  ช่วงน่าเชื่อ: ระหว่างนอน/อาบน้ำ (ถอดได้ชั่วคราว) — มี config time window
```

---

## 5. SDLC (รูปแบบ จากพบเจอขอเจริจงาน — เปอรแนวทาง)

### โมเดลที่เลือก: Incremental / Agile — ทีละเฟส จบชุดเสร็จสรุปเสร็จ

| เฟส | สิ่งที่ลุงเลยทำ | DoD (จบเฟส) |
|---|---|---|
| **P0 รากฐาน** | migration ตารางใหม่ (idempotent) + API stub | run ผ่าน db/schema migration, smoke test |
| **P1 Settings menu** | เมนูตั้งค่าครบ + prefs API | toggle บันทึกจริง + a11y |
| **P2 GPS + แผนที่** | Leaflet map + geofence CRUD + GPS_BATCH | mock device ส่งแผนที่โชว์ |
| **P3 Sleep + ยา + HR** | การ์ด care-log + schedule + cron | ข้อมูลเทียม 7 วันแสดงถูก |
| **P4 ฮาร์ดแวร์ต้นแบบ** | wristband + pillbox ส่งจริง | device-event จากเครื่อง 100% + แบต 24 ชม. |
| **P5 Integration + QA** | load test + สิทธิ์ตามบทบาท + security review | rate limit ผ่าน + secret ชีรแน่น |
| **P6 Go-live** | ผู้ใช้จริง + ติดตาม | DEPLOY_CHECKLIST ครบ |

DoD ทุกเฟสร่วมกัน: build ผ่าน + check-functions ผ่าน + a11y + ไม่มี secret หลุด + commit/push + deploy alias

### ความเสี่ยง — พร้อมแผนบริหาร
| ความเสี่ยง | แนวรองรับ |
|---|---|
| GPS เป็นข้อมูลส่วนบุคคลละเอียดอ่อน | ทุก API ผ่าน caregiver_links, ลบจุดเก่าหลัง 90 วัน, ยินยอมก่อนใช้ |
| แบตหมดกลางวัน | duty-cycle + CONFIG_FROM_SERVER + LOW_BATTERY |
| GPS ในบ้านไม่แม่น | โชว์ค่า acc_m กำกับทุกจุด, ในบ้านแสดง "อยู่ที่บ้าน" จาก WiFi + geofence แทนจุด |
| เครื่องส่งข้อมูลมั่ว / โจมตี | rate limit ต่อ device (KV มีอยู่แล้ว) + batch <= 50 |

---

## 6. ลำดับงานออกทีัยเริม (ยัยคงเบือถัิ่ทจะการก่า)
1. **P0 + P1** — migration ตารางใหม่ + เมนู "ตั้งค่า" + prefs API   (เริ่มได้วันนี้)
2. **P2** — แผนที่ + geofence + GPS_BATCH
3. **P3** — บัตร care-log + เวลายา + cron
4. **P4** — คุณแระ operational หรือซื้ออุปกรณ์ไปพร้อมกัน ผมเขียน firmware + เกาะเครื่องจริง

> ตอบ "**เริ่ม P0+P1**" ได้ทันที เพื่ิเร่งทำงานเยอะและไม่กระทบหน้าปัจจุบัน
