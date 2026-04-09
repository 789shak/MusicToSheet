import { supabase } from './supabase';

// ─── Limits ───────────────────────────────────────────────────────────────────

const DAILY_LIMITS = {
  free:        5,
  advancedPro: 20,
  virtuosos:   50,
  payAsYouGo:  5,
};

const TRACK_LIMITS = {
  free:        2,
  advancedPro: 6,
  virtuosos:   Infinity,
  payAsYouGo:  3,
};

const UPGRADE_HINTS = {
  free:        'Upgrade to Pro for up to 20 conversions per day.',
  advancedPro: 'Upgrade to Virtuosos for up to 50 conversions per day.',
  virtuosos:   '',
  payAsYouGo:  'Upgrade to Pro for more daily conversions.',
};

// ─── Shared hash helper ───────────────────────────────────────────────────────
// djb2 variant — keep in sync with UploadScreen.tsx
export function computeTrackHash(input) {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (((h << 5) + h) ^ input.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

// ─── a. logConversion ─────────────────────────────────────────────────────────
/**
 * Record a successful conversion in audit_log and track_processing_log.
 * Returns the total all-time count for this user (used to trigger anomaly check).
 */
export async function logConversion(userId, trackHash, trackName, instrument, sourceType) {
  const now = new Date().toISOString();

  await Promise.all([
    supabase.from('audit_log').insert({
      user_id:  userId,
      action:   'conversion',
      metadata: { trackHash, trackName, instrument, sourceType },
      created_at: now,
    }),
    supabase.from('track_processing_log').insert({
      user_id:      userId,
      track_hash:   trackHash,
      processed_at: now,
    }),
  ]);

  // Return all-time count so the caller can decide whether to run anomaly detection
  const { count } = await supabase
    .from('track_processing_log')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  return count ?? 0;
}

// ─── b. checkRateLimits ───────────────────────────────────────────────────────
/**
 * Check how many conversions this user has done in the last 24 hours.
 * @returns {{ allowed: boolean, remaining: number, message: string }}
 */
export async function checkRateLimits(userId, tier) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const maxPerDay = DAILY_LIMITS[tier] ?? DAILY_LIMITS.free;

  const { count, error } = await supabase
    .from('track_processing_log')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('processed_at', since);

  if (error) {
    // On DB error, allow through — don't block users due to our own failures
    return { allowed: true, remaining: maxPerDay, message: '' };
  }

  const used = count ?? 0;
  const remaining = Math.max(0, maxPerDay - used);
  const allowed = used < maxPerDay;

  const message = allowed
    ? ''
    : `Daily limit reached (${maxPerDay}/day on your plan). ${UPGRADE_HINTS[tier] ?? ''}`.trim();

  return { allowed, remaining, message };
}

// ─── c. checkPerTrackLimits ───────────────────────────────────────────────────
/**
 * Check how many times this user has processed this specific track.
 * @returns {{ allowed: boolean, attemptsUsed: number, maxAttempts: number }}
 */
export async function checkPerTrackLimits(userId, trackHash, tier) {
  const maxAttempts = TRACK_LIMITS[tier] ?? TRACK_LIMITS.free;

  if (maxAttempts === Infinity) {
    return { allowed: true, attemptsUsed: 0, maxAttempts: Infinity };
  }

  const { count, error } = await supabase
    .from('track_processing_log')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('track_hash', trackHash);

  if (error) {
    return { allowed: true, attemptsUsed: 0, maxAttempts };
  }

  const attemptsUsed = count ?? 0;
  const allowed = attemptsUsed < maxAttempts;

  return { allowed, attemptsUsed, maxAttempts };
}

// ─── d. detectAnomalies ───────────────────────────────────────────────────────
/**
 * Silently inspect the last 7 days of activity and flag unusual patterns.
 * Intended to be called in the background — never blocks the user flow.
 * @returns {{ flagged: boolean, reasons: string[] }}
 */
export async function detectAnomalies(userId) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const dayAgo  = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('track_processing_log')
    .select('track_hash, processed_at')
    .eq('user_id', userId)
    .gte('processed_at', weekAgo);

  if (error || !data) return { flagged: false, reasons: [] };

  const reasons = [];

  // Rule 1: more than 100 conversions in a week
  if (data.length > 100) {
    reasons.push(`${data.length} conversions in the last 7 days (limit: 100)`);
  }

  // Rule 2: more than 30 unique tracks in the last 24 hours
  const todayRows = data.filter((r) => r.processed_at >= dayAgo);
  const uniqueTracksToday = new Set(todayRows.map((r) => r.track_hash)).size;
  if (uniqueTracksToday > 30) {
    reasons.push(`${uniqueTracksToday} unique tracks processed today (limit: 30)`);
  }

  // Rule 3: same track processed more than 10 times in the week
  const trackCounts = {};
  for (const row of data) {
    trackCounts[row.track_hash] = (trackCounts[row.track_hash] ?? 0) + 1;
  }
  const highRepeat = Object.entries(trackCounts).find(([, c]) => c > 10);
  if (highRepeat) {
    reasons.push(`Single track processed ${highRepeat[1]} times this week (limit: 10)`);
  }

  const flagged = reasons.length > 0;

  if (flagged) {
    // Fire-and-forget — don't await, don't block
    supabase.from('content_risk_log').insert({
      user_id:      userId,
      risk_type:    'anomaly',
      details:      { reasons, weeklyCount: data.length, uniqueTracksToday },
      action_taken: 'flagged',
    });
  }

  return { flagged, reasons };
}
