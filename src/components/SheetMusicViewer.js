import { StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';

// ─── SVG sheet-music builder (no external dependencies) ─────────────────────
function buildHtml(notes) {
  const notesJson = JSON.stringify(notes);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background-color: #111118; min-height: 500px; }
  #sheet { display: block; }
</style>
</head>
<body>
<svg id="sheet" xmlns="http://www.w3.org/2000/svg"></svg>
<script>
(function () {
  try {

    // ── Notes from React Native ──────────────────────────────────────────
    var notes = ${notesJson};

    // ── Music constants ──────────────────────────────────────────────────
    var DEGREE = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
    var BEATS  = 4;   // quarter notes per measure (4/4 time)

    // ── Layout constants ─────────────────────────────────────────────────
    var W         = Math.floor(window.innerWidth);
    var LINE_GAP  = 10;             // px between adjacent staff lines
    var STEP      = LINE_GAP / 2;   // px per diatonic half-step
    var STAFF_H   = 4 * LINE_GAP;   // 40px (top line to bottom line)
    var ROW_H     = 130;            // total px per staff row (incl. stem/ledger room)
    var ST_OFF    = 45;             // y from row top to first (top) staff line

    var CLEF_W    = 52;             // px reserved for treble clef
    var TIME_W    = 24;             // px reserved for time sig (row 0 only)
    var PER_ROW   = 8;              // notes per row; must be a multiple of BEATS

    // Note slot width (computed from row 0 which is the tightest)
    var NX0_FIRST = CLEF_W + TIME_W + 8;
    var NX0_REST  = CLEF_W + 8;
    var NW_FIRST  = (W - NX0_FIRST - 6) / PER_ROW;
    var NW_REST   = (W - NX0_REST  - 6) / PER_ROW;

    // ── Parse pitch string → { steps, acc } ─────────────────────────────
    //   steps = diatonic steps above C4 (middle C)
    //   E.g.  C4→0  D4→1  E4→2  G4→4  C5→7  F5→10
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

    var out = rect(0, 0, W, totalH, '#111118'); // background

    rows.forEach(function (row, ri) {
      var isFirst = ri === 0;
      var ry  = ri * ROW_H;
      var stT = ry + ST_OFF;       // y of top staff line   (F5)
      var stB = stT + STAFF_H;     // y of bottom staff line (E4)
      var nx0 = isFirst ? NX0_FIRST : NX0_REST;
      var nw  = isFirst ? NW_FIRST  : NW_REST;

      // ── Staff lines ────────────────────────────────────────────────
      for (var l = 0; l < 5; l++)
        out += hLine(4, W - 4, stT + l * LINE_GAP, '#AAAAAA', 1);

      // ── Left barline ───────────────────────────────────────────────
      out += vLine(4, stT, stB, '#AAAAAA', 1.5);

      // ── Treble clef ────────────────────────────────────────────────
      // U+1D11E 𝄞 — baseline at stB+14 so the G-curl sits near G4 line
      out += '<text x="5" y="' + (stB + 14) + '"'
           + ' font-size="64" font-family="\\'Times New Roman\\', Times, serif"'
           + ' fill="#FFFFFF">&#x1D11E;</text>';

      // ── Time signature (row 0 only) ────────────────────────────────
      if (isFirst) {
        var tx = CLEF_W + 2;
        out += timeSigNum(tx, stT + LINE_GAP + 7,     '4');
        out += timeSigNum(tx, stT + 3 * LINE_GAP + 7, '4');
      }

      // ── Notes ─────────────────────────────────────────────────────
      row.forEach(function (note, ni) {
        var nx  = nx0 + ni * nw + nw / 2;   // center x of this note slot
        var gni = ri * PER_ROW + ni;         // global note index

        if (!note) {
          // ── Quarter rest (simplified zigzag) ─────────────────────
          var mid = stT + STAFF_H / 2 + 2;
          out += seg(nx - 3, mid - 9,  nx + 5, mid - 3, '#FFFFFF', 1.5);
          out += seg(nx + 5, mid - 3,  nx - 3, mid + 4, '#FFFFFF', 1.5);
          out += seg(nx - 3, mid + 4,  nx + 3, mid + 11,'#FFFFFF', 1.5);
        } else {
          // ── Pitched note ──────────────────────────────────────────
          // steps above E4 (bottom staff line)
          var sae = note.steps - 2;
          var ny  = stB - sae * STEP;   // pixel y of notehead centre

          // ── Ledger lines below staff ───────────────────────────────
          // C4 = sae −2, A3 = sae −4, F3 = sae −6 …
          if (sae <= -2) {
            var lo = (sae % 2 === 0) ? sae : sae + 1;
            for (var s = -2; s >= lo; s -= 2)
              out += hLine(nx - 11, nx + 11, stB - s * STEP, '#AAAAAA', 1);
          }

          // ── Ledger lines above staff ───────────────────────────────
          // G5 = sae 10, B5 = sae 12, D6 = sae 14 …
          if (sae >= 10) {
            var hi = (sae % 2 === 0) ? sae : sae - 1;
            for (var s = 10; s <= hi; s += 2)
              out += hLine(nx - 11, nx + 11, stB - s * STEP, '#AAAAAA', 1);
          }

          // ── Accidental ────────────────────────────────────────────
          if (note.acc) {
            var ch = note.acc === '#' ? '&#x266F;' : '&#x266D;';
            out += '<text x="' + (nx - 17) + '" y="' + (ny + 5) + '"'
                 + ' font-size="14" font-family="serif" fill="#FFFFFF">' + ch + '</text>';
          }

          // ── Notehead (filled ellipse, tilted −15°) ────────────────
          out += '<ellipse'
               + ' cx="' + nx + '" cy="' + ny + '"'
               + ' rx="6" ry="4" fill="#FFFFFF"'
               + ' transform="rotate(-15,' + nx + ',' + ny + ')"/>';

          // ── Stem (up if below B4 middle line, else down) ──────────
          // B4 = sae 4 (middle staff line)
          if (sae < 4) {
            out += vLine(nx + 5, ny,      ny - 30, '#FFFFFF', 1.5); // up
          } else {
            out += vLine(nx - 5, ny,      ny + 30, '#FFFFFF', 1.5); // down
          }
        }

        // ── Barline after end of each complete measure ─────────────
        // Only draw mid-row barlines (row-end barline is drawn separately)
        if ((gni + 1) % BEATS === 0 && ni < row.length - 1) {
          var bx = nx + nw / 2 + 1;
          out += vLine(bx, stT, stB, '#AAAAAA', 1.5);
        }
      });

      // ── Right barline ──────────────────────────────────────────────
      out += vLine(W - 4, stT, stB, '#AAAAAA', 1.5);
    });

    svg.innerHTML = out;

  } catch (e) {
    document.body.innerHTML =
      '<pre style="color:#FF4444;background:#111118;padding:14px;font-size:12px;white-space:pre-wrap">'
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
       + ' font-weight="bold" fill="#FFFFFF">'+n+'</text>';
}
</script>
</body>
</html>`;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function SheetMusicViewer({ notes = [] }) {
  console.log('[SheetMusicViewer] notes:', notes.length, notes.slice(0, 4));
  const html = buildHtml(notes);

  return (
    <View style={styles.container}>
      <WebView
        source={{ html }}
        style={styles.webview}
        originWhitelist={['*']}
        scrollEnabled
        showsVerticalScrollIndicator={false}
        scalesPageToFit={false}
        javaScriptEnabled
        domStorageEnabled
        backgroundColor="#111118"
        onError={(e) =>
          console.log('[SheetMusicViewer] WebView error:', e.nativeEvent)
        }
      />
    </View>
  );
}

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
