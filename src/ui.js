// DOM wiring: start gate, piano keyboard, buttons, banner, shortcuts,
// settings and stats panels, localStorage. It runs the effects from game.js.
// MIDI: a note-on from a MIDI keyboard acts as a key press. With ?debug, it
// also shows the audio and MIDI debug section.
// All modules share one scope after the build. Do not reuse a top-level name
// from the other modules here.
import { buildNoteSet, noteName, spansOctaves, isBlack, noteForLetter } from './music.js';
import {
  IDLE, AWAITING_GUESS, ANSWERED,
  createGame, configure, start, next, skip, replayTarget, guess, replayGuess, explore,
  resetStats, weakestNotes, topConfusions,
} from './game.js';
import { VOICES, ensureAudio, audioRunning, playNote, stopAll, setVoice } from './audio.js';
import {
  midiSupported, startMidi, noteOnBytes, noteOffBytes, controlChangeBytes,
} from './midi.js';
import {
  REFERENCE_NOTES, KEY_TEXT_SIZES, MIDI_ALL_INPUTS, MIDI_NO_OUTPUT, RANGE_MIN, RANGE_MAX,
  controlAction, rangeEndpoints, normalizeSettings, normalizeStats, gameConfig,
} from './settings.js';

const SETTINGS_KEY = 'ear-trainer.settings.v1';
const STATS_KEY = 'ear-trainer.stats.v1';
const KEY_FLASH_MS = 150;
const RESET_ARM_MS = 4000;
const STATS_ROWS = 5;
const BLACK_KEY_WIDTH = 0.6; // fraction of a white key
// Velocity 1 lights the key on the EZ-310 and makes no sound (tested).
const MIDI_LIGHT_VELOCITY = 1;
const MIDI_LOG_ROWS = 12;
// The EZ-310 sends clock (F8) and Active Sensing (FE) all the time.
// The log hides them, so that the key messages stay visible.
const MIDI_LOG_HIDDEN = [0xf8, 0xfe];

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
let hub = null; // the MIDI hub, after startMidi() succeeds
let midiStatus = '';
const hubHooks = []; // run once, when the hub starts

const label = (m) =>
  noteName(m, { style: settings.nameStyle, showOctave: spansOctaves(settings.low, settings.high) });

const inSet = (m) => game.config.noteSet.includes(m);

// ---- actions and effects ----

// mute: a note that the MIDI keyboard already sounds. Its immediate play effect is dropped.
const runEffects = (effects, mute) =>
  effects.forEach((e) => {
    if (e.type === 'play' && !(e.midi === mute && e.delay === 0)) playNote(e.midi, { when: e.delay });
    // 'show': render() draws the result from the state.
  });

