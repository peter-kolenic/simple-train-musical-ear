import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOICES, partials, createSynth, softClip, softClipCurve } from '../src/audio.js';

// ---- a fake AudioContext that records the calls ----

const fakeParam = (value = 1) => {
  const events = [];
  return {
    value,
    events,
    setValueAtTime: (v, t) => events.push({ kind: 'set', v, t }),
    linearRampToValueAtTime: (v, t) => events.push({ kind: 'linear', v, t }),
    exponentialRampToValueAtTime: (v, t) => events.push({ kind: 'exp', v, t }),
    setTargetAtTime: (v, t, tc) => events.push({ kind: 'target', v, t, tc }),
    cancelScheduledValues: (t) => events.push({ kind: 'cancel', t }),
  };
};

const fakeNode = (kind, params) => ({
  kind,
  ...params,
  outputs: [],
  disconnected: false,
  connect(dest) { this.outputs.push(dest); },
  disconnect() { this.disconnected = true; },
});

const fakeContext = ({ sampleRate = 48000 } = {}) => {
  const created = { gains: [], oscs: [] };
  const ctx = {
    currentTime: 10,
    sampleRate,
    destination: fakeNode('destination', {}),
    created,
    createGain: () => {
      const g = fakeNode('gain', { gain: fakeParam(1) });
      created.gains.push(g);
      return g;
    },
    createOscillator: () => {
      const o = fakeNode('osc', { type: 'sine', frequency: fakeParam(440) });
      o.start = (t) => { o.startAt = t; };
      o.stop = (t) => { o.stopAt = t; };
      created.oscs.push(o);
      return o;
    },
    createWaveShaper: () => fakeNode('shaper', { curve: null }),
  };
  return ctx;
};

// The envelope gains: the gains that an oscillator connects to.
const envelopes = (ctx) => ctx.created.oscs.map((o) => o.outputs[0]);

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ---- partials ----

test('every voice has partials whose amplitudes add up to 1', () => {
  for (const v of VOICES) {
    const sum = partials(v).reduce((s, p) => s + p.amp, 0);
    assert.ok(close(sum, 1), `${v}: ${sum}`);
  }
});

test('piano-ish has 6 harmonics with amplitude 1/n^1.5', () => {
  const ps = partials('piano-ish');
  assert.deepEqual(ps.map((p) => p.ratio), [1, 2, 3, 4, 5, 6]);
  ps.forEach((p) => assert.ok(close(p.amp / ps[0].amp, 1 / p.ratio ** 1.5)));
});

test('piano-ish: higher harmonics decay sooner', () => {
  const decays = partials('piano-ish').map((p) => p.decay);
  decays.slice(1).forEach((d, i) => assert.ok(d < decays[i]));
  assert.ok(close(decays[0], 1.2));
});

test('sine and triangle use one oscillator of that type', () => {
  assert.deepEqual(partials('sine').map((p) => p.type), ['sine']);
  assert.deepEqual(partials('triangle').map((p) => p.type), ['triangle']);
});

test('an unknown voice throws', () => {
  assert.throws(() => partials('organ'));
  assert.throws(() => createSynth(fakeContext(), { voice: 'organ' }));
  assert.throws(() => createSynth(fakeContext()).setVoice('organ'));
});

// ---- playNote ----

test('A4 plays the harmonics of 440 Hz', () => {
  const ctx = fakeContext();
  createSynth(ctx).playNote(69);
  const freqs = ctx.created.oscs.map((o) => o.frequency.value);
  freqs.forEach((f, i) => assert.ok(close(f, 440 * (i + 1), 1e-6)));
  assert.equal(freqs.length, 6);
});

test('no envelope ramps from or to a gain of 0 with an exponential ramp', () => {
  const ctx = fakeContext();
  createSynth(ctx).playNote(60);
  for (const env of envelopes(ctx)) {
    const ev = env.gain.events;
    assert.equal(ev[0].kind, 'set');
    assert.ok(ev[0].v > 0);
    ev.forEach((e, i) => {
      if (e.kind !== 'exp') return;
      assert.ok(e.v > 0, 'exp ramp target is 0');
      assert.ok(ev[i - 1].v > 0, 'exp ramp starts from 0');
    });
  }
});

test('the envelope has a 5 ms attack to the partial amplitude', () => {
  const ctx = fakeContext();
  createSynth(ctx).playNote(60);
  const ps = partials('piano-ish');
  envelopes(ctx).forEach((env, i) => {
    const [set, attack, decay] = env.gain.events;
    assert.equal(set.t, 10);
    assert.deepEqual([attack.kind, attack.t, attack.v], ['linear', 10.005, ps[i].amp]);
    assert.equal(decay.kind, 'exp');
    assert.ok(close(decay.t, 10.005 + ps[i].decay));
  });
});

