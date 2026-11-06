# Ear Trainer

A pitch-identification game in one HTML file. The app plays a tone. You find the tone on the on-screen piano keyboard. The app needs no installer, no server, and no network.

## Use the app on Windows 10

1. Copy `dist/ear-trainer.html` to the Windows computer. Use a USB stick, Google Drive, or email.
2. Put the file in a permanent folder, for example `Documents\Ear Trainer`.
3. Double-click the file. It opens in Edge, or in your default browser.
4. Click **Start**.

The app works offline. Use Edge, or Chrome 109 or later.

### Put a shortcut on the desktop

1. Right-click `ear-trainer.html`.
2. Select **Send to → Desktop (create shortcut)**.

Settings and stats stay in the browser on this computer. Edge and Chrome keep different copies. If you clear the browser data, the app starts again with the default settings and empty stats.

## How to play

1. Listen to the tone.
2. Click the key on the keyboard that has the same pitch.
3. The app plays your guess and shows "Correct" or "Incorrect". After an incorrect guess, the correct key is green and your key is red.
4. Replay the tone, replay your guess, or play other keys. Only the first guess of a round counts.
5. Click **Next** to go to the next tone.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Start the game, or play the tone again |
| `Enter` or `N` | Start the game, or go to the next tone |
| `R` | Play your guess again |
| `C` `D` `E` `F` `G` `A` `H` | Answer with that note in the lowest octave of the range |
| `Shift` + letter | Answer with that note one octave higher |

With international note names, use `B` in place of `H`. With Central European names, `B` is B♭. Use the mouse for notes above the second octave, for example C6.

## Settings

Open **Settings** under the keyboard.

- **Lowest note** and **Highest note**: the range of the keyboard and of the tones. The default is C4 to C6.
- **Notes**: white keys only (default), or all 12 notes.
- **Octave**: the exact octave must match (default), or any octave is correct.
- **Note names**: Central European (H, and B = B♭) or international.
- **After a wrong answer**: also play the correct note (default), or play only your guess.
- **Reference tone**: play C3, C4, A4, or C5 before each tone. This trains relative pitch. The default is off.
- **Sound**: soft piano (default), sine, or triangle.

**Stats** shows the notes with the lowest score and the most frequent confusions. **Reset stats** needs two clicks.

## For developers

Requirements: Node 26 (managed by mise, see `mise.toml`). There are no npm dependencies.

```bash
npm test          # unit tests (node --test)
npm run build     # writes dist/ear-trainer.html
```

The source is in `src/`. `build.mjs` puts all modules into one `<script>` in the HTML file. Add `?debug` to the URL to show the audio debug section.
