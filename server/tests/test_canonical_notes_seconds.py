"""
Offline proof that the canonical notes list takes its timing directly from
the transcription model's native seconds (pretty_midi.Note.start /
Note.end), NOT from music21 quarter-lengths.

Regression guard: a real 33s clip used to produce last_note.start=262.958
because timings were derived from music21 offsets with a hard-coded BPM
that didn't match the score. This test feeds a synthetic PrettyMIDI with
known second-valued onsets/durations through the real builder and asserts
the values come back unchanged.

No Replicate, no Basic Pitch inference, no temp MIDI files.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pretty_midi


def _build_synthetic_midi():
    """Three notes at 0.0s, 2.0s, 4.0s with durations 0.5s, 1.0s, 0.25s."""
    midi = pretty_midi.PrettyMIDI(initial_tempo=120)
    piano = pretty_midi.Instrument(program=0)
    piano.notes.append(pretty_midi.Note(velocity=80, pitch=60, start=0.0, end=0.5))
    piano.notes.append(pretty_midi.Note(velocity=90, pitch=64, start=2.0, end=3.0))
    piano.notes.append(pretty_midi.Note(velocity=70, pitch=67, start=4.0, end=4.25))
    midi.instruments.append(piano)
    return midi


def test_midi_data_to_notes_preserves_model_seconds():
    """Starts/durations must equal the PrettyMIDI input exactly — not scaled by BPM."""
    from note_extraction import midi_data_to_notes as _midi_data_to_notes

    notes = _midi_data_to_notes(_build_synthetic_midi())

    assert len(notes) == 3, notes
    starts = [n["start"] for n in notes]
    durations = [n["duration"] for n in notes]

    assert starts == [0.0, 2.0, 4.0], (
        f"expected model-second starts [0.0, 2.0, 4.0], got {starts} — "
        "this is the bug where timings got scaled by music21 BPM math."
    )
    assert durations == [0.5, 1.0, 0.25], (
        f"expected model-second durations [0.5, 1.0, 0.25], got {durations} — "
        "durations must not be quantized to a constant by the canonical builder."
    )

    # Durations must not collapse to a single value (the bug symptom).
    assert len(set(durations)) > 1, f"durations collapsed to constant: {durations}"


def test_canonical_schema_has_all_six_fields():
    from note_extraction import midi_data_to_notes as _midi_data_to_notes

    notes = _midi_data_to_notes(_build_synthetic_midi())
    required = {"midi", "pitch", "start", "duration", "velocity", "confidence"}
    for n in notes:
        assert set(n.keys()) >= required, f"missing fields: {required - set(n.keys())}"
    midis = [n["midi"] for n in notes]
    pitches = [n["pitch"] for n in notes]
    assert midis == [60, 64, 67], midis
    assert pitches == ["C4", "E4", "G4"], pitches
    # velocity is normalized 0..1
    assert notes[0]["velocity"] == round(80 / 127.0, 2)


def test_long_clip_does_not_inflate_starts():
    """Regression: a 33s clip's last note must stay near 33s, not jump to ~263s."""
    from note_extraction import midi_data_to_notes as _midi_data_to_notes

    midi = pretty_midi.PrettyMIDI(initial_tempo=120)
    piano = pretty_midi.Instrument(program=0)
    # First note at 0.375s (the previously-reported first_note.start that got
    # inflated to 3.0), last note at 32.9s (was inflated to 262.958).
    piano.notes.append(pretty_midi.Note(velocity=80, pitch=60, start=0.375, end=0.5))
    piano.notes.append(pretty_midi.Note(velocity=80, pitch=62, start=16.5, end=17.0))
    piano.notes.append(pretty_midi.Note(velocity=80, pitch=64, start=32.9, end=33.0))
    midi.instruments.append(piano)

    notes = _midi_data_to_notes(midi)
    assert abs(notes[0]["start"] - 0.375) < 1e-3, notes[0]
    assert abs(notes[-1]["start"] - 32.9) < 1e-3, notes[-1]
    # Last note must be roughly 33s, NOT ~263s (the 8x inflation symptom).
    assert notes[-1]["start"] < 50, (
        f"last note start={notes[-1]['start']} — looks inflated, "
        "model seconds were lost somewhere"
    )
