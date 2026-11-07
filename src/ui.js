// DOM wiring: start gate, piano keyboard, buttons, banner, shortcuts,
// settings and stats panels, localStorage. It runs the effects from game.js.
// Text: t(key, params) gives the message in the current language (i18n.js).
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
import { VOICES, ensureAudio, audioReady, audioRunning, playNote, stopAll, setVoice } from './audio.js';
import {
  midiSupported, startMidi, replacementPort, noteOnBytes, noteOffBytes, controlChangeBytes,
} from './midi.js';
import { pickLanguage, translate } from './i18n.js';
import {
  REFERENCE_NOTES, KEY_TEXT_SIZES, MIDI_ALL_INPUTS, MIDI_NO_OUTPUT, RANGE_MIN, RANGE_MAX, LANGUAGE_AUTO,
  controlAction, rangeEndpoints, normalizeSettings, normalizeStats, gameConfig,
} from './settings.js';

const SETTINGS_KEY = 'ear-trainer.settings.v1';
const STATS_KEY = 'ear-trainer.stats.v1';
const KEY_FLASH_MS = 150;
const RESET_ARM_MS = 4000;
// A MIDI control key acts at its note-off, after this delay. The keyboard
// sounds the key by itself, and its sound must stop before the target plays.
const MIDI_CONTROL_DELAY_MS = 250;
// A control key acts after this time also with no note-off, in case the note-off is lost.
const MIDI_CONTROL_HOLD_MS = 1500;
// After a MIDI key, the audio has this time to start again. Then the banner asks for a tap.
const AUDIO_RESUME_MS = 300;
const REJECT_FLASH_MS = 700;
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

// The browser languages. navigator.languages can be missing or empty.
const browserLanguages = () => {
  try {
    const list = navigator.languages;
    return list && list.length ? [...list] : [navigator.language];
  } catch {
    return [];
  }
};

// A phone screen. The same width as the CSS media query in index.html.
const NARROW_SCREEN = '(max-width: 700px)';
// One octave, C4-C5, fits on a phone.
const NARROW_HIGH = 72;

const narrowScreen = () => {
  try {
    return window.matchMedia(NARROW_SCREEN).matches;
  } catch {
    return false;
  }
};

// First visit (no stored settings): the note names follow the browser language.
// A phone gets a one-octave range. Stored settings do not change.
const firstVisitSettings = () => ({
  nameStyle: pickLanguage(browserLanguages()) === 'en' ? 'international' : 'central',
  ...(narrowScreen() ? { high: NARROW_HIGH } : {}),
});

const storedSettings = loadJSON(SETTINGS_KEY);
let settings = normalizeSettings(storedSettings === null ? firstVisitSettings() : storedSettings);
let game = createGame({ ...gameConfig(settings), stats: normalizeStats(loadJSON(STATS_KEY)) });
const keyEls = new Map(); // midi -> key element
let hub = null; // the MIDI hub, after startMidi() succeeds
let midiStatus = '';
// A short message in the banner in place of the normal text: {key, params}.
// Any game action removes it.
let bannerHint = null;
const hubHooks = []; // run once, when the hub starts

const language = () =>
  (settings.language === LANGUAGE_AUTO ? pickLanguage(browserLanguages()) : settings.language);

const t = (key, params) => translate(language(), key, params);

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
  bannerHint = null;
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
      $('start-gate').querySelector('p').textContent = t('audio.error', { error: err.message });
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
const CONTROL_LABELS = { next: 'btn.next', replay: 'btn.playTone' };

const runControl = (control) => {
  if (control === 'next') onNext();
  else onReplayTarget();
};

// MIDI control keys pressed and not yet released: note -> fallback timer.
const heldControls = new Map();

// A control key acts at its note-off. If no note-off comes, it acts after MIDI_CONTROL_HOLD_MS.
const holdControl = (m) => {
  clearTimeout(heldControls.get(m));
  heldControls.set(m, setTimeout(() => {
    heldControls.delete(m);
    const control = controlAction(settings, m);
    if (control && game.phase !== IDLE) runControl(control);
  }, MIDI_CONTROL_HOLD_MS));
};

// The full name of a note, also for a note outside the range.
const fullName = (m) => noteName(m, { style: settings.nameStyle, showOctave: true });

