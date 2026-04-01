import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

// ─── Stage config ─────────────────────────────────────────────────────────────
const STAGES = [
  'Analyzing audio',
  'Separating instruments',
  'Detecting notes',
  'Generating sheet music',
  'Formatting output',
];

// Each stage takes 2 s; after the last one finishes, we wait 0.8 s then navigate.
const STAGE_DURATION_MS = 2000;

// Estimated seconds remaining per stage index (shown before that stage starts)
const TIME_REMAINING = ['~15 seconds', '~12 seconds', '~9 seconds', '~6 seconds', '~3 seconds'];

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
      {/* Indicator */}
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

      {/* Stage label */}
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
  // Outer ring that spins
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
  // Inner fill so it doesn't look hollow
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
  const { filePath, fileName, sourceType, linkUrl, instrument, outputFormat, rightsDeclaration } =
    useLocalSearchParams<{
      filePath?: string;
      fileName?: string;
      sourceType?: string;
      linkUrl?: string;
      instrument?: string;
      outputFormat?: string;
      rightsDeclaration?: string;
    }>();

  console.log('[ProcessingScreen] received params', { filePath, fileName, sourceType, linkUrl, instrument, outputFormat, rightsDeclaration });

  const [currentStage, setCurrentStage] = useState(0); // index of active stage
  const [done, setDone] = useState(false);

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

  // ── Stage advancement ──
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    STAGES.forEach((_, i) => {
      if (i === 0) return; // stage 0 is already active on mount
      timers.push(
        setTimeout(() => setCurrentStage(i), i * STAGE_DURATION_MS)
      );
    });

    // After all stages, mark done and navigate
    timers.push(
      setTimeout(() => {
        setDone(true);
      }, STAGES.length * STAGE_DURATION_MS)
    );

    return () => timers.forEach(clearTimeout);
  }, []);

  // ── Save history + navigate when done ──
  useEffect(() => {
    if (!done) return;
    let cancelled = false;

    async function saveAndNavigate() {
      await new Promise((r) => setTimeout(r, 800));
      if (cancelled) return;

      console.log('[ProcessingScreen] saving to conversion_history');
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;

      const trackName = fileName || (linkUrl ? 'Linked Audio' : 'Untitled');

      const { data, error } = await supabase
        .from('conversion_history')
        .insert({
          user_id: uid,
          track_name: trackName,
          source_type: sourceType ?? 'upload',
          instrument: instrument ?? '',
          output_format: outputFormat ?? '',
          duration_seconds: 30,
          rights_declaration: rightsDeclaration ?? '',
        })
        .select('id')
        .single();

      if (cancelled) return;

      if (error) {
        console.log('[ProcessingScreen] conversion_history insert error:', error);
        router.replace('/results');
      } else {
        console.log('[ProcessingScreen] saved record, historyId:', data.id);
        router.replace({ pathname: '/results', params: { historyId: data.id } });
      }
    }

    saveAndNavigate();
    return () => { cancelled = true; };
  }, [done]);

  function handleCancel() {
    router.replace('/upload');
  }

  const timeLabel = done ? 'Complete!' : TIME_REMAINING[currentStage] ?? '~2 seconds';

  return (
    <View style={styles.root}>
      {/* Pulsing icon */}
      <View style={styles.iconArea}>
        <Animated.View style={[styles.glowRing, { opacity: glowAnim }]} />
        <Animated.View style={[styles.iconCircle, { transform: [{ scale: pulseAnim }] }]}>
          <Ionicons name="musical-notes" size={48} color="#FFFFFF" />
        </Animated.View>
      </View>

      {/* Title */}
      <Text style={styles.title}>Processing Your Audio</Text>
      <Text style={styles.subtitle}>Please keep the app open</Text>

      {/* Stage list */}
      <View style={styles.stageList}>
        {STAGES.map((label, i) => {
          const status =
            done || i < currentStage ? 'done'
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

      {/* Time remaining */}
      <View style={styles.timeWrap}>
        <Ionicons name="time-outline" size={14} color="#6B7280" style={{ marginRight: 5 }} />
        <Text style={styles.timeText}>
          Estimated time remaining:{' '}
          <Text style={done ? styles.timeTextDone : styles.timeTextValue}>{timeLabel}</Text>
        </Text>
      </View>

      <Text style={styles.privacyNote}>
        Audio is processed in real-time and immediately purged
      </Text>

      {/* Cancel */}
      {!done && (
        <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.75}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      )}
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
    width: 110,
    height: 110,
  },
  glowRing: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#0EA5E9',
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#0EA5E9',
    alignItems: 'center',
    justifyContent: 'center',
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

  // Time
  timeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  timeText: {
    color: '#6B7280',
    fontSize: 13,
  },
  timeTextValue: {
    color: '#D1D5DB',
    fontWeight: '600',
  },
  timeTextDone: {
    color: '#0EA5E9',
    fontWeight: '700',
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
});
