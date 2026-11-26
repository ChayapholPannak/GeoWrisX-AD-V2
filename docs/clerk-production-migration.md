# Clerk: ย้ายจาก Development instance → Production

> สถานะ: **เตรียมพร้อม รอโดเมน** (production instance ของ Clerk ต้องมีโดเมนที่เราควบคุม DNS)
> เอกสารนี้อ้างอิงสภาพจริงของโปรเจกต์ ณ 2026-11-26

## ทำไมต้องย้าย

| ประเด็น | Development (ตอนนี้) | Production |
|---|---|---|
| Publishable key | `pk_test_…` (`funny-fowl-8793.clerk.accounts.dev`) | `pk_live_…` บนโดเมนของเรา |
| เพดานผู้ใช้ | **100 คน** | ตามแผน (free tier ~10k MRU) |
| Badge บนหน้าเว็บ | ขึ้น "Development mode" ให้ผู้ใช้เห็น | ไม่มี |
| เหมาะกับข้อมูลจริง | ❌ | ✅ |

ผลสแกนความปลอดภัยภายนอกจัดเป็นความเสี่ยงระดับสูง เพราะเว็บ production กำลังใช้ auth แบบ development

## ข้อกำหนดที่ยังติด (blocker)

Clerk production instance **ต้องผูกโดเมนที่เรามีสิทธิ์เพิ่ม DNS record** (เช่น `clerk.example.com`)
- ใช้ `geowrisx-ad-v2.pages.dev` เป็นโดเมนของ Clerk ไม่ได้ เพราะเราไม่ได้เป็นเจ้าของ DNS ของ `pages.dev`
- ตัวแอปเองยังอยู่บน `*.pages.dev` ได้ตามเดิม — โดเมนนี้ใช้เฉพาะ frontend API ของ Clerk
- โดเมนฟรีแบบ is-a.dev ถูกปฏิเสธไปแล้ว; ทางเลือกที่เหลือคือโดเมนที่ถืออยู่แล้ว หรือซื้อใหม่ (มีค่าใช้จ่ายรายปี)

## ขั้นตอน (เมื่อมีโดเมนแล้ว)

### 1. สร้าง production instance
1. Clerk Dashboard → application `funny-fowl-8793` → **Deploy to production**
2. ใส่โดเมน เช่น `clerk.<our-domain>` แล้วเพิ่ม DNS ตามที่ wizard ให้ (ปกติคือ CNAME ไป `frontend-api.clerk.services` และ `accounts.<domain>` → `accounts.clerk.services`)
3. รอ certificate เป็น Active
4. เก็บค่าใหม่: `pk_live_…`, `sk_live_…` (อย่าส่งในแชท — ใส่เป็น secret โดยตรง)

### 2. สลับค่าในโปรเจกต์
- **build-time (จำเป็น)**: `.env.local` → `VITE_CLERK_PUBLISHABLE_KEY=pk_live_…` (ไฟล์นี้ gitignored; ค่า pk ถูกฝังตอน `vite build` ไม่ใช่ runtime)
- **runtime secrets (Cloudflare Pages)**: `CLERK_SECRET_KEY=sk_live_…`
- คงค่าเดิมได้: `CLERK_AUTHORIZED_PARTIES=https://geowrisx-ad-v2.pages.dev`, `ALLOWED_ORIGINS=https://geowrisx-ad-v2.pages.dev`
- `npm run check; npm run deploy`

### 3. ย้ายผู้ใช้ (ตัวเลขจริงจาก inventory 2026-11-26)

Clerk dev instance มี 8 บัญชี; ผู้ที่มีข้อมูลใน Neon:

| บัญชี | refs | หมายเหตุ |
|---|---|---|
| ki***@gm*** (อาโน) | 3 | owner 1 ผู้ป่วย + link + invite |
| pi***@gm*** | 7 | owner 3 ผู้ป่วย |
| pa***@gm*** | 3 | owner 1 ผู้ป่วย |
| ch***@gm*** | 8 | owner 2 ผู้ป่วย + prefs + อนุมัติกล่องยา |
| pg***@gm*** | 1 | companion link |
| อีก 2 บัญชี | 0–1 | มีแค่ caregiver profile |

Production instance เริ่มด้วยผู้ใช้ **0 คน** และ Clerk ไม่เปิดให้ export password hash ผ่าน API ดังนั้นแต่ละคนต้องสมัคร/ตั้งรหัสใหม่ (หรือใช้ Google ซึ่งอีเมลเดิมจะได้ id ใหม่)

### 4. remap id ใน Neon ด้วยสคริปต์

```powershell
# 1) ดูสถานะปัจจุบัน (อ่านอย่างเดียว)
node scripts/clerk-migration.mjs inventory

# 2) หลังทุกคนสมัครใน production แล้ว สร้างไฟล์ mapping
#    .migration/mapping.json  (gitignored)
# { "users": [ { "email": "a@example.com", "old_id": "user_...", "new_id": "user_..." } ] }

# 3) ตรวจก่อน (ไม่เขียน)
node scripts/clerk-migration.mjs plan .migration/mapping.json

# 4) เขียนจริง — หนึ่ง transaction ต่อผู้ใช้
node scripts/clerk-migration.mjs apply .migration/mapping.json --apply
```

สคริปต์ remap ครบทุกคอลัมน์ที่มี Clerk user id:
`patients.owner_id`, `caregiver_links.user_id`, `caregiver_profiles.user_id`, `user_prefs.user_id`,
`caregiver_invites.created_by`, `geofences.created_by`, `patient_appointments.created_by`,
`alerts.acknowledged_by`, `pillbox_approvals.approved_by`

- ถ้า id ใหม่มีข้อมูลอยู่แล้ว (ผู้ใช้กดเล่นก่อน migrate) จะ merge: role `primary` ชนะ, profile/prefs เก็บของใหม่ไว้
- หลัง apply สคริปต์จะนับแถวที่ยังค้าง old id และ error ถ้าไม่เป็นศูนย์

### 5. ตรวจรับ
- login ด้วยบัญชีจริง → เห็นผู้ป่วยเดิมครบ
- `/api/dashboard` 200, TrackView โหลดจุด GPS, หน้า caregiver แสดง companion
- หน้าเว็บไม่มีคำว่า "Development mode" และ key ที่ bundle เป็น `pk_live_`

## Rollback
1. คืน `.env.local` เป็น `pk_test_…` + Pages secret `sk_test_…` แล้ว deploy
2. ใช้ mapping กลับด้าน (new→old) กับสคริปต์เดิม
3. เก็บไฟล์ `.migration/plan-*.json` ไว้เป็นหลักฐานก่อน/หลังเสมอ

## หมายเหตุด้านความปลอดภัย
- อย่า commit `.env.local`, `.dev.vars`, หรือ `.migration/` (ignore ไว้แล้ว)
- ระหว่างเปลี่ยนผ่าน ควรปิดการสมัครใหม่ชั่วคราว หรือแจ้งผู้ใช้ล่วงหน้า
- หลัง migrate สำเร็จ ให้ rotate `sk_live_` ถ้าเคยส่งผ่านช่องทางใด ๆ และลบ key test ออกจากเครื่องที่แชร์
