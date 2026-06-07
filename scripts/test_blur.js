// Regression check for the 30s-free-preview blur emission in
// src/components/SheetMusicViewer.js#buildScreenHtml.
//
// We can't `require()` the module directly — it depends on React Native at the
// top level, which doesn't load in Node. Instead we read the source as text,
// strip the import block + the JSX component definition + ES-module export
// keywords, then run the pure rest under `new Function` and pull buildScreenHtml
// out for direct assertion.
//
// Run: node scripts/test_blur.js
// Exits non-zero on any assertion failure (so CI / pre-commit can wire it up).

const fs   = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'src', 'components', 'SheetMusicViewer.js');
const src  = fs.readFileSync(FILE, 'utf8');

// Locate the React component block — JSX is not parsable by plain Node, and
// neither is the trailing `const styles = StyleSheet.create({...})`. The pure
// buildScreenHtml builder lives well above both. Strip from the forwardRef
// declaration to EOF.
const COMP_START = '\nconst SheetMusicViewer = forwardRef';
const startIdx = src.indexOf(COMP_START);
if (startIdx < 0) {
  console.error('FAIL: could not locate component block to strip');
  process.exit(1);
}
const head = src.slice(0, startIdx);

// Strip the top-of-file imports (React, React Native, react-native-webview).
const noImports = head
  .replace(/^import [^;]+;\s*$/gm, '')
  // Convert `export function buildScreenHtml` → `function buildScreenHtml` etc.
  .replace(/^export function /gm, 'function ');

// Wrap and run. The final `return` exposes the builders we want to test.
const factory = new Function(
  noImports +
  '\nreturn { buildScreenHtml, buildStaticPdfHtml };'
);
const { buildScreenHtml } = factory();

// ── Test fixture ────────────────────────────────────────────────────────────
// 100 notes spread 0..60s — half inside the 30s window, half past it. With
// PER_ROW=8 and ROWS_PER_PAGE=5 (40 notes/page), the first locked note (start≥30)
// is index 50 → row 6 → page 1 (0-indexed).
const notes = [];
for (let i = 0; i < 100; i++) {
  notes.push({ pitch: 'C4', start: i * 0.6, duration: 0.3 });
}

// Reproduce the lock-page math from ResultsScreen / sheetLayout exactly.
const FREE_PREVIEW_SECONDS = 30;
const PER_ROW = 8;
const ROWS_PER_PAGE = 5;
const firstLockedIdx = notes.findIndex(n => (n.start ?? 0) >= FREE_PREVIEW_SECONDS);
const lockedFromPage = Math.floor(Math.floor(firstLockedIdx / PER_ROW) / ROWS_PER_PAGE);

console.log('[test_blur] firstLockedIdx:', firstLockedIdx, '→ lockedFromPage:', lockedFromPage);

const html = buildScreenHtml(notes, {
  trackName: 'Test',
  instrument: 'Piano',
  format: 'Score',
  bpm: 120,
  watermark: true,
  lockedFromPage,
});

// ── Assertions ──────────────────────────────────────────────────────────────
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('PASS:', msg);
}

assert(html.includes('class="locked-staves"'),
       'emits at least one <div class="locked-staves"> wrapper');
assert(html.includes('filter: blur(10px)'),
       '.locked-staves CSS rule with blur(10px) present in <style>');
assert(html.includes('translateZ(0)'),
       'layer-promotion hint (translateZ) present — needed so Android WebView composites the blur');
assert(html.includes('will-change: filter'),
       'will-change: filter present — tells the WebView to allocate a backing store before blur');
assert(html.includes('class="upgrade-overlay"'),
       'emits the upgrade-overlay card on first locked page');
assert(html.includes('Preview ends at 0:30'),
       'upgrade overlay carries the preview-ends headline');
assert(html.includes("postNav('/subscription')"),
       'upgrade button wired to nav to /subscription');

// Locked wrapper count should equal totalPages - lockedFromPage.
const totalPages = Math.ceil(Math.ceil(notes.length / PER_ROW) / ROWS_PER_PAGE);
const expectedLocked = totalPages - lockedFromPage;
const lockedCount = (html.match(/class="locked-staves"/g) || []).length;
assert(lockedCount === expectedLocked,
       `wrapper count: expected ${expectedLocked} (totalPages=${totalPages} - lockedFromPage=${lockedFromPage}), got ${lockedCount}`);

// Negative control: no lock when lockedFromPage is null (paid tier).
const htmlPaid = buildScreenHtml(notes, {
  trackName: 'Test',
  instrument: 'Piano',
  format: 'Score',
  bpm: 120,
  watermark: false,
  lockedFromPage: null,
});
assert(!htmlPaid.includes('class="locked-staves"'),
       'paid tier (lockedFromPage=null) emits NO locked-staves wrapper');
assert(!htmlPaid.includes('class="upgrade-overlay"'),
       'paid tier emits NO upgrade overlay');

// Optional: dump the locked HTML for visual inspection (DEBUG_BLUR=1).
if (process.env.DEBUG_BLUR) {
  fs.writeFileSync(path.resolve(__dirname, 'test_blur_output.html'), html, 'utf8');
  console.log('\nDumped emitted locked-tier HTML to scripts/test_blur_output.html');
}

console.log('\nAll blur-emission assertions passed.');
