# Ear Trainer — Implementation Plan

A single-file web app for pitch-identification practice. It is developed on macOS with Claude Code and played on Windows 10 in Edge or Chrome by opening one `.html` file. No installer and no server.

---

## 0. How to use this plan (for the human)

```bash
mkdir ear-trainer && cd ear-trainer
cp ~/Downloads/CLAUDE.md .
git init
claude
```

First prompt to Claude Code:

> Read CLAUDE.md. Implement it phase by phase. After each phase, run the tests, commit, summarize what changed, and stop so I can try it in the browser before you continue.

Each phase ends with an **Acceptance** list. Claude Code checks the automatable items. You check the audio and UX items by ear, because Claude Code can't hear.

---

## Status

| Phase | State |
|---|---|
| 1 — Scaffold, music math, build | **Done.** 20 tests pass. Build output is 3.4 KB. Checked in Chrome on macOS: the placeholder renders, no console errors. |
| 2 — Game logic | **Done.** 44 tests pass (24 new in `game.test.js`). |
| 3 — Audio engine | **Done.** 63 tests pass (19 new in `audio.test.js`). Measured in Chrome with `OfflineAudioContext`: A4 = 440 Hz, 5 ms attack, no hard clip with 15 notes. The by-ear check is still open. |
| 4 — Playable UI | **Done.** 65 tests pass. Checked in Chrome on macOS: Start gate, mouse and keyboard guesses, explore, replays, Next, highlights, score. No console errors. The by-ear check is still open. |
| 5 — Settings, stats, polish, delivery | **Done.** 76 tests pass. Build output is 38.8 KB, with no external URLs. Checked in Chrome on macOS: all settings, persistence after reload, broken stored data, stats, two-click reset, reference tone, no horizontal scroll. Not checked: Edge or Chrome on Windows, `file://` storage. |
| 7 — Mobile (Android, GitHub Pages) | **In progress.** Approved. 92 tests pass. Build output is 59.8 KB. Done: 7.1 hosting at https://peter-kolenic.github.io/simple-train-musical-ear/ (`.github/workflows/pages.yml`, deploys on each push to `main`). Done before 7.2, at the user's request: the 🎹 EZ-310 button in the main button row, MIDI control keys (Next, Play tone), any MIDI key starts the game, MIDI settings hidden when MIDI is off. **Next: 7.2 (phone layout).** Then 7.3–7.5. The user has not tried the phone yet. |
| 6 — MIDI (optional) | **Done.** Checked in Chrome on macOS with the EZ-310: the key light (velocity 1, silent), note-off and CC 123 clear it, a full round lights the correct key. Results in `MIDI_EZ310.md`. Open: the tests in `MIDI_EZ310.md` §8, and `file://` on Windows. |

