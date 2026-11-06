// DOM wiring: start gate, piano keyboard, buttons, banner, shortcuts,
// settings and stats panels, localStorage. It runs the effects from game.js.
// With ?debug, it also shows the audio debug section.
// All modules share one scope after the build. Do not reuse a top-level name
// from music.js, game.js, or audio.js here.
import { buildNoteSet, noteName, spansOctaves, isBlack, noteForLetter } from './music.js';
import {
  IDLE, AWAITING_GUESS, ANSWERED,
  createGame, configure, start, next, skip, replayTarget, guess, replayGuess, explore,
  resetStats, weakestNotes, topConfusions,
} from './game.js';
import { VOICES, ensureAudio, playNote, stopAll, setVoice } from './audio.js';
import {
  REFERENCE_NOTES, rangeEndpoints, normalizeSettings, normalizeStats, gameConfig,
} from './settings.js';

const SETTINGS_KEY = 'ear-trainer.settings.v1';
const STATS_KEY = 'ear-trainer.stats.v1';
const KEY_FLASH_MS = 150;
const RESET_ARM_MS = 4000;
const STATS_ROWS = 5;
const BLACK_KEY_WIDTH = 0.6; // fraction of a white key

const $ = (id) => document.getElementById(id);

// ---- storage: every access in try/catch. The app works without it. ----

const loadJSON = (key) => {
  try {
    const text = localStorage.getItem(key);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
};

const saveJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // No storage (private window, blocked, or full). Keep the data in memory.
  }
};

let settings = normalizeSettings(loadJSON(SETTINGS_KEY));
let game = createGame({ ...gameConfig(settings), stats: normalizeStats(loadJSON(STATS_KEY)) });
const keyEls = new Map(); // midi -> key element

const label = (m) =>
  noteName(m, { style: settings.nameStyle, showOctave: spansOctaves(settings.low, settings.high) });

const inSet = (m) => game.config.noteSet.includes(m);

// ---- actions and effects ----

const runEffects = (effects) =>
  effects.forEach((e) => {
    if (e.type === 'play') playNote(e.midi, { when: e.delay });
    // 'show': render() draws the result from the state.
  });

// Runs a game action and its effects. stopFirst silences the notes that still sound.
const dispatch = (action, arg, { stopFirst = true } = {}) => {
  const { state, effects } = action(game, arg);
  const statsChanged = state.stats !== game.stats;
  game = state;
  if (stopFirst) stopAll();
  runEffects(effects);
  if (statsChanged) {
    saveJSON(STATS_KEY, game.stats);
    renderStats();
  }
  render();
};

// The audio context starts here, inside the user gesture.
const onStart = () => {
  if (game.phase !== IDLE) return;
  ensureAudio()
    .then(() => dispatch(start))
    .catch((err) => {
      $('start-gate').querySelector('p').textContent = `Audio does not start: ${err.message}`;
    });
};

const flash = (m) => {
  const el = keyEls.get(m);
  el.classList.add('down');
  setTimeout(() => el.classList.remove('down'), KEY_FLASH_MS);
};

// A key press: the scored guess before the answer, free play after it.
const onPianoKey = (m) => {
  if (game.phase === AWAITING_GUESS) {
    if (!inSet(m)) return; // dimmed keys do not guess
    flash(m);
    dispatch(guess, m);
  } else if (game.phase === ANSWERED) {
    flash(m);
    dispatch(explore, m, { stopFirst: false });
  }
};

const onReplayTarget = () => {
  if (game.phase !== IDLE) dispatch(replayTarget);
};
const onReplayGuess = () => {
  if (game.phase === ANSWERED) dispatch(replayGuess);
};
const onNext = () => {
  if (game.phase === ANSWERED) dispatch(next);
};

// ---- rendering ----

const bannerText = ({ phase, result }) => {
  if (phase === AWAITING_GUESS) return ['', 'Which note is this?'];
  if (phase !== ANSWERED) return ['', ''];
  return result.correct
    ? ['ok', `Correct — ${label(result.guess)}`]
    : ['bad', `Incorrect — you chose ${label(result.guess)}, it was ${label(result.target)}`];
};

