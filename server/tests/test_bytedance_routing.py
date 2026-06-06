"""
Phase 1 local routing tests — ByteDance piano-transcription integration.

Requires the FastAPI server running locally:
  cd server && REPLICATE_API_TOKEN=<token> uvicorn app:app --port 8000

Four scenarios:
  T1: POST /process           instrument="Piano"  -> ByteDance,   200, notes>0
  T2: POST /process           instrument="Guitar" -> Basic Pitch, 200, notes>0
  T3: POST /process-with-stems instrument="Piano"  -> Demucs->ByteDance, 200
  T4: POST /process-with-stems instrument="Guitar" -> Demucs->Basic Pitch, 200

Auth:
  Protected routes now require a Supabase access token. Export one before running:
    export SUPABASE_ACCESS_TOKEN=<a valid Supabase JWT>
  (Obtain it client-side, e.g. supabase.auth.signInAnonymously().)

Usage:
  python tests/test_bytedance_routing.py
  python tests/test_bytedance_routing.py --url http://localhost:8000
"""

import argparse
import os
import sys
import json
import time
import base64

import requests

# ── Config ────────────────────────────────────────────────────────────────────
DEFAULT_SERVER = "http://localhost:8000"
ACCESS_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")

# A short piano clip accessible at a public URL.
# We use a royalty-free MIDI-piano sample from Replicate's own test assets.
PIANO_AUDIO_URL = (
    "https://replicate.delivery/mgxm/f1fb0f34-b7ca-45cb-b0a3-4f288f29c6ce/the_entertainer.m4a"
)
GUITAR_AUDIO_URL = (
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
)

# Timeout per request — piano specialist model can take 6-10 minutes on first run.
REQUEST_TIMEOUT_S = 720


# ── Helpers ───────────────────────────────────────────────────────────────────
def make_headers():
    h = {"Content-Type": "application/json"}
    if ACCESS_TOKEN:
        h["Authorization"] = f"Bearer {ACCESS_TOKEN}"
    return h


def print_result(label: str, r: requests.Response, t: float) -> bool:
    print(f"\n{'='*60}")
    print(f"{label}")
    print(f"  Status:      {r.status_code}  ({t:.1f}s)")
    try:
        body = r.json()
    except Exception:
        print(f"  Body (raw):  {r.text[:200]}")
        return False

    notes = body.get("notes") or []
    musicxml = body.get("musicxml") or ""
    print(f"  notes count: {len(notes)}")
    print(f"  notes[:3]:   {json.dumps(notes[:3], indent=4)}")
    print(f"  musicxml:    {'non-empty string (' + str(len(musicxml)) + ' chars)' if musicxml else 'None/empty'}")
    if "stems_detected" in body:
        print(f"  stems_detected: {body['stems_detected']}")
        print(f"  stem_used:      {body.get('stem_used')}")
    if r.status_code != 200:
        print(f"  error detail: {body.get('detail') or body.get('error')}")
        return False
    if len(notes) == 0:
        print("  WARNING: 0 notes returned")
    return r.status_code == 200


# ── Tests ─────────────────────────────────────────────────────────────────────
def run_tests(server: str):
    results = {}

    # ── T1: /process — Piano -> ByteDance ─────────────────────────────────────
    print("\n[T1] POST /process  instrument=Piano  (expect ByteDance, 200, notes>0)")
    t0 = time.time()
    try:
        r = requests.post(
            f"{server}/process",
            headers=make_headers(),
            json={"audio_url": PIANO_AUDIO_URL, "instrument": "Piano", "output_format": "musicxml"},
            timeout=REQUEST_TIMEOUT_S,
        )
        results["T1"] = print_result("T1 /process Piano -> ByteDance", r, time.time() - t0)
    except Exception as e:
        print(f"  EXCEPTION: {e}")
        results["T1"] = False

    # ── T2: /process — Guitar -> Basic Pitch ──────────────────────────────────
    print("\n[T2] POST /process  instrument=Guitar  (expect Basic Pitch, 200, notes>0)")
    t0 = time.time()
    try:
        r = requests.post(
            f"{server}/process",
            headers=make_headers(),
            json={"audio_url": GUITAR_AUDIO_URL, "instrument": "Guitar", "output_format": "musicxml"},
            timeout=REQUEST_TIMEOUT_S,
        )
        results["T2"] = print_result("T2 /process Guitar -> Basic Pitch", r, time.time() - t0)
    except Exception as e:
        print(f"  EXCEPTION: {e}")
        results["T2"] = False

    # ── T3: /process-with-stems — Piano -> Demucs -> ByteDance ─────────────────
    print("\n[T3] POST /process-with-stems  instrument=Piano  (expect Demucs->ByteDance, 200)")
    t0 = time.time()
    try:
        r = requests.post(
            f"{server}/process-with-stems",
            headers=make_headers(),
            json={"audio_url": PIANO_AUDIO_URL, "instrument": "Piano", "output_format": "musicxml"},
            timeout=REQUEST_TIMEOUT_S,
        )
        results["T3"] = print_result("T3 /process-with-stems Piano -> ByteDance", r, time.time() - t0)
    except Exception as e:
        print(f"  EXCEPTION: {e}")
        results["T3"] = False

    # ── T4: /process-with-stems — Guitar -> Demucs -> Basic Pitch ──────────────
    print("\n[T4] POST /process-with-stems  instrument=Guitar  (expect Demucs->Basic Pitch, 200)")
    t0 = time.time()
    try:
        r = requests.post(
            f"{server}/process-with-stems",
            headers=make_headers(),
            json={"audio_url": GUITAR_AUDIO_URL, "instrument": "Guitar", "output_format": "musicxml"},
            timeout=REQUEST_TIMEOUT_S,
        )
        results["T4"] = print_result("T4 /process-with-stems Guitar -> Basic Pitch", r, time.time() - t0)
    except Exception as e:
        print(f"  EXCEPTION: {e}")
        results["T4"] = False

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("SUMMARY")
    for k, v in results.items():
        status = "PASS" if v else "FAIL"
        print(f"  {k}: {status}")
    passed = sum(1 for v in results.values() if v)
    print(f"\n{passed}/{len(results)} tests passed")
    return all(results.values())


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_SERVER, help="Server base URL")
    args = parser.parse_args()

    print(f"Testing against: {args.url}")
    ok = run_tests(args.url)
    sys.exit(0 if ok else 1)
