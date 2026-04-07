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
    var LINE_GAP  = 12;             // px between adjacent staff lines
    var STEP      = LINE_GAP / 2;   // px per diatonic step (half a space = 6px)
    var STAFF_H   = 4 * LINE_GAP;   // 48px (top line to bottom line)
    var ROW_H     = 140;            // total px per staff row — gap between staves = ROW_H − STAFF_H = 92px
    var ST_OFF    = 48;             // y from row top to first (top) staff line

    // Notehead dimensions — 10px wide × 8px tall as requested
    var NH_RX     = 5;  // notehead half-width  (total: 10px)
    var NH_RY     = 4;  // notehead half-height (total:  8px)

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
      // U+1D11E (𝄞) — baseline placed below the bottom staff line so the
      // G-curl visually lands on the G4 line (2nd line from bottom).
      out += '<text x="5" y="' + (stB + 16) + '"'
           + ' font-size="70" font-family="Times New Roman, Times, serif"'
           + ' fill="#FFFFFF">&#x1D11E;</text>';

      // ── Time signature (row 0 only) ────────────────────────────────
      if (isFirst) {
        var tx = CLEF_W + 2;
        out += timeSigNum(tx, stT + LINE_GAP + 7,     '4');
        out += timeSigNum(tx, stT + 3 * LINE_GAP + 7, '4');
      }

      // ── Notes ─────────────────────────────────────────────────────
      row.forEach(function (note, ni) {
        // Round nx to integer — prevents sub-pixel misalignment of the
        // rotation transform centre from dragging the ellipse off the line.
        var nx  = Math.round(nx0 + ni * nw + nw / 2);
        var gni = ri * PER_ROW + ni;         // global note index

        if (!note) {
          // ── Quarter rest (simplified zigzag) ─────────────────────
          var mid = stT + STAFF_H / 2 + 2;
          out += seg(nx - 3, mid - 9,  nx + 5, mid - 3, '#FFFFFF', 1.5);
          out += seg(nx + 5, mid - 3,  nx - 3, mid + 4, '#FFFFFF', 1.5);
          out += seg(nx - 3, mid + 4,  nx + 3, mid + 11,'#FFFFFF', 1.5);
        } else {
          // ── Pitched note ──────────────────────────────────────────
          //
          // Treble clef staff lines (bottom → top), with their sae values:
          //   Line 1 (E4) sae=0  → ny = stB
          //   Line 2 (G4) sae=2  → ny = stB − 12
          //   Line 3 (B4) sae=4  → ny = stB − 24  ← middle line
          //   Line 4 (D5) sae=6  → ny = stB − 36
          //   Line 5 (F5) sae=8  → ny = stB − 48
          //
          // Spaces between lines have odd sae values (1,3,5,7) and land
          // exactly halfway between the two adjacent line y-values.
          //
          // Accidentals (#/b) do NOT change sae — D#4 and D4 share the same y.
          //
          var sae = note.steps - 2;          // diatonic steps above E4

          // ── Transpose for display — keep note within ~2 ledger lines ─
          // Add/subtract 7 (one octave) until sae is in [-4, 12].
          while (sae < -4) sae += 7;
          while (sae > 12) sae -= 7;

          var ny  = stB - sae * STEP;        // integer: stB and STEP are both integers

          // ── Ledger lines below staff ──────────────────────────────
          // C4=sae−2, A3=sae−4, F3=sae−6 …
          if (sae <= -2) {
            var loLedger = (sae % 2 === 0) ? sae : sae + 1;
            for (var ls = -2; ls >= loLedger; ls -= 2)
              out += hLine(nx - 11, nx + 11, stB - ls * STEP, '#AAAAAA', 1);
          }

          // ── Ledger lines above staff ──────────────────────────────
          // Top line F5=sae 8; first ledger above = G5=sae 10
          if (sae >= 10) {
            var hiLedger = (sae % 2 === 0) ? sae : sae - 1;
            for (var hs = 10; hs <= hiLedger; hs += 2)
              out += hLine(nx - 11, nx + 11, stB - hs * STEP, '#AAAAAA', 1);
          }

          // ── Accidental — drawn before notehead, same y as note ────
          if (note.acc) {
            var ch = note.acc === '#' ? '&#x266F;' : '&#x266D;';
            out += '<text x="' + (nx - 16) + '" y="' + (ny + 5) + '"'
                 + ' font-size="14" font-family="serif" fill="#FFFFFF">' + ch + '</text>';
          }

          // ── Notehead: 10px wide × 8px tall, tilted −15° ───────────
          // cx/cy are integer pixel values so the rotation pivot is
          // on a whole pixel, keeping the notehead centred on the line.
          out += '<ellipse'
               + ' cx="' + nx + '" cy="' + ny + '"'
               + ' rx="' + NH_RX + '" ry="' + NH_RY + '" fill="#FFFFFF"'
               + ' transform="rotate(-15,' + nx + ',' + ny + ')"/>';

          // ── Stem ──────────────────────────────────────────────────
          // Connects to the side EDGE of the notehead (not the centre y)
          // so it visually anchors the note without shifting its perceived pitch.
          var STEM_LEN = 30;
          if (sae < 4) {
            out += vLine(nx + NH_RX, ny - NH_RY, ny - NH_RY - STEM_LEN, '#FFFFFF', 1.5);
          } else {
            out += vLine(nx - NH_RX, ny + NH_RY, ny + NH_RY + STEM_LEN, '#FFFFFF', 1.5);
          }
        }

        // ── Barline after end of each complete measure ─────────────
        // Only draw mid-row barlines (row-end barline is drawn separately)
        if ((gni + 1) % BEATS === 0 && ni < row.length - 1) {
          var bx = Math.round(nx + nw / 2 + 1);
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