### Decisions made during implementation
- **Build:** `build.mjs` removes `import` lines and `export` keywords. It concatenates the modules in the order of its `MODULES` list inside one IIFE with `'use strict'`. The script replaces the `<!--SCRIPT-->` marker in `src/index.html`. The build fails if the bundle contains `</script`.
- **`package.json`:** contains `"type": "module"` (Node needs it to load `src/*.js` as ES modules in tests), `"name"`, `"private"`, and the two scripts. No dependencies.
- **`music.js`:** also exports the helpers `pitchClass`, `octaveOf`, and `spansOctaves`.
- **`ui.js`:** one module-level `game` state. `dispatch(action, arg)` runs the action, stops the notes that sound (not for `explore`), plays the `play` effects, and calls `render()`. `render()` draws everything from the state, so the `show` effect needs no own code.
- **Shared scope:** after the build, all modules share one scope. Top-level names must be unique in all modules. `build.mjs` parses the bundle with `new Function` and fails on a duplicate. It also removes multi-line `import` statements.
- **Letter keys:** `noteForLetter` (in `music.js`) maps a letter to the lowest note in the range with that name. `Shift` gives the next octave. C6 has no letter key; use the mouse. Central style: `B` is B♭, so it is dimmed in white-only mode.
- **Keys:** a guess uses `pointerdown`, not `click`, so the note starts at once. Dimmed keys do nothing before the answer. The buttons lose focus after a mouse click, so `Space` and `Enter` always go to the shortcuts.
- **Default range:** C4–C6 (60–84), white keys only. Central European names (H, B = B♭). Black keys stay available through `whiteOnly: false` (setting in Phase 5).
- **Browser check by Claude:** the Claude in Chrome extension cannot open `file://` URLs. Serve `dist/` on localhost for the check: `cd dist && python3 -m http.server 8765 --bind 127.0.0.1`, then open `http://127.0.0.1:8765/ear-trainer.html`. The user still opens the file directly on Windows.
- **Fake MIDI device for browser checks:** `aux/` (gitignored, local only) has `make_harness.py`. Run `python3 -I aux/make_harness.py` after `npm run build`. It writes `aux/harness.html` with a fake Web MIDI device. Serve `aux/` on port 8766. In the page console, `__press(note, channel)` sends a note-on, and `__sent` lists the bytes sent to the output. The fake port name matches `EZ310_PORT`. If `aux/` is missing, recreate the script from this description.
- **`game.js` API:** each action is `(state, arg?) → {state, effects}` and does not change its input. Illegal transitions throw. A guess outside the note set throws. `explore()` is allowed only in `ANSWERED`. The UI calls `guess()` in `AWAITING_GUESS` and `explore()` after the answer.
- **Effects:** `{type:'play', midi, delay}` (delay in seconds) and `{type:'show', result}`. The wrong-answer target plays at `WRONG_TARGET_DELAY` (0.8 s). The reference tone plays at 0 and the target at `REFERENCE_DELAY` (1 s). `replayTarget()` also plays the reference tone when it is on.
- **Config in state:** `createGame({noteSet, octaveMode, playTargetOnWrong, referenceNote, rng, stats})`. Change it with `configure(state, patch)`. Defaults: `exact`, `playTargetOnWrong: true`, `referenceNote: null`.
- **Stats:** plain JSON data, `{notes: {[t]: {attempts, correct}}, confusions: {[t]: {[g]: n}}}`. `game.js` does not touch `localStorage`. The UI loads and saves `state.stats` (Phase 4/5). Query helpers: `weakestNotes`, `topConfusions`.
- **RNG:** `seededRng(seed)` (mulberry32) is exported for tests.
- **`audio.js`:** `createSynth(ctx, {voice})` takes an `AudioContext`, so the tests use a fake context. The UI uses the module singleton: `ensureAudio()` (call inside a user gesture, resolves to the synth), `playNote(midi, {duration, when})`, `stopAll()`, `setVoice(v)`, `audioReady()`. `when` is a delay in seconds from now, the same as the effect `delay`. `duration: null` lets the note decay naturally. `playNote` returns a handle with `stop()`.
- **Voice:** each note is partial oscillators → envelope gains → one release gain → master gain 0.3 → soft clipper → destination. Partial amplitudes are normalized to a sum of 1. Partials above 90 % of Nyquist are dropped.
- **No `DynamicsCompressorNode`:** in Chrome it softens each note onset for about 100 ms (measured). A `WaveShaperNode` soft clipper (linear for |x| ≤ 0.5, tanh above) prevents hard clips instead.
- **Debug section:** `?debug` shows buttons for C4–C5 (chromatic), chords, a 7-note cluster, fast repeats, a short note, and A4 ×4 for a tuner. It also has a voice picker and "Stop all".
- **`settings.js`:** pure. `normalizeSettings(raw)` and `normalizeStats(raw)` turn any stored value into valid data. Bad fields get the default. `gameConfig(settings)` gives the part that `game.js` uses. Range endpoints are white keys from C2 to C7. Reference tones: C3, C4, A4, C5. `keyTextSize` (`small`, `normal`, `large`, `xlarge`; factors in `KEY_TEXT_SIZES`) sets the CSS variable `--key-text` on `#keyboard`.
- **Storage:** keys `ear-trainer.settings.v1` and `ear-trainer.stats.v1`. Every access is in try/catch. Stats are saved after each scored guess. The session score is not saved.
- **Settings change:** applies at once, through `configure()`. If the current target is not in the new note set, a new target plays at once: `skip()` (new in `game.js`, no score) before the answer, `next()` after it (the score of the answered round stays). The range selects offer only low < high.
- **Reset stats:** two clicks, because a browser dialog would block the page.
- **Chromium 109:** the newest features in use are `??` (Chrome 80), `Object.fromEntries` (73), and flex `gap` (84). Tests can use newer features, because they run only in Node.
- **`midi.js`:** `createMidiHub(access)` takes a `MIDIAccess`, so the tests use a fake one. The UI calls `startMidi()` (cached promise, not cached after an error). The hub sends each note-on (velocity > 0, not ch 10) from the selected input (or all) to `onNote`. `onMessage` gets all messages, for the debug log. The log hides clock (`F8`) and Active Sensing (`FE`), because the EZ-310 sends them all the time. Its port name is "Digital Keyboard". Details: `MIDI_EZ310.md`. It attaches the handler again on `onstatechange`.
- **MIDI guess:** a MIDI note-on goes through `onPianoKey(m, {fromMidi: true})`, the same path as a click. `midiSilentGuess` (default on) drops the immediate `play` effect of that note (`dispatch(..., {mute})`). The delayed target after a wrong answer still plays. In `IDLE`, any MIDI key starts the game. Control keys: settings `midiNextKey` and `midiReplayKey` (MIDI number or `null`, default `null`; the same key twice keeps only Next). `controlAction(settings, note)` in `settings.js` gives `'next'`, `'replay'`, or `null`, and only with MIDI on. `onPianoKey` checks it first, so a control key acts as the button from MIDI, from a screen click, and from a letter key. From MIDI, the control key acts at its note-off plus `MIDI_CONTROL_DELAY_MS` (250 ms), so the keyboard's own sound of that key stops before the target plays (`hub.onNoteOff`). CC 123 is not used for this: Yamaha keyboards probably do not stop locally played notes on CC 123 (not tested). `noteSetFor` removes the control keys from the note set (unless no note is left), so they are never a target. The screen keyboard shows a control key in the accent color with the button name as vertical text (`.key.control`, `writing-mode: vertical-rl`). The EZ-310 button sets 36 (C2) and 38 (D2). A MIDI message is not a user gesture, so it cannot start the audio: `unlockAudio` starts the `AudioContext` on any `pointerdown` or `keydown` (capture phase). Until then, a MIDI key in `IDLE` shows a hint in the start gate. Notes outside the on-screen range explore, but do not guess.
- **MIDI light (experimental):** `render()` calls `syncMidiLight()`. A wrong answer holds a note-on (velocity `MIDI_LIGHT_VELOCITY` = 1; tested on the EZ-310: the key lights with no sound, and `8nH` turns it off) on `midiLightChannel` of `midiOutput`. Any change of state sends the note-off. `start`, `next`, `skip`, and `pagehide` also send All Notes Off (CC 123) on the light channel, which clears a light that the hub does not know (for example from a `?debug` test). An input note-on equal to the lit note within `MIDI_ECHO_MS` (150 ms) is ignored, in case the keyboard echoes it.
- **EZ-310 facts** (from `../yamaha_ez-310/ez310_docs`, not verified): USB-MIDI is class compliant. Function 042/043 Light Part 1/2 (default ch 1/2) light keys for received MIDI. Function 041 Light Guide must be On. Function 044 Local Control Off mutes the keys. Yamaha calls MIDI 60 "C3".
- **MIDI settings:** `midiEnabled` (default off; when on, the page connects at load), `midiInput` (`'all'`), `midiSilentGuess`, `midiLight`, `midiOutput` (`''` = none), `midiLightChannel` (1–16). A stored port that is not connected stays in the list as "Not connected". The button **🎹 EZ-310** (rightmost in the Start row before the game, in the game row after it; `placeEz310Button` in `render()` moves it; its result shows under the title) sets MIDI on, silent guess, light on, ch 1, and selects the input and output whose name matches `EZ310_PORT` (`/digital keyboard|ez-?310/i`).
- **Node:** Node 26 (Active LTS) is managed by **mise** and pinned in `mise.toml`. Volta is unmaintained since 2025-11-14 and is no longer used. If `node` is not on `PATH` in a non-interactive shell, run `mise exec -- npm test`.

