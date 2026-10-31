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
  return new Error(result.error || `คำขอไม่สำเร็จ (${response.status})`);
}

export async function apiRequest(functionName, { token, method = 'GET', body, query } = {}) {
  const response = await fetch(buildUrl(functionName, query), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

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
