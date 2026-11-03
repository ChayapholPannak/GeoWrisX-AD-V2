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

## H. ความปลอดภัยก่อนใช้งานจริง

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
