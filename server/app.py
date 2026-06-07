import os
import uuid
import asyncio
import traceback
import subprocess
import gc
import time
import base64 as _base64
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import httpx
import librosa
import soundfile as sf
import noisereduce as nr
import pretty_midi
import replicate
from basic_pitch.inference import predict

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request, Depends, BackgroundTasks
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError

from supabase import create_client as _create_supabase_client

# ─── App + Rate Limiter ───────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Music-To-Sheet API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ─── Startup config diagnostics ──────────────────────────────────────────────
# TODO: remove verbose detail before production
@app.on_event("startup")
async def _log_config_status() -> None:
    url_set     = bool(os.environ.get("SUPABASE_URL", "").strip())
    svc_key     = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    svc_key_len = len(svc_key)
    print(
        f"CONFIG: SUPABASE_URL set: {url_set} | "
        f"SERVICE_ROLE_KEY set: {bool(svc_key)}, length {svc_key_len}"
    )

# ─── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://musictosheet.com",
        "https://www.musictosheet.com",
        "http://localhost:3000",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

# ─── Security Headers ─────────────────────────────────────────────────────────
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response

# ─── Supabase JWT Auth ────────────────────────────────────────────────────────
# Every protected route requires a valid Supabase access token in the
# Authorization: Bearer <jwt> header. Tokens are signed with ES256 and verified
# against the project's JWKS (public keys cached 10 minutes). Anonymous sign-ins
# are first-class — guests get an anonymous Supabase session and a real JWT.
#
# FAILS CLOSED: a missing/invalid/expired token → 401. A misconfigured server
# (no SUPABASE_URL) or an unreachable JWKS endpoint → 503. The request is never
# allowed through without a verified token.
SUPABASE_URL          = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_JWT_AUD      = os.environ.get("SUPABASE_JWT_AUD", "authenticated")
SUPABASE_SERVICE_KEY  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

_jwks_client: Optional[PyJWKClient] = None

def _get_jwks_client() -> PyJWKClient:
    """Lazily build a PyJWKClient that caches the JWK set for 10 minutes."""
    global _jwks_client
    if _jwks_client is None:
        jwks_url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True, lifespan=600)
    return _jwks_client

# ─── Supabase Admin Client (service role — bypasses RLS) ─────────────────────
_supabase_admin = None

def _get_supabase_admin():
    """Lazily create a Supabase admin client using the service role key."""
    global _supabase_admin
    if _supabase_admin is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured")
        # TODO: remove verbose detail before production
        try:
            _supabase_admin = _create_supabase_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        except Exception as ex:
            print(
                f"[supabase-admin] create_client failed: "
                f"{type(ex).__name__}: {ex}\n{traceback.format_exc()}"
            )
            raise
    return _supabase_admin

async def _update_job(job_id: str, **fields) -> None:
    """UPDATE public.jobs SET ... WHERE id = job_id. Swallows errors (non-fatal)."""
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        await asyncio.to_thread(
            lambda: _get_supabase_admin().table("jobs").update(fields).eq("id", job_id).execute()
        )
    except Exception as ex:
        # TODO: remove verbose detail before production
        print(
            f"[jobs] DB update failed (non-fatal) for job {job_id}: "
            f"{type(ex).__name__}: {ex}\n{traceback.format_exc()}"
        )


def verify_supabase_jwt(request: Request) -> dict:
    """FastAPI dependency: verify the Supabase access token. Fails closed."""
    if not SUPABASE_URL:
        # Server misconfiguration — never silently skip auth.
        raise HTTPException(status_code=503, detail="Authentication not configured")

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth_header[len("Bearer "):].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    # Fetch the signing key from the JWKS. A connection failure must fail closed
    # as 503 (service issue), never as success.
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
    except PyJWKClientConnectionError:
        raise HTTPException(status_code=503, detail="Auth key service unavailable")
    except Exception:
        # Malformed token header / unknown key id → treat as invalid token.
        raise HTTPException(status_code=401, detail="Invalid token")

    # Verify signature, expiry, and audience.
    try:
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256"],
            audience=SUPABASE_JWT_AUD,
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    request.state.user_id     = claims.get("sub")
    request.state.is_anonymous = bool(claims.get("is_anonymous", False))
    request.state.claims      = claims
    return claims

