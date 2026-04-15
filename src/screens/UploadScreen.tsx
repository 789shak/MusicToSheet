import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Pressable,
  Modal,
  FlatList,
  Alert,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons, Feather, MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { Audio } from 'expo-av';
import { BottomTabBar } from '../components/BottomTabBar';
import { supabase } from '../lib/supabase';
import { useSubscription } from '../hooks/useSubscription';

// ─── Types ────────────────────────────────────────────────────────────────────
type PickedFile = { name: string; uri: string; size: number | null; mimeType: string | null };

// ─── Track hash (djb2 variant) ───────────────────────────────────────────────
// Produces a stable hex string from a filename+size or URL to identify a track.
function computeTrackHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (((h << 5) + h) ^ input.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Dropdown ─────────────────────────────────────────────────────────────────
function Dropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity style={dd.trigger} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Text style={value ? dd.valueText : dd.placeholder}>{value || label}</Text>
        <Ionicons name="chevron-down" size={18} color="#6B7280" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={dd.backdrop} onPress={() => setOpen(false)}>
          <View style={dd.sheet}>
            <Text style={dd.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[dd.option, item === value && dd.optionSelected]}
                  onPress={() => { onChange(item); setOpen(false); }}
                >
                  <Text style={[dd.optionText, item === value && dd.optionTextSelected]}>{item}</Text>
                  {item === value && <Ionicons name="checkmark" size={16} color="#0EA5E9" />}
                </TouchableOpacity>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const dd = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  placeholder: { color: '#6B7280', fontSize: 15 },
  valueText: { color: '#FFFFFF', fontSize: 15 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1C1C27',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 36,
    maxHeight: '70%',
  },
  sheetTitle: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  optionSelected: { backgroundColor: '#0EA5E915' },
  optionText: { color: '#D1D5DB', fontSize: 15 },
  optionTextSelected: { color: '#FFFFFF', fontWeight: '600' },
});


// ─── Constants ────────────────────────────────────────────────────────────────
const INSTRUMENTS = [
  'Piano', 'Guitar', 'Bass', 'Violin', 'Cello',
  'Flute', 'Drums', 'Trumpet', 'Saxophone', 'Vocals', 'Full Score',
];

