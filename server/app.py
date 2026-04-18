import os
import uuid
import asyncio
import traceback
import subprocess
import gc
import numpy as np
import httpx
import librosa
import soundfile as sf
import noisereduce as nr
import pretty_midi
import replicate
from basic_pitch.inference import predict
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Music-To-Sheet API")

# ─── Schema ───────────────────────────────────────────────────────────────────
class ProcessRequest(BaseModel):
    audio_url: str
    instrument: str
    output_format: str

# Stem selection: which Demucs output stem to use per instrument
# None → use original audio (Full Score)
INSTRUMENT_TO_STEM = {
    'Vocals':    'vocals',
    'Singing':   'vocals',
    'Drums':     'drums',
    'Bass':      'bass',
    'Piano':     'other',
    'Guitar':    'other',
    'Violin':    'other',
    'Cello':     'other',
    'Flute':     'other',
    'Trumpet':   'other',
    'Saxophone': 'other',
    'Full Score': None,
}

# ─── Helpers ──────────────────────────────────────────────────────────────────
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "audio/*,*/*;q=0.9",
    "Accept-Language": "en-US,en;q=0.9",
}

async def download_audio(url: str, dest_path: str) -> int:
    async with httpx.AsyncClient(
        follow_redirects=True,
        max_redirects=10,
        timeout=120.0,
        headers=BROWSER_HEADERS,
    ) as client:
        async with client.stream('GET', url) as response:
            print(f"[download] Final URL after redirects: {response.url}")
            print(f"[download] Response status: {response.status_code}")
            print(f"[download] Response headers: {dict(response.headers)}")
            response.raise_for_status()
            total = 0
            with open(dest_path, 'wb') as f:
                async for chunk in response.aiter_bytes(chunk_size=8192):
                    f.write(chunk)
                    total += len(chunk)
            print(f"[download] Streamed {total} bytes to {dest_path}")
            return total


# ─── Basic Pitch note detection ───────────────────────────────────────────────
def detect_notes_with_basic_pitch(wav_path: str) -> tuple:
    """
    Run Spotify Basic Pitch on a WAV file.
    Returns (notes, midi_data) where:
      notes     – list of note dicts with CLAMPED pitches (C4–C6, MIDI 60–84)
      midi_data – fresh PrettyMIDI object built from the same clamped events

    Clamping happens here so both the frontend JSON and the MusicXML MIDI file
    are guaranteed to share identical, in-range pitches.
    """
    print("[basic_pitch] Running Basic Pitch inference...")
    model_output, _raw_midi, note_events = predict(wav_path)
    print(f"[basic_pitch] Inference complete. {len(note_events)} raw note events.")

    if note_events and len(note_events) > 0:
        print(f"[basic_pitch] First note_event type: {type(note_events[0])}")
        print(f"[basic_pitch] First note_event: {note_events[0]}")

    def _scalar(v):
        """Extract a plain Python scalar from a numpy array, list, or bare value."""
        if isinstance(v, (list, tuple)):
            return v[0]
        if hasattr(v, '__len__') and not isinstance(v, str):
            return float(v.flat[0]) if hasattr(v, 'flat') else v[0]
        return v

    # ── Step 1: Normalize all event formats → plain Python tuples ────────────
    raw = []
    for event in note_events:
        try:
            if isinstance(event, (list, tuple)):
                if len(event) >= 5:
                    s, e, p, v, c = event[0], event[1], event[2], event[3], event[4]
                elif len(event) >= 4:
                    s, e, p, v = event[0], event[1], event[2], event[3]
                    c = 0.8
                else:
                    continue
            elif hasattr(event, 'start'):
                s = event.start
                e = event.end
                p = event.pitch
                v = event.velocity   if hasattr(event, 'velocity')   else 0.8
                c = event.confidence if hasattr(event, 'confidence') else 0.8
            else:
                print(f"[basic_pitch] Unknown event format: {event}")
                continue

            raw.append((
                float(_scalar(s)),
                float(_scalar(e)),
                int(_scalar(p)),
                float(_scalar(v)),
                float(_scalar(c)),
            ))
        except Exception as ex:
            print(f"[basic_pitch] Skipping note event due to error: {ex}")
            continue

    # ── Step 2: Clamp pitches to treble clef range C4–C6 (MIDI 60–84) ───────
    adjusted = []
    for start, end, pitch, velocity, confidence in raw:
        while pitch < 60:
            pitch += 12
        while pitch > 84:
            pitch -= 12
        adjusted.append((start, end, pitch, velocity, confidence))
    print(f"[basic_pitch] {len(adjusted)} notes after normalization and clamping.")
    if adjusted:
        print(f"[basic_pitch] Pitch range after clamping: min={min(p[2] for p in adjusted)}, max={max(p[2] for p in adjusted)}")

    # ── Step 3: Build the notes JSON list from clamped events ─────────────────
    notes = []
    for start, end, pitch, velocity, confidence in adjusted:
        notes.append({
            "pitch":      pretty_midi.note_number_to_name(pitch),
            "start":      round(start, 3),
            "duration":   round(end - start, 3),
            "velocity":   round(velocity, 2),
            "confidence": round(confidence, 2),
        })

    # ── Step 4: Build a fresh PrettyMIDI from the clamped events ─────────────
    new_midi = pretty_midi.PrettyMIDI(initial_tempo=120)
    piano    = pretty_midi.Instrument(program=0)  # Acoustic Grand Piano
    for start, end, pitch, velocity, confidence in adjusted:
        # velocity from Basic Pitch is 0–1; PrettyMIDI expects 0–127
        vel_int = max(1, min(127, int(velocity * 127) if velocity <= 1.0 else int(velocity)))
        piano.notes.append(pretty_midi.Note(
            velocity=vel_int,
            pitch=int(pitch),
            start=float(start),
            end=float(end),
        ))
    new_midi.instruments.append(piano)
    print(f"[basic_pitch] PrettyMIDI rebuilt with {len(piano.notes)} clamped notes.")

    return notes, new_midi


