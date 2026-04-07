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

// ─── Core SVG sheet-music builder ────────────────────────────────────────────
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
(function () {
  try {

    // ── Notes from React Native ──────────────────────────────────────────
    var notes = ${notesJson};

    // ── Music constants ──────────────────────────────────────────────────
    var DEGREE = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
    var BEATS  = 4;   // quarter notes per measure (4/4 time)

    // ── Layout constants ─────────────────────────────────────────────────
    var W         = ${wExpr};
    var LINE_GAP  = 12;             // px between adjacent staff lines
    var STEP      = LINE_GAP / 2;   // px per diatonic step (half a space = 6px)
    var STAFF_H   = 4 * LINE_GAP;   // 48px (top line to bottom line)
    var ROW_H     = 140;            // total px per staff row — gap between staves = ROW_H − STAFF_H = 92px
    var ST_OFF    = 48;             // y from row top to first (top) staff line

    // Notehead dimensions — 10px wide × 8px tall
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

    var out = rect(0, 0, W, totalH, '${bgColor}');

    rows.forEach(function (row, ri) {
      var isFirst = ri === 0;
      var ry  = ri * ROW_H;
      var stT = ry + ST_OFF;       // y of top staff line   (F5)
      var stB = stT + STAFF_H;     // y of bottom staff line (E4)
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

      // ── Time signature (row 0 only) ────────────────────────────────
      if (isFirst) {
        var tx = CLEF_W + 2;
        out += timeSigNum(tx, stT + LINE_GAP + 7,     '4');
        out += timeSigNum(tx, stT + 3 * LINE_GAP + 7, '4');
      }

      // ── Notes ─────────────────────────────────────────────────────
      row.forEach(function (note, ni) {
        var nx  = Math.round(nx0 + ni * nw + nw / 2);
        var gni = ri * PER_ROW + ni;         // global note index

        if (!note) {
          // ── Quarter rest (simplified zigzag) ─────────────────────
          var mid = stT + STAFF_H / 2 + 2;
          out += seg(nx - 3, mid - 9,  nx + 5, mid - 3, '${noteColor}', 1.5);
          out += seg(nx + 5, mid - 3,  nx - 3, mid + 4, '${noteColor}', 1.5);
          out += seg(nx - 3, mid + 4,  nx + 3, mid + 11,'${noteColor}', 1.5);
        } else {
          // ── Pitched note ──────────────────────────────────────────
          var sae = note.steps - 2;          // diatonic steps above E4

          // Transpose for display — keep note within ~2 ledger lines
          while (sae < -4) sae += 7;
          while (sae > 12) sae -= 7;

          var ny  = stB - sae * STEP;

          // ── Ledger lines below staff ──────────────────────────────
          if (sae <= -2) {
            var loLedger = (sae % 2 === 0) ? sae : sae + 1;
            for (var ls = -2; ls >= loLedger; ls -= 2)
              out += hLine(nx - 11, nx + 11, stB - ls * STEP, '${staffColor}', 1);
          }

          // ── Ledger lines above staff ──────────────────────────────
          if (sae >= 10) {
            var hiLedger = (sae % 2 === 0) ? sae : sae - 1;
            for (var hs = 10; hs <= hiLedger; hs += 2)
              out += hLine(nx - 11, nx + 11, stB - hs * STEP, '${staffColor}', 1);
          }

          // ── Accidental ────────────────────────────────────────────
          if (note.acc) {
            var ch = note.acc === '#' ? '&#x266F;' : '&#x266D;';
            out += '<text x="' + (nx - 16) + '" y="' + (ny + 5) + '"'
                 + ' font-size="14" font-family="serif" fill="${noteColor}">' + ch + '</text>';
          }

          // ── Notehead: 10px wide × 8px tall, tilted −15° ───────────
          out += '<ellipse'
               + ' cx="' + nx + '" cy="' + ny + '"'
               + ' rx="' + NH_RX + '" ry="' + NH_RY + '" fill="${noteColor}"'
               + ' transform="rotate(-15,' + nx + ',' + ny + ')"/>';

          // ── Stem ──────────────────────────────────────────────────
          var STEM_LEN = 30;
          if (sae < 4) {
            out += vLine(nx + NH_RX, ny - NH_RY, ny - NH_RY - STEM_LEN, '${noteColor}', 1.5);
          } else {
            out += vLine(nx - NH_RX, ny + NH_RY, ny + NH_RY + STEM_LEN, '${noteColor}', 1.5);
          }
        }

        // ── Barline after end of each complete measure ─────────────
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
</script>
</body>
</html>`;
}

// ─── PDF HTML builder (exported for use in ResultsScreen) ────────────────────
// Generates paginated PDF HTML: 6 staff rows per page, header on page 1 only,
// footer on every page, @page margins 20mm.
// meta: { trackName, instrument, format, date }
export function buildPdfHtml(notes, meta) {
  meta = meta || {};
  const trackName  = htmlEsc(meta.trackName  || 'Untitled');
  const instrument = htmlEsc(meta.instrument || 'Unknown');
  const format     = htmlEsc(meta.format     || 'Score');
  const date       = htmlEsc(
    meta.date ||
    new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  );
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

    var DEGREE = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
    var BEATS         = 4;
    var W             = 500;   // content width in px (fits A4 with 45mm left / 20mm right margins)
    var LINE_GAP      = 12;
    var STEP          = LINE_GAP / 2;
    var STAFF_H       = 4 * LINE_GAP;   // 48px
    var ROW_H         = 110;  // 6 rows × 110px = 660px + 24px padding = 684px < 971px printable height
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

    // Split parsed notes into staff rows, then into pages of ROWS_PER_PAGE
    var allRows = [];
    for (var i = 0; i < parsed.length; i += PER_ROW)
      allRows.push(parsed.slice(i, i + PER_ROW));

    var pages = [];
    for (var p = 0; p < allRows.length; p += ROWS_PER_PAGE)
      pages.push(allRows.slice(p, p + ROWS_PER_PAGE));

    var HEADER_HTML =
      '<div class="header">'
      + '<div class="header-title">${trackName}</div>'
      + '<div class="header-meta">${instrument} &middot; ${format} &middot; ${date}</div>'
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
      // SVG height exactly fits the rows on this page (last page may have fewer)
      var svgH = pageRows.length * ROW_H + 24;
      var svgOut = rect(0, 0, W, svgH, '#FFFFFF');

      pageRows.forEach(function (row, ri) {
        var globalRi  = pi * ROWS_PER_PAGE + ri;  // row index across all pages
        var isFirstRow = globalRi === 0;
        var ry  = ri * ROW_H;                      // local y within this page's SVG
        var stT = ry + ST_OFF;
        var stB = stT + STAFF_H;
        var nx0 = isFirstRow ? NX0_FIRST : NX0_REST;
        var nw  = isFirstRow ? NW_FIRST  : NW_REST;

        // Staff lines
        for (var l = 0; l < 5; l++)
          svgOut += hLine(4, W - 4, stT + l * LINE_GAP, '#333333', 1);

        // Left barline
        svgOut += vLine(4, stT, stB, '#333333', 1.5);

        // Treble clef
        svgOut += '<text x="5" y="' + (stB + 16) + '"'
               + ' font-size="70" font-family="Times New Roman, Times, serif"'
               + ' fill="#000000">&#x1D11E;</text>';

        // Time signature (first row only)
        if (isFirstRow) {
          var tx = CLEF_W + 2;
          svgOut += timeSigNum(tx, stT + LINE_GAP + 7,     '4');
          svgOut += timeSigNum(tx, stT + 3 * LINE_GAP + 7, '4');
        }

        // Notes
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

        // Right barline
        svgOut += vLine(W - 4, stT, stB, '#333333', 1.5);
      });

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
