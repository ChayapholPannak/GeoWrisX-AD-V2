import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ChevronRight, Crosshair, MapPinned, Pentagon, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { EmptyState, formatDate } from './App.jsx';

/** OpenStreetMap tiles — no API key, no cost. */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const STATUS_CHIP = {
  inside: { text: 'อยู่ในเขตปลอดภัย', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  outside: { text: 'ออกนอกเขต', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  no_geofence: { text: 'ยังไม่ได้ตั้งพื้นที่ปลอดภัย', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  unknown: { text: 'รอจุด GPS แรก', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
};

function pulseIcon() {
  return L.divIcon({
    className: 'gx-pulse-marker',
    html: '<span class="gx-pulse-dot"></span><span class="gx-pulse-ring"></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function TrackMap({ points, lastPoint, geofences, drawing, drawPoints, onMapClick }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const layerRef = useRef(null);
  const drawLayerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = L.map(containerRef.current, { scrollWheelZoom: true });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(mapRef.current);
    layerRef.current = L.layerGroup().addTo(mapRef.current);
    drawLayerRef.current = L.layerGroup().addTo(mapRef.current);
    return () => {
      mapRef.current.remove();
      mapRef.current = null;
    };
  }, []);

  // Drawing mode: cursor crosshair + click-to-add-vertex.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    if (!drawing) return undefined;
    map.getContainer().classList.add('gx-drawing');
    const handler = (e) => onMapClick([
      Number(e.latlng.lat.toFixed(6)),
      Number(e.latlng.lng.toFixed(6)),
    ]);
    map.on('click', handler);
    return () => {
      map.off('click', handler);
      map.getContainer().classList.remove('gx-drawing');
    };
  }, [drawing, onMapClick]);

  // Draft polygon preview (separate layer so real data stays untouched).
  useEffect(() => {
    const layers = drawLayerRef.current;
    if (!layers) return;
    layers.clearLayers();
    if (!drawPoints || drawPoints.length === 0) return;
    const coords = drawPoints;
    coords.forEach((c) => L.circleMarker(c, {
      radius: 4, color: '#b45309', weight: 2, fillColor: '#fbbf24', fillOpacity: 1,
    }).addTo(layers));
    if (coords.length >= 2) {
      L.polyline(coords.concat(coords.length >= 3 ? [coords[0]] : []), {
        color: '#b45309', weight: 2, dashArray: '6 6',
      }).addTo(layers);
    }
    if (coords.length >= 3) {
      L.polygon(coords, { color: '#b45309', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.06, dashArray: '6 6' }).addTo(layers);
    }
  }, [drawPoints]);

  const dataKey = useMemo(() => JSON.stringify({
    p: points,
    g: geofences.map((g) => g.id),
    lp: lastPoint && lastPoint.recorded_at,
  }), [points, geofences, lastPoint]);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layerRef.current;
    if (!map || !layers) return;
    layers.clearLayers();

    const bounds = [];
    if (points.length >= 2) {
      const coords = points.map((p) => [p.lat, p.lng]);
      L.polyline(coords, { color: '#14b8a6', weight: 3, opacity: 0.8 }).addTo(layers);
      coords.forEach((c) => bounds.push(c));
    }
    for (const fence of geofences) {
      if (fence.kind === 'circle') {
        const lat = Number(fence.center_lat);
        const lng = Number(fence.center_lng);
        L.circle([lat, lng], {
          radius: Number(fence.radius_m) || 0,
          color: '#0f766e',
          weight: 2,
          fillColor: '#14b8a6',
          fillOpacity: 0.08,
        }).addTo(layers).bindTooltip(fence.label, { permanent: true, direction: 'top' });
        bounds.push([lat, lng]);
      } else {
        const poly = typeof fence.polygon === 'string' ? JSON.parse(fence.polygon) : fence.polygon;
        if (Array.isArray(poly) && poly.length >= 3) {
          L.polygon(poly, {
            color: '#0f766e', weight: 2, fillColor: '#14b8a6', fillOpacity: 0.08,
          }).addTo(layers).bindTooltip(fence.label, { permanent: true, direction: 'top' });
          poly.forEach((c) => bounds.push(c));
        }
      }
    }
    if (lastPoint) {
      L.marker([lastPoint.lat, lastPoint.lng], { icon: pulseIcon(), title: 'ตำแหน่งล่าสุด' })
        .addTo(layers)
        .bindPopup(`<b>${lastPoint.lat.toFixed(5)}, ${lastPoint.lng.toFixed(5)}</b><br/>${new Date(lastPoint.recorded_at).toLocaleString('th-TH')}<br/>ความแม่นยำ ±${lastPoint.acc_m ?? '?'} m`);
      bounds.push([lastPoint.lat, lastPoint.lng]);
    }
    if (bounds.length) {
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    } else {
      // No GPS/fence data yet — give the map a view so drawing and clicks work;
      // the user can drag/zoom to their area before starting.
      map.setView([13.7367, 100.5231], 13, { animate: false });
    }
  }, [dataKey]);

  return <div ref={containerRef} className="gx-map h-[420px] w-full rounded-xl border border-slate-200" />;
}

