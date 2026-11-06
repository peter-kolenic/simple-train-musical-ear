// DOM wiring. Phase 1: placeholder that proves the bundled script runs.
import { buildNoteSet, noteName } from './music.js';

const renderPlaceholder = () => {
  const el = document.getElementById('app');
  const set = buildNoteSet();
  const central = set.map((m) => noteName(m, { style: 'central' })).join(' ');
  const intl = set.map((m) => noteName(m, { style: 'international' })).join(' ');
  el.textContent = `Default note set — Central European: ${central} · International: ${intl}`;
};

renderPlaceholder();
