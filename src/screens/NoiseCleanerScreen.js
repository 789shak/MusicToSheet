import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  Switch,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { decode } from 'base64-arraybuffer';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useSubscription } from '../hooks/useSubscription';

const API_URL = 'https://musictosheet.onrender.com';

function formatTimer(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

export default function NoiseCleanerScreen() {
  const router = useRouter();
  const { tier } = useSubscription();

  // File / recording state
  const [file, setFile] = useState(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordingRef = useRef(null);
  const timerRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef(null);

  // Clean state
  const [status, setStatus] = useState('idle'); // idle | uploading | cleaning | done | error
  const [errorMsg, setErrorMsg] = useState('');

  // Playback state
  const [cleanedUri, setCleanedUri] = useState(null);
  const [originalUri, setOriginalUri] = useState(null);
  const [cleanedDuration, setCleanedDuration] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [useCleanedEffect, setUseCleanedEffect] = useState(true);
  const soundRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      pulseLoop.current?.stop();
      soundRef.current?.unloadAsync().catch(() => {});
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
      setIsRecording(true);
      setRecordSeconds(0);
      setFile(null);
      setCleanedUri(null);
      setOriginalUri(null);
      setCleanedDuration('');
      setIsPlaying(false);
      setUseCleanedEffect(true);
      setStatus('idle');
      setErrorMsg('');
      await soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;

      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= 299) { stopRecording(); return s; }
          return s + 1;
        });
      }, 1000);

      startPulse();
    } catch (e) {
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
      setIsRecording(false);

      if (!uri) { Alert.alert('Recording error', 'No audio was captured.'); return; }

      const name = `recording_${Date.now()}.m4a`;
      setFile({ name, uri, size: null, mimeType: 'audio/m4a' });
      setRecordSeconds(0);
    } catch (e) {
      Alert.alert('Could not stop recording', e?.message ?? 'Unknown error');
    }
  }

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setFile({ name: asset.name, uri: asset.uri, size: asset.size ?? null, mimeType: asset.mimeType ?? null });
      setCleanedUri(null);
      setOriginalUri(null);
      setCleanedDuration('');
      setIsPlaying(false);
      setUseCleanedEffect(true);
      setStatus('idle');
      setErrorMsg('');
      await soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    } catch {
      Alert.alert('Error', 'Could not pick file.');
    }
  }

  async function cleanAudio() {
    if (!file) return;
    setStatus('uploading');
    setErrorMsg('');
    setCleanedUri(null);

    let remotePath = null;

    try {
      const ext = file.name.split('.').pop() ?? 'mp3';
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      remotePath = uid
        ? `${uid}/noise-cleaner_${Date.now()}_${file.name}`
        : `guest/noise-cleaner_${Date.now()}_${file.name}`;

      const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: 'base64' });
      const { error: uploadError } = await supabase.storage
        .from('audio-uploads')
        .upload(remotePath, decode(base64), {
          contentType: file.mimeType ?? `audio/${ext}`,
          upsert: true,
        });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      const { data: signedData, error: signedError } = await supabase.storage
        .from('audio-uploads')
        .createSignedUrl(remotePath, 3600);
      if (signedError || !signedData?.signedUrl) throw new Error('Could not create signed URL for server access.');

      setStatus('cleaning');

      const response = await fetch(`${API_URL}/clean-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_url: signedData.signedUrl, prop_decrease: 0.75 }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Server error ${response.status}: ${text}`);
      }

      const json = await response.json();
      if (!json.audio_base64) throw new Error(json.error ?? 'Server returned no audio data.');

      const fmt = json.format ?? 'mp3';
      const outPath = FileSystem.cacheDirectory + `cleaned_${Date.now()}.${fmt}`;
      await FileSystem.writeAsStringAsync(outPath, json.audio_base64, {
        encoding: 'base64',
      });

      // Get duration for preview row
      const { sound: previewSound, status: previewStatus } = await Audio.Sound.createAsync(
        { uri: outPath },
        { shouldPlay: false }
      );
      const durationMs = previewStatus.isLoaded ? (previewStatus.durationMillis ?? 0) : 0;
      await previewSound.unloadAsync();
      const totalSec = Math.round(durationMs / 1000);
      const dm = Math.floor(totalSec / 60).toString().padStart(2, '0');
      const ds = (totalSec % 60).toString().padStart(2, '0');
      setCleanedDuration(totalSec > 0 ? `${dm}:${ds}` : '');

      setOriginalUri(file.uri);
      await soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
      setIsPlaying(false);
      setUseCleanedEffect(true);
      setCleanedUri(outPath);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e?.message ?? 'Something went wrong.');
      setStatus('error');
    } finally {
      if (remotePath) {
        supabase.storage.from('audio-uploads').remove([remotePath]).catch(() => {});
      }
    }
  }

  async function togglePlayback() {
    try {
      const activeUri = useCleanedEffect ? cleanedUri : originalUri;
      if (!activeUri) return;
      if (isPlaying && soundRef.current) {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
        return;
      }
      if (!soundRef.current) {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync({ uri: activeUri });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((s) => {
          if (s.isLoaded && s.didJustFinish) setIsPlaying(false);
        });
      }
      await soundRef.current.playAsync();
      setIsPlaying(true);
    } catch (e) {
      Alert.alert('Playback error', e?.message ?? 'Could not play audio.');
    }
  }

  async function switchEffect(cleaned) {
    if (isPlaying && soundRef.current) {
      await soundRef.current.stopAsync().catch(() => {});
    }
    await soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    setIsPlaying(false);
    setUseCleanedEffect(cleaned);
  }

  async function saveAudio() {
    if (!cleanedUri) return;

    if (tier === 'free' || tier === 'freeGuest') {
      Alert.alert(
        'Premium Feature',
        'Saving cleaned audio is not included in the free tier.',
        [
          { text: 'Upgrade', style: 'default', onPress: () => router.push('/subscription') },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    try {
      const filename = `MusicToSheet_Cleaned_${Date.now()}.mp3`;
      const destination = FileSystem.documentDirectory + filename;
      await FileSystem.copyAsync({ from: cleanedUri, to: destination });
      await Sharing.shareAsync(destination, { mimeType: 'audio/mpeg', dialogTitle: 'Save Cleaned Audio' });
    } catch (e) {
      Alert.alert('Save failed', e?.message ?? 'Could not share file.');
    }
  }

  function resetAll() {
    setFile(null);
    setCleanedUri(null);
    setOriginalUri(null);
    setCleanedDuration('');
    setIsPlaying(false);
    setUseCleanedEffect(true);
    setStatus('idle');
    setErrorMsg('');
    soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
  }

  const isBusy = status === 'uploading' || status === 'cleaning';
  const hasFile = !!file;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Noise Cleaner</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Icon + intro */}
        <View style={styles.iconWrap}>
          <Ionicons name="mic-off" size={40} color="#A78BFA" />
        </View>
        <Text style={styles.title}>Clean BG Noise</Text>
        <Text style={styles.subtitle}>
          Record or upload audio, then strip out background hiss, hum, and ambient noise.
        </Text>

        {/* ── RECORD SECTION ── */}
        <Text style={styles.sectionLabel}>Tap to Record</Text>

        {isRecording ? (
          <View style={styles.recordingActive}>
            <Animated.View style={[styles.recDotOuter, { transform: [{ scale: pulseAnim }] }]}>
              <View style={styles.recDotInner} />
            </Animated.View>
            <Text style={styles.recTimer}>{formatTimer(recordSeconds)}</Text>
            <Text style={styles.recHint}>Max 5:00 · tap Stop when done</Text>
            <View style={styles.waveform}>
              {[6,12,18,10,20,14,8,16,12,18,6,14,10,20,8].map((h, i) => (
                <View key={i} style={[styles.waveBar, { height: h }]} />
              ))}
            </View>
            <TouchableOpacity style={styles.stopBtn} onPress={stopRecording} activeOpacity={0.8}>
              <Ionicons name="stop" size={20} color="#FFFFFF" />
              <Text style={styles.stopBtnText}>Stop</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.recordBtnActive}
            onPress={startRecording}
            disabled={isBusy}
            activeOpacity={0.8}
          >
            <Ionicons name="mic" size={22} color="#FFFFFF" />
            <Text style={styles.recordBtnActiveText}>
              {file?.name?.startsWith('recording_') ? `Recorded: ${file.name}` : 'Tap to Record'}
            </Text>
          </TouchableOpacity>
        )}

        {/* ── UPLOAD FILE ── */}
        <Text style={[styles.sectionLabel, { marginTop: 18 }]}>Upload File</Text>
        <TouchableOpacity
          style={styles.pickBtn}
          onPress={pickFile}
          disabled={isBusy || isRecording}
          activeOpacity={0.8}
        >
          <Ionicons name="document-attach-outline" size={18} color="#FFFFFF" />
          <Text style={styles.pickBtnText} numberOfLines={1}>
            {hasFile && !file?.name?.startsWith('recording_') ? file.name : 'Choose audio file'}
          </Text>
        </TouchableOpacity>

        {/* Status rows */}
        {status === 'uploading' && (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#0EA5E9" size="small" />
            <Text style={styles.statusText}>Uploading to server…</Text>
          </View>
        )}
        {status === 'cleaning' && (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#A78BFA" size="small" />
            <Text style={styles.statusText}>Cleaning noise… this may take a moment</Text>
          </View>
        )}
        {status === 'error' && (
          <Text style={styles.errorText}>{errorMsg}</Text>
        )}

        {/* ── CLEAN BG NOISE BUTTON ── */}
        {hasFile && status !== 'done' && !isRecording && (
          <TouchableOpacity
            style={[styles.cleanBtn, isBusy && styles.cleanBtnDisabled]}
            onPress={cleanAudio}
            disabled={isBusy}
            activeOpacity={0.8}
          >
            {isBusy ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Ionicons name="ear-outline" size={18} color="#FFFFFF" />
                <Text style={styles.cleanBtnText}>Clean BG Noise</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* ── PLAYBACK ROW (after clean) ── */}
        {status === 'done' && cleanedUri && (
          <>
            <View style={styles.cleanedPreviewRow}>
              {/* Play/Pause */}
              <TouchableOpacity onPress={togglePlayback} style={styles.playBtn} activeOpacity={0.8}>
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color="#0EA5E9" />
              </TouchableOpacity>

              {/* Label + duration */}
              <View style={{ flex: 1 }}>
                <Text style={styles.cleanedPreviewLabel}>
                  {useCleanedEffect ? 'Cleaned' : 'Original'}
                </Text>
                {cleanedDuration ? (
                  <Text style={styles.cleanedPreviewDuration}>{cleanedDuration}</Text>
                ) : null}
              </View>

              {/* Effect toggle */}
              <View style={styles.effectToggleWrap}>
                <Text style={styles.effectToggleLabel}>Effect</Text>
                <Switch
                  value={useCleanedEffect}
                  onValueChange={switchEffect}
                  trackColor={{ false: '#2D2D3E', true: '#0EA5E960' }}
                  thumbColor={useCleanedEffect ? '#0EA5E9' : '#6B7280'}
                  style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                />
              </View>

              {/* Save */}
              <TouchableOpacity onPress={saveAudio} style={styles.saveBtn} activeOpacity={0.8}>
                <Ionicons name="download-outline" size={16} color="#0EA5E9" />
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.resetBtn} onPress={resetAll}>
              <Text style={styles.resetBtnText}>Clean another file</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111118' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 52,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2D2D3E',
    gap: 8,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },

  body: {
    padding: 24,
    paddingTop: 32,
    paddingBottom: 48,
  },

  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 22,
    backgroundColor: '#A78BFA22',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    alignSelf: 'center',
  },

  title: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', marginBottom: 10, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 21, marginBottom: 28, maxWidth: 300, alignSelf: 'center' },

  sectionLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },

  // Recording — idle button
  recordBtnActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#DC143C',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    width: '100%',
  },
  recordBtnActiveText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },

  // Recording — active UI
  recordingActive: {
    backgroundColor: '#1C0A0A',
    borderWidth: 1,
    borderColor: '#DC143C40',
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 10,
    width: '100%',
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
  recHint: { color: '#6B7280', fontSize: 11 },
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
  stopBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  // Upload file button
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1C1C28',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    width: '100%',
  },
  pickBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500', flex: 1 },

  // Status
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 },
  statusText: { color: '#9CA3AF', fontSize: 14, flexShrink: 1 },
  errorText: { color: '#F87171', fontSize: 13, textAlign: 'center', marginTop: 12 },

  // Clean BG Noise button
  cleanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#A78BFA',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 20,
    width: '100%',
    justifyContent: 'center',
  },
  cleanBtnDisabled: { opacity: 0.5 },
  cleanBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  // Playback row
  cleanedPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0A1A24',
    borderWidth: 1,
    borderColor: '#0EA5E930',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 20,
    width: '100%',
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0EA5E915',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cleanedPreviewLabel: {
    color: '#D1D5DB',
    fontSize: 13,
    fontWeight: '500',
  },
  cleanedPreviewDuration: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 2,
  },
  effectToggleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  effectToggleLabel: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '500',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0EA5E915',
    borderWidth: 1,
    borderColor: '#0EA5E940',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 4,
  },
  saveBtnText: { color: '#0EA5E9', fontSize: 12, fontWeight: '600' },

  // Reset
  resetBtn: { marginTop: 16, alignSelf: 'center' },
  resetBtnText: { color: '#6B7280', fontSize: 13 },
});
