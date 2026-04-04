const API_URL = 'https://musictosheet.onrender.com';

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
