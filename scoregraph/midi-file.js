/* ============================================================================
   PPP ScoreGraph — Standard MIDI File, read and written (docs/GOALS/G02 §7.3)

   readMidi(bytes, opts) -> {ok: true, raw, report} or {ok: false, code, message, report}
   writeMidi(raw)        -> Uint8Array

   `raw` is a RawMidi: the file's own facts, none of them dropped and none of
   them interpreted. It knows nothing about ScoreGraph; midi-import.js is what
   turns it into a graph.

     {format, division, tracks: [{index, name?, events}],
      tempoMap, meterMap, keyMap, notes, controls, programs, usAt, endTick}

   Times are ticks, exactly as written. `usAt(tick)` is the one place ticks
   become microseconds, and it does it once and exactly: the tempo map is
   integrated as a sum of integer products and divided by the division at the
   end, so no intermediate is rounded (§8). A tempo meta applies to the whole
   file wherever it sits, which is what the format says and what makes a
   format 1 file - the tempo map in track 0, the notes in track 1 - come out
   right.

   Why not midi_notes.py: that reader is the transcription pipeline's, and it
   drops the track, the channel and every tempo but the last, reads only CC 64,
   and substitutes 480 for an SMPTE division (G02 §7.1). It stays where it is.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.midiFile = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CODES = Object.freeze(['MIDI-NOT-A-FILE', 'MIDI-TRUNCATED', 'MIDI-BAD-HEADER']);
  const REPORT_CODES = Object.freeze(['W-MIDI-NOTE-UNCLOSED', 'W-MIDI-NOTE-ORPHAN-OFF', 'W-MIDI-TRACK-SHORT',
    'W-MIDI-FORMAT-2', 'W-MIDI-RUNNING-STATUS-FIRST']);

  const DEFAULT_UPQ = 500000;          /* 120 qpm, what a file without a tempo means */

  class MidiError extends Error {
    constructor(code, message) { super(code + ': ' + message); this.code = code; }
  }

  function bytesOf(input) {
    if (input instanceof Uint8Array) return input;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) return new Uint8Array(input);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (input && input.buffer instanceof ArrayBuffer) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    throw new MidiError('MIDI-NOT-A-FILE', 'expected bytes');
  }

  /* A cursor over the bytes that refuses to read past the end rather than returning nonsense. */
  function reader(b, from, to) {
    let i = from;
    const need = n => { if (i + n > to) throw new MidiError('MIDI-TRUNCATED', 'the file ends inside an event'); };
    return {
      get at() { return i; },
      get left() { return to - i; },
      u8() { need(1); return b[i++]; },
      u16() { need(2); const v = (b[i] << 8) | b[i + 1]; i += 2; return v; },
      u32() { need(4); const v = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; i += 4; return v; },
      bytes(n) { need(n); const v = b.subarray(i, i + n); i += n; return v; },
      /* variable-length quantity: seven bits per byte, high bit means "more" */
      vlq() {
        let n = 0, k = 0;
        for (;;) {
          need(1);
          const x = b[i++];
          n = (n << 7) | (x & 0x7f);
          if (!(x & 0x80)) return n;
          if (++k > 4) throw new MidiError('MIDI-TRUNCATED', 'a variable-length number longer than four bytes');
        }
      },
      seek(n) { i = n; }
    };
  }

  const latin1 = u8 => { let s = ''; for (let k = 0; k < u8.length; k++) s += String.fromCharCode(u8[k]); return s; };
  const hex = u8 => { let s = ''; for (let k = 0; k < u8.length; k++) s += (u8[k] < 16 ? '0' : '') + u8[k].toString(16); return s; };
  const unhex = s => { const out = new Uint8Array(s.length >> 1); for (let k = 0; k < out.length; k++) out[k] = parseInt(s.substr(k * 2, 2), 16); return out; };

  const META = { 0x01: 'text', 0x02: 'copyright', 0x03: 'track-name', 0x04: 'instrument-name', 0x05: 'lyric',
    0x06: 'marker', 0x07: 'cue-point', 0x20: 'channel-prefix', 0x21: 'port', 0x2f: 'end-of-track',
    0x51: 'tempo', 0x54: 'smpte-offset', 0x58: 'time-signature', 0x59: 'key-signature', 0x7f: 'sequencer' };
  const TEXT_META = new Set(['text', 'copyright', 'track-name', 'instrument-name', 'lyric', 'marker', 'cue-point']);

  function readMidi(input, opts) {
    opts = opts || {};
    const report = { issues: [], dropped: {} };
    const issue = (code, message) => report.issues.push({ code: code, severity: 'WARNING', message: message });
    const drop = name => { report.dropped[name] = (report.dropped[name] || 0) + 1; };
    const fail = (code, message) => ({ ok: false, code: code, message: message, report: report });

    let b;
    try { b = bytesOf(input); } catch (e) { return fail(e.code || 'MIDI-NOT-A-FILE', e.message); }
    if (b.length < 14 || b[0] !== 0x4d || b[1] !== 0x54 || b[2] !== 0x68 || b[3] !== 0x64)
      return fail('MIDI-NOT-A-FILE', 'the file does not start with MThd');

    try {
      const raw = parse(b, issue, drop);
      return { ok: true, raw: raw, report: report };
    } catch (e) {
      if (e instanceof MidiError) return fail(e.code, e.message);
      throw e;
    }
  }

  function parse(b, issue, drop) {
    const head = reader(b, 0, b.length);
    head.seek(4);
    const headLen = head.u32();
    if (headLen < 6) throw new MidiError('MIDI-BAD-HEADER', 'the header chunk is ' + headLen + ' bytes');
    const format = head.u16(), nTracks = head.u16(), div = head.u16();
    let division;
    if (div & 0x8000) {
      /* SMPTE: the high byte is a negative frame rate, the low byte the ticks in a frame. Real time is
         fixed by the division itself, so a tempo meta changes nothing (§7.3). */
      const fps = 256 - ((div >> 8) & 0xff);
      const subframes = div & 0xff;
      if (!fps || !subframes) throw new MidiError('MIDI-BAD-HEADER', 'an SMPTE division of zero');
      division = { kind: 'smpte', fps: fps, subframes: subframes };
    } else {
      if (!div) throw new MidiError('MIDI-BAD-HEADER', 'a division of zero ticks per quarter');
      division = { kind: 'ppq', ppq: div };
    }
    if (format !== 0 && format !== 1 && format !== 2) throw new MidiError('MIDI-BAD-HEADER', 'format ' + format);
    if (format === 2) issue('W-MIDI-FORMAT-2', 'format 2 holds independent sequences; they are read as written and share one timeline');

    const tracks = [];
    let at = 8 + headLen;
    for (let ti = 0; ti < nTracks; ti++) {
      if (at + 8 > b.length) { issue('W-MIDI-TRACK-SHORT', 'the file names ' + nTracks + ' tracks and holds ' + ti); break; }
      if (!(b[at] === 0x4d && b[at + 1] === 0x54 && b[at + 2] === 0x72 && b[at + 3] === 0x6b)) {
        /* an unknown chunk: the format says to skip it by its length */
        const skip = reader(b, at + 4, b.length).u32();
        drop('chunk ' + latin1(b.subarray(at, at + 4)));
        at += 8 + skip;
        continue;
      }
      const len = reader(b, at + 4, b.length).u32();
      const end = Math.min(at + 8 + len, b.length);
      if (at + 8 + len > b.length) issue('W-MIDI-TRACK-SHORT', 'track ' + ti + ' says ' + len + ' bytes and the file has ' + (b.length - at - 8));
      tracks.push(readTrack(b, at + 8, end, ti, issue, drop));
      at += 8 + len;
    }
    if (!tracks.length) throw new MidiError('MIDI-TRUNCATED', 'the file has no readable track');

    /* the maps: a meta event applies to the whole file wherever it sits */
    const tempoMap = [], meterMap = [], keyMap = [];
    tracks.forEach(tr => tr.events.forEach(e => {
      if (e.kind !== 'meta') return;
      if (e.type === 'tempo') tempoMap.push({ tick: e.tick, usPerQuarter: e.usPerQuarter });
      else if (e.type === 'time-signature') meterMap.push({ tick: e.tick, num: e.num, den: e.den, clocks: e.clocks, n32: e.n32 });
      else if (e.type === 'key-signature') keyMap.push({ tick: e.tick, sf: e.sf, mi: e.mi });
    }));
    const byTick = (x, y) => x.tick - y.tick;
    tempoMap.sort(byTick); meterMap.sort(byTick); keyMap.sort(byTick);

    const usAt = timeMap(division, tempoMap);
    const notes = [], controls = [], programs = [];
    let endTick = 0;
    tracks.forEach(tr => {
      endTick = Math.max(endTick, tr.endTick);
      pairNotes(tr, issue).forEach(n => notes.push(n));
      tr.events.forEach(e => {
        if (e.kind === 'control') controls.push({ track: tr.index, channel: e.channel, cc: e.cc, value: e.value, tick: e.tick });
        else if (e.kind === 'program') programs.push({ track: tr.index, channel: e.channel, program: e.program, tick: e.tick });
      });
    });
    notes.forEach(n => { endTick = Math.max(endTick, n.offTick); });
    notes.sort((a, c) => a.onTick - c.onTick || a.track - c.track || a.channel - c.channel || a.midi - c.midi || a.offTick - c.offTick);
    controls.sort((a, c) => a.tick - c.tick || a.track - c.track || a.channel - c.channel || a.cc - c.cc || a.value - c.value);
    programs.sort((a, c) => a.tick - c.tick || a.track - c.track || a.channel - c.channel);

    return { format: format, division: division, tracks: tracks, tempoMap: tempoMap, meterMap: meterMap,
      keyMap: keyMap, notes: notes, controls: controls, programs: programs, usAt: usAt, endTick: endTick };
  }

  function readTrack(b, from, to, index, issue, drop) {
    const r = reader(b, from, to);
    const events = [];
    let tick = 0, running = null, name;
    while (r.left > 0) {
      let delta;
      try { delta = r.vlq(); } catch (e) { issue('W-MIDI-TRACK-SHORT', 'track ' + index + ' ends inside an event'); break; }
      tick += delta;
      if (r.left <= 0) break;
      let status = r.u8();
      if (status < 0x80) {
        /* running status: the previous status byte again, and this byte is already data */
        if (running === null) { issue('W-MIDI-RUNNING-STATUS-FIRST', 'track ' + index + ' begins with a data byte and no status'); break; }
        r.seek(r.at - 1);
        status = running;
      } else if (status < 0xf0) running = status;
      else if (status !== 0xf7 && status !== 0xf0) running = null;

      try {
        if (status === 0xff) {
          const type = r.u8();
          const len = r.vlq();
          const data = r.bytes(len);
          const e = { tick: tick, kind: 'meta', type: META[type] || 'meta-' + type, code: type };
          if (TEXT_META.has(e.type)) e.text = latin1(data);
          else if (e.type === 'tempo' && len === 3) e.usPerQuarter = (data[0] << 16) | (data[1] << 8) | data[2];
          else if (e.type === 'time-signature' && len >= 4) { e.num = data[0]; e.den = Math.pow(2, data[1]); e.clocks = data[2]; e.n32 = data[3]; }
          else if (e.type === 'key-signature' && len >= 2) { e.sf = (data[0] << 24) >> 24; e.mi = data[1]; }
          else if (e.type !== 'end-of-track') e.data = hex(data);
          if (e.type === 'track-name' && name === undefined) name = e.text;
          events.push(e);
          if (e.type === 'end-of-track') break;
        } else if (status === 0xf0 || status === 0xf7) {
          const len = r.vlq();
          events.push({ tick: tick, kind: 'sysex', first: status, data: hex(r.bytes(len)) });
        } else {
          const kind = status & 0xf0, channel = (status & 0x0f) + 1;
          if (kind === 0xc0) events.push({ tick: tick, kind: 'program', channel: channel, program: r.u8() });
          else if (kind === 0xd0) events.push({ tick: tick, kind: 'aftertouch-channel', channel: channel, value: r.u8() });
          else {
            const a = r.u8(), c = r.u8();
            if (kind === 0x90) events.push({ tick: tick, kind: c > 0 ? 'note-on' : 'note-off', channel: channel, note: a, velocity: c, zero: c === 0 });
            else if (kind === 0x80) events.push({ tick: tick, kind: 'note-off', channel: channel, note: a, velocity: c, zero: false });
            else if (kind === 0xa0) events.push({ tick: tick, kind: 'aftertouch-poly', channel: channel, note: a, value: c });
            else if (kind === 0xb0) events.push({ tick: tick, kind: 'control', channel: channel, cc: a, value: c });
            else if (kind === 0xe0) events.push({ tick: tick, kind: 'pitch-bend', channel: channel, value: (c << 7) | a });
            else drop('status 0x' + kind.toString(16));
          }
        }
      } catch (e) {
        if (e instanceof MidiError) { issue('W-MIDI-TRACK-SHORT', 'track ' + index + ' ends inside an event'); break; }
        throw e;
      }
    }
    const out = { index: index, events: events, endTick: tick };
    if (name !== undefined) out.name = name;
    return out;
  }

  /* Note on to note off, first in first out for a repeated (channel, note). A press that is never
     released is closed at the end of its track and reported, never thrown away (§7.3, A21). */
  function pairNotes(track, issue) {
    const open = new Map();
    const notes = [];
    let orphans = 0;
    track.events.forEach(e => {
      if (e.kind === 'note-on') {
        const key = e.channel + '|' + e.note;
        if (!open.has(key)) open.set(key, []);
        open.get(key).push(e);
      } else if (e.kind === 'note-off') {
        const key = e.channel + '|' + e.note;
        const stack = open.get(key);
        if (!stack || !stack.length) { orphans++; return; }
        const on = stack.shift();
        notes.push({ track: track.index, channel: e.channel, midi: e.note, onTick: on.tick, offTick: e.tick,
          onVel: on.velocity, offVel: e.velocity, offKind: e.zero ? 'note-on-0' : 'note-off' });
      }
    });
    let unclosed = 0;
    open.forEach(stack => stack.forEach(on => {
      unclosed++;
      notes.push({ track: track.index, channel: on.channel, midi: on.note, onTick: on.tick, offTick: track.endTick,
        onVel: on.velocity, offVel: 0, offKind: 'unclosed' });
    }));
    if (unclosed) issue('W-MIDI-NOTE-UNCLOSED', unclosed + ' note' + (unclosed > 1 ? 's' : '') + ' in track ' + track.index +
      ' never stop; they are closed at the end of the track');
    if (orphans) issue('W-MIDI-NOTE-ORPHAN-OFF', orphans + ' note off' + (orphans > 1 ? 's' : '') + ' in track ' + track.index + ' have no press');
    return notes;
  }

  /* tick -> integer microseconds, exact. The products are summed as integers and divided by the
     division once, so a tempo change never leaves a rounded intermediate behind (§8). */
  function timeMap(division, tempoMap) {
    if (division.kind === 'smpte') {
      const perSecond = division.fps * division.subframes;
      return tick => Math.round(tick * 1000000 / perSecond);
    }
    const ppq = division.ppq;
    const pts = tempoMap.slice();
    return function usAt(tick) {
      let acc = 0, prev = 0, upq = DEFAULT_UPQ;
      for (let i = 0; i < pts.length; i++) {
        if (pts[i].tick >= tick) break;
        acc += (pts[i].tick - prev) * upq;
        prev = pts[i].tick;
        upq = pts[i].usPerQuarter;
      }
      acc += (tick - prev) * upq;
      return Math.round(acc / ppq);
    };
  }

  /* ------------------------------------------------------------------ write */
  function vlqBytes(n) {
    const parts = [n & 0x7f];
    n >>>= 7;
    while (n) { parts.push((n & 0x7f) | 0x80); n >>>= 7; }
    return parts.reverse();
  }

  /* RawMidi back to bytes, from the tracks' own events. Used to measure fidelity (§9.2), not as a
     feature: what comes back is the same music, not the same bytes. */
  function writeMidi(raw) {
    const out = [];
    const div = raw.division.kind === 'smpte'
      ? (((256 - raw.division.fps) & 0xff) << 8) | (raw.division.subframes & 0xff)
      : raw.division.ppq;
    push(out, [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6]);
    push(out, [(raw.format >> 8) & 0xff, raw.format & 0xff, (raw.tracks.length >> 8) & 0xff, raw.tracks.length & 0xff,
      (div >> 8) & 0xff, div & 0xff]);
    raw.tracks.forEach(tr => {
      const body = [];
      let last = 0;
      const evs = tr.events.slice().sort((a, b) => a.tick - b.tick);
      evs.forEach(e => {
        push(body, vlqBytes(e.tick - last));
        last = e.tick;
        writeEvent(body, e);
      });
      if (!evs.length || evs[evs.length - 1].type !== 'end-of-track') { push(body, vlqBytes(0)); push(body, [0xff, 0x2f, 0]); }
      push(out, [0x4d, 0x54, 0x72, 0x6b, (body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff]);
      push(out, body);
    });
    return Uint8Array.from(out);
  }
  function push(a, xs) { for (let i = 0; i < xs.length; i++) a.push(xs[i]); }
  function writeEvent(body, e) {
    if (e.kind === 'meta') {
      let data;
      if (e.text !== undefined) { data = []; for (let i = 0; i < e.text.length; i++) data.push(e.text.charCodeAt(i) & 0xff); }
      else if (e.type === 'tempo') data = [(e.usPerQuarter >> 16) & 0xff, (e.usPerQuarter >> 8) & 0xff, e.usPerQuarter & 0xff];
      else if (e.type === 'time-signature') data = [e.num, Math.round(Math.log2(e.den)), e.clocks, e.n32];
      else if (e.type === 'key-signature') data = [e.sf & 0xff, e.mi];
      else if (e.type === 'end-of-track') data = [];
      else data = Array.from(unhex(e.data || ''));
      push(body, [0xff, e.code]);
      push(body, vlqBytes(data.length));
      push(body, data);
      return;
    }
    if (e.kind === 'sysex') {
      const data = Array.from(unhex(e.data || ''));
      push(body, [e.first]);
      push(body, vlqBytes(data.length));
      push(body, data);
      return;
    }
    const ch = (e.channel - 1) & 0x0f;
    if (e.kind === 'note-on') push(body, [0x90 | ch, e.note, e.velocity]);
    else if (e.kind === 'note-off') push(body, e.zero ? [0x90 | ch, e.note, 0] : [0x80 | ch, e.note, e.velocity]);
    else if (e.kind === 'control') push(body, [0xb0 | ch, e.cc, e.value]);
    else if (e.kind === 'program') push(body, [0xc0 | ch, e.program]);
    else if (e.kind === 'aftertouch-poly') push(body, [0xa0 | ch, e.note, e.value]);
    else if (e.kind === 'aftertouch-channel') push(body, [0xd0 | ch, e.value]);
    else if (e.kind === 'pitch-bend') push(body, [0xe0 | ch, e.value & 0x7f, (e.value >> 7) & 0x7f]);
  }

  /* What two MIDI files have to agree on to be the same music (§9.2). Sorted, so it is a multiset. */
  function projection(raw) {
    const us = raw.usAt;
    return {
      notes: raw.notes.map(n => [n.track, n.channel, n.midi, us(n.onTick), us(n.offTick), n.onVel].join(' ')).sort(),
      controls: raw.controls.map(c => [c.track, c.channel, c.cc, c.value, us(c.tick)].join(' ')).sort(),
      programs: raw.programs.map(p => [p.track, p.channel, p.program, us(p.tick)].join(' ')).sort(),
      tempo: raw.tempoMap.map(t => [us(t.tick), t.usPerQuarter].join(' ')).sort(),
      meter: raw.meterMap.map(m => [us(m.tick), m.num, m.den].join(' ')).sort(),
      key: raw.keyMap.map(k => [us(k.tick), k.sf, k.mi].join(' ')).sort()
    };
  }

  return Object.freeze({ readMidi, writeMidi, projection, CODES, REPORT_CODES, DEFAULT_UPQ });
});
