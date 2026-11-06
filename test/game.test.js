import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNoteSet } from '../src/music.js';
import {
  IDLE, AWAITING_GUESS, ANSWERED, WRONG_TARGET_DELAY, REFERENCE_DELAY,
  seededRng, emptyStats, recordAnswer, weakestNotes, topConfusions,
  createGame, configure, pickTarget,
  start, next, skip, replayTarget, guess, replayGuess, explore, resetSession, resetStats,
} from '../src/game.js';

const NOTES = buildNoteSet(); // white keys C4–C6
const E4 = 64;
const F4 = 65;
const E5 = 76;

// A game with a fixed target, in AWAITING_GUESS.
const awaiting = (target = E4, config = {}) => ({
  ...createGame({ noteSet: NOTES, rng: seededRng(1), ...config }),
  phase: AWAITING_GUESS,
  target,
});

test('createGame starts in IDLE with an empty session', () => {
  const s = createGame({ noteSet: NOTES });
  assert.equal(s.phase, IDLE);
  assert.equal(s.target, null);
  assert.deepEqual(s.session, { correct: 0, total: 0, streak: 0 });
  assert.deepEqual(s.stats, emptyStats());
});

test('start picks a target from the note set and plays it', () => {
  const { state, effects } = start(createGame({ noteSet: NOTES, rng: seededRng(7) }));
  assert.equal(state.phase, AWAITING_GUESS);
  assert.ok(NOTES.includes(state.target));
  assert.deepEqual(effects, [{ type: 'play', midi: state.target, delay: 0 }]);
});

test('actions do not change the input state', () => {
  const s = awaiting();
  const snapshot = structuredClone({ ...s, config: { ...s.config, rng: null } });
  guess(s, F4);
  assert.deepEqual({ ...s, config: { ...s.config, rng: null } }, snapshot);
});

test('illegal transitions are rejected', () => {
  const idle = createGame({ noteSet: NOTES });
  const waiting = awaiting();
  const answered = guess(waiting, E4).state;

  assert.throws(() => guess(answered, E4), /guess\(\) is not allowed in ANSWERED/);
  assert.throws(() => next(waiting), /next\(\) is not allowed in AWAITING_GUESS/);
  assert.throws(() => next(idle), /not allowed in IDLE/);
  assert.throws(() => guess(idle, E4), /not allowed in IDLE/);
  assert.throws(() => start(waiting), /not allowed in AWAITING_GUESS/);
  assert.throws(() => start(answered), /not allowed in ANSWERED/);
  assert.throws(() => replayTarget(idle), /not allowed in IDLE/);
  assert.throws(() => replayGuess(waiting), /not allowed in AWAITING_GUESS/);
  assert.throws(() => explore(waiting, E4), /not allowed in AWAITING_GUESS/);
  assert.throws(() => explore(idle, E4), /not allowed in IDLE/);
});

test('guess outside the note set is rejected', () => {
  assert.throws(() => guess(awaiting(), 61), /not in the note set/);
});

test('correct guess: scores, plays the guess, shows the result', () => {
  const { state, effects } = guess(awaiting(E4), E4);
  assert.equal(state.phase, ANSWERED);
  assert.deepEqual(state.session, { correct: 1, total: 1, streak: 1 });
  const result = { correct: true, target: E4, guess: E4 };
  assert.deepEqual(state.result, result);
  assert.deepEqual(effects, [
    { type: 'play', midi: E4, delay: 0 },
    { type: 'show', result },
  ]);
});

test('wrong guess: also plays the target after a delay (setting on)', () => {
  const { state, effects } = guess(awaiting(E4), F4);
  assert.deepEqual(state.session, { correct: 0, total: 1, streak: 0 });
  const result = { correct: false, target: E4, guess: F4 };
  assert.deepEqual(effects, [
    { type: 'play', midi: F4, delay: 0 },
    { type: 'play', midi: E4, delay: WRONG_TARGET_DELAY },
    { type: 'show', result },
  ]);
});

