import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, Ionicons } from '@expo/vector-icons';

// ─── Web Audio engine (inlined HTML) ─────────────────────────────────────────
// Using source={{ html }} avoids Expo asset-resolution quirks on all platforms.
// The engine uses AudioContext.currentTime (hardware sample clock) for
// scheduling — immune to JS-thread jitter unlike any setTimeout/setInterval
// approach.
const METRONOME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<style>*{margin:0;padding:0}html,body{width:100%;height:100%;background:transparent;overflow:hidden}</style>
</head>
<body>
<script>
'use strict';
var audioCtx=null,isPlaying=false,nextNoteTime=0,beatCount=0;
var bpm=120,beatsPerMeasure=4,volume=0.8;
var LOOKAHEAD_MS=25,SCHEDULE_AHEAD_SEC=0.1;
var schedulerTimer=null;

function getCtx(){
  if(!audioCtx) audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  return audioCtx;
}

function scheduleClick(bi,time){
  var ctx=getCtx();
  var isDown=(bi%beatsPerMeasure)===0;
  var osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.type='sine';
  osc.frequency.value=isDown?1500:1000;
  gain.gain.setValueAtTime(volume,time);
  gain.gain.exponentialRampToValueAtTime(0.0001,time+0.04);
  osc.connect(gain);gain.connect(ctx.destination);
  osc.start(time);osc.stop(time+0.04);
  var delayMs=Math.max(0,(time-ctx.currentTime)*1000);
  var bn=(bi%beatsPerMeasure)+1;
  setTimeout(function(){
    try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'beat',beatNumber:bn,isDownbeat:isDown}));}catch(e){}
  },delayMs);
}

function scheduler(){
  if(!isPlaying)return;
  var ctx=getCtx(),interval=60.0/bpm;
  while(nextNoteTime<ctx.currentTime+SCHEDULE_AHEAD_SEC){
    scheduleClick(beatCount,nextNoteTime);
    nextNoteTime+=interval;beatCount+=1;
  }
  schedulerTimer=setTimeout(scheduler,LOOKAHEAD_MS);
}

function startInternal(ctx){
  isPlaying=true;beatCount=0;
  nextNoteTime=ctx.currentTime+0.05;
  scheduler();
}

function start(p){
  if(p.bpm)bpm=p.bpm;
  if(p.timeSignature)beatsPerMeasure=parseBeats(p.timeSignature);
  if(p.volume!=null)volume=p.volume;
  var ctx=getCtx();
  if(ctx.state==='suspended'){ctx.resume().then(function(){startInternal(ctx);});}
  else{startInternal(ctx);}
}

function stop(){
  isPlaying=false;
  if(schedulerTimer!==null){clearTimeout(schedulerTimer);schedulerTimer=null;}
  beatCount=0;
}

function parseBeats(s){var n=parseInt((s||'4/4').split('/')[0],10);return n>0?n:4;}

