import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  Modal,
  ScrollView,
  Pressable,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Ionicons, Feather, MaterialIcons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import { useSubscription } from '../hooks/useSubscription';
import SheetMusicViewer, { buildPdfHtml } from '../components/SheetMusicViewer';

// ─── Constants ─────────────────────────────────────────────────────────────
const FORMATS = ['Score', 'Part', 'Lead Sheet', 'Tabs', 'Fake Book', 'Staff'];

// ─── Semitone helpers ───────────────────────────────────────────────────────
const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_TO_SEMI: Record<string, number> = {
  C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,
};

function shiftSemitone(pitch: string, delta: number): string {
  const m = pitch.match(/^([A-G][#b]?)([0-9])$/);
  if (!m) return pitch;
  const base = NOTE_TO_SEMI[m[1]];
  if (base === undefined) return pitch;
  const octave = parseInt(m[2], 10);
  const newMidi = octave * 12 + base + delta;
  const newOctave = Math.floor(newMidi / 12);
  const newBase = ((newMidi % 12) + 12) % 12;
  return CHROMATIC[newBase] + Math.max(0, Math.min(9, newOctave));
}

function durationLabel(seconds: number): string {
  if (seconds >= 1.5) return 'Whole';
  if (seconds >= 0.75) return 'Half';
  if (seconds >= 0.3) return 'Quarter';
  if (seconds >= 0.15) return 'Eighth';
  return '16th';
}

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

  // notes may arrive via params (fresh processing) or be loaded from output_data (history replay)
  const [notes, setNotes] = useState<{ pitch: string; start: number; duration: number }[]>(
    () => (notesJson ? JSON.parse(notesJson) : [])
  );
  const { show: showToast, message: toastMessage, opacity: toastOpacity } = useToast();

  const { tier } = useSubscription();
  // Tiers that can download clean PDFs: advancedPro, virtuosos, payAsYouGo
  const canDownloadPdf = tier !== 'free';
  // Tiers that get a watermark-free share PDF (same set)
  const isPro = canDownloadPdf;

  const [activeFormat, setActiveFormat] = useState('Score');
  const [transposeOffset, setTransposeOffset] = useState(0);
  const [bpm, setBpm] = useState(120);
  const [favorited, setFavorited] = useState(false);
  const heartScale = useRef(new Animated.Value(1)).current;
  const [trackRecord, setTrackRecord] = useState<any>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  // Transposed view — original notes are never mutated
  const displayNotes = useMemo(
    () => transposeOffset === 0
      ? notes
      : notes.map(n => ({ ...n, pitch: shiftSemitone(n.pitch, transposeOffset) })),
    [notes, transposeOffset]
  );

  // Persist transpose & BPM changes to Supabase (skip first render)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (!historyId) return;
    supabase
      .from('conversion_history')
      .update({ transpose_semitones: transposeOffset, bpm })
      .eq('id', historyId)
      .then(() => {});
  }, [transposeOffset, bpm]);

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
          if (data?.transpose_semitones != null) setTransposeOffset(data.transpose_semitones);
          if (data?.bpm != null) setBpm(data.bpm);
          // Populate notes from saved output_data when not passed via params
          if (!notesJson && data?.output_data) {
            try {
              setNotes(JSON.parse(data.output_data));
            } catch (e) {
              console.log('[ResultsScreen] failed to parse output_data:', e);
            }
          }
        }
      });
  }, [historyId]);

  function pdfMeta() {
    return {
      trackName:  trackRecord?.track_name  ?? 'Sample Track',
      instrument: trackRecord?.instrument  ?? 'Unknown',
      format:     activeFormat,
      bpm,
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      watermark:  !isPro,
    };
  }

  async function handleShare() {
    setShareLoading(true);
    try {
      const html = buildPdfHtml(displayNotes, pdfMeta());
      const { uri } = await Print.printToFileAsync({ html });
      console.log('[ResultsScreen] share PDF uri:', uri);
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share sheet music' });
    } catch (err) {
      console.log('[ResultsScreen] handleShare error:', err);
    } finally {
      setShareLoading(false);
    }
  }

  async function handleDownloadPdf() {
    if (!canDownloadPdf) {
      router.push('/subscription');
      return;
    }
    setPdfLoading(true);
    try {
      const html = buildPdfHtml(displayNotes, pdfMeta());
      const { uri } = await Print.printToFileAsync({ html });
      console.log('[ResultsScreen] PDF saved to:', uri);
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Save or share sheet music' });
    } catch (err) {
      console.log('[ResultsScreen] PDF error:', err);
    } finally {
      setPdfLoading(false);
    }
  }

  async function handleSave() {
    if (isSaved) {
      showToast('Already saved');
      return;
    }
    if (!historyId) {
      showToast('Save not available yet');
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;

    const { error } = await supabase
      .from('saved_items')
      .insert({ user_id: uid, history_id: historyId });

    if (error) {
      console.log('[ResultsScreen] save error:', error);
      showToast('Could not save — please try again');
    } else {
      setIsSaved(true);
      showToast('Saved to your library');
    }
  }

  async function saveNotes(updated: typeof notes) {
    setNotes(updated);
    if (!historyId) return;
    await supabase
      .from('conversion_history')
      .update({ output_data: JSON.stringify(updated) })
      .eq('id', historyId);
  }

  function shiftNote(index: number, delta: number) {
    const updated = notes.map((n, i) =>
      i === index ? { ...n, pitch: shiftSemitone(n.pitch, delta) } : n
    );
    saveNotes(updated);
  }

  function deleteNote(index: number) {
    saveNotes(notes.filter((_, i) => i !== index));
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

        {/* ── Format Toggle Bar + Edit Notes button ── */}
        <View style={styles.chipRowWrap}>
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
          <TouchableOpacity
            style={styles.editNotesBtn}
            onPress={() => setEditorOpen(true)}
            activeOpacity={0.75}
          >
            <Feather name="edit-2" size={13} color="#0EA5E9" />
            <Text style={styles.editNotesBtnText}>Edit</Text>
          </TouchableOpacity>
        </View>

        {/* ── Transpose & BPM Controls ── */}
        <View style={styles.controlsRow}>
          {/* Transpose */}
          <View style={styles.controlGroup}>
            <Text style={styles.controlLabel}>Transpose</Text>
            <View style={styles.controlStepper}>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => setTransposeOffset(v => Math.max(-12, v - 1))}
                hitSlop={6}
              >
                <Text style={styles.stepperBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepperValue}>
                {transposeOffset === 0 ? '0' : transposeOffset > 0 ? `+${transposeOffset}` : `${transposeOffset}`}
              </Text>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => setTransposeOffset(v => Math.min(12, v + 1))}
                hitSlop={6}
              >
                <Text style={styles.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.controlHint}>
              {transposeOffset === 0 ? 'Original Key' : `${transposeOffset > 0 ? '+' : ''}${transposeOffset} semitones`}
            </Text>
          </View>

          <View style={styles.controlDivider} />

          {/* BPM */}
          <View style={styles.controlGroup}>
            <Text style={styles.controlLabel}>BPM</Text>
            <View style={styles.controlStepper}>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => setBpm(v => Math.max(40, v - 5))}
                hitSlop={6}
              >
                <Text style={styles.stepperBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepperValue}>{bpm}</Text>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => setBpm(v => Math.min(240, v + 5))}
                hitSlop={6}
              >
                <Text style={styles.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.controlHint}>{'\u2669'} = {bpm}</Text>
          </View>
        </View>

        {/* ── Sheet Music Viewer ── */}
        <View style={styles.viewerContainer}>
          <SheetMusicViewer notes={displayNotes} bpm={bpm} />
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
            onPress={handleShare}
            activeOpacity={0.7}
            disabled={shareLoading}
          >
            {shareLoading ? (
              <ActivityIndicator size="small" color="#0EA5E9" />
            ) : (
              <Feather name="share-2" size={20} color="#9CA3AF" />
            )}
            <Text style={styles.actionLabel}>Share</Text>
          </TouchableOpacity>

          {/* Download PDF — free tier redirects to subscription */}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleDownloadPdf}
            activeOpacity={0.7}
            disabled={pdfLoading}
          >
            {pdfLoading ? (
              <ActivityIndicator size="small" color="#0EA5E9" />
            ) : (
              <View>
                <Feather name="download" size={20} color="#9CA3AF" />
                {!canDownloadPdf && (
                  <View style={styles.lockBadge}>
                    <MaterialIcons name="lock" size={8} color="#F59E0B" />
                  </View>
                )}
              </View>
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

          {/* Save to library */}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleSave}
            activeOpacity={0.7}
          >
            <Ionicons
              name={isSaved ? 'bookmark' : 'bookmark-outline'}
              size={20}
              color={isSaved ? '#0EA5E9' : '#9CA3AF'}
            />
            <Text style={[styles.actionLabel, isSaved && styles.actionLabelActive]}>Save</Text>
          </TouchableOpacity>
        </View>

        <Toast message={toastMessage} opacity={toastOpacity} />
      </View>

      {/* ── Note Editor Modal ── */}
      <Modal
        visible={editorOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEditorOpen(false)}
      >
        <View style={editor.overlay}>
          <View style={editor.sheet}>
            {/* Header */}
            <View style={editor.header}>
              <Text style={editor.title}>Edit Notes</Text>
              <Text style={editor.count}>{notes.length} note{notes.length !== 1 ? 's' : ''}</Text>
            </View>

            {/* Note list */}
            <ScrollView
              style={editor.scroll}
              contentContainerStyle={editor.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {notes.length === 0 && (
                <Text style={editor.empty}>No notes to edit.</Text>
              )}
              {notes.map((note, i) => (
                <View key={i} style={editor.noteRow}>
                  {/* Index */}
                  <Text style={editor.noteIndex}>{i + 1}</Text>

                  {/* Pitch + duration */}
                  <View style={editor.noteInfo}>
                    <Text style={editor.notePitch}>{note.pitch}</Text>
                    <Text style={editor.noteDur}>{durationLabel(note.duration ?? 0.5)}</Text>
                  </View>

                  {/* Shift down */}
                  <Pressable
                    style={editor.arrowBtn}
                    onPress={() => shiftNote(i, -1)}
                    hitSlop={6}
                  >
                    <Feather name="chevron-down" size={18} color="#FFFFFF" />
                  </Pressable>

                  {/* Shift up */}
                  <Pressable
                    style={editor.arrowBtn}
                    onPress={() => shiftNote(i, 1)}
                    hitSlop={6}
                  >
                    <Feather name="chevron-up" size={18} color="#FFFFFF" />
                  </Pressable>

                  {/* Delete */}
                  <Pressable
                    style={editor.deleteBtn}
                    onPress={() => deleteNote(i)}
                    hitSlop={6}
                  >
                    <Feather name="x" size={16} color="#EF4444" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>

            {/* Done */}
            <Pressable style={editor.doneBtn} onPress={() => setEditorOpen(false)}>
              <Text style={editor.doneBtnText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  chipRowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
  },
  chipRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  editNotesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#0EA5E940',
    backgroundColor: '#0EA5E910',
  },
  editNotesBtnText: { color: '#0EA5E9', fontSize: 11, fontWeight: '600' },
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

  // Transpose & BPM controls
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16161F',
    borderBottomWidth: 1,
    borderBottomColor: '#2D2D3E',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  controlGroup: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  controlLabel: {
    color: '#6B7280',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  controlStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0EA5E920',
    borderWidth: 1,
    borderColor: '#0EA5E940',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    color: '#0EA5E9',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
  },
  stepperValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    minWidth: 32,
    textAlign: 'center',
  },
  controlHint: {
    color: '#6B7280',
    fontSize: 10,
  },
  controlDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#2D2D3E',
    marginHorizontal: 8,
  },

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
  lockBadge: {
    position: 'absolute',
    bottom: -3,
    right: -5,
    backgroundColor: '#111118',
    borderRadius: 6,
    padding: 1,
  },
});

const editor = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000000CC',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1A1A24',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2D2D3E',
  },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  count: { color: '#6B7280', fontSize: 13 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 16, paddingVertical: 8 },
  empty: {
    color: '#6B7280',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2D2D3E',
    gap: 8,
  },
  noteIndex: {
    width: 24,
    color: '#6B7280',
    fontSize: 12,
    textAlign: 'right',
  },
  noteInfo: { flex: 1 },
  notePitch: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  noteDur: { color: '#6B7280', fontSize: 11, marginTop: 1 },
  arrowBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#2D2D3E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EF444415',
    borderWidth: 1,
    borderColor: '#EF444430',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtn: {
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: '#0EA5E9',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