---

## 1. Goal and core loop

1. The app plays a **target tone**.
2. The player clicks a button or key that represents a tone.
3. The app **plays the player's guess**, then says **correct / incorrect**. If the guess is incorrect, it highlights the correct answer.
4. In both cases the round stays open. The player can replay the target, replay their guess, or play any other note, as often as they like. **The game advances only when the player clicks "Next".**

Only the first guess of a round is scored. After that, every note button is a free "explore" instrument.

---

## 2. Hard constraints (for Claude Code)

- **Deliverable:** `dist/ear-trainer.html`. This is one self-contained file with inline JS and CSS and no network requests: no CDNs, no fonts, no audio samples. Double-clicking it on Windows 10 must work offline in Edge or Chrome.
- **Zero npm dependencies.** Node is used only for tests (`node --test`) and for a tiny build script. Node 26 is managed by mise (`mise.toml`).
- **Source layout** keeps the logic testable outside the browser:

```
ear-trainer/
├── CLAUDE.md
├── src/
│   ├── index.html      # markup + CSS + <script> placeholder
│   ├── music.js        # pure: note math, naming, note sets
│   ├── game.js         # pure: state machine, scoring, stats
│   ├── audio.js        # Web Audio synth (browser-only)
│   ├── ui.js           # DOM wiring (browser-only)
│   └── midi.js         # Phase 6, optional
├── test/
│   ├── music.test.js
│   └── game.test.js
├── build.mjs           # inlines src/*.js into dist/ear-trainer.html
└── dist/ear-trainer.html
```