// Runs a game action and its effects. stopFirst silences the notes that still sound.
const dispatch = (action, arg, { stopFirst = true, mute = null } = {}) => {
  const { state, effects } = action(game, arg);
  const statsChanged = state.stats !== game.stats;
  game = state;
  if (stopFirst) stopAll();
  if (action === start || action === next || action === skip) clearMidiLights();
  runEffects(effects, mute);
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

// A MIDI key can be outside the on-screen keyboard.
const flash = (m) => {
  const el = keyEls.get(m);
  if (!el) return;
  el.classList.add('down');
  setTimeout(() => el.classList.remove('down'), KEY_FLASH_MS);
};

// A key press: the scored guess before the answer, free play after it.
// fromMidi: the MIDI keyboard can sound the note by itself.
// A control key acts as a button, on the screen and on the MIDI keyboard.
const CONTROL_LABELS = { next: 'Next →', replay: '▶ Play tone' };

const onPianoKey = (m, { fromMidi = false } = {}) => {
  const control = controlAction(settings, m);
  if (control) {
    flash(m);
    if (control === 'next') onNext();
    else onReplayTarget();
    return;
  }
  const mute = fromMidi && settings.midiSilentGuess ? m : null;
  if (game.phase === AWAITING_GUESS) {
    if (!inSet(m)) return; // dimmed keys do not guess
    flash(m);
    dispatch(guess, m, { mute });
  } else if (game.phase === ANSWERED) {
    flash(m);
    dispatch(explore, m, { stopFirst: false, mute });
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

// One EZ-310 button: in the Start row before the game, in the game row after Start.
const placeEz310Button = (phase) => {
  const row = $(phase === IDLE ? 'start-row' : 'game-row');
  const btn = $('midi-ez310');
  if (btn.parentElement !== row) row.append(btn);
};

const render = () => {
  const { phase, result, session } = game;
  placeEz310Button(phase);
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
    el.classList.toggle('out', !inSet(m) && !controlAction(settings, m));
    el.classList.toggle('correct', isTarget || (isGuess && result.correct));
    el.classList.toggle('wrong', isGuess && !result.correct);
    el.setAttribute('aria-disabled', String(phase === AWAITING_GUESS && !inSet(m) && !controlAction(settings, m)));
  });
  syncMidiLight();
};

// ---- MIDI ----

// Experimental: the MIDI keyboard lights the correct key after a wrong answer,
// until the next round. The light is a held note-on.
const wantedLight = () => {
  const s = settings;
  if (!hub || !s.midiEnabled || !s.midiLight || s.midiOutput === MIDI_NO_OUTPUT) return null;
  if (game.phase !== ANSWERED || game.result.correct) return null;
  return { outputId: s.midiOutput, note: game.result.target, channel: s.midiLightChannel };
};

const syncMidiLight = () => {
  if (!hub) return;
  const w = wantedLight();
  const key = w && `${w.outputId}|${w.channel}|${w.note}`;
  if (key === hub.litKey()) return;
  if (w) hub.light(w.outputId, w.note, { channel: w.channel, velocity: MIDI_LIGHT_VELOCITY });
  else hub.clearLight();
};

// A new round starts with no lit keys on the light channel.
const clearMidiLights = () => {
  if (!hub || !settings.midiEnabled || settings.midiOutput === MIDI_NO_OUTPUT) return;
  hub.clearLight();
  hub.allNotesOff(settings.midiOutput, settings.midiLightChannel);
};

const portNames = (ports) => ports.map((p) => p.name).join(', ') || 'none';

const renderMidiStatus = () => {
  let text = midiStatus;
  if (!midiSupported()) text = 'This browser has no Web MIDI.';
  else if (!settings.midiEnabled) text = 'MIDI is off.';
  else if (hub) text = `Inputs: ${portNames(hub.inputs())}. Outputs: ${portNames(hub.outputs())}.`;
  $('midi-status').textContent = text;
};

// A MIDI message is not a user gesture, so it cannot start the audio. A tap or
// click anywhere on the page starts it (unlockAudio). Then a MIDI key can start the game.
const onMidiStart = () => {
  if (audioRunning()) {
    dispatch(start);
    return;
  }
  $('start-gate').querySelector('p').textContent =
    'Click or tap the page once to turn on the sound. Then press a key on the keyboard.';
};

// Before the game, any MIDI key starts it.
const onMidiNote = (m) => {
  if (!settings.midiEnabled) return;
  if (game.phase === IDLE) onMidiStart();
  else onPianoKey(m, { fromMidi: true });
};

// Any gesture on the page starts the audio context, so that MIDI can start the game later.
const unlockAudio = () => {
  if (!audioRunning()) ensureAudio().catch(() => {});
};

// The browser can show a permission prompt. Call it again to try again after an error.
const connectMidi = () => {
  if (hub || !midiSupported()) return;
  midiStatus = 'Connecting…';
  renderMidiStatus();
  startMidi()
    .then((h) => {
      if (hub) return;
      hub = h;
      hub.setInput(settings.midiInput);
      hub.onNote(onMidiNote);
      hubHooks.forEach((fn) => fn(hub));
      hub.onPorts(() => {
        fillSettingsForm();
        renderMidiStatus();
      });
      fillSettingsForm();
      renderMidiStatus();
      render();
    })
    .catch((err) => {
      midiStatus = `MIDI does not start: ${err.message}`;
      renderMidiStatus();
    });
};

// The EZ-310 shows as "Digital Keyboard" in the port lists (tested).
const EZ310_PORT = /digital keyboard|ez-?310/i;
// The two lowest white keys of the EZ-310: C2 = Next, D2 = Play tone.
const EZ310_NEXT_KEY = 36;
const EZ310_REPLAY_KEY = 38;

// One click: the MIDI settings that work with the EZ-310 (MIDI_EZ310.md).
const onSetupEz310 = () => {
  const state = $('midi-preset-state');
  if (!midiSupported()) {
    state.textContent = 'This browser has no Web MIDI.';
    return;
  }
  state.textContent = 'Connecting…';
  applySettings({
    ...settings, midiEnabled: true, midiSilentGuess: true, midiLight: true, midiLightChannel: 1,
    midiNextKey: EZ310_NEXT_KEY, midiReplayKey: EZ310_REPLAY_KEY,
  });
  startMidi()
    .then((h) => {
      const input = h.inputs().find((p) => EZ310_PORT.test(p.name));
      const output = h.outputs().find((p) => EZ310_PORT.test(p.name));
      applySettings({
        ...settings,
        midiInput: input ? input.id : MIDI_ALL_INPUTS,
        midiOutput: output ? output.id : settings.midiOutput,
      });
      state.textContent = output
        ? `Done: ${output.name} on channel 1.`
        : 'MIDI is on, but no EZ-310 is connected. Connect it by USB, then click again.';
    })
    .catch((err) => {
      state.textContent = `MIDI does not start: ${err.message}`;
    });
};

const applyMidiSettings = () => {
  if (settings.midiEnabled) connectMidi();
  if (hub) hub.setInput(settings.midiInput);
  renderMidiStatus();
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
  kb.style.setProperty('--key-text', String(KEY_TEXT_SIZES[settings.keyTextSize]));
  keyEls.clear();
  const all = buildNoteSet({ low: settings.low, high: settings.high, whiteOnly: false });
  const whites = all.filter((m) => !isBlack(m));
  const w = 100 / whites.length;
  all.forEach((m) => {
    const black = isBlack(m);
    const el = document.createElement('div');
    el.className = `key ${black ? 'black' : 'white'}`;
    el.setAttribute('role', 'button');
    const control = controlAction(settings, m);
    if (control) {
      // A control key shows the button that it replaces, as vertical text.
      el.classList.add('control');
      el.setAttribute('aria-label', CONTROL_LABELS[control]);
      el.textContent = CONTROL_LABELS[control];
    } else {
      el.setAttribute('aria-label', label(m));
      // Show the octave only on C, so the keys stay easy to read.
      el.textContent = noteName(m, { style: settings.nameStyle, showOctave: m % 12 === 0 });
    }
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

// A stored port that is not connected now stays in the list, so the setting survives.
const portOptions = (ports, stored, first) => {
  const options = [first, ...ports.map((p) => [p.id, p.name])];
  if (!options.some(([id]) => id === stored)) options.push([stored, 'Not connected']);
  return options;
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
  $('set-key-text').value = s.keyTextSize;
  $('set-midi').value = String(s.midiEnabled);
  $('set-midi-silent').value = String(s.midiSilentGuess);
  $('set-midi-light').value = String(s.midiLight);
  fillSelect($('set-midi-input'),
    portOptions(hub ? hub.inputs() : [], s.midiInput, [MIDI_ALL_INPUTS, 'All inputs']), s.midiInput);
  fillSelect($('set-midi-output'),
    portOptions(hub ? hub.outputs() : [], s.midiOutput, [MIDI_NO_OUTPUT, 'None']), s.midiOutput);
  fillSelect($('set-midi-channel'),
    Array.from({ length: 16 }, (_, i) => [i + 1, `Channel ${i + 1}`]), s.midiLightChannel);
  const keyOptions = [['none', 'None'],
    ...buildNoteSet({ low: RANGE_MIN, high: RANGE_MAX, whiteOnly: false }).map((m) => [m, name(m)])];
  const keyValue = (k) => (k === null ? 'none' : k);
  fillSelect($('set-midi-next-key'), keyOptions, keyValue(s.midiNextKey));
  fillSelect($('set-midi-replay-key'), keyOptions, keyValue(s.midiReplayKey));
};

const keyFromForm = (id) => ($(id).value === 'none' ? null : Number($(id).value));

const readSettingsForm = () => ({
  low: Number($('set-low').value),
  high: Number($('set-high').value),
  whiteOnly: $('set-white').value === 'true',
  octaveMode: $('set-octave').value,
  nameStyle: $('set-names').value,
  playTargetOnWrong: $('set-wrong').value === 'true',
  referenceNote: $('set-reference').value === 'off' ? null : Number($('set-reference').value),
  voice: $('set-voice').value,
  keyTextSize: $('set-key-text').value,
  midiEnabled: $('set-midi').value === 'true',
  midiInput: $('set-midi-input').value,
  midiSilentGuess: $('set-midi-silent').value === 'true',
  midiLight: $('set-midi-light').value === 'true',
  midiOutput: $('set-midi-output').value,
  midiLightChannel: Number($('set-midi-channel').value),
  midiNextKey: keyFromForm('set-midi-next-key'),
  midiReplayKey: keyFromForm('set-midi-replay-key'),
});

const applySettings = (raw) => {
  settings = normalizeSettings(raw);
  saveJSON(SETTINGS_KEY, settings);
  setVoice(settings.voice);
  applyMidiSettings();
  game = configure(game, gameConfig(settings));
  buildKeyboard();
  fillSettingsForm();
  $('help-letters').textContent = helpLetters();
  renderStats();
  // The current target can drop out of the new note set. Then draw a new one.
  // Before the answer, the round has no score. After it, the score stays.
  const lost = game.target !== null && !inSet(game.target);
  if (lost && game.phase === AWAITING_GUESS) dispatch(skip);
  else if (lost && game.phase === ANSWERED) dispatch(next);
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
  onButton('midi-ez310', onSetupEz310);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', unlockAudio, true);
  document.addEventListener('keydown', unlockAudio, true);
  setupSettings();
  setupResetStats();
  renderStats();
  applyMidiSettings();
  // Turn off a lit key when the page closes.
  window.addEventListener('pagehide', () => {
    clearMidiLights();
  });
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

// ---- MIDI debug section ----

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

const describeMidi = (msg) => {
  const name = (n) => noteName(n, { style: 'international', showOctave: true });
  if (msg.type === 'noteon') return `ch ${msg.channel} note-on ${msg.note} (${name(msg.note)}) vel ${msg.velocity}`;
  if (msg.type === 'noteoff') return `ch ${msg.channel} note-off ${msg.note} (${name(msg.note)})`;
  return msg.channel ? `ch ${msg.channel} other` : 'system';
};

// Each test is [label, bytes for the light channel]. C4 = MIDI 60 (Yamaha "C3").
const DEBUG_MIDI_SENDS = [
  ['Light C4, vel 1', (ch) => [noteOnBytes(60, ch, 1)]],
  ['Light C4, vel 64', (ch) => [noteOnBytes(60, ch, 64)]],
  ['C4 off', (ch) => [noteOffBytes(60, ch)]],
  ['Volume 0 (CC 7)', (ch) => [controlChangeBytes(7, 0, ch)]],
  ['Volume 100 (CC 7)', (ch) => [controlChangeBytes(7, 100, ch)]],
  ['All notes off (CC 123)', (ch) => [controlChangeBytes(123, 0, ch)]],
];

const setupMidiDebug = () => {
  const log = $('debug-midi-log');
  const lines = [];
  const state = $('debug-midi-state');
  hubHooks.push((h) => h.onMessage((msg, portId, data) => {
    if (MIDI_LOG_HIDDEN.includes(data[0])) return;
    const port = h.inputs().find((p) => p.id === portId);
    lines.unshift(`${port ? port.name : portId}: ${hex(data)}  ${describeMidi(msg)}`);
    lines.length = Math.min(lines.length, MIDI_LOG_ROWS);
    log.textContent = lines.join('\n');
  }));
  const row = $('debug-midi');
  DEBUG_MIDI_SENDS.forEach(([text, make]) => {
    row.append(debugButton(text, () => {
      const ch = settings.midiLightChannel;
      if (!hub) {
        state.textContent = 'Turn MIDI on in Settings first.';
        return;
      }
      const ok = make(ch).every((bytes) => hub.send(settings.midiOutput, bytes));
      state.textContent = ok ? `sent on ch ${ch}` : 'Select a MIDI output in Settings first.';
    }));
  });
};

setupGame();
if (new URLSearchParams(location.search).has('debug')) setupMidiDebug();
setupDebug();