# ─── MusicXML generation ──────────────────────────────────────────────────────
def generate_musicxml(
    midi_data,
    track_name: str = "Untitled",
    instrument_name: str = "Piano",
    bpm: int = 120,
) -> tuple:
    """
    Convert a PrettyMIDI object → professional MusicXML string via music21.

    Applies pitch clamping, key signature, quantization, rests, and beaming.
    Returns (musicxml_string, transposed_notes_list).
    Both values are None on failure (non-fatal; callers fall back to original notes).
    """
    import music21
    from music21 import stream, meter, tempo, key, clef, instrument, metadata

    midi_path     = f"/tmp/{uuid.uuid4()}_output.mid"
    musicxml_path = f"/tmp/{uuid.uuid4()}_output.musicxml"
    try:
        print("[musicxml] Generating professional MusicXML...")
        if midi_data.instruments and midi_data.instruments[0].notes:
            print(f"[musicxml] First 5 note pitches in midi_data: {[n.pitch for n in midi_data.instruments[0].notes[:5]]}")
        # Pitches are already clamped to C4–C6 (MIDI 60–84) by detect_notes_with_basic_pitch.

        # Step 1: Write MIDI to temp file
        midi_data.write(midi_path)
        print("[musicxml] MIDI written, parsing with music21...")

        # Step 2: Parse with music21
        score = music21.converter.parse(midi_path)

        # Step 3: Detect key signature
        detected_key = score.analyze('key')
        print(f"[musicxml] Detected key: {detected_key}")

        # Step 3b: Transpose to C major / A minor — zero accidentals, cleaner output
        try:
            if detected_key.mode == 'major':
                semitones_down = detected_key.tonic.midi % 12  # distance from C
                if semitones_down > 6:
                    semitones_down = semitones_down - 12        # transpose up instead
                score = score.transpose(-semitones_down)
                print(f"[musicxml] Transposed from {detected_key} to C major ({-semitones_down} semitones)")
            else:
                # minor key — transpose to A minor
                semitones_down = (detected_key.tonic.midi % 12) - 9  # distance from A
                if semitones_down > 6:
                    semitones_down = semitones_down - 12
                score = score.transpose(-semitones_down)
                print(f"[musicxml] Transposed from {detected_key} to A minor ({-semitones_down} semitones)")
        except Exception as e:
            print(f"[musicxml] Transpose failed (non-fatal): {e}")

        # Step 4: Build the reconstructed score with proper notation headers
        # Key signature is C major (0 sharps/flats) — accidentals eliminated by transpose above
        ts = meter.TimeSignature('4/4')
        mm = tempo.MetronomeMark(number=bpm)

        new_score = stream.Score()
        md = metadata.Metadata()
        md.title = track_name
        new_score.metadata = md

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

        for part_idx, part in enumerate(score.parts):
            new_part = stream.Part()
            new_part.insert(0, inst_class())
            new_part.insert(0, clef.TrebleClef())
            new_part.insert(0, key.KeySignature(0))  # C major — no sharps or flats
            new_part.insert(0, ts)
            if part_idx == 0:
                new_part.insert(0, mm)

            for element in part.recurse().notesAndRests:
                new_part.append(element)

            new_score.insert(0, new_part)

        # Step 5: Snap note durations to standard rhythmic values
        raw_durations = [n.duration.quarterLength for n in new_score.recurse().notes[:10]]
        print(f"[musicxml] Raw note durations (first 10): {raw_durations}")

        for n in new_score.recurse().notes:
            ql = n.duration.quarterLength
            if ql < 0.375:        # less than dotted sixteenth → sixteenth
                n.duration.quarterLength = 0.25
            elif ql < 0.625:      # less than dotted eighth → eighth
                n.duration.quarterLength = 0.5
            elif ql < 1.25:       # less than dotted quarter → quarter
                n.duration.quarterLength = 1.0
            elif ql < 2.5:        # less than dotted half → half
                n.duration.quarterLength = 2.0
            else:                 # whole
                n.duration.quarterLength = 4.0

        # Step 6: Apply full notation (beams, stems, rests, ties)
        new_score.makeNotation(inPlace=True)
        durations_after = [n.duration.quarterLength for n in new_score.recurse().notes[:10]]
        print(f"[musicxml] Quantized durations (first 10): {durations_after}")

        # Step 7: Extract note names from the transposed + quantized score.
        # These replace the original Basic Pitch notes so the frontend receives
        # pitch names that match the MusicXML (e.g. "C4" not "C#4").
        transposed_notes = []
        for n in new_score.recurse().notes:
            if hasattr(n, 'pitch'):
                transposed_notes.append({
                    "pitch":      n.pitch.nameWithOctave,
                    "start":      round(float(n.offset), 3),
                    "duration":   round(float(n.duration.quarterLength), 3),
                    "velocity":   0.8,
                    "confidence": 0.8,
                })
            elif hasattr(n, 'pitches'):  # chord
                for p in n.pitches:
                    transposed_notes.append({
                        "pitch":      p.nameWithOctave,
                        "start":      round(float(n.offset), 3),
                        "duration":   round(float(n.duration.quarterLength), 3),
                        "velocity":   0.8,
                        "confidence": 0.8,
                    })
        transposed_notes.sort(key=lambda x: x['start'])
        print(f"[musicxml] Transposed notes — first 5 pitches: {[n['pitch'] for n in transposed_notes[:5]]}")

        # Step 8: Export MusicXML
        new_score.write('musicxml', fp=musicxml_path)
        with open(musicxml_path, 'r', encoding='utf-8') as f:
            content = f.read()

        print(f"[musicxml] MusicXML generated — {len(content):,} chars")
        print(f"[musicxml] Key: {detected_key}, Time: 4/4, Tempo: {bpm} bpm")
        return content, transposed_notes

    except Exception as e:
        print(f"[musicxml] Generation failed (non-fatal): {e}\n{traceback.format_exc()}")
        return None, None

    finally:
        for f in [midi_path, musicxml_path]:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception:
                    pass


