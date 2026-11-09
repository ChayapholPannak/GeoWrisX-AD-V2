import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SignIn, useAuth, useClerk, useUser } from '@clerk/react';
import {
  Activity, AlertTriangle, Archive, Battery, BellRing, CheckCircle2, ChevronRight,
  Clock3, ClipboardList, Copy, Download, FileText, HeartPulse, LockKeyhole, LogOut, MapPinned, Menu, Paperclip,
  Pencil, Plus, RefreshCw, RotateCcw, Save, Settings, ShieldCheck, Trash2, UserRound, Users, Watch,
  X, XCircle,
} from 'lucide-react';
import { apiDownload, apiRequest, apiUpload } from './lib/api.js';
import TrackView from './TrackView.jsx';
import CareLogView from './CareLogView.jsx';

const emptyData = {
  patients: [],
  devices: [],
  alerts: [],
  approvals: [],
  commands: [],
  files: [],
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function AuthScreen() {
  return (
    <main className="auth-shell min-h-screen grid lg:grid-cols-[1.05fr_.95fr]">
      <section className="auth-intro relative hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="relative flex items-center gap-3">
          <div className="brand-mark grid h-11 w-11 place-items-center"><HeartPulse size={23} /></div>
          <div>
            <div className="text-lg font-semibold">GeoWrisX <span>AD</span></div>
            <div className="text-xs">Caregiver Safety Console</div>
          </div>
        </div>
        <div className="relative max-w-xl py-10">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight xl:text-[32px]">
            มองเห็นสัญญาณสำคัญ<br /><span>ก่อนต้องตัดสินใจ</span>
          </h2>
          <p className="mt-5 max-w-md text-sm leading-7">
            พื้นที่ทำงานเดียวสำหรับตรวจสอบเหตุการณ์จากสายรัดข้อมือ และทบทวนคำขอเปิดกล่องยาที่มีหลักฐาน BLE แล้ว
          </p>
          <div className="mt-10 grid max-w-md grid-cols-2 gap-3">
            <FeatureMini icon={<MapPinned size={17} />} title="Geofencing" text="ตรวจเหตุการณ์ออกนอกพื้นที่" />
            <FeatureMini icon={<LockKeyhole size={17} />} title="Pillbox review" text="ยืนยัน BLE ก่อนอนุมัติ" />
          </div>
        </div>
        <div className="relative text-xs">ต้นแบบเพื่อการศึกษา · ไม่ใช่อุปกรณ์การแพทย์ที่ผ่านการรับรอง</div>
      </section>

      <section className="grid place-items-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-50 text-blue-800"><HeartPulse /></div>
            <div>
              <div className="text-lg font-bold">GeoWrisX AD</div>
              <div className="text-xs text-slate-500">Caregiver Safety Console</div>
            </div>
          </div>
          <p className="text-sm font-semibold text-blue-700">ยินดีต้อนรับ</p>
          <h1 className="auth-mobile-title mt-2 text-3xl font-bold tracking-tight text-slate-900">เข้าสู่ระบบผู้ดูแล</h1>
          <p className="mt-2 text-sm text-slate-500">
            ใช้บัญชีที่ลงทะเบียนไว้กับ Clerk เพื่อดูสถานะและการแจ้งเตือนของคุณ
          </p>
          <div className="mt-8 flex justify-center">
            <SignIn
              routing="hash"
              appearance={{
                variables: {
                  colorPrimary: '#125e71',
                  borderRadius: '8px',
                  fontFamily: "'Anuphan', ui-sans-serif, system-ui, sans-serif",
                },
              }}
            />
          </div>
          <p className="mt-8 border-t border-slate-100 pt-5 text-center text-xs leading-5 text-slate-400">
            ข้อมูลผู้ป่วยและข้อมูลตำแหน่งเป็นข้อมูลอ่อนไหว ควรใช้เฉพาะข้อมูลทดสอบจนกว่าจะตรวจสอบความปลอดภัยและได้รับความยินยอมครบถ้วน
          </p>
        </div>
      </section>
    </main>
  );
}

function FeatureMini({ icon, title, text }) {
  return (
    <div className="auth-feature p-3.5">
      <div className="mb-2">{icon}</div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-xs leading-5">{text}</div>
    </div>
  );
}

function StatCard({ label, value, note, tone = 'blue' }) {
  return (
    <div className={`metric-cell metric-${tone}`}>
      <p>{label}</p>
      <div className="metric-value">{value}</div>
      <p>{note}</p>
    </div>
  );
}

export function formatDate(value) {
  if (!value) return 'ยังไม่มีข้อมูล';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'ยังไม่มีข้อมูล';
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status) {
  if (status === 'online') return 'ออนไลน์';
  if (status === 'offline') return 'ออฟไลน์';
  return 'ยังไม่ทราบสถานะ';
}

/** Copy-link invite URL: the token rides in the ?invite= query parameter. */
function inviteLink(token) {
  return `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(token)}`;
}

function PatientFiles({ files, canManage = false, uploading, downloadingId, deletingId, onUpload, onDownload, onDelete }) {
  return (
    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <Paperclip size={13} /> ไฟล์แนบผู้ป่วย
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">{files.length}</span>
        </div>
        {canManage ? (
          <label className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 ${uploading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
            {uploading ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
            {uploading ? 'กำลังอัปโหลด…' : 'อัปโหลดไฟล์'}
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) onUpload(file);
              }}
            />
          </label>
        ) : (
          <span className="text-[10px] leading-4 text-slate-400">อัปโหลด/ลบได้เฉพาะเจ้าของหลัก</span>
        )}
      </div>

      {files.length === 0 ? (
        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          แนบผลตรวจ เลขที่ใบสั่งยา หรือเอกสารยินยอมได้ (สูงสุด 25 MB ต่อไฟล์)
        </p>
      ) : (
        <ul className="mt-2 max-h-44 space-y-1.5 overflow-y-auto pr-1">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2">
              <FileText size={14} className="shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-slate-700">{file.file_name}</div>
                <div className="text-[10px] text-slate-400">
                  {formatBytes(file.size_bytes)} · {formatDate(file.created_at)}
                </div>
              </div>
              <button
                type="button"
                aria-label={`ดาวน์โหลด ${file.file_name}`}
                onClick={() => onDownload(file)}
                disabled={downloadingId === file.id}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                {downloadingId === file.id ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
              </button>
              {canManage && (
                <button
                  type="button"
                  aria-label={`ลบ ${file.file_name}`}
                  onClick={() => onDelete(file)}
                  disabled={deletingId === file.id}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50"
                >
                  {deletingId === file.id ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ต้อนรับผู้ใช้ครั้งแรกเท่านั้น (เก็บ flag ที่ localStorage) — 3 บีต:
// ภาพรวมสถิติ → อนุมัติกล่องยา BLE → ทีมผู้ดูแลหลายคน
const WELCOME_KEY = 'gwx-welcome-v1';

function WelcomeFlow({ onDone }) {
  const beats = [
    {
      icon: Activity,
      title: 'ภาพรวมความปลอดภัย มองเห็นในหน้าเดียว',
      text: 'แถวตัวเลขด้านบนสรุปสิ่งที่ต้องตัดสินใจวันนี้: ผู้ป่วยที่ลงทะเบียน อุปกรณ์ออนไลน์ การแจ้งเตือนที่ยังไม่รับทราบ และคำขอเปิดกล่องยา',
    },
    {
      icon: LockKeyhole,
      title: 'คำขอกล่องยา ต้องยืนยัน BLE ก่อน',
      text: 'ทุกคำขอเปิดกล่องยาต้องมีหลักฐาน Bluetooth ว่ากล่องอยู่ใกล้ตัวจริง และหมดอายุเองภายในหนึ่งชั่วโมง — อนุมัติเมื่อมั่นใจเท่านั้น',
    },
    {
      icon: Users,
      title: 'ดูแลพร้อมกันได้หลายคน',
      text: 'เชิญคนในครอบครัวเข้ามาเป็น "ผู้ดูแลร่วม" เพื่อรับแจ้งเตือนและช่วยอนุมัติกล่องยา ส่วนการแก้ไขข้อมูลสงวนไว้ให้เจ้าของหลัก',
    },
  ];
  const [step, setStep] = useState(0);
  const primaryRef = useRef(null);
  const last = step === beats.length - 1;

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onDone();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  useEffect(() => {
    primaryRef.current?.focus();
  }, [step]);

  const beat = beats[step];
  const Icon = beat.icon;

  return (
    <div className="welcome-overlay">
      <div role="dialog" aria-modal="true" aria-label="แนะนำการใช้งานครั้งแรก" className="welcome-card">
        <div key={step} className="welcome-beat-icon mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blue-50" aria-hidden="true">
          <Icon size={26} />
        </div>
        <h2 className="mt-4 text-lg font-bold text-slate-900">{beat.title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{beat.text}</p>
        <div className="mt-5 flex items-center justify-center gap-1.5" aria-hidden="true">
          {beats.map((item, i) => (
            <span key={i} className={`welcome-dot${i === step ? ' is-now' : ''}`} />
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
          <button type="button" onClick={onDone} className="px-2 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600">
            ข้ามคำแนะนำ
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={() => (last ? onDone() : setStep(step + 1))}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1e3764] px-4 py-2 text-sm font-semibold text-white hover:bg-[#28477e]"
          >
            {last ? 'เริ่มใช้งาน' : 'ถัดไป'}<ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();

  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [showWelcome, setShowWelcome] = useState(() => {
    try {
      return !window.localStorage.getItem(WELCOME_KEY);
    } catch {
      return false;
    }
  });

  const closeWelcome = useCallback(() => {
    try {
      window.localStorage.setItem(WELCOME_KEY, '1');
    } catch { /* ignore */ }
    setShowWelcome(false);
  }, []);

  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientRelationship, setNewPatientRelationship] = useState('');
  const [newPatientDob, setNewPatientDob] = useState('');
  const [addingPatient, setAddingPatient] = useState(false);
  const [approvingId, setApprovingId] = useState('');

  const [showArchivedPatients, setShowArchivedPatients] = useState(false);
  const [editingPatientId, setEditingPatientId] = useState('');
  const [patientDraft, setPatientDraft] = useState({ display_name: '', relationship: '', date_of_birth: '' });
  const [savingPatient, setSavingPatient] = useState(false);

  const [caregiverProfile, setCaregiverProfile] = useState({
    full_name: user?.fullName || '',
    phone: '',
    relationship_to_patient: '',
  });
  const [profileEmail, setProfileEmail] = useState(user?.primaryEmailAddress?.emailAddress || '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [uploadingPatientId, setUploadingPatientId] = useState('');
  const [downloadingFileId, setDownloadingFileId] = useState('');
  const [deletingFileId, setDeletingFileId] = useState('');

  // Multi-caregiver sharing
  const [pendingInvites, setPendingInvites] = useState([]);
  const [acceptingInviteId, setAcceptingInviteId] = useState('');
  const [dismissedInvites, setDismissedInvites] = useState([]);
  const [circleOpenId, setCircleOpenId] = useState('');
  const [circleData, setCircleData] = useState(null);
  const [circleLoading, setCircleLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [busyCircleAction, setBusyCircleAction] = useState('');
  const [freshInvite, setFreshInvite] = useState(null);
  const [urlInviteToken, setUrlInviteToken] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('invite') || '';
    } catch {
      return '';
    }
  });

  const requireToken = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    return token;
  }, [getToken]);

  const authedRequest = useCallback(async (functionName, options = {}) => {
    const token = await requireToken();
    return apiRequest(functionName, { ...options, token });
  }, [requireToken]);

  // File downloads (CSV reports) — same auth flow, keeps the server-provided filename.
  const authedDownload = useCallback(async (functionName, options = {}) => {
    const token = await requireToken();
    return apiDownload(functionName, { ...options, token });
  }, [requireToken]);

  // View switching (dashboard / settings) — lightweight, no router.
  const [view, setView] = useState('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef(null);
  const menuButtonRef = useRef(null);

  // ปิดเมนู drop-down: คลิกนอกแผง หรือกด Esc (โฟกัสกลับที่ปุ่ม)
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e) {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target)) setMenuOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  function gotoView(next) {
    setView(next);
    setMenuOpen(false);
  }

  // User preferences (Settings menu) persisted via /api/prefs.
  const [prefs, setPrefs] = useState({
    notify_email: true,
    notify_channels: { sos: true, geofence: true, tamper: true, battery: true, meds: true, daily_summary: false },
    ui: { show_hr: true, show_sleep: true, show_files: true },
  });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const loadPrefs = useCallback(async () => {
    try {
      const result = await authedRequest('prefs');
      if (result && result.prefs && typeof result.prefs === 'object') {
        setPrefs((current) => ({ ...current, ...result.prefs }));
      }
      setPrefsLoaded(true);
    } catch {
      setPrefsLoaded(true); // ล้มเหลวเงียบ ๆ — ใช้ค่า default, toggle บันทึกครั้งถัดไปจะรู้เอง
    }
  }, [authedRequest]);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  const savePrefs = useCallback(async (next) => {
    setSavingPrefs(true);
    const previous = prefs;
    setPrefs(next); // optimistic update
    try {
      const result = await authedRequest('prefs', { method: 'PUT', body: { prefs: next } });
      if (result?.prefs) setPrefs((current) => ({ ...current, ...result.prefs }));
      return null;
    } catch (e) {
      setPrefs(previous); // กลับค่าเมื่อบันทึกไม่สำเร็จ
      return e.message || 'บันทึกการตั้งค่าไม่สำเร็จ';
    } finally {
      setSavingPrefs(false);
    }
  }, [authedRequest, prefs]);

  const loadDashboard = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const result = await authedRequest('dashboard');
      setData({ ...emptyData, ...result });
    } catch (e) {
      setError(e.message || 'โหลดข้อมูลไม่ได้');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authedRequest]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const ackAlert = useCallback(async (alertId) => {
    try {
      await authedRequest('alerts', { method: 'PATCH', query: { id: alertId }, body: { acknowledged: true } });
      await loadDashboard(true);
    } catch (e) {
      setNotice({ kind: 'error', text: e.message || 'รับทราบการแจ้งเตือนไม่สำเร็จ' });
    }
  }, [authedRequest, loadDashboard]);

  const loadInvites = useCallback(async () => {
    // Optional feature: a failed invite lookup must not break the dashboard.
    try {
      const result = await authedRequest('invites');
      setPendingInvites(result.invites || []);
    } catch {
      setPendingInvites([]);
    }
  }, [authedRequest]);

  useEffect(() => { loadInvites(); }, [loadInvites]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await authedRequest('caregiver-profile');
        if (!active) return;
        setCaregiverProfile({
          full_name: result.profile?.full_name || user?.fullName || '',
          phone: result.profile?.phone || '',
          relationship_to_patient: result.profile?.relationship_to_patient || '',
        });
        setProfileEmail(result.email || user?.primaryEmailAddress?.emailAddress || '');
      } catch (e) {
        if (active) setNotice({ kind: 'error', text: e.message || 'โหลดโปรไฟล์ผู้ดูแลไม่สำเร็จ' });
      }
    })();
    return () => { active = false; };
  }, [authedRequest, user?.fullName, user?.primaryEmailAddress?.emailAddress]);

  const activePatients = useMemo(() => data.patients.filter((patient) => !patient.is_archived), [data.patients]);
  const archivedPatients = useMemo(() => data.patients.filter((patient) => Boolean(patient.is_archived)), [data.patients]);
  const visiblePatients = showArchivedPatients ? archivedPatients : activePatients;
  const patientNames = useMemo(() => new Map(data.patients.map((p) => [p.id, p.display_name])), [data.patients]);
  const filesByPatient = useMemo(() => {
    const grouped = new Map();
    for (const file of data.files || []) {
      if (!grouped.has(file.patient_id)) grouped.set(file.patient_id, []);
      grouped.get(file.patient_id).push(file);
    }
    return grouped;
  }, [data.files]);

  const onlineDevices = data.devices.filter((device) => device.status === 'online').length;
  const unacknowledgedAlerts = data.alerts.filter((alert) => !alert.acknowledged_at).length;
  const pendingApprovals = data.approvals.filter((item) => item.status === 'pending').length;
  const displayName = caregiverProfile.full_name || user?.fullName || profileEmail || 'บัญชีผู้ดูแล';
  const viewerId = data.viewer_user_id || user?.id || '';
  const isOwnerOf = (patient) => Boolean(viewerId) && patient.owner_id === viewerId;

  async function addPatient(event) {
    event.preventDefault();
    setAddingPatient(true); setNotice(null);
    try {
      await authedRequest('create-patient', {
        method: 'POST',
        body: {
          display_name: newPatientName,
          relationship: newPatientRelationship,
          date_of_birth: newPatientDob,
        },
      });
      setNewPatientName('');
      setNewPatientRelationship('');
      setNewPatientDob('');
      setNotice({ kind: 'success', text: 'เพิ่มโปรไฟล์ผู้ป่วยแล้ว' });
      await loadDashboard(true);
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
    } finally {
      setAddingPatient(false);
    }
  }

  async function saveCaregiverProfile(event) {
    event.preventDefault();
    setSavingProfile(true); setNotice(null);
    try {
      const result = await authedRequest('caregiver-profile', { method: 'PUT', body: caregiverProfile });
      setCaregiverProfile({
        full_name: result.profile?.full_name || '',
        phone: result.profile?.phone || '',
        relationship_to_patient: result.profile?.relationship_to_patient || '',
      });
      setProfileEmail(result.email || profileEmail);
      setNotice({ kind: 'success', text: 'บันทึกโปรไฟล์ผู้ดูแลแล้ว' });
    } catch (e) {
      setNotice({ kind: 'error', text: e.message || 'บันทึกโปรไฟล์ผู้ดูแลไม่สำเร็จ' });
    } finally {
      setSavingProfile(false);
    }
  }

  function startEditingPatient(patient) {
    setEditingPatientId(patient.id);
    setPatientDraft({
      display_name: patient.display_name || '',
      relationship: patient.relationship || '',
      date_of_birth: patient.date_of_birth || '',
    });
  }

  async function savePatient(event) {
    event.preventDefault();
    setSavingPatient(true); setNotice(null);
    try {
      await authedRequest('update-patient', {
        method: 'PATCH',
        body: { patient_id: editingPatientId, ...patientDraft },
      });
      setEditingPatientId('');
      setNotice({ kind: 'success', text: 'บันทึกข้อมูลผู้ป่วยแล้ว' });
      await loadDashboard(true);
    } catch (e) {
      setNotice({ kind: 'error', text: e.message || 'แก้ไขข้อมูลผู้ป่วยไม่สำเร็จ' });
    } finally {
      setSavingPatient(false);
    }
  }

  async function toggleArchivePatient(patient) {
    const archive = !patient.is_archived;
    const message = archive
      ? `เก็บโปรไฟล์ "${patient.display_name}" เข้าคลังหรือไม่? ประวัติจะยังถูกเก็บไว้`
      : `กู้คืนโปรไฟล์ "${patient.display_name}" หรือไม่?`;
    if (!window.confirm(message)) return;
    setNotice(null);
    try {
      const result = await authedRequest('archive-patient', {
        method: 'POST',
        body: { patient_id: patient.id, is_archived: archive },
      });
      setNotice({ kind: 'success', text: result.message });
      if (editingPatientId === patient.id) setEditingPatientId('');
      await loadDashboard(true);
    } catch (e) {
      setNotice({ kind: 'error', text: e.message || 'เปลี่ยนสถานะโปรไฟล์ไม่สำเร็จ' });
    }
  }

  async function approve(requestId) {
    setApprovingId(requestId); setNotice(null);
    try {
      const result = await authedRequest('approve-pillbox', { method: 'POST', body: { request_id: requestId } });
      setNotice({
        kind: 'success',
        text: `${result.message} คำสั่งมีอายุสั้นและจะยังไม่เปิดกลอนจริงจนกว่าจะเชื่อม Device Gateway/MQTT กับเฟิร์มแวร์`,
      });
      await loadDashboard(true);
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
    } finally {
      setApprovingId('');
    }
  }

  async function uploadFile(patientId, file) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setNotice({ kind: 'error', text: 'ไฟล์มีขนาดใหญ่เกิน 25 MB' });
      return;
    }
    setUploadingPatientId(patientId); setNotice(null);
    try {
      const token = await requireToken();
      const formData = new FormData();
      formData.append('patient_id', patientId);
      formData.append('file', file);
      await apiUpload('files', { token, formData });
      setNotice({ kind: 'success', text: `อัปโหลด "${file.name}" แล้ว` });
      await loadDashboard(true);
    } catch (e) {
      setNotice({ kind: 'error', text: e.message || 'อัปโหลดไฟล์ไม่สำเร็จ' });
    } finally {
      setUploadingPatientId('');
    }
  }

  async function downloadFile(file) {
    setDownloadingFileId(file.id); setNotice(null);
    try {
      const token = await requireToken();
      const { blob, filename } = await apiDownload('file-download', { token, query: { file_id: file.id } });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || file.file_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setNotice({ kind: 'error', text: e.message || 'ดาวน์โหลดไฟล์ไม่สำเร็จ' });
    } finally {
      setDownloadingFileId('');
    }
  }

  async function deleteFile(file) {
    if (!window.confirm(`ลบไฟล์ "${file.file_name}" ออกจากระบบหรือไม่?`)) return;
    setDeletingFileId(file.id); setNotice(null);
    try {
      await authedRequest('files', { method: 'DELETE', query: { file_id: file.id } });
      setNotice({ kind: 'success', text: 'ลบไฟล์แล้ว' });
      await loadDashboard(true);
    } catch (e) {
      setNotice({ kind: 'error', text: e.message || 'ลบไฟล์ไม่สำเร็จ' });
    } finally {
      setDeletingFileId('');
    }
  }

  // ---- Multi-caregiver sharing -----------------------------------------

  async function loadCircle(patientId) {
    setCircleLoading(true);
    try {
      const result = await authedRequest('caregivers', { query: { patient_id: patientId } });
      setCircleData({ members: result.members || [], invites: result.invites || [] });
    } catch (e) {
      setCircleData({ error: e.message || 'โหลดทีมผู้ดูแลไม่สำเร็จ' });
    } finally {
      setCircleLoading(false);
    }
  }

  function toggleCircle(patient) {
    if (circleOpenId === patient.id) {
      setCircleOpenId('');
      setCircleData(null);
      setFreshInvite(null);
      return;
    }
    setCircleOpenId(patient.id);
    setCircleData(null);
    setFreshInvite(null);
    setInviteEmail('');
    loadCircle(patient.id);
  }

  async function createInvite(patientId) {
    setInviting(true); setNotice(null);
    try {
      const result = await authedRequest('caregivers', {
        method: 'POST',
        body: { action: 'invite', patient_id: patientId, email: inviteEmail },
      });
      setFreshInvite({
        patient_id: patientId,
        token: result.invite.token,
        email: result.invite.email,
      });
      setInviteEmail('');
      setNotice({ kind: 'success', text: 'สร้างลิงก์เชิญแล้ว — กดคัดลอกแล้วส่งให้ผู้รับผ่านข้อความ' });
      await loadCircle(patientId);
    } catch (e) {
      setNotice({ kind: 'error', text: e.message || 'สร้างคำเชิญไม่สำเร็จ' });
    } finally {
      setInviting(false);
    }
  }

  async function revokeCaregiverInvite(patientId, inviteId) {
    setBusyCircleAction(inviteId); setNotice(null);
    try {
      await authedRequest('caregivers', { method: 'POST', body: { action: 'revoke', invite_id: inviteId } });
      setNotice({ kind: 'success', text: 'ยกเลิกคำเชิญแล้ว' });
      setFreshInvite(null); // the copied link just died; remove its green box
      await loadCircle(patientId);
    } catch (e) {
      setNotice({ kind: 'error', text: e.message || 'ยกเลิกคำเชิญไม่สำเร็จ' });
    } finally {
      setBusyCircleAction('');
    }
  }

  async function removeCaregiver(patientId, memberId, memberName) {
    if (!window.confirm(`ลบ ${memberName || 'ผู้ดูแลร่วม'} ออกจากทีมผู้ดูแลหรือไม่?`)) return;
    setBusyCircleAction(memberId); setNotice(null);
    try {
      await authedRequest('caregivers', {
        method: 'POST',
        body: { action: 'remove', patient_id: patientId, user_id: memberId },
      });
      setNotice({ kind: 'success', text: 'ลบผู้ดูแลร่วมออกจากทีมแล้ว' });
      await loadCircle(patientId);
    } catch (e) {
      setNotice({ kind: 'error', text: e.message || 'ลบผู้ดูแลร่วมไม่สำเร็จ' });
    } finally {
      setBusyCircleAction('');
    }
  }

  async function acceptInvite(token) {
    setAcceptingInviteId(token); setNotice(null);
    try {
      const result = await authedRequest('invites', { method: 'POST', body: { token } });
      setUrlInviteToken('');
      window.history.replaceState(null, '', window.location.pathname);
      await Promise.all([loadDashboard(true), loadInvites()]);
      setNotice({
        kind: 'success',
        text: result.patient?.display_name ? `เข้าร่วมดูแล "${result.patient.display_name}" เป็นผู้ดูแลร่วมแล้ว` : 'ยอมรับคำเชิญเรียบร้อยแล้ว',
      });
    } catch (e) {
      setNotice({ kind: 'error', text: e.message || 'ยอมรับคำเชิญไม่สำเร็จ' });
    } finally {
      setAcceptingInviteId('');
    }
  }

  async function copyInviteLink(token) {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      setNotice({ kind: 'success', text: 'คัดลอกลิงก์เชิญแล้ว ส่งให้ผู้รับได้เลย' });
    } catch {
      window.prompt('คัดลอกลิงก์นี้:', inviteLink(token));
    }
  }

  function dismissIncomingInvite() {
    setUrlInviteToken('');
    window.history.replaceState(null, '', window.location.pathname);
  }

  function dismissPendingInvite(inviteId) {
    setDismissedInvites((list) => [...list, inviteId]);
  }

  async function logout() {
    await signOut();
  }

  return (
    <div className="app-shell min-h-screen text-slate-800">
      <main className="app-main min-w-0" id="main">
        <a href="#main" className="skip-link">ข้ามไปยังเนื้อหาหลัก</a>
        <header className="app-topbar sticky top-0 z-10 flex items-center justify-between px-4 py-3 sm:px-7 lg:px-9">
          <div className="flex items-center gap-3" ref={menuWrapRef}>
            <div className="button-panel-top">
              <button
                type="button"
                ref={menuButtonRef}
                className="hamburger"
                aria-expanded={menuOpen}
                aria-controls="app-menu-panel"
                aria-label="เปิดเมนูหลักของคอนโซล"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <Menu size={20} />
              </button>

              <nav className="menu-panel" id="app-menu-panel" hidden={!menuOpen} aria-label="เมนูหลักของคอนโซล">
                <div className="flex items-center gap-3 px-2">
                  <div className="brand-mark grid h-10 w-10 place-items-center"><HeartPulse size={21} /></div>
                  <div className="font-semibold">
                    GeoWrisX <span>AD</span>
                    <small className="block text-[11px]">Caregiver Console</small>
                  </div>
                </div>
                <div className="mt-8 px-3 text-[11px] font-medium text-[#8fb0b4]">เมนูหลัก</div>
                <nav className="mt-3 space-y-1">
                  <NavItem icon={Activity} label="ภาพรวมระบบ" active={view === 'dashboard'} onClick={() => gotoView('dashboard')} />
                  <NavItem icon={Watch} label="สายรัดและอุปกรณ์" onClick={() => gotoView('dashboard')} />
                  <NavItem icon={MapPinned} label="ตำแหน่งและพื้นที่ปลอดภัย" active={view === 'track'} onClick={() => gotoView('track')} />
                  <NavItem icon={ClipboardList} label="บันทึกการดูแล" active={view === 'carelog'} onClick={() => gotoView('carelog')} />
                  <NavItem icon={BellRing} label="การแจ้งเตือน" count={unacknowledgedAlerts} onClick={() => gotoView('dashboard')} />
                  <NavItem icon={LockKeyhole} label="อนุมัติกล่องยา" count={pendingApprovals} onClick={() => gotoView('dashboard')} />
                </nav>
                <div className="mt-6 px-3 text-[11px] font-medium text-[#8fb0b4]">บัญชีและการตั้งค่า</div>
                <nav className="mt-3 space-y-1">
                  <NavItem icon={Settings} label="ตั้งค่า" active={view === 'settings'} onClick={() => gotoView('settings')} />
                </nav>
                <div className="sidebar-note mt-5 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={17} /> Dual-Safety Matrix</div>
                  <p className="mt-2 text-xs leading-5">Geofencing · Anti-removal · Caregiver approval</p>
                  <div className="mt-3 px-2.5 py-2 text-[11px]">Research prototype</div>
                </div>
              </nav>
            </div>
            <div>
              <div className="text-xs text-slate-400">พื้นที่ผู้ดูแล / <span className="text-slate-600">{view === 'settings' ? 'ตั้งค่า' : view === 'track' ? 'แผนที่ตำแหน่ง' : view === 'carelog' ? 'บันทึกการดูแล' : 'ภาพรวม'}</span></div>
              <div className="text-sm font-semibold text-slate-900">{view === 'settings' ? 'การตั้งค่าและจัดการบัญชี' : view === 'track' ? 'ตำแหน่งและพื้นที่ปลอดภัย' : view === 'carelog' ? 'บันทึกการดูแล' : 'Caregiver Dashboard'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden text-right sm:block">
              <div className="max-w-48 truncate text-xs font-semibold text-slate-700">{displayName}</div>
              <div className="text-[11px] text-slate-400">บัญชีผู้ดูแล · Clerk</div>
            </div>
            <button onClick={logout} aria-label="ออกจากระบบ" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              <LogOut size={15} /><span className="hidden sm:inline">ออกจากระบบ</span>
            </button>
          </div>
        </header>

        {notice && (
          <div role="status" className={`mx-4 mt-5 flex items-start gap-2 rounded-xl border p-3.5 text-sm leading-6 sm:mx-7 lg:mx-9 xl:mx-auto xl:max-w-[1500px] xl:px-5 ${notice.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            {notice.kind === 'error' ? <XCircle size={17} className="mt-1 shrink-0" /> : <CheckCircle2 size={17} className="mt-1 shrink-0" />}
            <div className="flex-1">{notice.text}</div>
            <button aria-label="ปิดข้อความ" onClick={() => setNotice(null)}><XCircle size={16} /></button>
          </div>
        )}

        {view === 'dashboard' ? (
        <div className="app-sheet mx-auto max-w-[1500px] px-4 py-6 sm:px-7 lg:px-9 lg:py-8">
          <div className="app-fade flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">ภาพรวมความปลอดภัย</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                ตรวจเหตุการณ์จากสายรัดและคำขอที่ยืนยัน BLE แล้ว เพื่อเลือกสิ่งที่ต้องดูแลก่อน
              </p>
            </div>
            <button onClick={() => loadDashboard(true)} disabled={refreshing} className="refresh-control inline-flex w-fit items-center gap-2 px-4 py-2.5 text-sm font-semibold">
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> รีเฟรชข้อมูล
            </button>
          </div>

          {error && (
            <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">โหลดข้อมูลไม่สำเร็จ</div>
                <div className="mt-1 leading-6">{error}</div>
                <div className="mt-2 text-xs text-rose-700">
                  ตรวจสอบว่ารัน db/schema.sql กับ Neon แล้ว และตั้งค่า NEON_DATABASE_URL, CLERK_SECRET_KEY ครบถ้วน
                </div>
              </div>
            </div>
          )}


          {!loading && (urlInviteToken || pendingInvites.some((item) => !dismissedInvites.includes(item.invite_id))) && (
            <div className="mt-5 space-y-2">
              {urlInviteToken && (
                <div role="status" className="flex flex-col gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-semibold">คุณเปิดมาพร้อมลิงก์เชิญเข้าร่วมดูแล</div>
                    <div className="mt-0.5 text-xs leading-5 text-blue-800/80">ตรวจสอบว่าบัญชีนี้ใช้อีเมลเดียวกับที่ผู้เชิญระบุ แล้วกดยอมรับได้เลย</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={() => acceptInvite(urlInviteToken)} disabled={acceptingInviteId === urlInviteToken} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
                      {acceptingInviteId === urlInviteToken ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={14} />}{acceptingInviteId === urlInviteToken ? 'กำลังยอมรับ…' : 'ยอมรับคำเชิญ'}
                    </button>
                    <button onClick={dismissIncomingInvite} aria-label="ซ่อนลิงก์เชิญนี้" className="rounded-lg border border-blue-200 p-2 text-blue-700 hover:bg-blue-100"><X size={14} /></button>
                  </div>
                </div>
              )}
              {pendingInvites.filter((item) => !dismissedInvites.includes(item.invite_id)).map((item) => (
                <div key={item.invite_id} role="status" className="flex flex-col gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-semibold">คำเชิญให้ร่วมดูแล “{item.display_name}” รอเข้าร่วม</div>
                    <div className="mt-0.5 text-xs leading-5 text-blue-800/80">รับที่อีเมล {item.email} · หมดอายุ {formatDate(item.expires_at)} · ผู้ดูแลร่วมเห็นข้อมูลและรับแจ้งเตือนได้ แต่แก้ไขข้อมูลไม่ได้</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={() => acceptInvite(item.token)} disabled={acceptingInviteId === item.token} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
                      {acceptingInviteId === item.token ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={14} />}{acceptingInviteId === item.token ? 'กำลังยอมรับ…' : 'ยอมรับคำเชิญ'}
                    </button>
                    <button onClick={() => dismissPendingInvite(item.invite_id)} aria-label={`ซ่อนคำเชิญดูแล ${item.display_name}`} className="rounded-lg border border-blue-200 p-2 text-blue-700 hover:bg-blue-100"><X size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <section className="app-fade-1 mt-6 rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow sm:p-6">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><UserRound size={19} /></div>
              <div>
                <h2 className="font-bold text-slate-900">โปรไฟล์ผู้ดูแล</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  จัดการข้อมูลติดต่อของบัญชีนี้ อีเมลและรหัสผ่านจัดการผ่าน Clerk และแก้ไขที่นี่ไม่ได้
                </p>
              </div>
            </div>
            <form onSubmit={saveCaregiverProfile} className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-600">ชื่อผู้ดูแล</span>
                <input value={caregiverProfile.full_name} onChange={(e) => setCaregiverProfile((p) => ({ ...p, full_name: e.target.value }))} required minLength={2} maxLength={100} className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" placeholder="ชื่อที่ใช้แสดง" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-600">อีเมลบัญชี</span>
                <input value={profileEmail} readOnly className="w-full cursor-not-allowed rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-600">เบอร์โทรศัพท์ (ไม่บังคับ)</span>
                <input type="tel" value={caregiverProfile.phone} onChange={(e) => setCaregiverProfile((p) => ({ ...p, phone: e.target.value }))} maxLength={30} className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" placeholder="เบอร์สำหรับติดต่อ" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-600">ความสัมพันธ์กับผู้ป่วย (ไม่บังคับ)</span>
                <input value={caregiverProfile.relationship_to_patient} onChange={(e) => setCaregiverProfile((p) => ({ ...p, relationship_to_patient: e.target.value }))} maxLength={80} className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" placeholder="เช่น บุตร / ผู้ดูแลหลัก" />
              </label>
              <div className="sm:col-span-2 xl:col-span-4">
                <button disabled={savingProfile} className="inline-flex items-center gap-2 rounded-xl bg-[#1e3764] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#28477e] disabled:opacity-60">
                  <Save size={15} />{savingProfile ? 'กำลังบันทึก…' : 'บันทึกโปรไฟล์ผู้ดูแล'}
                </button>
              </div>
            </form>
          </section>

          <section className="metric-strip app-fade-2 mt-6 grid sm:grid-cols-2 xl:grid-cols-4">
  <div className="metric-pulse" aria-hidden="true" />
            <StatCard
              label="ผู้ป่วยที่ลงทะเบียน"
              value={loading ? '—' : activePatients.length}
              note={archivedPatients.length ? `มีโปรไฟล์ในคลัง ${archivedPatients.length} ราย` : 'โปรไฟล์ที่ใช้งานในบัญชี'}
              tone="blue"
            />
            <StatCard
              label="อุปกรณ์ออนไลน์"
              value={loading ? '—' : `${onlineDevices}/${data.devices.length}`}
              note="สายรัด / กล่องยา / Gateway"
              tone="green"
            />
            <StatCard
              label="การแจ้งเตือนที่ต้องตรวจสอบ"
              value={loading ? '—' : unacknowledgedAlerts}
              note="ยังไม่รับทราบ"
              tone={unacknowledgedAlerts ? 'red' : 'green'}
            />
            <StatCard
              label="คำขอเปิดกล่องยาที่รออยู่"
              value={loading ? '—' : pendingApprovals}
              note="ต้องมี BLE proof และไม่หมดอายุ"
              tone={pendingApprovals ? 'amber' : 'blue'}
            />
          </section>

          <div className="mt-6 grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
            <section className="app-fade-3 rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-bold text-slate-900">ผู้ป่วยและอุปกรณ์</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">อุปกรณ์จะแสดงเมื่อมีการลงทะเบียนผ่าน Device Gateway</p>
                </div>
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><Watch size={19} /></div>
              </div>

              <form onSubmit={addPatient} className="mt-5 grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-slate-500">
                  <span className="mb-1 block">ชื่อผู้ป่วยหรือรหัสนามแฝง (แนะนำ)</span>
                  <input value={newPatientName} onChange={(e) => setNewPatientName(e.target.value)} minLength={2} maxLength={100} required className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-50" />
                </label>
                <label className="text-xs text-slate-500">
                  <span className="mb-1 block">ความสัมพันธ์ (ไม่บังคับ)</span>
                  <input value={newPatientRelationship} onChange={(e) => setNewPatientRelationship(e.target.value)} maxLength={80} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-50" />
                </label>
                <label className="text-xs text-slate-500">
                  <span className="mb-1 block">วันเกิด (ไม่บังคับ)</span>
                  <input type="date" value={newPatientDob} onChange={(e) => setNewPatientDob(e.target.value)} max={new Date().toISOString().slice(0, 10)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-50" />
                </label>
                <div className="flex items-end">
                  <button disabled={addingPatient} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1e3764] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#28477e] disabled:opacity-60">
                    <Plus size={16} />{addingPatient ? 'กำลังบันทึก…' : 'เพิ่มผู้ป่วย'}
                  </button>
                </div>
              </form>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">แนะนำใช้ชื่อสมมติระหว่างพัฒนา ระบบจะเก็บประวัติไว้เมื่อเก็บโปรไฟล์เข้าคลัง</p>
                <button type="button" onClick={() => setShowArchivedPatients((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  <Archive size={14} />{showArchivedPatients ? 'กลับไปผู้ป่วยที่ใช้งาน' : `ดูคลังผู้ป่วย (${archivedPatients.length})`}
                </button>
              </div>

              <div className="mt-4 divide-y divide-slate-100">
                {loading ? (
                  <div className="py-8 text-center text-sm text-slate-400">กำลังโหลดข้อมูล…</div>
                ) : visiblePatients.length === 0 ? (
                  <EmptyState
                    icon={HeartPulse}
                    title={showArchivedPatients ? 'ยังไม่มีผู้ป่วยในคลัง' : 'ยังไม่มีโปรไฟล์ผู้ป่วย'}
                    text={showArchivedPatients ? 'โปรไฟล์ที่เก็บเข้าคลังจะแสดงในส่วนนี้' : 'เพิ่มโปรไฟล์เพื่อเริ่มผูกอุปกรณ์ทดสอบ โดยใช้ชื่อสมมติในช่วงพัฒนา'}
                  />
                ) : visiblePatients.map((patient) => {
                  const patientDevices = data.devices.filter((device) => device.patient_id === patient.id);
                  const patientFiles = filesByPatient.get(patient.id) || [];
                  return (
                    <div key={patient.id} className="patient-card py-4 first:pt-5 last:pb-0">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="care-avatar is-md shrink-0" aria-label={patient.display_name}>{patient.display_name.slice(0, 1)}</div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="truncate text-sm font-semibold text-slate-900">{patient.display_name}</div>
                              {isOwnerOf(patient)
                                ? <div className="care-avatar care-avatar-owner is-sm" title="เจ้าของหลัก">หลัก</div>
                                : <div className="care-avatar care-avatar-companion is-sm" title="ผู้ดูแลร่วม">ร่วม</div>}
                              {patient.is_archived && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">เก็บเข้าคลัง</span>}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-400">
                              เพิ่มเมื่อ {formatDate(patient.created_at)}
                              {patient.relationship ? ` · ${patient.relationship}` : ''}
                              {patient.date_of_birth ? ` · วันเกิด ${patient.date_of_birth}` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-600">{patientDevices.length} อุปกรณ์</span>
                          {isOwnerOf(patient) && (
                            <>
                              <button type="button" onClick={() => startEditingPatient(patient)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                                <Pencil size={13} /> แก้ไข
                              </button>
                              <button type="button" onClick={() => toggleArchivePatient(patient)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                                {patient.is_archived ? <RotateCcw size={13} /> : <Archive size={13} />}
                                {patient.is_archived ? 'กู้คืน' : 'เก็บเข้าคลัง'}
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {editingPatientId === patient.id && (
                        <form onSubmit={savePatient} className="mt-4 grid gap-2 rounded-xl border border-blue-100 bg-blue-50/50 p-3 sm:grid-cols-2">
                          <label className="text-xs text-slate-600">
                            <span className="mb-1 block">ชื่อหรือรหัสนามแฝง</span>
                            <input value={patientDraft.display_name} onChange={(e) => setPatientDraft((p) => ({ ...p, display_name: e.target.value }))} minLength={2} maxLength={100} required className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" />
                          </label>
                          <label className="text-xs text-slate-600">
                            <span className="mb-1 block">ความสัมพันธ์</span>
                            <input value={patientDraft.relationship} onChange={(e) => setPatientDraft((p) => ({ ...p, relationship: e.target.value }))} maxLength={80} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" />
                          </label>
                          <label className="text-xs text-slate-600">
                            <span className="mb-1 block">วันเกิด (ไม่บังคับ)</span>
                            <input type="date" value={patientDraft.date_of_birth || ''} onChange={(e) => setPatientDraft((p) => ({ ...p, date_of_birth: e.target.value }))} max={new Date().toISOString().slice(0, 10)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" />
                          </label>
                          <div className="flex items-end gap-2">
                            <button disabled={savingPatient} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3764] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
                              <Save size={13} />{savingPatient ? 'กำลังบันทึก…' : 'บันทึก'}
                            </button>
                            <button type="button" onClick={() => setEditingPatientId('')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                              <X size={13} /> ยกเลิก
                            </button>
                          </div>
                        </form>
                      )}

                      {patientDevices.length > 0 && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {patientDevices.map((device) => (
                            <div key={device.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-xs font-semibold">{device.device_name}</span>
                                <span className={`inline-flex items-center gap-1 text-[11px] ${device.status === 'online' ? 'text-emerald-700' : 'text-slate-400'}`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${device.status === 'online' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                  {statusLabel(device.status)}
                                </span>
                              </div>
                              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                                <Battery size={13} />{device.battery_percent == null ? 'ไม่มีข้อมูลแบตเตอรี่' : `แบตเตอรี่ ${device.battery_percent}%`}
                                <span className="mx-1 text-slate-300">·</span>
                                <Clock3 size={12} />{formatDate(device.last_seen_at)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <PatientFiles
                        files={patientFiles}
                        canManage={isOwnerOf(patient)}
                        uploading={uploadingPatientId === patient.id}
                        downloadingId={downloadingFileId}
                        deletingId={deletingFileId}
                        onUpload={(file) => uploadFile(patient.id, file)}
                        onDownload={downloadFile}
                        onDelete={deleteFile}
                      />

                      {isOwnerOf(patient) && (
                        <div className="mt-3 rounded-xl border border-slate-100 bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-600">
                              <Users size={13} /> ทีมผู้ดูแล
                              <span className="hidden truncate text-[10px] font-normal text-slate-400 sm:inline">
                                เชิญได้ทีละ 1 ลิงก์ต่ออีเมล ใช้ได้ 7 วัน ผู้รับต้องเข้าสู่ระบบด้วยอีเมลเดียวกัน
                              </span>
                            </div>
                            <button type="button" onClick={() => toggleCircle(patient)} aria-expanded={circleOpenId === patient.id} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                              {circleOpenId === patient.id ? 'ปิด' : 'จัดการทีม'}
                            </button>
                          </div>

                          {circleOpenId === patient.id && (
                            <div className="mt-3">
                              {circleLoading ? (
                                <div className="py-3 text-center text-xs text-slate-400">กำลังโหลดทีมผู้ดูแล…</div>
                              ) : circleData?.error ? (
                                <p className="text-xs leading-5 text-rose-700">{circleData.error}</p>
                              ) : circleData ? (
                                <>
                                  {freshInvite?.patient_id === patient.id && (
                                    <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5">
                                      <div className="font-semibold text-emerald-900">ลิงก์เชิญสำหรับ {freshInvite.email} พร้อมแล้ว</div>
                                      <div className="mt-1 break-all text-emerald-800/80">{inviteLink(freshInvite.token)}</div>
                                      <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <button type="button" onClick={() => copyInviteLink(freshInvite.token)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800">
                                          <Copy size={13} /> คัดลอกลิงก์
                                        </button>
                                        <span className="text-emerald-800/70">ผู้รับเปิดลิงก์แล้วยืนยันด้วยอีเมลของตัวเอง</span>
                                      </div>
                                    </div>
                                  )}

                                  <form onSubmit={(e) => { e.preventDefault(); createInvite(patient.id); }} className="flex flex-col gap-2 sm:flex-row">
                                    <input
                                      type="email"
                                      inputMode="email"
                                      autoComplete="email"
                                      value={inviteEmail}
                                      onChange={(e) => setInviteEmail(e.target.value)}
                                      required
                                      placeholder="อีเมลผู้ดูแลที่ต้องการเชิญ"
                                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-50"
                                    />
                                    <button disabled={inviting} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1e3764] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#28477e] disabled:opacity-60">
                                      <Plus size={13} />{inviting ? 'กำลังสร้าง…' : 'สร้างลิงก์เชิญ'}
                                    </button>
                                  </form>

                                  {circleData.members.length > 0 && (
                                    <div className="care-circle mt-3" aria-hidden="true">
                                      {circleData.members.slice(0, 6).map((member) => (
                                        <div
                                          key={member.user_id}
                                          className={`care-avatar is-md ${member.role === 'primary' ? 'owner' : 'companion'}`}
                                          title={member.role === 'primary' ? `${member.full_name || member.user_id} · เจ้าของหลัก` : `${member.full_name || member.user_id} · ผู้ดูแลร่วม`}
                                        >
                                          {(member.full_name || member.user_id || '?').trim().slice(0, 1).toUpperCase()}
                                        </div>
                                      ))}
                                      {circleData.members.length > 6 && (
                                        <div className="care-avatar is-md care-more" style={{ width: 'auto', borderRadius: 9999, padding: '0 10px' }}>
                                          +{circleData.members.length - 6}
                                        </div>
                                      )}
                                      {circleData.invites.length > 0 && (
                                        <div className="care-avatar is-md" style={{ background: 'var(--raised)', color: 'var(--muted)', fontWeight: 600 }} title={`${circleData.invites.length} คำเชิญรอยืนยัน`}>
                                          <Clock3 size={13} />
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  <ul className="mt-3 space-y-1.5">
                                    {circleData.members.map((member) => (
                                      <li key={member.user_id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs">
                                        <div className="min-w-0 flex-1">
                                          <div className="truncate font-medium text-slate-700">{member.full_name || member.user_id}</div>
                                          <div className="text-[10px] text-slate-400">เข้าร่วมเมื่อ {formatDate(member.created_at)}</div>
                                        </div>
                                        {member.role === 'primary' ? (
                                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">เจ้าของหลัก</span>
                                        ) : (
                                          <>
                                            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">ผู้ดูแลร่วม</span>
                                            <button type="button" onClick={() => removeCaregiver(patient.id, member.user_id, member.full_name)} disabled={busyCircleAction === member.user_id} className="rounded-lg border border-slate-200 px-2 py-1 font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">
                                              {busyCircleAction === member.user_id ? '…' : 'ลบออก'}
                                            </button>
                                          </>
                                        )}
                                      </li>
                                    ))}
                                    {circleData.invites.map((invite) => (
                                      <li key={invite.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-2.5 py-2 text-xs">
                                        <div className="min-w-0 flex-1">
                                          <div className="truncate font-medium text-blue-900">คำเชิญรอยืนยัน · {invite.email}</div>
                                          <div className="text-[10px] text-blue-800/70">หมดอายุ {formatDate(invite.expires_at)}</div>
                                        </div>
                                        <button type="button" onClick={() => revokeCaregiverInvite(patient.id, invite.id)} disabled={busyCircleAction === invite.id} className="rounded-lg border border-blue-200 px-2 py-1 font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-60">
                                          {busyCircleAction === invite.id ? '…' : 'ยกเลิก'}
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                </>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-bold text-slate-900">คำขออนุมัติกล่องยา</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">อนุมัติได้เมื่อกล่องยายืนยัน BLE proximity แล้วเท่านั้น</p>
                </div>
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700"><LockKeyhole size={19} /></div>
              </div>

              <div className="mt-4 space-y-3">
                {loading ? (
                  <div className="py-8 text-center text-sm text-slate-400">กำลังโหลดข้อมูล…</div>
                ) : data.approvals.length === 0 ? (
                  <EmptyState icon={LockKeyhole} title="ไม่มีคำขอในขณะนี้" text="เมื่อกล่องยาส่งคำขอที่มี BLE proof ผ่าน Device Gateway รายการจะแสดงตรงนี้" />
                ) : data.approvals.map((request) => {
                  const canApprove = request.status === 'pending' && request.ble_verified && new Date(request.expires_at).getTime() > Date.now();
                  const status = request.status === 'pending'
                    ? (request.ble_verified ? 'รออนุมัติ' : 'รอ BLE proof')
                    : request.status === 'approved' ? 'อนุมัติแล้ว' : request.status === 'expired' ? 'หมดอายุ' : 'ปฏิเสธ';
                  return (
                    <div key={request.id} className="rounded-xl border border-slate-200 p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">ช่องยา {request.compartment_no} · {patientNames.get(request.patient_id) || 'ผู้ป่วย'}</div>
                          <div className="mt-1.5 text-xs text-slate-500">รับคำขอ {formatDate(request.requested_at)}</div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${request.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : request.status === 'pending' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{status}</span>
                      </div>
                      {request.status === 'pending' && (
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className={`flex items-center gap-1.5 text-xs ${request.ble_verified ? 'text-emerald-700' : 'text-slate-500'}`}>
                            {request.ble_verified && <CheckCircle2 size={14} aria-hidden="true" />}
                            <span>{request.ble_verified ? 'กล่องยายืนยัน BLE แล้ว' : 'ยังไม่ยืนยันระยะใกล้ผ่าน BLE'}</span>
                            <div className="mt-1 text-[11px] text-slate-400">หมดอายุ: {formatDate(request.expires_at)}</div>
                          </div>
                          <button disabled={!canApprove || approvingId === request.id} onClick={() => approve(request.id)} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1e3764] px-3 py-2 text-xs font-semibold text-white hover:bg-[#28477e]">
                            {approvingId === request.id ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={14} />}อนุมัติ
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900/80">
                <strong>ข้อจำกัดของต้นแบบ:</strong> ระบบนี้สร้างคิวคำสั่งเท่านั้น ต้องเชื่อม MQTT/ตัวอ่านคิวกับเฟิร์มแวร์กล่องยา และให้กล่องยาตรวจเงื่อนไขความปลอดภัยอีกครั้งก่อนขับ Solenoid
              </div>
            </section>
          </div>

          <section className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-900">เหตุการณ์และการแจ้งเตือนล่าสุด</h2>
                <p className="mt-1 text-xs text-slate-500">การออกนอก Geofence · การเปิดสายรัด · แบตเตอรี่ต่ำ · BLE ขาดการเชื่อมต่อ</p>
              </div>
              <BellRing size={19} className="text-slate-400" />
            </div>
            <div className="mt-4">
              {loading ? (
                <div className="py-8 text-center text-sm text-slate-400">กำลังโหลดข้อมูล…</div>
              ) : data.alerts.length === 0 ? (
                <EmptyState icon={BellRing} title="ยังไม่มีเหตุการณ์แจ้งเตือน" text="รายการจริงจะแสดงเมื่อ Device Gateway บันทึกเหตุการณ์จากอุปกรณ์" />
              ) : (
                <div className="space-y-2">
                  {data.alerts.map((alert) => (
                    <div key={alert.id} className="flex items-start gap-3 rounded-xl border border-slate-100 p-3">
                      <div className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${alert.severity === 'critical' ? 'bg-rose-50 text-rose-700' : alert.severity === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                        <AlertTriangle size={17} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">{alert.message}</span>
                          {!alert.acknowledged_at && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">ยังไม่รับทราบ</span>}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">{patientNames.get(alert.patient_id) || 'ผู้ป่วย'} · {formatDate(alert.occurred_at)}</div>
                      </div>
                      {!alert.acknowledged_at && (
                        <button
                          onClick={() => ackAlert(alert.id)}
                          className="mt-1 shrink-0 rounded-xl bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                        >
                          รับทราบ
                        </button>
                      )}
                      <ChevronRight size={16} className="mt-2 shrink-0 text-slate-300" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <footer className="mt-7 flex flex-col gap-2 border-t border-slate-200 pt-5 text-[11px] leading-5 text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <span>GeoWrisX AD · Research prototype · R&amp;D / OCOP</span>
            <span className="flex items-center gap-1.5"><ShieldCheck size={13} /> ข้อมูลทดสอบเท่านั้นจนกว่าจะผ่านการตรวจสอบความปลอดภัยและการทดสอบจริง</span>
          </footer>
        </div>
        ) : view === 'track' ? (
          <TrackView
            patients={data.patients}
            viewerUserId={data.viewer_user_id}
            authedRequest={authedRequest}
            onNotice={setNotice}
            onBack={() => setView('dashboard')}
          />
        ) : view === 'carelog' ? (
          <CareLogView
            patients={data.patients}
            viewerUserId={data.viewer_user_id}
            authedRequest={authedRequest}
            authedDownload={authedDownload}
            onNotice={setNotice}
            onBack={() => setView('dashboard')}
          />
        ) : (
          <SettingsView
            profile={caregiverProfile}
            email={profileEmail}
            patients={data.patients}
            devices={data.devices}
            inviteCount={pendingInvites.length}
            prefs={prefs}
            saving={savingPrefs}
            onSavePrefs={savePrefs}
            onBack={() => setView('dashboard')}
            onOpenTrack={() => setView('track')}
          />
        )}
      </main>
      {showWelcome && <WelcomeFlow onDone={closeWelcome} />}
    </div>
  );
}

function SettingsToggle({ checked, label, hint, onChange }) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 px-3.5 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-5 text-slate-400">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 accent-[#1e3764]"
      />
    </label>
  );
}

function SettingsView({ profile, email, patients, devices, inviteCount, prefs, saving, onSavePrefs, onBack, onOpenTrack }) {
  const [draft, setDraft] = useState(prefs);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState('');

  useEffect(() => { setDraft(prefs); }, [prefs]);

  const channels = draft.notify_channels || {};
  const ui = draft.ui || {};

  function update(next) {
    setDraft(next);
    setSavedAt('');
  }

  function patch(key, value) {
    update({ ...draft, [key]: value });
  }

  function patchChannel(key, value) {
    update({ ...draft, notify_channels: { ...channels, [key]: value } });
  }

  function patchUi(key, value) {
    update({ ...draft, ui: { ...ui, [key]: value } });
  }

  async function handleSave() {
    setSaveError('');
    const error = await onSavePrefs(draft);
    if (error) setSaveError(error);
    else setSavedAt(new Date().toLocaleTimeString('th-TH'));
  }

  const activeDevices = devices.filter((d) => !d.is_archived);

  return (
    <div className="app-fade mx-auto app-sheet max-w-[1100px] px-4 py-6 sm:px-7 lg:px-9 lg:py-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">ตั้งค่าและจัดการบัญชี</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            ปรับการแจ้งเตือนและหน้าจอให้เหมาะกับคุณ — บันทึกไว้ในบัญชีผู้ดูแลของคุณเอง
          </p>
        </div>
        <button onClick={onBack} className="refresh-control inline-flex w-fit items-center gap-2 px-4 py-2.5 text-sm font-semibold">
          <ChevronRight size={15} className="rotate-180" /> กลับไปแดชบอร์ด
        </button>
      </div>

      {saveError && (
        <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-800">{saveError}</div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-bold text-slate-900"><BellRing size={18} className="text-slate-500" /> การแจ้งเตือน</h2>
            <span className="text-[11px] text-slate-400">ช่องทาง + เรื่อง</span>
          </div>
          <div className="mt-4 space-y-2.5">
            <SettingsToggle
              checked={draft.notify_email !== false}
              label="อีเมลแจ้งเตือน (Resend)"
              hint="ส่งอีเมลเมื่อเกิดเหตุการณ์สำคัญที่เปิดไว้ด้านล่าง"
              onChange={(v) => patch('notify_email', v)}
            />
            {[
              ['sos', 'SOS / ล้มร่วง', 'เหตุการณ์วิกฤตจากสายรัด'],
              ['geofence', 'ออกนอกพื้นที่ปลอดภัย', 'Geofence exit'],
              ['tamper', 'ถอดสายรัด', 'Anti-removal / tamper'],
              ['battery', 'แบตเตอรี่ต่ำ', 'เตือนก่อนอุปกรณ์ดับ'],
              ['meds', 'ยาพลาดเวลา', 'จากข้อมูลกล่องยา'],
              ['daily_summary', 'สรุปประจำวัน', 'ส่งสรุปการดูแล 1 ครั้งต่อวัน'],
            ].map(([key, label, hint]) => (
              <SettingsToggle
                key={key}
                checked={channels[key] !== false}
                label={label}
                hint={hint}
                onChange={(v) => patchChannel(key, v)}
              />
            ))}
          </div>
        </section>

        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-bold text-slate-900"><UserRound size={18} className="text-slate-500" /> โปรไฟล์ผู้ดูแล</h2>
              <span className="text-[11px] text-slate-400">ตั้งจากการ์ดบัญชีบนแดชบอร์ด</span>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-400">ชื่อ</dt><dd className="text-right font-semibold text-slate-800">{profile.full_name || '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">อีเมลบัญชี</dt><dd className="text-right font-semibold text-slate-800">{email || '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">เบอร์โทร</dt><dd className="text-right font-semibold text-slate-800">{profile.phone || '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">ความสัมพันธ์</dt><dd className="text-right font-semibold text-slate-800">{profile.relationship_to_patient || '—'}</dd></div>
            </dl>
            <p className="mt-3 text-xs leading-5 text-slate-400">แก้ไขได้ที่การ์ด "บัญชีของฉัน" ในหน้าแดชบอร์ด (ปุ่มแก้โปรไฟล์)</p>
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-bold text-slate-900"><Watch size={18} className="text-slate-500" /> ผู้ป่วยและอุปกรณ์</h2>
              <span className="text-[11px] text-slate-400">{patients.filter((p) => !p.is_archived).length} ราย · {activeDevices.length} เครื่อง</span>
            </div>
            {patients.filter((p) => !p.is_archived).length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">ยังไม่มีผู้ป่วย active — เพิ่มได้จากการ์ดผู้ป่วยบนแดชบอร์ด</p>
            ) : (
              <ul className="mt-4 space-y-2 text-sm">
                {patients.filter((p) => !p.is_archived).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2">
                    <span className="font-semibold text-slate-800">{p.display_name}</span>
                    <span className="text-xs text-slate-400">
                      {devices.filter((d) => d.patient_id === p.id && !d.is_archived).map((d) => d.device_name).join(', ') || 'ยังไม่มีอุปกรณ์'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs leading-5 text-slate-400">การลงทะเบียน/ลบอุปกรณ์ทำจากการ์ดอุปกรณ์บนแดชบอร์ด (เพิ่ม UI จัดการตรงนี้ในเฟสถัดไป)</p>
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-bold text-slate-900"><Users size={18} className="text-slate-500" /> สมาชิกทีม</h2>
              <span className="text-[11px] text-slate-400">{inviteCount > 0 ? `${inviteCount} คำเชิญรอ` : '—'}</span>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-400">
              เชิญผู้ดูแลร่วมและจัดการวงดูแลจากการ์ดวงผู้ดูแลของแต่ละผู้ป่วย (ปุ่ม "วงผู้ดูแล" บนการ์ดผู้ป่วย)
            </p>
          </section>
        </div>
      </div>

      <section className="mt-5 rounded-2xl border border-teal-200 bg-teal-50/60 p-5 panel-shadow">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-bold text-slate-900"><MapPinned size={18} className="text-teal-700" /> พื้นที่ปลอดภัย (Geofences)</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              จัดการวงล้อมจากหน้าแผนที่ — เพิ่มวงกลมรัศมีมากสุด 3 กม. แล้วระบบจะแจ้งเตือนเมื่อออกนอกเขต
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-teal-900">
          เปิดหน้า <button type="button" onClick={onOpenTrack} className="font-semibold underline decoration-teal-500 underline-offset-2">ตำแหน่งและพื้นที่ปลอดภัย</button> เพื่อจัดการวงบนแผนที่
        </p>
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-bold text-slate-900"><ShieldCheck size={18} className="text-slate-500" /> ความเป็นส่วนตัวและข้อมูล</h2>
        </div>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <SettingsToggle checked={ui.show_hr !== false} label="แสดงหัวใจ (HR) บนแดชบอร์ด" onChange={(v) => patchUi('show_hr', v)} />
          <SettingsToggle checked={ui.show_sleep !== false} label="แสดงข้อมูลการนอน" onChange={(v) => patchUi('show_sleep', v)} />
          <SettingsToggle checked={ui.show_files !== false} label="แสดงไฟล์แนบผู้ป่วย" onChange={(v) => patchUi('show_files', v)} />
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-400">
          การเก็บสลับ/คืนผู้ป่วยและการลบข้อมูลยังทำจากการ์ดผู้ป่วย — ข้อมูล GPS/แผนที่เตรียม UI ความเป็นส่วนตัวเพิ่มในเฟส P2
        </p>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="refresh-control inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold"
        >
          {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />} บันทึกการตั้งค่า
        </button>
        {savedAt && <span className="text-xs text-emerald-700">บันทึกแล้ว {savedAt}</span>}
      </div>

      <footer className="mt-7 flex flex-col gap-2 border-t border-slate-200 pt-5 text-[11px] leading-5 text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <span>GeoWrisX AD · Research prototype · R&amp;D / OCOP</span>
        <span className="flex items-center gap-1.5"><ShieldCheck size={13} /> การตั้งค่าเก็บต่อบัญชีผู้ใช้ใน Neon Postgres</span>
      </footer>
    </div>
  );
}

function NavItem({ icon: Icon, label, active = false, count = 0, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`nav-item flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${active ? 'is-active font-semibold' : 'text-slate-500'}`}
    >
      <Icon size={17} />
      <span className="flex-1">{label}</span>
      {count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-100 px-1.5 text-[10px] font-bold text-rose-700">{count}</span>}
    </button>
  );
}

export function EmptyState({ icon: Icon, title, text }) {
  return (
    <div className="grid justify-items-center px-4 py-8 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-400"><Icon size={20} /></div>
      <div className="mt-3 text-sm font-semibold text-slate-700">{title}</div>
      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-400">{text}</p>
    </div>
  );
}

export default function App() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f5f7fb]">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500">
          <RefreshCw className="animate-spin text-blue-700" size={18} />กำลังตรวจสอบเซสชัน…
        </div>
      </div>
    );
  }

  return isSignedIn ? <Dashboard /> : <AuthScreen />;
}
