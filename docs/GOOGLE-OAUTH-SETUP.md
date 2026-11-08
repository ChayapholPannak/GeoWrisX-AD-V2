# ปุ่ม "ดำเนินการต่อด้วย Google" — สรุปสถานะ

## ✅ ผลลัพธ์ 8 พ.ย. 2569: ใช้ได้แล้ว

ทดสอบกดจริง end-to-end ผ่าน: กดปุ่ม → ยืนยันตัวตน Google (device prompt) →
กลับมา Clerk callback → **ล็อกอินเข้า Dashboard สำเร็จ** (บัญชี `chayaphol524@gmail.com`,
user `user_3LTLvSt...` ตรงบัญชีเดิมที่เคยใช้ password — Clerk รวมบัญชีให้เองด้วย email)

- error `authorization_invalid` รอบก่อนเกิดจาก **state cookie ของ OAuth
  หาย/ต่าง session** (third-party cookie หรือแท็บที่ page ค้าง session เดิม)
  — หลังไปจบ flow ใหม่จนสำเร็จจึงกลับมาเสถียร
- โค้ดไม่ต้องแก้อะไร; CSS ที่เคยซ่อนปุ่มถูกลบไปแล้ว (commit `59c5fa1`)

### ถ้ากลับมาพังซ้ำ (เผื่อไว้)

1. ลอง **Incognito** ของ Chrome ปกติก่อน — ที่พังมักมาจาก cookie แท็บเก่า
2. ยังพัง → ทำ custom credentials ของเราเองตามขั้นด้านล่าง (ฟรี):

## การตั้งค่า Google OAuth ของเราเอง (เมื่อมีปัญหาซ้ำ)

1. **Google Cloud Console** → APIs & Services → **OAuth consent screen**
   - User type: External, App name: GeoWrisX AD
   - **Publishing status: "In production"** (ถ้าปล่อย "Testing" ต้องเพิ่มอีเมล
     ผู้ดูแลทุกคนใน Test users ไม่อย่างนั้น Google ปฏิเสธบัญชีอื่น)
   - scope พอแค่ `openid`, `...userinfo.email`, `...userinfo.profile`
2. **Credentials → Create credentials → OAuth client ID → Web application**
   - Authorized JavaScript origins: `https://geowrisx-ad-v2.pages.dev` (+ localhost dev)
   - Authorized redirect URIs: **คัดลอกค่าจาก Clerk มาใส่พอดี** — Clerk Dashboard
     → Configure → SSO Connections → Google จะแสดง redirect URI เดียวที่ต้องใช้
     (รูปแบบ `https://clerk.<slug>.accounts.dev/v1/oauth_callback`)
3. Clerk → SSO Connections → Google → **Use custom credentials** → paste
   Client ID + Client Secret → Save
4. ทดสอบ: กดปุ่ม Google → เลือกบัญชี → เข้า Dashboard ได้

## ตารางเช็คเร็ว (ถ้าพังแล้วอยากหาว่าเพราะอะไร)

| อาการ | ต้นเหตุที่เจอบ่อย |
|---|---|
| กดแล้วอยู่หน้า login เลย, ไม่ไป Google | Google connection ถูก disable ใน Clerk |
| `Error 403: access_denied` ที่หน้า Google | Publisher status "Testing" และบัญชีไม่อยู่ใน Test users |
| `authorization_invalid` หลังเลือกบัญชี | redirect URI ใน Google ไม่ตรงกับที่ Clerk ต้องการ / state cookie หาย (ลอง Incognito) |
| Login ได้แต่เข้าเว็บไม่ได้ | Allowed origins ใน Clerk ไม่มีโดเมนนั้น |

## บั๊บที่แก้แล้วใน rotation เดียวกัน (จบ 8 พ.ย.)

