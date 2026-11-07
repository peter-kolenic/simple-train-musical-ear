import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIDI_ECHO_MS, parseMidiMessage, noteOnBytes, noteOffBytes, controlChangeBytes, createMidiHub,
} from '../src/midi.js';

test('parseMidiMessage: note-on, note-off, velocity 0', () => {
  assert.deepEqual(parseMidiMessage([0x90, 60, 100]), { type: 'noteon', channel: 1, note: 60, velocity: 100 });
  assert.deepEqual(parseMidiMessage([0x9f, 61, 1]), { type: 'noteon', channel: 16, note: 61, velocity: 1 });
  assert.deepEqual(parseMidiMessage([0x81, 60, 64]), { type: 'noteoff', channel: 2, note: 60, velocity: 64 });
  assert.deepEqual(parseMidiMessage([0x90, 60, 0]), { type: 'noteoff', channel: 1, note: 60, velocity: 0 });
});

test('parseMidiMessage: other messages', () => {
  assert.equal(parseMidiMessage([0xb0, 7, 100]).type, 'other');
  assert.equal(parseMidiMessage([0xf8]).type, 'other'); // clock
  assert.equal(parseMidiMessage([0xfe]).type, 'other'); // active sensing
  assert.equal(parseMidiMessage([]).type, 'other');
  assert.equal(parseMidiMessage(Uint8Array.of(0x40, 1, 2)).type, 'other'); // data byte, no status
});

test('message bytes', () => {
  assert.deepEqual(noteOnBytes(60, 1, 64), [0x90, 60, 64]);
  assert.deepEqual(noteOnBytes(60, 16, 1), [0x9f, 60, 1]);
  assert.deepEqual(noteOffBytes(72, 3), [0x82, 72, 0]);
  assert.deepEqual(controlChangeBytes(7, 0, 1), [0xb0, 7, 0]);
  for (const bytes of [noteOnBytes(60, 5, 9), noteOffBytes(60, 5)]) {
    const m = parseMidiMessage(bytes);
    assert.equal(m.channel, 5);
    assert.equal(m.note, 60);
  }
});

// ---- a fake MIDIAccess ----

const fakeAccess = () => {
  const inputs = new Map();
  const outputs = new Map();
  const sent = [];
  const access = { inputs, outputs, onstatechange: null };
  const addInput = (id, name = id) => inputs.set(id, { id, name, onmidimessage: null });
  const addOutput = (id, name = id) => outputs.set(id, { id, name, send: (b) => sent.push([id, [...b]]) });
  const press = (id, bytes) => inputs.get(id).onmidimessage({ data: Uint8Array.from(bytes) });
  const change = () => access.onstatechange && access.onstatechange({});
  return { access, addInput, addOutput, press, change, sent };
};

const setup = () => {
  const f = fakeAccess();
  f.addInput('in1', 'EZ-310');
  f.addInput('in2', 'Other');
  f.addOutput('out1', 'EZ-310');
  let t = 1000;
  const hub = createMidiHub(f.access, { now: () => t });
  const notes = [];
  hub.onNote((n) => notes.push(n));
  return { f, hub, notes, tick: (ms) => { t += ms; } };
};

test('hub: note-ons from all inputs; note-offs, velocity 0, and drums are ignored', () => {
  const { f, notes } = setup();
  f.press('in1', [0x90, 60, 80]);
  f.press('in1', [0x80, 60, 0]);
  f.press('in1', [0x90, 60, 0]);
  f.press('in2', [0x91, 62, 80]);
  f.press('in1', [0x99, 36, 80]); // ch 10
  f.press('in1', [0xf8]);
  assert.deepEqual(notes, [60, 62]);
});

test('hub: setInput filters by port', () => {
  const { f, hub, notes } = setup();
  hub.setInput('in2');
  f.press('in1', [0x90, 60, 80]);
  f.press('in2', [0x90, 64, 80]);
  hub.setInput('all');
  f.press('in1', [0x90, 65, 80]);
  assert.deepEqual(notes, [64, 65]);
});

test('hub: onMessage sees every message from every input', () => {
  const { f, hub } = setup();
  hub.setInput('in2');
  const seen = [];
  hub.onMessage((msg, portId) => seen.push([portId, msg.type]));
  f.press('in1', [0x90, 60, 80]);
  f.press('in1', [0xb0, 7, 1]);
  assert.deepEqual(seen, [['in1', 'noteon'], ['in1', 'other']]);
});

test('hub: a new input gets the handler after a port change', () => {
  const { f, hub, notes } = setup();
  let changes = 0;
  hub.onPorts(() => changes++);
  f.addInput('in3');
  f.change();
  f.press('in3', [0x90, 67, 80]);
  assert.deepEqual(notes, [67]);
  assert.equal(changes, 1);
  assert.deepEqual(hub.inputs().map((p) => p.name), ['EZ-310', 'Other', 'in3']);
});

test('hub: light holds one note; a new light or clearLight sends the note-off', () => {
  const { f, hub } = setup();
  assert.equal(hub.light('out1', 64, { channel: 1, velocity: 1 }), true);
  assert.equal(hub.litNote(), 64);
  assert.equal(hub.litKey(), 'out1|1|64');
  hub.light('out1', 67, { channel: 2, velocity: 1 });
  hub.clearLight();
  hub.clearLight(); // nothing lit: sends nothing
  assert.equal(hub.litNote(), null);
  assert.deepEqual(f.sent, [
    ['out1', [0x90, 64, 1]],
    ['out1', [0x80, 64, 0]],
    ['out1', [0x91, 67, 1]],
    ['out1', [0x81, 67, 0]],
  ]);
});

test('hub: light on a missing output does nothing', () => {
  const { f, hub } = setup();
  assert.equal(hub.light('gone', 64), false);
  assert.equal(hub.litNote(), null);
  assert.equal(hub.send('gone', [0x90, 60, 1]), false);
  assert.deepEqual(f.sent, []);
});

test('hub: an echo of the lit note is ignored for a short time only', () => {
  const { f, hub, notes, tick } = setup();
  hub.light('out1', 64);
  f.press('in1', [0x90, 64, 1]); // echo
  f.press('in1', [0x90, 65, 80]); // other note
  tick(MIDI_ECHO_MS);
  f.press('in1', [0x90, 64, 80]); // a real key press later
  assert.deepEqual(notes, [65, 64]);
});