// A key that is not in the game, before the answer: a hint, and the keyboard frame flashes.
const rejectKey = (m) => {
  bannerHint = {
    key: 'hint.notInSet',
    params: {
      note: fullName(m), low: fullName(settings.low), high: fullName(settings.high),
      notes: t(settings.whiteOnly ? 'hint.whiteKeys' : 'hint.allNotes'),
    },
  };
  const frame = $('keyboard-scroll');
  frame.classList.remove('reject');
  void frame.offsetWidth; // start the animation again
  frame.classList.add('reject');
  setTimeout(() => frame.classList.remove('reject'), REJECT_FLASH_MS);
  render();
};

const onPianoKey = (m, { fromMidi = false } = {}) => {
  const control = controlAction(settings, m);
  if (control) {
    flash(m);
    if (fromMidi) holdControl(m);
    else runControl(control);
    return;
  }
  const mute = fromMidi && settings.midiSilentGuess ? m : null;
  if (game.phase === AWAITING_GUESS) {
    if (!inSet(m)) {
      rejectKey(m); // dimmed keys and keys outside the range do not guess
      return;
    }
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
  if (phase === AWAITING_GUESS) return ['', t('banner.question')];
  if (phase !== ANSWERED) return ['', ''];
  return result.correct
    ? ['ok', t('banner.correct', { note: label(result.guess) })]
    : ['bad', t('banner.wrong', { guess: label(result.guess), target: label(result.target) })];
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
    ? t('score', { correct: session.correct, total: session.total, streak: session.streak })
    : '';

  const [cls, text] = bannerHint ? ['hint', t(bannerHint.key, bannerHint.params)] : bannerText(game);
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

const portNames = (ports) => ports.map((p) => p.name).join(', ') || t('midi.portsNone');

const renderMidiStatus = () => {
  let text = midiStatus;
  if (!midiSupported()) text = t('midi.noWebMidi');
  else if (!settings.midiEnabled) text = t('midi.off');
  else if (hub) text = t('midi.ports', { inputs: portNames(hub.inputs()), outputs: portNames(hub.outputs()) });
  $('midi-status').textContent = text;
};

// A MIDI message is not a user gesture, so it cannot start the audio. A tap or
// click anywhere on the page starts it (unlockAudio). Then a MIDI key can start the game.
const onMidiStart = () => {
  if (audioRunning()) {
    dispatch(start);
    return;
  }
  $('start-gate').querySelector('p').textContent = t('midi.unlock');
};

// Android suspends the audio in the background. A MIDI message is not a user
// gesture, but Chrome lets a page that had a gesture before resume its audio.
const resumeAudio = () => {
  if (audioReady() && !audioRunning()) ensureAudio().catch(() => {});
};

// If the audio does not start again after a MIDI key, ask for a tap.
const checkAudioAfterMidi = () => {
  if (audioRunning()) return;
  resumeAudio();
  setTimeout(() => {
    if (audioRunning() || game.phase === IDLE) return;
    bannerHint = { key: 'hint.tapForSound', params: {} };
    render();
  }, AUDIO_RESUME_MS);
};

// Before the game, any MIDI key starts it.
const onMidiNote = (m) => {
  if (!settings.midiEnabled) return;
  if (game.phase === IDLE) {
    onMidiStart();
    return;
  }
  checkAudioAfterMidi();
  onPianoKey(m, { fromMidi: true });
};

// A held control key acts at its release.
const onMidiNoteOff = (m) => {
  if (!heldControls.has(m)) return;
  clearTimeout(heldControls.get(m));
  heldControls.delete(m);
  const control = controlAction(settings, m);
  if (control && game.phase !== IDLE) setTimeout(() => runControl(control), MIDI_CONTROL_DELAY_MS);
};

// Any gesture on the page starts the audio context, so that MIDI can start the game later.
// The tap-for-sound hint goes away when the audio runs.
const unlockAudio = () => {
  if (audioRunning()) return;
  ensureAudio()
    .then(() => {
      if (bannerHint && bannerHint.key === 'hint.tapForSound') {
        bannerHint = null;
        render();
      }
    })
    .catch(() => {});
};

// The browser can show a permission prompt. Call it again to try again after an error.
const connectMidi = () => {
  if (hub || !midiSupported()) return;
  midiStatus = t('midi.connecting');
  renderMidiStatus();
  startMidi()
    .then((h) => {
      if (hub) return;
      hub = h;
      hub.setInput(settings.midiInput);
      hub.onNote(onMidiNote);
      hub.onNoteOff(onMidiNoteOff);
      hubHooks.forEach((fn) => fn(hub));
      hub.onPorts(onMidiPorts);
      adoptEz310Ports();
      fillSettingsForm();
      renderMidiStatus();
      render();
    })
    .catch((err) => {
      midiStatus = t('midi.error', { error: err.message });
      renderMidiStatus();
    });
};

// The EZ-310 shows as "Digital Keyboard" in the port lists (tested).
const EZ310_PORT = /digital keyboard|ez-?310/i;
// The two lowest white keys of the EZ-310: C2 = Next, D2 = Play tone.
const EZ310_NEXT_KEY = 36;
const EZ310_REPLAY_KEY = 38;

// A stored EZ-310 port id can be stale after a reconnect. Then use the
// connected port with the EZ-310 name, and store its id.
const adoptEz310Ports = () => {
  if (!hub) return;
  const s = settings;
  const input = s.midiInput === MIDI_ALL_INPUTS ? null : replacementPort(s.midiInput, hub.inputs(), EZ310_PORT);
  const output = s.midiOutput === MIDI_NO_OUTPUT ? null : replacementPort(s.midiOutput, hub.outputs(), EZ310_PORT);
  if (input === null && output === null) return;
  applySettings({ ...s, midiInput: input ?? s.midiInput, midiOutput: output ?? s.midiOutput });
};

// After a port change, the keyboard can have lost the light. Send it again.
const onMidiPorts = () => {
  adoptEz310Ports();
  hub.clearLight();
  syncMidiLight();
  fillSettingsForm();
  renderMidiStatus();
};

// ---- landscape (phone) ----

// Chrome on Android locks the orientation only in full screen. Desktop
// browsers cannot lock it, so the button shows only on a touch screen.
const canLockLandscape = () => {
  try {
    return typeof document.documentElement.requestFullscreen === 'function'
      && typeof screen.orientation === 'object' && typeof screen.orientation.lock === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
};

const renderLandscapeButton = () => {
  const btn = $('landscape');
  btn.hidden = !canLockLandscape();
  btn.textContent = t(document.fullscreenElement ? 'btn.exitFullscreen' : 'btn.landscape');
};

// The status line under the title shows an error.
const onLandscape = () => {
  if (document.fullscreenElement) {
    try {
      screen.orientation.unlock();
    } catch {
      // Nothing is locked.
    }
    document.exitFullscreen().catch(() => {});
    return;
  }
  document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation.lock('landscape'))
    .catch((err) => {
      $('midi-preset-state').textContent = t('landscape.error', { error: err.message });
    });
};

// One click: the MIDI settings that work with the EZ-310 (MIDI_EZ310.md).
const onSetupEz310 = () => {
  const state = $('midi-preset-state');
  if (!midiSupported()) {
    state.textContent = t('midi.noWebMidi');
    return;
  }
  state.textContent = t('midi.connecting');
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
        ? t('ez310.done', { name: output.name })
        : t('ez310.missing');
    })
    .catch((err) => {
      state.textContent = t('midi.error', { error: err.message });
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
    p.textContent = t('stats.empty');
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
      className: 'muted', textContent: t('stats.noneYet'),
    }));
    return div;
  };
  const cols = document.createElement('div');
  cols.className = 'stats-cols';
  cols.append(
    column(t('stats.weakest'), weak.map((w) => t('stats.noteLine', {
      note: label(w.midi), correct: w.correct, attempts: w.attempts, percent: Math.round(w.accuracy * 100),
    }))),
    column(t('stats.confusions'), conf.map((c) =>
      t('stats.confusionLine', { target: label(c.target), guess: label(c.guess), count: c.count }))),
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
  kb.style.setProperty('--whites', String(whites.length));
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
      el.setAttribute('aria-label', t(CONTROL_LABELS[control]));
      el.textContent = t(CONTROL_LABELS[control]);
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

// The help message has the parameters {Space}, {R}, ... for keys, and {letters}.
// Each key parameter becomes a <kbd> element. No HTML comes from the message.
const renderHelp = () => {
  const help = $('help');
  help.textContent = '';
  t('help').split(/\{(\w+)\}/).forEach((part, i) => {
    if (i % 2 === 0) {
      help.append(part);
    } else if (part === 'letters') {
      help.append(Object.assign(document.createElement('span'), { id: 'help-letters', textContent: helpLetters() }));
    } else {
      help.append(Object.assign(document.createElement('kbd'), { textContent: part }));
    }
  });
};

// The static text in index.html: data-i18n (text), data-i18n-title, data-i18n-aria.
const renderStaticText = () => {
  document.documentElement.lang = language();
  document.title = t('app.title');
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  renderHelp();
  renderLandscapeButton();
};

// ---- settings panel ----

const fillSelect = (el, options, value) => {
  el.textContent = '';
  options.forEach(([v, text]) => el.add(new Option(text, String(v))));
  el.value = String(value);
};

// A stored port that is not connected now stays in the list, so the setting survives.
const portOptions = (ports, stored, first) => {
  const options = [first, ...ports.map((p) => [p.id, p.name])];
  if (!options.some(([id]) => id === stored)) options.push([stored, t('port.notConnected')]);
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
    [['off', t('opt.off')], ...REFERENCE_NOTES.map((m) => [m, t('ref.then', { note: name(m) })])],
    s.referenceNote === null ? 'off' : s.referenceNote);
  $('set-language').value = s.language;
  $('set-white').value = String(s.whiteOnly);
  $('set-octave').value = s.octaveMode;
  $('set-names').value = s.nameStyle;
  $('set-wrong').value = String(s.playTargetOnWrong);
  $('set-voice').value = s.voice;
  $('set-key-text').value = s.keyTextSize;
  $('set-midi').value = String(s.midiEnabled);
  // The other MIDI settings show only when MIDI is on.
  $('midi-details').hidden = !s.midiEnabled;
  $('set-midi-silent').value = String(s.midiSilentGuess);
  $('set-midi-light').value = String(s.midiLight);
  fillSelect($('set-midi-input'),
    portOptions(hub ? hub.inputs() : [], s.midiInput, [MIDI_ALL_INPUTS, t('port.allInputs')]), s.midiInput);
  fillSelect($('set-midi-output'),
    portOptions(hub ? hub.outputs() : [], s.midiOutput, [MIDI_NO_OUTPUT, t('opt.none')]), s.midiOutput);
  fillSelect($('set-midi-channel'),
    Array.from({ length: 16 }, (_, i) => [i + 1, t('midi.channel', { n: i + 1 })]), s.midiLightChannel);
  const keyOptions = [['none', t('opt.none')],
    ...buildNoteSet({ low: RANGE_MIN, high: RANGE_MAX, whiteOnly: false }).map((m) => [m, name(m)])];
  const keyValue = (k) => (k === null ? 'none' : k);
  fillSelect($('set-midi-next-key'), keyOptions, keyValue(s.midiNextKey));
  fillSelect($('set-midi-replay-key'), keyOptions, keyValue(s.midiReplayKey));
};

const keyFromForm = (id) => ($(id).value === 'none' ? null : Number($(id).value));

const readSettingsForm = () => ({
  language: $('set-language').value,
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
  renderStaticText();
  applyMidiSettings();
  game = configure(game, gameConfig(settings));
  buildKeyboard();
  fillSettingsForm();
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
    btn.textContent = t('btn.resetStats');
  };
  btn.addEventListener('click', () => {
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = t('btn.resetConfirm');
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
  renderStaticText();
  buildKeyboard();
  onButton('start', onStart);
  onButton('play-target', onReplayTarget);
  onButton('play-guess', onReplayGuess);
  onButton('next', onNext);
  onButton('midi-ez310', onSetupEz310);
  onButton('landscape', onLandscape);
  document.addEventListener('fullscreenchange', renderLandscapeButton);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', unlockAudio, true);
  document.addEventListener('keydown', unlockAudio, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeAudio();
  });
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
