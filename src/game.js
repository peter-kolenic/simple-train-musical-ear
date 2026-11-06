// Pure game logic: state machine, scoring, stats. No DOM, no Web Audio.
// Each action takes a state and returns { state, effects }. It does not
// change the input state. The UI executes the effects.
// Effects:
//   { type: 'play', midi, delay }   delay in seconds from now
//   { type: 'show', result }        result = { correct, target, guess }
import { matches } from './music.js';

export const IDLE = 'IDLE';
export const AWAITING_GUESS = 'AWAITING_GUESS';
export const ANSWERED = 'ANSWERED';

// Seconds between the guess and the correct note after a wrong answer.
export const WRONG_TARGET_DELAY = 0.8;
// Seconds between the reference tone and the target.
export const REFERENCE_DELAY = 1;

// Deterministic RNG (mulberry32). Returns floats in [0, 1).
export const seededRng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// ---- stats ----

// Persistent stats. Plain data, safe for JSON.
//   notes[target]             = { attempts, correct }
//   confusions[target][guess] = count of wrong answers
export const emptyStats = () => ({ notes: {}, confusions: {} });

export const recordAnswer = (stats, target, guess, correct) => {
  const prev = stats.notes[target] || { attempts: 0, correct: 0 };
  const notes = {
    ...stats.notes,
    [target]: { attempts: prev.attempts + 1, correct: prev.correct + (correct ? 1 : 0) },
  };
  if (correct) return { ...stats, notes };
  const row = stats.confusions[target] || {};
  const confusions = {
    ...stats.confusions,
    [target]: { ...row, [guess]: (row[guess] || 0) + 1 },
  };
  return { notes, confusions };
};

// Notes sorted by accuracy, lowest first. Ties: more attempts first.
export const weakestNotes = (stats, limit = 5) =>
  Object.entries(stats.notes)
    .filter(([, s]) => s.attempts > 0)
    .map(([m, s]) => ({ midi: Number(m), ...s, accuracy: s.correct / s.attempts }))
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts || a.midi - b.midi)
    .slice(0, limit);

// Confusions sorted by count, highest first.
export const topConfusions = (stats, limit = 5) =>
  Object.entries(stats.confusions)
    .flatMap(([t, row]) =>
      Object.entries(row).map(([g, count]) => ({ target: Number(t), guess: Number(g), count })))
    .sort((a, b) => b.count - a.count || a.target - b.target || a.guess - b.guess)
    .slice(0, limit);

// ---- state ----

const DEFAULT_CONFIG = {
  noteSet: [],
  octaveMode: 'exact',
  playTargetOnWrong: true,
  referenceNote: null, // MIDI number, or null for off
  rng: Math.random,
};

const emptySession = () => ({ correct: 0, total: 0, streak: 0 });

export const createGame = ({ stats = emptyStats(), ...config } = {}) => ({
  phase: IDLE,
  config: { ...DEFAULT_CONFIG, ...config },
  target: null,
  guess: null,
  result: null,
  session: emptySession(),
  stats,
});

// Settings take effect at once. A new note set applies from the next target.
export const configure = (state, patch) => ({ ...state, config: { ...state.config, ...patch } });

// Uniform pick from noteSet. Never returns prev when another note exists.
export const pickTarget = (noteSet, prev, rng) => {
  if (noteSet.length === 0) throw new Error('empty note set');
  const pool = noteSet.length > 1 ? noteSet.filter((m) => m !== prev) : noteSet;
  return pool[Math.floor(rng() * pool.length)];
};

const requirePhase = (state, action, ...phases) => {
  if (!phases.includes(state.phase)) {
    throw new Error(`${action}() is not allowed in ${state.phase}`);
  }
};

const play = (midi, delay = 0) => ({ type: 'play', midi, delay });

const targetEffects = ({ config, target }) =>
  config.referenceNote === null
    ? [play(target)]
    : [play(config.referenceNote), play(target, REFERENCE_DELAY)];

const newRound = (state) => {
  const { noteSet, rng } = state.config;
  const target = pickTarget(noteSet, state.target, rng);
  const round = { ...state, phase: AWAITING_GUESS, target, guess: null, result: null };
  return { state: round, effects: targetEffects(round) };
};

export const start = (state) => {
  requirePhase(state, 'start', IDLE);
  return newRound(state);
};

export const next = (state) => {
  requirePhase(state, 'next', ANSWERED);
  return newRound(state);
};

// Replays the target, with the reference tone when it is on.
export const replayTarget = (state) => {
  requirePhase(state, 'replayTarget', AWAITING_GUESS, ANSWERED);
  return { state, effects: targetEffects(state) };
};

// The first and only scored guess of the round.
export const guess = (state, midi) => {
  requirePhase(state, 'guess', AWAITING_GUESS);
  const { noteSet, octaveMode, playTargetOnWrong } = state.config;
  if (!noteSet.includes(midi)) throw new Error(`guess ${midi} is not in the note set`);
  const { target, session } = state;
  const correct = matches(target, midi, octaveMode);
  const result = { correct, target, guess: midi };
  const answered = {
    ...state,
    phase: ANSWERED,
    guess: midi,
    result,
    session: {
      correct: session.correct + (correct ? 1 : 0),
      total: session.total + 1,
      streak: correct ? session.streak + 1 : 0,
    },
    stats: recordAnswer(state.stats, target, midi, correct),
  };
  const effects = [
    play(midi),
    ...(!correct && playTargetOnWrong ? [play(target, WRONG_TARGET_DELAY)] : []),
    { type: 'show', result },
  ];
  return { state: answered, effects };
};

export const replayGuess = (state) => {
  requirePhase(state, 'replayGuess', ANSWERED);
  return { state, effects: [play(state.guess)] };
};

// Plays any note after the answer. Never scored. The note can be outside the set.
export const explore = (state, midi) => {
  requirePhase(state, 'explore', ANSWERED);
  return { state, effects: [play(midi)] };
};

export const resetSession = (state) => ({ ...state, session: emptySession() });

export const resetStats = (state) => ({ ...state, stats: emptyStats() });
