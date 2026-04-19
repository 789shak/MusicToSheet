import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Image,
  Alert,
} from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { processAudio, processAudioWithStems, uploadTempFile } from '../lib/api';
import { useSubscription } from '../hooks/useSubscription';
import {
  computeTrackHash,
  checkRateLimits,
  checkPerTrackLimits,
  logConversion,
  detectAnomalies,
} from '../lib/contentRiskEngine';

// ─── Stage config ─────────────────────────────────────────────────────────────
// Stages are driven by the real API call, not a fixed timer.
// Stages 0-3 advance on a timer; stage 4 ("Formatting output") advances when
// the API response arrives.
const STAGES = [
  'Analyzing audio',          // 0 — shown immediately
  'Separating instruments',   // 1 — shown at 2 s
  'Detecting notes',          // 2 — shown at 5 s
  'Generating sheet music',   // 3 — shown at 9 s
  'Formatting output',        // 4 — shown when API responds
];

// Show a cold-start warning if the server hasn't replied within this many ms
const SLOW_WARNING_MS = 8_000;

// Maximum time to wait for the server before showing a timeout error
// Demucs (30-60s) + Basic Pitch (10-20s) + music21 (5-10s) = up to 90s; use 180s for safety
const SERVER_TIMEOUT_MS = 180_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('__TIMEOUT__')), ms)
    ),
  ]);
}

function showErrorAlert(
  title: string,
  message: string,
  onOK: () => void,
  upgradeCallback?: () => void
) {
  const buttons: any[] = [];
  if (upgradeCallback) {
    buttons.push({ text: 'Upgrade', onPress: upgradeCallback });
  }
  buttons.push({ text: 'OK', onPress: onOK, style: upgradeCallback ? 'cancel' : 'default' });
  Alert.alert(title, message, buttons, { cancelable: false });
}

function getDurationLimitAlert(tier: string) {
  switch (tier) {
    case 'freeGuest':
      return {
        title: 'Duration Limit',
        msg: 'Your audio exceeds the 60-second free limit. Sign up free for 180 seconds, or upgrade for longer tracks.',
        upgrade: true,
      };
    case 'free':
      return {
        title: 'Duration Limit',
        msg: 'Your audio exceeds the 180-second limit. Upgrade to Pro for up to 15 minutes.',
        upgrade: true,
      };
    case 'payAsYouGo':
      return {
        title: 'Duration Limit',
        msg: 'Your audio exceeds the 600-second limit (10 minutes).',
        upgrade: false,
      };
    case 'advancedPro':
      return {
        title: 'Duration Limit',
        msg: 'Your audio exceeds the 15-minute limit. Upgrade to Virtuosos for unlimited length.',
        upgrade: true,
      };
    default:
      return { title: 'Duration Limit', msg: 'Your audio is too long for your current plan.', upgrade: true };
  }
}

function getDailyLimitAlert(tier: string) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const resetDate = tomorrow.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  switch (tier) {
    case 'free':
      return {
        title: 'Daily Limit Reached',
        msg: "You've used all 5 free sheets this month. Upgrade to Pro for 60 sheets/month.",
        upgrade: true,
      };
    case 'advancedPro':
      return {
        title: 'Daily Limit Reached',
        msg: "You've used all 60 sheets this month. Upgrade to Virtuosos for 100 sheets/month.",
        upgrade: true,
      };
    case 'virtuosos':
      return {
        title: 'Daily Limit Reached',
        msg: `You've used all 100 sheets this month. Your limit resets on ${resetDate}.`,
        upgrade: false,
      };
    case 'payAsYouGo':
      return {
        title: 'Daily Limit Reached',
        msg: "You've reached your daily limit. Try again tomorrow or upgrade to Pro.",
        upgrade: true,
      };
    default:
      return { title: 'Daily Limit Reached', msg: "You've reached your daily limit. Try again tomorrow.", upgrade: false };
  }
}

