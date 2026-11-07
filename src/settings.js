// Pure settings: defaults, validation of stored data, and the game config.
// No DOM and no storage. The UI reads and writes localStorage.
import { buildNoteSet } from './music.js';
import { emptyStats } from './game.js';
import { VOICES } from './audio.js';

export const RANGE_MIN = 36; // C2
export const RANGE_MAX = 96; // C7
export const REFERENCE_NOTES = [48, 60, 69, 72]; // C3, C4, A4, C5
export const OCTAVE_MODES = ['exact', 'pitchClass'];
export const NAME_STYLES = ['central', 'international'];
// Text size on the piano keys: a factor of the base size.
export const KEY_TEXT_SIZES = { small: 0.8, normal: 1, large: 1.3, xlarge: 1.6 };
export const MIDI_ALL_INPUTS = 'all';
export const MIDI_NO_OUTPUT = '';

export const DEFAULT_SETTINGS = {
  low: 60,
  high: 84,
  whiteOnly: true,
  octaveMode: 'exact',
  nameStyle: 'central',
  playTargetOnWrong: true,
  referenceNote: null,
  voice: 'piano-ish',
  keyTextSize: 'normal',
  midiEnabled: false,
  midiInput: MIDI_ALL_INPUTS,
  midiSilentGuess: true, // the keyboard sounds by itself
  midiLight: false, // experimental: light the correct key after a wrong answer
  midiOutput: MIDI_NO_OUTPUT,
  midiLightChannel: 1,
  // Control keys: a key that acts as a button. null = none.
  midiNextKey: null,
  midiReplayKey: null,
};

// Range endpoints are white keys, so the keyboard starts and ends with a white key.
export const rangeEndpoints = () =>
  buildNoteSet({ low: RANGE_MIN, high: RANGE_MAX, whiteOnly: true });

const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
// A Web MIDI port id is a browser-made string. Any short string can be valid.
const validPortId = (v, fallback) => (typeof v === 'string' && v.length <= 256 ? v : fallback);
const validChannel = (v, fallback) => (Number.isInteger(v) && v >= 1 && v <= 16 ? v : fallback);
const validKey = (v) => (Number.isInteger(v) && v >= 0 && v <= 127 ? v : null);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Any input gives a valid settings object. Bad fields get the default value.
export const normalizeSettings = (raw) => {
  const r = isObject(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  const ends = rangeEndpoints();
  let low = oneOf(r.low, ends, d.low);
  let high = oneOf(r.high, ends, d.high);
  if (low >= high) [low, high] = [d.low, d.high];
  return {
    low,
    high,
    whiteOnly: bool(r.whiteOnly, d.whiteOnly),
    octaveMode: oneOf(r.octaveMode, OCTAVE_MODES, d.octaveMode),
    nameStyle: oneOf(r.nameStyle, NAME_STYLES, d.nameStyle),
    playTargetOnWrong: bool(r.playTargetOnWrong, d.playTargetOnWrong),
    referenceNote: r.referenceNote === null ? null : oneOf(r.referenceNote, REFERENCE_NOTES, d.referenceNote),
    voice: oneOf(r.voice, VOICES, d.voice),
    keyTextSize: oneOf(r.keyTextSize, Object.keys(KEY_TEXT_SIZES), d.keyTextSize),
    midiEnabled: bool(r.midiEnabled, d.midiEnabled),
    midiInput: validPortId(r.midiInput, d.midiInput) || d.midiInput,
    midiSilentGuess: bool(r.midiSilentGuess, d.midiSilentGuess),
    midiLight: bool(r.midiLight, d.midiLight),
    midiOutput: validPortId(r.midiOutput, d.midiOutput),
    midiLightChannel: validChannel(r.midiLightChannel, d.midiLightChannel),
    midiNextKey: validKey(r.midiNextKey),
    // One key cannot have two actions. Next wins.
    midiReplayKey: validKey(r.midiReplayKey) === validKey(r.midiNextKey) ? null : validKey(r.midiReplayKey),
  };
};

// The control keys in use: only with MIDI on.
export const controlKeys = (s) =>
  (s.midiEnabled ? { next: s.midiNextKey, replay: s.midiReplayKey } : { next: null, replay: null });

// 'next', 'replay', or null for a normal key.
export const controlAction = (s, note) => {
  const k = controlKeys(s);
  if (note === k.next) return 'next';
  if (note === k.replay) return 'replay';
  return null;
};

const count = (v) => Number.isInteger(v) && v >= 0;
const midiKey = (k) => /^\d{1,3}$/.test(k);

// Stored stats with bad entries removed. Bad input gives empty stats.
export const normalizeStats = (raw) => {
  if (!isObject(raw) || !isObject(raw.notes) || !isObject(raw.confusions)) return emptyStats();
  const notes = Object.fromEntries(
    Object.entries(raw.notes).filter(([k, s]) =>
      midiKey(k) && isObject(s) && count(s.attempts) && count(s.correct) && s.correct <= s.attempts));
  const confusions = Object.fromEntries(
    Object.entries(raw.confusions)
      .filter(([k, row]) => midiKey(k) && isObject(row))
      .map(([k, row]) => [k, Object.fromEntries(
        Object.entries(row).filter(([g, n]) => midiKey(g) && count(n) && n > 0))])
      .filter(([, row]) => Object.keys(row).length > 0));
  return { notes, confusions };
};

// The control keys are never a target. If no note is left, the control keys stay in the set.
export const noteSetFor = (s) => {
  const all = buildNoteSet({ low: s.low, high: s.high, whiteOnly: s.whiteOnly });
  const rest = all.filter((m) => controlAction(s, m) === null);
  return rest.length > 0 ? rest : all;
};

// The part of the settings that game.js uses.
export const gameConfig = (s) => ({
  noteSet: noteSetFor(s),
  octaveMode: s.octaveMode,
  playTargetOnWrong: s.playTargetOnWrong,
  referenceNote: s.referenceNote,
});
