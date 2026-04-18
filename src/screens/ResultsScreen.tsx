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
  Alert,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Ionicons, Feather, MaterialIcons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import { useSubscription } from '../hooks/useSubscription';
import { useAuth } from '../hooks/useAuth';
import SheetMusicViewer, { buildStaticPdfHtml, buildScreenHtml } from '../components/SheetMusicViewer';

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

function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
  const { historyId, notesJson, durationSeconds, musicxml } = useLocalSearchParams<{
    historyId?: string;
    notesJson?: string;
    durationSeconds?: string;
    musicxml?: string;
  }>();

  // notes may arrive via params (fresh processing) or be loaded from output_data (history replay)
  const [notes, setNotes] = useState<{ pitch: string; start: number; duration: number }[]>(
    () => (notesJson ? JSON.parse(notesJson) : [])
  );
  const { show: showToast, message: toastMessage, opacity: toastOpacity } = useToast();

  const { tier, canTranspose: rawCanTranspose, canBPM: rawCanBPM, canEdit: rawCanEdit } = useSubscription();
  // Derive guest status from the Supabase session, not from the in-memory isGuest flag.
  // The explicit isGuest flag is only set when the user taps "Continue as Guest" on the
  // login screen, so it is unreliable for users who reach Results via other paths
  // (history replay, hot-reload, deep link, etc.). session is authoritative: if it is
  // null after auth has loaded, the user is definitively unauthenticated.
  const { session, loading: authLoading } = useAuth();
  // While auth is still resolving treat as authenticated so authed users don't see a
  // flash of locked content. Once resolved, no session → guest.
  const isGuest = !authLoading && !session;
  // TODO: REMOVE BEFORE PRODUCTION — test user bypass
  const isTestUser = session?.user?.email === 'gyuhfsaaer@gmail.com';
  // Paid tiers get watermark-free PDFs and no page locks
  const isPro = isTestUser || (tier !== 'free' && tier !== 'freeGuest');
  // Guest users see only the first GUEST_PAGE_LIMIT pages clearly; authenticated see all
  const GUEST_PAGE_LIMIT = 2;
  const lockedFromPage = isGuest && !isTestUser ? GUEST_PAGE_LIMIT : null;
  const canTranspose = isTestUser || rawCanTranspose;
  const canBPM = isTestUser || rawCanBPM;
  const canEdit = isTestUser || rawCanEdit;

  const [activeFormat, setActiveFormat] = useState('Score');
  const [transposeOffset, setTransposeOffset] = useState(0);
  const [bpm, setBpm] = useState(120);
  const [playbackState, setPlaybackState] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const webviewRef = useRef<any>(null);
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

  // Build SVG-based preview. Guest users see pages 1-2 clearly; pages 3+ are
  // CSS-blurred in the WebView with an inline upgrade overlay. Authenticated
  // users (free or paid) see all pages clearly.
  const previewHtml = useMemo(
    () => {
      const PER_PAGE   = 48; // 6 rows × 8 notes per row
      const totalPages = Math.max(1, Math.ceil(displayNotes.length / PER_PAGE));
      console.log('[ResultsScreen] User tier:', { isGuest, tier, isPro, authLoading, hasSession: !!session });
      console.log('[ResultsScreen] Total notes:', displayNotes.length, '→ ~', totalPages, 'page(s)');
      console.log('[ResultsScreen] lockedFromPage:', lockedFromPage,
        lockedFromPage !== null
          ? `→ pages ${lockedFromPage + 1}+ will be CSS-blurred`
          : '→ no blur (authenticated)');
      const metaUsername = isGuest
        ? null
        : (session?.user?.user_metadata?.full_name || session?.user?.email || null);
      const metaDurSecs  = Number(durationSeconds ?? trackRecord?.duration_seconds ?? 0);
      const metaDuration = metaDurSecs > 0
        ? `${Math.floor(metaDurSecs / 60)}:${String(Math.floor(metaDurSecs % 60)).padStart(2, '0')}`
        : null;
      const metaDateTime = trackRecord?.created_at
        ? new Date(trackRecord.created_at).toLocaleString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true,
          })
        : null;

      return buildScreenHtml(displayNotes, {
        trackName:  trackRecord?.track_name ?? 'Sample Track',
        instrument: trackRecord?.instrument ?? 'Unknown',
        format:     activeFormat,
        bpm,
        watermark:  !isPro,
        lockedFromPage,
        username:   metaUsername,
        fileName:   trackRecord?.file_name ?? trackRecord?.track_name ?? null,
        duration:   metaDuration,
        dateTime:   metaDateTime,
      });
    },
    [displayNotes, trackRecord, activeFormat, bpm, isPro, lockedFromPage, session, isGuest, durationSeconds]
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

  // Stop playback when transpose or BPM changes
  useEffect(() => {
    setPlaybackState('idle');
    setCurrentTime(0);
    webviewRef.current?.injectJavaScript(`handlePlaybackCommand({type:'stop'}); true;`);
  }, [transposeOffset, bpm]);

  function handlePlay() {
    if (playbackState === 'paused') {
      webviewRef.current?.injectJavaScript(`handlePlaybackCommand({type:'resume'}); true;`);
      setPlaybackState('playing');
    } else {
      webviewRef.current?.injectJavaScript(`handlePlaybackCommand({type:'play'}); true;`);
      setPlaybackState('playing');
      setCurrentTime(0);
    }
  }

  function handlePause() {
    webviewRef.current?.injectJavaScript(`handlePlaybackCommand({type:'pause'}); true;`);
    setPlaybackState('paused');
  }

  function handleStop() {
    webviewRef.current?.injectJavaScript(`handlePlaybackCommand({type:'stop'}); true;`);
    setPlaybackState('idle');
    setCurrentTime(0);
  }

  function handleWebViewMessage(event: any) {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'progress') {
        setCurrentTime(msg.currentTime ?? 0);
        if (msg.totalTime) setTotalTime(msg.totalTime);
      } else if (msg.type === 'totalTime') {
        setTotalTime(msg.totalTime ?? 0);
      } else if (msg.type === 'ended') {
        setPlaybackState('idle');
        setCurrentTime(0);
      } else if (msg.type === 'paused') {
        setPlaybackState('paused');
      } else if (msg.type === 'stopped') {
        setPlaybackState('idle');
        setCurrentTime(0);
      } else if (msg.type === 'nav') {
        // Upgrade overlay buttons inside the WebView post navigation requests
        if (msg.route === '/') {
          router.replace('/');
        } else if (msg.route) {
          router.push(msg.route);
        }
      }
    } catch (e) {}
  }

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
    const pdfUsername = isGuest
      ? null
      : (session?.user?.user_metadata?.full_name || session?.user?.email || null);
    const pdfDurSecs = Number(durationSeconds ?? trackRecord?.duration_seconds ?? 0);
    const pdfDur     = pdfDurSecs > 0
      ? `${Math.floor(pdfDurSecs / 60)}:${String(Math.floor(pdfDurSecs % 60)).padStart(2, '0')}`
      : null;
    const pdfDateTime = trackRecord?.created_at
      ? new Date(trackRecord.created_at).toLocaleString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: true,
        })
      : null;
    return {
      trackName:  trackRecord?.track_name  ?? 'Sample Track',
      instrument: trackRecord?.instrument  ?? 'Unknown',
      format:     activeFormat,
      bpm,
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      watermark:  !isPro,
      // Guest exports are capped at 2 pages; authenticated users get all pages
      maxPages:   isGuest ? GUEST_PAGE_LIMIT : undefined,
      username:   pdfUsername,
      fileName:   trackRecord?.file_name ?? trackRecord?.track_name ?? null,
      duration:   pdfDur,
      dateTime:   pdfDateTime,
    };
  }

  async function generatePdf(notes: typeof displayNotes): Promise<string> {
    const trimmedNotes = notes.length > 200 ? notes.slice(0, 200) : notes;
    const html = buildStaticPdfHtml(trimmedNotes, pdfMeta());

    console.log('PDF SHARE: Starting PDF generation');
    console.log('STATIC PDF notes count:', trimmedNotes.length);
    console.log('STATIC PDF HTML size:', html.length, 'chars');

    const pdfPromise = Print.printToFileAsync({ html });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PDF timeout')), 10000)
    );

    let uri: string;
    try {
      const result = await Promise.race([pdfPromise, timeoutPromise]);
      uri = result.uri;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown error';
      console.log('PDF SHARE: Failed -', msg);
      Alert.alert('Export Failed', 'PDF generation took too long. Try again.');
      throw e;
    }

    return uri;
  }

  async function handleShare() {
    setShareLoading(true);
    if (isGuest) {
      showToast(`Sharing first ${GUEST_PAGE_LIMIT} pages — sign up to share all pages`);
    }
    try {
      const uri = await generatePdf(displayNotes);
      console.log('[ResultsScreen] share PDF uri:', uri);
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share sheet music' });
    } catch {
      // error already logged and alerted inside generatePdf
    } finally {
      setShareLoading(false);
    }
  }

  async function handleDownloadPdf() {
    setPdfLoading(true);
    try {
      const uri = await generatePdf(displayNotes);
      console.log('[ResultsScreen] PDF saved to:', uri);
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Save or share sheet music' });
    } catch {
      // error already logged and alerted inside generatePdf
    } finally {
      setPdfLoading(false);
    }
  }

  async function handleSave() {
    if (isGuest) {
      showToast('Sign up free to save your results');
      return;
    }
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
    if (isGuest) {
      showToast('Sign up free to favorite tracks');
      return;
    }
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

        {/* ── Format Toggle Bar (full-width, evenly distributed) ── */}
        <View style={styles.chipScrollOuter}>
          <View style={styles.chipScrollContent}>
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
        </View>

        {/* ── Edit Notes button row (left-aligned, below chips) ── */}
        <View style={styles.editRow}>
          <TouchableOpacity
            style={styles.editNotesBtn}
            onPress={() => {
              if (!canEdit) {
                showToast('Upgrade to edit notes');
                router.push('/subscription');
                return;
              }
              setEditorOpen(true);
            }}
            activeOpacity={0.75}
          >
            <Feather name="edit-2" size={13} color={canEdit ? '#0EA5E9' : '#6B7280'} />
            <Text style={[styles.editNotesBtnText, !canEdit && { color: '#6B7280' }]}>Edit Notes</Text>
            {!canEdit && <MaterialIcons name="lock" size={11} color="#F59E0B" style={{ marginLeft: 2 }} />}
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
            {!canTranspose && (
              <TouchableOpacity
                style={styles.controlLockOverlay}
                onPress={() => { showToast('Upgrade to unlock Transpose'); router.push('/subscription'); }}
                activeOpacity={0.7}
              >
                <MaterialIcons name="lock" size={16} color="#F59E0B" />
              </TouchableOpacity>
            )}
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
            {!canBPM && (
              <TouchableOpacity
                style={styles.controlLockOverlay}
                onPress={() => { showToast('Upgrade to unlock BPM control'); router.push('/subscription'); }}
                activeOpacity={0.7}
              >
                <MaterialIcons name="lock" size={16} color="#F59E0B" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Playback Controls ── */}
        <View style={styles.playbackRow}>
          <TouchableOpacity style={styles.stopBtn} onPress={handleStop} activeOpacity={0.7}>
            <Ionicons name="stop" size={16} color="#9CA3AF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.playPauseBtn}
            onPress={playbackState === 'playing' ? handlePause : handlePlay}
            activeOpacity={0.7}
          >
            <Ionicons
              name={playbackState === 'playing' ? 'pause' : 'play'}
              size={20}
              color="#FFFFFF"
            />
          </TouchableOpacity>
          <View style={styles.progressArea}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${totalTime > 0 ? Math.min((currentTime / totalTime) * 100, 100) : 0}%` },
                ]}
              />
            </View>
            <Text style={styles.progressTime}>
              {formatTime(currentTime)} / {formatTime(totalTime)}
            </Text>
          </View>
        </View>

        {/* ── Sheet Music Viewer ── */}
        {/* Guest users see pages 1-2 clearly; pages 3+ are blurred inside the
            WebView with an inline upgrade overlay rendered by buildScreenHtml. */}
        <View style={styles.viewerWrapper}>
          <View style={styles.viewerContainer}>
            <SheetMusicViewer ref={webviewRef} musicxml={musicxml ?? null} previewHtml={previewHtml} notes={displayNotes} bpm={bpm} onMessage={handleWebViewMessage} />
          </View>
        </View>

        {/* ── Contextual Banner (guest sign-up nudge only) ── */}
        {tier === 'freeGuest' ? (
          <View style={[styles.upgradeBanner, styles.guestBanner]}>
            <View style={styles.upgradeLeft}>
              <Ionicons name="person-add-outline" size={14} color="#0EA5E9" style={{ marginRight: 6 }} />
              <Text style={styles.guestBannerText} numberOfLines={2}>
                Sign up free — unlock all pages &amp; save your results
              </Text>
            </View>
            <TouchableOpacity onPress={() => router.replace('/')}>
              <Text style={styles.guestBannerLink}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        ) : null}

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

          {/* Download PDF */}
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

      {/* ── PDF Generation Overlay ── */}
      {(shareLoading || pdfLoading) && (
        <View style={styles.pdfOverlay}>
          <View style={styles.pdfOverlayBox}>
            <ActivityIndicator size="large" color="#0EA5E9" />
            <Text style={styles.pdfOverlayText}>Generating PDF…</Text>
          </View>
        </View>
      )}

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

  // Format bar (full-width flex row)
  chipScrollOuter: {
    borderBottomWidth: 1,
    borderBottomColor: '#2D2D3E',
  },
  chipScrollContent: {
    flexDirection: 'row',
    paddingHorizontal: 0,
    paddingVertical: 2,
    gap: 2,
    alignItems: 'stretch',
  },
  // Edit row (below chips, left-aligned) — compact
  editRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#2D2D3E',
  },
  editNotesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#0EA5E940',
    backgroundColor: '#0EA5E910',
  },
  editNotesBtnText: { color: '#0EA5E9', fontSize: 11, fontWeight: '600' },
  formatChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 6,
    paddingHorizontal: 2,
    paddingVertical: 0,
    backgroundColor: '#1C1C27',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 22,
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
    position: 'relative',
  },
  controlLockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(17, 17, 24, 0.85)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
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

  // Playback row
  playbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16161F',
    borderBottomWidth: 1,
    borderBottomColor: '#2D2D3E',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  stopBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2D2D3E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPauseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0EA5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressArea: {
    flex: 1,
    gap: 4,
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#2D2D3E',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#0EA5E9',
    borderRadius: 2,
  },
  progressTime: {
    color: '#6B7280',
    fontSize: 10,
    fontWeight: '500',
  },

  // Viewer
  viewerWrapper: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2D2D3E',
  },
  viewerContainer: {
    flex: 1,
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
  guestBanner: { borderTopColor: '#0EA5E920', backgroundColor: '#0EA5E908' },
  guestBannerText: { color: '#9CA3AF', fontSize: 12, flex: 1 },
  guestBannerLink: { color: '#0EA5E9', fontSize: 12, fontWeight: '700' },

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
  pdfOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  pdfOverlayBox: {
    backgroundColor: '#1C1C2E',
    borderRadius: 14,
    paddingVertical: 28,
    paddingHorizontal: 36,
    alignItems: 'center',
    gap: 14,
  },
  pdfOverlayText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
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
