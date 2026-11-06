// DOM wiring. Phase 1: placeholder that proves the bundled script runs.
import { buildNoteSet, noteName, spansOctaves } from './music.js';

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

renderPlaceholder();
