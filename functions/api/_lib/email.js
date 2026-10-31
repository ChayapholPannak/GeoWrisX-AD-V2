/**
 * Resend transactional email (https://resend.com/docs/api-reference/emails/send-email).
 * Uses plain fetch so no extra dependency is bundled into the Worker.
 */

export function isEmailConfigured(env) {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM);
}

export async function sendEmail(env, { to, subject, html, text, replyTo }) {
  if (!isEmailConfigured(env)) return { skipped: true, reason: 'not-configured' };
  if (!to) return { skipped: true, reason: 'no-recipient' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: [to],
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend ${response.status}: ${detail.slice(0, 300)}`);
  }

  const result = await response.json().catch(() => ({}));
  return { ok: true, id: result.id || null };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SEVERITY_LABEL = {
  critical: 'วิกฤต',
  warning: 'เตือน',
  info: 'ข้อมูล',
};

export function buildAlertEmail({ patientName, deviceName, message, severity, occurredAt }) {
  const patient = patientName || 'ผู้ป่วย';
  const severityLabel = SEVERITY_LABEL[severity] || 'แจ้งเตือน';
  const time = occurredAt
    ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(occurredAt))
    : '';

  const subject = `[GeoWrisX AD] ${severityLabel}: ${patient} — ${message}`;

  const html = `<!doctype html>
<html lang="th"><body style="margin:0;padding:24px;background:#eef4f4;font-family:'IBM Plex Sans',Segoe UI,sans-serif;color:#131416">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e8eaec;border-radius:12px;padding:24px">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#1b6c80">GeoWrisX AD · Caregiver Console</p>
    <h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(severityLabel)}: ${escapeHtml(patient)}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7">${escapeHtml(message)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;color:#5d5f60">
      <tr><td style="padding:6px 0">ผู้ป่วย</td><td style="padding:6px 0;text-align:right;color:#131416">${escapeHtml(patient)}</td></tr>
      <tr><td style="padding:6px 0">อุปกรณ์</td><td style="padding:6px 0;text-align:right;color:#131416">${escapeHtml(deviceName || '—')}</td></tr>
      <tr><td style="padding:6px 0">เวลา</td><td style="padding:6px 0;text-align:right;color:#131416">${escapeHtml(time)}</td></tr>
    </table>
    <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#5d5f60">เปิดแดชบอร์ดเพื่อตรวจสอบและรับทราบเหตุการณ์นี้ ข้อความนี้อาจมีข้อมูลสุขภาพที่ละเอียดอ่อน โปรดส่งต่ออย่างระมัดระวัง</p>
  </div>
  <p style="max-width:560px;margin:12px auto 0;font-size:11px;color:#7b858d;text-align:center">ต้นแบบเพื่อการศึกษา · ไม่ใช่อุปกรณ์การแพทย์ที่ผ่านการรับรอง</p>
</body></html>`;

  const text = [
    `GeoWrisX AD · ${severityLabel}`,
    `ผู้ป่วย: ${patient}`,
    `อุปกรณ์: ${deviceName || '—'}`,
    `เวลา: ${time}`,
    '',
    message,
    '',
    'เปิดแดชบอร์ดเพื่อตรวจสอบและรับทราบเหตุการณ์นี้',
  ].join('\n');

  return { subject, html, text };
}

export function buildPillboxRequestEmail({ patientName, compartmentNo, expiresAt, bleVerified }) {
  const patient = patientName || 'ผู้ป่วย';
  const time = expiresAt
    ? new Intl.DateTimeFormat('th-TH', { timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(expiresAt))
    : '';

  const subject = `[GeoWrisX AD] คำขอเปิดกล่องยา: ${patient} ช่อง ${compartmentNo}`;
  const status = bleVerified
    ? 'กล่องยืนยันระยะใกล้ผ่าน BLE แล้ว คำขอนี้รอการอนุมัติจากผู้ดูแล'
    : 'ยังไม่ได้รับการยืนยัน BLE ระบบจะไม่อนุญาตให้อนุมัติ';

  const html = `<!doctype html>
<html lang="th"><body style="margin:0;padding:24px;background:#eef4f4;font-family:'IBM Plex Sans',Segoe UI,sans-serif;color:#131416">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e8eaec;border-radius:12px;padding:24px">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#1b6c80">GeoWrisX AD · Pillbox review</p>
    <h1 style="margin:0 0 16px;font-size:20px">คำขอเปิดกล่องยา · ${escapeHtml(patient)}</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.7">ช่องที่ ${escapeHtml(compartmentNo)} — ${escapeHtml(status)}</p>
    <p style="margin:0;font-size:13px;color:#5d5f60">คำขอจะหมดอายุเวลา ${escapeHtml(time)} น. หากหมดอายุแล้วต้องให้กล่องยาส่งคำขอใหม่</p>
    <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#5d5f60">การอนุมัติจะสร้างคำสั่งที่มีอายุสั้นในคิวอุปกรณ์เท่านั้น ไม่ได้สั่งเปิดกลอนโดยตรง</p>
  </div>
</body></html>`;

  const text = `คำขอเปิดกล่องยา: ${patient} ช่อง ${compartmentNo}\n${status}\nหมดอายุ ${time} น.`;

  return { subject, html, text };
}
