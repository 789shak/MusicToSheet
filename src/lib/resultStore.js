// In-memory, module-level store for Results payloads.
//
// Large note arrays and MusicXML strings must NOT travel through Expo Router
// navigation params — big payloads can be truncated or corrupted in transit,
// and a corrupted JSON.parse on the Results screen throws during render and
// produces a black screen. Instead we stash the payload here, pass only a
// short resultId through the route, and read it back on mount.
//
// No persistence, no AsyncStorage — this lives for the lifetime of the JS
// runtime, which is all the navigation handoff needs.

const store = new Map();
let counter = 0;

// Cap retained payloads so a long session can't grow this Map unbounded.
const MAX_ENTRIES = 20;

export function makeResultId() {
  counter += 1;
  return `result_${counter}`;
}

export function setResult(id, payload) {
  if (!id) return;
  // Evict the oldest entry once we exceed the cap (Map preserves insertion order).
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(id, payload);
}

// Reads the payload for an id. Intentionally does NOT delete it, so a screen
// re-mount (hot reload, back-then-forward) can read the same payload again.
export function takeResult(id) {
  if (!id) return undefined;
  return store.get(id);
}
