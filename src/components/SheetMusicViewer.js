import { forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';

// ─── HTML escape helper ──────────────────────────────────────────────────────
function htmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── OSMD (OpenSheetMusicDisplay) renderer ────────────────────────────────────
// Primary renderer when musicxml is available. Loads OSMD from CDN and renders
// the MusicXML string as professional sheet music. Falls back to a message if
// the CDN is unavailable (e.g. offline or WebView sandbox blocks it).
function buildOsmdHtml(musicxml, notes, bpm) {
  // JSON.stringify safely escapes the XML string for embedding in JS
  const xmlJson   = JSON.stringify(musicxml);
  const notesJson = JSON.stringify(notes);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes"/>
  <script src="https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@1.8.6/build/opensheetmusicdisplay.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #111118; min-height: 500px; }
    #status {
      color: #AAAAAA; font-size: 12px; font-family: sans-serif;
      padding: 12px 16px; min-height: 20px;
    }
    #osmd-container {
      background: #FFFFFF;
      padding: 20px;
      border-radius: 8px;
      margin: 0 16px 16px 16px;
    }
    #osmd-fallback {
      display: none;
      color: #AAAAAA; font-family: sans-serif; font-size: 13px;
      padding: 20px; text-align: center;
    }
  </style>
</head>
<body>
  <div id="status">Loading sheet music\u2026</div>
  <div id="osmd-container"></div>
  <div id="osmd-fallback">
    Sheet music renderer unavailable in this environment.<br/>
    Audio playback is still available above.
  </div>

<script>
// Notes + BPM available for the audio playback engine
window.__NOTES = ${notesJson};
window.__BPM   = ${bpm};

// ── OSMD initialisation ──────────────────────────────────────────────────────
var _fallbackTimer = setTimeout(function () {
  showFallback('Loading timed out');
}, 15000);

function setStatus(msg) {
  var el = document.getElementById('status');
  if (el) el.textContent = msg;
}

function showFallback(reason) {
  clearTimeout(_fallbackTimer);
  setStatus('');
  document.getElementById('osmd-container').style.display = 'none';
  document.getElementById('osmd-fallback').style.display  = 'block';
  console.warn('[OSMD]', reason);
}

function initOsmd() {
  try {
    if (typeof opensheetmusicdisplay === 'undefined') {
      showFallback('OSMD library failed to load from CDN');
      return;
    }

    var osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay('osmd-container', {
      backend:        'svg',
      drawTitle:      true,
      drawComposer:   false,
      drawCredits:    false,
      autoResize:     true,
      drawingParameters: 'compact',
    });

    var xmlData = ${xmlJson};
    setStatus('Rendering notation\u2026');

    osmd.load(xmlData)
      .then(function () {
        osmd.render();
        clearTimeout(_fallbackTimer);
        setStatus('');
      })
      .catch(function (e) {
        showFallback('Render error: ' + e.message);
      });

  } catch (e) {
    showFallback('OSMD error: ' + e.message);
  }
}

// Fire after all scripts (including OSMD CDN) have loaded
if (document.readyState === 'complete') {
  initOsmd();
} else {
  window.addEventListener('load', initOsmd);
}

// ── Web Audio Playback Engine ────────────────────────────────────────────────
var _pbCtx   = null;
var _pbTimer = null;
var _pbSched = [];
var _pbTotal = 0;
var _pbStart = 0;
var _NS = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};

