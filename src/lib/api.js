import { supabase } from './supabase';

const API_URL = 'https://musictosheet.onrender.com';

/**
 * Return a Supabase access token for the current user. Guests transparently get
 * an anonymous session the first time, which is then reused (and auto-refreshed
 * by the supabase client). Throws if a token cannot be obtained.
 * @returns {Promise<string>} a JWT access token
 */
export async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) return session.access_token;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error(`Anonymous sign-in failed: ${error.message}`);
  if (!data?.session?.access_token) throw new Error('Anonymous sign-in returned no session');
  return data.session.access_token;
}

/**
 * fetch() wrapper that attaches Authorization: Bearer <token>. On a 401 it
 * refreshes the Supabase session once and retries exactly once.
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<Response>}
 */
export async function authFetch(url, options = {}) {
  const token = await getAccessToken();
  const baseHeaders = options.headers ?? {};

  let response = await fetch(url, {
    ...options,
    headers: { ...baseHeaders, Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    const { data, error } = await supabase.auth.refreshSession();
    const refreshed = data?.session?.access_token;
    if (!error && refreshed) {
      response = await fetch(url, {
        ...options,
        headers: { ...baseHeaders, Authorization: `Bearer ${refreshed}` },
      });
    }
  }

  return response;
}

/**
 * POST /process — send an audio file as multipart/form-data.
 * Used for guest users who have no Supabase session; zero Supabase calls.
 * @param {{ fileUri: string, mimeType: string, fileName: string, instrument: string, outputFormat: string }} params
 * @returns {Promise<object>} same shape as processAudio response
 */
/**
 * Upload a local audio file to the server's /upload-temp endpoint.
 * Returns { temp_file_id } which can be passed to processAudio().
 */
export async function uploadTempFile({ fileUri, mimeType, fileName }) {
  console.log('[api] POST /upload-temp', { fileName });

  const form = new FormData();
  form.append('file', { uri: fileUri, type: mimeType ?? 'audio/mpeg', name: fileName ?? 'audio.mp3' });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s upload timeout

  try {
    // No Content-Type header: the runtime sets the multipart boundary itself.
    const response = await authFetch(`${API_URL}/upload-temp`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Server error ${response.status}: ${text}`);
    }

    const data = await response.json();
    console.log('[api] /upload-temp response:', data);
    return data; // { temp_file_id, ext }
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * @deprecated Use uploadTempFile() + processAudio({ tempFileId }) instead.
 * Kept for reference only — /process-file no longer exists on the server.
 */
export async function processAudioFile({ fileUri, mimeType, fileName, instrument, outputFormat }) {
  console.log('[api] guest two-step: upload then process', { fileName });
  const { temp_file_id } = await uploadTempFile({ fileUri, mimeType, fileName });
  return processAudio({ tempFileId: temp_file_id, instrument, outputFormat });
}

// Base URL for constructing Supabase Storage public links
export const SUPABASE_STORAGE_URL =
  'https://wlyjrotvjxemzgagpulj.supabase.co/storage/v1/object/public';

/**
 * POST /process — send an audio URL to the backend and get back note data.
 * @param {{ audioUrl: string, instrument: string, outputFormat: string }} params
 * @returns {Promise<object>} API response JSON
 */
export async function processAudio({ audioUrl, tempFileId, instrument, outputFormat }) {
  console.log('[api] POST /process', { audioUrl: audioUrl ?? '(temp file)', tempFileId, instrument, outputFormat });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000);

  try {
    const response = await authFetch(`${API_URL}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_url: audioUrl ?? null,
        temp_file_id: tempFileId ?? null,
        instrument,
        output_format: outputFormat,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Server error ${response.status}: ${text}`);
    }

    const data = await response.json();
    console.log('[api] /process response:', data);
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * POST /process-with-stems — stem-separate first, then detect pitch on the
 * relevant stem. Falls back to the caller using processAudio if this throws.
 * @param {{ audioUrl: string, instrument: string, outputFormat: string }} params
 * @returns {Promise<object>} API response JSON (includes stems_detected, stem_used)
 */
export async function processAudioWithStems({ audioUrl, instrument, outputFormat }) {
  console.log('[api] POST /process-with-stems', { audioUrl, instrument, outputFormat });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 580000);

  try {
    const response = await authFetch(`${API_URL}/process-with-stems`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_url: audioUrl, instrument, output_format: outputFormat }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Server error ${response.status}: ${text}`);
    }

    const data = await response.json();
    console.log('[api] /process-with-stems response:', data);
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * POST /process-async — submit a job and return {job_id} immediately (HTTP 202).
 * The server runs the full stems pipeline in the background; poll with pollJob().
 * @param {{ audioUrl: string, instrument: string, outputFormat: string }} params
 * @returns {Promise<{job_id: string}>}
 */
export async function processAudioAsync({ audioUrl, instrument, outputFormat }) {
  console.log('[api] POST /process-async', { audioUrl, instrument, outputFormat });

  const response = await authFetch(`${API_URL}/process-async`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_url: audioUrl, instrument, output_format: outputFormat }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server error ${response.status}: ${text}`);
  }

  const data = await response.json();
  console.log('[api] /process-async response:', data);
  return data; // { job_id }
}

/**
 * GET /jobs/{jobId} — poll for job status.
 * @param {string} jobId
 * @returns {Promise<{job_id: string, status: string, stage: string|null,
 *   progress_pct: number, result: object|null, error_detail: string|null}>}
 */
export async function pollJob(jobId) {
  const response = await authFetch(`${API_URL}/jobs/${jobId}`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server error ${response.status}: ${text}`);
  }

  return response.json();
}
