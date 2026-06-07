"""
Offline test for the async pipeline's note-extraction (audit item M1).

Builds a tiny music21 score in code and runs the real extraction helper
from server/app.py — no Replicate, no MIDI temp files. Guards against the
regression where every note had start=0 because n.offset was parent-relative
after makeNotation() wrapped notes in measures.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from music21 import stream, note, chord, meter, tempo

from note_extraction import extract_notes_seconds as _extract_notes_seconds


def _build_score(bpm: int = 120):
    s = stream.Score()
    p = stream.Part()
    p.insert(0, meter.TimeSignature("4/4"))
    p.insert(0, tempo.MetronomeMark(number=bpm))
    # Three quarter notes at beats 0, 4, 8 (one per measure at 4/4).
    p.insert(0, note.Note("C4", quarterLength=1))
    p.insert(4, note.Note("E4", quarterLength=1))
    p.insert(8, note.Note("G4", quarterLength=1))
    s.insert(0, p)
    # makeNotation wraps notes into measures — this is what made .offset
    # parent-relative and gave every note start=0 in the buggy version.
    s.makeNotation(inPlace=True)
    return s


def test_starts_are_absolute_seconds_at_120_bpm():
    notes = _extract_notes_seconds(_build_score(bpm=120), bpm=120)
    starts = [n["start"] for n in notes]
    # beat 0, beat 4, beat 8 @ 120 BPM (0.5 s per quarter) = 0, 2, 4 seconds.
    assert starts == [0.0, 2.0, 4.0], f"expected absolute seconds 0/2/4, got {starts}"


def test_durations_are_seconds_not_quarter_lengths():
    notes = _extract_notes_seconds(_build_score(bpm=120), bpm=120)
    # Quarter notes @ 120 BPM = 0.5 s each, NOT 1.0 (quarterLength).
    for n in notes:
        assert n["duration"] == 0.5, f"expected 0.5 s duration, got {n['duration']}"


def test_schema_includes_midi_and_pitch_name():
    notes = _extract_notes_seconds(_build_score(bpm=120), bpm=120)
    pitches = [n["pitch"] for n in notes]
    midis = [n["midi"] for n in notes]
    assert pitches == ["C4", "E4", "G4"], pitches
    assert midis == [60, 64, 67], midis
    for n in notes:
        assert set(n.keys()) >= {"midi", "pitch", "start", "duration", "velocity", "confidence"}


def test_bpm_scales_seconds():
    notes = _extract_notes_seconds(_build_score(bpm=60), bpm=60)
    # At 60 BPM, one quarter = 1 second, so beats 0/4/8 = 0/4/8 s.
    assert [n["start"] for n in notes] == [0.0, 4.0, 8.0]
    assert all(n["duration"] == 1.0 for n in notes)


def test_chord_expands_into_individual_notes_sharing_start():
    s = stream.Score()
    p = stream.Part()
    p.insert(0, meter.TimeSignature("4/4"))
    p.insert(0, tempo.MetronomeMark(number=120))
    p.insert(0, chord.Chord(["C4", "E4", "G4"], quarterLength=2))
    s.insert(0, p)
    s.makeNotation(inPlace=True)

    notes = _extract_notes_seconds(s, bpm=120)
    assert len(notes) == 3
    assert {n["pitch"] for n in notes} == {"C4", "E4", "G4"}
    assert all(n["start"] == 0.0 for n in notes)
    assert all(n["duration"] == 1.0 for n in notes)  # half note @ 120 = 1 s


def test_bpm_zero_or_missing_falls_back_to_120():
    notes = _extract_notes_seconds(_build_score(bpm=120), bpm=0)
    assert [n["start"] for n in notes] == [0.0, 2.0, 4.0]