function _freq(pitch) {
  var m = String(pitch).match(/^([A-G][#b]?)([0-9])$/);
  if (!m) return 0;
  var s = _NS[m[1]];
  if (s === undefined) return 0;
  return 440 * Math.pow(2, ((parseInt(m[2]) + 1) * 12 + s - 69) / 12);
}

function _tone(ctx, freq, t0, dur) {
  if (freq <= 0) return;
  var osc = ctx.createOscillator(), g = ctx.createGain();
  osc.connect(g); g.connect(ctx.destination);
  osc.type = 'sine'; osc.frequency.value = freq;
  var att = Math.min(0.015, dur * 0.1), rel = Math.min(0.06, dur * 0.25);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.3, t0 + att);
  g.gain.setValueAtTime(0.3, t0 + dur - rel);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  osc.start(t0); osc.stop(t0 + dur + 0.01);
}

function _post(obj) { try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch(e){} }

function _tick() {
  if (!_pbCtx || _pbCtx.state !== 'running') return;
  var ct      = _pbCtx.currentTime;
  var elapsed = ct - _pbStart;
  _post({ type: 'progress', currentTime: Math.min(elapsed, _pbTotal), totalTime: _pbTotal });
  if (elapsed < _pbTotal + 0.3) { _pbTimer = setTimeout(_tick, 80); }
  else { _pbTimer = null; _post({ type: 'ended' }); }
}

function _stopPb() {
  if (_pbTimer) { clearTimeout(_pbTimer); _pbTimer = null; }
  if (_pbCtx)   { try { _pbCtx.close(); } catch(e){} _pbCtx = null; }
  _pbSched = [];
}

function handlePlaybackCommand(cmd) {
  if (cmd.type === 'play') {
    _stopPb();
    var notes = window.__NOTES || [], bpm = window.__BPM || 120;
    _pbCtx   = new (window.AudioContext || window.webkitAudioContext)();
    _pbStart = _pbCtx.currentTime + 0.05;
    _pbSched = [];
    var t = _pbStart;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i], dur = Math.max(0.05, (n.duration || 0.5) * (120 / bpm));
      _tone(_pbCtx, _freq(n.pitch), t, dur * 0.88);
      _pbSched.push({ idx: i, t0: t, t1: t + dur });
      t += dur;
    }
    _pbTotal = t - _pbStart;
    _post({ type: 'totalTime', totalTime: _pbTotal });
    _pbTimer = setTimeout(_tick, 80);
  } else if (cmd.type === 'pause') {
    if (_pbCtx && _pbCtx.state === 'running') {
      _pbCtx.suspend();
      if (_pbTimer) { clearTimeout(_pbTimer); _pbTimer = null; }
      _post({ type: 'paused' });
    }
  } else if (cmd.type === 'resume') {
    if (_pbCtx && _pbCtx.state === 'suspended') { _pbCtx.resume(); _tick(); _post({ type: 'resumed' }); }
  } else if (cmd.type === 'stop') {
    _stopPb(); _post({ type: 'stopped' });
  }
}
</script>
</body>
</html>`;
}

// ─── Custom SVG sheet-music builder (fallback when no musicxml) ───────────────
// cfg options:
//   pageWidth  – fixed px width (null → use window.innerWidth)
//   bgColor    – background fill  (default '#111118')
//   staffColor – staff/barline color (default '#AAAAAA')
//   noteColor  – notes, clef, text color (default '#FFFFFF')
//   headerHtml – raw HTML injected before the <svg>
//   footerHtml – raw HTML injected after the <svg>
function buildHtml(notes, cfg) {
  cfg = cfg || {};
  const bgColor    = cfg.bgColor    || '#111118';
  const staffColor = cfg.staffColor || '#AAAAAA';
  const noteColor  = cfg.noteColor  || '#FFFFFF';
  const pageWidth  = cfg.pageWidth  || null;
  const headerHtml = cfg.headerHtml || '';
  const footerHtml = cfg.footerHtml || '';
  const bpm        = cfg.bpm || 120;
  const notesJson  = JSON.stringify(notes);
  const wExpr      = pageWidth ? String(pageWidth) : 'Math.floor(window.innerWidth)';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background-color: ${bgColor}; min-height: 500px; }
  #sheet { display: block; }
</style>
</head>
<body>
${headerHtml}
<svg id="sheet" xmlns="http://www.w3.org/2000/svg"></svg>
${footerHtml}
<script>
// Global note/BPM store — used by the playback engine
window.__NOTES = ${notesJson};
window.__BPM   = ${bpm};

(function () {
  try {

    // ── Notes from React Native ──────────────────────────────────────────
    var notes = ${notesJson};

    // ── Music constants ──────────────────────────────────────────────────
    var DEGREE = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
    var BEATS  = 4;   // quarter notes per measure (4/4 time)
    var BPM    = ${bpm};

    // ── Layout constants ─────────────────────────────────────────────────
    var W         = ${wExpr};
    var LINE_GAP  = 12;             // px between adjacent staff lines
    var STEP      = LINE_GAP / 2;   // px per diatonic step (half a space = 6px)
    var STAFF_H   = 4 * LINE_GAP;   // 48px (top line to bottom line)
    var ROW_H     = 140;            // total px per staff row
    var ST_OFF    = 48;             // y from row top to first (top) staff line

    // Notehead dimensions
    var NH_RX     = 5;
    var NH_RY     = 4;

    var CLEF_W    = 52;
    var TIME_W    = 24;
    var PER_ROW   = 8;

    var NX0_FIRST = CLEF_W + TIME_W + 8;
    var NX0_REST  = CLEF_W + 8;
    var NW_FIRST  = (W - NX0_FIRST - 6) / PER_ROW;
    var NW_REST   = (W - NX0_REST  - 6) / PER_ROW;

    // ── Parse pitch string → { steps, acc } ─────────────────────────────
    function parsePitch(p) {
      var m = (p || '').match(/^([A-G])([#b]?)([0-9])$/);
      if (!m || DEGREE[m[1]] === undefined) return null;
      return {
        steps: (parseInt(m[3], 10) - 4) * 7 + DEGREE[m[1]],
        acc:   m[2] || null
      };
    }

    // ── Use demo scale when no notes are provided ────────────────────────
    var INPUT = notes.length ? notes : [
      {pitch:'C4'},{pitch:'D4'},{pitch:'E4'},{pitch:'F4'},
      {pitch:'G4'},{pitch:'A4'},{pitch:'B4'},{pitch:'C5'},
      {pitch:'E5'},{pitch:'D5'},{pitch:'C5'},{pitch:'B4'},
      {pitch:'A4'},{pitch:'G4'},{pitch:'F4'},{pitch:'E4'}
    ];

    var parsed = INPUT.map(function (n) { return parsePitch(n.pitch); });

    // ── Split into rows ──────────────────────────────────────────────────
    var rows = [];
    for (var i = 0; i < parsed.length; i += PER_ROW) {
      rows.push(parsed.slice(i, i + PER_ROW));
    }

    // ── SVG assembly ─────────────────────────────────────────────────────
    var totalH = rows.length * ROW_H + 24;
    var svg    = document.getElementById('sheet');
    svg.setAttribute('width',  W);
    svg.setAttribute('height', totalH);

    var out = rect(0, 0, W, totalH, '${bgColor}');

    rows.forEach(function (row, ri) {
      var isFirst = ri === 0;
      var ry  = ri * ROW_H;
      var stT = ry + ST_OFF;
      var stB = stT + STAFF_H;
      var nx0 = isFirst ? NX0_FIRST : NX0_REST;
      var nw  = isFirst ? NW_FIRST  : NW_REST;

      // ── Staff lines ────────────────────────────────────────────────
      for (var l = 0; l < 5; l++)
        out += hLine(4, W - 4, stT + l * LINE_GAP, '${staffColor}', 1);

      // ── Left barline ───────────────────────────────────────────────
      out += vLine(4, stT, stB, '${staffColor}', 1.5);

      // ── Treble clef ────────────────────────────────────────────────
      out += '<text x="5" y="' + (stB + 16) + '"'
           + ' font-size="70" font-family="Times New Roman, Times, serif"'
           + ' fill="${noteColor}">&#x1D11E;</text>';

      // ── Time signature + tempo mark (row 0 only) ──────────────────
      if (isFirst) {
        var tx = CLEF_W + 2;
        out += timeSigNum(tx, stT + LINE_GAP + 7,     '4');
        out += timeSigNum(tx, stT + 3 * LINE_GAP + 7, '4');
        out += '<text x="' + (CLEF_W + TIME_W + 14) + '" y="' + (stT - 5) + '"'
             + ' font-size="11" font-family="sans-serif" fill="${noteColor}">\u2669 = ' + BPM + '</text>';
      }

      // ── Notes ─────────────────────────────────────────────────────
      row.forEach(function (note, ni) {
        var nx  = Math.round(nx0 + ni * nw + nw / 2);
        var gni = ri * PER_ROW + ni;

        if (!note) {
          // ── Quarter rest ──────────────────────────────────────────
          var mid = stT + STAFF_H / 2 + 2;
          out += seg(nx - 3, mid - 9,  nx + 5, mid - 3, '${noteColor}', 1.5);
          out += seg(nx + 5, mid - 3,  nx - 3, mid + 4, '${noteColor}', 1.5);
          out += seg(nx - 3, mid + 4,  nx + 3, mid + 11,'${noteColor}', 1.5);
        } else {
          // ── Pitched note ──────────────────────────────────────────
          var sae = note.steps - 2;
          while (sae < -4) sae += 7;
          while (sae > 12) sae -= 7;
          var ny  = stB - sae * STEP;

          if (sae <= -2) {
            var loLedger = (sae % 2 === 0) ? sae : sae + 1;
            for (var ls = -2; ls >= loLedger; ls -= 2)
              out += hLine(nx - 11, nx + 11, stB - ls * STEP, '${staffColor}', 1);
          }
          if (sae >= 10) {
            var hiLedger = (sae % 2 === 0) ? sae : sae - 1;
            for (var hs = 10; hs <= hiLedger; hs += 2)
              out += hLine(nx - 11, nx + 11, stB - hs * STEP, '${staffColor}', 1);
          }
          if (note.acc) {
            var ch = note.acc === '#' ? '&#x266F;' : '&#x266D;';
            out += '<text x="' + (nx - 16) + '" y="' + (ny + 5) + '"'
                 + ' font-size="14" font-family="serif" fill="${noteColor}">' + ch + '</text>';
          }
          out += '<ellipse'
               + ' id="note-' + gni + '"'
               + ' cx="' + nx + '" cy="' + ny + '"'
               + ' rx="' + NH_RX + '" ry="' + NH_RY + '" fill="${noteColor}"'
               + ' transform="rotate(-15,' + nx + ',' + ny + ')"/>';

          var STEM_LEN = 30;
          if (sae < 4) {
            out += vLine(nx + NH_RX, ny - NH_RY, ny - NH_RY - STEM_LEN, '${noteColor}', 1.5);
          } else {
            out += vLine(nx - NH_RX, ny + NH_RY, ny + NH_RY + STEM_LEN, '${noteColor}', 1.5);
          }
        }

        if ((gni + 1) % BEATS === 0 && ni < row.length - 1) {
          var bx = Math.round(nx + nw / 2 + 1);
          out += vLine(bx, stT, stB, '${staffColor}', 1.5);
        }
      });

      // ── Right barline ──────────────────────────────────────────────
      out += vLine(W - 4, stT, stB, '${staffColor}', 1.5);
    });

    svg.innerHTML = out;

  } catch (e) {
    document.body.innerHTML =
      '<pre style="color:#FF4444;background:${bgColor};padding:14px;font-size:12px;white-space:pre-wrap">'
      + 'SVG render error:\\n' + e.message + '\\n\\n' + (e.stack || '') + '</pre>';
  }
})();

// ── SVG primitive helpers ─────────────────────────────────────────────────
function rect(x, y, w, h, fill) {
  return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="'+fill+'"/>';
}
function hLine(x1, x2, y, stroke, sw) {
  return '<line x1="'+x1+'" y1="'+y+'"  x2="'+x2+'" y2="'+y+'"  stroke="'+stroke+'" stroke-width="'+sw+'"/>';
}
function vLine(x, y1, y2, stroke, sw) {
  return '<line x1="'+x+'"  y1="'+y1+'" x2="'+x+'"  y2="'+y2+'" stroke="'+stroke+'" stroke-width="'+sw+'"/>';
}
function seg(x1, y1, x2, y2, stroke, sw) {
  return '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+stroke+'" stroke-width="'+sw+'"/>';
}
function timeSigNum(x, y, n) {
  return '<text x="'+x+'" y="'+y+'" font-size="17" font-family="sans-serif"'
       + ' font-weight="bold" fill="${noteColor}">'+n+'</text>';
}

// ── Web Audio Playback Engine ────────────────────────────────────────────────
var _pbCtx   = null;
var _pbTimer = null;
var _pbSched = [];
var _pbTotal = 0;
var _pbStart = 0;
var _prevHi  = -1;
var _NS = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};

function _freq(pitch) {
  var m = String(pitch).match(/^([A-G][#b]?)([0-9])$/);
  if (!m) return 0;
  var s = _NS[m[1]];
  if (s === undefined) return 0;
  return 440 * Math.pow(2, ((parseInt(m[2]) + 1) * 12 + s - 69) / 12);
}

function _tone(ctx, freq, t0, dur) {
  if (freq <= 0) return;
  var osc = ctx.createOscillator(), g = ctx.createGain();
  osc.connect(g); g.connect(ctx.destination);
  osc.type = 'sine'; osc.frequency.value = freq;
  var att = Math.min(0.015, dur * 0.1), rel = Math.min(0.06, dur * 0.25);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.3, t0 + att);
  g.gain.setValueAtTime(0.3, t0 + dur - rel);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  osc.start(t0); osc.stop(t0 + dur + 0.01);
}

function _hiNote(idx) {
  if (_prevHi >= 0) { var p = document.getElementById('note-' + _prevHi); if (p) p.setAttribute('fill', '${noteColor}'); }
  var el = document.getElementById('note-' + idx); if (el) el.setAttribute('fill', '#0EA5E9');
  _prevHi = idx;
}

function _clearHi() {
  if (_prevHi >= 0) { var el = document.getElementById('note-' + _prevHi); if (el) el.setAttribute('fill', '${noteColor}'); _prevHi = -1; }
}

function _post(obj) { try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch(e){} }

function _tick() {
  if (!_pbCtx || _pbCtx.state !== 'running') return;
  var ct = _pbCtx.currentTime, elapsed = ct - _pbStart;
  for (var i = 0; i < _pbSched.length; i++) {
    var s = _pbSched[i];
    if (ct >= s.t0 && ct < s.t1) { if (s.idx !== _prevHi) _hiNote(s.idx); break; }
  }
  _post({ type: 'progress', currentTime: Math.min(elapsed, _pbTotal), totalTime: _pbTotal });
  if (elapsed < _pbTotal + 0.3) { _pbTimer = setTimeout(_tick, 80); }
  else { _clearHi(); _pbTimer = null; _post({ type: 'ended' }); }
}

function _stopPb() {
  if (_pbTimer) { clearTimeout(_pbTimer); _pbTimer = null; }
  if (_pbCtx) { try { _pbCtx.close(); } catch(e){} _pbCtx = null; }
  _clearHi(); _pbSched = [];
}

function handlePlaybackCommand(cmd) {
  if (cmd.type === 'play') {
    _stopPb();
    var notes = window.__NOTES || [], bpm = window.__BPM || 120;
    _pbCtx   = new (window.AudioContext || window.webkitAudioContext)();
    _pbStart = _pbCtx.currentTime + 0.05;
    _pbSched = [];
    var t = _pbStart;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i], dur = Math.max(0.05, (n.duration || 0.5) * (120 / bpm));
      _tone(_pbCtx, _freq(n.pitch), t, dur * 0.88);
      _pbSched.push({ idx: i, t0: t, t1: t + dur });
      t += dur;
    }
    _pbTotal = t - _pbStart;
    _post({ type: 'totalTime', totalTime: _pbTotal });
    _pbTimer = setTimeout(_tick, 80);
  } else if (cmd.type === 'pause') {
    if (_pbCtx && _pbCtx.state === 'running') {
      _pbCtx.suspend();
      if (_pbTimer) { clearTimeout(_pbTimer); _pbTimer = null; }
      _post({ type: 'paused' });
    }
  } else if (cmd.type === 'resume') {
    if (_pbCtx && _pbCtx.state === 'suspended') { _pbCtx.resume(); _tick(); _post({ type: 'resumed' }); }
  } else if (cmd.type === 'stop') {
    _stopPb(); _post({ type: 'stopped' });
  }
}
</script>
</body>
</html>`;
}