function getTrackLimitAlert(tier: string, used: number, max: number) {
  switch (tier) {
    case 'free':
      return {
        title: 'Track Limit Reached',
        msg: `You've used all ${max} attempts for this track. Try a different track or upgrade.`,
        upgrade: true,
      };
    case 'advancedPro':
      return {
        title: 'Track Limit Reached',
        msg: `You've used ${used} of ${max} attempts for this track. Upgrade to Virtuosos for more attempts.`,
        upgrade: true,
      };
    case 'payAsYouGo':
      return {
        title: 'Track Limit Reached',
        msg: `You've used all ${max} attempts for this track. Try a different track or upgrade.`,
        upgrade: true,
      };
    default:
      return {
        title: 'Track Limit Reached',
        msg: `You've used all ${max} attempts for this track. Try a different track or upgrade.`,
        upgrade: true,
      };
  }
}

// ─── Stage Row ────────────────────────────────────────────────────────────────
function StageRow({
  label,
  status,
  spinAnim,
}: {
  label: string;
  status: 'pending' | 'active' | 'done';
  spinAnim: Animated.Value;
}) {
  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={row.container}>
      <View style={row.indicatorWrap}>
        {status === 'done' && (
          <View style={row.dotDone}>
            <Ionicons name="checkmark" size={12} color="#FFFFFF" />
          </View>
        )}
        {status === 'active' && (
          <Animated.View style={[row.dotActive, { transform: [{ rotate: spin }] }]}>
            <View style={row.spinnerInner} />
          </Animated.View>
        )}
        {status === 'pending' && <View style={row.dotPending} />}
      </View>

      <Text
        style={[
          row.label,
          status === 'done' && row.labelDone,
          status === 'active' && row.labelActive,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const row = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  indicatorWrap: {
    width: 28,
    alignItems: 'center',
  },
  dotPending: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#2D2D3E',
  },
  dotDone: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#0EA5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#0EA5E9',
    borderTopColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0EA5E915',
  },
  label: {
    color: '#4B5563',
    fontSize: 15,
    marginLeft: 12,
  },
  labelDone: {
    color: '#6B7280',
    textDecorationLine: 'line-through',
  },
  labelActive: {
    color: '#0EA5E9',
    fontWeight: '600',
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ProcessingScreen() {
  const router = useRouter();
  const { filePath, fileName, fileUri, fileMime, sourceType, linkUrl, instrument, outputFormat, rightsDeclaration } =
    useLocalSearchParams<{
      filePath?: string;
      fileName?: string;
      fileUri?: string;
      fileMime?: string;
      sourceType?: string;
      linkUrl?: string;
      instrument?: string;
      outputFormat?: string;
      rightsDeclaration?: string;
    }>();

  console.log('[ProcessingScreen] received params', { filePath, fileName, fileUri, fileMime, sourceType, linkUrl, instrument, outputFormat, rightsDeclaration });

  const { tier } = useSubscription();
  // Capture tier in a ref so the one-shot useEffect closure always reads the latest value
  const tierRef = useRef(tier);
  useEffect(() => { tierRef.current = tier; }, [tier]);

  const [currentStage, setCurrentStage] = useState(0);
  const [slowWarning, setSlowWarning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pulse animation for the music note icon
  const pulseAnim = useRef(new Animated.Value(1)).current;
  // Glow opacity for the icon background
  const glowAnim = useRef(new Animated.Value(0.4)).current;
  // Shared spin value for the active stage spinner
  const spinAnim = useRef(new Animated.Value(0)).current;

  // ── Pulse + glow loop ──
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseAnim, { toValue: 1.18, duration: 800, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0.8, duration: 800, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, []);

  // ── Spinner loop ──
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 900, useNativeDriver: true, isInteraction: false })
    );
    anim.start();
    return () => anim.stop();
  }, []);

  // ── API call + stage advancement ──
  useEffect(() => {
    let cancelled = false;

    // Stage timers: advance visually while waiting for the API
    const t1 = setTimeout(() => { if (!cancelled) setCurrentStage((s) => Math.max(s, 1)); }, 2000);
    const t2 = setTimeout(() => { if (!cancelled) setCurrentStage((s) => Math.max(s, 2)); }, 5000);
    const t3 = setTimeout(() => { if (!cancelled) setCurrentStage((s) => Math.max(s, 3)); }, 9000);
    const tSlow = setTimeout(() => { if (!cancelled) setSlowWarning(true); }, SLOW_WARNING_MS);

    async function run() {
      try {
        // ── 0. Identify user + track ──────────────────────────────────────────
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;

        // Use tierRef which is kept current by useSubscription.
        const currentTier = tierRef.current;

        const trackHashInput = linkUrl?.trim() || fileName || 'unknown';
        const trackHash = computeTrackHash(trackHashInput);

        // ── 1. Rate-limit checks (before touching the server) ─────────────────
        if (uid) {
          console.log(`[ProcessingScreen] running rate-limit checks — tier: ${currentTier} | uid: ${uid} | trackHash: ${trackHash}`);

          // Guest users have no per-track limit — checkPerTrackLimits handles
          // the freeGuest exemption internally, but we skip it here for clarity.
          const checks =
            currentTier === 'freeGuest'
              ? [checkRateLimits(uid, currentTier)]
              : [checkRateLimits(uid, currentTier), checkPerTrackLimits(uid, trackHash, currentTier)];

          const [rateResult, trackResult] = await Promise.all(checks);

          if (!rateResult.allowed) {
            throw new Error(`__DAILY_LIMIT__:${currentTier}`);
          }

          if (trackResult && !trackResult.allowed) {
            throw new Error(`__TRACK_LIMIT__:${currentTier}:${trackResult.attemptsUsed ?? 0}:${trackResult.maxAttempts ?? 5}`);
          }

          console.log(`[ProcessingScreen] rate check OK — ${rateResult.remaining} conversions remaining today`);
        }

        // ── 2. Call server ────────────────────────────────────────────────────
        let result: any;

        if (fileUri) {
          // Guest local file — upload to server /upload-temp, then call /process with temp_file_id
          console.log('[ProcessingScreen] guest path — uploading to /upload-temp');
          const { temp_file_id } = await withTimeout(
            uploadTempFile({ fileUri, mimeType: fileMime ?? 'audio/mpeg', fileName: fileName ?? 'audio.mp3' }),
            60_000 // 60s for upload
          );
          console.log('[ProcessingScreen] temp_file_id:', temp_file_id);
          result = await withTimeout(processAudio({
            tempFileId: temp_file_id,
            instrument: instrument ?? '',
            outputFormat: outputFormat ?? '',
          }), SERVER_TIMEOUT_MS);
        } else {
          // Authenticated path — get signed URL from Supabase, then call server with JSON
          let audioUrl = linkUrl ?? '';
          if (sourceType !== 'link' && filePath) {
            const { data: signedData, error: signedError } = await supabase.storage
              .from('audio-uploads')
              .createSignedUrl(filePath, 3600);
            if (signedError || !signedData?.signedUrl) {
              throw new Error(`__UPLOAD_FAILED__:${signedError?.message ?? 'unknown'}`);
            }
            audioUrl = signedData.signedUrl;
          }

          console.log('[ProcessingScreen] calling processAudioWithStems with audioUrl:', audioUrl);

          try {
            result = await withTimeout(processAudioWithStems({
              audioUrl,
              instrument: instrument ?? '',
              outputFormat: outputFormat ?? '',
            }), SERVER_TIMEOUT_MS);
            console.log('[ProcessingScreen] stems detected:', result?.stems_detected, 'stem used:', result?.stem_used);
          } catch (stemsErr: any) {
            if (stemsErr?.message === '__TIMEOUT__') throw stemsErr;
            console.log('[ProcessingScreen] stem separation failed, falling back to /process:', stemsErr?.message);
            result = await withTimeout(processAudio({
              audioUrl,
              instrument: instrument ?? '',
              outputFormat: outputFormat ?? '',
            }), SERVER_TIMEOUT_MS);
          }
        }

        if (cancelled) return;

        // Advance to final stage ("Formatting output")
        setCurrentStage(4);
        setSlowWarning(false);

        await new Promise((r) => setTimeout(r, 800));
        if (cancelled) return;

        // ── 4. Save conversion history (authenticated users only) ────────────
        console.log('[ProcessingScreen] API success');

        const trackName =
          sourceType === 'link'      ? 'Pasted Link' :
          sourceType === 'recording' ? 'Voice Recording' :
          (fileName || 'Untitled');

        const resultParams = {
          notesJson:       JSON.stringify(result.notes ?? []),
          durationSeconds: String(result.duration_seconds ?? 30),
          musicxml:        result.musicxml ?? '',
        };

        // Guest users: skip DB insert, navigate with notes in params only.
        if (!uid) {
          if (!cancelled) {
            router.replace({ pathname: '/results', params: resultParams });
          }
          return;
        }

        console.log('[ProcessingScreen] saving to conversion_history');

        const { data: historyRow, error: dbError } = await supabase
          .from('conversion_history')
          .insert({
            user_id:            uid,
            track_name:         trackName,
            source_type:        sourceType ?? 'upload',
            instrument:         result.instrument ?? instrument ?? '',
            output_format:      result.format ?? outputFormat ?? '',
            duration_seconds:   result.duration_seconds ?? 30,
            output_data:        JSON.stringify(result.notes ?? []),
            rights_declaration: rightsDeclaration ?? '',
          })
          .select('id')
          .single();

        if (cancelled) return;

        // ── 5. Log conversion + maybe run anomaly detection ───────────────────
        try {
          const totalCount = await logConversion(
            uid, trackHash, trackName, instrument ?? '', sourceType ?? 'upload'
          );
          if (totalCount % 5 === 0) {
            detectAnomalies(uid).catch(() => {});
          }
        } catch (logErr) {
          console.log('[ProcessingScreen] logConversion error (non-fatal):', logErr);
        }

        // ── 6. Navigate to results ────────────────────────────────────────────
        if (dbError) {
          console.log('[ProcessingScreen] conversion_history insert error:', dbError);
          // Still pass notes so the screen isn't blank
          router.replace({ pathname: '/results', params: resultParams });
          return;
        }

        console.log('[ProcessingScreen] saved record, historyId:', historyRow.id);

        router.replace({
          pathname: '/results',
          params: { historyId: historyRow.id, ...resultParams },
        });
      } catch (e: any) {
        if (cancelled) return;
        console.log('[ProcessingScreen] error:', e);

        const msg: string = e?.message ?? '';
        const goBack    = () => router.replace('/upload');
        const goUpgrade = () => router.replace('/subscription');

        if (msg.startsWith('__DURATION_LIMIT__:')) {
          const tier = msg.replace('__DURATION_LIMIT__:', '');
          const { title, msg: body, upgrade } = getDurationLimitAlert(tier);
          showErrorAlert(title, body, goBack, upgrade ? goUpgrade : undefined);

        } else if (msg.startsWith('__DAILY_LIMIT__:')) {
          const tier = msg.replace('__DAILY_LIMIT__:', '');
          const { title, msg: body, upgrade } = getDailyLimitAlert(tier);
          showErrorAlert(title, body, goBack, upgrade ? goUpgrade : undefined);

        } else if (msg.startsWith('__TRACK_LIMIT__:')) {
          const [, tier, usedStr, maxStr] = msg.split(':');
          const { title, msg: body, upgrade } = getTrackLimitAlert(tier, Number(usedStr), Number(maxStr));
          showErrorAlert(title, body, goBack, upgrade ? goUpgrade : undefined);

        } else if (msg.startsWith('__UPLOAD_FAILED__:')) {
          showErrorAlert(
            'Upload Error',
            'Upload failed. Please check your internet connection and try again.',
            goBack
          );

        } else if (msg === '__TIMEOUT__' || e?.name === 'AbortError' || msg.toLowerCase().includes('aborted')) {
          showErrorAlert(
            'Server Timeout',
            'Processing is taking longer than expected (over 3 minutes). Please try again.',
            goBack
          );

        } else if (/Server error 5\d\d/.test(msg)) {
          showErrorAlert(
            'Server Error',
            'Our server encountered an error. Please try again in a moment.',
            goBack
          );

        } else if (/Server error 4\d\d/.test(msg) && sourceType === 'link') {
          showErrorAlert(
            'Invalid Link',
            'Invalid audio link. Please paste a direct link to an MP3 or WAV file. Streaming service links (YouTube, Spotify, SoundCloud) are not supported.',
            goBack
          );

        } else {
          showErrorAlert(
            'Processing Error',
            msg || 'Something went wrong. Please try again.',
            goBack
          );
          setError(msg || 'Something went wrong. Please try again.');
        }
      } finally {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
        clearTimeout(tSlow);
      }
    }

    run();
    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(tSlow);
    };
  }, []);

  function handleCancel() {
    router.replace('/upload');
  }

  function handleTryAgain() {
    // Re-mount by navigating back then forward would require stack manipulation;
    // simplest is to go back to upload so the user can resubmit.
    router.replace('/upload');
  }

  // ── Error state ──
  if (error) {
    return (
      <View style={styles.root}>
        <Ionicons name="alert-circle-outline" size={52} color="#EF4444" style={{ marginBottom: 20 }} />
        <Text style={styles.title}>Conversion Error</Text>
        <Text style={styles.errorMessage}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={handleTryAgain} activeOpacity={0.8}>
          <Text style={styles.retryBtnText}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleCancel} style={{ marginTop: 16 }}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Pulsing app icon */}
      <View style={styles.iconArea}>
        <Animated.View style={[styles.glowRing, { opacity: glowAnim }]} />
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.appIcon}
            resizeMode="cover"
            onError={(e) => console.log('[ProcessingScreen] icon load error:', e.nativeEvent.error)}
          />
        </Animated.View>
      </View>

      {/* Title */}
      <Text style={styles.title}>Processing Your Audio</Text>
      <Text style={styles.subtitle}>Please keep the app open</Text>

      {/* Stage list */}
      <View style={styles.stageList}>
        {STAGES.map((label, i) => {
          const status =
            i < currentStage ? 'done'
            : i === currentStage ? 'active'
            : 'pending';
          return (
            <StageRow
              key={label}
              label={label}
              status={status}
              spinAnim={spinAnim}
            />
          );
        })}
      </View>

      {/* Cold-start warning */}
      {slowWarning && (
        <View style={styles.slowWrap}>
          <Ionicons name="information-circle-outline" size={13} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={styles.slowText}>Your file is being processed, this may take up to 30-60 seconds</Text>
        </View>
      )}

      <Text style={styles.privacyNote}>
        Audio is processed in real-time and immediately purged
      </Text>

      <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.75}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111118',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },

  // Pulsing icon
  iconArea: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
    width: 140,
    height: 140,
  },
  glowRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#0EA5E9',
  },
  appIcon: {
    width: 120,
    height: 120,
    borderRadius: 24,
  },

  // Title
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    color: '#6B7280',
    fontSize: 13,
    marginBottom: 36,
    textAlign: 'center',
  },

  // Stages
  stageList: {
    width: '100%',
    marginBottom: 28,
  },

  // Cold-start warning
  slowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1305',
    borderWidth: 1,
    borderColor: '#F59E0B40',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginBottom: 20,
  },
  slowText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },

  // Privacy note
  privacyNote: {
    color: '#374151',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 48,
  },

  // Cancel
  cancelBtn: {
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 40,
  },
  cancelText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
  },

  // Error state
  errorMessage: {
    color: '#9CA3AF',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
    marginTop: 8,
  },
  retryBtn: {
    backgroundColor: '#0EA5E9',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 40,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
