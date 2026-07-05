# MusicToSheet — Click-by-Click: Deploy & Test the P0 Conversion Fixes

*Written for Alfie, July 2026. Follow top to bottom. Every command is copy-paste. Nothing here is destructive until Step 5 (the commit), and Step 9 shows you how to undo everything if needed.*

---

## What changed (the 3 files you're shipping)

| File | Change |
|---|---|
| `server/app.py` | Removed the octave clamp (P0-3), removed pre-transcription noise reduction from all 3 pipelines (P0-4), removed the 60s/90s audio truncation caps (P0-4) |
| `server/musicxml_generation.py` | Chord grouping (P0-1), dotted-note rhythm grid (P0-2), clef chosen from real pitch range (P0-3) |
| `server/tests/test_p0_fixes.py` | **New** — automated test that proves the fixes work; run it any time |

Everything was verified passing before handoff, including your existing tests (grand-staff, key signature, pathological short notes — no regressions).

---

## Before you start — what you need

- Your project open in a terminal at `D:\MusicToSheet\MusicToSheet` (this is the folder that contains `server\`, `package.json`, and the `.git` folder)
- Python 3.11 installed (you already use it)
- Git installed and logged in to GitHub (repo: `789shak/MusicToSheet`)
- Your Render dashboard open in a browser: https://dashboard.render.com

---

## Step 1 — Open a terminal in the project folder

1. Press the **Windows key**, type `powershell`, press **Enter**.
2. In the PowerShell window, paste this and press **Enter**:

```powershell
cd D:\MusicToSheet\MusicToSheet
```

Because your project is on the **D: drive** (not C:), the `cd` command switches drives and folders in one step from PowerShell. You should now see `D:\MusicToSheet\MusicToSheet` in your prompt. (If you were ever in an old Command Prompt instead of PowerShell and `cd` didn't switch drives, type `D:` first, then the `cd` line.)

---

## Step 2 — See exactly what changed (review before trusting)

Run this to see the *real* changes, ignoring line-ending noise:

```powershell
git diff --ignore-all-space server/musicxml_generation.py
```

Press the **Spacebar** to page through, press **q** to quit the viewer.
Then the same for the API file:

```powershell
git diff --ignore-all-space server/app.py
```

You should see: chord-grouping code added, `_snap` now lists dotted durations, the octave-clamp `while` loops gone, and the noise-reduction blocks replaced with `# (P0-4) ... REMOVED` comments. That's it.

> **Note on `app.py`:** if you run a *plain* `git diff server/app.py` (without `--ignore-all-space`) it will look like the whole file changed. That's only because the file now has Windows line endings (CRLF). It is harmless — Python and Render run it fine. If you want a clean one-line-per-change diff in history, do the optional normalize in **Step 2b**. Otherwise skip to Step 3.

### Step 2b (optional) — normalize `app.py` line endings to match the repo

Only if you want a tidy diff. Safe to skip.

```powershell
# converts CRLF -> LF for this one file, matching the rest of your repo
(Get-Content server/app.py -Raw) -replace "`r`n","`n" | Set-Content -NoNewline server/app.py
```

Re-run `git diff --stat server/app.py` afterward — it should now show only a handful of changed lines.

---

## Step 3 — Run the tests locally (proves the fixes before you deploy)

The notation tests are lightweight — they don't need the heavy AI libraries, just three small packages.

```powershell
cd server
pip install pretty_midi music21 pytest --quiet
python -m pytest tests/ -q
```

**What you want to see:** a line ending in something like `16 passed`. Your original 11 tests plus the new P0 tests all green.

If you see failures, **stop and don't deploy** — paste the output back to me. (If the only error is `ModuleNotFoundError`, re-run the `pip install` line.)

When done, go back up one folder:

```powershell
cd ..
```

---

## Step 4 — Stage ONLY the three files you changed

⚠️ Your working folder has many other uncommitted files. Do **not** use `git add -A` / `git add .` — that would sweep in unrelated changes. Add exactly these three:

```powershell
git add server/app.py server/musicxml_generation.py server/tests/test_p0_fixes.py
```

Confirm only those three are staged (they'll show in green):

```powershell
git status
```

You should see the three `server/...` files under "Changes to be committed" and nothing else there.

---

## Step 5 — Commit

```powershell
git commit -m "P0 conversion fixes: chord grouping, dotted rhythm, remove octave clamp + pre-denoise + 60s cap"
```

---

## Step 6 — Push to GitHub (this triggers Render automatically)

```powershell
git push origin main
```

If it asks you to sign in to GitHub, do so in the browser window it opens.

---

## Step 7 — Watch Render redeploy and confirm the fixes are live

1. In your browser, open https://dashboard.render.com
2. Click your service **musictosheet-api** (the Python web service).
3. Click the **Events** or **Logs** tab. You'll see a new deploy start automatically (triggered by your push). Wait for it to reach **"Live"** (usually 2–5 minutes).
4. Now do a real conversion (Step 7b) and watch the **Logs** tab. These new log lines confirm each fix is running:

| Log line you'll see | Confirms |
|---|---|
| `[basic_pitch] ... (no octave clamp)` and `Real pitch range: min=... max=...` | P0-3 octave clamp is gone; real pitches flowing |
| `[musicxml] grand-staff built: rh_notes=... lh_notes=...` | Chord grouping path ran (piano) |
| `[musicxml] single-staff built: ... clef=BassClef/TrebleClef` | Clef chosen from pitch range (non-piano) |
| No `Applying noise reduction` line before transcription | P0-4 pre-denoise removed |

### Step 7b — Convert a real file

Open your app (or the web demo at musictosheet.com) and convert:

- **A clean solo piano recording** (30–60s). This is your best-case; the output should now show **real chords** (stacked noteheads on one stem, not scattered voices) and **dotted rhythms**.
- **A bass or low-instrument clip.** The staff should now be in **bass clef** with the notes in their **true low octave** — not crammed into the middle of a treble staff.

---

## Step 8 — What "fixed" looks like vs. before

| Before | After these fixes |
|---|---|
| Piano chords = scattered notes across 3–5 voices, overlapping stems | Chords render as a single stacked chord |
| Every rhythm rounded to plain 8th/quarter/half | Dotted eighths/quarters/halves now appear |
| Bass/low parts crushed into middle octaves, wrong contour | Real octaves preserved, correct clef |
| Songs silently cut to the first 60 seconds | Full length transcribed |

Be realistic: dense multi-instrument mixes will still have errors — that's true for every tool including AnthemScore and Klangio. These fixes make the *easy* cases clean and the *hard* cases much better.

---

## Step 9 — If something goes wrong: rollback (safe, one command)

Because you committed only three files, undoing is clean.

**If you haven't pushed yet** — undo the commit, keep your file changes:
```powershell
git reset --soft HEAD~1
```

**If you already pushed and want to revert the deploy:**
```powershell
git revert HEAD
git push origin main
```
Render will auto-deploy the reverted version. Or, faster: in the Render dashboard → your service → **Deploys** tab → find the previous working deploy → click **"Redeploy"** / **"Rollback to this deploy"**.

---

## Quick reference — the whole thing in order

```powershell
cd D:\MusicToSheet\MusicToSheet
git diff --ignore-all-space server/musicxml_generation.py     # review (q to quit)
cd server
pip install pretty_midi music21 pytest --quiet
python -m pytest tests/ -q                                     # expect "16 passed"
cd ..
git add server/app.py server/musicxml_generation.py server/tests/test_p0_fixes.py
git status                                                     # confirm only 3 files
git commit -m "P0 conversion fixes: chords, dotted rhythm, octave clamp, denoise, 60s cap"
git push origin main                                           # triggers Render
# then watch Render dashboard until "Live", convert a test file
```

---

## After this: the next things worth doing (from the audit)

1. **Results-screen note editor** — the single biggest lever for "worth paying for." Lets users fix the last 10% instead of being stuck with wrong notes.
2. **Security fixes** — the SSRF hole, UUID validation, generic error messages (in the audit report).
3. **Async-by-default + bundle OSMD locally** — reliability for long files and offline rendering.

Say the word and I'll do any of these the same way: real edits, tests, and a click-by-click deploy.