- Write modules as plain ES modules. `build.mjs` strips `import`/`export` lines and concatenates the modules in dependency order into a single `<script>` (the browser does not need module loading inside one file). Alternatively, wrap everything in one IIFE. Pick one approach and keep it simple.
- `music.js` and `game.js` must not touch `window`, `document`, or `AudioContext`. They take inputs (including an injectable RNG) and return plain data.

---

## 3. Design decisions (with defaults)

### 3.1 Pitch model
- Internally, every note is a **MIDI number** (C4 = 60, A4 = 69).
- Frequency in 12-TET: `f(m) = 440 · 2^((m − 69) / 12)`.
- Settings choose the **note set**:
  - Range: lowest and highest MIDI note. The default is **C4–C6** (60–84), two octaves.
  - Notes: **white keys only** (default for a beginner) or **all 12 chromatic**.
  - Octave matching: **exact** (default). Optionally, **pitch class only**, where the answer matches if `(guess − target) mod 12 = 0`. This matters only when the range spans more than one octave.

### 3.2 Note naming
Slovakia and Central Europe use **H** for B and **B** for B♭. Provide a setting:
- `International`: C D E F G A B, with ♯ (or ♭) for black keys.
- `Central European`: C D E F G A H, with B for B♭ and Cis/Dis/Fis/Gis for sharps.
- Default: Central European. Show octave numbers only when the range spans more than one octave.

### 3.3 Sound
A plain sine wave is hard to place in a register and sounds artificial. Use a cheap **additive "soft piano-ish" voice** instead:
- Harmonics 1–6 with amplitudes ≈ `1/n^1.5`. Each harmonic decays faster than the one below it (higher partials die sooner).
- Envelope: about 5 ms linear attack, then exponential decay toward silence over about 3.6 s (was 1.2 s; the user asked for 3× longer). Release with `setTargetAtTime` when stopped early.
- Master gain stays around 0.3 to avoid clipping when notes overlap. Every node is disconnected after it finishes.
- **Never start from a gain of exactly 0 with `exponentialRampToValueAtTime`**, because it throws. Start from 0.0001.
- **Autoplay policy:** create or `resume()` the `AudioContext` only inside a user gesture. On first load, the UI shows a "Start" button.
- Expose one function: `playNote(midi, {duration, when})`. Also add a setting to pick the voice: `piano-ish` (default), `sine`, or `triangle`.

### 3.4 Game state machine (`game.js`)

```
          start()                      guess(m)
  IDLE ───────────► AWAITING_GUESS ───────────────► ANSWERED
                      │  ▲                             │
                      │  └─────────── next() ──────────┘
                      └─ replayTarget() (stays)        ├─ replayTarget()   (stays)
                                                       ├─ replayGuess()    (stays)
                                                       └─ explore(m)       (stays, unscored)
```

