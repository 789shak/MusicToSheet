"""
Tests for the P0 conversion-quality fixes (July 2026).

All import-light: they exercise musicxml_generation directly with synthetic
PrettyMIDI, so no Basic Pitch, no Replicate, no real audio.

Covers:
  P0-1  simultaneous notes are notated as a <chord/>, not exploded into voices
  P0-2  a dotted-quarter input survives as a dotted note (<dot/> present)
  P0-3  low pitches keep their real octave AND select a bass clef (no octave
        clamp downstream; clef chosen from the pitch distribution)
"""
import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pretty_midi


def _midi(events, program=0):
    m = pretty_midi.PrettyMIDI(initial_tempo=120)
    inst = pretty_midi.Instrument(program=program)
    for pitch_val, start, end in events:
        inst.notes.append(pretty_midi.Note(velocity=80, pitch=pitch_val, start=start, end=end))
    m.instruments.append(inst)
    return m


def test_simultaneous_notes_become_a_chord():
    """P0-1: three notes starting together must produce <chord/> elements."""
    from musicxml_generation import generate_musicxml
    # C4, E4, G4 all at the same onset on the treble staff.
    midi = _midi([
        (60, 0.0, 1.0), (64, 0.0, 1.0), (67, 0.0, 1.0),
        (62, 1.0, 2.0),  # a following single note so the score isn't degenerate
    ])
    xml_str, _ = generate_musicxml(midi, "Chord", "Piano", 120)
    assert xml_str, "no MusicXML produced"
    root = ET.fromstring(xml_str)
    chord_notes = [n for n in root.findall(".//note") if n.find("chord") is not None]
    assert len(chord_notes) >= 2, (
        f"expected >=2 <chord/> members (a 3-note chord = 2 chord tags), "
        f"got {len(chord_notes)} — simultaneous notes were not grouped."
    )


def test_dotted_quarter_is_notated_with_a_dot():
    """P0-2: a 1.5-quarter (dotted quarter) note must carry a <dot/>."""
    from musicxml_generation import generate_musicxml
    # At 120bpm, qps=2. end-start=0.75s -> 1.5 ql -> dotted quarter.
    midi = _midi([
        (67, 0.0, 0.75),   # dotted quarter
        (65, 0.75, 1.25),  # eighth-ish filler
        (64, 1.25, 2.25),
    ])
    xml_str, _ = generate_musicxml(midi, "Dotted", "Flute", 120)
    assert xml_str, "no MusicXML produced"
    root = ET.fromstring(xml_str)
    dots = root.findall(".//note/dot")
    assert len(dots) >= 1, (
        "expected at least one <dot/> element — the dotted-quarter was rounded "
        "to a plain duration (coarse rhythm grid)."
    )


def test_low_pitches_keep_octave_and_get_bass_clef():
    """P0-3: a bass line keeps its real low octave and selects a bass clef."""
    from musicxml_generation import generate_musicxml
    # E1..E2 range — a real bass line. Pre-fix this would be octave-clamped to
    # C4-C6 upstream and forced onto a treble staff.
    midi = _midi([
        (28, 0.0, 1.0),  # E1
        (33, 1.0, 2.0),  # A1
        (40, 2.0, 3.0),  # E2
        (35, 3.0, 4.0),  # B1
    ])
    xml_str, _ = generate_musicxml(midi, "Bassline", "Bass", 120)
    assert xml_str, "no MusicXML produced"
    root = ET.fromstring(xml_str)

    # Bass clef selected from the low pitch distribution.
    signs = {c.find("sign").text for c in root.findall(".//clef") if c.find("sign") is not None}
    assert "F" in signs, f"expected a bass clef (sign F) for a low bass line, got {signs}"

    # Octaves preserved: at least one note in octave 1 or 2 (not crushed to 4-6).
    octaves = [int(o.text) for o in root.findall(".//note/pitch/octave")]
    assert octaves, "no pitched notes found"
    assert min(octaves) <= 2, (
        f"lowest octave is {min(octaves)} — pitches look octave-clamped; "
        "the real low bass octave was lost."
    )


def test_single_notes_still_work_and_no_crash_on_mixed_content():
    """Sanity: mixed chords + single notes across both staves still exports."""
    from musicxml_generation import generate_musicxml
    midi = _midi([
        (36, 0.0, 1.0),                      # bass single
        (60, 0.0, 1.0), (64, 0.0, 1.0),      # treble chord (same onset)
        (67, 1.0, 1.5),                      # treble single, dotted-ish
        (48, 1.0, 2.0),                      # bass single
    ])
    xml_str, _ = generate_musicxml(midi, "Mixed", "Piano", 120)
    assert xml_str and len(xml_str) > 500, "mixed content failed to export"
    root = ET.fromstring(xml_str)
    staves_el = root.find(".//part/measure/attributes/staves")
    assert staves_el is not None and staves_el.text == "2", "grand staff lost"


def test_overlapping_sustained_notes_do_not_explode_into_voices():
    """
    P0-1b: sustained/overlapping notes on one staff must be clipped to the next
    onset so they collapse to a single voice — NOT stacked into many voices with
    <backup> elements (the 'messy / half-empty measures' look). We assert the
    <backup> count stays low relative to the number of notes.
    """
    import random
    from musicxml_generation import generate_musicxml
    random.seed(7)
    events = []
    t = 0.0
    for _ in range(80):
        pitch_val = random.choice([45, 47, 49, 52, 56, 58, 61, 64, 67])
        dur = random.choice([0.4, 0.8, 1.2, 1.6])   # long -> heavy overlap pre-fix
        events.append((pitch_val, t, t + dur))
        t += random.choice([0.0, 0.15, 0.25, 0.4])
    xml_str, _ = generate_musicxml(_midi(events), "Overlap", "Piano", 120)
    assert xml_str, "no MusicXML produced"
    backups = xml_str.count("<backup>")
    # Pre-fix this synthetic input produced ~120 backups; the clip fix brings it
    # to a small fraction. Guard generously at < 40 to avoid flakiness.
    assert backups < 40, (
        f"{backups} <backup> elements — overlapping notes are still exploding "
        "into stacked voices instead of clipping to a single clean voice."
    )


def test_extreme_key_falls_back_to_c_major():
    """Conservative key: a 5+ sharp auto-detected key must fall back to C (0)."""
    from musicxml_generation import generate_musicxml
    # Pitch palette biased to G# minor / B major (5 sharps): B D# F# G# C# E.
    ev = [
        (44, 0.0, 0.5), (51, 0.5, 1.0), (56, 1.0, 1.5), (59, 1.5, 2.0),
        (66, 2.0, 2.5), (68, 2.5, 3.0), (63, 3.0, 3.5), (61, 3.5, 4.0),
        (59, 4.0, 4.5), (56, 4.5, 5.0), (51, 5.0, 5.5), (44, 5.5, 6.0),
    ]
    xml_str, _ = generate_musicxml(_midi(ev), "ExtremeKey", "Piano", 120)
    root = ET.fromstring(xml_str)
    fifths = root.find(".//part/measure/attributes/key/fifths")
    assert fifths is not None, "no key signature written"
    assert int(fifths.text) == 0, (
        f"expected conservative fallback to C major (0), got fifths={fifths.text} "
        "— extreme key signatures should be suppressed."
    )
