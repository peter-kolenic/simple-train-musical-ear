import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, RANGE_MIN, RANGE_MAX, rangeEndpoints,
  normalizeSettings, normalizeStats, noteSetFor, gameConfig, controlKeys, controlAction,
} from '../src/settings.js';
import { emptyStats } from '../src/game.js';
import { isBlack } from '../src/music.js';

test('normalizeSettings: bad input gives the defaults', () => {
  for (const raw of [undefined, null, 'x', 42, [], {}]) {
    assert.deepEqual(normalizeSettings(raw), DEFAULT_SETTINGS);
  }
});

test('normalizeSettings keeps valid fields', () => {
  const s = {
    low: 48, high: 72, whiteOnly: false, octaveMode: 'pitchClass', nameStyle: 'international',
    playTargetOnWrong: false, referenceNote: 69, voice: 'sine', keyTextSize: 'xlarge',
    midiEnabled: true, midiInput: 'port-a', midiSilentGuess: false, midiLight: true,
    midiOutput: 'port-b', midiLightChannel: 16, midiNextKey: 36, midiReplayKey: 38,
  };
  assert.deepEqual(normalizeSettings(s), s);
});

test('normalizeSettings: key text size', () => {
  assert.equal(DEFAULT_SETTINGS.keyTextSize, 'normal');
  assert.equal(normalizeSettings({ keyTextSize: 'large' }).keyTextSize, 'large');
  assert.equal(normalizeSettings({ keyTextSize: 'huge' }).keyTextSize, 'normal');
  assert.equal(normalizeSettings({ keyTextSize: 1.3 }).keyTextSize, 'normal');
});

test('normalizeSettings: control keys', () => {
  assert.equal(DEFAULT_SETTINGS.midiNextKey, null);
  assert.equal(DEFAULT_SETTINGS.midiReplayKey, null);
  const s = normalizeSettings({ midiNextKey: 128, midiReplayKey: 'x' });
  assert.deepEqual([s.midiNextKey, s.midiReplayKey], [null, null]);
  const same = normalizeSettings({ midiNextKey: 40, midiReplayKey: 40 });
  assert.deepEqual([same.midiNextKey, same.midiReplayKey], [40, null]); // Next wins
  assert.equal(normalizeSettings({ midiReplayKey: 0 }).midiReplayKey, 0);
});

test('controlKeys and controlAction work only with MIDI on', () => {
  const on = { ...DEFAULT_SETTINGS, midiEnabled: true, midiNextKey: 36, midiReplayKey: 38 };
  assert.deepEqual(controlKeys(on), { next: 36, replay: 38 });
  assert.equal(controlAction(on, 36), 'next');
  assert.equal(controlAction(on, 38), 'replay');
  assert.equal(controlAction(on, 60), null);
  assert.equal(controlAction({ ...on, midiEnabled: false }, 36), null);
  assert.equal(controlAction(DEFAULT_SETTINGS, 60), null);
});

test('noteSetFor never includes the control keys', () => {
  const s = { ...DEFAULT_SETTINGS, low: 36, high: 48, midiEnabled: true, midiNextKey: 36, midiReplayKey: 38 };
  const set = noteSetFor(s);
  assert.ok(!set.includes(36) && !set.includes(38));
  assert.deepEqual(set, [40, 41, 43, 45, 47, 48]);
  assert.deepEqual(gameConfig(s).noteSet, set);
  assert.ok(noteSetFor({ ...s, midiEnabled: false }).includes(36)); // MIDI off: normal keys
  // A range of only control keys keeps them, so the game still has notes.
  assert.deepEqual(noteSetFor({ ...s, low: 36, high: 38 }), [36, 38]);
});

test('normalizeSettings: MIDI fields', () => {
  assert.equal(DEFAULT_SETTINGS.midiEnabled, false);
  assert.equal(DEFAULT_SETTINGS.midiSilentGuess, true);
  assert.equal(DEFAULT_SETTINGS.midiLight, false);
  const s = normalizeSettings({
    midiEnabled: 1, midiInput: '', midiOutput: 7, midiLightChannel: 17, midiSilentGuess: 'no',
  });
  assert.equal(s.midiEnabled, false);
  assert.equal(s.midiInput, 'all'); // an empty input id means all inputs
  assert.equal(s.midiOutput, ''); // no output
  assert.equal(s.midiLightChannel, 1);
  assert.equal(s.midiSilentGuess, true);
  assert.equal(normalizeSettings({ midiLightChannel: 0 }).midiLightChannel, 1);
  assert.equal(normalizeSettings({ midiOutput: 'x'.repeat(300) }).midiOutput, '');
});

test('normalizeSettings replaces bad fields one by one', () => {
  const s = normalizeSettings({ whiteOnly: 'yes', octaveMode: 'loose', voice: 'organ', referenceNote: 61, low: 62 });
  assert.equal(s.whiteOnly, true);
  assert.equal(s.octaveMode, 'exact');
  assert.equal(s.voice, 'piano-ish');
  assert.equal(s.referenceNote, null);
  assert.equal(s.low, 62); // D4 is a white key
});

test('normalizeSettings: range endpoints must be white keys with low < high', () => {
  assert.equal(normalizeSettings({ low: 61 }).low, 60); // C♯4 is black
  assert.equal(normalizeSettings({ high: 120 }).high, 84); // out of range
  const swapped = normalizeSettings({ low: 72, high: 60 });
  assert.deepEqual([swapped.low, swapped.high], [60, 84]);
  assert.deepEqual([normalizeSettings({ low: 84, high: 84 }).low], [60]);
});

test('rangeEndpoints are white keys from C2 to C7', () => {
  const ends = rangeEndpoints();
  assert.equal(ends[0], RANGE_MIN);
  assert.equal(ends.at(-1), RANGE_MAX);
  assert.ok(ends.every((m) => !isBlack(m)));
});

test('noteSetFor and gameConfig', () => {
  assert.equal(noteSetFor(DEFAULT_SETTINGS).length, 15);
  assert.equal(noteSetFor({ ...DEFAULT_SETTINGS, whiteOnly: false }).length, 25);
  assert.deepEqual(gameConfig({ ...DEFAULT_SETTINGS, low: 60, high: 64 }), {
    noteSet: [60, 62, 64], octaveMode: 'exact', playTargetOnWrong: true, referenceNote: null,
  });
});

test('normalizeStats: bad input gives empty stats', () => {
  for (const raw of [undefined, null, 'x', [], {}, { notes: {} }, { notes: [], confusions: {} }]) {
    assert.deepEqual(normalizeStats(raw), emptyStats());
  }
});

test('normalizeStats keeps valid entries and drops bad ones', () => {
  const raw = {
    notes: {
      64: { attempts: 5, correct: 3 },
      65: { attempts: 2, correct: 3 }, // correct > attempts
      66: { attempts: -1, correct: 0 },
      x: { attempts: 1, correct: 1 },
    },
    confusions: {
      64: { 65: 2, 66: 0, 67: 'a' },
      70: { 71: 0 },
      y: { 60: 1 },
    },
  };
  assert.deepEqual(normalizeStats(raw), {
    notes: { 64: { attempts: 5, correct: 3 } },
    confusions: { 64: { 65: 2 } },
  });
});

test('normalizeStats survives a JSON round trip', () => {
  const stats = { notes: { 60: { attempts: 3, correct: 1 } }, confusions: { 60: { 62: 2 } } };
  assert.deepEqual(normalizeStats(JSON.parse(JSON.stringify(stats))), stats);
});