test('when delays the start of the note', () => {
  const ctx = fakeContext();
  createSynth(ctx).playNote(60, { when: 0.8 });
  ctx.created.oscs.forEach((o) => assert.ok(close(o.startAt, 10.8)));
});

test('the oscillators stop after the natural decay', () => {
  const ctx = fakeContext();
  createSynth(ctx).playNote(60);
  ctx.created.oscs.forEach((o) => assert.ok(close(o.stopAt, 10 + 0.005 + 1.2)));
});

test('a short duration releases the note with setTargetAtTime', () => {
  const ctx = fakeContext();
  createSynth(ctx).playNote(60, { duration: 0.3 });
  const out = ctx.created.oscs[0].outputs[0].outputs[0];
  assert.deepEqual(out.gain.events.map((e) => e.kind), ['target']);
  assert.equal(out.gain.events[0].t, 10.3);
  assert.equal(out.gain.events[0].v, 0);
  ctx.created.oscs.forEach((o) => assert.ok(o.stopAt > 10.3 && o.stopAt < 10.6));
});

test('partials above the Nyquist limit are dropped', () => {
  const ctx = fakeContext({ sampleRate: 4000 }); // Nyquist 2000 Hz, limit 1800 Hz
  createSynth(ctx).playNote(69); // 440, 880, 1320, 1760 pass
  assert.equal(ctx.created.oscs.length, 4);
});

test('the sine voice plays one sine oscillator', () => {
  const ctx = fakeContext();
  const synth = createSynth(ctx);
  synth.setVoice('sine');
  synth.playNote(69);
  assert.equal(ctx.created.oscs.length, 1);
  assert.equal(ctx.created.oscs[0].type, 'sine');
  assert.equal(synth.voice(), 'sine');
});

test('every node of a note is disconnected when it ends', () => {
  const ctx = fakeContext();
  const synth = createSynth(ctx);
  synth.playNote(60);
  assert.equal(synth.liveCount(), 1);
  const gainsBefore = ctx.created.gains.length;
  ctx.created.oscs[0].onended();
  assert.equal(synth.liveCount(), 0);
  ctx.created.oscs.forEach((o) => assert.ok(o.disconnected));
  // The master gain stays. All note gains are disconnected.
  ctx.created.gains.slice(1, gainsBefore).forEach((g) => assert.ok(g.disconnected));
  assert.equal(ctx.created.gains[0].disconnected, false);
});

test('stop() releases a sounding note early', () => {
  const ctx = fakeContext();
  const synth = createSynth(ctx);
  const note = synth.playNote(60);
  ctx.currentTime = 10.5;
  note.stop();
  const out = ctx.created.oscs[0].outputs[0].outputs[0];
  assert.deepEqual(out.gain.events.map((e) => e.kind), ['cancel', 'set', 'target']);
  ctx.created.oscs.forEach((o) => assert.ok(close(o.stopAt, 10.5 + 0.24)));
});

test('stopAll() stops every live note', () => {
  const ctx = fakeContext();
  const synth = createSynth(ctx);
  synth.playNote(60);
  synth.playNote(64);
  ctx.currentTime = 10.2;
  synth.stopAll();
  ctx.created.oscs.forEach((o) => assert.ok(close(o.stopAt, 10.2 + 0.24)));
});

test('the master gain is 0.3', () => {
  const ctx = fakeContext();
  createSynth(ctx);
  assert.equal(ctx.created.gains[0].gain.value, 0.3);
});

// ---- soft clipper ----

test('softClip is linear up to 0.5 and stays below 1', () => {
  [0, 0.1, -0.3, 0.5, -0.5].forEach((x) => assert.equal(softClip(x), x));
  [0.6, 0.9, 1, 2].forEach((x) => {
    assert.ok(softClip(x) < 1 && softClip(x) > 0.5);
    assert.equal(softClip(-x), -softClip(x));
  });
  assert.ok(softClip(0.9) > softClip(0.6));
});

test('softClipCurve maps -1, 0, 1 to the ends and the middle', () => {
  const c = softClipCurve();
  assert.equal(c.length % 2, 1);
  assert.equal(c[(c.length - 1) / 2], 0);
  assert.ok(close(c[c.length - 1], softClip(1), 1e-6));
  assert.ok(close(c[0], -softClip(1), 1e-6));
});
