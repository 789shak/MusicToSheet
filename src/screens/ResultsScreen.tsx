import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useRef, useEffect } from 'react';
import { Ionicons, Feather, MaterialIcons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import SheetMusicViewer, { buildPdfHtml } from '../components/SheetMusicViewer';

// ─── Constants ─────────────────────────────────────────────────────────────
const FORMATS = ['Score', 'Part', 'Lead Sheet', 'Tabs', 'Fake Book', 'Staff'];

// ─── Toast ─────────────────────────────────────────────────────────────────
function useToast() {
  const [message, setMessage] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show(msg: string) {
    if (timer.current) clearTimeout(timer.current);
    setMessage(msg);
    opacity.setValue(0);
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
    timer.current = setTimeout(() => setMessage(''), 2400);
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { message, opacity, show };
}

function Toast({ message, opacity }: { message: string; opacity: Animated.Value }) {
  if (!message) return null;
  return (
    <Animated.View style={[toast.wrap, { opacity }]}>
      <Text style={toast.text}>{message}</Text>
    </Animated.View>
  );
}

const toast = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
    zIndex: 100,
  },
  text: { color: '#FFFFFF', fontSize: 13, fontWeight: '500' },
});

// ─── Main Screen ────────────────────────────────────────────────────────────
export default function ResultsScreen() {
  const router = useRouter();
  const { historyId, notesJson, durationSeconds } = useLocalSearchParams<{
    historyId?: string;
    notesJson?: string;
    durationSeconds?: string;
  }>();

  const notes: { pitch: string; start: number; duration: number }[] =
    notesJson ? JSON.parse(notesJson) : [];
  const { show: showToast, message: toastMessage, opacity: toastOpacity } = useToast();

  const [activeFormat, setActiveFormat] = useState('Score');
  const [favorited, setFavorited] = useState(false);
  const heartScale = useRef(new Animated.Value(1)).current;
  const [trackRecord, setTrackRecord] = useState<any>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    if (!historyId) return;
    console.log('[ResultsScreen] fetching record for historyId:', historyId);
    supabase
      .from('conversion_history')
      .select('*')
      .eq('id', historyId)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.log('[ResultsScreen] fetch error:', error);
        } else {
          console.log('[ResultsScreen] fetched record:', data);
          setTrackRecord(data);
        }
      });
  }, [historyId]);

  async function handleDownloadPdf() {
    setPdfLoading(true);
    try {
      const date = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      const html = buildPdfHtml(notes, {
        trackName:  trackRecord?.track_name  ?? 'Sample Track',
        instrument: trackRecord?.instrument  ?? 'Unknown',
        format:     activeFormat,
        date,
      });
      const { uri } = await Print.printToFileAsync({ html });
      console.log('[ResultsScreen] PDF saved to:', uri);
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Save or share sheet music' });
    } catch (err) {
      console.log('[ResultsScreen] PDF error:', err);
    } finally {
      setPdfLoading(false);
    }
  }

  function toggleFavorite() {
    const next = !favorited;
    setFavorited(next);
    if (next) {
      // Pop: scale up to 1.3, spring back to 1.0
      Animated.sequence([
        Animated.timing(heartScale, { toValue: 1.3, duration: 150, useNativeDriver: true }),
        Animated.spring(heartScale, { toValue: 1, useNativeDriver: true, bounciness: 10 }),
      ]).start();
    } else {
      heartScale.setValue(1);
    }
  }

  return (
    <>
      {/* Override header for this screen */}
      <Stack.Screen
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: '#111118' },
          headerTintColor: '#FFFFFF',
          headerTitle: '',
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => router.replace('/upload')}
              style={{ paddingHorizontal: 4 }}
              hitSlop={8}
            >
              <Feather name="arrow-left" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.replace('/upload')}
              style={header.newBtn}
            >
              <Ionicons name="add" size={16} color="#0EA5E9" />
              <Text style={header.newBtnText}>New</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <View style={styles.root}>
        {/* ── Track Info Card ── */}
        <View style={styles.trackCard}>
          <View style={styles.trackLeft}>
            <Ionicons name="musical-note" size={16} color="#0EA5E9" style={{ marginRight: 6 }} />
            <View>
              <Text style={styles.trackName}>{trackRecord?.track_name ?? 'Sample Track'}</Text>
              <Text style={styles.trackMeta}>
                {trackRecord?.instrument ?? 'Unknown'} · 0:{String(Number(durationSeconds ?? trackRecord?.duration_seconds ?? 30)).padStart(2, '0')}
              </Text>
            </View>
          </View>
          <View style={styles.formatBadge}>
            <Text style={styles.formatBadgeText}>{activeFormat}</Text>
          </View>
        </View>

        {/* ── Format Toggle Bar ── */}
        <View style={styles.chipRow}>
          {FORMATS.map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.formatChip, activeFormat === f && styles.formatChipActive]}
              onPress={() => setActiveFormat(f)}
              activeOpacity={0.8}
            >
              <Text style={[styles.formatChipText, activeFormat === f && styles.formatChipTextActive]}>
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Sheet Music Viewer ── */}
        <View style={styles.viewerContainer}>
          <SheetMusicViewer notes={notes} />
        </View>

        {/* ── Upgrade Banner ── */}
        <View style={styles.upgradeBanner}>
          <View style={styles.upgradeLeft}>
            <MaterialIcons name="lock-outline" size={14} color="#F59E0B" style={{ marginRight: 6 }} />
            <Text style={styles.upgradeText} numberOfLines={1}>
              Upgrade to Pro for full-length output and clean downloads
            </Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/subscription')}>
            <Text style={styles.upgradeLink}>View Plans</Text>
          </TouchableOpacity>
        </View>

        {/* ── Bottom Action Bar ── */}
        <View style={styles.actionBar}>
          {/* Share */}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => console.log('Share pressed')}
            activeOpacity={0.7}
          >
            <Feather name="share-2" size={20} color="#9CA3AF" />
            <Text style={styles.actionLabel}>Share</Text>
          </TouchableOpacity>

          {/* Download PDF */}
          {/* TODO: Re-enable tier gating for PDF after testing */}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleDownloadPdf}
            activeOpacity={0.7}
            disabled={pdfLoading}
          >
            {pdfLoading ? (
              <ActivityIndicator size="small" color="#0EA5E9" />
            ) : (
              <Feather name="download" size={20} color="#9CA3AF" />
            )}
            <Text style={styles.actionLabel}>PDF</Text>
          </TouchableOpacity>

          {/* Favorite */}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={toggleFavorite}
            activeOpacity={0.7}
          >
            <Animated.View style={{ transform: [{ scale: heartScale }] }}>
              <Ionicons
                name={favorited ? 'heart' : 'heart-outline'}
                size={20}
                color={favorited ? '#DC143C' : '#9CA3AF'}
              />
            </Animated.View>
            <Text style={[styles.actionLabel, favorited && styles.actionLabelFavorited]}>
              Favorite
            </Text>
          </TouchableOpacity>

          {/* Report */}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => showToast('Thanks — this helps us improve')}
            activeOpacity={0.7}
          >
            <Feather name="flag" size={20} color="#9CA3AF" />
            <Text style={styles.actionLabel}>Report</Text>
          </TouchableOpacity>
        </View>

        <Toast message={toastMessage} opacity={toastOpacity} />
      </View>
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const header = StyleSheet.create({
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#0EA5E9',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  newBtnText: { color: '#0EA5E9', fontSize: 13, fontWeight: '600' },
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111118',
  },

  // Track info
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A1A24',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2D2D3E',
  },
  trackLeft: { flexDirection: 'row', alignItems: 'center' },
  trackName: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  trackMeta: { color: '#6B7280', fontSize: 12, marginTop: 1 },
  formatBadge: {
    backgroundColor: '#0EA5E920',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#0EA5E940',
  },
  formatBadgeText: { color: '#0EA5E9', fontSize: 12, fontWeight: '600' },

  // Format bar
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  formatChip: {
    height: 28,
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#1C1C27',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formatChipActive: {
    backgroundColor: '#0EA5E9',
    borderColor: '#0EA5E9',
  },
  formatChipText: { color: '#6B7280', fontSize: 10, fontWeight: '500' },
  formatChipTextActive: { color: '#FFFFFF', fontWeight: '700' },

  // Viewer
  viewerContainer: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2D2D3E',
  },

  // Upgrade banner
  upgradeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A1510',
    borderTopWidth: 1,
    borderColor: '#F59E0B30',
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  upgradeLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  upgradeText: { color: '#9CA3AF', fontSize: 12, flex: 1 },
  upgradeLink: { color: '#F59E0B', fontSize: 12, fontWeight: '700' },

  // Action bar
  actionBar: {
    flexDirection: 'row',
    backgroundColor: '#16161F',
    borderTopWidth: 1,
    borderTopColor: '#2D2D3E',
    paddingVertical: 12,
    paddingBottom: 28,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  actionLabel: { color: '#6B7280', fontSize: 11, fontWeight: '500' },
  actionLabelActive: { color: '#0EA5E9' },
  actionLabelFavorited: { color: '#DC143C' },
});