function handleMsg(e){
  var m;try{m=JSON.parse(e.data);}catch(x){return;}
  if(!m||!m.type)return;
  if(m.type==='start')start(m);
  else if(m.type==='stop')stop();
  else if(m.type==='setBpm'){bpm=m.bpm;}
  else if(m.type==='setTimeSignature'){beatsPerMeasure=parseBeats(m.timeSignature);beatCount=0;}
  else if(m.type==='setVolume'){volume=m.volume;}
}
document.addEventListener('message',handleMsg);
window.addEventListener('message',handleMsg);
<\/script>
</body>
</html>`;

// ─── Data tables ──────────────────────────────────────────────────────────────
const BPM_MIN  = 40;
const BPM_MAX  = 240;
const MAX_BEATS = 7;

const TIME_SIGS = [
  { label: '2/4', beats: 2 },
  { label: '3/4', beats: 3 },
  { label: '4/4', beats: 4 },
  { label: '5/4', beats: 5 },
  { label: '6/8', beats: 6 },
  { label: '7/8', beats: 7 },
] as const;

type TimeSig = typeof TIME_SIGS[number];

const PRESETS = [
  { name: 'Largo',    bpm: 52  },
  { name: 'Andante',  bpm: 88  },
  { name: 'Moderato', bpm: 112 },
  { name: 'Allegro',  bpm: 132 },
  { name: 'Vivace',   bpm: 160 },
  { name: 'Presto',   bpm: 192 },
] as const;

function tempoName(bpm: number): string {
  if (bpm <  60) return 'Largo';
  if (bpm <  66) return 'Larghetto';
  if (bpm <  76) return 'Adagio';
  if (bpm < 108) return 'Andante';
  if (bpm < 120) return 'Moderato';
  if (bpm < 156) return 'Allegro';
  if (bpm < 176) return 'Vivace';
  if (bpm < 200) return 'Presto';
  return 'Prestissimo';
}

// ─── Volume slider (PanResponder — no extra deps) ─────────────────────────────
function VolumeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const trackWidthRef = useRef(0);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: (e) => clamp(e.nativeEvent.locationX),
      onPanResponderMove:  (e) => clamp(e.nativeEvent.locationX),
    })
  ).current;

  function clamp(x: number) {
    if (trackWidthRef.current > 0) {
      onChange(Math.max(0, Math.min(1, x / trackWidthRef.current)));
    }
  }

  const pct = `${Math.round(value * 100)}%`;

  return (
    <View
      style={vs.track}
      onLayout={(e) => { trackWidthRef.current = e.nativeEvent.layout.width; }}
      {...pan.panHandlers}
    >
      <View style={[vs.fill, { width: pct as `${number}%` }]} />
      <View style={[vs.thumb, { left: pct as `${number}%` }]} />
    </View>
  );
}

const vs = StyleSheet.create({
  track: {
    height: 30,
    justifyContent: 'center',
    backgroundColor: '#2D2D3E',
    borderRadius: 6,
  },
  fill: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    backgroundColor: '#0EA5E9',
    borderRadius: 6,
  },
  thumb: {
    position: 'absolute',
    top: '50%',
    width: 22, height: 22,
    borderRadius: 11,
    marginTop: -11, marginLeft: -11,
    backgroundColor: '#FFFFFF',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
  },
});

// ─── Metronome ────────────────────────────────────────────────────────────────
export default function Metronome() {
  const router = useRouter();
  const webViewRef = useRef<WebView>(null);

  const [bpm, setBpmState]          = useState(120);
  const [timeSig, setTimeSig]       = useState<TimeSig>(TIME_SIGS[2]); // 4/4
  const [isPlaying, setIsPlaying]   = useState(false);
  const [activeBeat, setActiveBeat] = useState(-1);
  const [volume, setVolume]         = useState(0.8);
  const [webViewReady, setWebViewReady] = useState(false);

  // Keep current values accessible inside event handlers without stale closures
  const bpmRef     = useRef(bpm);
  const timeSigRef = useRef(timeSig);
  const volumeRef  = useRef(volume);
  const playingRef = useRef(false);
  const tapTimesRef = useRef<number[]>([]);

  // One Animated.Value per beat slot (max 7 for 7/8)
  const pulseAnims = useRef(
    Array.from({ length: MAX_BEATS }, () => new Animated.Value(1))
  ).current;

  // ── Sync refs with state ───────────────────────────────────────────────────
  useEffect(() => { bpmRef.current     = bpm; },     [bpm]);
  useEffect(() => { timeSigRef.current = timeSig; }, [timeSig]);
  useEffect(() => { volumeRef.current  = volume; },  [volume]);

  // ── Restore persisted settings on mount ───────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [savedBpm, savedSig] = await Promise.all([
          AsyncStorage.getItem('metronome_bpm'),
          AsyncStorage.getItem('metronome_time_sig'),
        ]);
        if (savedBpm) {
          const parsed = parseInt(savedBpm, 10);
          if (parsed >= BPM_MIN && parsed <= BPM_MAX) {
            setBpmState(parsed);
            bpmRef.current = parsed;
          }
        }
        if (savedSig) {
          const found = TIME_SIGS.find(ts => ts.label === savedSig);
          if (found) {
            setTimeSig(found);
            timeSigRef.current = found;
          }
        }
      } catch {}
    })();
  }, []);

  // ── postMessage helpers ────────────────────────────────────────────────────
  function postToWebView(msg: object) {
    webViewRef.current?.postMessage(JSON.stringify(msg));
  }

  // ── Beat event from WebView ────────────────────────────────────────────────
  // The HTML engine sends { type: 'beat', beatNumber, isDownbeat } via
  // postMessage at the exact moment (wall-clock delay derived from
  // AudioContext.currentTime) the audio fires.
  function handleWebViewMessage(event: WebViewMessageEvent) {
    let msg: any;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (!msg || msg.type !== 'beat') return;

    const beat = (msg.beatNumber as number) - 1; // 0-indexed for animation

    // Haptic on downbeat
    if (msg.isDownbeat) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    // Update beat indicator
    setActiveBeat(beat);

    // Native Animated pulse — runs on UI thread, not JS thread
    Animated.sequence([
      Animated.timing(pulseAnims[beat], {
        toValue: 1.5, duration: 35, useNativeDriver: true,
      }),
      Animated.spring(pulseAnims[beat], {
        toValue: 1, useNativeDriver: true, speed: 18, bounciness: 5,
      }),
    ]).start();
  }

  // ── Start / Stop ───────────────────────────────────────────────────────────
  function start() {
    if (!webViewReady) return;
    playingRef.current = true;
    setIsPlaying(true);
    postToWebView({
      type:          'start',
      bpm:           bpmRef.current,
      timeSignature: timeSigRef.current.label,
      volume:        volumeRef.current,
    });
  }

  function stop() {
    playingRef.current = false;
    setIsPlaying(false);
    setActiveBeat(-1);
    postToWebView({ type: 'stop' });
  }

  // ── BPM setter ─────────────────────────────────────────────────────────────
  function setBpm(raw: number) {
    const next = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(raw)));
    setBpmState(next);
    bpmRef.current = next;
    AsyncStorage.setItem('metronome_bpm', String(next)).catch(() => {});
    if (playingRef.current) {
      postToWebView({ type: 'setBpm', bpm: next });
    }
  }

  // ── Time signature change ──────────────────────────────────────────────────
  function changeTimeSig(ts: TimeSig) {
    setTimeSig(ts);
    timeSigRef.current = ts;
    AsyncStorage.setItem('metronome_time_sig', ts.label).catch(() => {});
    if (playingRef.current) {
      postToWebView({ type: 'setTimeSignature', timeSignature: ts.label });
    }
  }

  // ── Volume change ──────────────────────────────────────────────────────────
  function handleVolumeChange(v: number) {
    setVolume(v);
    volumeRef.current = v;
    postToWebView({ type: 'setVolume', volume: v });
  }

  // ── Tap tempo ──────────────────────────────────────────────────────────────
  function handleTap() {
    const now = Date.now();
    tapTimesRef.current = tapTimesRef.current.filter(t => now - t < 3000);
    tapTimesRef.current.push(now);
    if (tapTimesRef.current.length >= 2) {
      const gaps = tapTimesRef.current
        .slice(1)
        .map((t, i) => t - tapTimesRef.current[i]);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      setBpm(60_000 / avg);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Metronome',
          headerStyle: { backgroundColor: '#111118' },
          headerTintColor: '#FFFFFF',
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => { if (playingRef.current) stop(); router.back(); }}
              hitSlop={8}
              style={{ paddingRight: 8 }}
            >
              <Feather name="arrow-left" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          ),
        }}
      />

      {/* ── Hidden WebView — audio engine only ───────────────────────────── */}
      {/* width/height must be > 0 for iOS to initialise the JS runtime,    */}
      {/* but opacity:0 + pointerEvents:'none' keeps it invisible/untappable */}
      <View style={hidden.container}>
        <WebView
          ref={webViewRef}
          source={{ html: METRONOME_HTML, baseUrl: '' }}
          onLoad={() => setWebViewReady(true)}
          onMessage={handleWebViewMessage}
          originWhitelist={['*']}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          scrollEnabled={false}
          overScrollMode="never"
          style={hidden.webView}
        />
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* ── Beat pulse dots ─────────────────────────────────────────────── */}
        <View style={s.dotsRow}>
          {Array.from({ length: timeSig.beats }, (_, i) => (
            <Animated.View
              key={i}
              style={[
                s.dot,
                i === 0          && s.dotDown,
                activeBeat === i && s.dotOn,
                activeBeat === i && i === 0 && s.dotDownOn,
                { transform: [{ scale: pulseAnims[i] }] },
              ]}
            />
          ))}
        </View>

        {/* ── BPM card ─────────────────────────────────────────────────────── */}
        <View style={s.bpmCard}>
          <Text style={s.bpmNum}>{bpm}</Text>
          <Text style={s.bpmUnit}>BPM</Text>
          <Text style={s.bpmName}>{tempoName(bpm)}</Text>
        </View>

        {/* ── BPM nudge buttons ─────────────────────────────────────────────── */}
        <View style={s.nudgeRow}>
          {([-10, -5, +5, +10] as const).map(d => (
            <TouchableOpacity
              key={d}
              style={s.nudgeBtn}
              onPress={() => setBpm(bpm + d)}
              activeOpacity={0.7}
            >
              <Text style={s.nudgeBtnText}>{d > 0 ? `+${d}` : d}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={s.nudgeRow}>
          {([-1, +1] as const).map(d => (
            <TouchableOpacity
              key={d}
              style={[s.nudgeBtn, s.nudgeBtnFine]}
              onPress={() => setBpm(bpm + d)}
              activeOpacity={0.7}
            >
              <Text style={s.nudgeBtnText}>{d > 0 ? `+${d}` : d}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Time signature ────────────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Time Signature</Text>
          <View style={s.chipRow}>
            {TIME_SIGS.map(ts => (
              <TouchableOpacity
                key={ts.label}
                style={[s.chip, timeSig.label === ts.label && s.chipOn]}
                onPress={() => changeTimeSig(ts)}
                activeOpacity={0.7}
              >
                <Text style={[s.chipText, timeSig.label === ts.label && s.chipTextOn]}>
                  {ts.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Preset tempos ─────────────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Preset Tempos</Text>
          <View style={s.presetRow}>
            {PRESETS.slice(0, 3).map(p => (
              <PresetButton key={p.name} preset={p} active={bpm === p.bpm} onPress={() => setBpm(p.bpm)} />
            ))}
          </View>
          <View style={s.presetRow}>
            {PRESETS.slice(3).map(p => (
              <PresetButton key={p.name} preset={p} active={bpm === p.bpm} onPress={() => setBpm(p.bpm)} />
            ))}
          </View>
        </View>

        {/* ── Volume ────────────────────────────────────────────────────────── */}
        <View style={s.card}>
          <View style={s.volumeHeader}>
            <Text style={s.cardTitle}>Volume</Text>
            <Text style={s.volumePct}>{Math.round(volume * 100)}%</Text>
          </View>
          <View style={s.volumeRow}>
            <Ionicons name="volume-low"  size={18} color="#6B7280" />
            <View style={s.sliderWrap}>
              <VolumeSlider value={volume} onChange={handleVolumeChange} />
            </View>
            <Ionicons name="volume-high" size={18} color="#6B7280" />
          </View>
        </View>

        {/* ── Start / Stop ──────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[
            s.playBtn,
            isPlaying   && s.playBtnStop,
            !webViewReady && s.playBtnOff,
          ]}
          onPress={isPlaying ? stop : start}
          activeOpacity={0.85}
          disabled={!webViewReady}
        >
          <Ionicons
            name={isPlaying ? 'stop' : 'play'}
            size={24}
            color="#FFFFFF"
          />
          <Text style={s.playBtnText}>
            {!webViewReady ? 'Loading…' : isPlaying ? 'Stop' : 'Start'}
          </Text>
        </TouchableOpacity>

        {/* ── Tap tempo ─────────────────────────────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [s.tapBtn, pressed && s.tapBtnPress]}
          onPress={handleTap}
        >
          <Text style={s.tapBtnText}>Tap Tempo</Text>
        </Pressable>

      </ScrollView>
    </>
  );
}

// ─── PresetButton sub-component ───────────────────────────────────────────────
function PresetButton({
  preset,
  active,
  onPress,
}: {
  preset: { name: string; bpm: number };
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[s.presetBtn, active && s.presetBtnOn]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[s.presetName, active && s.presetNameOn]}>{preset.name}</Text>
      <Text style={[s.presetBpm,  active && s.presetBpmOn]}>{preset.bpm}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

// The WebView must have a non-zero size for iOS to initialise its JS runtime,
// but we hide it completely so it's invisible and non-interactive.
const hidden = StyleSheet.create({
  container: {
    position: 'absolute',
    width: 1, height: 1,
    opacity: 0,
    pointerEvents: 'none' as any,
  },
  webView: { width: 1, height: 1, backgroundColor: 'transparent' },
});

const s = StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: '#111118' },
  content:  {
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 20,
    paddingHorizontal: 18,
    gap: 10,
  },

  // ── Beat dots ──
  dotsRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    minHeight: 36,
    marginBottom: 0,
  },
  dot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#2D2D3E',
    borderWidth: 1.5, borderColor: '#3A3A50',
  },
  dotDown:    { borderColor: '#0EA5E940' },
  dotOn:      { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  dotDownOn:  { backgroundColor: '#0EA5E9', borderColor: '#0EA5E9' },

  // ── BPM card ──
  bpmCard: {
    alignItems: 'center',
    backgroundColor: '#1A1A24',
    borderRadius: 24,
    borderWidth: 1, borderColor: '#2D2D3E',
    paddingVertical: 17, paddingHorizontal: 60,
    gap: 2,
    alignSelf: 'stretch',
  },
  bpmNum:  { color: '#FFFFFF', fontSize: 48, fontWeight: '700', letterSpacing: -2, lineHeight: 52 },
  bpmUnit: { color: '#6B7280', fontSize: 11, fontWeight: '700', letterSpacing: 3, textTransform: 'uppercase' },
  bpmName: { color: '#0EA5E9', fontSize: 13, fontWeight: '600', marginTop: 3 },

  // ── Nudge buttons ──
  nudgeRow: { flexDirection: 'row', gap: 8 },
  nudgeBtn: {
    backgroundColor: '#1A1A24', borderRadius: 12,
    borderWidth: 1, borderColor: '#2D2D3E',
    paddingVertical: 10, paddingHorizontal: 20,
    alignItems: 'center', minWidth: 70,
  },
  nudgeBtnFine: { minWidth: 110 },
  nudgeBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  // ── Section cards ──
  card: {
    backgroundColor: '#1A1A24', borderRadius: 16,
    borderWidth: 1, borderColor: '#2D2D3E',
    padding: 12, alignSelf: 'stretch', gap: 8,
  },
  cardTitle: {
    color: '#6B7280', fontSize: 11, fontWeight: '700',
    letterSpacing: 0.9, textTransform: 'uppercase',
  },

  // ── Time sig chips ──
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1, paddingVertical: 9, alignItems: 'center',
    borderRadius: 10, borderWidth: 1.5, borderColor: '#2D2D3E',
    backgroundColor: '#111118',
  },
  chipOn:     { backgroundColor: '#0EA5E9', borderColor: '#0EA5E9' },
  chipText:   { color: '#9CA3AF', fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: '#FFFFFF' },

  // ── Preset tempo grid ──
  presetRow: { flexDirection: 'row', gap: 8 },
  presetBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#2D2D3E',
    backgroundColor: '#111118', gap: 3,
  },
  presetBtnOn:  { borderColor: '#0EA5E9', backgroundColor: '#0EA5E910' },
  presetName:   { color: '#9CA3AF', fontSize: 11, fontWeight: '700' },
  presetNameOn: { color: '#0EA5E9' },
  presetBpm:    { color: '#6B7280', fontSize: 11 },
  presetBpmOn:  { color: '#0EA5E9' },

  // ── Volume ──
  volumeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  volumePct:    { color: '#9CA3AF', fontSize: 12, fontWeight: '500' },
  volumeRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sliderWrap:   { flex: 1 },

  // ── Play / Stop ──
  playBtn: {
    backgroundColor: '#0EA5E9', borderRadius: 18,
    paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    alignSelf: 'stretch', justifyContent: 'center',
  },
  playBtnStop: { backgroundColor: '#EF4444' },
  playBtnOff:  { backgroundColor: '#2D2D3E' },
  playBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },

  // ── Tap tempo ──
  tapBtn: {
    borderWidth: 1.5, borderColor: '#2D2D3E', borderRadius: 16,
    paddingVertical: 12,
    alignSelf: 'stretch', alignItems: 'center',
  },
  tapBtnPress: { backgroundColor: '#1A1A24' },
  tapBtnText:  { color: '#9CA3AF', fontSize: 16, fontWeight: '600' },
});
