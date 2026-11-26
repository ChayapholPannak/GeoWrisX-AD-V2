function buildUrl(functionName, query) {
  const path = `/api/${functionName}`;
  if (!query) return path;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

async function parseError(response) {
  const result = await response.json().catch(() => ({}));
  const error = new Error(result.error || `คำขอไม่สำเร็จ (${response.status})`);
  error.status = response.status;
  return error;
}

/** Errors worth retrying: the DB woke from scale-to-zero, or the edge hiccuped. */
const RETRYABLE_STATUS = new Set([502, 503, 504]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with a small bounded retry for GET requests.
 * Neon suspends idle databases; the first query after a nap can answer 503
 * (our API maps that case) for a couple of seconds. Retrying quietly keeps the
 * dashboard from flashing an error the user cannot act on.
 */
async function fetchWithRetry(url, init, retries) {
  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt >= retries) {
        throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
      }
      await wait(1200 * 2 ** attempt);
      continue;
    }

    if (response.ok || attempt >= retries || !RETRYABLE_STATUS.has(response.status)) {
      return response;
    }

    const retryAfter = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter, 10) * 1000
      : 1200 * 2 ** attempt;
    await wait(delay);
  }
}

export async function apiRequest(functionName, { token, method = 'GET', body, query, retries = 0 } = {}) {
  const response = await fetchWithRetry(
    buildUrl(functionName, query),
    {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    method === 'GET' ? Math.max(0, retries) : 0,
  );

  if (!response.ok) throw await parseError(response);
  return response.json();
}

/** Upload a multipart/form-data body (patient attachments). */
export async function apiUpload(functionName, { token, formData, query } = {}) {
  const response = await fetch(buildUrl(functionName, query), {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!response.ok) throw await parseError(response);
  return response.json();
}

/** Download a binary response as a Blob, keeping the server-provided filename. */
export async function apiDownload(functionName, { token, query } = {}) {
  const response = await fetch(buildUrl(functionName, query), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) throw await parseError(response);

  const disposition = response.headers.get('content-disposition') || '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  let filename = encoded ? decodeURIComponent(encoded[1]) : '';
  if (!filename) {
    const plain = /filename="([^"]+)"/i.exec(disposition);
    filename = plain ? plain[1] : 'download';
  }

  return { blob: await response.blob(), filename };
}