# ─── Endpoints ────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "Music-To-Sheet API is running"}


@app.post("/process")
async def process_audio(body: ProcessRequest):
    tmp_path = None
    wav_path = None
    try:
        # Step 1: Download audio
        print("[process] Step 1: Downloading audio...")
        print(f"[process] Downloading from URL: {body.audio_url[:100]}...")

        original_name = body.audio_url.split("?")[0].split("/")[-1]
        ext = os.path.splitext(original_name)[1].lower() or ".mp3"
        uid = str(uuid.uuid4())
        tmp_path = f"/tmp/{uid}{ext}"
        wav_path = f"/tmp/{uid}.wav"

        file_size = await download_audio(body.audio_url, tmp_path)
        print(f"[process] Downloaded file size: {file_size} bytes")
        if file_size < 1000:
            raise Exception(f"Downloaded file too small ({file_size} bytes) — likely failed download")

        print(f"[process] Saved to temp file: {tmp_path}")

        # Step 2: Convert to WAV via ffmpeg
        print("[process] Step 2: Converting to WAV with ffmpeg...")
        result = subprocess.run(
            ['ffmpeg', '-i', tmp_path, '-t', '60', '-ar', '22050', '-ac', '1', '-sample_fmt', 's16', wav_path, '-y'],
            capture_output=True,
            text=True,
        )
        print(f"[process] ffmpeg stdout: {result.stdout}")
        print(f"[process] ffmpeg stderr: {result.stderr}")
        if result.returncode != 0:
            raise Exception(f"ffmpeg failed with code {result.returncode}: {result.stderr}")
        print(f"[process] Converted to WAV: {wav_path}")

        # Step 2b: Noise reduction
        print("[process] Step 2b: Applying noise reduction...")
        _nr_y, _nr_sr = sf.read(wav_path)
        _nr_reduced = nr.reduce_noise(
            y=_nr_y,
            sr=_nr_sr,
            prop_decrease=0.6,
            stationary=False,
            n_fft=2048,
            freq_mask_smooth_hz=500,
        )
        sf.write(wav_path, _nr_reduced, _nr_sr)
        del _nr_y, _nr_reduced
        gc.collect()
        print("[process] Noise reduction complete")

        # Step 3: Load WAV with librosa for duration
        print("[process] Step 3: Loading WAV with librosa...")
        y, sr = librosa.load(wav_path, sr=22050, mono=True, duration=60.0)
        duration_seconds = float(librosa.get_duration(y=y, sr=sr))
        print(f"[process] Audio duration: {duration_seconds:.2f}s")
        del y
        gc.collect()

        # Step 4: Run Basic Pitch inference
        print("[process] Step 4: Running Basic Pitch inference...")
        notes, midi_data = await asyncio.to_thread(detect_notes_with_basic_pitch, wav_path)
        print(f"[process] Basic Pitch detected {len(notes)} notes")

        # Step 5: Generate MusicXML from the MIDI data
        track_name = os.path.splitext(original_name)[0] or "Untitled"
        print("[process] Step 5: Generating MusicXML...")
        musicxml, transposed_notes = await asyncio.to_thread(
            generate_musicxml, midi_data, track_name, body.instrument, 120
        )
        if musicxml:
            print(f"[process] MusicXML ready ({len(musicxml):,} chars)")
        else:
            print("[process] MusicXML generation skipped/failed — returning notes only")
        gc.collect()

        return {
            "status":           "success",
            "track_name":       track_name,
            "instrument":       body.instrument,
            "format":           body.output_format,
            "duration_seconds": round(duration_seconds),
            "notes":            transposed_notes or notes,
            "musicxml":         musicxml,
            "confidence":       0.90,
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[process] Error: {e}")
        print(f"[process] Full error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        for f in [tmp_path, wav_path]:
            if f and os.path.exists(f):
                os.remove(f)
                print(f"[process] Deleted temp file: {f}")


# ─── /process-with-stems ──────────────────────────────────────────────────────
@app.post("/process-with-stems")
async def process_with_stems(body: ProcessRequest):
    tmp_path = None
    wav_path = None
    stem_path = None
    stem_wav_path = None
    try:
        # Step 1: Download original audio
        print("[stems] Step 1: Downloading audio...")
        original_name = body.audio_url.split("?")[0].split("/")[-1]
        ext = os.path.splitext(original_name)[1].lower() or ".mp3"
        uid = str(uuid.uuid4())
        tmp_path = f"/tmp/{uid}{ext}"

        file_size = await download_audio(body.audio_url, tmp_path)
        print(f"[stems] Downloaded {file_size} bytes to {tmp_path}")
        if file_size < 1000:
            raise Exception(f"Downloaded file too small ({file_size} bytes)")

        # Step 2: Call Replicate Demucs for stem separation
        print("[stems] Step 2: Running Demucs via Replicate...")
        replicate_token = os.environ.get("REPLICATE_API_TOKEN")
        if not replicate_token:
            raise Exception("REPLICATE_API_TOKEN environment variable not set")

        client = replicate.Client(api_token=replicate_token)
        output = await asyncio.to_thread(
            client.run,
            "cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953",
            input={"audio": body.audio_url},
        )
        print(f"[stems] Demucs output type: {type(output)}, value: {output}")

        # Step 3: Detect which stems are available
        detected_stems = []
        stem_urls = {}
        if isinstance(output, dict):
            for stem_name in ("vocals", "drums", "bass", "other"):
                if output.get(stem_name):
                    detected_stems.append(stem_name)
                    stem_urls[stem_name] = str(output[stem_name])
        else:
            # Some model versions return a list in order: drums, bass, other, vocals
            stem_order = ["drums", "bass", "other", "vocals"]
            for idx, url in enumerate(output or []):
                if idx < len(stem_order) and url:
                    name = stem_order[idx]
                    detected_stems.append(name)
                    stem_urls[name] = str(url)
        print(f"[stems] Detected stems: {detected_stems}")

        # Step 4: Pick the right stem URL based on instrument
        selected_stem = INSTRUMENT_TO_STEM.get(body.instrument)
        print(f"[stems] Instrument '{body.instrument}' → stem '{selected_stem}'")

        if selected_stem is None or selected_stem not in stem_urls:
            # Full Score or unmapped instrument → use original audio
            print("[stems] Using original audio (no stem)")
            audio_for_detection = tmp_path
        else:
            # Step 5: Download the selected stem
            stem_ext = ".wav"
            stem_path = f"/tmp/{uid}_stem{stem_ext}"
            print(f"[stems] Step 5: Downloading stem '{selected_stem}' from {stem_urls[selected_stem][:80]}...")
            stem_size = await download_audio(stem_urls[selected_stem], stem_path)
            print(f"[stems] Stem downloaded: {stem_size} bytes")
            audio_for_detection = stem_path

        # Step 6: Convert to WAV with ffmpeg
        wav_path = f"/tmp/{uid}_out.wav"
        print("[stems] Step 6: Converting to WAV with ffmpeg...")
        result = subprocess.run(
            ['ffmpeg', '-i', audio_for_detection, '-t', '60', '-ar', '22050', '-ac', '1', '-sample_fmt', 's16', wav_path, '-y'],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise Exception(f"ffmpeg failed: {result.stderr}")
        print(f"[stems] Converted to WAV: {wav_path}")

        # Step 6b: Noise reduction
        print("[stems] Step 6b: Applying noise reduction...")
        _nr_y, _nr_sr = sf.read(wav_path)
        _nr_reduced = nr.reduce_noise(
            y=_nr_y,
            sr=_nr_sr,
            prop_decrease=0.6,
            stationary=False,
            n_fft=2048,
            freq_mask_smooth_hz=500,
        )
        sf.write(wav_path, _nr_reduced, _nr_sr)
        del _nr_y, _nr_reduced
        gc.collect()
        print("[stems] Noise reduction complete")

        # Step 7: Load WAV with librosa for duration
        print("[stems] Step 7: Loading WAV with librosa...")
        y, sr = librosa.load(wav_path, sr=22050, mono=True, duration=60.0)
        duration_seconds = float(librosa.get_duration(y=y, sr=sr))
        del y
        gc.collect()

        # Step 8: Run Basic Pitch inference
        print("[stems] Step 8: Running Basic Pitch inference...")
        notes, midi_data = await asyncio.to_thread(detect_notes_with_basic_pitch, wav_path)
        print(f"[stems] Basic Pitch detected {len(notes)} notes.")

        # Step 9: Generate MusicXML from the MIDI data
        track_name = os.path.splitext(original_name)[0] or "Untitled"
        print("[stems] Step 9: Generating MusicXML...")
        musicxml, transposed_notes = await asyncio.to_thread(
            generate_musicxml, midi_data, track_name, body.instrument, 120
        )
        if musicxml:
            print(f"[stems] MusicXML ready ({len(musicxml):,} chars)")
        else:
            print("[stems] MusicXML generation skipped/failed — returning notes only")
        gc.collect()

        # Step 10: Return notes + MusicXML + detected stems
        return {
            "status":           "success",
            "track_name":       track_name,
            "instrument":       body.instrument,
            "format":           body.output_format,
            "duration_seconds": round(duration_seconds),
            "notes":            transposed_notes or notes,
            "musicxml":         musicxml,
            "confidence":       0.90,
            "stems_detected":   detected_stems,
            "stem_used":        selected_stem,
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[stems] Error: {e}")
        print(f"[stems] Full error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        for f in [tmp_path, wav_path, stem_path, stem_wav_path]:
            if f and os.path.exists(f):
                os.remove(f)
                print(f"[stems] Deleted temp file: {f}")


# ─── Clean Audio Endpoint ──────────────────────────────────────────────────────
from fastapi import Request
from fastapi.responses import JSONResponse
import base64 as _base64

@app.post("/clean-audio")
async def clean_audio(request: Request):
    try:
        data = await request.json()
        audio_url = data.get("audio_url")
        if not audio_url:
            return JSONResponse({"error": "No audio_url provided"}, status_code=400)

        file_id = uuid.uuid4().hex
        input_path = f"/tmp/{file_id}_input.mp3"
        wav_path   = f"/tmp/{file_id}_clean.wav"
        output_path = f"/tmp/{file_id}_cleaned.mp3"

        print(f"[clean] Step 1: Downloading audio from {audio_url[:80]}...")
        async with httpx.AsyncClient(follow_redirects=True, timeout=120) as client:
            resp = await client.get(audio_url)
            with open(input_path, 'wb') as f:
                f.write(resp.content)

        print("[clean] Step 2: Converting to WAV...")
        subprocess.run(
            ["ffmpeg", "-y", "-i", input_path, "-ac", "1", "-ar", "22050", wav_path],
            capture_output=True,
        )

        print("[clean] Step 3: Applying noise reduction...")
        audio_data, sample_rate = sf.read(wav_path)
        reduced = nr.reduce_noise(
            y=audio_data,
            sr=sample_rate,
            prop_decrease=0.6,
            stationary=False,
            n_fft=2048,
            freq_mask_smooth_hz=500,
        )
        sf.write(wav_path, reduced, sample_rate)
        del audio_data, reduced
        gc.collect()

        print("[clean] Step 4: Converting back to MP3...")
        subprocess.run(
            ["ffmpeg", "-y", "-i", wav_path, "-b:a", "192k", output_path],
            capture_output=True,
        )

        print("[clean] Step 5: Encoding to base64...")
        with open(output_path, 'rb') as f:
            audio_base64 = _base64.b64encode(f.read()).decode()

        print(f"[clean] Done. Cleaned audio size: {len(audio_base64)} chars base64")
        return JSONResponse({"status": "success", "audio_base64": audio_base64, "format": "mp3"})

    except Exception as e:
        print(f"[clean] Error: {e}")
        print(f"[clean] Full error: {traceback.format_exc()}")
        return JSONResponse({"error": str(e)}, status_code=500)

    finally:
        for p in [input_path, wav_path, output_path]:
            if p and os.path.exists(p):
                os.remove(p)
