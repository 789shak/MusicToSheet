// Sheet-music page-layout helpers.
//
// These constants MUST stay in sync with the paging logic in
// SheetMusicViewer.js (buildScreenHtml / buildPdfBodyHtml), which lays notes
// out as: PER_ROW notes per row, ROWS_PER_PAGE_FIRST rows on the first page,
// and ROWS_PER_PAGE_REST rows on every page after that.

// Free users (guest and signed-in free tier) see sheet music clearly only for
// the first FREE_PREVIEW_SECONDS; everything after is blurred behind an
// upgrade overlay.
export const FREE_PREVIEW_SECONDS = 30;

const PER_ROW = 8;
const ROWS_PER_PAGE_FIRST = 5;
const ROWS_PER_PAGE_REST = 6;

// Returns the 0-indexed page that the note at the given 0-indexed position
// falls on, matching SheetMusicViewer's row/page packing.
export function pageForNoteIndex(noteIndex) {
  if (!Number.isFinite(noteIndex) || noteIndex < 0) return 0;
  const row = Math.floor(noteIndex / PER_ROW);
  if (row < ROWS_PER_PAGE_FIRST) return 0;
  return 1 + Math.floor((row - ROWS_PER_PAGE_FIRST) / ROWS_PER_PAGE_REST);
}
