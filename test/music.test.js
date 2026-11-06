import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  midiToFreq, noteName, isBlack, buildNoteSet, matches,
  pitchClass, octaveOf, spansOctaves,
} from '../src/music.js';

test('midiToFreq: A4 = 440 Hz', () => {
  assert.equal(midiToFreq(69), 440);
});

test('midiToFreq: C4 ≈ 261.626 Hz', () => {
  assert.ok(Math.abs(midiToFreq(60) - 261.626) <= 0.001);
});

test('midiToFreq: A5 = 2 · A4', () => {
  assert.equal(midiToFreq(81), 2 * midiToFreq(69));
});

test('pitchClass and octaveOf', () => {
  assert.equal(pitchClass(60), 0);
  assert.equal(pitchClass(71), 11);
  assert.equal(pitchClass(-1), 11);
  assert.equal(octaveOf(60), 4);
  assert.equal(octaveOf(59), 3);
  assert.equal(octaveOf(21), 0);
});

test('isBlack', () => {
  const blacks = [61, 63, 66, 68, 70];
  for (let m = 60; m <= 71; m++) assert.equal(isBlack(m), blacks.includes(m), `midi ${m}`);
});

test('noteName: central European (default)', () => {
  const got = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71].map((m) => noteName(m));
  assert.deepEqual(got, ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'B', 'H']);
});

test('noteName: international', () => {
  const got = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]
    .map((m) => noteName(m, { style: 'international' }));
  assert.deepEqual(got, ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']);
});

test('noteName: 71 and 70 in both styles', () => {
  assert.equal(noteName(71, { style: 'central' }), 'H');
  assert.equal(noteName(71, { style: 'international' }), 'B');
  assert.equal(noteName(70, { style: 'central' }), 'B');
  assert.equal(noteName(70, { style: 'international' }), 'A♯');
});

test('noteName: octave numbers', () => {
  assert.equal(noteName(60, { showOctave: true }), 'C4');
  assert.equal(noteName(71, { showOctave: true }), 'H4');
  assert.equal(noteName(72, { style: 'international', showOctave: true }), 'C5');
  assert.equal(noteName(58, { style: 'international', showOctave: true }), 'A♯3');
});

test('noteName: unknown style throws', () => {
  assert.throws(() => noteName(60, { style: 'klingon' }));
});

test('spansOctaves', () => {
  assert.equal(spansOctaves(60, 71), false);
  assert.equal(spansOctaves(60, 72), true);
  assert.equal(spansOctaves(59, 60), true);
});

test('buildNoteSet: default is white keys C4–B4', () => {
  assert.deepEqual(buildNoteSet(), [60, 62, 64, 65, 67, 69, 71]);
});

test('buildNoteSet: chromatic', () => {
  assert.deepEqual(buildNoteSet({ low: 60, high: 64, whiteOnly: false }), [60, 61, 62, 63, 64]);
});

test('buildNoteSet: white only over two octaves', () => {
  const set = buildNoteSet({ low: 48, high: 71, whiteOnly: true });
  assert.equal(set.length, 14);
  assert.ok(set.every((m) => !isBlack(m)));
});

test('buildNoteSet: white only, black-only range is empty', () => {
  assert.deepEqual(buildNoteSet({ low: 61, high: 61, whiteOnly: true }), []);
});

test('buildNoteSet: bad range throws', () => {
  assert.throws(() => buildNoteSet({ low: 72, high: 60 }));
  assert.throws(() => buildNoteSet({ low: 60.5, high: 72 }));
});

test('matches: exact', () => {
  assert.equal(matches(64, 64), true);
  assert.equal(matches(64, 76), false);
  assert.equal(matches(64, 65, 'exact'), false);
});

test('matches: pitch class across octaves', () => {
  assert.equal(matches(64, 76, 'pitchClass'), true);
  assert.equal(matches(64, 52, 'pitchClass'), true);
  assert.equal(matches(64, 40, 'pitchClass'), true);
  assert.equal(matches(64, 65, 'pitchClass'), false);
  assert.equal(matches(60, 71, 'pitchClass'), false);
});

test('matches: unknown mode throws', () => {
  assert.throws(() => matches(60, 60, 'fuzzy'));
});
