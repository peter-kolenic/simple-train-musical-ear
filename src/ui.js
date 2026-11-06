// DOM wiring: start gate, piano keyboard, buttons, banner, shortcuts.
// It runs the effects from game.js. With ?debug, it also shows the audio
// debug section.
// All modules share one scope after the build. Do not reuse a top-level name
// from music.js, game.js, or audio.js here.
import { buildNoteSet, noteName, spansOctaves, isBlack, noteForLetter } from './music.js';
import {
  IDLE, AWAITING_GUESS, ANSWERED,
  createGame, start, next, replayTarget, guess, replayGuess, explore,
} from './game.js';
import { VOICES, ensureAudio, playNote, stopAll, setVoice } from './audio.js';

const RANGE = { low: 60, high: 84 };
const NAME_STYLE = 'central';
const KEY_FLASH_MS = 150;
const BLACK_KEY_WIDTH = 0.6; // fraction of a white key

const $ = (id) => document.getElementById(id);

let game = createGame({ noteSet: buildNoteSet({ ...RANGE, whiteOnly: true }) });
const keyEls = new Map(); // midi -> key element

const label = (m) =>
  noteName(m, { style: NAME_STYLE, showOctave: spansOctaves(RANGE.low, RANGE.high) });

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
  game = state;
  if (stopFirst) stopAll();
  runEffects(effects);
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

// White keys share the row equally. A black key sits on the boundary
// after the white keys below it.
const buildKeyboard = () => {
  const kb = $('keyboard');
  const all = buildNoteSet({ ...RANGE, whiteOnly: false });
  const whites = all.filter((m) => !isBlack(m));
  const w = 100 / whites.length;
  all.forEach((m) => {
    const black = isBlack(m);
    const el = document.createElement('div');
    el.className = `key ${black ? 'black' : 'white'}`;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', label(m));
    // Show the octave only on C, so the keys stay easy to read.
    el.textContent = noteName(m, { style: NAME_STYLE, showOctave: m % 12 === 0 });
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
    const m = noteForLetter(k, { ...RANGE, style: NAME_STYLE, shift: e.shiftKey ? 1 : 0 });
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
    .map((m) => noteName(m, { style: NAME_STYLE }))
    .join(' ');

const setupGame = () => {
  buildKeyboard();
  $('help-letters').textContent = helpLetters();
  onButton('start', onStart);
  onButton('play-target', onReplayTarget);
  onButton('play-guess', onReplayGuess);
  onButton('next', onNext);
  document.addEventListener('keydown', onKeyDown);
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