test('wrong guess: only the guess plays (setting off)', () => {
  const { effects } = guess(awaiting(E4, { playTargetOnWrong: false }), F4);
  assert.deepEqual(effects, [
    { type: 'play', midi: F4, delay: 0 },
    { type: 'show', result: { correct: false, target: E4, guess: F4 } },
  ]);
});

test('octave mode: pitch class accepts the same note in another octave', () => {
  assert.equal(guess(awaiting(E4), E5).state.result.correct, false);
  assert.equal(guess(awaiting(E4, { octaveMode: 'pitchClass' }), E5).state.result.correct, true);
});

test('replayTarget plays the target and keeps the state', () => {
  for (const s of [awaiting(E4), guess(awaiting(E4), F4).state]) {
    const { state, effects } = replayTarget(s);
    assert.equal(state, s);
    assert.deepEqual(effects, [{ type: 'play', midi: E4, delay: 0 }]);
  }
});

test('reference tone plays before the target', () => {
  const s = awaiting(E4, { referenceNote: 60 });
  const expected = [
    { type: 'play', midi: 60, delay: 0 },
    { type: 'play', midi: E4, delay: REFERENCE_DELAY },
  ];
  assert.deepEqual(replayTarget(s).effects, expected);
  const started = start(createGame({ noteSet: [E4], referenceNote: 60 }));
  assert.deepEqual(started.effects, expected);
});

test('replayGuess plays the guess any number of times', () => {
  let s = guess(awaiting(E4), F4).state;
  for (let i = 0; i < 3; i++) {
    const r = replayGuess(s);
    assert.equal(r.state, s);
    assert.deepEqual(r.effects, [{ type: 'play', midi: F4, delay: 0 }]);
    s = r.state;
  }
});

test('only the first guess is scored; explore never changes the score', () => {
  let s = guess(awaiting(E4), F4).state;
  const { session, stats } = s;
  for (const m of [E4, 61, 30, 100, F4]) {
    const r = explore(s, m);
    assert.deepEqual(r.effects, [{ type: 'play', midi: m, delay: 0 }]);
    s = r.state;
  }
  assert.equal(s.phase, ANSWERED);
  assert.deepEqual(s.session, session);
  assert.deepEqual(s.stats, stats);
  assert.deepEqual(s.result, { correct: false, target: E4, guess: F4 });
});

test('next starts a new round and clears the guess', () => {
  const answered = guess(awaiting(E4), E4).state;
  const { state, effects } = next(answered);
  assert.equal(state.phase, AWAITING_GUESS);
  assert.notEqual(state.target, E4);
  assert.equal(state.guess, null);
  assert.equal(state.result, null);
  assert.deepEqual(state.session, answered.session);
  assert.deepEqual(effects, [{ type: 'play', midi: state.target, delay: 0 }]);
});

test('no immediate repeats over 1000 rounds with a seeded RNG', () => {
  let s = start(createGame({ noteSet: NOTES, rng: seededRng(42) })).state;
  const seen = new Set([s.target]);
  for (let i = 0; i < 1000; i++) {
    const prev = s.target;
    s = next(guess(s, s.target).state).state;
    assert.notEqual(s.target, prev, `repeat at round ${i}`);
    assert.ok(NOTES.includes(s.target));
    seen.add(s.target);
  }
  assert.equal(seen.size, NOTES.length, 'every note appears');
  assert.equal(s.session.total, 1000);
});

test('seeded RNG is deterministic', () => {
  const run = (seed) => {
    let s = start(createGame({ noteSet: NOTES, rng: seededRng(seed) })).state;
    const targets = [s.target];
    for (let i = 0; i < 20; i++) {
      s = next(guess(s, NOTES[0]).state).state;
      targets.push(s.target);
    }
    return targets;
  };
  assert.deepEqual(run(5), run(5));
  assert.notDeepEqual(run(5), run(6));
});

test('pickTarget: one-note set repeats; empty set throws', () => {
  assert.equal(pickTarget([E4], E4, seededRng(1)), E4);
  assert.throws(() => pickTarget([], null, seededRng(1)), /empty note set/);
});

