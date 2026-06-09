"""
Notation-quality test for generate_musicxml.

Three invariants the live pipeline must guarantee for piano output:

  (a) Two staves with treble + bass clefs (grand staff).
  (b) The detected key signature is written into the score (<fifths> set).
  (c) An in-key accidental (F# in G major) does NOT emit a redundant
      <accidental> tag — makeNotation folds it via the key signature.

No Replicate, no real audio — synthetic PrettyMIDI input.
"""
import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pretty_midi


def _build_synthetic_g_major_midi():
    """Notes spanning bass + treble, biased to make Krumhansl pick G major."""
    midi = pretty_midi.PrettyMIDI(initial_tempo=120)
    piano = pretty_midi.Instrument(program=0)
    events = [
        (36, 0.0, 0.5),   # C2  (bass staff)
        (52, 0.5, 1.0),   # E3  (bass staff)
        (60, 1.0, 1.5),   # C4  (treble staff)
        (67, 1.5, 2.0),   # G4  (treble)
        (66, 2.0, 2.5),   # F#4 — in-key in G major: must NOT emit <accidental>
        (67, 2.5, 3.0),   # G4
        (62, 3.0, 3.5),   # D4
        (66, 3.5, 4.0),   # F#4
        (67, 4.0, 4.5),   # G4
        (71, 4.5, 5.0),   # B4
        (66, 5.0, 5.5),   # F#4
        (67, 5.5, 6.0),   # G4
        (62, 6.0, 6.5),   # D4
        (66, 6.5, 7.0),   # F#4
        (67, 7.0, 7.5),   # G4
    ]
    for pitch, start, end in events:
        piano.notes.append(pretty_midi.Note(
            velocity=80, pitch=pitch, start=start, end=end,
        ))
    midi.instruments.append(piano)
    return midi


def test_piano_grand_staff_key_sig_and_in_key_accidental():
    from musicxml_generation import generate_musicxml

    midi = _build_synthetic_g_major_midi()
    xml_str, _ = generate_musicxml(midi, "Test", "Piano", 120)
    assert xml_str, "generate_musicxml returned no content"

    root = ET.fromstring(xml_str)

    # ── (a) Two staves with treble + bass clefs.
    staves_el = root.find(".//part/measure/attributes/staves")
    assert staves_el is not None and staves_el.text == "2", (
        f"expected <staves>2</staves>, got "
        f"{staves_el.text if staves_el is not None else 'missing'}"
    )
    clefs = root.findall(".//part/measure/attributes/clef")
    assert len(clefs) >= 2, f"expected >=2 clefs, got {len(clefs)}"
    clef_signs = {c.find("sign").text for c in clefs if c.find("sign") is not None}
    assert "G" in clef_signs, f"treble clef missing — clefs={clef_signs}"
    assert "F" in clef_signs, f"bass clef missing — clefs={clef_signs}"

    # ── (b) Key signature: G major = 1 sharp = <fifths>1</fifths>.
    fifths_el = root.find(".//part/measure/attributes/key/fifths")
    assert fifths_el is not None, "no <key><fifths> in the score"
    assert fifths_el.text == "1", (
        f"expected G major (fifths=1), got fifths={fifths_el.text} — "
        "auto-detect may have picked another key; if so, the synthetic "
        "test data needs more G-tonic emphasis."
    )

    # ── (c) F# in G major must NOT carry an <accidental> tag.
    fsharp_with_accidental = 0
    fsharp_total = 0
    for n in root.findall(".//part/measure/note"):
        pitch_el = n.find("pitch")
        if pitch_el is None:
            continue
        step_el = pitch_el.find("step")
        alter_el = pitch_el.find("alter")
        if step_el is None or step_el.text != "F":
            continue
        if alter_el is None or alter_el.text not in ("1", "1.0"):
            continue
        fsharp_total += 1
        if n.find("accidental") is not None:
            fsharp_with_accidental += 1
    assert fsharp_total > 0, "no F# notes found in the output — test data bug"
    assert fsharp_with_accidental == 0, (
        f"{fsharp_with_accidental}/{fsharp_total} F# notes still carry a "
        "redundant <accidental> tag — makeAccidentals failed to fold via "
        "the key signature."
    )