def rate_limit_key(request: Request) -> str:
    """Rate-limit protected routes by authenticated user id, falling back to IP."""
    user_id = getattr(request.state, "user_id", None)
    if user_id:
        return f"user:{user_id}"
    return get_remote_address(request)

# ─── Limits ───────────────────────────────────────────────────────────────────
MAX_FILE_SIZE_BYTES  = 50 * 1024 * 1024   # 50 MB
MAX_AUDIO_DURATION_S = 1800               # 30 minutes hard cap (all tiers)

# ─── Abuse Detection (in-memory; resets on restart) ───────────────────────────
_ip_weekly_log: dict  = defaultdict(list)   # ip  → [timestamps]
_track_attempts: dict = defaultdict(int)    # (ip, url_prefix) → count

def _check_abuse(ip: str, track_key: str = "") -> None:
    now      = time.time()
    week_ago = now - 7 * 24 * 3600
    _ip_weekly_log[ip] = [t for t in _ip_weekly_log[ip] if t > week_ago]
    if len(_ip_weekly_log[ip]) >= 100:
        raise HTTPException(status_code=429, detail="Weekly conversion limit exceeded")
    if track_key:
        k = (ip, track_key[:80])
        _track_attempts[k] += 1
        if _track_attempts[k] > 10:
            raise HTTPException(status_code=429, detail="Per-track attempt limit exceeded")
    _ip_weekly_log[ip].append(now)

# ─── Input Validation Helpers ─────────────────────────────────────────────────
def _validate_url(url: Optional[str]) -> None:
    if not url:
        return
    low = url.lower()
    if low.startswith(("http://", "https://")):
        return
    if low.startswith("file:///tmp/"):
        return  # Safe: server-local temp files only
    raise HTTPException(status_code=400, detail="audio_url must be http://, https://, or a server temp file:// path")

def _validate_file_size(path: str, label: str = "File") -> None:
    size = os.path.getsize(path)
    if size > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail=f"{label} exceeds 50 MB limit ({size // (1024*1024)} MB)")

def _validate_duration(wav_path: str) -> float:
    y, sr = librosa.load(wav_path, sr=None, mono=True, duration=MAX_AUDIO_DURATION_S + 10)
    dur = float(librosa.get_duration(y=y, sr=sr))
    del y
    gc.collect()
    if dur > MAX_AUDIO_DURATION_S:
        raise HTTPException(status_code=400, detail=f"Audio exceeds 30-minute limit ({dur/60:.1f} min)")
    return dur

# ─── Schema ───────────────────────────────────────────────────────────────────
class ProcessRequest(BaseModel):
    audio_url: Optional[str] = None
    temp_file_id: Optional[str] = None
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


# ─── ByteDance Piano Transcription ───────────────────────────────────────────
def _midi_data_to_notes(midi_data: pretty_midi.PrettyMIDI) -> list:
    """Extract notes from a PrettyMIDI object in the standard response dict shape."""
    notes = []
    for instrument in midi_data.instruments:
        for note in instrument.notes:
            notes.append({
                "pitch":      pretty_midi.note_number_to_name(note.pitch),
                "start":      round(note.start, 3),
                "duration":   round(note.end - note.start, 3),
                "velocity":   round(note.velocity / 127.0, 2),
                "confidence": 0.9,
            })
    notes.sort(key=lambda n: n["start"])
    return notes


