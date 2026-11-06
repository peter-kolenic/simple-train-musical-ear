import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, RANGE_MIN, RANGE_MAX, rangeEndpoints,
  normalizeSettings, normalizeStats, noteSetFor, gameConfig,
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
    playTargetOnWrong: false, referenceNote: 69, voice: 'sine',
  };
  assert.deepEqual(normalizeSettings(s), s);
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
