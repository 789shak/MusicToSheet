// Sheet-music page-layout helpers.
//
// These constants MUST stay in sync with the paging logic in
// SheetMusicViewer.js (buildScreenHtml / buildPdfBodyHtml), which lays notes
// out as: PER_ROW notes per row, ROWS_PER_PAGE rows on every page.

// Free users (guest and signed-in free tier) see sheet music clearly only for
// the first FREE_PREVIEW_SECONDS; everything after is blurred behind an
// upgrade overlay.
export const FREE_PREVIEW_SECONDS = 30;

const PER_ROW = 8;
// Uniform pagination: every page (including page 1, below its compact header)
// holds exactly ROWS_PER_PAGE staff rows. Sized so header + 5×140px row + footer
// fits A4 printable height (~971px @ 20mm vertical margins) with >5% slack.
const ROWS_PER_PAGE = 5;
export const ROWS_PER_PAGE_FIRST = ROWS_PER_PAGE;
export const ROWS_PER_PAGE_REST  = ROWS_PER_PAGE;

// Returns the 0-indexed page that the note at the given 0-indexed position
// falls on, matching SheetMusicViewer's row/page packing.
export function pageForNoteIndex(noteIndex) {
  if (!Number.isFinite(noteIndex) || noteIndex < 0) return 0;
  const row = Math.floor(noteIndex / PER_ROW);
  return Math.floor(row / ROWS_PER_PAGE);
}