const render = () => {
  const { phase, result, session } = game;
  $('start-gate').hidden = phase !== IDLE;
  $('game').hidden = phase === IDLE;
  $('score').textContent = session.total
    ? `Score ${session.correct} / ${session.total} · Streak ${session.streak}`
    : '';

  const [cls, text] = bannerText(game);
  const banner = $('banner');
  banner.className = cls;
  banner.textContent = text;

  $('play-guess').disabled = phase !== ANSWERED;
  $('next').disabled = phase !== ANSWERED;

  const answered = phase === ANSWERED;
  keyEls.forEach((el, m) => {
    const isTarget = answered && m === result.target;
    const isGuess = answered && m === result.guess;
    el.classList.toggle('out', !inSet(m));
    el.classList.toggle('correct', isTarget || (isGuess && result.correct));
    el.classList.toggle('wrong', isGuess && !result.correct);
    el.setAttribute('aria-disabled', String(phase === AWAITING_GUESS && !inSet(m)));
  });
};

const renderStats = () => {
  const body = $('stats-body');
  const weak = weakestNotes(game.stats, STATS_ROWS);
  const conf = topConfusions(game.stats, STATS_ROWS);
  body.textContent = '';
  if (weak.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No answers yet.';
    body.append(p);
    return;
  }
  const column = (title, items) => {
    const div = document.createElement('div');
    const h = document.createElement('h3');
    h.textContent = title;
    const list = document.createElement('ol');
    items.forEach((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      list.append(li);
    });
    div.append(h, items.length ? list : Object.assign(document.createElement('p'), {
      className: 'muted', textContent: 'None yet.',
    }));
    return div;
  };
  const cols = document.createElement('div');
  cols.className = 'stats-cols';
  cols.append(
    column('Weakest notes', weak.map((w) =>
      `${label(w.midi)}: ${w.correct} of ${w.attempts} correct (${Math.round(w.accuracy * 100)} %)`)),
    column('Top confusions', conf.map((c) =>
      `${label(c.target)} heard as ${label(c.guess)}: ${c.count}×`)),
  );
  body.append(cols);
};

// White keys share the row equally. A black key sits on the boundary
// after the white keys below it.
const buildKeyboard = () => {
  const kb = $('keyboard');
  kb.textContent = '';
  keyEls.clear();
  const all = buildNoteSet({ low: settings.low, high: settings.high, whiteOnly: false });
  const whites = all.filter((m) => !isBlack(m));
  const w = 100 / whites.length;
  all.forEach((m) => {
    const black = isBlack(m);
    const el = document.createElement('div');
    el.className = `key ${black ? 'black' : 'white'}`;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', label(m));
    // Show the octave only on C, so the keys stay easy to read.
    el.textContent = noteName(m, { style: settings.nameStyle, showOctave: m % 12 === 0 });
    if (black) {
      const below = whites.filter((x) => x < m).length;
      el.style.left = `${below * w - (w * BLACK_KEY_WIDTH) / 2}%`;
      el.style.width = `${w * BLACK_KEY_WIDTH}%`;
    }
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onPianoKey(m);
    });
    kb.append(el);
    keyEls.set(m, el);
  });
};

// ---- shortcuts ----

const onKeyDown = (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (game.phase === IDLE) {
    if (k === ' ' || k === 'Enter') {
      e.preventDefault();
      onStart();
    }
    return;
  }
  // preventDefault also stops a focused button from a second activation.
  if (k === ' ') {
    e.preventDefault();
    onReplayTarget();
  } else if (k === 'Enter' || k === 'n') {
    e.preventDefault();
    onNext();
  } else if (k === 'r') {
    e.preventDefault();
    onReplayGuess();
  } else if (/^[a-h]$/.test(k)) {
    const m = noteForLetter(k, {
      low: settings.low, high: settings.high, style: settings.nameStyle, shift: e.shiftKey ? 1 : 0,
    });
    if (m === null) return;
    e.preventDefault();
    onPianoKey(m);
  }
};

// A mouse click leaves no focus on the button, so Space and Enter go to the shortcuts.
const onButton = (id, fn) =>
  $(id).addEventListener('click', (e) => {
    if (e.detail > 0) e.currentTarget.blur();
    fn();
  });

const helpLetters = () =>
  buildNoteSet({ low: 60, high: 71, whiteOnly: true })
    .map((m) => noteName(m, { style: settings.nameStyle }))
    .join(' ');

// ---- settings panel ----