const OUTPUT_FORMATS = [
  'Score', 'Part', 'Lead Sheet', 'Tablature (Tabs)', 'Fake Book', 'Staff/Stave',
];

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function UploadScreen() {
  const router = useRouter();
  const { maxFileSizeMB, tier } = useSubscription();

  const [file, setFile] = useState<PickedFile | null>(null);
  const [link, setLink] = useState('');
  const [instrument, setInstrument] = useState('');
  const [outputFormat, setOutputFormat] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fakeAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const progressListenerId = useRef<string>('');
  const [showPayGate, setShowPayGate] = useState(false);
  const [payGateHash, setPayGateHash] = useState('');
  const [purchasing, setPurchasing] = useState(false);

  // ── Recording state ────────────────────────────────────────────────────────
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordingRef.current) recordingRef.current.stopAndUnloadAsync().catch(() => {});
      pulseLoop.current?.stop();
    };
  }, []);

  function startPulse() {
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.4, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 600, useNativeDriver: true }),
      ])
    );
    pulseLoop.current.start();
  }

  async function startRecording() {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Microphone permission required', 'Please enable microphone access in your device settings.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = rec;
      setRecording(rec);
      setIsRecording(true);
      setRecordSeconds(0);
      setFile(null);
      setLink('');

      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= 299) { stopRecording(); return s; }
          return s + 1;
        });
      }, 1000);

      startPulse();
    } catch (e: any) {
      Alert.alert('Could not start recording', e?.message ?? 'Unknown error');
    }
  }

  async function stopRecording() {
    try {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      pulseLoop.current?.stop();
      pulseAnim.setValue(1);

      const rec = recordingRef.current;
      if (!rec) return;
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = rec.getURI();
      recordingRef.current = null;
      setRecording(null);
      setIsRecording(false);

      if (!uri) { Alert.alert('Recording error', 'No audio was captured.'); return; }

      // Treat the recording as a picked file so the normal upload flow handles it
      const name = `recording_${Date.now()}.m4a`;
      setFile({ name, uri, size: null, mimeType: 'audio/m4a' });
      setRecordSeconds(0);
    } catch (e: any) {
      Alert.alert('Could not stop recording', e?.message ?? 'Unknown error');
    }
  }

  function formatTimer(s: number) {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  const hasInput = !!file || link.trim().length > 0;
  const canConvert = hasInput && instrument.length > 0 && !uploading;

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/*'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets?.length > 0) {
        const asset = result.assets[0];
        const fileSizeMB = (asset.size ?? 0) / (1024 * 1024);

        if (asset.size && fileSizeMB > maxFileSizeMB) {
          Alert.alert(
            'File too large',
            `Your plan allows up to ${maxFileSizeMB}MB. This file is ${fileSizeMB.toFixed(1)}MB.`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'View Plans', onPress: () => router.push('/subscription') },
            ],
          );
          return;
        }

        setFile({
          name: asset.name,
          uri: asset.uri,
          size: asset.size ?? null,
          mimeType: asset.mimeType ?? null,
        });
        setUploadError('');
      }
    } catch (e) {
      console.log('File picker error:', e);
    }
  }

  // Core upload-and-navigate logic (no gate check here).
  async function performConvert() {
    setUploadError('');

    // Link path — no upload needed
    if (!file && link.trim().length > 0) {
      console.log('[UploadScreen] navigating to rights-declaration via link', { linkUrl: link.trim(), instrument, outputFormat });
      router.push({
        pathname: '/rights-declaration',
        params: {
          filePath: '',
          fileName: '',
          sourceType: 'link',
          linkUrl: link.trim(),
          instrument,
          outputFormat,
        },
      });
      return;
    }

    // File path — upload to Supabase Storage
    if (!file) return;

    try {
      setUploading(true);
      setUploadComplete(false);
      progressAnim.setValue(0);
      setUploadProgress(0);

      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;

      const ext = file.name.split('.').pop() ?? 'audio';
      // Authenticated users get their own namespaced folder; guests use a shared
      // guest prefix so bucket policies can apply different retention rules.
      const storagePath = uid
        ? `${uid}/${Date.now()}_${file.name}`
        : `guest/${Date.now()}_${file.name}`;

      // ── Fake fast progress: 10 → 30 → 99 ──
      progressAnim.setValue(10);
      setUploadProgress(10);
      progressListenerId.current = progressAnim.addListener(({ value }) => {
        setUploadProgress(Math.round(value));
      });
      fakeAnimRef.current = Animated.sequence([
        Animated.timing(progressAnim, { toValue: 30, duration: 300, useNativeDriver: false }),
        Animated.timing(progressAnim, { toValue: 99, duration: 700, useNativeDriver: false }),
      ]);
      fakeAnimRef.current.start();

      console.log('File URI:', file.uri);
      const base64 = await readAsStringAsync(file.uri, { encoding: 'base64' });
      console.log('Base64 length:', base64.length);

      const { data, error } = await supabase.storage
        .from('audio-uploads')
        .upload(storagePath, decode(base64), {
          contentType: file.mimeType ?? `audio/${ext}`,
          upsert: true,
        });

      // ── Stop fake animation ──
      fakeAnimRef.current?.stop();
      fakeAnimRef.current = null;
      progressAnim.removeListener(progressListenerId.current);

      if (error) {
        console.log('Storage upload error:', error);
        setUploadError(error.message);
        return;
      }

      // ── Animate to 100% and show "Upload Complete!" ──
      Animated.timing(progressAnim, { toValue: 100, duration: 200, useNativeDriver: false }).start();
      setUploadProgress(100);
      setUploadComplete(true);
      await new Promise((r) => setTimeout(r, 800));

      console.log('[UploadScreen] uploaded successfully. Path:', data.path);
      router.push({
        pathname: '/rights-declaration',
        params: {
          filePath: data.path,
          fileName: file.name,
          sourceType: 'upload',
          linkUrl: '',
          instrument,
          outputFormat,
        },
      });
    } catch (e: any) {
      fakeAnimRef.current?.stop();
      fakeAnimRef.current = null;
      progressAnim.removeListener(progressListenerId.current);
      console.log('Upload exception:', e);
      setUploadError(e?.message ?? 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadComplete(false);
      progressAnim.setValue(0);
    }
  }

  async function handleConvert() {
    if (!canConvert) return;

    // Free and guest tiers get watermarked results at no charge — proceed directly.
    // The watermark is applied in ResultsScreen based on the subscription tier.
    // Pay-gate is only relevant when a paid per-track purchase is needed (i.e. the
    // user is on the free tier but explicitly wants a clean (unwatermarked) result
    // — that flow is surfaced in ResultsScreen via the download button).
    if (tier !== 'free' && tier !== 'freeGuest') {
      const hashInput = link.trim() || `${file?.name}_${file?.size ?? 0}`;
      const hash = computeTrackHash(hashInput);

      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;

      if (uid) {
        const { data: existing } = await supabase
          .from('track_purchases')
          .select('id')
          .eq('user_id', uid)
          .eq('track_hash', hash)
          .eq('used', false)
          .limit(1);

        if (!existing || existing.length === 0) {
          setPayGateHash(hash);
          setShowPayGate(true);
          return;
        }

        await supabase
          .from('track_purchases')
          .update({ used: true })
          .eq('user_id', uid)
          .eq('track_hash', hash)
          .eq('used', false);
      }
    }

    await performConvert();
  }

  // Called when the user taps "Buy this track ($1.99)" in the pay-gate modal.
  async function handleBuyTrack() {
    setPurchasing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error('Not signed in');

      // TODO: replace with real RevenueCat purchasePackage() call once
      // Apple / Google developer accounts are connected to RevenueCat.
      console.log('Pay-per-track purchase initiated');

      // Record the purchase as already-used (we proceed to convert immediately).
      await supabase.from('track_purchases').insert({
        user_id:      uid,
        track_hash:   payGateHash,
        used:         true,
      });

      setShowPayGate(false);
      await performConvert();
    } catch (e: any) {
      Alert.alert('Purchase failed', e?.message ?? 'Please try again.');
    } finally {
      setPurchasing(false);
    }
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLogo}>
          <Ionicons name="musical-note" size={20} color="#0EA5E9" />
          <Text style={styles.headerTitle}>Music-To-Sheet</Text>
        </View>
      </View>

      {/* Scrollable content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── INPUT BOX ── */}
        <View style={styles.fieldset}>
          <View style={styles.fieldsetLegendWrap}>
            <Text style={styles.fieldsetLegend}>Input</Text>
          </View>

          {/* Upload File */}
          <Text style={styles.sectionLabel}>Upload File</Text>
          {file ? (
            <View style={styles.fileSelected}>
              <Ionicons name="musical-notes-outline" size={18} color="#0EA5E9" />
              <View style={{ flex: 1 }}>
                <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                {file.size ? (
                  <Text style={styles.fileSize}>{formatBytes(file.size)}</Text>
                ) : null}
              </View>
              <TouchableOpacity onPress={() => { setFile(null); setUploadError(''); }} hitSlop={8}>
                <Ionicons name="close-circle" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.uploadArea} onPress={pickFile} activeOpacity={0.7}>
              <Feather name="upload-cloud" size={28} color="#0EA5E9" style={{ marginBottom: 8 }} />
              <Text style={styles.uploadText}>Tap to upload audio file</Text>
              <Text style={styles.uploadSubtext}>MP3, WAV, M4A, FLAC, AAC</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.fileSizeHint}>Max file size: {maxFileSizeMB}MB</Text>

          {/* Paste Link */}
          <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Paste Link</Text>
          <TextInput
            style={styles.input}
            placeholder="Paste audio link here (Direct Link Only)"
            placeholderTextColor="#6B7280"
            value={link}
            onChangeText={setLink}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.linkHint}>
            Paste a direct link to an audio file (MP3, WAV, M4A). Streaming service links (YouTube, Spotify) are not supported.
          </Text>

          {/* Record */}
          <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Record Vocals</Text>

          {/* Free tier — locked, tapping navigates to subscription */}
          {!['advancedPro', 'virtuosos'].includes(tier) && (
            <TouchableOpacity
              style={styles.recordRow}
              onPress={() => router.push('/subscription')}
              activeOpacity={0.8}
            >
              <View style={styles.recordBtn}>
                <Ionicons name="mic-outline" size={22} color="#6B7280" />
                <Text style={styles.recordText}>Record Vocals</Text>
              </View>
              <View style={styles.proLockOverlay}>
                <MaterialIcons name="lock" size={14} color="#F59E0B" />
                <Text style={styles.proLockText}>Pro feature</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* Pro/Virtuosos — recording UI */}
          {['advancedPro', 'virtuosos'].includes(tier) && (
            <>
              {isRecording ? (
                /* ── Active recording UI ── */
                <View style={styles.recordingActive}>
                  {/* Pulsing red dot */}
                  <Animated.View style={[styles.recDotOuter, { transform: [{ scale: pulseAnim }] }]}>
                    <View style={styles.recDotInner} />
                  </Animated.View>

                  {/* Timer */}
                  <Text style={styles.recTimer}>{formatTimer(recordSeconds)}</Text>
                  <Text style={styles.recHint}>Max 5:00 · tap Stop when done</Text>

                  {/* Waveform (decorative bars) */}
                  <View style={styles.waveform}>
                    {[6,12,18,10,20,14,8,16,12,18,6,14,10,20,8].map((h, i) => (
                      <View key={i} style={[styles.waveBar, { height: h }]} />
                    ))}
                  </View>

                  {/* Stop button */}
                  <TouchableOpacity style={styles.stopBtn} onPress={stopRecording} activeOpacity={0.8}>
                    <Ionicons name="stop" size={20} color="#FFFFFF" />
                    <Text style={styles.stopBtnText}>Stop</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                /* ── Idle: tap to start ── */
                <TouchableOpacity style={styles.recordBtnActive} onPress={startRecording} activeOpacity={0.8}>
                  <Ionicons name="mic" size={22} color="#FFFFFF" />
                  <Text style={styles.recordBtnActiveText}>
                    {file?.name?.startsWith('recording_') ? `Recorded: ${file.name}` : 'Tap to Record'}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* ── OUTPUT BOX ── */}
        <View style={[styles.fieldset, { marginTop: 20 }]}>
          <View style={styles.fieldsetLegendWrap}>
            <Text style={styles.fieldsetLegend}>Output</Text>
          </View>

          {/* Instrument Focus */}
          <Text style={styles.sectionLabel}>Instrument Focus</Text>
          <Dropdown
            label="Select Instrument"
            options={INSTRUMENTS}
            value={instrument}
            onChange={setInstrument}
          />

          {/* Output Format */}
          <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Output Format</Text>
          <Dropdown
            label="Output Format"
            options={OUTPUT_FORMATS}
            value={outputFormat}
            onChange={setOutputFormat}
          />
        </View>

        {/* Upload error */}
        {uploadError ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={15} color="#EF4444" style={{ marginRight: 6 }} />
            <Text style={styles.errorText}>{uploadError}</Text>
          </View>
        ) : null}

        {/* Action Button */}
        <TouchableOpacity
          style={[
            styles.convertBtn,
            !canConvert && !uploading && styles.convertBtnDisabled,
            uploading && styles.convertBtnUploading,
          ]}
          onPress={handleConvert}
          disabled={!canConvert || uploading}
          activeOpacity={0.85}
        >
          {uploading ? (
            <>
              {/* Turquoise fill that grows left → right */}
              <Animated.View
                style={[
                  styles.uploadProgressFill,
                  {
                    width: progressAnim.interpolate({
                      inputRange: [0, 100],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
              <Text style={[styles.convertBtnText, { zIndex: 1 }]}>
                {uploadComplete ? 'Upload Complete!' : `Uploading… ${uploadProgress}%`}
              </Text>
            </>
          ) : (
            <>
              <Ionicons
                name="musical-notes"
                size={18}
                color={canConvert ? '#FFFFFF' : '#4B5563'}
                style={{ marginRight: 8 }}
              />
              <Text style={[styles.convertBtnText, !canConvert && styles.convertBtnTextDisabled]}>
                Convert to Sheet Music
              </Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.legalText}>
          This tool is for personal practice. You are responsible for rights to uploaded content.
        </Text>
      </ScrollView>

      {/* Bottom Tab Bar */}
      <BottomTabBar active="upload" />

      {/* ── Pay-gate Modal ── */}
      <Modal
        visible={showPayGate}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPayGate(false)}
      >
        <Pressable style={gate.backdrop} onPress={() => !purchasing && setShowPayGate(false)}>
          <View style={gate.sheet}>
            <Ionicons name="musical-note" size={32} color="#0EA5E9" style={{ marginBottom: 12 }} />
            <Text style={gate.title}>Choose how to continue</Text>
            <Text style={gate.subtitle}>
              Your Free plan doesn't include this conversion.{'\n'}Pick an option below.
            </Text>

            {/* Buy per track */}
            <TouchableOpacity
              style={gate.btnPrimary}
              onPress={handleBuyTrack}
              activeOpacity={0.85}
              disabled={purchasing}
            >
              {purchasing
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : (
                  <>
                    <Text style={gate.btnPrimaryText}>Buy this track</Text>
                    <Text style={gate.btnPrimaryPrice}>$1.99</Text>
                  </>
                )
              }
            </TouchableOpacity>

            {/* View plans */}
            <TouchableOpacity
              style={gate.btnSecondary}
              onPress={() => { setShowPayGate(false); router.push('/subscription'); }}
              activeOpacity={0.8}
              disabled={purchasing}
            >
              <Text style={gate.btnSecondaryText}>View subscription plans</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowPayGate(false)}
              disabled={purchasing}
              style={{ marginTop: 8 }}
            >
              <Text style={gate.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111118',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 34,
    paddingBottom: 8,
    backgroundColor: '#111118',
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C27',
  },
  headerLogo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    color: '#0EA5E9',
    fontSize: 16,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 4,
  },
  headerIcon: {
    padding: 8,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
  },

  // Section labels
  sectionLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  // Fieldset container
  fieldset: {
    borderWidth: 1,
    borderColor: '#0EA5E9',
    borderRadius: 14,
    padding: 16,
    paddingTop: 22,
    position: 'relative',
  },
  fieldsetLegendWrap: {
    position: 'absolute',
    top: -10,
    left: 14,
    backgroundColor: '#111118',
    paddingHorizontal: 6,
  },
  fieldsetLegend: {
    color: '#0EA5E9',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // Upload area
  uploadArea: {
    borderWidth: 1.5,
    borderColor: '#2D2D3E',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 27,
    alignItems: 'center',
    backgroundColor: '#1C1C27',
  },
  uploadText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  uploadSubtext: {
    color: '#6B7280',
    fontSize: 12,
  },
  fileSizeHint: {
    color: '#4B5563',
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },

  // File selected
  fileSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#0EA5E940',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  fileName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  fileSize: {
    color: '#6B7280',
    fontSize: 11,
    marginTop: 2,
  },

  // Link input
  input: {
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 15,
  },
  linkHint: {
    color: '#4B5563',
    fontSize: 11,
    marginTop: 6,
    lineHeight: 16,
  },

  // Record vocals
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
    opacity: 0.5,
  },
  recordText: {
    color: '#6B7280',
    fontSize: 15,
  },
  proLockOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 12,
    backgroundColor: '#1F1A0A',
    borderWidth: 1,
    borderColor: '#F59E0B40',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  proLockText: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '600',
  },

  // Pro recording — idle button
  recordBtnActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#DC143C',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  recordBtnActiveText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },

  // Pro recording — active UI
  recordingActive: {
    backgroundColor: '#1C0A0A',
    borderWidth: 1,
    borderColor: '#DC143C40',
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 10,
  },
  recDotOuter: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#DC143C30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recDotInner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#DC143C',
  },
  recTimer: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 2,
  },
  recHint: {
    color: '#6B7280',
    fontSize: 11,
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 24,
    marginVertical: 4,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: '#DC143C80',
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#DC143C',
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 11,
    marginTop: 4,
  },
  stopBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Error box
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C0A0A',
    borderWidth: 1,
    borderColor: '#EF444440',
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
  },
  errorText: {
    flex: 1,
    color: '#EF4444',
    fontSize: 13,
    lineHeight: 18,
  },

  // Convert button
  convertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0EA5E9',
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 26,
    marginBottom: 12,
  },
  convertBtnDisabled: {
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#2D2D3E',
  },
  convertBtnUploading: {
    backgroundColor: '#111118',
    borderWidth: 1,
    borderColor: '#0EA5E9',
    overflow: 'hidden',
  },
  uploadProgressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#0EA5E9',
  },
  convertBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  convertBtnTextDisabled: {
    color: '#4B5563',
  },

  // Legal
  legalText: {
    color: '#4B5563',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    paddingHorizontal: 16,
  },
});

// ─── Pay-gate modal styles ─────────────────────────────────────────────────────
const gate = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1C1C27',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 44,
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: '#9CA3AF',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  btnPrimary: {
    width: '100%',
    backgroundColor: '#0EA5E9',
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  btnPrimaryPrice: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    opacity: 0.85,
  },
  btnSecondary: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  btnSecondaryText: {
    color: '#D1D5DB',
    fontSize: 15,
    fontWeight: '500',
  },
  cancelText: {
    color: '#6B7280',
    fontSize: 14,
    paddingVertical: 8,
  },
});
