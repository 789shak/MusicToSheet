import os
import uuid
import asyncio
import traceback
import subprocess
import gc
import numpy as np
import httpx
import librosa
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
      notes     – list of note dicts: pitch, start, duration, velocity, confidence
      midi_data – PrettyMIDI object (used downstream for MusicXML generation)
    """
    print("[basic_pitch] Running Basic Pitch inference...")
    model_output, midi_data, note_events = predict(wav_path)
    print(f"[basic_pitch] Inference complete. {len(note_events)} raw note events.")

    if note_events and len(note_events) > 0:
        print(f"[basic_pitch] First note_event type: {type(note_events[0])}")
        print(f"[basic_pitch] First note_event: {note_events[0]}")

    def _scalar(v):
        """Extract a plain float/int from a value that may be a list or array."""
        if isinstance(v, (list, tuple)):
            return v[0]
        if hasattr(v, '__len__') and not isinstance(v, str):
            return float(v.flat[0]) if hasattr(v, 'flat') else v[0]
        return v

    notes = []
    for event in note_events:
        try:
            if isinstance(event, (list, tuple)):
                if len(event) >= 5:
                    start, end, pitch_midi, velocity, confidence = event[0], event[1], event[2], event[3], event[4]
                elif len(event) >= 4:
                    start, end, pitch_midi, velocity = event[0], event[1], event[2], event[3]
                    confidence = 0.8
                else:
                    continue
            elif hasattr(event, 'start'):
                start      = float(event.start)
                end        = float(event.end)
                pitch_midi = int(event.pitch)
                velocity   = float(event.velocity)   if hasattr(event, 'velocity')   else 0.8
                confidence = float(event.confidence) if hasattr(event, 'confidence') else 0.8
            else:
                print(f"[basic_pitch] Unknown event format: {event}")
                continue

            start      = float(_scalar(start))
            end        = float(_scalar(end))
            pitch_midi = int(_scalar(pitch_midi))
            velocity   = float(_scalar(velocity))
            confidence = float(_scalar(confidence))

            note_name = pretty_midi.note_number_to_name(pitch_midi)
            notes.append({
                "pitch":      note_name,
                "start":      round(start, 3),
                "duration":   round(end - start, 3),
                "velocity":   round(velocity, 2),
                "confidence": round(confidence, 2),
            })
        except Exception as e:
            print(f"[basic_pitch] Skipping note event due to error: {e}")
            continue

    print(f"[basic_pitch] {len(notes)} notes after processing.")
    return notes, midi_data


# ─── MusicXML generation ──────────────────────────────────────────────────────
def generate_musicxml(midi_data, uid: str) -> str | None:
    """
    Convert a PrettyMIDI object → MusicXML string via music21.

    Before writing the MIDI file, all note pitches are clamped to the
    treble clef staff range (G3–A5, MIDI 55–81) by shifting
    out-of-range notes up or down by octaves. This keeps notes within
    the staff with at most 1–2 ledger lines.

    Returns None on failure (non-fatal; caller renders without MusicXML).
    """
    midi_path     = f"/tmp/{uid}_midi.mid"
    musicxml_path = f"/tmp/{uid}_score.musicxml"
    try:
        # ── Clamp all note pitches to treble clef range (C3–C6) ──────────
        # Any note below C3 (48) is shifted up by octaves until it fits.
        # Any note above C6 (84) is shifted down by octaves until it fits.
        # This mirrors what the user would hear but keeps notation readable.
        for instrument in midi_data.instruments:
            for note in instrument.notes:
                while note.pitch < 55:
                    note.pitch += 12
                while note.pitch > 81:
                    note.pitch -= 12
        print("[musicxml] Note pitches clamped to MIDI 55–81 (G3–A5)")

        midi_data.write(midi_path)
        print("[musicxml] MIDI written, parsing with music21...")

        import music21  # lazy import — avoids heavy startup cost on cold boot
        from music21 import key as m21key
        score = music21.converter.parse(midi_path)

        # Quantize to rhythmic grid (produces quarter, eighth, half notes, etc.)
        score.quantize([0.25, 0.5, 1.0, 2.0], inPlace=True)

        # Key analysis — detect and embed key signature
        key = score.analyze('key')
        print(f"[musicxml] Detected key: {key}")

        # Insert key signature at the start of every part so music21 groups
        # sharps/flats into a key signature instead of marking each note
        ks = m21key.KeySignature(key.sharps)
        for part in score.parts:
            part.insert(0, ks)

        # Strip explicit accidentals that are already covered by the key signature.
        # MIDI files encode every sharp/flat explicitly; without this, music21
        # renders redundant accidentals on every note even when a key sig is present.
        key_obj = music21.key.Key(key.tonic.name, key.mode)
        key_pitches = [p.name for p in key_obj.pitches]
        for note in score.recurse().notes:
            if hasattr(note, 'pitch'):
                if note.pitch.name in key_pitches and note.pitch.accidental:
                    note.pitch.accidental.displayStatus = False
            elif hasattr(note, 'pitches'):  # chord
                for p in note.pitches:
                    if p.name in key_pitches and p.accidental:
                        p.accidental.displayStatus = False

        # Apply notation rules (respects the key signature when rendering accidentals)
        score.makeNotation(inPlace=True)

        score.write('musicxml', fp=musicxml_path)

        with open(musicxml_path, 'r', encoding='utf-8') as f:
            content = f.read()

        print(f"[musicxml] MusicXML generated — {len(content):,} chars")
        return content

    except Exception as e:
        print(f"[musicxml] Generation failed (non-fatal): {e}\n{traceback.format_exc()}")
        return None

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
        print("[process] Step 5: Generating MusicXML...")
        musicxml = await asyncio.to_thread(generate_musicxml, midi_data, uid)
        if musicxml:
            print(f"[process] MusicXML ready ({len(musicxml):,} chars)")
        else:
            print("[process] MusicXML generation skipped/failed — returning notes only")

        track_name = os.path.splitext(original_name)[0] or "Untitled"
        gc.collect()

        return {
            "status":           "success",
            "track_name":       track_name,
            "instrument":       body.instrument,
            "format":           body.output_format,
            "duration_seconds": round(duration_seconds),
            "notes":            notes,
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
        print("[stems] Step 9: Generating MusicXML...")
        musicxml = await asyncio.to_thread(generate_musicxml, midi_data, uid)
        if musicxml:
            print(f"[stems] MusicXML ready ({len(musicxml):,} chars)")
        else:
            print("[stems] MusicXML generation skipped/failed — returning notes only")

        track_name = os.path.splitext(original_name)[0] or "Untitled"
        gc.collect()

        # Step 10: Return notes + MusicXML + detected stems
        return {
            "status":           "success",
            "track_name":       track_name,
            "instrument":       body.instrument,
            "format":           body.output_format,
            "duration_seconds": round(duration_seconds),
            "notes":            notes,
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
