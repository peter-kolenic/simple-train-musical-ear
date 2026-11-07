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
- **Text on keys**: small, normal (default), large, or very large.

- **MIDI keyboard**: see the next section.

**Stats** shows the notes with the lowest score and the most frequent confusions. **Reset stats** needs two clicks.

## Play with a MIDI keyboard (Yamaha EZ-310)

A key on the MIDI keyboard acts as a click on the screen keyboard. Before the answer, it is your guess. After the answer, it plays the note without a score.

1. Connect the [USB TO HOST] port of the keyboard to the computer with a USB cable. MIDI needs no driver.
2. Close all other programs that use MIDI. On Windows, only one program at a time can open a MIDI port.
3. Open the app. Click **🎹 EZ-310**, to the right of Start (or of Next, during the game).
4. If the browser asks for permission to use MIDI devices, allow it.
5. Make sure that the text under the title says "Done: Digital Keyboard on channel 1".

**🎹 EZ-310** sets all MIDI settings below to the values that work with the EZ-310. For another keyboard, set **MIDI** to **On** and set the other MIDI settings yourself.

MIDI settings:

- **Input**: all inputs (default), or one device.
- **A guess from MIDI**: the keyboard makes its own sound, so the app does not play the note again (default). Select **Also play it in the app** if the keyboard does not make a sound, for example when Local Control (Function 044) is Off.
- **Light the correct key** (experimental): after a wrong answer, the app sends the correct note to the keyboard. On the EZ-310, this can light the key until you click **Next**. Set **Light output** to the keyboard. **Light channel** must agree with Function 042 or 043 (Light Part 1 or 2, default channels 1 and 2). Function 041 (Light Guide) must be On.

Notes on the EZ-310:

- The light is silent. Tested on light channel 1 with the default functions 041–043.
- The keyboard shows as "Digital Keyboard" in the MIDI lists.
- Yamaha calls middle C "C3". The app calls it "C4". The key is the same.

If **MIDI** shows "This browser has no Web MIDI" or MIDI does not start when you open the file directly, serve the folder on localhost:

1. Open a command prompt in the folder of `ear-trainer.html`.
2. Run `python -m http.server 8000 --bind 127.0.0.1`.
3. Open `http://127.0.0.1:8000/ear-trainer.html`.

Add `?debug` to the URL to show the MIDI debug section. It shows the last messages from the keyboard. Its buttons send test messages to the light output and channel.

## For developers

Requirements: Node 26 (managed by mise, see `mise.toml`). There are no npm dependencies.

```bash
npm test          # unit tests (node --test)
npm run build     # writes dist/ear-trainer.html
```

The source is in `src/`. `build.mjs` puts all modules into one `<script>` in the HTML file. Add `?debug` to the URL to show the audio and MIDI debug sections.