- ปุ่ม manage ทหน้าแผนที่/care-log ขึ้น "โหมด companion" เมื่อโหลดหน้า Wise —
  `patientId` state ตั้งครั้งเดียวตอน mount (ตอนนั้น patients ยัง `[]`) และไม่กลับมาเติม
  → แก้ด้วย effect เติมตัวเลือกแรกทันทีที่ patients โหลด
- แผนที่ว่าด้วยผู้ป่วยไม่มี GPS ไม่มีวง → Leaflet ไม่มี `setView` มัน **เมิน
  ทุก click** รวมวาด polygon ทำงานแล้วเช็คได้จริง (`Set map center and zoom first`)
  → แก้ด้วย default view Bangkok zoom 13 ทันทีที่ไม่มีข้อมูลพิกัด


> ### ภาคผนวก: บันทึกการวินิจฉัยรอบแรก (ก่อนทดสอบสำเร็จ) — เก็บไว้อ้างอิง
>
> สถานะตรวจสอบ 8 พ.ย. 2569 (อัตโนมัติผ่านเบราว์เซอร์ทดสอบ):
>
> - ปุ่มบนหน้า login **ทำงานได้ถึงจุดหนึ่งจริง** — กดแล้วถูกส่งไปหน้า
>   "Sign in to continue to Clerk" ของ Google ไม่ใช่ปุ่มตาย
> - error `authorization_invalid` เกิด **หลัง**เลือกบัญชี Google ตอนกลับเข้า
>   Clerk `oauth_callback` — ค่าที่ Clerk ส่งไป Google:
>   - `client_id = 787459168867-...apps.googleusercontent.com`
>     (เป็น **shared dev credentials ของ Clerk**, ไม่ใช่ credentials ที่เราสร้างเอง)
>   - `redirect_uri = https://clerk.shared.lcl.dev/v1/oauth_callback`
> - สรุปสุดท้าย: โค้ดไม่ผิด — เป็น state/cookie ของ session ทดสอบเอง,
>   จบ flow ใหม่ในตัวเดิมแล้วสำเร็จ (ดูผลลัพธ์บนสุด)

---

## ขั้นแรก: ทดสอบซ้ำในเบราว์เซอร์ปกติของคุณ (ใช้เวลา 2 นาที — ทำก่อนเสมอ)

เบราว์เซอร์ทดสอบอัตโนมัติที่เราได้ error อาจโดน "third-party cookie ถูกปิด"
ซึ่งทำให้ Clerk เสีย state cookie ระหว่างเดิน OAuth → `authorization_invalid`
(สาเหตุที่พบบ่อยที่สุด):

1. เปิดหน้าเว็บ https://geowrisx-ad-v2.pages.dev แบบ **Incognito** ใน Chrome ปกติของคุณ
2. กด "ดำเนินการต่อด้วย Google"
3. เลือกบัญชี Google แล้วดูว่าพังที่จุดไหน

ถ้า Incognito **ได้** → ที่หายไปคือ cookie ของแท็ก; ปิด unwind ad blocker
/ ยอมรับ cookie บนโดเมน `pages.dev` แล้วปุ่มจะใช้ได้เลย จบ.

ถ้ายัง `authorization_invalid` → ไปขั้นที่ 1 ด้านล่าง.

---

## ขั้นที่ 1: ตรวจ Clerk ว่ายังใช้ shared dev credentials จริง

1. เข้า https://dashboard.clerk.com → เลือก instance ของโปรเจ็กต์
2. เมนูซ้าย: **Configure → SSO Connections** (หรือ "Sign-in options" ใน instance เก่า)
3. ที่การ์ด **Google**:
   - ถ้าแสดง **"Demo connection"** / "Provided by Clerk" และ restore ดี = shared
     mode ปกติ — ข้ามไปขั้นที่ 2
   - ถ้าการ์ดแสดง **รายละเอียด custom client** (Client ID/Secret ของเราเอง):
     ตรวจว่า `redirect_uri` ที่ลงทะเบียนไว้ใน Google Cloud Console ตรงแบบตัวต่อตัว
     กับที่ Clerk แสดง — ค่าขี้เกียจตามตราบใดที่แตกต่าง 1 ช่องจะก่อให้
     `authorization_invalid` ได้ ตรงกันเต็ม ๆ เท่านั้น

