const API_URL = 'https://musictosheet.onrender.com';

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
    const response = await fetch(`${API_URL}/upload-temp`, {
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
  const timeoutId = setTimeout(() => controller.abort(), 180000);

  try {
    const response = await fetch(`${API_URL}/process`, {
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
  const timeoutId = setTimeout(() => controller.abort(), 180000);

  try {
    const response = await fetch(`${API_URL}/process-with-stems`, {
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
