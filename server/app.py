import os
import uuid
import tempfile
import traceback
import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from basic_pitch.inference import predict

app = FastAPI(title="Music-To-Sheet API")

# ─── MIDI pitch → note name ───────────────────────────────────────────────────
_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

def midi_to_note_name(midi_pitch: int) -> str:
    octave = (midi_pitch // 12) - 1
    name = _NOTE_NAMES[midi_pitch % 12]
    return f"{name}{octave}"

# ─── Instrument pitch ranges (MIDI) ──────────────────────────────────────────
# Filters out notes clearly outside the instrument's practical range.
_INSTRUMENT_RANGES = {
    'piano':      (21, 108),
    'guitar':     (40, 88),
    'bass':       (28, 60),
    'violin':     (55, 103),
    'viola':      (48, 93),
    'cello':      (36, 76),
    'flute':      (60, 96),
    'trumpet':    (52, 82),
    'saxophone':  (49, 80),
    'vocals':     (48, 84),
}

def pitch_range_for_instrument(instrument: str):
    key = instrument.strip().lower()
    return _INSTRUMENT_RANGES.get(key, (0, 127))  # default: no filtering

# ─── Schema ───────────────────────────────────────────────────────────────────
class ProcessRequest(BaseModel):
    audio_url: str
    instrument: str
    output_format: str

# ─── Endpoints ────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "Music-To-Sheet API is running"}


@app.post("/process")
async def process_audio(body: ProcessRequest):
    tmp_path = None
    try:
        # 1. Download the audio file
        print("[process] Step 1: Downloading audio...")
        print(f"[process] Downloading audio from: {body.audio_url}")
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(body.audio_url)
            if response.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to download audio (HTTP {response.status_code})",
                )

        # 2. Load with librosa (via Basic Pitch)
        print("[process] Step 2: Loading with librosa...")

        # Save to a temp file, preserving the original extension
        original_name = body.audio_url.split("?")[0].split("/")[-1]  # strip query params
        ext = os.path.splitext(original_name)[1] or ".mp3"
        tmp_path = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4()}{ext}")
        with open(tmp_path, "wb") as f:
            f.write(response.content)
        print(f"[process] Saved to temp file: {tmp_path}")

        # 3. Run Basic Pitch
        print("[process] Step 3: Running pitch detection...")
        print("[process] Running Basic Pitch inference...")
        model_output, midi_data, note_events = predict(tmp_path)
        # note_events rows: [start_time, end_time, pitch_midi, velocity, confidence]
        print(f"[process] Basic Pitch returned {len(note_events)} note events")

        # 4. Convert to note names
        print("[process] Step 4: Converting to note names...")

        # Determine track duration from note events (or fall back to 0)
        duration_seconds = 0.0
        if len(note_events) > 0:
            duration_seconds = float(max(row[1] for row in note_events))

        # 5. Filter by instrument range and convert to dict list
        lo, hi = pitch_range_for_instrument(body.instrument)
        notes = []
        total_confidence = 0.0
        for row in note_events:
            start_time, end_time, pitch_midi, velocity, confidence = row
            pitch_midi = int(pitch_midi)
            if not (lo <= pitch_midi <= hi):
                continue
            notes.append({
                "pitch":    midi_to_note_name(pitch_midi),
                "start":    round(float(start_time), 3),
                "duration": round(float(end_time) - float(start_time), 3),
                "velocity": int(velocity),
            })
            total_confidence += float(confidence)

        avg_confidence = (total_confidence / len(notes)) if notes else 0.0
        track_name = os.path.splitext(original_name)[0] or "Untitled"

        print(f"[process] Done. {len(notes)} notes after filtering, confidence={avg_confidence:.2f}")

        return {
            "status":           "success",
            "track_name":       track_name,
            "instrument":       body.instrument,
            "format":           body.output_format,
            "duration_seconds": round(duration_seconds),
            "notes":            notes,
            "confidence":       round(avg_confidence, 2),
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[process] Error: {e}")
        print(f"[process] Full error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        # 6. Always clean up the temp file
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)
            print(f"[process] Deleted temp file: {tmp_path}")
