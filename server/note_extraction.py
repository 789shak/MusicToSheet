"""
Canonical note-extraction for the async pipeline (audit item M1).

Converts a music21 score into the client-facing note schema with absolute
start/duration expressed in SECONDS:

    { midi, pitch, start, duration, velocity, confidence }

Kept in its own module (no fastapi/librosa/replicate imports) so it can be
unit-tested without the full server stack.
"""


def extract_notes_seconds(score, bpm: int) -> list:
    """
    Walk a music21 score and return notes with absolute seconds.

    Uses score.flatten().notes so .offset is absolute (in quarterLengths)
    relative to the whole score. Iterating via score.recurse().notes returns
    an offset RELATIVE to each note's parent container (Measure/Voice) —
    music21's documented gotcha that previously made every async-pipeline
    note start at 0.
    """
    bpm_safe = float(bpm) if bpm and bpm > 0 else 120.0
    spq = 60.0 / bpm_safe  # seconds per quarter note

    out = []
    for n in score.flatten().notes:
        start_s = round(float(n.offset) * spq, 3)
        dur_s = round(float(n.duration.quarterLength) * spq, 3)
        if hasattr(n, "pitch"):  # Note
            out.append({
                "midi":       int(n.pitch.midi),
                "pitch":      n.pitch.nameWithOctave,
                "start":      start_s,
                "duration":   dur_s,
                "velocity":   0.8,
                "confidence": 0.8,
            })
        elif hasattr(n, "pitches"):  # Chord
            for p in n.pitches:
                out.append({
                    "midi":       int(p.midi),
                    "pitch":      p.nameWithOctave,
                    "start":      start_s,
                    "duration":   dur_s,
                    "velocity":   0.8,
                    "confidence": 0.8,
                })
    out.sort(key=lambda x: x["start"])
    return out
