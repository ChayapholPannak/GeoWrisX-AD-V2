import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2, ChevronRight, Clock, HeartPulse, Moon,
  Plus, RefreshCw, Trash2, XCircle,
} from 'lucide-react';
import { EmptyState, formatDate } from './App.jsx';

const ACTION_BADGE = {
  taken: { text: 'ทานแล้ว', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  missed: { text: 'ไม่ได้ทาน', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  unscheduled: { text: 'นอกเวลา', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
};
const QUALITY_TEXT = { good: 'หลับสบาย', fair: 'ปานกลาง', poor: 'หลับไม่ค่อยดี', unknown: 'ไม่ระบุ' };
const DAY_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

function hhmm(mins) {
  if (mins == null) return '—';
  return `${Math.floor(mins / 60)} ชม. ${mins % 60} นาที`;
}

function timeText(value) {
  if (!value) return '';
  return String(value).slice(0, 5);
}

/** บันทึกการดูแล — sleep / HR / medication. Data: GET /api/care-log + /api/med-schedules CRUD. */
export default function CareLogView({ patients, viewerUserId, authedRequest, onNotice, onBack }) {
  const activePatients = patients.filter((p) => !p.is_archived);
  const [patientId, setPatientId] = useState(activePatients[0]?.id || '');
  const [log, setLog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  const current = activePatients.find((p) => p.id === patientId);
  const canManage = !!current && current.owner_id === viewerUserId;

  // Dashboard data loads after first mount — adopt the first active patient
  // once (and re-adopt if the selected patient leaves the list).
  useEffect(() => {
    if (!activePatients.length) return;
    if (patientId && activePatients.some((p) => p.id === patientId)) return;
    setPatientId(activePatients[0].id);
  }, [patientId, activePatients]);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ label: '', time_of_day: '08:00', compart_no: 1, days: [0, 1, 2, 3, 4, 5, 6] });
  const [savingSch, setSavingSch] = useState(false);

  const loadLog = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const result = await authedRequest('care-log', { query: { patient_id: patientId } });
      setLog(result);
    } catch (e) {
      onNotice({ kind: 'error', text: e.message || 'โหลดบันทึกการดูแลไม่สำเร็จ' });
    } finally {
      setLoading(false);
    }
  }, [authedRequest, patientId, onNotice]);

  useEffect(() => {
    setLog(null);
    loadLog();
  }, [loadLog]);

  useEffect(() => {
    if (!patientId) return undefined;
    const timer = setInterval(() => { loadLog(); }, 60000);
    return () => clearInterval(timer);
  }, [loadLog, patientId]);

  async function createSchedule() {
    setSavingSch(true);
    try {
      await authedRequest('med-schedules', { method: 'POST', body: { patient_id: patientId, ...form } });
      setFormOpen(false);
      setForm({ label: '', time_of_day: '08:00', compart_no: 1, days: [0, 1, 2, 3, 4, 5, 6] });
      onNotice({ kind: 'ok', text: 'เพิ่มเวลายาแล้ว (ระบบจะแจ้งเตือนเมื่อผ่านเวลา 60 นาที และยังไม่ได้ทาน)' });
      loadLog();
    } catch (e) {
      onNotice({ kind: 'error', text: e.message || 'บันทึกเวลายาไม่สำเร็จ' });
    } finally {
      setSavingSch(false);
    }
  }

  async function patchSchedule(id, patch) {
    setBusy(id);
    try {
      await authedRequest('med-schedules', { method: 'PATCH', query: { id }, body: patch });
      loadLog();
    } catch (e) {
      onNotice({ kind: 'error', text: e.message || 'แก้ไขไม่สำเร็จ' });
    } finally {
      setBusy('');
    }
  }

  async function deleteSchedule(id) {
    setBusy(id);
    try {
      await authedRequest('med-schedules', { method: 'DELETE', query: { id } });
      onNotice({ kind: 'ok', text: 'ลบเวลายาแล้ว' });
      loadLog();
    } catch (e) {
      onNotice({ kind: 'error', text: e.message || 'ลบไม่สำเร็จ' });
    } finally {
      setBusy('');
    }
  }

  if (activePatients.length === 0) {
    return (
      <div className="app-fade mx-auto app-sheet max-w-[1100px] px-4 py-6 sm:px-7 lg:px-9 lg:py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">บันทึกการดูแล</h1>
          <button onClick={onBack} className="refresh-control inline-flex w-fit items-center gap-2 px-4 py-2.5 text-sm font-semibold">
            <ChevronRight size={15} className="rotate-180" /> กลับไปแดชบอร์ด
          </button>
        </div>
        <div className="mt-6 rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
          <EmptyState icon={Clock} title="ยังไม่มีผู้ป่วยแบบถาวร" text="เพิ่มผู้ป่วยจากการ์ดผู้ป่วยบนแดชบอร์ดก่อน แล้วหน้านี้จะพร้อมแสดงข้อมูลการดูแล" />
        </div>
      </div>
    );
  }

  const summary = log?.summary || {};
  const schedules = log?.schedules || [];
  const intakes = log?.intakes || [];

  return (
    <div className="app-fade mx-auto app-sheet max-w-[1400px] px-4 py-6 sm:px-7 lg:px-9 lg:py-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">บันทึกการดูแล</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            ข้อมูลจากสายรัดและกล่องยา (Sleep Summary · HR · การทานยา) ใน {log?.window_days || 7} วันล่าสุด — ทุกตัวเลขเกิดจากเหตุการณ์จริงของอุปกรณ์เท่านั้น
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
          <button onClick={loadLog} disabled={loading} className="refresh-control inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> รีเฟรช
          </button>
          <button onClick={onBack} className="refresh-control inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold">
            <ChevronRight size={15} className="rotate-180" /> กลับไปแดชบอร์ด
          </button>
        </div>
      </div>

      {/* summary strip — ตัวเลขเดียวต่อบัตร */}
      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 panel-shadow">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400"><Moon size={14} /> นอนเฉลี่ย ({summary.sleep_nights || 0} คืน)</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{hhmm(summary.sleep_avg_min)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 panel-shadow">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400"><HeartPulse size={14} /> อัตราการเต้นเฉลี่ย</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">
            {summary.hr_avg ? `${summary.hr_avg} bpm` : '—'}
            {summary.hr_min != null && <span className="ml-2 text-xs text-slate-400">{summary.hr_min}–{summary.hr_max}</span>}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 panel-shadow">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400"><CheckCircle2 size={14} /> ทานยาสำเร็จ</div>
          <div className="mt-2 text-2xl font-semibold text-emerald-700">{summary.pillbox_events || 0} ครั้ง</div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 panel-shadow">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400"><XCircle size={14} /> ไม่ได้ทาน / นอกเวลา</div>
          <div className="mt-2 text-2xl font-semibold text-rose-700">{summary.missed_events || 0} ครั้ง</div>
        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        {/* sleep */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
          <h2 className="flex items-center gap-2 font-bold text-slate-900"><Moon size={18} className="text-slate-500" /> การนอน</h2>
          {loading ? (
            <div className="mt-6 py-6 text-center text-sm text-slate-400">กำลังโหลดข้อมูล…</div>
          ) : !log || log.sleep.length === 0 ? (
            <div className="mt-4"><EmptyState icon={Moon} title="ยังไม่มีข้อมูลการนอน" text="ข้อมูลจะเกิดเมื่ออุปกรณ์ส่งเหตุการณ์ SLEEP_SUMMARY เข้าระบบ" /></div>
          ) : (
            <div className="mt-4 space-y-2">
              {log.sleep.slice(0, 7).map((n) => {
                const frac = Math.min(n.duration_min / 720, 1);
                return (
                  <div key={n.id} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs text-slate-400">{formatDate(n.night_date)}</span>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-[#0d9488]" style={{ width: `${Math.round(frac * 100)}%` }} />
                    </div>
                    <span className="w-28 shrink-0 text-right text-xs text-slate-500">{hhmm(n.duration_min)}</span>
                    <span className="w-24 shrink-0 text-right text-[11px] text-slate-400">{QUALITY_TEXT[n.quality] || n.quality}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* HR */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
          <h2 className="flex items-center gap-2 font-bold text-slate-900"><HeartPulse size={18} className="text-slate-500" /> อัตราการเต้นและชีพจร</h2>
          {loading ? (
            <div className="mt-6 py-6 text-center text-sm text-slate-400">กำลังโหลดข้อมูล…</div>
          ) : !log || log.hr.length === 0 ? (
            <div className="mt-4"><EmptyState icon={HeartPulse} title="ยังไม่มีข้อมูลชีพจร" text="ข้อมูลจะเกิดเมื่ออุปกรณ์ส่งเหตุการณ์ HR_BATCH เข้าระบบ" /></div>
          ) : (
            <>
              <div className="mt-4 flex items-end gap-3">
                <span className="text-3xl font-semibold text-slate-950">{log.hr[log.hr.length - 1].bpm}</span>
                <span className="pb-1 text-xs text-slate-400">bpm ล่าสุด · {formatDate(log.hr[log.hr.length - 1].recorded_at)}</span>
              </div>
              <div className="mt-3 flex h-16 items-end gap-[3px]">
                {log.hr.slice(-48).map((h, i) => (
                  <div
                    key={i}
                    title={`${h.bpm} bpm · ${formatDate(h.recorded_at)}`}
                    className="w-full min-w-[4px] rounded-t bg-[#14b8a6]/70"
                    style={{ height: `${Math.max(12, Math.min(100, ((h.bpm - 45) / 100) * 100))}%` }}
                  />
                ))}
              </div>
              {log.hr.some((h) => h.spo2) && (
                <p className="mt-2 text-[11px] text-slate-400">
                  SpO₂ ล่าสุด: {log.hr.filter((h) => h.spo2).slice(-1)[0].spo2}%
                </p>
              )}
            </>
          )}
        </section>

        {/* med schedules */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-bold text-slate-900"><Clock size={18} className="text-slate-500" /> เวลายา</h2>
            <span className="text-[11px] text-slate-400">{schedules.filter((s) => s.is_active).length} รายการ active</span>
          </div>

          {!canManage && (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              โหมด companion — ดูได้เท่านั้น เฉพาะเจ้าของหลักที่จัดการเวลายาได้
            </p>
          )}

          {canManage && !formOpen && (
            <button onClick={() => setFormOpen(true)} className="refresh-control mt-4 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold">
              <Plus size={15} /> เพิ่มเวลายา
            </button>
          )}

          {formOpen && (
            <div className="mt-4 space-y-2.5 rounded-xl border border-slate-200 p-3.5">
              <input aria-label="ชื่อยา" placeholder="ชื่อยา เช่น ยาความดัน" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input type="time" aria-label="เวลาใช้" value={form.time_of_day} onChange={(e) => setForm({ ...form, time_of_day: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">ช่องกล่องยา</span>
                {[1, 2, 3].map((n) => (
                  <button key={n} onClick={() => setForm({ ...form, compart_no: n })} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${form.compart_no === n ? 'bg-emerald-600 text-white' : 'bg-slate-50 text-slate-600'} `}>ช่อง {n}</button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-slate-500">วัน (0 = อา.)</span>
                {DAY_LABELS.map((d, i) => (
                  <button key={i} onClick={() => setForm({
                    ...form,
                    days: form.days.includes(i) ? form.days.filter((x) => x !== i) : [...form.days, i],
                  })} className={`h-7 w-8 rounded-lg text-[11px] font-semibold ${form.days.includes(i) ? 'bg-emerald-600 text-white' : 'bg-slate-50 text-slate-600'}`}>{d}</button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={createSchedule} disabled={savingSch || !form.label || !form.time_of_day} className="refresh-control inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-50">
                  {savingSch ? <RefreshCw size={14} className="animate-spin" /> : null} บันทึก
                </button>
                <button onClick={() => setFormOpen(false)} className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-500">ยกเลิก</button>
              </div>
            </div>
          )}

          <div className="mt-4 space-y-2">
            {schedules.length === 0 && !formOpen ? (
              <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">ยังไม่มีเวลายาที่บันทึก</p>
            ) : (
              schedules.map((s) => (
                <div key={s.id} className={`rounded-xl border px-3.5 py-3 ${s.is_active ? 'border-slate-200' : 'border-dashed border-slate-200 opacity-60'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800">{timeText(s.time_of_day)} · {s.label}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">ช่อง {s.compart_no} · {s.days.length === 7 ? 'ทุกวัน' : s.days.map((d) => DAY_LABELS[d]).join(' ')}</div>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 items-center gap-2">
                        <label className="flex items-center gap-1 text-[11px] text-slate-400">
                          <input type="checkbox" checked={s.is_active} disabled={busy === s.id} onChange={(e) => patchSchedule(s.id, { is_active: e.target.checked })} className="h-4 w-4 accent-[#1e3764]" />
                          เปิด
                        </label>
                        <button aria-label="ลบเวลายา" onClick={() => deleteSchedule(s.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* recent intakes */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
          <h2 className="flex items-center gap-2 font-bold text-slate-900"><CheckCircle2 size={18} className="text-slate-500" /> เหตุการณ์ยาล่าสุด</h2>
          {loading ? (
            <div className="mt-6 py-6 text-center text-sm text-slate-400">กำลังโหลดข้อมูล…</div>
          ) : intakes.length === 0 ? (
            <div className="mt-4"><EmptyState icon={Clock} title="ยังไม่มีเหตุการณ์การทานยา" text="กล่องยาจะบันทึกเมื่อถอดทานหรือรายงานพลาดผ่าน MED_EVENT" /></div>
          ) : (
            <div className="mt-4 space-y-1.5">
              {intakes.slice(0, 12).map((i) => {
                const badge = ACTION_BADGE[i.action] || ACTION_BADGE.unscheduled;
                return (
                  <div key={i.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.text}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                      {i.schedule_label || `ช่องที่ ${i.compart_no}`}
                      {i.weight_g ? ` · ${Number(i.weight_g)} g` : ''}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-400">{formatDate(i.taken_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-4 rounded-xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-500">
            Cron ตรวจทุก 15 นาที: เวลายาผ่านไป 60 นาที (ไม่เกิน 12 ชม.) และไม่มีบันทึกการทาน → แจ้งเตือน "ไม่ได้ทานยา" พร้อมอีเมลให้วงผู้ดูแล
          </p>
        </section>
      </div>
    </div>
  );
}
