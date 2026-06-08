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
