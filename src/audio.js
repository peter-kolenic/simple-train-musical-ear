// Web Audio synth. Browser-only at run time.
// createSynth() takes an AudioContext, so tests can give it a fake one.
// The UI uses the module functions: ensureAudio() inside a user gesture,
// then playNote(), stopAll(), setVoice().
import { midiToFreq } from './music.js';

export const VOICES = ['piano-ish', 'sine', 'triangle'];

const MASTER_GAIN = 0.3;
const ATTACK = 0.005; // s, linear attack
const DECAY = 3.6; // s, time for the fundamental to reach SILENCE
const SILENCE = 0.0001; // exponential ramps cannot start or end at 0
const RELEASE_TC = 0.03; // s, time constant of an early release
const RELEASE_END = 8 * RELEASE_TC; // after 8 time constants the level is below 0.04 %
const PARTIALS = 6;
const NYQUIST_MARGIN = 0.9; // drop partials above 90 % of the Nyquist frequency

// The partials of one voice: [{ ratio, amp, decay, type }].
// The amplitudes add up to 1, so one note never peaks above 1.
export const partials = (voice) => {
  if (voice === 'sine' || voice === 'triangle') {
    return [{ ratio: 1, amp: 1, decay: DECAY, type: voice }];
  }
  if (voice !== 'piano-ish') throw new Error(`unknown voice: ${voice}`);
  // Amplitude 1/n^1.5. Higher partials decay sooner.
  const raw = Array.from({ length: PARTIALS }, (_, i) => i + 1).map((n) => ({
    ratio: n,
    amp: 1 / n ** 1.5,
    decay: DECAY / (1 + 0.4 * (n - 1)),
    type: 'sine',
  }));
  const sum = raw.reduce((s, p) => s + p.amp, 0);
  return raw.map((p) => ({ ...p, amp: p.amp / sum }));
};

// Transfer curve over the input range [-1, 1]. Linear for |x| <= KNEE.
// Above KNEE, a tanh curve that approaches 1. Input beyond ±1 gives the end values.
const KNEE = 0.5;
const CURVE_POINTS = 2049; // odd, so that x = 0 is a point
export const softClip = (x) => {
  const a = Math.abs(x);
  if (a <= KNEE) return x;
  return Math.sign(x) * (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE)));
};
export const softClipCurve = () =>
  Float32Array.from({ length: CURVE_POINTS }, (_, i) => softClip((2 * i) / (CURVE_POINTS - 1) - 1));

export const createSynth =(ctx, { voice = 'piano-ish' } = {}) => {
  partials(voice); // validate
  let current = voice;
  const live = new Set();

  // A soft clipper after the master gain. It stops hard clipping when many
  // notes overlap. Do not use a DynamicsCompressorNode here: in Chrome it
  // softens each note onset for about 100 ms.
  const limiter = ctx.createWaveShaper();
  limiter.curve = softClipCurve();
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(limiter);
  limiter.connect(ctx.destination);

  // when: seconds from now. duration: seconds, or null for the natural decay.
  // Returns a handle with stop(), which releases the note early.
  const playNote = (midi, { duration = null, when = 0 } = {}) => {
    const t0 = ctx.currentTime + Math.max(0, when);
    const freq = midiToFreq(midi);
    const ps = partials(current)
      .filter((p) => freq * p.ratio < (ctx.sampleRate / 2) * NYQUIST_MARGIN);

    // The release stage. Its gain stays at 1 until a release.
    const out = ctx.createGain();
    out.connect(master);
    const nodes = [out];

    const oscs = ps.map((p) => {
      const osc = ctx.createOscillator();
      osc.type = p.type;
      osc.frequency.value = freq * p.ratio;
      const env = ctx.createGain();
      env.gain.setValueAtTime(SILENCE, t0);
      env.gain.linearRampToValueAtTime(p.amp, t0 + ATTACK);
      env.gain.exponentialRampToValueAtTime(SILENCE, t0 + ATTACK + p.decay);
      osc.connect(env);
      env.connect(out);
      nodes.push(osc, env);
      return osc;
    });

    let end = t0 + ATTACK + Math.max(0, ...ps.map((p) => p.decay));
    if (duration !== null && t0 + duration < end) {
      out.gain.setTargetAtTime(0, t0 + duration, RELEASE_TC);
      end = t0 + duration + RELEASE_END;
    }

    const note = {
      midi,
      stop: () => {
        const now = ctx.currentTime;
        if (now >= end) return;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(out.gain.value, now);
        out.gain.setTargetAtTime(0, now, RELEASE_TC);
        end = Math.min(end, now + RELEASE_END);
        oscs.forEach((o) => o.stop(end));
      },
    };

    const cleanup = () => {
      nodes.forEach((n) => n.disconnect());
      live.delete(note);
    };
    if (oscs.length === 0) {
      cleanup();
      return note;
    }
    oscs.forEach((o) => {
      o.start(t0);
      o.stop(end);
    });
    // All oscillators stop at the same time.
    oscs[0].onended = cleanup;
    live.add(note);
    return note;
  };

  const stopAll = () => [...live].forEach((n) => n.stop());

  const setVoice = (v) => {
    partials(v); // validate
    current = v;
  };

  return { playNote, stopAll, setVoice, voice: () => current, liveCount: () => live.size };
};

// ---- browser singleton ----

let audioCtx = null;
let synth = null;
let pendingVoice = 'piano-ish';

// Call only inside a user gesture (autoplay policy). Resolves to the synth.
export const ensureAudio = () => {
  if (!synth) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    synth = createSynth(audioCtx, { voice: pendingVoice });
  }
  return audioCtx.state === 'suspended'
    ? audioCtx.resume().then(() => synth)
    : Promise.resolve(synth);
};

export const audioReady = () => synth !== null;

// True when the context plays sound. Without a user gesture it stays suspended.
export const audioRunning = () => audioCtx !== null && audioCtx.state === 'running';

export const playNote = (midi, opts) => {
  if (!synth) throw new Error('audio is not started: call ensureAudio() first');
  return synth.playNote(midi, opts);
};

export const stopAll = () => {
  if (synth) synth.stopAll();
};

export const setVoice = (v) => {
  partials(v); // validate
  pendingVoice = v;
  if (synth) synth.setVoice(v);
};
