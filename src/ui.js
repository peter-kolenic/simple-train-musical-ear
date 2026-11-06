// DOM wiring. Phase 1: placeholder that proves the bundled script runs.
// Phase 3: a hidden audio debug section. Open the page with ?debug to show it.
import { buildNoteSet, noteName, spansOctaves } from './music.js';
import { VOICES, ensureAudio, playNote, stopAll, setVoice } from './audio.js';

const LOW = 60;
const HIGH = 84;

const names = (whiteOnly) => {
  const showOctave = spansOctaves(LOW, HIGH);
  return buildNoteSet({ low: LOW, high: HIGH, whiteOnly })
    .map((m) => noteName(m, { style: 'central', showOctave }))
    .join(' ');
};

const renderPlaceholder = () => {
  const el = document.getElementById('app');
  el.textContent = `Default note set (white keys): ${names(true)}`;
  const chromatic = document.createElement('p');
  chromatic.textContent = `With black keys: ${names(false)}`;
  el.after(chromatic);
};

// ---- audio debug section ----

// Each sound is a list of [midi, when, duration] for playNote.
const DEBUG_SOUNDS = [
  ['C major chord', [[60, 0], [64, 0], [67, 0]]],
  ['Arpeggio C–E–G–C', [[60, 0], [64, 0.15], [67, 0.3], [72, 0.45]]],
  ['Cluster C4–H4 (7 notes)', [60, 62, 64, 65, 67, 69, 71].map((m) => [m, 0])],
  ['Repeat C4 ×8 fast', Array.from({ length: 8 }, (_, i) => [60, i * 0.1])],
  ['A4 short (0.2 s)', [[69, 0, 0.2]]],
  ['A4 ×4 (tuner)', Array.from({ length: 4 }, (_, i) => [69, i * 1])],
  ['C4 and C6', [[60, 0], [84, 0]]],
];

const button = (label, onClick) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
};

const setupDebug = () => {
  if (!new URLSearchParams(location.search).has('debug')) return;
  const section = document.getElementById('debug');
  const state = document.getElementById('debug-state');
  section.hidden = false;

  // ensureAudio() runs inside the click handler, as the autoplay policy requires.
  const withAudio = (fn) => () =>
    ensureAudio()
      .then(() => {
        state.textContent = 'audio: running';
        fn();
      })
      .catch((err) => {
        state.textContent = `audio error: ${err.message}`;
      });

  const select = document.getElementById('debug-voice');
  VOICES.forEach((v) => select.add(new Option(v, v)));
  select.addEventListener('change', () => setVoice(select.value));

  document.getElementById('debug-stop').addEventListener('click', () => stopAll());

  const notes = document.getElementById('debug-notes');
  buildNoteSet({ low: 60, high: 72, whiteOnly: false }).forEach((m) => {
    const label = noteName(m, { style: 'central', showOctave: true });
    notes.append(button(label, withAudio(() => playNote(m))));
  });

  const extra = document.getElementById('debug-extra');
  DEBUG_SOUNDS.forEach(([label, events]) => {
    extra.append(button(label, withAudio(() =>
      events.forEach(([m, when, duration = null]) => playNote(m, { when, duration })))));
  });
};

renderPlaceholder();
setupDebug();
