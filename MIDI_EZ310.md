# Yamaha EZ-310: MIDI facts

This file collects the MIDI facts about the Yamaha EZ-310 that matter for two projects:
- this project, the ear trainer (live USB-MIDI, Phase 6);
- `../yamaha_ez-310` (`ezmidi`, which prepares `.mid` files for the lesson mode).

Each fact has a source tag:
- **[DL]**: the Data List, `../yamaha_ez-310/ez310_docs/EZ-310_DL_EnFrEsDeZh_A0_web.pdf`, pages 35–36 ("MIDI Data Format" and "MIDI Implementation Chart", version 1.0, 02-May-2024).
- **[RM]**: the Reference Manual and its Function List (`ez310_docs/EZ-310_RM_En_B0_text/`).
- **[KB]**: verified on the keyboard (`../yamaha_ez-310/CLAUDE.md`, `samples/lesson/TEST_PLAN.md`, and the ear trainer `?debug` tests on 2026-11-07).
- **[?]**: not known. A test on the keyboard must answer it.

## 1. Connection

- The [USB TO HOST] port carries USB-MIDI and USB audio. [RM]
- MIDI needs no driver on Windows or macOS. Only USB audio on Windows needs the "Yamaha Steinberg USB Driver". [RM]
- "Communication of MIDI messages": the instrument plays MIDI that it receives, and it sends what you play on the keys. [RM]
- Wait 6 s or more between a USB unplug and the next plug, and between a power off and the next power on. [RM]
- Storage Mode (Function 061) shows the keyboard as a USB drive. The keyboard does not respond to the panel in this mode. It probably does not send or receive MIDI either. [RM] [?]
- On macOS, the drive is `/Volumes/EZ-310`. [KB]

## 2. The MIDI Implementation Chart [DL]

| Function | Transmitted | Recognized | Notes |
|---|---|---|---|
| Basic channel | 1–16 | 1–16 | Cannot be changed. |
| Mode | 3 (Omni off, Poly) | 3 | |
| Note number | 0–127 | 0–127 | |
| Note on | `9nH`, v = 1–127 | `9nH`, v = 1–127 | |
| Note off | as `9nH`, v = 0 | not as `8nH` (x) | See the warning below. |
| Aftertouch | no | no | |
| Pitch bend | no | yes | |
| CC 0, 32 Bank select | yes | yes | |
| CC 1 Modulation | yes | yes | |
| CC 5, 65 Portamento | no | yes | |
| CC 6, 38 Data entry | no | yes | |
| CC 7, 10 Volume, pan | yes | yes | |
| CC 11 Expression | no | yes | |
| CC 64 Sustain | yes | yes | |
| CC 71, 73, 74 Sound controllers | no | yes | |
| CC 72 Release time | yes | yes | |
| CC 82 General purpose | yes | yes | |
| CC 83, 84 | no | yes | |
| CC 91, 93 Reverb, chorus depth | yes | yes | |
| CC 96, 97, 100, 101 RPN | no | yes | |
| Program change | 0–127 | 0–127 | |
| System exclusive | yes | yes | |
| Song position, song select, tune | no | no | |
| Clock (`F8H`), start/stop | yes | yes | |
| All Sound Off (CC 120, 126, 127) | no | yes | |
| Reset All Controllers (CC 121) | no | yes | |
| Local On/Off (CC 122) | no | yes | |
| All Notes Off (CC 123–125) | no | yes | |
| Active Sensing (`FEH`) | yes | yes | |
| Reset (`FFH`) | no | no | |

The chart marks "Note OFF, `9nH` v=0" with "x" in both columns. The usual Yamaha meaning is that the keyboard sends a note-off as a note-on with velocity 0. The chart does not say that the keyboard recognizes `8nH`. But a test shows that `8nH` turns off a light. [KB]

## 3. The MIDI Data Format notes [DL]

1. **Multi-timbral receive.** With the factory settings, the instrument is a 16-channel multi-timbral tone generator. Incoming data does not change the panel voices or the panel settings. Only these messages change the panel voices, the accompaniment, and the songs:
   - MIDI Master Tuning;
   - the SysEx messages for the Reverb Type and the Chorus Type.
2. Some control changes cannot come from the keys. The accompaniment, a song, or the Harmony effect can still send them.
3. **System exclusive:**
   - GM System On: `F0 7E 7F 09 01 F7`. It sets all default settings again, except MIDI Master Tuning.
   - MIDI Master Volume: `F0 7F 7F 04 01 ll mm F7`. Only `mm` is used.
   - MIDI Master Tuning: `F0 43 1n 27 30 00 00 mm ll cc F7`. The default is `mm` = 08H, `ll` = 00H.
   - Reverb Type: `F0 43 1n 4C 02 01 00 mm ll F7`.
   - Chorus Type: `F0 43 1n 4C 02 01 20 mm ll F7`.
   - The Effect map in the Data List gives the MSB/LSB values for each type. An unknown LSB selects the nearest type.
4. **Accompaniment:** a start sends `FAH`, and a stop sends `FCH`. With External Clock (Function 045) On, the keyboard recognizes both.
5. **Local On/Off:** `Bn 7A 7F` (on) and `Bn 7A 00` (off). The keyboard ignores the channel `n`.

## 4. Related functions [RM]

