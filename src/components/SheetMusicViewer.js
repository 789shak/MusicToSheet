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
// Primary renderer when musicxml is available. Renders at 1200px then scales
// the viewport down to fit the phone screen — same technique as zoomed-out
// desktop sites on mobile. The WebView is horizontally + vertically scrollable
// so the user can pan and pinch-zoom.
function buildOsmdHtml(musicxml, notes, bpm) {
  // JSON.stringify safely escapes the XML string for embedding in JS
  const xmlJson   = JSON.stringify(musicxml);
  const notesJson = JSON.stringify(notes);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <!-- Render at 1200px logical width, scaled to fit screen width (~0.33 on a 390px phone) -->
  <meta name="viewport" content="width=1200, initial-scale=0.33, user-scalable=yes"/>
  <script src="https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@1.8.6/build/opensheetmusicdisplay.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { background: #111118; }
    body {
      background: #111118;
      padding: 16px;
      min-width: 1200px;   /* forces layout at full width — viewport scales it */
      min-height: 600px;
    }
    #status {
      color: #AAAAAA; font-size: 14px; font-family: sans-serif;
      padding: 12px 0; min-height: 24px;
    }
    #osmd-container {
      background: #FFFFFF;
      padding: 24px;
      border-radius: 8px;
      width: 100%;         /* fills the 1200px body */
      min-height: 500px;
    }
    #osmd-fallback {
      display: none;
      background: #1A1A24;
      border: 1px solid #2A2A3A;
      border-radius: 8px;
      padding: 32px 24px;
      text-align: center;
    }
    #osmd-fallback p {
      color: #AAAAAA; font-family: sans-serif; font-size: 14px;
      line-height: 1.6; margin-bottom: 8px;
    }
    #osmd-fallback .hint {
      color: #0EA5E9; font-size: 13px; font-weight: 600;
    }
  </style>
</head>
<body>
  <div id="status">Loading sheet music\u2026</div>
  <div id="osmd-container"></div>
  <div id="osmd-fallback">
    <p>Sheet music preview unavailable in this view.</p>
    <p class="hint">Tap \u201CDownload PDF\u201D to view the full sheet music.</p>
  </div>

<script>
// Notes + BPM available for the audio playback engine
window.__NOTES = ${notesJson};
window.__BPM   = ${bpm};

