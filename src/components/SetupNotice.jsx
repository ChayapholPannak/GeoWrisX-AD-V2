import { HeartPulse, ShieldCheck } from 'lucide-react';

/**
 * Shown when VITE_CLERK_PUBLISHABLE_KEY is missing, so the app explains the
 * setup instead of crashing inside ClerkProvider.
 */
export default function SetupNotice() {
  return (
    <div className="setup-shell min-h-screen p-5 lg:grid lg:grid-cols-[1fr_.72fr] lg:items-center lg:p-8">
      <section className="setup-context hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-3">
          <div className="brand-mark grid h-11 w-11 place-items-center">
            <HeartPulse size={23} />
          </div>
          <div>
            <div className="text-lg font-semibold">
              GeoWrisX <span>AD</span>
            </div>
            <div className="text-xs">Caregiver Safety Console</div>
          </div>
        </div>
        <div className="max-w-md">
          <p className="text-sm font-semibold">Before the first sign-in</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight">
            เชื่อมต่อ Clerk
            <br />
            <span>และ Neon ก่อนเริ่มใช้งาน</span>
          </h2>
          <p className="mt-5 text-sm leading-7">
            เว็บแอปใช้เฉพาะ Publishable Key ของ Clerk ส่วนคีย์ลับ ฐานข้อมูล และที่เก็บไฟล์จะอยู่ฝั่ง
            Cloudflare Pages Functions เท่านั้น
          </p>
        </div>
        <p className="text-xs">ต้นแบบเพื่อการศึกษา · ไม่ใช่อุปกรณ์การแพทย์ที่ผ่านการรับรอง</p>
      </section>

      <div className="grid place-items-center lg:p-8">
        <div className="setup-panel w-full max-w-lg border bg-white p-7">
          <div className="brand-mark mb-4 grid h-12 w-12 place-items-center">
            <ShieldCheck />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">ตั้งค่า GeoWrisX AD V2</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            ยังไม่ได้ตั้งค่า Clerk ให้สร้างไฟล์{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5">.env</code> จาก{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5">.env.example</code> แล้วใส่
            Publishable Key ของโปรเจกต์ Clerk จากนั้นรีสตาร์ตเซิร์ฟเวอร์
          </p>
          <div className="mt-5 rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-700">
            VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">
            ฝั่งเซิร์ฟเวอร์ใช้ <code className="rounded bg-slate-100 px-1 py-0.5">.dev.vars</code>{' '}
            สำหรับ <code className="rounded bg-slate-100 px-1 py-0.5">NEON_DATABASE_URL</code>,{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5">CLERK_SECRET_KEY</code>,{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5">RESEND_API_KEY</code> และ R2 binding{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5">FILES</code> — ดูรายละเอียดใน README
          </p>
        </div>
      </div>
    </div>
  );
}