test('streak counts correct answers in a row', () => {
  let s = awaiting(E4);
  const plan = [[E4, true], [F4, true], [60, false], [62, true]];
  // Each round: answer, then force the next target for the test.
  const streaks = [];
  for (const [target, right] of plan) {
    s = { ...s, phase: AWAITING_GUESS, target };
    s = guess(s, right ? target : target === 60 ? 62 : 60).state;
    streaks.push(s.session.streak);
  }
  assert.deepEqual(streaks, [1, 2, 0, 1]);
  assert.deepEqual(s.session, { correct: 3, total: 4, streak: 1 });
});

test('confusion matrix updates correctly', () => {
  let s = awaiting(E4);
  const rounds = [[E4, F4], [E4, F4], [E4, E4], [E4, 67], [F4, E4]];
  for (const [target, g] of rounds) {
    s = guess({ ...s, phase: AWAITING_GUESS, target }, g).state;
  }
  assert.deepEqual(s.stats, {
    notes: {
      [E4]: { attempts: 4, correct: 1 },
      [F4]: { attempts: 1, correct: 0 },
    },
    confusions: {
      [E4]: { [F4]: 2, 67: 1 },
      [F4]: { [E4]: 1 },
    },
  });
});

test('recordAnswer does not change its input', () => {
  const before = emptyStats();
  recordAnswer(before, E4, F4, false);
  assert.deepEqual(before, emptyStats());
});

test('stats survive a JSON round trip', () => {
  let stats = emptyStats();
  stats = recordAnswer(stats, E4, F4, false);
  stats = recordAnswer(stats, E4, E4, true);
  const restored = JSON.parse(JSON.stringify(stats));
  const s = guess(awaiting(E4, { stats: restored }), F4).state;
  assert.deepEqual(s.stats.notes[E4], { attempts: 3, correct: 1 });
  assert.equal(s.stats.confusions[E4][F4], 2);
});

test('weakestNotes and topConfusions', () => {
  let stats = emptyStats();
  const add = (t, g, n) => { for (let i = 0; i < n; i++) stats = recordAnswer(stats, t, g, t === g); };
  add(E4, F4, 7);
  add(E4, E4, 3); // E4: 3/10
  add(60, 62, 1);
  add(60, 60, 1); // C4: 1/2
  add(67, 67, 4); // G4: 4/4
  assert.deepEqual(weakestNotes(stats).map((n) => [n.midi, n.accuracy]), [[E4, 0.3], [60, 0.5], [67, 1]]);
  assert.deepEqual(weakestNotes(stats, 1).map((n) => n.midi), [E4]);
  assert.deepEqual(topConfusions(stats), [
    { target: E4, guess: F4, count: 7 },
    { target: 60, guess: 62, count: 1 },
  ]);
});

test('configure changes settings for later actions', () => {
  const s = configure(awaiting(E4), { playTargetOnWrong: false });
  assert.equal(guess(s, F4).effects.length, 2);
  const one = configure(guess(awaiting(E4), E4).state, { noteSet: [F4] });
  assert.equal(next(one).state.target, F4);
});

test('resetSession and resetStats', () => {
  const s = guess(awaiting(E4), F4).state;
  assert.deepEqual(resetSession(s).session, { correct: 0, total: 0, streak: 0 });
  assert.deepEqual(resetSession(s).stats, s.stats);
  assert.deepEqual(resetStats(s).stats, emptyStats());
  assert.deepEqual(resetStats(s).session, s.session);
});

test('skip draws a new target without a score, only in AWAITING_GUESS', () => {
  const s = awaiting(E4);
  const { state, effects } = skip(s);
  assert.equal(state.phase, AWAITING_GUESS);
  assert.notEqual(state.target, E4);
  assert.deepEqual(state.session, s.session);
  assert.deepEqual(state.stats, s.stats);
  assert.deepEqual(effects, [{ type: 'play', midi: state.target, delay: 0 }]);
  assert.throws(() => skip(createGame({ noteSet: NOTES })));
  assert.throws(() => skip(guess(s, E4).state));
});

test('skip uses the new note set after configure', () => {
  const s = configure(awaiting(E4), { noteSet: [61, 63] });
  assert.ok([61, 63].includes(skip(s).state.target));
});
