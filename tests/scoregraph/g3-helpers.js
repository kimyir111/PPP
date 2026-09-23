/* G3 test helpers: a small notation language for hand-written graphs and for reading a graph back
   (docs/GOALS/G03 §6.3, §7.4, §9.4, §10.4, §11.3 fixtures).

   A staff line is its measures separated by "|"; a measure is tokens separated by spaces:

     C5:q        a quarter C5                    r:8      an eighth rest
     C5+E5:h.    a chord, dotted half            C5:8~    tied to the next note of its voice
     r:8=1/12    a rest printed as an eighth that lasts 1/12 (issue 19)
     3e[ … ]     a 3:2 tuplet with unit eighth around the tokens (3q quarter, 3s 16th, 3[ no unit)
     C5:8@h1     a head with limb, fingering or accidental extras are not needed by these tests
   Codes: w h q 8 16 32 64, a dot per "."; inside a 3:2 group a value lasts 2/3 of its printed value.

   mk(spec) builds a frozen, validated graph (one part, a voice per staff: label "1" on the upper staff,
   "5" on the lower, like audio-score). render(graph) gives back the same language, one string per staff. */
'use strict';
const { SG } = require('./helpers.js');
const R = SG.rational;

const CODE = { w: 'whole', h: 'half', q: 'quarter', '8': 'eighth', '16': '16th', '32': '32nd', '64': '64th' };
const TYPE_CODE = {};
Object.keys(CODE).forEach(k => { TYPE_CODE[CODE[k]] = k; });
const UNIT = { e: 'eighth', q: 'quarter', s: '16th', h: 'half' };
const UNIT_CODE = { eighth: 'e', quarter: 'q', '16th': 's', half: 'h' };
const STEP = /^([A-G])(#{1,2}|b{1,2})?(-?\d)$/;

function parsePitch(t) {
  const m = STEP.exec(t);
  if (!m) throw new Error('bad pitch ' + t);
  const alter = !m[2] ? 0 : m[2][0] === '#' ? m[2].length : -m[2].length;
  return alter ? { step: m[1], alter: alter, oct: Number(m[3]) } : { step: m[1], oct: Number(m[3]) };
}
function pitchText(p) {
  const a = p.alter || 0;
  return p.step + (a > 0 ? '#'.repeat(a) : a < 0 ? 'b'.repeat(-a) : '') + p.oct;
}

/* one staff line -> [{m (index), at, dur, kind, pitches, display, tie, group}] and its tuplet groups */
function parseLine(line, measureDurs) {
  const bars = line.split('|').map(s => s.trim());
  const items = [], groups = [];
  bars.forEach((bar, mi) => {
    let at = R.ZERO, group = null;
    const toks = bar.length ? bar.split(/\s+/) : [];
    toks.forEach(tok0 => {
      let tok = tok0;
      const open = /^3([eqsh]?)\[(.*)$/.exec(tok);
      if (open) { group = { unit: open[1] ? UNIT[open[1]] : null, items: [] }; groups.push(group); tok = open[2]; if (!tok) return; }
      let close = false;
      if (tok.endsWith(']')) { close = true; tok = tok.slice(0, -1); }
      const m = /^([^:]+):(w|h|q|8|16|32|64)(\.*)(?:=(-?[0-9/]+))?(~?)$/.exec(tok);
      if (!m) throw new Error('bad token ' + tok0);
      const type = CODE[m[2]], dots = m[3].length;
      let dur = SG.schema.noteValue(type, dots);
      if (group) dur = R.mul(dur, R.make(2, 3));
      if (m[4]) dur = R.parse(m[4]);
      const it = { m: mi, at: at, dur: dur, kind: m[1] === 'r' ? 'rest' : 'note', display: dots ? { type: type, dots: dots } : { type: type },
        tie: m[5] === '~', pitches: m[1] === 'r' ? null : m[1].split('+').map(parsePitch), group: group };
      items.push(it);
      if (group) group.items.push(it);
      at = R.add(at, dur);
      if (close) group = null;
    });
    if (measureDurs && !R.eq(at, measureDurs[mi])) throw new Error('measure ' + (mi + 1) + ' of "' + line + '" lasts ' + R.format(at) + ', not ' + R.format(measureDurs[mi]));
  });
  return { items: items, groups: groups };
}

/* spec: {time: [4, 4], durs?: ['1', …], key?: {fifths, mode}, op?: 'inferred'|'imported'|'edited', rh: '…', lh?: '…',
          perf?: true (a source performance with a note linked to every sounding head), id?} */
function mk(spec) {
  const time = spec.time || [4, 4];
  const bar = R.make(time[0], time[1]);
  const nBars = (spec.rh || '').split('|').length;
  const durs = (spec.durs || Array.from({ length: nBars }, () => R.format(bar))).map(R.parse);
  const b = SG.builder({ id: spec.id || 'g3-fixture', meta: { title: 'G3 fixture' } });
  const src = b.source({ kind: spec.op === 'imported' ? 'musicxml' : 'audio-score' });
  b.setDefault({ src: src.id, op: spec.op || 'inferred' });
  const part = b.part({ name: 'Piano', instrument: { kind: 'piano', family: 'keyboard' } });
  const lines = [spec.rh, spec.lh].filter(x => x !== undefined);
  const staves = lines.map((_, i) => b.staff(part, { limb: i === 0 ? 'RH' : 'LH' }).id);
  const voices = lines.map((_, i) => b.voice(part, { staff: staves[i], label: i === 0 ? '1' : '5' }).id);
  const ms = durs.map((d, i) => b.measure(Object.assign({ number: String(i + 1), dur: R.format(d) }, spec.implicitFirst && i === 0 ? { implicit: true } : {})).id);
  b.meter(Object.assign({ m: ms[0], beats: [time[0]], beatType: time[1] }, spec.groups ? { groups: spec.groups } : {}));
  if (spec.key !== null) b.key({ m: ms[0], at: '0', fifths: (spec.key || {}).fifths || 0, mode: (spec.key || {}).mode || 'major' });
  b.tempo({ m: ms[0], at: '0', qpm: '120' });
  staves.forEach((st, i) => b.clef(part, { staff: st, m: ms[0], at: '0', sign: i === 0 ? 'G' : 'F' }));
  const perf = spec.perf ? b.performance({ kind: 'source', src: src.id }) : null;
  const ties = [], tupl = [], linked = [];
  lines.forEach((line, si) => {
    const { items, groups } = parseLine(line, durs);
    let pending = null;
    items.forEach(it => {
      const x = { kind: it.kind, m: ms[it.m], at: R.format(it.at), dur: R.format(it.dur), voice: voices[si], staff: staves[si], display: it.display };
      if (it.kind === 'note') x.heads = it.pitches.map(p => ({ pitch: p }));
      const ev = b.event(part, x);
      it.id = ev.id;
      if (it.kind === 'note') {
        const start = !pending;
        if (pending) ev.heads.forEach(h => { const from = pending.find(f => SG.pitch.midi(f.pitch) === SG.pitch.midi(h.pitch)); if (from) ties.push({ from: from.id, to: h.id }); });
        if (start) ev.heads.forEach(h => linked.push({ h: h, m: it.m, at: it.at, dur: it.dur }));
        pending = it.tie ? ev.heads : null;
      }
    });
    groups.forEach(gr => tupl.push(Object.assign({ type: 'tuplet', events: gr.items.map(i => i.id), actual: 3, normal: 2 }, gr.unit ? { unit: { type: gr.unit } } : {})));
  });
  ties.forEach(t => b.spanner(part, Object.assign({ type: 'tie' }, t)));
  tupl.forEach(t => b.spanner(part, t));
  if (perf) {
    /* 120 qpm: a whole note is 2 s */
    let starts = [R.ZERO];
    durs.forEach((d, i) => { starts.push(R.add(starts[i], d)); });
    linked.forEach(l => {
      const w = R.add(starts[l.m], l.at);
      const on = Math.round(R.toNumber(w) * 2000000), off = on + Math.round(R.toNumber(l.dur) * 2000000) - 1000;
      b.perfNote(perf, { on: on, off: Math.max(on + 1, off), vel: 64, midi: SG.pitch.midi(l.h.pitch), link: l.h.id });
    });
  }
  return b.finish().graph;
}

/* A graph back into the language: one string per staff of the first part, voices of a staff joined by " // ". */
function render(g, opts) {
  opts = opts || {};
  const part = g.parts[0];
  const tieOut = new Set(part.spanners.filter(s => s.type === 'tie' && s.from && s.to).map(s => s.from));
  const tupOf = new Map();
  part.spanners.filter(s => s.type === 'tuplet').forEach(t => t.events.forEach(id => tupOf.set(id, t)));
  const mIdx = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
  const out = [];
  part.staves.forEach(st => {
    const vs = part.voices.filter(v => v.staff === st.id);
    const perVoice = vs.map(v => {
      const evs = part.events.filter(e => e.voice === v.id && !e.grace)
        .sort((a, b) => mIdx.get(a.m) - mIdx.get(b.m) || R.cmp(R.parse(a.at), R.parse(b.at)));
      const bars = g.timeline.measures.map(() => []);
      let open = null;
      evs.forEach(e => {
        const t = tupOf.get(e.id);
        let s = '';
        if (t && t.events[0] === e.id) s += '3' + (t.unit ? UNIT_CODE[t.unit.type] || '?' : '') + '[';
        const d = e.display || {};
        s += e.kind === 'rest' ? 'r' : e.heads.map(h => pitchText(h.pitch)).join('+');
        s += ':' + (d.type ? TYPE_CODE[d.type] || d.type : '?') + '.'.repeat(d.dots || 0);
        const shown = d.type ? SG.schema.noteValue(d.type, d.dots) : null;
        const expectDur = shown && t ? R.mul(shown, R.make(t.normal, t.actual)) : shown;
        if (!expectDur || !R.eq(expectDur, R.parse(e.dur))) s += '=' + e.dur;
        if (e.kind === 'note' && e.heads.some(h => tieOut.has(h.id))) s += '~';
        if (t && t.events[t.events.length - 1] === e.id) s += ']';
        bars[mIdx.get(e.m)].push(s);
        void open;
      });
      return bars.map(b => b.join(' ')).join(' | ');
    });
    out.push(perVoice.join(' // '));
  });
  return opts.join ? out.join('\n') : out;
}

/* The heads of a graph by pitch text and onset, for ID checks: "m1@1/4 C5" -> head ID */
function headIndex(g) {
  const out = {};
  g.parts.forEach(p => p.events.forEach(e => (e.heads || []).forEach(h => { out[e.m + '@' + e.at + ' ' + pitchText(h.pitch)] = h.id; })));
  return out;
}

module.exports = { mk, render, parseLine, pitchText, parsePitch, headIndex };
