// Pure note math. No DOM, no Web Audio.
// A note is a MIDI number: C4 = 60, A4 = 69.

const A4_MIDI = 69;
const A4_FREQ = 440;

const BLACK_PCS = [1, 3, 6, 8, 10];

const NAMES = {
  international: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
  central: ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'B', 'H'],
};

// Pitch class 0..11. Correct for negative input too.
export const pitchClass = (midi) => ((midi % 12) + 12) % 12;

// Scientific octave number: C4 = 60.
export const octaveOf = (midi) => Math.floor(midi / 12) - 1;

// 12-TET frequency in Hz.
export const midiToFreq = (midi) => A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);

export const isBlack = (midi) => BLACK_PCS.includes(pitchClass(midi));

// style: 'central' (default) or 'international'.
export const noteName = (midi, { style = 'central', showOctave = false } = {}) => {
  const table = NAMES[style];
  if (!table) throw new Error(`unknown naming style: ${style}`);
  const base = table[pitchClass(midi)];
  return showOctave ? `${base}${octaveOf(midi)}` : base;
};

// True when the range covers notes from more than one octave number.
export const spansOctaves = (low, high) => octaveOf(low) !== octaveOf(high);

// Ascending list of MIDI numbers in [low, high].
export const buildNoteSet = ({ low = 60, high = 84, whiteOnly = true } = {}) => {
  if (!Number.isInteger(low) || !Number.isInteger(high) || low > high) {
    throw new Error(`bad range: ${low}..${high}`);
  }
  return Array.from({ length: high - low + 1 }, (_, i) => low + i)
    .filter((m) => !whiteOnly || !isBlack(m));
};

// mode: 'exact' (default) or 'pitchClass'.
export const matches = (target, guess, mode = 'exact') => {
  if (mode === 'exact') return target === guess;
  if (mode === 'pitchClass') return pitchClass(guess - target) === 0;
  throw new Error(`unknown match mode: ${mode}`);
};