/**
 * ตำแหน่งและพื้นที่ปลอดภัย — Leaflet map + geofence management.
 * Data flows: GET /api/track (points + gates) · /api/geofences (CRUD).
 */
export default function TrackView({ patients, viewerUserId, authedRequest, onNotice, onBack }) {
  const activePatients = patients.filter((p) => !p.is_archived);
  const [patientId, setPatientId] = useState(activePatients[0]?.id || '');
  const [track, setTrack] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');

  const [trackPatientId, setTrackPatientId] = useState('');
  const current = activePatients.find((p) => p.id === patientId);
  const canManage = !!current && current.owner_id === viewerUserId;

  // Dashboard data loads after first mount — adopt the first active patient
  // once (and re-adopt if the selected patient leaves the list).
  useEffect(() => {
    if (!activePatients.length) return;
    if (patientId && activePatients.some((p) => p.id === patientId)) return;
    setPatientId(activePatients[0].id);
  }, [patientId, activePatients]);

  // --- geofence form ---
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ label: '', address: '', center_lat: '', center_lng: '', radius_m: 150 });
  const [savingFence, setSavingFence] = useState(false);

  // --- polygon drawing ---
  const [drawing, setDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState([]);
  const [polyLabel, setPolyLabel] = useState('');

  function addDrawnPoint(point) {
    setDrawPoints((current) => (current.length >= 64 ? current : [...current, point]));
  }

  function exitDrawing() {
    setDrawing(false);
    setDrawPoints([]);
    setPolyLabel('');
  }

  async function savePolygon() {
    if (drawPoints.length < 3 || !polyLabel.trim()) return;
    setSavingFence(true);
    try {
      await authedRequest('geofences', {
        method: 'POST',
        body: {
          patient_id: patientId,
          label: polyLabel.trim(),
          kind: 'polygon',
          polygon: drawPoints,
          notify_all: true,
        },
      });
      exitDrawing();
      onNotice({ kind: 'ok', text: 'เพิ่มพื้นที่แบบรูปหลายเหลี่ยมแล้ว' });
      loadTrack(true);
    } catch (e) {
      onNotice({ kind: 'error', text: e.message || 'บันทึกพื้นที่ไม่สำเร็จ' });
    } finally {
      setSavingFence(false);
    }
  }

  const loadTrack = useCallback(async (quiet = false) => {
    if (!patientId) return;
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const result = await authedRequest('track', { query: { patient_id: patientId } });
      setTrack(result);
    } catch (e) {
      onNotice({ kind: 'error', text: e.message || 'โหลดข้อมูลตำแหน่งไม่สำเร็จ' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authedRequest, patientId, onNotice]);

  useEffect(() => {
    setTrack(null);
    loadTrack();
  }, [loadTrack]);

  // Light auto-refresh so the sensor feed shows up without manual clicks.
  useEffect(() => {
    if (!patientId) return undefined;
    const timer = setInterval(() => { loadTrack(true); }, 60000);
    return () => clearInterval(timer);
  }, [loadTrack, patientId]);

  function useLastKnown() {
    if (track?.last_point) {
      setForm((f) => ({
        ...f,
        center_lat: String(track.last_point.lat).slice(0, 12),
        center_lng: String(track.last_point.lng).slice(0, 12),
      }));
    } else {
      onNotice({ kind: 'error', text: 'ยังไม่มีจุด GPS — ส่งจุดจากอุปกรณ์ก่อน หรือกรอกพิกัดเอง' });
    }
  }

  async function createFence() {
    setSavingFence(true);
    try {
      await authedRequest('geofences', {
        method: 'POST',
        body: {
          patient_id: patientId,
          label: form.label,
          address: form.address,
          kind: 'circle',
          center_lat: Number(form.center_lat),
          center_lng: Number(form.center_lng),
          radius_m: Number(form.radius_m),
          notify_all: true,
        },
      });
      setFormOpen(false);
      setForm({ label: '', address: '', center_lat: '', center_lng: '', radius_m: 150 });
      onNotice({ kind: 'ok', text: 'เพิ่มพื้นที่ปลอดภัยแล้ว' });
      loadTrack(true);
    } catch (e) {
      onNotice({ kind: 'error', text: e.message || 'บันทึกพื้นที่ไม่สำเร็จ' });
    } finally {
      setSavingFence(false);
    }
  }

  async function patchFence(id, patch) {
    setBusy(id);
    try {
      await authedRequest('geofences', { method: 'PATCH', query: { id }, body: patch });
      loadTrack(true);
    } catch (e) {
      onNotice({ kind: 'error', text: e.message || 'แก้ไขไม่สำเร็จ' });
    } finally {
      setBusy('');
    }
  }

  async function deleteFence(id) {
    setBusy(id);
    try {
      await authedRequest('geofences', { method: 'DELETE', query: { id } });
      onNotice({ kind: 'ok', text: 'ปิดการใช้งานวงนี้แล้ว' });
      loadTrack(true);
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
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">ตำแหน่งและพื้นที่ปลอดภัย</h1>
          <button onClick={onBack} className="refresh-control inline-flex w-fit items-center gap-2 px-4 py-2.5 text-sm font-semibold">
            <ChevronRight size={15} className="rotate-180" /> กลับไปแดชบอร์ด
          </button>
        </div>
        <div className="mt-6 rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
          <EmptyState icon={MapPinned} title="ยังไม่มีผู้ป่วยแบบถาวร" text="เพิ่มผู้ป่วยจากการ์ดผู้ป่วยบนแดชบอร์ดก่อน แล้วหน้านี้จะพร้อมวางแผนที่และวงปลอดภัย" />
        </div>
      </div>
    );
  }

  const chip = STATUS_CHIP[track?.status] || STATUS_CHIP.unknown;
  const geofences = track?.geofences || [];
  const points = track?.points || [];
  const lastPoint = track?.last_point || null;

  return (
    <div className="app-fade mx-auto app-sheet max-w-[1400px] px-4 py-6 sm:px-7 lg:px-9 lg:py-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">ตำแหน่งและพื้นที่ปลอดภัย</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            ส่งจุด GPS จากสายรัดเข้า Device Gateway — ระบบประเมินเขตพลัง hysteresis (15% + 2 จุด + 60 วิ) กันเตือนกระพริบ
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
          <button onClick={() => loadTrack(true)} disabled={refreshing} className="refresh-control inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold">
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> รีเฟรช
          </button>
          <button onClick={onBack} className="refresh-control inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold">
            <ChevronRight size={15} className="rotate-180" /> กลับไปแดชบอร์ด
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <section className="rounded-2xl border border-slate-200/80 bg-white p-4 panel-shadow sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className={`rounded-full border px-3 py-1 text-xs font-bold ${chip.cls}`}>{chip.text}</span>
              {track?.latest_exit && (
                <span className="text-[11px] text-slate-400">
                  แจ้งล่าสุด: {formatDate(track.latest_exit.occurred_at)}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-400">
              {lastPoint ? `จุดล่าสุด ${formatDate(lastPoint.recorded_at)} · ±${lastPoint.acc_m ?? '?'} m` : `${points.length} จุดใน ${track?.window_hours || 24} ชม.`}
            </div>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="gx-map skeleton grid h-[420px] w-full place-items-center rounded-xl border border-slate-200 text-sm text-slate-400">กำลังโหลดแผนที่…</div>
            ) : (
              <>
                <TrackMap
                  points={points}
                  lastPoint={lastPoint}
                  geofences={geofences.filter((g) => g.is_active)}
                  drawing={drawing}
                  drawPoints={drawPoints}
                  onMapClick={addDrawnPoint}
                />
              {drawing ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <span className="text-xs font-semibold text-amber-900">{drawPoints.length} จุด</span>
                  <input
                    aria-label="ชื่อพื้นที่หลายเหลี่ยม"
                    placeholder="ชื่อพื้นที่ เช่น บ้าน, โรงเรียน"
                    value={polyLabel}
                    onChange={(e) => setPolyLabel(e.target.value)}
                    className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                  <button
                    onClick={savePolygon}
                    disabled={drawPoints.length < 3 || !polyLabel.trim() || savingFence}
                    className="refresh-control inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    บันทึกพื้นที่ ({drawPoints.length} จุด)
                  </button>
                  <button onClick={() => setDrawPoints((p) => p.slice(0, -1))} disabled={drawPoints.length === 0} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-40">
                    เอาจุดล่าสุด
                  </button>
                  <button onClick={exitDrawing} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                    ยกเลิก
                  </button>
                </div>
              ) : null}
                <div className="mt-2 text-[11px] text-slate-400">
                  คลิกบนแผนที่แล้วเปิดโหมดวาด: กำหนดพื้นที่ที่ไม่ใช่วงกลม — 3–64 จุด
                </div>
              </>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 panel-shadow">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-bold text-slate-900"><ShieldCheck size={18} className="text-slate-500" /> พื้นที่ปลอดภัย</h2>
            <span className="text-[11px] text-slate-400">{geofences.filter((g) => g.is_active).length} วง active</span>
          </div>

          {!canManage && (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              โหมด companion — ดูได้เท่านั้น เฉพาะเจ้าของหลักที่จัดการวงได้
            </p>
          )}

          {canManage && !formOpen && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => setFormOpen(true)} className="refresh-control inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold">
                <Crosshair size={15} /> วงกลม
              </button>
              <button
                onClick={() => { drawing ? exitDrawing() : setDrawing(true); }}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold ${drawing ? 'bg-amber-600 text-white' : 'refresh-control'}`}
              >
                <Pentagon size={15} /> {drawing ? 'ยกเลิกการวาด' : 'วาดรูปหลายเหลี่ยม'}
              </button>
            </div>
          )}

          {formOpen && (
            <div className="mt-4 space-y-2.5 rounded-xl border border-slate-200 p-3.5">
              <input aria-label="ชื่อพื้นที่" placeholder="ชื่อ เช่น บ้าน, โรงเรียน" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input aria-label="ที่อยู่" placeholder="ที่อยู่ (ถ้ามี)" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <div className="flex flex-wrap gap-2">
                <button onClick={useLastKnown} className="refresh-control inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold">ใช้จุด GPS ล่าสุด</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input aria-label="ละติจูด" placeholder="lat" value={form.center_lat} onChange={(e) => setForm({ ...form, center_lat: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <input aria-label="ลองจิจูด" placeholder="lng" value={form.center_lng} onChange={(e) => setForm({ ...form, center_lng: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-500">รัศมี {form.radius_m} เมตร</label>
                <input type="range" min={20} max={3000} step={10} value={form.radius_m} onChange={(e) => setForm({ ...form, radius_m: Number(e.target.value) })} className="w-full accent-[#1e3764]" />
              </div>
              <div className="font-semibold aligned flex gap-2 pt-1">
                <button onClick={createFence} disabled={savingFence || !form.label || !form.center_lat || !form.center_lng} className="refresh-control inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-50">
                  {savingFence ? <RefreshCw size={14} className="animate-spin" /> : null} บันทึก
                </button>
                <button onClick={() => setFormOpen(false)} className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50">ยกเลิก</button>
              </div>
              <p className="text-[11px] leading-4 text-slate-400">ปุ่ม วงกลม = กรอพิกัด/รัศมี ส่วน "วาดรูปหลายเหลี่ยม" คลิกจุดบนแผนที่ทีละจุด</p>
            </div>
          )}

          <div className="mt-4 space-y-2">
            {geofences.length === 0 && !formOpen ? (
              <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">ยังไม่มีพื้นที่ปลอดภัยที่ active</p>
            ) : (
              geofences.map((f) => (
                <div key={f.id} className={`rounded-xl border px-3.5 py-3 ${f.is_active ? 'border-slate-200' : 'border-dashed border-slate-200 opacity-60'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800">{f.label}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {f.kind === 'circle' ? `วงกลม · รัศมี ${f.radius_m} m` : 'polygon'}{f.address ? ` · ${f.address}` : ''}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 items-center gap-2">
                        <label className="text-[11px] text-slate-400 flex items-center gap-1">
                          <input type="checkbox" checked={f.is_active} disabled={busy === f.id} onChange={(e) => patchFence(f.id, { is_active: e.target.checked })} className="h-4 w-4 accent-[#1e3764]" />
                          เปิด
                        </label>
                        <button aria-label="ปิดการใช้งาน" onClick={() => deleteFence(f.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 rounded-xl bg-emerald-50/60 p-3 text-[11px] leading-5 text-emerald-900">
            <span className="font-semibold">ตั้งค่าแจ้งเตือนสำหรับเขตนี้:</span> เปิด toggle "ออกนอกพื้นที่ปลอดภัย" ที่หน้า ตั้งค่า → การแจ้งเตือน ได้เลย (email ส่งผ่าน Resend อัตโนมัติเมื่อออกเขต)
          </div>
        </section>
      </div>

      <footer className="mt-7 flex flex-col gap-2 border-t border-slate-200 pt-5 text-[11px] leading-5 text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <span>GeoWrisX AD · Research prototype · R&amp;D / OCOP</span>
        <span>แผนที่และข้อมูลจาก OpenStreetMap · เฉพาะผู้ดูแลในวง</span>
      </footer>
    </div>
  );
}