async def detect_notes_with_piano_specialist(wav_path: str) -> pretty_midi.PrettyMIDI:
    """
    Send WAV to e7mac/piano_transcription on Replicate, download the
    returned MIDI from output["midi"], and return a PrettyMIDI object so
    the downstream generate_musicxml() pipeline is unchanged.
    """
    replicate_token = os.environ.get("REPLICATE_API_TOKEN")
    if not replicate_token:
        raise RuntimeError("REPLICATE_API_TOKEN environment variable not set")

    # Default SDK read/write timeout is 30 s — far too short for a model that
    # takes several minutes. Set a generous 10-minute window on all operations.
    repl_client = replicate.Client(
        api_token=replicate_token,
        timeout=httpx.Timeout(connect=10.0, read=600.0, write=600.0, pool=10.0),
    )
    print("[piano_specialist] Uploading WAV to Replicate piano_transcription...")
    with open(wav_path, "rb") as audio_file:
        output = await asyncio.to_thread(
            repl_client.run,
            "e7mac/piano_transcription:cef04ff2582f0c074d828f8947e855fed0aabb2c8bc1caccccd481eb0fb8c933",
            input={"audio_input": audio_file, "make_video": False},
            # wait=False skips the 60-second Prefer:wait long-poll (which has a hard
            # 60.5 s read timeout baked into the SDK) and goes straight to polling.
            # Each poll GET uses the client's 600 s read timeout instead.
            wait=False,
        )

    midi_url = str(output["midi"])
    print(f"[piano_specialist] Received MIDI URL: {midi_url[:80]}...")

    midi_path = f"/tmp/{uuid.uuid4()}_piano_specialist.mid"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as dl_client:
            resp = await dl_client.get(midi_url)
            resp.raise_for_status()
            with open(midi_path, "wb") as f:
                f.write(resp.content)
        print(f"[piano_specialist] Downloaded {len(resp.content)} bytes of MIDI")
        midi_data = pretty_midi.PrettyMIDI(midi_path)
        note_count = sum(len(i.notes) for i in midi_data.instruments)
        print(f"[piano_specialist] PrettyMIDI loaded: {len(midi_data.instruments)} instruments, {note_count} notes")
        return midi_data
    finally:
        if os.path.exists(midi_path):
            os.remove(midi_path)
            print(f"[piano_specialist] Cleaned up temp MIDI: {midi_path}")


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
        try:
            new_score.write('musicxml', fp=musicxml_path)
            with open(musicxml_path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
        except Exception as e:
            print(f"[musicxml] MusicXML write/read error: {e}")
            content = ""

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


# ─── /upload-temp (guest file upload) ────────────────────────────────────────
@app.post("/upload-temp")
@limiter.limit("20/hour", key_func=rate_limit_key)
async def upload_temp(request: Request, file: UploadFile = File(...), claims=Depends(verify_supabase_jwt)):
    """Accept a multipart audio upload, save to /tmp, return a temp_file_id."""
    ext = os.path.splitext(file.filename or 'audio.mp3')[1].lower() or '.mp3'
    temp_id = str(uuid.uuid4())
    tmp_path = f"/tmp/{temp_id}{ext}"
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 50 MB limit")
    with open(tmp_path, 'wb') as f:
        f.write(contents)
    print(f"[upload-temp] Saved {len(contents)} bytes → {tmp_path}")
    return {
        "status": "success",
        "temp_file_id": temp_id,
        "ext": ext,
        "audio_url": f"file://{tmp_path}",
        "original_name": file.filename or f"audio{ext}",
    }


@app.post("/process")
@limiter.limit("30/hour", key_func=rate_limit_key)
async def process_audio(request: Request, body: ProcessRequest, claims=Depends(verify_supabase_jwt)):
    tmp_path = None
    wav_path = None
    ip = get_remote_address(request)
    try:
        # ── Input validation ──────────────────────────────────────────────────
        _validate_url(body.audio_url)
        body.instrument   = (body.instrument   or "")[:64].strip()
        body.output_format = (body.output_format or "")[:32].strip()

        # Step 1: Resolve audio source — URL download OR pre-uploaded temp file
        uid = str(uuid.uuid4())
        wav_path = f"/tmp/{uid}.wav"

        original_name = "audio"
        if body.temp_file_id:
            # Guest path: file already on disk from /upload-temp
            print(f"[process] [{ip}] Using temp file: {body.temp_file_id}")
            import glob as _glob
            matches = _glob.glob(f"/tmp/{body.temp_file_id}.*")
            if not matches:
                raise Exception(f"Temp file not found: {body.temp_file_id}")
            tmp_path = matches[0]
            _validate_file_size(tmp_path, "Uploaded file")
            print(f"[process] [{ip}] Found temp file: {tmp_path}")
            _check_abuse(ip, body.temp_file_id)
        elif body.audio_url and body.audio_url.lower().startswith("file:///tmp/"):
            # Web demo path: /upload-temp returned a file:// URL
            local_path = body.audio_url[7:]  # strip "file://"
            if not os.path.exists(local_path):
                raise Exception(f"Temp file not found: {local_path}")
            tmp_path = local_path
            original_name = os.path.basename(local_path)
            _validate_file_size(tmp_path, "Uploaded file")
            print(f"[process] [{ip}] Using local file:// path: {tmp_path}")
            _check_abuse(ip, local_path)
        elif body.audio_url:
            print(f"[process] [{ip}] Downloading from URL: {body.audio_url[:100]}...")
            original_name = body.audio_url.split("?")[0].split("/")[-1]
            ext = os.path.splitext(original_name)[1].lower() or ".mp3"
            tmp_path = f"/tmp/{uid}{ext}"
            file_size = await download_audio(body.audio_url, tmp_path)
            print(f"[process] [{ip}] Downloaded file size: {file_size} bytes")
            if file_size < 1000:
                raise Exception(f"Downloaded file too small ({file_size} bytes) — likely failed download")
            _validate_file_size(tmp_path, "Downloaded file")
            _check_abuse(ip, body.audio_url[:80])
            print(f"[process] [{ip}] Saved to temp file: {tmp_path}")
        else:
            raise HTTPException(status_code=400, detail="Provide either audio_url or temp_file_id")

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

        # Step 3: Load WAV with librosa for duration (also enforces 30-min hard cap)
        print("[process] Step 3: Loading WAV with librosa...")
        duration_seconds = _validate_duration(wav_path)
        y, sr = librosa.load(wav_path, sr=22050, mono=True, duration=60.0)
        duration_seconds = float(librosa.get_duration(y=y, sr=sr))
        print(f"[process] [{ip}] Audio duration: {duration_seconds:.2f}s")
        del y
        gc.collect()

        # Step 4: Transcription — piano specialist for piano, Basic Pitch for everything else
        if body.instrument.strip().lower() == "piano":
            print("[process] Step 4: Piano detected — routing to piano specialist transcription...")
            try:
                midi_data = await detect_notes_with_piano_specialist(wav_path)
            except Exception as bd_err:
                print(f"[process] Piano specialist failed: {bd_err}")
                raise HTTPException(
                    status_code=503,
                    detail="Transcription service temporarily unavailable. Please try again.",
                )
            notes = _midi_data_to_notes(midi_data)
        else:
            print("[process] Step 4: Running Basic Pitch inference...")
            notes, midi_data = await asyncio.to_thread(detect_notes_with_basic_pitch, wav_path)
        print(f"[process] Transcription detected {len(notes)} notes")

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
@limiter.limit("30/hour", key_func=rate_limit_key)
async def process_with_stems(request: Request, body: ProcessRequest, claims=Depends(verify_supabase_jwt)):
    tmp_path = None
    wav_path = None
    stem_path = None
    stem_wav_path = None
    ip = get_remote_address(request)
    try:
        if not body.audio_url:
            raise HTTPException(status_code=400, detail="process-with-stems requires audio_url")
        _validate_url(body.audio_url)
        body.instrument    = (body.instrument   or "")[:64].strip()
        body.output_format = (body.output_format or "")[:32].strip()
        _check_abuse(ip, body.audio_url[:80])

        # Step 1: Download original audio
        print(f"[stems] [{ip}] Step 1: Downloading audio...")
        original_name = body.audio_url.split("?")[0].split("/")[-1] or "audio"
        ext = os.path.splitext(original_name)[1].lower() or ".mp3"
        uid = str(uuid.uuid4())
        tmp_path = f"/tmp/{uid}{ext}"

        file_size = await download_audio(body.audio_url, tmp_path)
        print(f"[stems] [{ip}] Downloaded {file_size} bytes to {tmp_path}")
        if file_size < 1000:
            raise Exception(f"Downloaded file too small ({file_size} bytes)")
        _validate_file_size(tmp_path, "Downloaded file")

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
        # TODO: Remove 90-second cap when async processing is implemented
        wav_path = f"/tmp/{uid}_out.wav"
        print("[stems] Step 6: Converting to WAV with ffmpeg...")
        result = subprocess.run(
            ['ffmpeg', '-i', audio_for_detection, '-t', '90', '-ar', '22050', '-ac', '1', '-sample_fmt', 's16', wav_path, '-y'],
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

        # Step 8: Transcription — piano specialist for piano, Basic Pitch for everything else
        if body.instrument.strip().lower() == "piano":
            print("[stems] Step 8: Piano detected — routing to piano specialist transcription...")
            try:
                midi_data = await detect_notes_with_piano_specialist(wav_path)
            except Exception as bd_err:
                print(f"[stems] Piano specialist failed: {bd_err}")
                raise HTTPException(
                    status_code=503,
                    detail="Transcription service temporarily unavailable. Please try again.",
                )
            notes = _midi_data_to_notes(midi_data)
        else:
            print("[stems] Step 8: Running Basic Pitch inference...")
            notes, midi_data = await asyncio.to_thread(detect_notes_with_basic_pitch, wav_path)
        print(f"[stems] Transcription detected {len(notes)} notes")

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


# ─── Async job: background pipeline ─────────────────────────────────────────
async def _run_stems_pipeline(job_id: str, body: ProcessRequest) -> None:
    """
    Runs the full stems + transcription pipeline as a FastAPI BackgroundTask.
    Writes stage/progress updates to public.jobs throughout, then writes
    result_data on success or error_detail on failure.
    """
    tmp_path = None
    wav_path = None
    stem_path = None

    try:
        # ── Mark as processing ────────────────────────────────────────────────
        await _update_job(
            job_id,
            status="processing",
            started_at=datetime.now(timezone.utc).isoformat(),
            stage="downloading",
            progress_pct=10,
        )

        # ── Step 1: Download original audio ──────────────────────────────────
        print(f"[process-async] [{job_id}] Step 1: Downloading audio…")
        original_name = (body.audio_url or "audio").split("?")[0].split("/")[-1] or "audio"
        ext = os.path.splitext(original_name)[1].lower() or ".mp3"
        uid = str(uuid.uuid4())
        tmp_path = f"/tmp/{uid}{ext}"

        file_size = await download_audio(body.audio_url, tmp_path)
        print(f"[process-async] [{job_id}] Downloaded {file_size} bytes → {tmp_path}")
        if file_size < 1000:
            raise Exception(f"Downloaded file too small ({file_size} bytes)")
        _validate_file_size(tmp_path, "Downloaded file")

        # ── Step 2: Demucs stem separation ───────────────────────────────────
        await _update_job(job_id, stage="separating_stems", progress_pct=30)
        print(f"[process-async] [{job_id}] Step 2: Running Demucs via Replicate…")

        replicate_token = os.environ.get("REPLICATE_API_TOKEN")
        if not replicate_token:
            raise Exception("REPLICATE_API_TOKEN not set")

        repl_client = replicate.Client(api_token=replicate_token)
        output = await asyncio.to_thread(
            repl_client.run,
            "cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953",
            input={"audio": body.audio_url},
        )
        print(f"[process-async] [{job_id}] Demucs output type: {type(output)}, value: {output}")

        # Parse stem URLs from Demucs output
        detected_stems = []
        stem_urls = {}
        if isinstance(output, dict):
            for stem_name in ("vocals", "drums", "bass", "other"):
                if output.get(stem_name):
                    detected_stems.append(stem_name)
                    stem_urls[stem_name] = str(output[stem_name])
        else:
            stem_order = ["drums", "bass", "other", "vocals"]
            for idx, url in enumerate(output or []):
                if idx < len(stem_order) and url:
                    name = stem_order[idx]
                    detected_stems.append(name)
                    stem_urls[name] = str(url)
        print(f"[process-async] [{job_id}] Detected stems: {detected_stems}")

        # ── Step 3: Pick stem + convert to WAV ───────────────────────────────
        selected_stem = INSTRUMENT_TO_STEM.get(body.instrument)
        print(f"[process-async] [{job_id}] Instrument '{body.instrument}' → stem '{selected_stem}'")

        if selected_stem is None or selected_stem not in stem_urls:
            audio_for_detection = tmp_path
        else:
            stem_path = f"/tmp/{uid}_stem.wav"
            print(f"[process-async] [{job_id}] Downloading stem '{selected_stem}'…")
            stem_size = await download_audio(stem_urls[selected_stem], stem_path)
            print(f"[process-async] [{job_id}] Stem: {stem_size} bytes")
            audio_for_detection = stem_path

        wav_path = f"/tmp/{uid}_out.wav"
        print(f"[process-async] [{job_id}] Converting to WAV…")
        conv = subprocess.run(
            ['ffmpeg', '-i', audio_for_detection, '-ar', '22050', '-ac', '1', '-sample_fmt', 's16', wav_path, '-y'],
            capture_output=True, text=True,
        )
        if conv.returncode != 0:
            raise Exception(f"ffmpeg failed: {conv.stderr}")

        # Noise reduction
        _nr_y, _nr_sr = sf.read(wav_path)
        _nr_reduced = nr.reduce_noise(
            y=_nr_y, sr=_nr_sr,
            prop_decrease=0.6, stationary=False, n_fft=2048, freq_mask_smooth_hz=500,
        )
        sf.write(wav_path, _nr_reduced, _nr_sr)
        del _nr_y, _nr_reduced
        gc.collect()

        # Duration
        _y, _sr = librosa.load(wav_path, sr=22050, mono=True)
        duration_seconds = float(librosa.get_duration(y=_y, sr=_sr))
        del _y
        gc.collect()

        # ── Step 4: Transcription ─────────────────────────────────────────────
        await _update_job(job_id, stage="transcribing", progress_pct=60)
        print(f"[process-async] [{job_id}] Step 4: Transcription…")

        if body.instrument.strip().lower() == "piano":
            print(f"[process-async] [{job_id}] Routing to piano specialist…")
            midi_data = await detect_notes_with_piano_specialist(wav_path)
            notes = _midi_data_to_notes(midi_data)
        else:
            notes, midi_data = await asyncio.to_thread(detect_notes_with_basic_pitch, wav_path)
        print(f"[process-async] [{job_id}] Transcription: {len(notes)} notes")

        # ── Step 5: MusicXML generation ───────────────────────────────────────
        await _update_job(job_id, stage="generating_xml", progress_pct=85)
        track_name = os.path.splitext(original_name)[0] or "Untitled"
        print(f"[process-async] [{job_id}] Step 5: MusicXML generation…")
        musicxml, transposed_notes = await asyncio.to_thread(
            generate_musicxml, midi_data, track_name, body.instrument, 120
        )
        if musicxml:
            print(f"[process-async] [{job_id}] MusicXML ready ({len(musicxml):,} chars)")
        gc.collect()

        # ── Done: write result ────────────────────────────────────────────────
        result_payload = {
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
        await _update_job(
            job_id,
            status="done",
            stage="complete",
            progress_pct=100,
            result_data=result_payload,
            completed_at=datetime.now(timezone.utc).isoformat(),
        )
        print(f"[process-async] [{job_id}] Job completed successfully")

    except Exception as e:
        print(f"[process-async] [{job_id}] Job failed: {e}\n{traceback.format_exc()}")
        await _update_job(
            job_id,
            status="error",
            error_detail=str(e)[:2000],
            completed_at=datetime.now(timezone.utc).isoformat(),
        )
    finally:
        for f in [tmp_path, wav_path, stem_path]:
            if f and os.path.exists(f):
                try:
                    os.remove(f)
                    print(f"[process-async] [{job_id}] Deleted temp file: {f}")
                except Exception:
                    pass


# ─── POST /process-async ──────────────────────────────────────────────────────
@app.post("/process-async", status_code=202)
@limiter.limit("30/hour", key_func=rate_limit_key)
async def process_async_endpoint(
    request: Request,
    body: ProcessRequest,
    background_tasks: BackgroundTasks,
    claims=Depends(verify_supabase_jwt),
):
    """
    Accept a stems-processing job, persist it to public.jobs, launch it as a
    BackgroundTask, and immediately return {job_id} (HTTP 202 Accepted).
    Clients poll GET /jobs/{job_id} to check progress.
    """
    if not body.audio_url:
        raise HTTPException(status_code=400, detail="process-async requires audio_url")
    _validate_url(body.audio_url)

    # TODO: remove verbose detail before production
    if not SUPABASE_URL:
        raise HTTPException(
            status_code=503,
            detail="Job tracking not configured: SUPABASE_URL is empty",
        )
    if not SUPABASE_SERVICE_KEY:
        raise HTTPException(
            status_code=503,
            detail="Job tracking not configured: SUPABASE_SERVICE_ROLE_KEY is empty",
        )

    body.instrument    = (body.instrument    or "")[:64].strip()
    body.output_format = (body.output_format or "")[:32].strip()

    ip = get_remote_address(request)
    _check_abuse(ip, body.audio_url[:80])

    user_id = request.state.user_id

    # TODO: remove verbose detail before production
    # Build the admin client first so init failures get their own diagnostic frame.
    try:
        admin = await asyncio.to_thread(_get_supabase_admin)
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[process-async] supabase admin init failed: {type(e).__name__}: {e}\n{tb}")
        raise HTTPException(
            status_code=503,
            detail=f"admin_init {type(e).__name__}: {str(e)[:120]}",
        )

    # INSERT the job row; service role bypasses RLS
    try:
        resp = await asyncio.to_thread(
            lambda: admin.table("jobs").insert({
                "user_id":      user_id,
                "endpoint":     "/process-async",
                "audio_url":    body.audio_url,
                "instrument":   body.instrument,
                "output_format": body.output_format,
                "status":       "queued",
                "progress_pct": 0,
            }).execute()
        )
        job_id = resp.data[0]["id"]
    except Exception as e:
        # TODO: remove verbose detail before production
        tb = traceback.format_exc()
        # supabase-py APIError carries structured fields; pull them out if present
        code    = getattr(e, "code", None)    or getattr(e, "pgcode",   None)
        message = getattr(e, "message", None) or getattr(e, "pgmessage", None)
        details = getattr(e, "details", None) or getattr(e, "pgdetails", None)
        hint    = getattr(e, "hint", None)    or getattr(e, "pghint",    None)
        print(
            f"[process-async] Failed to insert job row: {type(e).__name__}: {e}\n"
            f"  code={code!r} message={message!r} details={details!r} hint={hint!r}\n{tb}"
        )
        raise HTTPException(
            status_code=503,
            detail=(
                f"jobs_insert {type(e).__name__} code={code} "
                f"message={(message or '')[:150]} hint={(hint or '')[:150]}"
            ),
        )

    background_tasks.add_task(_run_stems_pipeline, job_id, body)
    print(f"[process-async] Job {job_id} queued for user {user_id}")
    return {"job_id": job_id}


# ─── GET /jobs/{job_id} ───────────────────────────────────────────────────────
@app.get("/jobs/{job_id}")
async def get_job(job_id: str, request: Request, claims=Depends(verify_supabase_jwt)):
    """
    Return the current status + result of a job.
    The requesting user must own the job (user_id match); otherwise 403.
    """
    if not SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=503, detail="Job tracking not configured on this server")

    try:
        resp = await asyncio.to_thread(
            lambda: _get_supabase_admin().table("jobs").select("*").eq("id", job_id).execute()
        )
    except Exception as e:
        print(f"[jobs] DB read failed for job {job_id}: {e}")
        raise HTTPException(status_code=404, detail="Job not found")

    if not resp.data:
        raise HTTPException(status_code=404, detail="Job not found")

    job = resp.data[0]

    # Ownership check: job must belong to the authenticated user
    if job.get("user_id") != request.state.user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return {
        "job_id":       job["id"],
        "status":       job["status"],
        "stage":        job.get("stage"),
        "progress_pct": job.get("progress_pct", 0),
        "result":       job.get("result_data"),       # full result dict when status='done'
        "error_detail": job.get("error_detail"),      # error string when status='error'
    }


# ─── Clean Audio Endpoint ─────────────────────────────────────────────────────
@app.post("/clean-audio")
@limiter.limit("10/hour", key_func=rate_limit_key)
async def clean_audio(request: Request, claims=Depends(verify_supabase_jwt)):
    try:
        data = await request.json()
        audio_url = data.get("audio_url")
        if not audio_url:
            return JSONResponse({"error": "No audio_url provided"}, status_code=400)
        if not str(audio_url).lower().startswith(("http://", "https://")):
            return JSONResponse({"error": "Invalid audio_url"}, status_code=400)

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