def _build_pathological_5sharp_midi():
    """
    Notes biased toward B major / G# minor (5 sharps) with a mix of:
      - one absurdly short note (0.008s) that pre-fix would round to a
        sub-notatable quarterLength and crash MusicXML export
      - notes at non-grid offsets to force makeNotation to either
        split them at barlines into tiny fragments, or — post-fix —
        snap them to the 16th-note grid
      - notes on both staves so the grand-staff path is exercised
    Pitch palette emphasizes B/D#/F#/G#/C#/E to make Krumhansl pick
    a 5-sharp key (B major or G# minor) — either is fine for the
    assertion (fifths == 5 or -7 etc.; we accept |fifths| >= 4).
    """
    midi = pretty_midi.PrettyMIDI(initial_tempo=120)
    piano = pretty_midi.Instrument(program=0)
    # (pitch, start, end) — start/end deliberately use offsets that are
    # NOT multiples of 0.125s (a 16th @ 120bpm) to stress the quantizer.
    events = [
        (44, 0.0,    0.503),    # G#2  bass
        (51, 0.503,  1.007),    # D#3  bass
        (56, 1.007,  1.013),    # G#3  bass  ← 0.006s = 0.012 ql, must clamp
        (59, 1.013,  1.521),    # B3   bass/treble border
        (66, 1.521,  2.034),    # F#4  treble
        (71, 2.034,  2.040),    # B4   treble ← 0.006s pathological
        (68, 2.040,  2.548),    # G#4  treble
        (73, 2.548,  3.061),    # C#5  treble
        (76, 3.061,  3.575),    # E5   treble
        (71, 3.575,  4.087),    # B4   treble
        (68, 4.087,  4.600),    # G#4  treble
        (66, 4.600,  5.115),    # F#4  treble
        (63, 5.115,  5.625),    # D#4  treble
        (59, 5.625,  6.135),    # B3
        (56, 6.135,  6.650),    # G#3  bass
        (51, 6.650,  7.160),    # D#3  bass
        (44, 7.160,  7.675),    # G#2  bass
    ]
    for pitch_val, start, end in events:
        piano.notes.append(pretty_midi.Note(
            velocity=80, pitch=pitch_val, start=start, end=end,
        ))
    midi.instruments.append(piano)
    return midi


def test_pathological_short_durations_in_5sharp_key_export_succeeds():
    """
    Regression test for the "Cannot convert '2048th' duration to MusicXML"
    crash that zeroed the grand-staff output. Pre-fix, generate_musicxml
    would return None or empty string because makeNotation produced
    sub-notatable fragment durations that the MusicXML exporter rejected.

    Post-fix: stream.quantize + min-duration clamp keep every note on
    the 16th-note grid, so the export succeeds even with absurdly short
    input notes in a 5-sharp key.
    """
    from musicxml_generation import generate_musicxml

    midi = _build_pathological_5sharp_midi()
    xml_str, _ = generate_musicxml(midi, "Pathological", "Piano", 120)

    # ── Invariant 1: NON-EMPTY MusicXML.
    assert xml_str, (
        "generate_musicxml returned no content — the 2048th-duration "
        "regression has reappeared"
    )
    assert len(xml_str) > 500, (
        f"MusicXML output suspiciously small ({len(xml_str)} chars) — "
        "likely a near-empty score from a partial export failure"
    )

    root = ET.fromstring(xml_str)

    # ── Invariant 2: grand staff survived (<staves>2</staves>).
    staves_el = root.find(".//part/measure/attributes/staves")
    assert staves_el is not None and staves_el.text == "2", (
        f"expected <staves>2</staves>, got "
        f"{staves_el.text if staves_el is not None else 'missing'} — "
        "grand-staff layout lost"
    )

    # ── Invariant 3: a sharps-side key signature (|fifths| >= 4).
    # We accept any sharp/flat key with |fifths| >= 4 so the test is
    # robust to Krumhansl picking B major (5), G# minor (5), F# major
    # (6), etc., without being fragile to small reweightings.
    fifths_el = root.find(".//part/measure/attributes/key/fifths")
    assert fifths_el is not None, "no <key><fifths> in the score"
    fifths_val = int(fifths_el.text)
    assert abs(fifths_val) >= 4, (
        f"expected a heavily-sharped/flatted key (|fifths| >= 4), "
        f"got fifths={fifths_val}"
    )