const fillSelect = (el, options, value) => {
  el.textContent = '';
  options.forEach(([v, text]) => el.add(new Option(text, String(v))));
  el.value = String(value);
};

// The range lists offer only low < high, so the form cannot make a bad range.
const fillSettingsForm = () => {
  const s = settings;
  const name = (m) => noteName(m, { style: s.nameStyle, showOctave: true });
  const ends = rangeEndpoints();
  fillSelect($('set-low'), ends.filter((m) => m < s.high).map((m) => [m, name(m)]), s.low);
  fillSelect($('set-high'), ends.filter((m) => m > s.low).map((m) => [m, name(m)]), s.high);
  fillSelect($('set-reference'),
    [['off', 'Off'], ...REFERENCE_NOTES.map((m) => [m, `${name(m)}, then the tone`])],
    s.referenceNote === null ? 'off' : s.referenceNote);
  $('set-white').value = String(s.whiteOnly);
  $('set-octave').value = s.octaveMode;
  $('set-names').value = s.nameStyle;
  $('set-wrong').value = String(s.playTargetOnWrong);
  $('set-voice').value = s.voice;
};

const readSettingsForm = () => ({
  low: Number($('set-low').value),
  high: Number($('set-high').value),
  whiteOnly: $('set-white').value === 'true',
  octaveMode: $('set-octave').value,
  nameStyle: $('set-names').value,
  playTargetOnWrong: $('set-wrong').value === 'true',
  referenceNote: $('set-reference').value === 'off' ? null : Number($('set-reference').value),
  voice: $('set-voice').value,
});

const applySettings = (raw) => {
  settings = normalizeSettings(raw);
  saveJSON(SETTINGS_KEY, settings);
  setVoice(settings.voice);
  game = configure(game, gameConfig(settings));
  buildKeyboard();
  fillSettingsForm();
  $('help-letters').textContent = helpLetters();
  renderStats();
  // The current target can drop out of the new note set. Then draw a new one.
  if (game.phase === AWAITING_GUESS && !inSet(game.target)) dispatch(skip);
  else render();
};

const setupSettings = () => {
  fillSettingsForm();
  setVoice(settings.voice);
  $('settings-panel').querySelectorAll('select').forEach((el) =>
    el.addEventListener('change', () => {
      applySettings(readSettingsForm());
      // Give the shortcuts back to the page.
      el.blur();
    }));
};

// Reset needs two clicks. A browser dialog would block the page.
const setupResetStats = () => {
  const btn = $('reset-stats');
  let timer = null;
  const disarm = () => {
    clearTimeout(timer);
    btn.classList.remove('armed');
    btn.textContent = 'Reset stats';
  };
  btn.addEventListener('click', () => {
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = 'Click again to delete all stats';
      timer = setTimeout(disarm, RESET_ARM_MS);
      return;
    }
    disarm();
    game = resetStats(game);
    saveJSON(STATS_KEY, game.stats);
    renderStats();
  });
};

const setupGame = () => {
  buildKeyboard();
  $('help-letters').textContent = helpLetters();
  onButton('start', onStart);
  onButton('play-target', onReplayTarget);
  onButton('play-guess', onReplayGuess);
  onButton('next', onNext);
  document.addEventListener('keydown', onKeyDown);
  setupSettings();
  setupResetStats();
  renderStats();
  render();
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

const debugButton = (text, onClick) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
};

const setupDebug = () => {
  if (!new URLSearchParams(location.search).has('debug')) return;
  const section = $('debug');
  const state = $('debug-state');
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

  const select = $('debug-voice');
  VOICES.forEach((v) => select.add(new Option(v, v)));
  select.addEventListener('change', () => setVoice(select.value));

  $('debug-stop').addEventListener('click', () => stopAll());

  const notes = $('debug-notes');
  buildNoteSet({ low: 60, high: 72, whiteOnly: false }).forEach((m) => {
    const text = noteName(m, { style: 'central', showOctave: true });
    notes.append(debugButton(text, withAudio(() => playNote(m))));
  });

  const extra = $('debug-extra');
  DEBUG_SOUNDS.forEach(([text, events]) => {
    extra.append(debugButton(text, withAudio(() =>
      events.forEach(([m, when, duration = null]) => playNote(m, { when, duration })))));
  });
};

setupGame();
setupDebug();
