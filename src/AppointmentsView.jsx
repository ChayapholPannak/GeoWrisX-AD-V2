import { useCallback, useEffect, useState } from 'react';
import {
  CalendarCheck, ChevronRight, CheckCircle2, ListTodo, Pencil, Plus, RefreshCw,
  Trash2, XCircle, Ban, MapPin, Clock, BellRing,
} from 'lucide-react';
import { EmptyState, formatDate } from './App.jsx';

const STATUS_BADGE = {
  scheduled: null, // แสดง chip "อีก N วัน" แยก
  done: { text: 'สำเร็จ', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  canceled: { text: 'เลื่อน / ยกเลิก', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
};

function toInputValue(iso) {
  const d = new Date(iso || Date.now());
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function longDate(iso) {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

function clockText(iso) {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

function dayBadge(iso) {
  const d = new Date(iso);
  return {
    day: d.getDate(),
    month: new Intl.DateTimeFormat('th-TH', { month: 'short' }).format(d),
  };
}

function daysAhead(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return null;
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return 'วันนี้';
  if (days === 1) return 'พรุ่งนี้';
  return `อีก ${days} วัน`;
}

/** ตารางนัดหมาย — นัดโรงพยาบาลของผู้ป่วย + เตือนผู้ดูแลล่วงหน้า 1 วันและ 3 ชม.
 *  Data: GET/POST/PATCH/DELETE /api/appointments (+ cron appointment-reminders). */
export default function AppointmentsView({ patients, viewerUserId, authedRequest, onNotice, onBack, onChanged }) {
  const activePatients = patients.filter((p) => !p.is_archived);
  const [patientId, setPatientId] = useState(activePatients[0]?.id || '');
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  const current = activePatients.find((p) => p.id === patientId);
  const canManage = !!current && current.owner_id === viewerUserId;

  // Dashboard data loads after first mount — adopt the first active patient once.
  useEffect(() => {
    if (!activePatients.length) return;
    if (patientId && activePatients.some((p) => p.id === patientId)) return;
    setPatientId(activePatients[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePatients]);

  const loadAppointments = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const result = await authedRequest('appointments', { query: { patient_id: patientId } });
      setItems(result.appointments || []);
    } catch (e) {
      onNotice({ kind: 'error', text: e.message || 'โหลดนัดหมายไม่สำเร็จ' });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [authedRequest, patientId, onNotice]);

  useEffect(() => {
    setItems(null);
    loadAppointments();
  }, [loadAppointments]);

  async function setStatus(apt, status, noticeText) {
    setBusy(apt.id);
    try {
      await authedRequest('appointments', { method: 'PATCH', query: { id: apt.id }, body: { status } });
      onNotice({ kind: 'ok', text: noticeText });
      loadAppointments();
      onChanged?.();
    } catch (e) {
      onNotice({ kind: 'error', text: e.message || 'แก้ไขไม่สำเร็จ' });
    } finally {
      setBusy('');
    }
  }

  async function removeApt(apt) {
    setBusy(apt.id);
    try {
      await authedRequest('appointments', { method: 'DELETE', query: { id: apt.id } });
      onNotice({ kind: 'ok', text: 'ลบนัดหมายแล้ว' });
      loadAppointments();
      onChanged?.();
    } catch (e) {
      onNotice({ kind: 'error', text: e.message || 'ลบไม่สำเร็จ' });
    } finally {
      setBusy('');
    }
  }

  // ---- ฟอร์มเพิ่ม / แก้ไขนัดหมาย ---------------------------------------
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ title: '', place: '', detail: '', occurs_at: toInputValue() });
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditingId(null);
    setForm((f) => ({ ...f, occurs_at: toInputValue(), title: '', place: '', detail: '' }));
    setFormOpen(true);
  }
  function openEdit(apt) {
    setEditingId(apt.id);
    setForm({ title: apt.title, place: apt.place, detail: apt.detail || '', occurs_at: toInputValue(apt.occurs_at) });
    setFormOpen(true);
  }

  async function saveAppointment() {
    // datetime-local → ISO (พร้อม timezone เครื่องผู้กรอก)
    const payload = { ...form, occurs_at: new Date(form.occurs_at).toISOString() };
    setSaving(true);
    try {
      if (editingId) {
        await authedRequest('appointments', { method: 'PATCH', query: { id: editingId }, body: payload });
        onNotice({ kind: 'ok', text: 'แก้ไขนัดหมายแล้ว' });
      } else {
        await authedRequest('appointments', { method: 'POST', body: { patient_id: patientId, ...payload } });
        onNotice({ kind: 'ok', text: 'เพิ่มนัดหมายแล้ว — ระบบจะเตือนผู้ดูแลล่วงหน้า 1 วันและ 3 ชม. ก่อนเวลานัด' });
      }
      setFormOpen(false);
      loadAppointments();
      onChanged?.();
    } catch (e) {
      onNotice({ kind: 'error', text: e.message || 'บันทึกไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  }

  if (activePatients.length === 0) {
    return (
      <div className="app-fade mx-auto app-sheet max-w-[1100px] px-4 py-6 sm:px-7 lg:px-9 lg:py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">ตารางนัดหมาย</h1>
          <button onClick={onBack} className="refresh-control inline-flex w-fit items-center gap-2 px-4 py-2.5 text-sm font-semibold">
            <ChevronRight size={15} className="rotate-180" /> กลับไปแดชบอร์ด
          </button>
        </div>
        <div className="mt-6 rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
          <EmptyState icon={CalendarCheck} title="ยังไม่มีผู้ป่วยแบบถาวร" text="เพิ่มผู้ป่วยจากการ์ดผู้ป่วยบนแดชบอร์ดก่อน แล้วบันทึกนัดโรงพยาบาลที่นี่ได้" />
        </div>
      </div>
    );
  }

  const list = items || [];
  const scheduled = list.filter((a) => a.status === 'scheduled');
  const next = scheduled.filter((a) => new Date(a.occurs_at).getTime() > Date.now()).sort((a, b) => new Date(a.occurs_at) - new Date(b.occurs_at))[0] || null;
  const upcoming = scheduled.filter((a) => a.id !== next?.id && new Date(a.occurs_at).getTime() > Date.now()).sort((a, b) => new Date(a.occurs_at) - new Date(b.occurs_at));
  const past = list.filter((a) => a.status !== 'scheduled' || new Date(a.occurs_at).getTime() <= Date.now())
    .sort((a, b) => new Date(b.occurs_at) - new Date(a.occurs_at)).slice(0, 6);
  const bkkMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric' }).format(new Date());
  const monthCount = list.filter((a) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric' }).format(new Date(a.occurs_at)) === bkkMonth).length;

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-[#125e71] focus:outline-none';

  return (
    <div className="app-fade mx-auto app-sheet max-w-[1400px] px-4 py-6 sm:px-7 lg:px-9 lg:py-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">ตารางนัดหมาย</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            นัดโรงพยาบาลและคลินิกของผู้ป่วย — ระบบเตือนผู้ดูแลล่วงหน้า 1 วันและ 3 ชม. ก่อนเวลานัด พร้อมหมายเหตุก่อนไปแต่ละครั้ง
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={patientId || ''}
            onChange={(e) => setPatientId(e.target.value)}
            aria-label="เลือกผู้ป่วย"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700"
          >
            {activePatients.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
          <button onClick={openCreate} className="refresh-control inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold">
            <Plus size={15} /> เพิ่มนัดหมาย
          </button>
          <button onClick={loadAppointments} disabled={loading} className="refresh-control inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> รีเฟรช
          </button>
          <button onClick={onBack} className="refresh-control inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold">
            <ChevronRight size={15} className="rotate-180" /> กลับไปแดชบอร์ด
          </button>
        </div>
      </div>

      {formOpen && (
        <div className="mt-5 rounded-2xl border border-[#cfe0db] bg-gradient-to-br from-[#e3efec] to-white p-5">
          <h2 className="text-sm font-bold text-slate-900">{editingId ? 'แก้ไขนัดหมาย' : 'เพิ่มนัดหมายใหม่'}</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">หัวข้อนัด เช่น เยี่ยมแผนกอายุรกรรม</span>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} maxLength={160} placeholder="เยี่ยมแผนกอายุรกรรม" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">สถานพยาบาล</span>
              <input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} className={inputCls} maxLength={160} placeholder="โรงพยาบาลธานี" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">วันและเวลานัด</span>
              <input type="datetime-local" value={form.occurs_at} onChange={(e) => setForm({ ...form, occurs_at: e.target.value })} className={inputCls} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">หมายเหตุก่อนไป (ไม่บังคับ) เช่น ชั้น/ห้อง, งดน้ำและอาหาร</span>
              <input value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} className={inputCls} maxLength={400} placeholder="อาคารผู้ป่วยนอก ชั้น 3 · ห้อง OPD-4" />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button onClick={saveAppointment} disabled={saving || !form.title.trim() || !form.place.trim()} className="refresh-control inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
              <CheckCircle2 size={15} /> {saving ? 'กำลังบันทึก…' : 'บันทึกนัดหมาย'}
            </button>
            <button onClick={() => setFormOpen(false)} className="refresh-control inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold">ปิด</button>
          </div>
        </div>
      )}

      {/* นัดหมายถัดไป */}
      {next ? (
        <section className="app-fade-1 mt-5 relative overflow-hidden rounded-2xl border border-[#cfe0db] bg-gradient-to-br from-[#e3efec] to-[#f7faf8] p-6">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#125e71]/8" aria-hidden="true" />
          <div className="relative">
            <div className="text-xs font-bold tracking-wide text-[#125e71]">นัดหมายถัดไป{next.patient_name ? ` · ${next.patient_name}` : ''}</div>
            <h2 className="mt-1 text-xl font-bold text-slate-950">{next.place} — {next.title}</h2>
            <div className="mt-3 grid gap-2 text-sm text-slate-600">
              <div className="flex items-center gap-2"><CalendarCheck size={16} className="text-[#125e71]" /> {longDate(next.occurs_at)}</div>
              <div className="flex items-center gap-2"><Clock size={16} className="text-[#125e71]" /> เวลา {clockText(next.occurs_at)} น.</div>
              {next.detail && <div className="flex items-center gap-2"><MapPin size={16} className="text-[#125e71]" /> {next.detail}</div>}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-[#125e71] px-3 py-1 text-xs font-bold text-white">{daysAhead(next.occurs_at)}</span>
              <span className="flex items-center gap-1.5 text-xs text-slate-500"><BellRing size={14} /> ระบบเตือนผู้ดูแลอัตโนมัติ ล่วงหน้า 1 วัน และ 3 ชม. ก่อนเวลานัด</span>
            </div>
          </div>
        </section>
      ) : null}

      {/* ตัวเลขสถานะนัดหมาย */}
      <section className="app-fade-2 mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 panel-shadow">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400"><CalendarCheck size={14} /> มีนัดเดือนนี้</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{monthCount} ครั้ง</div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 panel-shadow">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400"><Clock size={14} /> กำลังจะถึง</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{scheduled.filter((a) => new Date(a.occurs_at).getTime() > Date.now()).length} ครั้ง</div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 panel-shadow">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400"><Ban size={14} /> เลื่อน / ยกเลิก</div>
          <div className="mt-2 text-2xl font-semibold text-amber-700">{list.filter((a) => a.status === 'canceled').length} ครั้ง</div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 panel-shadow">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400"><CheckCircle2 size={14} /> ทำสำเร็จ</div>
          <div className="mt-2 text-2xl font-semibold text-emerald-700">{list.filter((a) => a.status === 'done').length} ครั้ง</div>
        </div>
      </section>

      {/* นัดที่กำลังจะมาถึง */}
      <section className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
        <h2 className="flex items-center gap-2 font-bold text-slate-900"><ListTodo size={18} className="text-slate-500" /> นัดที่กำลังจะมาถึง</h2>
        {loading && !items ? (
          <div className="mt-6 py-6 text-center text-sm text-slate-400">กำลังโหลดข้อมูล…</div>
        ) : [next, ...upcoming].filter(Boolean).length === 0 ? (
          <div className="mt-4">
            <EmptyState icon={ListTodo} title="ยังไม่มีนัดหมายคิวถัดไป" text={canManage ? 'กด "เพิ่มนัดหมาย" เพื่อบันทึกนัดโรงพยาบาลครั้งถัดไป' : 'ผู้ดูแลหลักจะเป็นผู้เพิ่มนัดหมายให้ผู้ป่วยนี้'} />
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {[next, ...upcoming].filter(Boolean).map((apt) => (
              <div key={apt.id} className={`flex items-center gap-4 rounded-xl border p-3 ${apt.id === next?.id ? 'border-[#cfe0db] bg-gradient-to-r from-[#eef5f2] to-white' : 'border-slate-200/80'}`}>
                <div className="w-14 flex-none rounded-xl bg-[#e3efec] py-2 text-center">
                  <div className="text-lg font-bold leading-tight text-[#125e71]">{dayBadge(apt.occurs_at).day}</div>
                  <div className="text-[11px] text-slate-500">{dayBadge(apt.occurs_at).month}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{apt.place}</span>
                    <span className="text-sm text-slate-600">— {apt.title}</span>
                    <span className="rounded-full bg-[#125e71] px-2.5 py-0.5 text-[11px] font-bold text-white">{daysAhead(apt.occurs_at)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{longDate(apt.occurs_at)} {apt.detail ? `· ${apt.detail}` : ''}</div>
                </div>
                {canManage && (
                  <div className="flex flex-none items-center gap-1">
                    <button onClick={() => openEdit(apt)} disabled={busy === apt.id} title="แก้ไขนัดหมาย" className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"><Pencil size={15} /></button>
                    <button onClick={() => setStatus(apt, 'done', 'บันทึกว่าไปนัดเรียบร้อยแล้ว')} disabled={busy === apt.id} title="ทำเครื่องหมายว่าไปแล้ว" className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"><CheckCircle2 size={15} /></button>
                    <button onClick={() => setStatus(apt, 'canceled', 'ยกเลิกนัดหมายแล้ว')} disabled={busy === apt.id} title="เลื่อน / ยกเลิกนัด" className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-amber-700 hover:bg-amber-50 disabled:opacity-50"><Ban size={15} /></button>
                    <button onClick={() => removeApt(apt)} disabled={busy === apt.id} title="ลบนัดหมาย" className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={15} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* นัดที่ผ่านมา (7 วันล่าสุด) */}
      <section className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
        <h2 className="flex items-center gap-2 font-bold text-slate-900"><XCircle size={18} className="text-slate-500" /> นัดที่ผ่านมา</h2>
        {past.length === 0 ? (
          <div className="mt-4"><EmptyState icon={XCircle} title="ยังไม่มีประวัติการนัด" text='ประวัติจะแสดงเมื่อมีนัดเก่า ไม่ว่าจะสำเร็จหรือเลื่อนนัด' /></div>
        ) : (
          <div className="mt-4 space-y-2">
            {past.map((apt) => {
              const badge = STATUS_BADGE[apt.status] || STATUS_BADGE.done;
              return (
                <div key={apt.id} className="flex items-center gap-4 rounded-xl border border-slate-200/80 bg-slate-50/40 p-3">
                  <div className="w-14 flex-none rounded-xl bg-slate-100 py-2 text-center">
                    <div className="text-lg font-bold leading-tight text-slate-600">{dayBadge(apt.occurs_at).day}</div>
                    <div className="text-[11px] text-slate-500">{dayBadge(apt.occurs_at).month}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-700">{apt.place} — {apt.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{formatDate(apt.occurs_at)}{apt.status === 'canceled' && apt.detail ? ` · ${apt.detail}` : ''}</div>
                  </div>
                  <span className={`flex-none rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${badge.cls}`}>{badge.text}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