| No. | Name (display) | Range, default | What it does |
|---|---|---|---|
| 037 | Lesson Track R (`R-Part`) | 1–16, 1 | The right-hand lesson channel for a copied SMF 0 song. |
| 038 | Lesson Track L (`L-Part`) | 1–16, 2 | The left-hand lesson channel. |
| 040 | Guide | On/Off, On | The guide note sounds in the "Waiting" lesson. |
| 041 | Light Guide (`Light`) | On/Off, On | Turns the key lights on or off. |
| 042 | Light Part 1 (`LightPt1`) | 1–16, 1 | The 1st channel that lights the keys "when playing a MIDI Song contained on the computer". |
| 043 | Light Part 2 (`LightPt2`) | 1–16, 2 | The 2nd channel that lights the keys. |
| 044 | Local Control (`Local`) | On/Off, On | Off: the keys do not play the internal tone generator. |
| 045 | External Clock (`ExtClock`) | On/Off, Off | Song and style playback follow the external clock. |
| 046 | Initial Send (`InitSend`) | YES/NO | Sends the panel settings to the computer. |
| 049 | Audio Loopback | On/Off, On | Sends the computer audio back to the computer. Turn it off with a DAW. |
| 001 | Transpose | −12 to +12, 0 | Changes the pitch in semitones. |

## 5. Facts about the lesson mode [KB]

These facts come from `ezmidi` tests with copied songs.

- Lesson 3 (Waiting) needs SMF Format 0. A Format 1 song plays and lights the keys, but it does not wait.
- With the defaults, [R/1] uses ch 1 and [L/2] uses ch 2. One part is enough.
- The lesson part is muted, and the other channels play.
- Function 037 works, but a song change sets it back to 1.
- Yamaha names MIDI 60 "C3". The ear trainer names it "C4". The keys are C1–C6 in Yamaha names, which is MIDI 36–96.

## 6. What this means for the ear trainer

### Input
- The keyboard sends note-ons with velocity 1–127. It sends a note-off as a note-on with velocity 0. `parseMidiMessage` handles this already.
- The chart does not tell the channel for the keys. The ear trainer accepts all channels except ch 10. That choice covers this. [?] The `?debug` log shows the channel.
- When a style or a song plays, the keyboard sends clock (`F8H`), `FAH`/`FCH`, and probably the accompaniment notes. The accompaniment notes could make false guesses. Do not play a style or a song while you practise. [?]
- The USB-MIDI port name is "Digital Keyboard", not "EZ-310". [KB]
- The keyboard sends clock (`F8H`) all the time, also with no style or song in use, and Active Sensing (`FEH`). [KB] The game ignores both. The `?debug` log hides both.
- Not known: does Transpose (Function 001) change the note numbers that the keyboard sends? [?]

### Light (experimental)
Test results on 2026-11-07, light channel 1, with the default settings of 041–043: [KB]

| Message | Result |
|---|---|
| Note-on C4, velocity 1 | The key lights. No sound. |
| Note-on C4, velocity 64 | The key lights. The keyboard plays the note. |
| Note-off C4 (`8nH`) | The light goes off. |
| CC 7 = 0, then CC 7 = 100 | No visible change. |
| All Notes Off (CC 123) | The light goes off. |

- So the ear trainer uses velocity 1 (`MIDI_LIGHT_VELOCITY`). The light is silent, and CC 7 is not necessary.
- Received notes play on the multi-timbral part for that channel, not on the panel voice. [DL]
- Not tested: velocity 64 after CC 7 = 0. Is the light then silent? This is not necessary with velocity 1. [?]
- Not tested: the light on channel 2 (Light Part 2). [?]

### Sound
- The app can turn Local Control off and on with `Bn 7A 00` and `Bn 7A 7F`. [DL] Then the keys make no sound, and the app plays the guess. This needs no menu work on the keyboard. A possible new setting.
- Make sure that the app sends Local On when it closes. If it does not, the keyboard stays silent until Function 044 or a restart sets it back. [?]
- Do not send GM System On from the app. It sets all default settings again.

## 7. What this means for `ezmidi`

- Messages in a song that the keyboard recognizes: notes, pitch bend, bank select, program change, CC 1, 5, 6, 7, 10, 11, 38, 64, 65, 71–74, 82–84, 91, 93, RPN, and the SysEx messages in §3. Other CCs (for example CC 94 Variation depth) have no effect. `ezmidi` can remove them without risk.
- `ezmidi` keeps CC 7, 10, 11, 64, and program changes. The keyboard also recognizes bank select (CC 0/32) and CC 91/93 (reverb and chorus depth). Keep them if a song needs XG voices or effects. Bank select without program change does nothing.
- Pitch bend is recognized. `ezmidi` removes it on the R/L channels by default. This is correct for the lesson parts.
- A GM System On SysEx at the start of a song sets the defaults again. `ezmidi` removes all SysEx by default, so this is not a problem.
- Song position and song select are not recognized.
- The Data List has the preset song list with the lesson parts of each song (for example "LR" or "R"). Use it as a reference for how Yamaha's own lesson songs are set up.

## 8. Tests to do on the keyboard

Done: the light tests (§6, "Light"). A full round with **Light the correct key** on: the correct key lights after a wrong guess, and Next clears it. [KB]

1. Open the ear trainer with `?debug`. Turn MIDI on. Press keys. Write down the channel and the note-off form.
2. Set Transpose (001) to +2. Press C4. Does the log show 60 or 62?
3. Start a style. Do accompaniment notes appear in the log?