- `start()` picks a target uniformly from the note set and **never repeats the previous target** when the set has more than one note.
- `guess(m)` is allowed only in `AWAITING_GUESS`. It records `correct = matches(target, m, octaveMode)`, updates the stats, and moves to `ANSWERED`.
- Actions return **effects** as data, such as `[{type:'play', midi}, {type:'show', result}]`. The UI executes them, which keeps `game.js` pure and testable.
- **Guess feedback sequence:** play the guess immediately. If the guess is incorrect, play the target about 0.8 s later so the player hears the contrast. Make this a setting: "After a wrong answer, also play the correct note: on/off".
- Optional setting, **reference tone**: before each target, play C4 (or a chosen note), then the target after 1 s. This turns the exercise into relative-pitch training. Default: off.

### 3.5 Stats
- Session: correct / total and current streak.
- Persistent (in `localStorage`, every access in try/catch, and the app must work without it): per-target-note attempts and correct counts, plus a **confusion count** `target → wrong guess`.
- A "Stats" panel shows the weakest notes and the top confusions, such as "E heard as F: 7×". It also has a "Reset stats" button.

### 3.6 UI
- An on-screen **piano keyboard** spanning the selected range is the primary answer surface. Notes outside the active note set are dimmed and disabled for guessing, but they still play in explore mode.
- Large buttons: **▶ Play tone** (replay target), **▶ My guess** (enabled after answering), **Next →**.
- Feedback banner: green "Correct — E", or red "Incorrect — you chose F, it was E". The correct key glows green and the wrong key glows red until Next.
- **Keyboard shortcuts:** `Space` replays the target, `Enter` or `N` goes to the next round, `G` replays the guess, and the letter keys `C D E F G A H/B` answer with natural notes. The letter shortcut for G conflicts with "replay guess", so use `R` for replay guess instead and keep the letters for notes.
- Settings live in a collapsible panel and are persisted.
- Must be usable at 1366×768 on a laptop. No horizontal scrolling with a 2-octave range.

---

## 4. Phases

### Phase 1 — Scaffold, music math, build
- Create the layout from §2, plus `build.mjs` and `package.json` with only `"scripts": {"test": "node --test", "build": "node build.mjs"}` and no dependencies.
- `music.js`: `midiToFreq`, `noteName(midi, {style, showOctave})`, `isBlack(midi)`, `buildNoteSet({low, high, whiteOnly})`, `matches(target, guess, mode)`.
- Tests: A4 = 440 Hz, C4 ≈ 261.626 Hz (±0.001), and A5 = 2·A4. Naming in both styles, including 71 → "H"/"B" and 70 → "B"/"A♯". White-only sets. Pitch-class matching across octaves.

**Acceptance:** `npm test` is green, and `npm run build` produces `dist/ear-trainer.html` that opens and shows a placeholder.

### Phase 2 — Game logic
- `game.js` implements the state machine (§3.4) and stats (§3.5) with an injectable RNG.
- Tests:
  - Illegal transitions are rejected: guessing in `ANSWERED`, or `next()` in `AWAITING_GUESS`.
  - Only the first guess is scored, and `explore()` never changes the score.
  - There are no immediate repeats over 1000 rounds with a seeded RNG.
  - The confusion matrix updates correctly.
  - The correct effects are emitted, including the wrong-answer "also play target" setting.

**Acceptance:** all tests are green.

### Phase 3 — Audio engine
- `audio.js` per §3.3. Add a hidden **debug page section** (toggle with `?debug`) that has buttons to play C4–C5 and a chord, for checking by ear.

**Acceptance (human, by ear):** no clicks or pops at note start or end. Overlapping notes don't distort. The pitches sound right against a real instrument (check A4 against a tuner app, which should read 440 Hz).

### Phase 4 — Playable UI
- `ui.js` wires the keyboard, buttons, banner, shortcuts, and Start gate (§3.6). Implement the effects from `game.js`.

**Acceptance (human):** the full core loop (§1) works with mouse and keyboard. Nothing advances without Next. Replay target and replay guess work any number of times. Explore mode plays notes without scoring.

### Phase 5 — Settings, stats, polish, delivery
- Settings panel (§3.1–3.4), persisted. Stats panel (§3.5).
- Check in **Chrome on macOS**. Also confirm that nothing uses APIs missing from Chromium 109, the last Chrome version supported on Windows 10. Avoid very new CSS/JS features, or feature-detect them.
- Edge on Windows 10 gets current updates. Chrome 109 is the floor if Koli uses Chrome there.
- Write a short `README.md` covering how to copy and open the file on Windows, how to put a desktop shortcut to it, and the shortcuts list.

