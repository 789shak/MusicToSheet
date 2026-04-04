import os
import uuid
import traceback
import subprocess
import numpy as np
import httpx
import librosa
import pretty_midi
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Music-To-Sheet API")

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
    wav_path = None
    try:
        # Step 1: Download audio
        print("[process] Step 1: Downloading audio...")
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            response = await client.get(body.audio_url)
            if response.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to download audio (HTTP {response.status_code})",
                )

        original_name = body.audio_url.split("?")[0].split("/")[-1]
        ext = os.path.splitext(original_name)[1].lower() or ".mp3"
        uid = str(uuid.uuid4())
        tmp_path = f"/tmp/{uid}{ext}"
        wav_path = f"/tmp/{uid}.wav"

        with open(tmp_path, "wb") as f:
            f.write(response.content)

        file_size = os.path.getsize(tmp_path)
        print(f"[process] Downloaded file size: {file_size} bytes")
        if file_size < 1000:
            raise Exception(f"Downloaded file too small ({file_size} bytes) — likely failed download")

        print(f"[process] Saved to temp file: {tmp_path}")

        # Step 2: Convert to WAV via ffmpeg
        print("[process] Step 2: Converting to WAV with ffmpeg...")
        result = subprocess.run(
            ['ffmpeg', '-i', tmp_path, '-ar', '22050', '-ac', '1', wav_path, '-y'],
            capture_output=True,
            text=True,
        )
        print(f"[process] ffmpeg stdout: {result.stdout}")
        print(f"[process] ffmpeg stderr: {result.stderr}")
        if result.returncode != 0:
            raise Exception(f"ffmpeg failed with code {result.returncode}: {result.stderr}")
        print(f"[process] Converted to WAV: {wav_path}")

        # Step 3: Load WAV with librosa
        print("[process] Step 3: Loading with librosa...")
        y, sr = librosa.load(wav_path, sr=22050)
        duration_seconds = float(librosa.get_duration(y=y, sr=sr))
        print(f"[process] Loaded audio: duration={duration_seconds:.2f}s, sr={sr}")

        # Step 4: Run pitch detection
        print("[process] Step 4: Running pitch detection...")
        f0, voiced_flag, voiced_probs = librosa.pyin(
            y,
            fmin=librosa.note_to_hz('C2'),
            fmax=librosa.note_to_hz('C7'),
            sr=sr,
        )
        print(f"[process] pyin returned {len(f0)} frames")

        # Step 5: Convert to note names
        print("[process] Step 5: Converting to note names...")
        hop_length = 512
        times = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=hop_length)

        notes = []
        i = 0
        while i < len(f0):
            if voiced_flag[i] and f0[i] is not None and not np.isnan(f0[i]):
                # Find the end of this voiced segment
                j = i
                while j < len(f0) and voiced_flag[j] and not np.isnan(f0[j]):
                    j += 1
                # Average frequency over the segment
                segment_freqs = f0[i:j]
                avg_freq = float(np.nanmean(segment_freqs))
                note_name = librosa.hz_to_note(avg_freq)
                start_time = float(times[i])
                end_time = float(times[j - 1]) + (hop_length / sr)
                duration = round(end_time - start_time, 3)
                if duration > 0.05:  # discard very short blips
                    notes.append({
                        "pitch":    note_name,
                        "start":    round(start_time, 3),
                        "duration": duration,
                        "velocity": 80,
                    })
                i = j
            else:
                i += 1

        track_name = os.path.splitext(original_name)[0] or "Untitled"
        print(f"[process] Done. {len(notes)} notes detected.")

        return {
            "status":           "success",
            "track_name":       track_name,
            "instrument":       body.instrument,
            "format":           body.output_format,
            "duration_seconds": round(duration_seconds),
            "notes":            notes,
            "confidence":       0.75,
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