## ขั้นที่ 2 (แนะนำแก้เด็ดขาด): ตั้ง Google credentials ของเราเอง

เหตุผล: shared dev credentials ของ Clerk ใช้ทดสอบได้แต่พัฒนาเว็บเครื่องชน
redirect มา conditional ว่าเสีย cookie; เอาให้แน่นอน → ทำของเราเอง (ฟรี):

1. เข้า https://console.cloud.google.com → **APIs & Services → OAuth
   consent screen**
   - User type: External
   - App name: GeoWrisX AD, ใส่ email ผู้ดูแล
   - **Publishing status: ตั้งเป็น "In production"** (ถ้าปล่อย "Testing" ต้องเพิ่ม
     อีเมลบัญชี Google ของผู้ดูแลทุกคนใน Test users ไม่อย่างนั้น Google
     ปฏิเสธบัญชีอื่นทันที)
   - ไม่ต้องขอ scope พิเศษนอกจาก `openid`, `...userinfo.email`, `...userinfo.profile`
2. **Credentials → Create credentials → OAuth client ID → Web application**
   - **Authorized JavaScript origins**: `https://geowrisx-ad-v2.pages.dev`
     (+ `http://localhost:5173` สำหรับ dev)
   - **Authorized redirect URIs**: กลับไปหน้า Clerk → Configure → SSO
     Connections → Google จะ **แสดง redirect URI ตัวเดียวที่ต้องใส่พอดี**
     (รูปแบบ `https://clerk.<slug>.accounts.dev/v1/oauth_callback` สำหรับ
     dev instance, หรือโดเมน prod instance) — **คัดลอกจาก Clerk มาใส่ Google
     ตัวต่อตัว ห้ามพิมพ์เอง**
3. กลับมา Clerk → SSO Connections → Google → เลือก **Use custom
   credentials** → paste `Client ID` + `Client Secret` จาก Google Console → Save
4. ทดสอบตาม "ขั้นแรก" บนเว็บจริง ปุ่มควร login ได้ตั้งแต่ครั้งแรก

## ขั้นแรก (หากรอบเก่ายังค้างอยู่): ทดสอบซ้ำในเบราว์เซอร์ปกติของคุณ

| อาการ | ต้นเหตุที่เจอบ่อย |
|---|---|
| Google หน้า sign-in ขึ้น `Error 403: access_denied` | Google App ยังอยู่ "Testing" และบัญชีไม่ได้อยู่ใน Test users |
| Clerk แสดง `authorization_invalid` หลังเลือกบัญชี | redirect URI ที่ Google ไม่ตรงกับที่ Clerk ต้องการ |
| กดแล้วเด้งกลับหน้า login เลย, ไม่ไป Google | Google connection ถูก **disable** อยู่ใน Clerk |
| Evolving "state mismatch" หรือพังโดยเบราว์เซอร์บางตัว | third-party cookie ถูกปิด / ใช้แท็บ sync ข้ามเครื่อง |

## ข้อควรจำ (ทำใน Cloudflare + Clerk ค้างไว้)

- Clerk `signed in ทุกเมธอด` ไม่ต้องแก้โค้ด — App.jsx ไม่มี config OAuth ใด
- Google button ถูกเปิดกลับหลังซ่อนด้วย CSS — commit `59c5fa1` ลบ rule
   `.cl-socialButtonsArea` ออกแล้ว; อย่าเพิ่มกลับ
- logo ปุ่ม/wording แก้ไม่ได้ผ่านเบราว์เซอร์ — มัน render จาก Clerk components

เมื่อ Google login ใช้ได้แล้ว แจ้งได้เลย — ผมจะทดสอบซ้ำเต็ม flow + บันทึกผล
ในเช็คลิสต์ให้ครบ
