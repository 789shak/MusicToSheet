"""
Canonical note-extraction for the async pipeline (audit item M1).

The canonical notes list shipped to the client always carries SECONDS
sourced directly from the transcription model:
    { midi, pitch, start, duration, velocity, confidence }

For piano (ByteDance / piano specialist) and Basic Pitch, the model's
PrettyMIDI output is already in absolute seconds (see pretty_midi.Note —
Note.start / Note.end are documented as absolute, in seconds). Use
``midi_data_to_notes`` to build the canonical dict shape directly from
PrettyMIDI — do NOT route timings through music21 quarter-lengths.

The old ``extract_notes_seconds(score, bpm)`` helper is kept for the
existing unit tests, but is NO LONGER used by the live pipeline: it
multiplied music21 offsets by a hard-coded BPM that didn't match the
score's actual tempo, which inflated note starts ~8x (a real 33s clip
produced last_note.start=262.958).

Kept import-light (no fastapi/librosa/replicate) so this whole module is
unit-testable in isolation.
"""

import pretty_midi


def midi_data_to_notes(midi_data: "pretty_midi.PrettyMIDI") -> list:
    """Canonical builder. Reads PrettyMIDI's native seconds straight through."""
    notes = []
    for instrument in midi_data.instruments:
        for note in instrument.notes:
            notes.append({
                "midi":       int(note.pitch),
                "pitch":      pretty_midi.note_number_to_name(note.pitch),
                "start":      round(float(note.start), 3),
                "duration":   round(float(note.end) - float(note.start), 3),
                "velocity":   round(float(note.velocity) / 127.0, 2),
                "confidence": 0.9,
            })
    notes.sort(key=lambda n: n["start"])
    return notes


def extract_notes_seconds(score, bpm: int) -> list:
    """
    DEPRECATED — kept only for the existing music21-based unit tests.

    Walks a music21 score and returns notes with seconds derived from
    quarterLength * (60 / bpm). The live pipeline does NOT use this; it
    builds the canonical notes directly from PrettyMIDI seconds via
    ``midi_data_to_notes`` above. Removing this entirely would break
    ``test_note_extraction.py``, which exercises a synthetic score where
    the conversion is well-defined.
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
