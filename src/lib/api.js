const API_URL = 'https://musictosheet.onrender.com';

/**
 * POST /process — send an audio file as multipart/form-data.
 * Used for guest users who have no Supabase session; zero Supabase calls.
 * @param {{ fileUri: string, mimeType: string, fileName: string, instrument: string, outputFormat: string }} params
 * @returns {Promise<object>} same shape as processAudio response
 */
export async function processAudioFile({ fileUri, mimeType, fileName, instrument, outputFormat }) {
  console.log('[api] POST /process (multipart)', { fileName, instrument, outputFormat });

  const form = new FormData();
  form.append('file', { uri: fileUri, type: mimeType ?? 'audio/mpeg', name: fileName ?? 'audio.mp3' });
  form.append('instrument', instrument ?? '');
  form.append('output_format', outputFormat ?? '');

  const response = await fetch(`${API_URL}/process`, {
    method: 'POST',
    body: form,
    // Do NOT set Content-Type header — fetch sets it automatically with the correct boundary
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server error ${response.status}: ${text}`);
  }

  const data = await response.json();
  console.log('[api] /process (multipart) response:', data);
  return data;
}

// Base URL for constructing Supabase Storage public links
export const SUPABASE_STORAGE_URL =
  'https://wlyjrotvjxemzgagpulj.supabase.co/storage/v1/object/public';

/**
 * POST /process — send an audio URL to the backend and get back note data.
 * @param {{ audioUrl: string, instrument: string, outputFormat: string }} params
 * @returns {Promise<object>} API response JSON
 */
export async function processAudio({ audioUrl, instrument, outputFormat }) {
  console.log('[api] POST /process', { audioUrl, instrument, outputFormat });

  const response = await fetch(`${API_URL}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: audioUrl,
      instrument,
      output_format: outputFormat,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server error ${response.status}: ${text}`);
  }

  const data = await response.json();
  console.log('[api] /process response:', data);
  return data;
}

/**
 * POST /process-with-stems — stem-separate first, then detect pitch on the
 * relevant stem. Falls back to the caller using processAudio if this throws.
 * @param {{ audioUrl: string, instrument: string, outputFormat: string }} params
 * @returns {Promise<object>} API response JSON (includes stems_detected, stem_used)
 */
export async function processAudioWithStems({ audioUrl, instrument, outputFormat }) {
  console.log('[api] POST /process-with-stems', { audioUrl, instrument, outputFormat });

  const response = await fetch(`${API_URL}/process-with-stems`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: audioUrl,
      instrument,
      output_format: outputFormat,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server error ${response.status}: ${text}`);
  }

  const data = await response.json();
  console.log('[api] /process-with-stems response:', data);
  return data;
}