// ─── PDF HTML builder (exported for use in ResultsScreen) ────────────────────
export function buildPdfHtml(notes, meta) {
  meta = meta || {};
  const trackName  = htmlEsc(meta.trackName  || 'Untitled');
  const instrument = htmlEsc(meta.instrument || 'Unknown');
  const format     = htmlEsc(meta.format     || 'Score');
  const date       = htmlEsc(
    meta.date ||
    new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  );
  const bpm       = meta.bpm || 120;
  const watermark = meta.watermark ? 'true' : 'false';
  const notesJson = JSON.stringify(notes);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { margin: 20mm 20mm 20mm 45mm; }
  html, body { background: #FFFFFF; font-family: sans-serif; }
  .page { position: relative; }
  .page.break { page-break-after: always; }
  .header { padding-bottom: 14px; border-bottom: 1px solid #E5E7EB; margin-bottom: 16px; }
  .header-title { font-size: 18px; font-weight: 700; color: #111118; margin-bottom: 4px; }
  .header-meta  { font-size: 12px; color: #6B7280; }
  .footer { padding-top: 10px; border-top: 1px solid #E5E7EB; font-size: 9px; color: #333333; text-align: center; margin-top: 8px; }
</style>
</head>
<body>
<script>
(function () {
  try {
    var notes = ${notesJson};

    var DEGREE    = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
    var BEATS     = 4;
    var WATERMARK = ${watermark};
    var BPM       = ${bpm};
    var W             = 500;
    var LINE_GAP      = 12;
    var STEP          = LINE_GAP / 2;
    var STAFF_H       = 4 * LINE_GAP;
    var ROW_H         = 110;
    var ST_OFF        = 48;
    var NH_RX         = 5;
    var NH_RY         = 4;
    var CLEF_W        = 52;
    var TIME_W        = 24;
    var PER_ROW       = 8;
    var ROWS_PER_PAGE = 6;

    var NX0_FIRST = CLEF_W + TIME_W + 8;
    var NX0_REST  = CLEF_W + 8;
    var NW_FIRST  = (W - NX0_FIRST - 6) / PER_ROW;
    var NW_REST   = (W - NX0_REST  - 6) / PER_ROW;

    function parsePitch(p) {
      var m = (p || '').match(/^([A-G])([#b]?)([0-9])$/);
      if (!m || DEGREE[m[1]] === undefined) return null;
      return { steps: (parseInt(m[3], 10) - 4) * 7 + DEGREE[m[1]], acc: m[2] || null };
    }

    var INPUT = notes.length ? notes : [
      {pitch:'C4'},{pitch:'D4'},{pitch:'E4'},{pitch:'F4'},
      {pitch:'G4'},{pitch:'A4'},{pitch:'B4'},{pitch:'C5'},
      {pitch:'E5'},{pitch:'D5'},{pitch:'C5'},{pitch:'B4'},
      {pitch:'A4'},{pitch:'G4'},{pitch:'F4'},{pitch:'E4'}
    ];

    var parsed = INPUT.map(function (n) { return parsePitch(n.pitch); });

    var allRows = [];
    for (var i = 0; i < parsed.length; i += PER_ROW)
      allRows.push(parsed.slice(i, i + PER_ROW));

    var pages = [];
    for (var p = 0; p < allRows.length; p += ROWS_PER_PAGE)
      pages.push(allRows.slice(p, p + ROWS_PER_PAGE));

    var HEADER_HTML =
      '<div class="header">'
      + '<div class="header-title">${trackName}</div>'
      + '<div class="header-meta">${instrument} &middot; ${format} &middot; ${date} &middot; \u2669 = ${bpm}</div>'
      + '</div>';

    var FOOTER_HTML =
      '<div class="footer">'
      + 'Generated by Music-To-Sheet &nbsp;|&nbsp; musictosheet.com &nbsp;|&nbsp;'
      + '<span style="color:#DC143C">For personal use only</span>'
      + ' \u2014 not licensed for distribution'
      + '</div>';

    var bodyHtml = '';

    pages.forEach(function (pageRows, pi) {
      var isLastPage = pi === pages.length - 1;
      var svgH = pageRows.length * ROW_H + 24;
      var svgOut = rect(0, 0, W, svgH, '#FFFFFF');

      pageRows.forEach(function (row, ri) {
        var globalRi  = pi * ROWS_PER_PAGE + ri;
        var isFirstRow = globalRi === 0;
        var ry  = ri * ROW_H;
        var stT = ry + ST_OFF;
        var stB = stT + STAFF_H;
        var nx0 = isFirstRow ? NX0_FIRST : NX0_REST;
        var nw  = isFirstRow ? NW_FIRST  : NW_REST;

        for (var l = 0; l < 5; l++)
          svgOut += hLine(4, W - 4, stT + l * LINE_GAP, '#333333', 1);
        svgOut += vLine(4, stT, stB, '#333333', 1.5);
        svgOut += '<text x="5" y="' + (stB + 16) + '"'
               + ' font-size="70" font-family="Times New Roman, Times, serif"'
               + ' fill="#000000">&#x1D11E;</text>';

        if (isFirstRow) {
          var tx = CLEF_W + 2;
          svgOut += timeSigNum(tx, stT + LINE_GAP + 7,     '4');
          svgOut += timeSigNum(tx, stT + 3 * LINE_GAP + 7, '4');
          svgOut += '<text x="' + (CLEF_W + TIME_W + 14) + '" y="' + (stT - 5) + '"'
                 + ' font-size="11" font-family="sans-serif" fill="#333333">\u2669 = ' + BPM + '</text>';
        }

        row.forEach(function (note, ni) {
          var nx  = Math.round(nx0 + ni * nw + nw / 2);
          var gni = globalRi * PER_ROW + ni;

          if (!note) {
            var mid = stT + STAFF_H / 2 + 2;
            svgOut += seg(nx-3, mid-9,  nx+5, mid-3,  '#000000', 1.5);
            svgOut += seg(nx+5, mid-3,  nx-3, mid+4,  '#000000', 1.5);
            svgOut += seg(nx-3, mid+4,  nx+3, mid+11, '#000000', 1.5);
          } else {
            var sae = note.steps - 2;
            while (sae < -4) sae += 7;
            while (sae > 12) sae -= 7;
            var ny = stB - sae * STEP;

            if (sae <= -2) {
              var loLedger = (sae % 2 === 0) ? sae : sae + 1;
              for (var ls = -2; ls >= loLedger; ls -= 2)
                svgOut += hLine(nx-11, nx+11, stB - ls*STEP, '#333333', 1);
            }
            if (sae >= 10) {
              var hiLedger = (sae % 2 === 0) ? sae : sae - 1;
              for (var hs = 10; hs <= hiLedger; hs += 2)
                svgOut += hLine(nx-11, nx+11, stB - hs*STEP, '#333333', 1);
            }
            if (note.acc) {
              var ch = note.acc === '#' ? '&#x266F;' : '&#x266D;';
              svgOut += '<text x="' + (nx-16) + '" y="' + (ny+5) + '"'
                     + ' font-size="14" font-family="serif" fill="#000000">' + ch + '</text>';
            }
            svgOut += '<ellipse cx="' + nx + '" cy="' + ny + '"'
                   + ' rx="' + NH_RX + '" ry="' + NH_RY + '" fill="#000000"'
                   + ' transform="rotate(-15,' + nx + ',' + ny + ')"/>';
            var STEM_LEN = 30;
            if (sae < 4) {
              svgOut += vLine(nx+NH_RX, ny-NH_RY, ny-NH_RY-STEM_LEN, '#000000', 1.5);
            } else {
              svgOut += vLine(nx-NH_RX, ny+NH_RY, ny+NH_RY+STEM_LEN, '#000000', 1.5);
            }
          }

          if ((gni + 1) % BEATS === 0 && ni < row.length - 1) {
            var bx = Math.round(nx + nw / 2 + 1);
            svgOut += vLine(bx, stT, stB, '#333333', 1.5);
          }
        });

        svgOut += vLine(W - 4, stT, stB, '#333333', 1.5);
      });

      if (WATERMARK) {
        var wmText = 'Music-To-Sheet Preview \u2014 Upgrade for full version';
        var wmCx   = W / 2;
        [svgH * 0.22, svgH * 0.5, svgH * 0.78].forEach(function (wmY) {
          svgOut += '<text'
                 + ' x="' + wmCx + '" y="' + wmY + '"'
                 + ' font-size="16" font-family="sans-serif" font-weight="700"'
                 + ' fill="#DC143C" opacity="0.18" text-anchor="middle"'
                 + ' transform="rotate(-40,' + wmCx + ',' + wmY + ')">'
                 + wmText + '</text>';
        });
      }

      bodyHtml += '<div class="page' + (isLastPage ? '' : ' break') + '">';
      if (pi === 0) bodyHtml += HEADER_HTML;
      bodyHtml += '<svg width="' + W + '" height="' + svgH + '" xmlns="http://www.w3.org/2000/svg">' + svgOut + '</svg>';
      bodyHtml += FOOTER_HTML;
      bodyHtml += '</div>';
    });

    document.body.innerHTML = bodyHtml;

  } catch (e) {
    document.body.innerHTML =
      '<pre style="color:red;padding:14px;font-size:12px;white-space:pre-wrap">'
      + 'PDF render error:\\n' + e.message + '</pre>';
  }
})();

function rect(x, y, w, h, fill) {
  return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="'+fill+'"/>';
}
function hLine(x1, x2, y, s, sw) {
  return '<line x1="'+x1+'" y1="'+y+'" x2="'+x2+'" y2="'+y+'" stroke="'+s+'" stroke-width="'+sw+'"/>';
}
function vLine(x, y1, y2, s, sw) {
  return '<line x1="'+x+'" y1="'+y1+'" x2="'+x+'" y2="'+y2+'" stroke="'+s+'" stroke-width="'+sw+'"/>';
}
function seg(x1, y1, x2, y2, s, sw) {
  return '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+s+'" stroke-width="'+sw+'"/>';
}
function timeSigNum(x, y, n) {
  return '<text x="'+x+'" y="'+y+'" font-size="17" font-family="sans-serif"'
       + ' font-weight="bold" fill="#000000">'+n+'</text>';
}
</script>
</body>
</html>`;
}

// ─── Component ───────────────────────────────────────────────────────────────
const SheetMusicViewer = forwardRef(function SheetMusicViewer(
  { notes = [], musicxml = null, bpm = 120, onMessage },
  ref
) {
  // Use OSMD (professional renderer) when MusicXML is available;
  // fall back to the custom SVG renderer otherwise.
  const html = musicxml
    ? buildOsmdHtml(musicxml, notes, bpm)
    : buildHtml(notes, { bpm });

  return (
    <View style={styles.container}>
      <WebView
        ref={ref}
        source={{ html }}
        style={styles.webview}
        originWhitelist={['*']}
        scrollEnabled
        showsVerticalScrollIndicator={false}
        scalesPageToFit={false}
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        backgroundColor="#111118"
        onMessage={onMessage}
        onError={(e) =>
          console.log('[SheetMusicViewer] WebView error:', e.nativeEvent)
        }
      />
    </View>
  );
});

export default SheetMusicViewer;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 500,
    backgroundColor: '#111118',
  },
  webview: {
    flex: 1,
    minHeight: 500,
    backgroundColor: '#111118',
  },
});
