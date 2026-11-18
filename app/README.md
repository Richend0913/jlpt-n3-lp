# N3 Tango — Web app (v1 MVP)

Open `app/index.html` directly (file:// works; no server, no CDN, fully offline).
Plain HTML/CSS/JS, relative paths only — ready to be used as the Capacitor `webDir`.

## Files
| Path | Role |
|---|---|
| `index.html` | Shell: `#view` + bottom nav, loads scripts in order |
| `css/app.css` | Styles. Home rules copied verbatim from `comps/b.html` |
| `data/words.js` | **Generated** word bundle (`window.N3_WORDS`, `window.N3_WORDS_META`) |
| `data/sample/words-sample.json` | SAMPLE fallback (20 words, 5/unit) — not production data |
| `js/util.js` | Dates (local `YYYY-MM-DD`), escaping, shuffle, hash |
| `js/store.js` | localStorage state (`n3tango.state.v1`): settings, SRS, per-day log, streak, stats |
| `js/words.js` | Word access, units, free/locked units, word of the day, example highlighting |
| `js/srs.js` | Simplified SM-2 (Know = q4, Don't know = q1) |
| `js/quiz.js` | 4-choice question generation (meaning / reading / fill-in), quiz + mock builders |
| `js/app.js` | Hash router and all screens |
| `audio/word/<id>.mp3`, `audio/example/<id>.mp3` | **Generated** VOICEVOX audio (reading / example), mp3 mono 32 kbps |

## Word data
`node tools/build-data.js` bundles `data/words-*.json` (schema: `data/schema.md`) into `app/data/words.js`.
Re-run it whenever the data files change. If no `data/words-*.json` exists it bundles the sample
(`N3_FORCE_SAMPLE=1` forces the sample for testing).

## Audio
`python3 tools/gen-audio.py` generates `app/audio/{word,example}/<id>.mp3` from `app/data/words.js` via a local
VOICEVOX engine (port 50021, speaker 8 = 春日部つむぎ ノーマル). Resumable: existing files are skipped; failures go to
`tools/gen-audio-failures.log`. The Learn card shows play buttons after reveal (word + example); playback uses
relative `new Audio('audio/...')` so file:// works, and a missing file is ignored silently.
Voice credit (VOICEVOX terms): 「VOICEVOX:春日部つむぎ」 must be shown in the app/store listing when shipped.

## Rules implemented
- Free: units 1–2 (`N3.FREE_UNITS`). Units 3+ open the paywall ($12.99/mo, $59.99/yr; button is a "Coming soon" placeholder, no purchase code).
- SRS: correct → 1 d, 3 d, then interval × ease; wrong → due today, ease down. "Don't know" cards are re-shown up to 2× in the session. Mastered = 3 successful reviews in a row.
- Quiz / mock wrong answers → word due today (back to review).
- Streak: +1 per calendar day with at least one graded card or answer; shows 0 after a missed day.
- Exam date: 2026-12-06 / 2027-07-04; a past date falls forward to the next one.

## Verification
`node tools/verify.js` — headless Chromium, clock fixed to 2026-11-17 09:00 JST. Drives every screen from
file:// (58 checks) and pixel-diffs Home (fixture data) against `comps/comp-b.png`. Screenshots: `tools/verify-out/`.
`node tools/verify-audio.js` — checks all 1,000×2 audio files exist (+ format sample) and drives the Learn card play buttons from file://.
