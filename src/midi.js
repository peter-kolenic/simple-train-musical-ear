// Web MIDI input and output. Browser-only at run time.
// createMidiHub() takes a MIDIAccess object, so tests can give it a fake one.
// The UI uses the module functions: midiSupported(), then startMidi().
// Channels are 1-16 in this module, as on the keyboard display.

export const MIDI_DRUM_CHANNEL = 10;
// An input note-on that repeats the lit note this soon after the send is an
// echo of our own message, not a key press.
export const MIDI_ECHO_MS = 150;

// Raw bytes to {type, channel, note, velocity}. type: 'noteon', 'noteoff', or 'other'.
// A note-on with velocity 0 is a note-off.
export const parseMidiMessage = (data) => {
  const [status = 0, d1 = 0, d2 = 0] = data;
  const kind = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  if (status < 0x80 || status >= 0xf0) return { type: 'other', status };
  if (kind === 0x90 && d2 > 0) return { type: 'noteon', channel, note: d1, velocity: d2 };
  if (kind === 0x90 || kind === 0x80) return { type: 'noteoff', channel, note: d1, velocity: d2 };
  return { type: 'other', status, channel, data1: d1, data2: d2 };
};

const statusByte = (kind, channel) => kind | ((channel - 1) & 0x0f);
export const noteOnBytes = (note, channel, velocity) => [statusByte(0x90, channel), note & 0x7f, velocity & 0x7f];
export const noteOffBytes = (note, channel) => [statusByte(0x80, channel), note & 0x7f, 0];
export const controlChangeBytes = (cc, value, channel) => [statusByte(0xb0, channel), cc & 0x7f, value & 0x7f];

const portList = (map) => [...map.values()].map((p) => ({ id: p.id, name: p.name || p.id }));

export const createMidiHub = (access, { now = () => Date.now() } = {}) => {
  let inputId = 'all';
  let lit = null; // {outputId, note, channel, sentAt}
  const noteListeners = [];
  const noteOffListeners = [];
  const messageListeners = [];
  const portListeners = [];

  const handle = (portId, data) => {
    const msg = parseMidiMessage(data);
    messageListeners.forEach((cb) => cb(msg, portId, data));
    if (inputId !== 'all' && portId !== inputId) return;
    if (msg.channel === MIDI_DRUM_CHANNEL) return;
    if (msg.type === 'noteoff') noteOffListeners.forEach((cb) => cb(msg.note, msg));
    if (msg.type !== 'noteon') return;
    if (lit && lit.note === msg.note && now() - lit.sentAt < MIDI_ECHO_MS) return;
    noteListeners.forEach((cb) => cb(msg.note, msg));
  };

  // Called again after each port change, so a new device gets the handler.
  const attach = () =>
    access.inputs.forEach((input) => {
      input.onmidimessage = (e) => handle(input.id, e.data);
    });
  attach();
  access.onstatechange = () => {
    attach();
    portListeners.forEach((cb) => cb());
  };

  const send = (outputId, bytes) => {
    const out = access.outputs.get(outputId);
    if (!out) return false;
    out.send(bytes);
    return true;
  };

  const clearLight = () => {
    if (lit) send(lit.outputId, noteOffBytes(lit.note, lit.channel));
    lit = null;
  };

  // Sends a note-on that the keyboard holds until clearLight() or the next light().
  const light = (outputId, note, { channel = 1, velocity = 1 } = {}) => {
    clearLight();
    if (!send(outputId, noteOnBytes(note, channel, velocity))) return false;
    lit = { outputId, note, channel, sentAt: now() };
    return true;
  };

  // All Notes Off (CC 123) also clears a light that the hub does not know,
  // for example one from a ?debug test.
  const allNotesOff = (outputId, channel) => {
    if (lit && lit.outputId === outputId && lit.channel === channel) lit = null;
    return send(outputId, controlChangeBytes(123, 0, channel));
  };

  return {
    inputs: () => portList(access.inputs),
    outputs: () => portList(access.outputs),
    setInput: (id) => {
      inputId = id;
    },
    onNote: (cb) => noteListeners.push(cb),
    onNoteOff: (cb) => noteOffListeners.push(cb),
    onMessage: (cb) => messageListeners.push(cb),
    onPorts: (cb) => portListeners.push(cb),
    send,
    light,
    clearLight,
    allNotesOff,
    litNote: () => (lit ? lit.note : null),
    litKey: () => (lit ? `${lit.outputId}|${lit.channel}|${lit.note}` : null),
  };
};

// ---- browser singleton ----

let midiPromise = null;

export const midiSupported = () =>
  typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';

// Resolves to the hub. The browser can show a permission prompt.
// A failure is not cached, so the user can try again.
export const startMidi = () => {
  if (!midiSupported()) return Promise.reject(new Error('this browser has no Web MIDI'));
  if (!midiPromise) {
    midiPromise = navigator.requestMIDIAccess({ sysex: false })
      .then((access) => createMidiHub(access))
      .catch((err) => {
        midiPromise = null;
        throw err;
      });
  }
  return midiPromise;
};
