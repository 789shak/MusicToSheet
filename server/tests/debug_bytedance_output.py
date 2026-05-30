"""
Diagnostic script: examine the raw output from the ByteDance Replicate model.
Prints type(output), str(output), Content-Type header, and first 64 bytes (hex + ascii).
Run from any Python env that has `replicate` and `httpx` installed.
  python tests/debug_bytedance_output.py
"""
import os, asyncio, httpx, replicate

TOKEN = os.environ.get("REPLICATE_API_TOKEN", "")
MODEL = "bytedance/piano-transcription:8978296ce461e1fd8caae879d59063bc8009f57b734c1c8a2c7b19de0016fd35"
# Short royalty-free piano clip used in the main tests
AUDIO_URL = "https://replicate.delivery/mgxm/f1fb0f34-b7ca-45cb-b0a3-4f288f29c6ce/the_entertainer.m4a"

async def main():
    print(f"Token present: {bool(TOKEN)}")
    client = replicate.Client(api_token=TOKEN)

    print("Calling Replicate (synchronously via to_thread)...")
    output = await asyncio.to_thread(
        client.run,
        MODEL,
        input={"audio_input": AUDIO_URL},   # pass URL, not file, for this diagnostic
    )

    print(f"\ntype(output)    : {type(output)}")
    print(f"str(output)[:120]: {str(output)[:120]}")
    if hasattr(output, "url"):
        print(f"output.url      : {output.url}")
    if hasattr(output, "__dict__"):
        print(f"output.__dict__ : {output.__dict__}")

    url = str(output)
    print(f"\nDownloading from: {url[:120]}")
    async with httpx.AsyncClient(follow_redirects=True, timeout=120) as c:
        r = await c.get(url)
        print(f"HTTP status     : {r.status_code}")
        print(f"Content-Type    : {r.headers.get('content-type', 'n/a')}")
        print(f"Content-Length  : {r.headers.get('content-length', 'n/a')}")
        print(f"Body size       : {len(r.content)} bytes")
        first64 = r.content[:64]
        print(f"First 64 bytes hex : {first64.hex()}")
        printable = ''.join(chr(b) if 32 <= b < 127 else '.' for b in first64)
        print(f"First 64 bytes str : {printable}")

asyncio.run(main())