// ── OSMD initialisation ──────────────────────────────────────────────────────
var _fallbackTimer = setTimeout(function () {
  showFallback('Loading timed out');
}, 18000);

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

    var container = document.getElementById('osmd-container');
    // Explicit pixel width so OSMD doesn't measure a collapsed container
    container.style.width = '1160px';

    var osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay('osmd-container', {
      backend:           'svg',
      drawTitle:         false,
      drawComposer:      false,
      drawCredits:       false,
      autoResize:        false,   /* we control width ourselves */
      followCursor:      false,
      drawingParameters: 'compact',
    });

    // Wider measures = fewer notes crammed per line
    try {
      osmd.EngravingRules.MinimumDistanceBetweenSystems = 5;
    } catch (_) {}

    var xmlData = ${xmlJson};
    setStatus('Rendering notation\u2026');

    osmd.load(xmlData)
      .then(function () {
        osmd.render();
        clearTimeout(_fallbackTimer);
        setStatus('');

        // Expand body height to match the rendered SVG so nothing clips
        try {
          var svgEl = container.querySelector('svg');
          if (svgEl) {
            var h = parseInt(svgEl.getAttribute('height') || '0', 10);
            if (h > 0) document.body.style.minHeight = (h + 80) + 'px';
          }
        } catch (_) {}
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

// ─── SVG primitive helpers (used by buildPdfHtml and buildScreenHtml) ────────
function svgRect(x, y, w, h, fill) {
  return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="'+fill+'"/>';
}
function svgHLine(x1, x2, y, s, sw) {
  return '<line x1="'+x1+'" y1="'+y+'" x2="'+x2+'" y2="'+y+'" stroke="'+s+'" stroke-width="'+sw+'"/>';
}
function svgVLine(x, y1, y2, s, sw) {
  return '<line x1="'+x+'" y1="'+y1+'" x2="'+x+'" y2="'+y2+'" stroke="'+s+'" stroke-width="'+sw+'"/>';
}
function svgSeg(x1, y1, x2, y2, s, sw) {
  return '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+s+'" stroke-width="'+sw+'"/>';
}
function svgTimeSigNum(x, y, n) {
  return '<text x="'+x+'" y="'+y+'" font-size="17" font-family="sans-serif"'
       + ' font-weight="bold" fill="#000000">'+n+'</text>';
}

// ─── Build static SVG body HTML from notes ────────────────────────────────────
function buildPdfBodyHtml(notes, meta) {
  meta = meta || {};
  const trackName  = htmlEsc(meta.trackName  || 'Untitled');
  const instrument = htmlEsc(meta.instrument || 'Unknown');
  const format     = htmlEsc(meta.format     || 'Score');
  const date       = htmlEsc(
    meta.date ||
    new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  );
  const BPM       = meta.bpm || 120;
  const WATERMARK = !!meta.watermark;
  const username  = meta.username ? htmlEsc(String(meta.username)) : null;
  const fileName  = meta.fileName ? htmlEsc(String(meta.fileName)) : null;
  const duration  = meta.duration ? htmlEsc(String(meta.duration)) : null;
  const dateTime  = meta.dateTime ? htmlEsc(String(meta.dateTime)) : null;

  const DEGREE    = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
  const BEATS     = 4;
  const W             = 500;
  const LINE_GAP      = 12;
  const STEP          = LINE_GAP / 2;
  const STAFF_H       = 4 * LINE_GAP;
  const ROW_H         = 140;
  const ST_OFF        = 48;
  const NH_RX         = 5;
  const NH_RY         = 4;
  const CLEF_W        = 52;
  const TIME_W        = 24;
  const PER_ROW       = 8;
  const ROWS_PER_PAGE = 7;

  const NX0_FIRST = CLEF_W + TIME_W + 8;
  const NX0_REST  = CLEF_W + 8;
  const NW_FIRST  = (W - NX0_FIRST - 6) / PER_ROW;
  const NW_REST   = (W - NX0_REST  - 6) / PER_ROW;

  function parsePitch(p) {
    const m = (p || '').match(/^([A-G])([#b]?)([0-9])$/);
    if (!m || DEGREE[m[1]] === undefined) return null;
    return { steps: (parseInt(m[3], 10) - 4) * 7 + DEGREE[m[1]], acc: m[2] || null };
  }

  const INPUT = (notes && notes.length) ? notes : [
    {pitch:'C4'},{pitch:'D4'},{pitch:'E4'},{pitch:'F4'},
    {pitch:'G4'},{pitch:'A4'},{pitch:'B4'},{pitch:'C5'},
    {pitch:'E5'},{pitch:'D5'},{pitch:'C5'},{pitch:'B4'},
    {pitch:'A4'},{pitch:'G4'},{pitch:'F4'},{pitch:'E4'}
  ];

  const parsed = INPUT.map(n => parsePitch(n.pitch));

  const allRows = [];
  for (let i = 0; i < parsed.length; i += PER_ROW)
    allRows.push(parsed.slice(i, i + PER_ROW));

  const allPages = [];
  for (let p = 0; p < allRows.length; p += ROWS_PER_PAGE)
    allPages.push(allRows.slice(p, p + ROWS_PER_PAGE));

  // maxPages: optional limit — guest users export only the first N pages
  const maxPages = (meta.maxPages != null) ? Number(meta.maxPages) : null;
  const pages = (maxPages !== null) ? allPages.slice(0, maxPages) : allPages;

  const metaRow = (lbl, val) => val
    ? '<div class="meta-row"><span class="meta-lbl">' + lbl + ':</span> ' + val + '</div>'
    : '';
  const HEADER_HTML =
    '<div class="meta-block">'
    + '<div class="meta-title">' + trackName + '</div>'
    + (username ? metaRow('User',       username) : '')
    + metaRow('File',       fileName)
    + metaRow('Duration',   duration)
    + metaRow('Date',       dateTime || date)
    + metaRow('BPM',        String(BPM))
    + metaRow('Instrument', instrument)
    + metaRow('Format',     format)
    + '</div>'
    + '<div class="meta-sep"></div>';

  const FOOTER_HTML =
    '<div class="footer">'
    + 'Generated by Music-To-Sheet &nbsp;|&nbsp; musictosheet.com &nbsp;|&nbsp;'
    + '<span style="color:#DC143C">For personal use only</span>'
    + ' \u2014 not licensed for distribution'
    + '</div>';

  let bodyHtml = '';

  pages.forEach((pageRows, pi) => {
    const isLastPage = pi === pages.length - 1;
    const svgH = pageRows.length * ROW_H + 24;
    let svgOut = svgRect(0, 0, W, svgH, '#FFFFFF');

    pageRows.forEach((row, ri) => {
      const globalRi  = pi * ROWS_PER_PAGE + ri;
      const isFirstRow = globalRi === 0;
      const ry  = ri * ROW_H;
      const stT = ry + ST_OFF;
      const stB = stT + STAFF_H;
      const nx0 = isFirstRow ? NX0_FIRST : NX0_REST;
      const nw  = isFirstRow ? NW_FIRST  : NW_REST;

      for (let l = 0; l < 5; l++)
        svgOut += svgHLine(4, W - 4, stT + l * LINE_GAP, '#333333', 1);
      svgOut += svgVLine(4, stT, stB, '#333333', 1.5);
      svgOut += '<text x="5" y="' + (stB + 16) + '"'
             + ' font-size="70" font-family="Times New Roman, Times, serif"'
             + ' fill="#000000">&#x1D11E;</text>';

      if (isFirstRow) {
        const tx = CLEF_W + 2;
        svgOut += svgTimeSigNum(tx, stT + LINE_GAP + 7,     '4');
        svgOut += svgTimeSigNum(tx, stT + 3 * LINE_GAP + 7, '4');
        svgOut += '<text x="' + (CLEF_W + TIME_W + 14) + '" y="' + (stT - 5) + '"'
               + ' font-size="11" font-family="sans-serif" fill="#333333">\u2669 = ' + BPM + '</text>';
      }

      row.forEach((note, ni) => {
        const nx  = Math.round(nx0 + ni * nw + nw / 2);
        const gni = globalRi * PER_ROW + ni;

        if (!note) {
          const mid = stT + STAFF_H / 2 + 2;
          svgOut += svgSeg(nx-3, mid-9,  nx+5, mid-3,  '#000000', 1.5);
          svgOut += svgSeg(nx+5, mid-3,  nx-3, mid+4,  '#000000', 1.5);
          svgOut += svgSeg(nx-3, mid+4,  nx+3, mid+11, '#000000', 1.5);
        } else {
          let sae = note.steps - 2;
          while (sae < -4) sae += 7;
          while (sae > 12) sae -= 7;
          const ny = stB - sae * STEP;

          if (sae <= -2) {
            const loLedger = (sae % 2 === 0) ? sae : sae + 1;
            for (let ls = -2; ls >= loLedger; ls -= 2)
              svgOut += svgHLine(nx-11, nx+11, stB - ls*STEP, '#333333', 1);
          }
          if (sae >= 10) {
            const hiLedger = (sae % 2 === 0) ? sae : sae - 1;
            for (let hs = 10; hs <= hiLedger; hs += 2)
              svgOut += svgHLine(nx-11, nx+11, stB - hs*STEP, '#333333', 1);
          }
          if (note.acc) {
            const ch = note.acc === '#' ? '&#x266F;' : '&#x266D;';
            svgOut += '<text x="' + (nx-16) + '" y="' + (ny+5) + '"'
                   + ' font-size="14" font-family="serif" fill="#000000">' + ch + '</text>';
          }
          svgOut += '<ellipse cx="' + nx + '" cy="' + ny + '"'
                 + ' rx="' + NH_RX + '" ry="' + NH_RY + '" fill="#000000"'
                 + ' transform="rotate(-15,' + nx + ',' + ny + ')"/>';
          const STEM_LEN = 30;
          if (sae < 4) {
            svgOut += svgVLine(nx+NH_RX, ny-NH_RY, ny-NH_RY-STEM_LEN, '#000000', 1.5);
          } else {
            svgOut += svgVLine(nx-NH_RX, ny+NH_RY, ny+NH_RY+STEM_LEN, '#000000', 1.5);
          }
        }

        if ((gni + 1) % BEATS === 0 && ni < row.length - 1) {
          const bx = Math.round(nx + nw / 2 + 1);
          svgOut += svgVLine(bx, stT, stB, '#333333', 1.5);
        }
      });

      svgOut += svgVLine(W - 4, stT, stB, '#333333', 1.5);
    });

    if (WATERMARK) {
      const wmText = 'Music-To-Sheet Preview \u2014 Upgrade for full version';
      const wmCx   = W / 2;
      [svgH * 0.22, svgH * 0.5, svgH * 0.78].forEach(wmY => {
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

  return bodyHtml;
}

// ─── Static PDF HTML builder (exported for use in ResultsScreen) ─────────────
// Fully static: ALL SVG/HTML content is pre-built as a string — no <script> tag,
// no runtime DOM injection. expo-print sees the complete body on first render.
export function buildStaticPdfHtml(notes, meta) {
  meta = meta || {};
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 20mm 20mm 20mm 45mm; }
  html, body { background: #FFFFFF; font-family: sans-serif; }
  .page { }
  .page.break { page-break-after: always; }
  /* Center the fixed-width SVG within the A4 content area */
  svg { display: block; margin: 0 auto; }
  /* Metadata block — print-friendly */
  .meta-block { background: #F8F9FA; padding: 10px 12px 8px; border-radius: 4px;
                margin-bottom: 14px; border-left: 3px solid #0EA5E9; }
  .meta-title { font-size: 14px; font-weight: 700; color: #111118; margin-bottom: 5px; }
  .meta-row   { font-size: 11px; line-height: 1.7; color: #444444; }
  .meta-lbl   { color: #888888; font-weight: 600; display: inline-block; min-width: 75px; }
  .meta-sep   { display: none; }
  .footer { padding-top: 10px; border-top: 1px solid #E5E7EB; font-size: 9px; color: #333333; text-align: center; margin-top: 8px; }
</style>
</head>
<body>
${buildPdfBodyHtml(notes, meta)}
</body>
</html>`;
}

// ─── Screen preview HTML (with page-based locking for guest users) ───────────
// Renders ALL notes. Pages at or past lockedFromPage are wrapped in a
// CSS-blurred div and preceded by an upgrade overlay on the first locked page.
// The PDF path (buildPdfHtml) uses maxPages in meta to cap exported pages.
export function buildScreenHtml(notes, meta) {
  meta = meta || {};
  const BPM        = meta.bpm || 120;
  const trackName  = htmlEsc(meta.trackName  || 'Untitled');
  const instrument = htmlEsc(meta.instrument || 'Unknown');
  const format     = htmlEsc(meta.format     || 'Score');
  const WATERMARK  = !!meta.watermark;
  const username   = meta.username ? htmlEsc(String(meta.username)) : null;
  const fileName   = meta.fileName ? htmlEsc(String(meta.fileName)) : null;
  const duration   = meta.duration ? htmlEsc(String(meta.duration)) : null;
  const dateTime   = meta.dateTime ? htmlEsc(String(meta.dateTime)) : null;
  // lockedFromPage: 0-indexed page index from which all subsequent pages are locked.
  // null or Infinity → no locking (authenticated users see all pages clearly).
  const lockedFromPage = (meta.lockedFromPage != null && isFinite(meta.lockedFromPage))
                           ? Number(meta.lockedFromPage) : null;
  const notesJson  = JSON.stringify(notes);

  // ── Layout constants (kept in sync with buildPdfBodyHtml) ──────────────────
  const DEGREE        = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
  const BEATS         = 4;
  const W             = 500;
  const LINE_GAP      = 12;
  const STEP          = LINE_GAP / 2;
  const STAFF_H       = 4 * LINE_GAP;
  const ROW_H         = 140;
  const ST_OFF        = 48;
  const NH_RX         = 5;
  const NH_RY         = 4;
  const CLEF_W        = 52;
  const TIME_W        = 24;
  const PER_ROW       = 8;
  const ROWS_PER_PAGE = 7;

  const NX0_FIRST = CLEF_W + TIME_W + 8;
  const NX0_REST  = CLEF_W + 8;
  const NW_FIRST  = (W - NX0_FIRST - 6) / PER_ROW;
  const NW_REST   = (W - NX0_REST  - 6) / PER_ROW;

  function parsePitch(p) {
    const m = (p || '').match(/^([A-G])([#b]?)([0-9])$/);
    if (!m || DEGREE[m[1]] === undefined) return null;
    return { steps: (parseInt(m[3], 10) - 4) * 7 + DEGREE[m[1]], acc: m[2] || null };
  }

  const INPUT = (notes && notes.length) ? notes : [
    {pitch:'C4',start:0},{pitch:'D4',start:0.5},{pitch:'E4',start:1},{pitch:'F4',start:1.5},
    {pitch:'G4',start:2},{pitch:'A4',start:2.5},{pitch:'B4',start:3},{pitch:'C5',start:3.5},
    {pitch:'E5',start:4},{pitch:'D5',start:4.5},{pitch:'C5',start:5},{pitch:'B4',start:5.5},
    {pitch:'A4',start:6},{pitch:'G4',start:6.5},{pitch:'F4',start:7},{pitch:'E4',start:7.5},
  ];

  const totalPages = Math.ceil(INPUT.length / (ROWS_PER_PAGE * PER_ROW)) || 1;
  console.log(
    '[SheetMusicViewer] page lock from:', lockedFromPage,
    '| total notes:', INPUT.length, '| total pages:', totalPages
  );

  const parsed = INPUT.map(n => parsePitch(n.pitch));

  const allRows = [];
  for (let i = 0; i < parsed.length; i += PER_ROW)
    allRows.push(parsed.slice(i, i + PER_ROW));

  const pages = [];
  for (let p = 0; p < allRows.length; p += ROWS_PER_PAGE)
    pages.push(allRows.slice(p, p + ROWS_PER_PAGE));

  // ── Build SVG inner content for a slice of rows ────────────────────────────
  // rowsData      : array of parsed-note arrays to render
  // globalRowStart: global row index of rowsData[0] (used only for isFirstRow check)
  function buildRowsSvg(rowsData, globalRowStart) {
    const svgH = rowsData.length * ROW_H + 24;
    let out = svgRect(0, 0, W, svgH, '#FFFFFF');

    rowsData.forEach((row, li) => {
      const globalRi  = globalRowStart + li;
      const isFirstRow = globalRi === 0;
      const ry  = li * ROW_H;      // y-origin within THIS svg
      const stT = ry + ST_OFF;
      const stB = stT + STAFF_H;
      const nx0 = isFirstRow ? NX0_FIRST : NX0_REST;
      const nw  = isFirstRow ? NW_FIRST  : NW_REST;

      for (let l = 0; l < 5; l++)
        out += svgHLine(4, W - 4, stT + l * LINE_GAP, '#333333', 1);
      out += svgVLine(4, stT, stB, '#333333', 1.5);
      out += '<text x="5" y="' + (stB + 16) + '"'
           + ' font-size="70" font-family="Times New Roman, Times, serif"'
           + ' fill="#000000">&#x1D11E;</text>';

      if (isFirstRow) {
        const tx = CLEF_W + 2;
        out += svgTimeSigNum(tx, stT + LINE_GAP + 7,     '4');
        out += svgTimeSigNum(tx, stT + 3 * LINE_GAP + 7, '4');
        out += '<text x="' + (CLEF_W + TIME_W + 14) + '" y="' + (stT - 5) + '"'
             + ' font-size="11" font-family="sans-serif" fill="#333333">\u2669 = ' + BPM + '</text>';
      }

      row.forEach((note, ni) => {
        const nx  = Math.round(nx0 + ni * nw + nw / 2);
        const gni = globalRi * PER_ROW + ni;

        if (!note) {
          const mid = stT + STAFF_H / 2 + 2;
          out += svgSeg(nx-3, mid-9,  nx+5, mid-3,  '#000000', 1.5);
          out += svgSeg(nx+5, mid-3,  nx-3, mid+4,  '#000000', 1.5);
          out += svgSeg(nx-3, mid+4,  nx+3, mid+11, '#000000', 1.5);
        } else {
          let sae = note.steps - 2;
          while (sae < -4) sae += 7;
          while (sae > 12) sae -= 7;
          const ny = stB - sae * STEP;

          if (sae <= -2) {
            const loLedger = (sae % 2 === 0) ? sae : sae + 1;
            for (let ls = -2; ls >= loLedger; ls -= 2)
              out += svgHLine(nx-11, nx+11, stB - ls*STEP, '#333333', 1);
          }
          if (sae >= 10) {
            const hiLedger = (sae % 2 === 0) ? sae : sae - 1;
            for (let hs = 10; hs <= hiLedger; hs += 2)
              out += svgHLine(nx-11, nx+11, stB - hs*STEP, '#333333', 1);
          }
          if (note.acc) {
            const ch = note.acc === '#' ? '&#x266F;' : '&#x266D;';
            out += '<text x="' + (nx-16) + '" y="' + (ny+5) + '"'
                 + ' font-size="14" font-family="serif" fill="#000000">' + ch + '</text>';
          }
          out += '<ellipse cx="' + nx + '" cy="' + ny + '"'
               + ' rx="' + NH_RX + '" ry="' + NH_RY + '" fill="#000000"'
               + ' transform="rotate(-15,' + nx + ',' + ny + ')"/>';
          const STEM_LEN = 30;
          if (sae < 4) {
            out += svgVLine(nx+NH_RX, ny-NH_RY, ny-NH_RY-STEM_LEN, '#000000', 1.5);
          } else {
            out += svgVLine(nx-NH_RX, ny+NH_RY, ny+NH_RY+STEM_LEN, '#000000', 1.5);
          }
        }

        if ((gni + 1) % BEATS === 0 && ni < row.length - 1) {
          const bx = Math.round(nx + nw / 2 + 1);
          out += svgVLine(bx, stT, stB, '#333333', 1.5);
        }
      });
      out += svgVLine(W - 4, stT, stB, '#333333', 1.5);
    });

    if (WATERMARK) {
      const wmText = 'Music-To-Sheet Preview \u2014 Upgrade for full version';
      const wmCx   = W / 2;
      [svgH * 0.22, svgH * 0.5, svgH * 0.78].forEach(wmY => {
        out += '<text x="' + wmCx + '" y="' + wmY + '"'
             + ' font-size="16" font-family="sans-serif" font-weight="700"'
             + ' fill="#DC143C" opacity="0.18" text-anchor="middle"'
             + ' transform="rotate(-40,' + wmCx + ',' + wmY + ')">'
             + wmText + '</text>';
      });
    }

    return { content: out, height: svgH };
  }

  function makeSvg(content, height) {
    return '<svg width="' + W + '" height="' + height
         + '" xmlns="http://www.w3.org/2000/svg">' + content + '</svg>';
  }

  const metaRow = (lbl, val) => val
    ? '<div class="meta-row"><span class="meta-lbl">' + lbl + ':</span> ' + val + '</div>'
    : '';
  const HEADER_HTML =
    '<div class="meta-block">'
    + '<div class="meta-title">' + trackName + '</div>'
    + (username ? metaRow('User',       username) : '')
    + metaRow('File',       fileName)
    + metaRow('Duration',   duration)
    + metaRow('Date',       dateTime)
    + metaRow('BPM',        String(BPM))
    + metaRow('Instrument', instrument)
    + metaRow('Format',     format)
    + '</div>'
    + '<div class="meta-sep"></div>';

  const FOOTER_HTML =
    '<div class="footer">'
    + 'Generated by Music-To-Sheet &nbsp;|&nbsp; musictosheet.com &nbsp;|&nbsp;'
    + '<span style="color:#DC143C">For personal use only</span>'
    + ' \u2014 not licensed for distribution'
    + '</div>';

  let bodyHtml = '';

  pages.forEach((pageRows, pi) => {
    const isLastPage    = pi === pages.length - 1;
    const globalRowStart = pi * ROWS_PER_PAGE;
    const isPageLocked  = lockedFromPage !== null && pi >= lockedFromPage;
    const isFirstLocked = lockedFromPage !== null && pi === lockedFromPage;

    bodyHtml += '<div class="page' + (isLastPage ? '' : ' break') + '">';
    if (pi === 0) bodyHtml += HEADER_HTML;

    if (!isPageLocked) {
      // ── Clear page ──
      const { content, height } = buildRowsSvg(pageRows, globalRowStart);
      bodyHtml += makeSvg(content, height);
    } else {
      // ── Locked page: upgrade overlay (first locked page only) + blurred content ──
      if (isFirstLocked) {
        bodyHtml +=
          '<div class="upgrade-overlay">'
          + '<div class="upgrade-icon">\uD83D\uDD12</div>'
          + '<div class="upgrade-heading">Unlock All Pages</div>'
          + '<button class="upgrade-btn-primary" onclick="postNav(\'/\')">'
          + 'Sign Up Free \u2014 Unlock All Pages</button>'
          + '<button class="upgrade-btn-outline" onclick="postNav(\'/subscription\')">'
          + 'Upgrade to Pro \u2014 Remove Watermark</button>'
          + '</div>';
      }
      const { content, height } = buildRowsSvg(pageRows, globalRowStart);
      bodyHtml += '<div class="locked-staves">' + makeSvg(content, height) + '</div>';
    }

    bodyHtml += FOOTER_HTML;
    bodyHtml += '</div>';
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=540, initial-scale=0.72, user-scalable=yes"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #FFFFFF; font-family: sans-serif; }
  .page { }
  /* Centre the fixed-width SVG (500px) within the 540px viewport */
  svg { display: block; margin: 0 auto; }
  /* Metadata info block — dark theme */
  .meta-block { background: #111118; padding: 12px 14px 10px; font-family: sans-serif; }
  .meta-title { font-size: 14px; font-weight: 700; color: #FFFFFF; margin-bottom: 6px; }
  .meta-row   { font-size: 12px; line-height: 1.8; color: #AAAAAA; }
  .meta-lbl   { color: #666666; font-weight: 600; display: inline-block; min-width: 82px; }
  .meta-sep   { height: 1px; background: #2D2D3E; margin-bottom: 10px; }
  .footer { padding-top: 10px; border-top: 1px solid #2D2D3E; font-size: 9px;
            color: #666666; text-align: center; margin-top: 8px; }
  /* Locked staves: CSS blur makes notes completely unreadable */
  .locked-staves {
    filter: blur(10px);
    -webkit-filter: blur(10px);
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
  }
  /* Upgrade overlay — shown once at the top of the first locked page */
  .upgrade-overlay {
    background: #111118;
    border: 1px solid #2D2D3E;
    border-radius: 12px;
    padding: 24px 20px 20px;
    margin: 8px 0 12px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .upgrade-icon { font-size: 26px; }
  .upgrade-heading {
    color: #FFFFFF; font-size: 18px; font-weight: 700; font-family: sans-serif;
  }
  .upgrade-btn-primary {
    width: 100%; background: #0EA5E9; color: #FFFFFF;
    border: none; border-radius: 10px; padding: 13px 16px;
    font-size: 14px; font-weight: 700; cursor: pointer; font-family: sans-serif;
  }
  .upgrade-btn-outline {
    width: 100%; background: transparent; color: #0EA5E9;
    border: 1.5px solid #0EA5E9; border-radius: 10px; padding: 12px 16px;
    font-size: 14px; font-weight: 600; cursor: pointer; font-family: sans-serif;
  }
</style>
</head>
<body>
${bodyHtml}
<script>
window.__NOTES = ${notesJson};
window.__BPM   = ${BPM};
var _pbCtx=null,_pbTimer=null,_pbTotal=0,_pbStart=0;
var _NS={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
function _freq(p){
  var m=String(p).match(/^([A-G][#b]?)(-?[0-9]+)$/);
  if(!m)return 0;
  var s=_NS[m[1]];
  if(s===undefined)return 0;
  return 440*Math.pow(2,((parseInt(m[2])+1)*12+s-69)/12);
}
function _tone(ctx,freq,t0,dur){
  if(freq<=0||dur<=0)return;
  var osc=ctx.createOscillator(),g=ctx.createGain();
  osc.connect(g); g.connect(ctx.destination);
  osc.type='sine'; osc.frequency.value=freq;
  var att=Math.min(0.015,dur*0.1),rel=Math.min(0.06,dur*0.25);
  g.gain.setValueAtTime(0,t0);
  g.gain.linearRampToValueAtTime(0.3,t0+att);
  g.gain.setValueAtTime(0.3,t0+dur-rel);
  g.gain.linearRampToValueAtTime(0,t0+dur);
  osc.start(t0); osc.stop(t0+dur+0.01);
}
function _post(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o));}catch(e){}}
function postNav(route){try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'nav',route:route}));}catch(e){}}
function _tick(){
  if(!_pbCtx||_pbCtx.state!=='running')return;
  var el=_pbCtx.currentTime-_pbStart;
  _post({type:'progress',currentTime:Math.min(el,_pbTotal),totalTime:_pbTotal});
  if(el<_pbTotal+0.3){_pbTimer=setTimeout(_tick,80);}
  else{_pbTimer=null;_post({type:'ended'});}
}
function _stopPb(){
  if(_pbTimer){clearTimeout(_pbTimer);_pbTimer=null;}
  if(_pbCtx){try{_pbCtx.close();}catch(e){}_pbCtx=null;}
}
function _schedulePb(){
  var ns=window.__NOTES||[],bpm=window.__BPM||120,bpmScale=120/bpm;
  var t0=_pbCtx.currentTime+0.1,maxEnd=t0;
  for(var i=0;i<ns.length;i++){
    var n=ns[i];
    var noteStart=t0+(n.start||0)*bpmScale;
    var dur=Math.max(0.05,(n.duration||0.25)*bpmScale);
    _tone(_pbCtx,_freq(n.pitch),noteStart,dur*0.88);
    var noteEnd=noteStart+dur;
    if(noteEnd>maxEnd) maxEnd=noteEnd;
  }
  _pbStart=t0; _pbTotal=maxEnd-t0;
  _post({type:'totalTime',totalTime:_pbTotal});
  _pbTimer=setTimeout(_tick,80);
}
function handlePlaybackCommand(cmd){
  if(cmd.type==='play'){
    _stopPb();
    _pbCtx=new(window.AudioContext||window.webkitAudioContext)();
    _pbCtx.resume().then(function(){ _schedulePb(); });
  } else if(cmd.type==='pause'){
    if(_pbCtx&&_pbCtx.state==='running'){
      _pbCtx.suspend();
      if(_pbTimer){clearTimeout(_pbTimer);_pbTimer=null;}
      _post({type:'paused'});
    }
  } else if(cmd.type==='resume'){
    if(_pbCtx&&_pbCtx.state==='suspended'){
      _pbCtx.resume().then(function(){ _tick(); });
      _post({type:'resumed'});
    }
  } else if(cmd.type==='stop'){
    _stopPb(); _post({type:'stopped'});
  }
}
</script>
</body>
</html>`;
}

// ─── OSMD screen HTML ────────────────────────────────────────────────────────
// Primary in-app renderer when musicxml is available. The XML is URL-encoded so
// it embeds safely inside a JS string without any escaping edge-cases.
function buildOsmdScreenHtml(musicxml) {
  const encoded = encodeURIComponent(musicxml);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes"/>
  <script src="https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@1.8.6/build/opensheetmusicdisplay.min.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #ffffff; padding: 10px; }
    #osmd { width: 100%; }
    #fallback { display: none; color: #666; font-family: sans-serif; font-size: 13px;
                padding: 20px; text-align: center; }
  </style>
</head>
<body>
  <div id="osmd"></div>
  <div id="fallback">Sheet music preview unavailable. Tap Download PDF to view.</div>
  <script>
    (function () {
      if (typeof opensheetmusicdisplay === 'undefined') {
        document.getElementById('osmd').style.display = 'none';
        document.getElementById('fallback').style.display = 'block';
        return;
      }
      var osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay('osmd', {
        backend: 'svg',
        drawTitle: false,
        drawComposer: false,
        autoResize: true
      });
      var musicxml = decodeURIComponent('${encoded}');
      osmd.load(musicxml).then(function () {
        osmd.render();
        try {
          var h = document.getElementById('osmd').scrollHeight;
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'height', value: h }));
        } catch (e) {}
      }).catch(function (err) {
        document.getElementById('osmd').style.display = 'none';
        document.getElementById('fallback').style.display = 'block';
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'osmd_error', message: err.message }));
        } catch (e) {}
      });
    })();
  <\/script>
</body>
</html>`;
}

// ─── OSMD PDF HTML ────────────────────────────────────────────────────────────
// Used by handleDownloadPdf and handleShare in ResultsScreen. Renders the same
// MusicXML via OSMD with a white background, header, and footer for print.
export function buildOsmdPdfHtml(musicxml, meta) {
  meta = meta || {};
  const trackName  = htmlEsc(meta.trackName  || 'Untitled');
  const instrument = htmlEsc(meta.instrument || 'Unknown');
  const format     = htmlEsc(meta.format     || 'Score');
  const date       = htmlEsc(
    meta.date ||
    new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  );
  const bpm       = meta.bpm || 120;
  const watermark = meta.watermark || false;
  const encoded   = encodeURIComponent(musicxml);

  const watermarkHtml = watermark
    ? `<div style="position:fixed;top:50%;left:50%;
         transform:translate(-50%,-50%) rotate(-40deg);
         font-size:24px;font-weight:700;color:rgba(220,20,60,0.18);
         white-space:nowrap;pointer-events:none;z-index:999;">
         Music-To-Sheet Preview \u2014 Upgrade for full version
       </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { margin: 15mm; }
    body { background: #ffffff; font-family: sans-serif; padding: 0 10px; }
    .header { padding-bottom: 12px; border-bottom: 1px solid #E5E7EB; margin-bottom: 14px; }
    .header-title { font-size: 18px; font-weight: 700; color: #111118; margin-bottom: 4px; }
    .header-meta  { font-size: 12px; color: #6B7280; }
    .footer { padding-top: 10px; border-top: 1px solid #E5E7EB; font-size: 9px;
              color: #333333; text-align: center; margin-top: 12px; }
    #osmd { width: 100%; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@1.8.6/build/opensheetmusicdisplay.min.js"><\/script>
</head>
<body>
  ${watermarkHtml}
  <div class="header">
    <div class="header-title">${trackName}</div>
    <div class="header-meta">${instrument} &middot; ${format} &middot; ${date} &middot; &#9833; = ${bpm}</div>
  </div>
  <div id="osmd"></div>
  <div class="footer">
    Generated by Music-To-Sheet &nbsp;|&nbsp; musictosheet.com &nbsp;|&nbsp;
    <span style="color:#DC143C">For personal use only</span>
    &nbsp;&mdash;&nbsp; not licensed for distribution
  </div>
  <script>
    (function () {
      if (typeof opensheetmusicdisplay === 'undefined') {
        document.getElementById('osmd').innerHTML =
          '<p style="color:#666;font-size:12px;padding:20px;">Sheet music unavailable (CDN unreachable).</p>';
        return;
      }
      var osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay('osmd', {
        backend: 'svg',
        drawTitle: false,
        drawComposer: false,
        autoResize: false,
        pageFormat: 'A4_P'
      });
      var musicxml = decodeURIComponent('${encoded}');
      osmd.load(musicxml).then(function () {
        osmd.render();
      }).catch(function (err) {
        document.getElementById('osmd').innerHTML =
          '<p style="color:red;font-size:12px;">Rendering error: ' + err.message + '</p>';
      });
    })();
  <\/script>
</body>
</html>`;
}

// ─── Component ───────────────────────────────────────────────────────────────
// Priority: musicxml (OSMD) > previewHtml (SVG fallback) > notes (SVG fallback)
/**
 * @param {{ notes?: object[], previewHtml?: string|null, musicxml?: string|null, bpm?: number, onMessage?: Function }} props
 * @param {any} ref
 */
const SheetMusicViewer = forwardRef(function SheetMusicViewer(
  { notes = [], previewHtml = null, musicxml = null, bpm = 120, onMessage },
  ref
) {
  let html;
  if (previewHtml) {
    html = previewHtml;                    // SVG via buildScreenHtml — matches PDF quality
  } else if (musicxml) {
    html = buildOsmdScreenHtml(musicxml);  // OSMD (CDN-dependent, future option)
  } else {
    html = buildHtml(notes, { bpm });      // custom SVG fallback
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={ref}
        source={{ html }}
        style={styles.webview}
        originWhitelist={['*']}
        scrollEnabled
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        scalesPageToFit={false}   /* viewport meta controls scale */
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        backgroundColor="#FFFFFF"
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
