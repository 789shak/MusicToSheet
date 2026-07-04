"""
MusicXML generation from a PrettyMIDI object.

Kept in its own module (no FastAPI / httpx / librosa imports) so the
unit tests can exercise it without standing up the full server stack —
same pattern as note_extraction.py.

Notation rules:
- Piano renders as a grand staff: two stream.PartStaff bound by a
  layout.StaffGroup (brace). Notes with MIDI >= 60 (C4) go to the
  treble staff, < 60 to the bass.
- The detected key signature is written into the score. Every output
  Note is constructed fresh (Pitch(midi=...) → displayStatus is None),
  so makeNotation's accidental pass folds in-key notes through the key
  signature — e.g. F# in G major emits <alter>1</alter> with no
  <accidental> element.
- Tempo comes from the input PrettyMIDI's tempo map when present, else
  falls back to the caller's `bpm` arg. 120 is a conservative default;
  librosa audio beat-tracking is intentionally NOT used (it is
  unreliable and frequently picks an octave-wrong tempo for sparse
  piano content).
"""

import os
import tempfile
import uuid
import traceback


def generate_musicxml(
    midi_data,
    track_name: str = "Untitled",
    instrument_name: str = "Piano",
    bpm: int = 120,
) -> tuple:
    """
    Convert a PrettyMIDI object → (musicxml_string, None).

    The second tuple slot used to carry a "transposed notes" list back
    to the caller; that path is gone (we no longer transpose to C/Am to
    hide accidentals), but the slot is kept so callers' existing
    `transposed_notes or notes` fallback continues to work unchanged.
    Both values are None on failure (non-fatal).
    """
    import music21
    from music21 import (
        stream, meter, tempo, key, clef, instrument, metadata, layout,
        note, pitch, chord,
    )

    tmpdir = tempfile.gettempdir()
    midi_path     = os.path.join(tmpdir, f"{uuid.uuid4()}_output.mid")
    musicxml_path = os.path.join(tmpdir, f"{uuid.uuid4()}_output.musicxml")
    # Entry log — proves we are running THIS module (the grand-staff
    # generator) and lets us compare music21 versions between Render and
    # the offline pytest if behavior diverges.
    _will_grand_staff = (instrument_name or "").lower() == "piano"
    print(
        f"[musicxml] generator start: "
        f"instrument={instrument_name!r}, grand_staff_path={_will_grand_staff}, "
        f"music21={music21.__version__}"
    )
    try:
        print("[musicxml] Generating MusicXML...")
        if midi_data.instruments and midi_data.instruments[0].notes:
            print(f"[musicxml] First 5 note pitches: {[n.pitch for n in midi_data.instruments[0].notes[:5]]}")

        # ── Tempo: prefer the MIDI's own tempo map; fall back to the
        #   caller's bpm arg. 120 is a conservative default — we do
        #   NOT try to estimate tempo from audio (librosa beat-tracking
        #   is unreliable and frequently picks an octave-wrong value).
        midi_tempo = float(bpm) if bpm and bpm > 0 else 120.0
        try:
            _, tempos = midi_data.get_tempo_changes()
            if len(tempos) > 0 and 30.0 <= float(tempos[0]) <= 300.0:
                midi_tempo = float(tempos[0])
        except Exception:
            pass
        qps = midi_tempo / 60.0  # quarter-notes per second

        # ── Write MIDI to a temp file for music21 key analysis only.
        #   The actual notation is built from raw PrettyMIDI notes
        #   below so each output Note starts with a fresh accidental
        #   state.
        midi_data.write(midi_path)
        parsed = music21.converter.parse(midi_path)
        try:
            detected_key = parsed.analyze('key')
            key_sharps = int(detected_key.sharps)
            print(f"[musicxml] Detected key: {detected_key} (sharps={key_sharps})")
        except Exception as e:
            print(f"[musicxml] Key analysis failed: {e} — defaulting to C major")
            detected_key = None
            key_sharps = 0

        # Conservative key signature: Krumhansl key-detection on a NOISY
        # transcription frequently picks an extreme signature (e.g. g# minor =
        # 5 sharps) that is almost always wrong and renders as an intimidating
        # "wall of sharps." When the guess needs 5+ accidentals, fall back to C
        # major / no key signature and let individual accidentals carry the
        # pitches — this is what most transcription tools do and it reads far
        # cleaner. Simple 0–4 accidental keys are kept as detected.
        if abs(key_sharps) >= 5:
            print(f"[musicxml] key_sharps={key_sharps} is extreme for a transcription — falling back to C major (0)")
            key_sharps = 0

        # 16th-note grid. MIN_QL is one grid unit — the smallest duration
        # music21+MusicXML can safely notate end-to-end without slipping
        # into 32nd/64th/…/2048th fragments after makeNotation splits
        # notes across barlines.
        GRID_QL = 0.25
        MIN_QL  = 0.25

        def _snap(ql: float) -> float:
            # P0-2: snap to the nearest allowed duration on a 16th grid,
            # now INCLUDING dotted values so dotted eighths/quarters/halves
            # survive to the score instead of being rounded to the wrong
            # plain duration. All values are multiples of 0.25, so they stay
            # notatable through quantize + makeNotation.
            #   0.25=16th 0.5=8th 0.75=dotted-8th 1.0=quarter
            #   1.5=dotted-quarter 2.0=half 3.0=dotted-half 4.0=whole
            allowed = (0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0)
            return min(allowed, key=lambda a: abs(a - ql))

        def _snap_offset(off_ql: float) -> float:
            # Snap offset to nearest 16th. Pure rounding, no minimum —
            # offset 0.0 must stay 0.0.
            if off_ql <= 0.0:
                return 0.0
            return round(off_ql / GRID_QL) * GRID_QL

        pm_notes = []
        for inst in midi_data.instruments:
            for n in inst.notes:
                pm_notes.append(n)
        pm_notes.sort(key=lambda n: n.start)

        INSTRUMENT_MAP = {
            'piano':     instrument.Piano,
            'guitar':    instrument.Guitar,
            'violin':    instrument.Violin,
            'cello':     instrument.Violoncello,
            'flute':     instrument.Flute,
            'trumpet':   instrument.Trumpet,
            'saxophone': instrument.Saxophone,
            'bass':      instrument.ElectricBass,
            'vocals':    instrument.Vocalist,
            'singing':   instrument.Vocalist,
            'drums':     instrument.UnpitchedPercussion,
        }
        inst_class = INSTRUMENT_MAP.get(instrument_name.lower(), instrument.Piano)
        is_piano = instrument_name.lower() == "piano"

        new_score = stream.Score()
        md = metadata.Metadata()
        md.title = track_name
        new_score.metadata = md

        def _make_note(midi_val: int, ql: float):
            n = note.Note(pitch.Pitch(midi=int(midi_val)))
            n.duration.quarterLength = ql
            return n

        def _make_chord(midi_vals, ql: float):
            c = chord.Chord([pitch.Pitch(midi=int(m)) for m in sorted(set(midi_vals))])
            c.duration.quarterLength = ql
            return c

        def _grouped_elements(staff_notes):
            """
            P0-1 chord grouping. Notes whose onsets snap to the SAME 16th-grid
            slot on the same staff are merged into a single music21 Chord
            instead of being inserted as separate notes. Previously simultaneous
            notes were inserted independently, so music21 exploded them into up
            to 5 voices with <backup> elements — the stacked stems / overlapping
            noteheads that made piano look unreadable. Returns a list of
            (offset_ql, element) where element is a Note (1 pitch) or Chord (2+).
            """
            from collections import defaultdict as _dd
            buckets = _dd(list)
            for pm in staff_notes:
                off = _snap_offset(pm.start * qps)
                buckets[round(off, 4)].append(pm)
            offs = sorted(buckets)
            out = []
            for idx, off in enumerate(offs):
                grp = buckets[off]
                raw_ql = max((g.end - g.start) for g in grp) * qps
                # P0-1b: clip each note/chord to the NEXT onset so notes on a
                # staff never overlap. Sustained/overlapping piano notes were
                # exploding into stacked voices (many <backup> elements) with
                # rests filling every gap — the "messy / half-empty" look. One
                # note per onset per staff = a single clean voice.
                if idx + 1 < len(offs):
                    raw_ql = min(raw_ql, offs[idx + 1] - off)
                dur_ql = _snap(max(0.0625, raw_ql))
                pitches = sorted({int(g.pitch) for g in grp})
                el = (_make_note(pitches[0], dur_ql)
                      if len(pitches) == 1
                      else _make_chord(pitches, dur_ql))
                out.append((off, el))
            return out

        if is_piano:
            # ── Grand-staff branch ──────────────────────────────────────
            # If anything in here throws on the live server (PartStaff /
            # StaffGroup / KeySignature behavior can shift across music21
            # versions), we want it to ANNOUNCE itself in the logs rather
            # than be drowned out by the generic outer except. Logs the
            # full traceback, then re-raises — no silent fallback.
            try:
                rh = stream.PartStaff()
                lh = stream.PartStaff()

                rh.insert(0, inst_class())
                rh.insert(0, clef.TrebleClef())
                rh.insert(0, key.KeySignature(key_sharps))
                rh.insert(0, meter.TimeSignature('4/4'))
                rh.insert(0, tempo.MetronomeMark(number=int(round(midi_tempo))))

                lh.insert(0, inst_class())
                lh.insert(0, clef.BassClef())
                lh.insert(0, key.KeySignature(key_sharps))
                lh.insert(0, meter.TimeSignature('4/4'))

                # Split by staff first (treble >= C4, bass < C4), then group
                # each staff's simultaneous notes into chords. A real chord that
                # spans both hands is correctly split across the two staves.
                rh_notes = [pm for pm in pm_notes if int(pm.pitch) >= 60]
                lh_notes = [pm for pm in pm_notes if int(pm.pitch) < 60]
                for off, el in _grouped_elements(rh_notes):
                    rh.insert(off, el)
                for off, el in _grouped_elements(lh_notes):
                    lh.insert(off, el)

                new_score.insert(0, rh)
                new_score.insert(0, lh)
                new_score.insert(0, layout.StaffGroup(
                    [rh, lh], symbol='brace', barTogether=True,
                ))
                print(
                    f"[musicxml] grand-staff built: rh_notes={len(rh.flatten().notes)}, "
                    f"lh_notes={len(lh.flatten().notes)}, key_sharps={key_sharps}"
                )
            except Exception as gs_err:
                print(
                    f"[musicxml] GRAND-STAFF FAILED, falling back: "
                    f"{type(gs_err).__name__}: {gs_err}\n{traceback.format_exc()}"
                )
                raise
        else:
            # P0-3 companion: choose the clef from the ACTUAL pitch distribution
            # now that pitches are no longer octave-clamped upstream. Bass-heavy
            # content (bass guitar, low vocals, cello) gets a bass clef instead
            # of being forced onto a treble staff buried in ledger lines.
            _midis = [int(pm.pitch) for pm in pm_notes] or [60]
            _median = sorted(_midis)[len(_midis) // 2]
            chosen_clef = clef.BassClef() if _median < 55 else clef.TrebleClef()  # 55 = G3

            p = stream.Part()
            p.insert(0, inst_class())
            p.insert(0, chosen_clef)
            p.insert(0, key.KeySignature(key_sharps))
            p.insert(0, meter.TimeSignature('4/4'))
            p.insert(0, tempo.MetronomeMark(number=int(round(midi_tempo))))

            # P0-1 chord grouping applies to single-staff instruments too.
            for off, el in _grouped_elements(pm_notes):
                p.insert(off, el)

            new_score.insert(0, p)
            print(
                f"[musicxml] single-staff built: "
                f"elements={len(p.flatten().notes)}, clef={type(chosen_clef).__name__}"
            )

        # ── Safety-net quantization ─────────────────────────────────────
        # Per-note _snap_offset / _snap above handles the common case,
        # but PartStaff.insert can still leave float-drift offsets that
        # makeNotation will split into sub-notatable fragments (the
        # "Cannot convert '2048th' duration to MusicXML" crash).
        # stream.quantize with recurse=True locks every offset + duration
        # in every PartStaff/Part to the 16th-note grid. Then we clamp
        # any note that quantized to ql == 0 up to one grid unit so
        # MusicXML always has something notatable to write.
        try:
            new_score.quantize(
                quarterLengthDivisors=(4,),
                processOffsets=True,
                processDurations=True,
                inPlace=True,
                recurse=True,
            )
            clamped = 0
            for n in new_score.recurse().notes:
                if n.duration.quarterLength < MIN_QL:
                    n.duration.quarterLength = MIN_QL
                    clamped += 1
            if clamped:
                print(f"[musicxml] clamped {clamped} sub-grid notes up to {MIN_QL} ql")
        except Exception as q_err:
            print(
                f"[musicxml] quantize FAILED (continuing without): "
                f"{type(q_err).__name__}: {q_err}\n{traceback.format_exc()}"
            )

        # makeNotation chunks notes into measures, fills gaps with
        # rests, and runs makeAccidentals using the KeySignature it
        # finds on each part. With fresh notes (displayStatus=None) and
        # the key signature in place, in-key accidentals are folded
        # into the key signature — no redundant <accidental> element.
        try:
            new_score.makeNotation(inPlace=True)
        except Exception as mn_err:
            print(
                f"[musicxml] makeNotation FAILED: "
                f"{type(mn_err).__name__}: {mn_err}\n{traceback.format_exc()}"
            )
            raise

        # Confirm grand-staff survived makeNotation: count PartStaff parts
        # and Part parts in the final Score. If grand_staff_path was True
        # but n_partstaff == 0, the export will be single-staff regardless
        # of what we built above.
        if _will_grand_staff:
            n_partstaff = sum(1 for p in new_score.parts if isinstance(p, stream.PartStaff))
            n_part      = sum(1 for p in new_score.parts if not isinstance(p, stream.PartStaff))
            print(
                f"[musicxml] post-makeNotation: PartStaff={n_partstaff}, "
                f"Part={n_part}, total_parts={len(new_score.parts)}"
            )

        try:
            new_score.write('musicxml', fp=musicxml_path)
            with open(musicxml_path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
        except Exception as e:
            # Never silently store 0-char MusicXML as a successful job.
            # Surface the failure to the caller (None) so they can mark
            # the job as failed instead of shipping an empty score.
            print(
                f"[musicxml] MusicXML write/read FAILED: "
                f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
            )
            return None, None

        if not content or len(content) < 100:
            print(
                f"[musicxml] MusicXML export produced empty/tiny output "
                f"({len(content)} chars) — treating as failure"
            )
            return None, None

        print(
            f"[musicxml] MusicXML generated — {len(content):,} chars, "
            f"key={detected_key} (sharps={key_sharps}), "
            f"tempo={midi_tempo:.1f} bpm, "
            f"grand_staff={is_piano}, notes={len(pm_notes)}"
        )
        return content, None

    except Exception as e:
        print(f"[musicxml] Generation failed (non-fatal): {e}\n{traceback.format_exc()}")
        return None, None

    finally:
        # P0 fixes (chord grouping, dotted rhythm, clef selection) applied July 2026.
        for f in [midi_path, musicxml_path]:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception:
                    pass
