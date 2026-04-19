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
  Image,
  Switch,
} from 'react-native';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons, Feather, MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { decode } from 'base64-arraybuffer';
import { Audio } from 'expo-av';
import { WebView } from 'react-native-webview';
import { BottomTabBar } from '../components/BottomTabBar';
import { supabase } from '../lib/supabase';
import { useSubscription } from '../hooks/useSubscription';
import { useAuth } from '../hooks/useAuth';

// ─── Types ────────────────────────────────────────────────────────────────────
type PickedFile = { name: string; uri: string; size: number | null; mimeType: string | null };

// ─── Metronome Web Audio engine (hidden WebView) ──────────────────────────────
const METRONOME_HTML = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}html,body{width:100%;height:100%;background:transparent;overflow:hidden}</style></head><body><script>
'use strict';
var audioCtx=null,isPlaying=false,nextNoteTime=0,beatCount=0;
var bpm=120,beatsPerMeasure=4,volume=0.8;
var LOOKAHEAD_MS=25,SCHEDULE_AHEAD_SEC=0.1,schedulerTimer=null;
function getCtx(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();return audioCtx;}
function scheduleClick(bi,time){
  var ctx=getCtx(),isDown=(bi%beatsPerMeasure)===0;
  var osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.type='sine';osc.frequency.value=isDown?1500:1000;
  gain.gain.setValueAtTime(volume,time);
  gain.gain.exponentialRampToValueAtTime(0.0001,time+0.04);
  osc.connect(gain);gain.connect(ctx.destination);
  osc.start(time);osc.stop(time+0.04);
}
function scheduler(){
  if(!isPlaying)return;
  var ctx=getCtx(),interval=60.0/bpm;
  while(nextNoteTime<ctx.currentTime+SCHEDULE_AHEAD_SEC){scheduleClick(beatCount,nextNoteTime);nextNoteTime+=interval;beatCount+=1;}
  schedulerTimer=setTimeout(scheduler,LOOKAHEAD_MS);
}
function startM(p){
  if(p.bpm)bpm=p.bpm;
  if(p.timeSignature)beatsPerMeasure=parseInt((p.timeSignature||'4/4').split('/')[0],10)||4;
  if(p.volume!=null)volume=p.volume;
  isPlaying=true;beatCount=0;
  var ctx=getCtx();nextNoteTime=ctx.currentTime+0.05;
  if(ctx.state==='suspended'){ctx.resume().then(function(){scheduler();});}else{scheduler();}
}
function stopM(){isPlaying=false;if(schedulerTimer!==null){clearTimeout(schedulerTimer);schedulerTimer=null;}beatCount=0;}
function handleMsg(e){var m;try{m=JSON.parse(e.data);}catch(x){return;}if(!m||!m.type)return;if(m.type==='start')startM(m);else if(m.type==='stop')stopM();else if(m.type==='setBpm'){bpm=m.bpm;}}
document.addEventListener('message',handleMsg);window.addEventListener('message',handleMsg);
<\/script></body></html>`;

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
    paddingVertical: 9,
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
  const { isGuest } = useAuth();

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

  // ── Noise cleaning state ───────────────────────────────────────────────────
  const [cleaningNoise, setCleaningNoise] = useState(false);
  const [cleanedFileUri, setCleanedFileUri] = useState<string | null>(null);
  const [originalRecordingUri, setOriginalRecordingUri] = useState<string | null>(null);
  const [cleanedDuration, setCleanedDuration] = useState('');
  const [isPlayingCleaned, setIsPlayingCleaned] = useState(false);
  const [useCleanedEffect, setUseCleanedEffect] = useState(true);
  const cleanedSoundRef = useRef<Audio.Sound | null>(null);

  // ── Metronome state ────────────────────────────────────────────────────────
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [metronomeBpm, setMetronomeBpm] = useState(120);
  const [metronomeInfoShown, setMetronomeInfoShown] = useState(false);
  const metronomeRef = useRef<WebView | null>(null);

  function postToMetronome(msg: object) {
    metronomeRef.current?.postMessage(JSON.stringify(msg));
  }

  function handleMetronomeToggle() {
    if (!metronomeOn && !metronomeInfoShown) {
      Alert.alert(
        'Metronome Recording',
        'Turning ON the Metronome while recording will not record the sound of Metronome. Only your vocals/sounds will be recorded.',
        [{ text: 'Got it', onPress: () => { setMetronomeInfoShown(true); setMetronomeOn(true); } }]
      );
    } else {
      setMetronomeOn(v => !v);
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordingRef.current) recordingRef.current.stopAndUnloadAsync().catch(() => {});
      pulseLoop.current?.stop();
      cleanedSoundRef.current?.unloadAsync().catch(() => {});
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

  async function cleanNoise() {
    // Use the current file/recording if one exists, otherwise open the picker
    let source: PickedFile | null = file;

    if (!source) {
      const result = await DocumentPicker.getDocumentAsync({ type: ['audio/*'], copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets[0];
      source = { name: asset.name, uri: asset.uri, size: asset.size ?? null, mimeType: asset.mimeType ?? null };
    }

    let remotePath: string | null = null;
    try {
      setCleaningNoise(true);

      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      const ext = source.name.split('.').pop() ?? 'mp3';
      remotePath = uid
        ? `${uid}/noise-cleaner_${Date.now()}_${source.name}`
        : `guest/noise-cleaner_${Date.now()}_${source.name}`;

      const base64 = await FileSystem.readAsStringAsync(source.uri, { encoding: 'base64' });
      const { error: uploadError } = await supabase.storage
        .from('audio-uploads')
        .upload(remotePath, decode(base64), { contentType: source.mimeType ?? `audio/${ext}`, upsert: true });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      const { data: signedData, error: signedError } = await supabase.storage
        .from('audio-uploads')
        .createSignedUrl(remotePath, 3600);
      if (signedError || !signedData?.signedUrl) throw new Error('Could not create signed URL.');

      const response = await fetch('https://musictosheet.onrender.com/clean-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_url: signedData.signedUrl, prop_decrease: 0.8 }),
      });
      if (!response.ok) { const t = await response.text(); throw new Error(`Server error ${response.status}: ${t}`); }

      const json = await response.json();
      if (!json.audio_base64) throw new Error(json.error ?? 'Server returned no audio data.');

      // Write cleaned file to cache and replace the current file in state
      const fmt: string = json.format ?? 'mp3';
      const cleanedName = `cleaned_${source.name.replace(/\.[^.]+$/, '')}.${fmt}`;
      const outPath = FileSystem.cacheDirectory + `cleaned_${Date.now()}.${fmt}`;
      await FileSystem.writeAsStringAsync(outPath, json.audio_base64, { encoding: 'base64' });

      // Save original URI for compare toggle before replacing
      setOriginalRecordingUri(source.uri);

      // Replace current file with cleaned version — ready for conversion
      setFile({ name: cleanedName, uri: outPath, size: null, mimeType: 'audio/mpeg' });

      // Load briefly to get duration for the preview row
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

      // Unload any previous preview sound and set new URI
      await cleanedSoundRef.current?.unloadAsync().catch(() => {});
      cleanedSoundRef.current = null;
      setIsPlayingCleaned(false);
      setUseCleanedEffect(true);
      setCleanedFileUri(outPath);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not clean audio.');
    } finally {
      setCleaningNoise(false);
      if (remotePath) supabase.storage.from('audio-uploads').remove([remotePath]).catch(() => {});
    }
  }

  async function toggleCleanedPlayback() {
    try {
      const activeUri = useCleanedEffect ? cleanedFileUri : originalRecordingUri;
      if (!activeUri) return;
      if (isPlayingCleaned && cleanedSoundRef.current) {
        await cleanedSoundRef.current.pauseAsync();
        setIsPlayingCleaned(false);
        return;
      }
      // Reload sound if the URI changed (toggle switched while stopped)
      if (!cleanedSoundRef.current) {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync({ uri: activeUri });
        cleanedSoundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlayingCleaned(false);
          }
        });
      }
      await cleanedSoundRef.current.playAsync();
      setIsPlayingCleaned(true);
    } catch (e: any) {
      Alert.alert('Playback error', e?.message ?? 'Could not play audio.');
    }
  }

  async function switchEffect(cleaned: boolean) {
    // Stop and unload current sound so next play loads the new URI
    if (isPlayingCleaned && cleanedSoundRef.current) {
      await cleanedSoundRef.current.stopAsync().catch(() => {});
    }
    await cleanedSoundRef.current?.unloadAsync().catch(() => {});
    cleanedSoundRef.current = null;
    setIsPlayingCleaned(false);
    setUseCleanedEffect(cleaned);
  }

  async function saveCleanedAudio() {
    if (!cleanedFileUri) return;

    // Free / guest tier — prompt upgrade instead of downloading
    if (tier === 'free' || tier === 'freeGuest') {
      Alert.alert(
        'Premium Feature',
        'The files of your tracks/vocals are not saved in the app by default as it is not included in the free tier.',
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
      await FileSystem.copyAsync({ from: cleanedFileUri, to: destination });
      await Sharing.shareAsync(destination, { mimeType: 'audio/mpeg', dialogTitle: 'Save Cleaned Audio' });
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? 'Could not share file.');
    }
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
      setCleanedFileUri(null);
      setOriginalRecordingUri(null);
      setCleanedDuration('');
      setIsPlayingCleaned(false);
      setUseCleanedEffect(true);
      await cleanedSoundRef.current?.unloadAsync().catch(() => {});
      cleanedSoundRef.current = null;

      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= 299) { stopRecording(); return s; }
          return s + 1;
        });
      }, 1000);

      startPulse();
      if (metronomeOn) {
        postToMetronome({ type: 'start', bpm: metronomeBpm, timeSignature: '4/4', volume: 0.8 });
      }
    } catch (e: any) {
      Alert.alert('Could not start recording', e?.message ?? 'Unknown error');
    }
  }

  async function stopRecording() {
    try {
      postToMetronome({ type: 'stop' });
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

    // ── Link path — no upload needed ─────────────────────────────────────────
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

    if (!file) return;

    // ── Guest path — skip Supabase entirely, pass local URI to ProcessingScreen ─
    if (isGuest) {
      try {
        setUploading(true);
        console.log('[UploadScreen] guest mode — skipping Supabase, passing fileUri to processing');
        // Navigate directly to rights-declaration with the local file URI.
        // RightsDeclarationScreen passes it through to ProcessingScreen untouched.
        router.push({
          pathname: '/rights-declaration',
          params: {
            filePath:    '',
            fileUri:     file.uri,
            fileName:    file.name,
            fileMime:    file.mimeType ?? 'audio/mpeg',
            sourceType:  'upload',
            linkUrl:     '',
            instrument,
            outputFormat,
          },
        });
      } catch (e: any) {
        console.log('[UploadScreen] guest convert error:', e);
        setUploadError(e?.message ?? 'Could not start processing. Please try again.');
      } finally {
        setUploading(false);
      }
      return;
    }

    // ── Authenticated path — upload to Supabase Storage ──────────────────────
    try {
      setUploading(true);
      setUploadComplete(false);
      progressAnim.setValue(0);
      setUploadProgress(0);

      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;

      const ext = file.name.split('.').pop() ?? 'audio';
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
      const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: 'base64' });
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
      {/* Hidden metronome audio engine */}
      <View style={styles.metronomeHidden}>
        <WebView
          ref={metronomeRef}
          source={{ html: METRONOME_HTML, baseUrl: '' }}
          originWhitelist={['*']}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          scrollEnabled={false}
          style={{ width: 1, height: 1, backgroundColor: 'transparent' }}
        />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLogo}>
          <Image source={require('../../assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 6 }} />
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
              <TouchableOpacity onPress={() => {
                setFile(null);
                setUploadError('');
                setCleanedFileUri(null);
                setOriginalRecordingUri(null);
                setCleanedDuration('');
                setIsPlayingCleaned(false);
                setUseCleanedEffect(true);
                cleanedSoundRef.current?.unloadAsync().catch(() => {});
                cleanedSoundRef.current = null;
              }} hitSlop={8}>
                <Ionicons name="close-circle" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.uploadArea} onPress={pickFile} activeOpacity={0.7}>
              <Feather name="upload-cloud" size={24} color="#0EA5E9" style={{ marginBottom: 4 }} />
              <Text style={styles.uploadText}>Tap to upload audio file</Text>
              <Text style={styles.uploadSubtext}>MP3, WAV, M4A, FLAC, AAC</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.fileSizeHint}>Max file size: {maxFileSizeMB}MB</Text>

          {/* Paste Link */}
          <Text style={[styles.sectionLabel, { marginTop: 10 }]}>Paste Link</Text>
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
          <Text style={[styles.sectionLabel, { marginTop: 10 }]}>Record Vocals</Text>

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
                  <Text style={styles.recHint}>
                    {metronomeOn ? `♩ ${metronomeBpm} BPM · tap Stop when done` : 'Max 5:00 · tap Stop when done'}
                  </Text>

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

          {/* Metronome controls — Pro only, hidden while recording */}
          {['advancedPro', 'virtuosos'].includes(tier) && !isRecording && (
            <View style={styles.metronomeRow}>
              <TouchableOpacity
                style={[styles.metronomeToggle, metronomeOn && styles.metronomeToggleOn]}
                onPress={handleMetronomeToggle}
                activeOpacity={0.8}
              >
                <Ionicons name="musical-notes-outline" size={15} color={metronomeOn ? '#0EA5E9' : '#6B7280'} />
                <Text style={[styles.metronomeToggleText, metronomeOn && styles.metronomeToggleTextOn]}>
                  Metronome {metronomeOn ? 'ON' : 'OFF'}
                </Text>
              </TouchableOpacity>

              {metronomeOn && (
                <View style={styles.bpmStepper}>
                  <TouchableOpacity
                    style={styles.bpmBtn}
                    onPress={() => setMetronomeBpm(b => Math.max(60, b - 1))}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.bpmBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.bpmValue}>{metronomeBpm} BPM</Text>
                  <TouchableOpacity
                    style={styles.bpmBtn}
                    onPress={() => setMetronomeBpm(b => Math.min(200, b + 1))}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.bpmBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
          {metronomeOn && !isRecording && ['advancedPro', 'virtuosos'].includes(tier) && (
            <Text style={styles.metronomeHint}>
              Tip: Use earphones for best results when recording with metronome.
            </Text>
          )}

          {/* DeNoise — compact sub-action below record button */}
          <TouchableOpacity
            style={styles.cleanNoiseBtn}
            onPress={cleanNoise}
            disabled={cleaningNoise}
            activeOpacity={0.8}
          >
            {cleaningNoise ? (
              <>
                <ActivityIndicator size="small" color="#A78BFA" />
                <Text style={styles.cleanNoiseBtnText}>Cleaning audio…</Text>
              </>
            ) : (
              <>
                <Ionicons name="ear-outline" size={18} color="#A78BFA" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cleanNoiseBtnText}>DeNoise</Text>
                  <Text style={styles.cleanNoiseBtnSub}>Remove background noise</Text>
                </View>
              </>
            )}
          </TouchableOpacity>

          {/* Playback preview after successful noise cleaning */}
          {cleanedFileUri ? (
            <View style={styles.cleanedPreviewRow}>
              {/* Play/Pause */}
              <TouchableOpacity onPress={toggleCleanedPlayback} style={styles.playBtn} activeOpacity={0.8}>
                <Ionicons name={isPlayingCleaned ? 'pause' : 'play'} size={18} color="#0EA5E9" />
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

              {/* Save to device */}
              <TouchableOpacity onPress={saveCleanedAudio} style={styles.saveBtn} activeOpacity={0.8}>
                <Ionicons name="download-outline" size={16} color="#0EA5E9" />
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {/* ── OUTPUT BOX ── */}
        <View style={[styles.fieldset, { marginTop: 12 }]}>
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
          <Text style={[styles.sectionLabel, { marginTop: 10 }]}>Output Format</Text>
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
                color={canConvert ? '#0EA5E9' : '#4B5563'}
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
    paddingTop: 27,
    paddingBottom: 6,
    backgroundColor: '#111118',
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C27',
  },
  headerLogo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#0EA5E9',
    fontSize: 19,
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
    paddingTop: 14,
    paddingBottom: 16,
  },

  // Section labels
  sectionLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },

  // Fieldset container
  fieldset: {
    borderWidth: 1,
    borderColor: '#0EA5E9',
    borderRadius: 14,
    padding: 14,
    paddingTop: 18,
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
    paddingVertical: 14,
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
    marginTop: 3,
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
    paddingVertical: 9,
    color: '#FFFFFF',
    fontSize: 15,
  },
  linkHint: {
    color: '#4B5563',
    fontSize: 11,
    marginTop: 3,
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
    paddingVertical: 9,
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

  // DeNoise button (compact, sub-action below record)
  cleanNoiseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#A78BFA30',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 8,
  },
  cleanNoiseBtnText: {
    color: '#D1D5DB',
    fontSize: 13,
    fontWeight: '600',
  },
  cleanNoiseBtnSub: {
    color: '#6B7280',
    fontSize: 11,
    marginTop: 1,
  },

  // Cleaned audio playback preview row
  cleanedPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0A1A24',
    borderWidth: 1,
    borderColor: '#0EA5E930',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 6,
  },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0EA5E915',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cleanedPreviewLabel: {
    flex: 1,
    color: '#D1D5DB',
    fontSize: 13,
    fontWeight: '500',
  },
  cleanedPreviewDuration: {
    color: '#6B7280',
    fontSize: 12,
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
    marginLeft: 6,
  },
  saveBtnText: {
    color: '#0EA5E9',
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
    paddingVertical: 9,
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
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#0EA5E9',
    borderRadius: 14,
    paddingVertical: 11,
    marginTop: 14,
    marginBottom: 8,
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
    color: '#0EA5E9',
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

  // Metronome
  metronomeHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: 'none' as any,
  },
  metronomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  metronomeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  metronomeToggleOn: {
    borderColor: '#0EA5E960',
    backgroundColor: '#0EA5E910',
  },
  metronomeToggleText: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '600',
  },
  metronomeToggleTextOn: {
    color: '#0EA5E9',
  },
  bpmStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C27',
    borderWidth: 1,
    borderColor: '#2D2D3E',
    borderRadius: 10,
    overflow: 'hidden',
  },
  bpmBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bpmBtnText: {
    color: '#0EA5E9',
    fontSize: 18,
    fontWeight: '700',
  },
  bpmValue: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 8,
    minWidth: 60,
    textAlign: 'center',
  },
  metronomeHint: {
    color: '#6B7280',
    fontSize: 11,
    marginTop: 4,
    lineHeight: 15,
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