**Acceptance:** the single file is under 100 KB, works offline, and survives a reload with settings intact.

### Phase 6 (optional) — MIDI keyboard input (Yamaha EZ-310 over USB)
- `midi.js`: feature-detect `navigator.requestMIDIAccess`. A device picker lists the inputs. A **note-on** from the keyboard acts like clicking that key: it guesses in `AWAITING_GUESS` and explores otherwise.
- Because the keyboard sounds by itself, add a setting "Don't play the guess through the app when it came from MIDI".
- **Experimental:** send the target or correct note to the keyboard's **MIDI output** after a wrong answer, and test whether the EZ-310 lights that key. This is unverified and depends on the keyboard's MIDI receive and lighting behavior. If it doesn't work, drop it.
- Web MIDI needs a secure context. Check that it works from `file://` in Edge and Chrome. If it doesn't, document a fallback: serving via `npx serve` or `python -m http.server` on localhost, or hosting on GitHub Pages.

**Acceptance (human):** pressing a key on the EZ-310 answers the round.

---

### Phase 7 — Mobile: Android phone, Chrome, GitHub Pages
Goal: play on an Android phone in Chrome, with the EZ-310 on a USB OTG cable. The same file still works offline on Windows.

**7.1 Hosting**
- Create a GitHub repository. Push needs approval. GitHub Pages is free only for a public repository on a free plan.
- Add `.github/workflows/pages.yml`: on push to `main`, run `npm test` and `npm run build`. Then publish `dist/` with `actions/upload-pages-artifact` and `actions/deploy-pages`. Copy `ear-trainer.html` to `index.html` in the artifact.
- The page is HTTPS, so Web MIDI has a secure context.
- localStorage on `github.io` is separate from `file://` and from localhost. Settings and stats do not move between them.

**7.2 Phone layout** (CSS media queries, no new dependency)
- Narrow screen (`max-width: 700px`) or touch (`pointer: coarse`):
  - controls in one row of large buttons; banner text smaller;
  - keys at least 36 px wide; `touch-action: manipulation` and `-webkit-touch-callout: none` on all buttons and keys;
  - hide the keyboard-shortcut help and the letter-key text.
- Portrait: show a hint "Turn the phone for more keys".
- First visit on a narrow screen (no stored settings): default range C4–C5. Stored settings are not changed. `settings.js` stays pure: the UI passes the default.

**7.3 Audio on Android**
- Resume the `AudioContext` on each Start, Play, and key tap. Android suspends it when the app goes to the background (`visibilitychange`).
- Test: Android can send the sound to the EZ-310 speakers when the cable is connected (USB audio). Record the result.

**7.4 MIDI on Android**
- When the stored port id is missing, but a port name matches `EZ310_PORT`, use that port. Port ids can change after a reconnect.
- After a reconnect (`onstatechange`), set the light again if a light is wanted.

**7.5 Debugging**
- Document Chrome remote debugging: USB debugging on the phone, `chrome://inspect` on the Mac, the phone console.

**7.6 Not in Phase 7**
- PWA (manifest and service worker): it needs separate files. Do it later if you ask for it.
- iOS: Safari has no Web MIDI.

**Acceptance (human, on the phone):** the Pages URL opens in Chrome on Android. Start, a tap guess, and Next work. The 1-octave range fits with no horizontal scroll. The EZ-310 button connects. A key on the EZ-310 answers. The correct key lights after a wrong answer. A reload keeps the settings.

**Acceptance (Claude):** tests pass. Chrome on macOS with a 390×844 viewport shows no horizontal scroll. `dist/ear-trainer.html` still opens as one file with no network requests.

## 5. Non-goals (v1)
- Intervals, chords, scales, and rhythm.
- Accounts, sync, and online leaderboards.
- iOS. Safari has no Web MIDI. (The Android phone layout is Phase 7.)
- Native Windows packaging. If ever needed later, the same HTML can be wrapped in Electron or Tauri.

---

## 6. Moving the game to Windows 10
Copy `dist/ear-trainer.html` to the Windows machine by USB stick, Google Drive, or email. Double-click it, and it opens in Edge. Optionally, right-click it and choose **Send to → Desktop (create shortcut)**.
