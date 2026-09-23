/* ============================================================================
   PPP ScoreGraph — MIDI into the graph (docs/GOALS/G02 §7)

   importMidi(bytes, opts) -> {ok: true, graph, report} or {ok: false, code, message, report}
     opts: {scoreId, sourceName, sourceSha256}

   A MIDI file is a performance, not a score. What it states exactly - when each
   key went down and came up, how hard, on which channel of which track, where
   the controllers moved, the tempo and metre maps - goes into the performance
   layer exactly, in integer microseconds (§8).

   What it does not state - note values, spelling, voices, hands, staves,
   phrasing - is not invented here. G2 builds the smallest notation the schema
   demands (a graph must have a part and a measure, §7.5) and marks every bit of
   it `op: 'inferred'`, so nothing downstream can mistake the grid for the
   composer's. Turning a performance into readable rhythm is G3's work, and
   audio-score.js already does a measured version of it for recordings.

   The skeleton, decided and not guessed:
     part     one per (track, channel) that has a note; channel 10 is percussion
     staff    one, with the clef the instrument implies; no hand split
     voice    one
     measure  the metre map folded over the ticks, covering the last release
     meter    the file's, or 4/4 where it states none
     tempo    the file's map
     anchor   one at each bar line, so performance time and written position meet
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./schema.js'), require('./build.js'), require('./midi-file.js'));
  else {
    const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {};
    M.midiImport = factory(M.rational, M.schema, M.build, M.midiFile);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, B, MF) {
  'use strict';

  const CODES = Object.freeze(['MIDI-NOT-A-FILE', 'MIDI-TRUNCATED', 'MIDI-BAD-HEADER', 'MIDI-NO-NOTES', 'MIDI-INVALID']);
  const REPORT_CODES = Object.freeze(['W-MIDI-METER-ASSUMED', 'W-MIDI-SKELETON', 'W-MIDI-DRUM-UNKNOWN',
    'W-MIDI-NOTE-ZERO-LENGTH']);

  const PEDAL_CC = { 64: 'damper', 66: 'sostenuto', 67: 'soft' };
  const PEDAL_DOWN = 64;                    /* the value at which a pedal counts as pressed */

  /* General MIDI percussion: note number -> what it is. A convention, not an inference (§17.2). */
  const GM_DRUM = {
    35: 'acoustic-bass-drum', 36: 'bass-drum-1', 37: 'side-stick', 38: 'acoustic-snare', 39: 'hand-clap',
    40: 'electric-snare', 41: 'low-floor-tom', 42: 'closed-hi-hat', 43: 'high-floor-tom', 44: 'pedal-hi-hat',
    45: 'low-tom', 46: 'open-hi-hat', 47: 'low-mid-tom', 48: 'hi-mid-tom', 49: 'crash-cymbal-1',
    50: 'high-tom', 51: 'ride-cymbal-1', 52: 'chinese-cymbal', 53: 'ride-bell', 54: 'tambourine',
    55: 'splash-cymbal', 56: 'cowbell', 57: 'crash-cymbal-2', 58: 'vibraslap', 59: 'ride-cymbal-2',
    60: 'hi-bongo', 61: 'low-bongo', 62: 'mute-hi-conga', 63: 'open-hi-conga', 64: 'low-conga',
    65: 'high-timbale', 66: 'low-timbale', 67: 'high-agogo', 68: 'low-agogo', 69: 'cabasa',
    70: 'maracas', 71: 'short-whistle', 72: 'long-whistle', 73: 'short-guiro', 74: 'long-guiro',
    75: 'claves', 76: 'hi-wood-block', 77: 'low-wood-block', 78: 'mute-cuica', 79: 'open-cuica',
    80: 'mute-triangle', 81: 'open-triangle', 82: 'shaker', 83: 'jingle-bell', 84: 'belltree', 85: 'castanets',
    86: 'mute-surdo', 87: 'open-surdo'
  };
  /* Where each kit piece sits on a percussion staff, by the usual drum-set layout. */
  const GM_POS = {
    35: ['F', 4], 36: ['F', 4], 37: ['C', 5], 38: ['C', 5], 40: ['C', 5],
    41: ['A', 4], 43: ['B', 4], 45: ['D', 5], 47: ['E', 5], 48: ['F', 5], 50: ['G', 5],
    42: ['G', 5], 44: ['D', 4], 46: ['G', 5], 49: ['A', 5], 51: ['F', 5], 52: ['A', 5],
    53: ['F', 5], 55: ['A', 5], 57: ['A', 5], 59: ['F', 5]
  };
  const NOTEHEAD = { 42: 'x', 44: 'x', 46: 'x', 49: 'x', 51: 'x', 52: 'x', 53: 'diamond', 55: 'x', 57: 'x', 59: 'x' };

  /* GM program -> the instrument vocabulary (§5.5). Only what the vocabulary already has. */
  function instrumentOf(program, channel) {
    if (channel === 10) return { kind: 'drumset', family: 'percussion' };
    if (program == null) return { kind: 'piano', family: 'keyboard' };
    const p = program;                        /* 0-based, as the file writes it */
    if (p <= 7) return { kind: 'piano', family: 'keyboard' };
    if (p <= 15) return { kind: 'percussion', family: 'percussion' };
    if (p <= 23) return { kind: 'organ', family: 'keyboard' };
    if (p <= 31) return { kind: p <= 25 ? 'acoustic-guitar' : 'electric-guitar', family: 'plucked' };
    if (p <= 39) return { kind: p <= 32 ? 'acoustic-bass' : 'electric-bass', family: 'plucked' };
    if (p === 40 || p === 44 || p === 45) return { kind: 'violin', family: 'bowed' };
    if (p === 41) return { kind: 'viola', family: 'bowed' };
    if (p === 42) return { kind: 'cello', family: 'bowed' };
    if (p === 43) return { kind: 'contrabass', family: 'bowed' };
    if (p <= 55) return { kind: 'voice', family: 'voice' };
    if (p <= 63) return { kind: 'trumpet', family: 'brass' };
    if (p <= 71) return { kind: 'saxophone', family: 'wind' };
    if (p <= 79) return { kind: 'flute', family: 'wind' };
    return { kind: 'unknown', family: 'other' };
  }

  function importMidi(bytes, opts) {
    opts = opts || {};
    const read = MF.readMidi(bytes, opts);
    const report = { issues: (read.report.issues || []).slice(), dropped: Object.assign({}, read.report.dropped) };
    if (!read.ok) return { ok: false, code: read.code, message: read.message, report: report };
    const issue = (code, message) => report.issues.push({ code: code, severity: 'WARNING', message: message });
    try {
      const graph = build(read.raw, opts, issue, report);
      return { ok: true, graph: graph, raw: read.raw, report: report };
    } catch (e) {
      if (e && e.code === 'E-BUILD') {
        report.validation = e.issues;
        return { ok: false, code: 'MIDI-INVALID', message: e.message, report: report };
      }
      if (e && e.code === 'MIDI-NO-NOTES') return { ok: false, code: e.code, message: e.message, report: report };
      throw e;
    }
  }

  function build(raw, opts, issue, report) {
    const us = raw.usAt;
    /* A file with no note has no performance to hold and no length to lay out. */
    if (!raw.notes.length) {
      const e = new Error('the file holds no note');
      e.code = 'MIDI-NO-NOTES';
      throw e;
    }

    /* ----------------------------------------------------------- the grid */
    /* An SMPTE file measures real time, not musical time, so it has no ticks-per-quarter. Take the
       division's own rate at 120 qpm, which is what a file without a tempo means anyway (§7.5). */
    const ppq = raw.division.kind === 'ppq' ? raw.division.ppq
      : Math.max(1, Math.round(raw.division.fps * raw.division.subframes / 2));
    let meters = raw.meterMap.slice();
    if (!meters.length || meters[0].tick > 0) {
      issue('W-MIDI-METER-ASSUMED', 'the file states no time signature at its start; 4/4 is assumed');
      meters = [{ tick: 0, num: 4, den: 4 }].concat(meters);
    }
    const lastTick = Math.max(raw.endTick, raw.notes.reduce((m, n) => Math.max(m, n.offTick), 0));
    /* fold the metre map over the ticks: one entry per measure, with the metre in force */
    const bars = [];
    let mi2 = 0, tick = 0;
    while (tick <= lastTick && bars.length < 100000) {
      while (mi2 + 1 < meters.length && meters[mi2 + 1].tick <= tick) mi2++;
      const met = meters[mi2];
      const lenTicks = Math.max(1, Math.round(met.num * (4 / met.den) * ppq));
      const next = mi2 + 1 < meters.length ? meters[mi2 + 1].tick : Infinity;
      const end = Math.min(tick + lenTicks, next);
      bars.push({ tick: tick, endTick: end, num: met.num, den: met.den, meterIndex: mi2,
        dur: R.make(Math.round((end - tick) * met.den), Math.round(lenTicks * met.den / (met.num * (4 / met.den)) * (met.den / met.den)) || 1) });
      /* the measure's written length in W: (end - tick) ticks, a tick being 1/(4*ppq) of a whole note */
      bars[bars.length - 1].dur = R.make(end - tick, 4 * ppq);
      tick = end;
      if (end <= bars[bars.length - 1].tick) break;
    }
    if (!bars.length) bars.push({ tick: 0, endTick: Math.max(1, lastTick), num: 4, den: 4, meterIndex: 0, dur: R.make(1) });
    const barAt = t => {                       /* the bar a tick falls in, and where inside it */
      let lo = 0, hi = bars.length - 1;
      if (t <= 0) return { i: 0, at: R.ZERO };
      if (t >= bars[hi].endTick) return { i: hi, at: R.make(bars[hi].endTick - bars[hi].tick, 4 * ppq) };
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].tick <= t) lo = mid; else hi = mid - 1; }
      return { i: lo, at: R.make(t - bars[lo].tick, 4 * ppq) };
    };

    /* ---------------------------------------------------------- the parts */
    /* one per (track, channel) that sounds; the part list is in track then channel order */
    const programAt = new Map();               /* track|channel -> the first program it states */
    raw.programs.forEach(p => { const k = p.track + '|' + p.channel; if (!programAt.has(k)) programAt.set(k, p.program); });
    const trackName = new Map(raw.tracks.map(t => [t.index, t.name]));
    const voices = new Map();                  /* track|channel -> {track, channel, notes} */
    raw.notes.forEach(n => {
      const k = n.track + '|' + n.channel;
      if (!voices.has(k)) voices.set(k, { track: n.track, channel: n.channel, notes: [] });
      voices.get(k).notes.push(n);
    });
    const order = Array.from(voices.values()).sort((a, b) => a.track - b.track || a.channel - b.channel);

    const b = B.builder({ id: opts.scoreId || 'sg-midi', meta: metaOf(raw, trackName) });
    const src = { kind: 'midi-file', tool: 'scoregraph/midi-import.js' };
    if (opts.sourceName || opts.sourceSha256) {
      src.input = {};
      if (opts.sourceName) src.input.name = opts.sourceName;
      if (opts.sourceSha256) src.input.sha256 = opts.sourceSha256;
    }
    src.params = { format: raw.format, division: raw.division, tracks: raw.tracks.length };
    const sr = b.source(src);
    /* What the file says is imported; the grid below is ours, and says so (§12.3, DP3). */
    b.setDefault({ src: sr.id, op: 'imported' });
    /* only the op: the source is the file either way, and repeating it is I-PROV-REDUNDANT */
    const INFERRED = { op: 'inferred' };

    const measures = bars.map((bar, i) => b.measure({ number: String(i + 1), dur: R.format(bar.dur), prov: INFERRED }).id);
    meters.forEach((met, i) => {
      const at = barAt(met.tick);
      /* a metre change lands on the bar it starts; two in one bar keep the later one */
      if (i > 0 && barAt(meters[i - 1].tick).i === at.i) return;
      b.meter({ m: measures[at.i], beats: [met.num], beatType: met.den });
    });
    raw.tempoMap.forEach(t => {
      const at = barAt(t.tick);
      b.tempo({ m: measures[at.i], at: R.format(at.at), qpm: R.format(R.make(60000000, t.usPerQuarter)) });
    });
    raw.keyMap.forEach(k => {
      const at = barAt(k.tick);
      if (k.sf < -7 || k.sf > 7) return;
      b.key({ m: measures[at.i], at: R.format(at.at), fifths: k.sf, mode: k.mi ? 'minor' : 'major' });
    });

    const parts = order.map(v => {
      const program = programAt.get(v.track + '|' + v.channel);
      const inst = instrumentOf(program, v.channel);
      const instrument = { kind: inst.kind, family: inst.family };
      if (program != null) instrument.midi = { program: program + 1, channel: v.channel };
      else instrument.midi = { channel: v.channel };
      if (v.channel === 10) instrument.kit = { items: kitFor(v.notes, issue) };
      const name = trackName.get(v.track);
      const p = b.part({ instrument: instrument, prov: INFERRED });
      if (name) p.name = order.filter(o => o.track === v.track).length > 1 ? name + ' ch' + v.channel : name;
      else p.name = 'Track ' + (v.track + 1) + ' channel ' + v.channel;
      const st = b.staff(p, v.channel === 10 ? { kind: 'percussion' } : {});
      b.voice(p, { staff: st.id, label: '1' });
      b.clef(p, { staff: st.id, m: measures[0], at: '0',
        sign: v.channel === 10 ? 'percussion' : (median(v.notes) < 60 ? 'F' : 'G'),
        line: v.channel === 10 ? 2 : (median(v.notes) < 60 ? 4 : 2) });
      return { part: p, staff: st, v: v };
    });
    const partOf = new Map(parts.map(x => [x.v.track + '|' + x.v.channel, x.part.id]));

    /* ----------------------------------------------------- the performance */
    const pf = b.performance({ kind: 'source', src: sr.id, label: 'the MIDI file' });
    let zeroLength = 0;
    raw.notes.forEach(n => {
      const on = us(n.onTick), off = us(n.offTick);
      if (off <= on) { zeroLength++; return; }
      const x = { on: on, off: off, vel: Math.max(1, Math.min(127, n.onVel)), midi: n.midi,
        track: n.track, channel: n.channel };
      if (n.channel === 10) {
        x.part = partOf.get(n.track + '|' + n.channel);
        x.inst = GM_DRUM[n.midi] || 'note-' + n.midi;
        delete x.midi;
      }
      b.perfNote(pf, x);
    });
    if (zeroLength) issue('W-MIDI-NOTE-ZERO-LENGTH', zeroLength + ' note' + (zeroLength > 1 ? 's' : '') +
      ' start and stop at the same microsecond and are left out of the performance');

    /* every controller the file moved, exactly; the pedals below are the reading of three of them */
    raw.controls.forEach(c => b.perfControl(pf, { cc: c.cc, us: us(c.tick), value: c.value, channel: c.channel, track: c.track }));
    pedalSpans(raw, us).forEach(p => b.perfPedal(pf, p));

    /* the bridge between played time and written position */
    let lastUs = -1;
    bars.forEach((bar, i) => {
      const u = us(bar.tick);
      if (u <= lastUs) return;                 /* anchors increase strictly (E-PERF) */
      lastUs = u;
      b.anchor(pf, { m: measures[i], k: 1, at: '0', us: u, kind: 'bar' });
    });

    issue('W-MIDI-SKELETON', 'the notation is a grid this import made, not the file\'s: ' + measures.length +
      ' measure' + (measures.length > 1 ? 's' : '') + ' and ' + parts.length + ' part' + (parts.length > 1 ? 's' : '') +
      ', all marked inferred. The file states no note values, spelling, voices, hands or staves.');
    report.inferred = [
      { what: 'measures', count: measures.length, why: 'a graph needs a measure; the metre map decides where the bar lines fall' },
      { what: 'parts', count: parts.length, why: 'one per track and channel that sounds' },
      { what: 'staves', count: parts.length, why: 'one per part; a MIDI file does not say which hand plays what' },
      { what: 'clefs', count: parts.length, why: 'from the median pitch of the part' }
    ];
    const built = b.finish();
    report.validation = built.issues;
    return built.graph;
  }

  function metaOf(raw, trackName) {
    const meta = {};
    /* the first track's name is the piece's, the way a conductor track is written */
    const first = trackName.get(0);
    if (first && raw.tracks.length > 1) meta.title = first;
    raw.tracks.forEach(t => t.events.forEach(e => {
      if (e.kind !== 'meta') return;
      if (e.type === 'copyright' && meta.copyright === undefined) meta.copyright = e.text;
    }));
    return meta;
  }

  const median = notes => {
    const xs = notes.map(n => n.midi).sort((a, b) => a - b);
    return xs.length ? xs[xs.length >> 1] : 60;
  };

  /* CC 64, 66 and 67 read as spans: down at 64 or more, up below it. A pedal still down when the file
     ends is closed at the last note's release, the way an unclosed note is (§7.4). */
  function pedalSpans(raw, us) {
    const out = [];
    const open = new Map();
    const endUs = us(raw.endTick);
    raw.controls.forEach(c => {
      const kind = PEDAL_CC[c.cc];
      if (!kind) return;
      const key = c.track + '|' + c.channel + '|' + kind;
      const down = c.value >= PEDAL_DOWN;
      if (down && !open.has(key)) open.set(key, { on: us(c.tick), depth: c.value });
      else if (!down && open.has(key)) {
        const o = open.get(key);
        open.delete(key);
        const off = us(c.tick);
        if (off > o.on) out.push(span(kind, o, off));
      }
    });
    open.forEach((o, key) => { if (endUs > o.on) out.push(span(key.split('|')[2], o, endUs)); });
    return out.sort((a, b) => a.on - b.on || a.pedal.localeCompare(b.pedal));
  }
  function span(kind, o, off) {
    const x = { pedal: kind, on: o.on, off: off };
    if (o.depth < 127) x.depth = o.depth;      /* a pedal pressed part way says how far */
    return x;
  }

  /* The kit a channel-10 part plays: one item per note number it strikes, by the GM convention (§17.2). */
  function kitFor(notes, issue) {
    const seen = new Map();
    let unknown = 0;
    notes.forEach(n => {
      if (seen.has(n.midi)) return;
      const key = GM_DRUM[n.midi] || 'note-' + n.midi;
      const pos = GM_POS[n.midi] || ['C', 5];
      if (!GM_DRUM[n.midi]) unknown++;
      const item = { key: key, pos: { step: pos[0], oct: pos[1] } };
      if (GM_DRUM[n.midi]) item.name = GM_DRUM[n.midi].replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
      if (n.midi >= 27 && n.midi <= 87) item.gm = n.midi;
      if (NOTEHEAD[n.midi]) item.notehead = NOTEHEAD[n.midi];
      seen.set(n.midi, item);
    });
    if (unknown) issue('W-MIDI-DRUM-UNKNOWN', unknown + ' percussion note' + (unknown > 1 ? 's' : '') +
      ' are outside the General MIDI kit; they keep their note number as their name and sit on the middle line');
    return Array.from(seen.keys()).sort((a, b) => a - b).map(k => seen.get(k));
  }

  /* ------------------------------------------------------------ back out again
     A performance layer written back as a Standard MIDI File. This exists to measure fidelity (§9.2),
     not as a feature: a musical MIDI export belongs to a later Goal (§21).

     The grid is one tick per microsecond (1000 ticks a quarter at 1000 µs a quarter), because the
     performance layer's times are microseconds and any coarser grid would round them. That makes the
     file's printed tempo meaningless, which is exactly why this is a measuring tool. The tempo and
     metre the music actually has live in the graph's timeline, and that is where they are compared. */
  const EXPORT_PPQ = 1000;
  const EXPORT_UPQ = 1000;

  function exportMidi(graph, opts) {
    opts = opts || {};
    const perf = (graph.performances || []).find(p => (opts.performance ? p.id === opts.performance : p.kind === 'source'))
      || (graph.performances || [])[0];
    if (!perf) return { ok: false, code: 'MIDI-NO-NOTES', message: 'the graph has no performance to write' };
    const kitOf = new Map();
    graph.parts.forEach(p => ((p.instrument.kit && p.instrument.kit.items) || []).forEach(it => {
      if (it.gm !== undefined) kitOf.set(p.id + '|' + it.key, it.gm);
    }));

    const byTrack = new Map();
    const at = track => {
      if (!byTrack.has(track)) byTrack.set(track, []);
      return byTrack.get(track);
    };
    (perf.notes || []).forEach(n => {
      const track = n.track === undefined ? 0 : n.track;
      const channel = n.channel === undefined ? 1 : n.channel;
      let note = n.midi;
      if (note === undefined && n.inst !== undefined) note = kitOf.get(n.part + '|' + n.inst);
      if (note === undefined) return;
      at(track).push({ tick: n.on, kind: 'note-on', channel: channel, note: note, velocity: n.vel, zero: false });
      at(track).push({ tick: n.off, kind: 'note-off', channel: channel, note: note, velocity: 0, zero: false });
    });
    (perf.controls || []).forEach(c => at(c.track === undefined ? 0 : c.track).push({
      tick: c.us, kind: 'control', channel: c.channel === undefined ? 1 : c.channel, cc: c.cc, value: c.value }));

    const indexes = Array.from(byTrack.keys());
    if (!indexes.length) return { ok: false, code: 'MIDI-NO-NOTES', message: 'the performance holds no note' };
    /* A track number is a fact the note carries, so the file gets a chunk for every number up to the
       highest - an empty one where the source had a conductor track - and the numbers come back as
       they went in (§9.2). Track 0 carries the grid, the way a conductor track does. */
    const nTracks = Math.max.apply(null, indexes) + 1;
    const head = [{ tick: 0, kind: 'meta', type: 'tempo', code: 0x51, usPerQuarter: EXPORT_UPQ }];
    const tracks = [];
    for (let ti = 0; ti < nTracks; ti++) {
      const events = (ti === 0 ? head : []).concat((byTrack.get(ti) || []).sort((a, b) => a.tick - b.tick || order(a) - order(b)));
      tracks.push({ index: ti, events: events, endTick: events.length ? events[events.length - 1].tick : 0 });
    }
    const raw = { format: tracks.length > 1 ? 1 : 0, division: { kind: 'ppq', ppq: EXPORT_PPQ }, tracks: tracks,
      tempoMap: [{ tick: 0, usPerQuarter: EXPORT_UPQ }], meterMap: [], keyMap: [],
      notes: [], controls: [], programs: [], endTick: Math.max.apply(null, tracks.map(t => t.endTick)),
      usAt: t => t };
    return { ok: true, bytes: MF.writeMidi(raw), raw: raw };
  }
  /* a release is written before a press at the same instant, so a repeated note does not cancel itself */
  const order = e => (e.kind === 'note-off' ? 0 : e.kind === 'control' ? 1 : 2);

  return Object.freeze({ importMidi, exportMidi, CODES, REPORT_CODES, GM_DRUM, EXPORT_PPQ, EXPORT_UPQ });
});
