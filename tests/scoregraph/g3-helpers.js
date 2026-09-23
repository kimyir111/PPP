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
   "5" on the lower, like audio-score; rh2 and lh2 add second voices "2" and "6"). render(graph) gives back the same
   language, one string per staff, a staff's voices joined by " // ". */
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
  /* second voices: rh2 on the upper staff (label 2), lh2 on the lower (label 6), written after the first ones */
  [['rh2', 0, '2'], ['lh2', 1, '6']].forEach(([k, si, label]) => {
    if (spec[k] === undefined) return;
    lines.push(spec[k]); staves.push(staves[si]); voices.push(b.voice(part, { staff: staves[si], label: label }).id);
  });
  const ms = durs.map((d, i) => b.measure(Object.assign({ number: String(i + 1), dur: R.format(d) }, spec.implicitFirst && i === 0 ? { implicit: true } : {})).id);
  b.meter(Object.assign({ m: ms[0], beats: [time[0]], beatType: time[1] }, spec.groups ? { groups: spec.groups } : {}));
  if (spec.key !== null) b.key({ m: ms[0], at: '0', fifths: (spec.key || {}).fifths || 0, mode: (spec.key || {}).mode || 'major' });
  /* more key signatures: [{bar (0-based), fifths, mode}] */
  (spec.keys || []).forEach(k => b.key({ m: ms[k.bar], at: '0', fifths: k.fifths, mode: k.mode || 'major' }));
  b.tempo({ m: ms[0], at: '0', qpm: '120' });
  Array.from(new Set(staves)).forEach((st, i) => b.clef(part, { staff: st, m: ms[0], at: '0', sign: i === 0 ? 'G' : 'F' }));
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
  /* grace notes: [{staff: 0|1, bar, at, pitch, type}], before the main note at that position */
  (spec.graces || []).forEach(x => {
    b.event(part, { kind: 'note', m: ms[x.bar || 0], at: x.at, dur: '0', voice: voices[x.staff || 0], staff: staves[x.staff || 0],
      grace: { order: 1, slash: true }, display: { type: x.type || 'eighth' }, heads: [{ pitch: parsePitch(x.pitch) }] });
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
  const tups = part.spanners.filter(s => s.type === 'tuplet');
  const tupById = new Map(tups.map(t => [t.id, t]));
  const depth = t => { let d = 0, p = t; while (p && p.parent !== undefined && d < 16) { p = tupById.get(p.parent); d++; } return d; };
  tups.forEach(t => t.events.forEach(id => { if (!tupOf.has(id)) tupOf.set(id, []); tupOf.get(id).push(t); }));
  /* the ratio a tuplet stands for with its parents: [actual product, normal product] */
  const chain = t => { let a = 1, n = 1, x = t, k = 0; while (x && k++ < 16) { a *= x.actual; n *= x.normal; x = x.parent !== undefined ? tupById.get(x.parent) : null; } return [a, n]; };
  const mark = t => (t.actual === 3 && t.normal === 2 ? '3' : t.actual + ':' + t.normal) + (t.unit ? UNIT_CODE[t.unit.type] || t.unit.type : '') + '[';
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
        const ts = (tupOf.get(e.id) || []).slice().sort((a, b) => depth(a) - depth(b));
        const inner = ts.length ? ts[ts.length - 1] : null;
        let s = '';
        ts.forEach(t => { if (t.events[0] === e.id) s += mark(t); });
        const d = e.display || {};
        s += e.kind === 'rest' ? 'r' : e.heads.map(h => pitchText(h.pitch)).join('+');
        s += ':' + (d.type ? TYPE_CODE[d.type] || d.type : '?') + '.'.repeat(d.dots || 0);
        const shown = d.type ? SG.schema.noteValue(d.type, d.dots) : null;
        const ratio = inner ? chain(inner) : null;
        const expectDur = shown && ratio ? R.mul(shown, R.make(ratio[1], ratio[0])) : shown;
        if (!expectDur || !R.eq(expectDur, R.parse(e.dur))) s += '=' + e.dur;
        if (e.kind === 'note' && e.heads.some(h => tieOut.has(h.id))) s += '~';
        ts.slice().reverse().forEach(t => { if (t.events[t.events.length - 1] === e.id) s += ']'; });
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

/* Run a fixture spec ({input: {…mk spec} | {musicxml: path under fixtures/}, passes?: [names], mode?, opts?}):
   {input, output, report}. With passes, only those G3 passes run. */
const PASS_NAMES = ['staff', 'voice', 'rhythm', 'tuplet', 'spell', 'beam', 'marks'];
function specGraph(spec) {
  if (spec.input.musicxml) {
    const fs = require('fs'), path = require('path');
    const text = fs.readFileSync(path.join(__dirname, 'fixtures', spec.input.musicxml), 'utf8');
    const r = SG.musicxml.import(text, { scoreId: 'fixture' });
    if (!r.ok) throw new Error('import failed: ' + r.code);
    return r.graph;
  }
  return mk(spec.input);
}
function runSpec(spec, extra) {
  const input = specGraph(spec);
  const opts = Object.assign({ strict: true }, spec.opts || {}, extra || {});
  if (spec.mode) opts.mode = spec.mode;
  if (spec.passes) { opts.passes = {}; PASS_NAMES.forEach(n => { opts.passes[n] = spec.passes.indexOf(n) >= 0; }); }
  const r = SG.professionalize(input, opts);
  return { input: input, output: r.graph, report: r.report };
}

/* The tuplet brackets the app draws for a MusicXML file: the grouping rule of buildVoice in Piano Coach App.dc.html
   (a group runs until a <tuplet type="start"> opens another, a stop closes it, or its notes fill the time they stand
   for; a group of one note gets no bracket), replayed on the file per part, measure and voice. */
function appBrackets(xmlText) {
  const doc = SG.xml.parse(xmlText).root;
  const kids = (n, name) => n.kids.filter(k => k.name === name);
  const kid = (n, name) => n.kids.find(k => k.name === name);
  const txt = (n, name, d) => { const k = n && kid(n, name); return k ? k.text.trim() : d; };
  const TYPE_Q = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625 };
  let count = 0, divisions = 1;
  kids(doc, 'part').forEach(part => {
    kids(part, 'measure').forEach(meas => {
      const voices = new Map();
      let cursor = 0, last = 0;
      meas.kids.forEach(el => {
        if (el.name === 'attributes') { const d = txt(el, 'divisions', null); if (d) divisions = Number(d); return; }
        if (el.name === 'backup') { cursor -= Number(txt(el, 'duration', '0')) / divisions; return; }
        if (el.name === 'forward') { cursor += Number(txt(el, 'duration', '0')) / divisions; return; }
        if (el.name !== 'note' || kid(el, 'grace')) return;
        const dur = Number(txt(el, 'duration', '0')) / divisions;
        if (kid(el, 'chord')) return;
        const tmEl = kid(el, 'time-modification');
        const tm = tmEl ? { a: Number(txt(tmEl, 'actual-notes', '0')), n: Number(txt(tmEl, 'normal-notes', '0')) } : null;
        const nots = kids(el, 'notations').reduce((a, n) => a.concat(kids(n, 'tuplet')), []);
        const v = txt(el, 'voice', '1') + '|' + txt(el, 'staff', '1');
        if (!voices.has(v)) voices.set(v, []);
        voices.get(v).push({ b: cursor, next: cursor + dur, tm: tm && tm.a > 0 && tm.n > 0 && tm.a !== tm.n ? tm : null, type: txt(el, 'type', null),
          start: nots.some(t => t.attrs.type === 'start'), stop: nots.some(t => t.attrs.type === 'stop') });
        last = cursor; cursor += dur;
      });
      void last;
      voices.forEach(drawn => {
        let tr = [], trFrom = 0, trTm = null, trUnit = 1;
        const close = () => { if (tr.length > 1 && trTm) count++; tr = []; trTm = null; trUnit = 1; };
        drawn.forEach(d => {
          const tm = d.tm;
          if (!tm || (trTm && (tm.a !== trTm.a || tm.n !== trTm.n)) || d.start) close();
          if (!tm) return;
          if (!tr.length) { trFrom = d.b; trTm = tm; }
          tr.push(d);
          const unit = TYPE_Q[d.type] || 0.5;
          trUnit = tr.length === 1 ? unit : Math.min(trUnit, unit);
          const filled = d.next - trFrom >= trTm.n * trUnit - 0.02;
          if (d.stop || filled) close();
        });
        close();
      });
    });
  });
  return count;
}

/* The printed accidentals of a staff's heads, per measure, in time order and lowest head first: [['', 'sharp',
   '(natural)' …], …] ('' none, a cautionary one in brackets). */
function accs(g, staffIdx) {
  const p = g.parts[0], st = p.staves[staffIdx].id;
  const mi = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
  const out = g.timeline.measures.map(() => []);
  p.events.filter(e => e.kind === 'note' && e.staff === st && !e.grace)
    .sort((a, b) => mi.get(a.m) - mi.get(b.m) || R.cmp(R.parse(a.at), R.parse(b.at)))
    .forEach(e => e.heads.slice().sort((a, b) => SG.pitch.midi(a.pitch) - SG.pitch.midi(b.pitch)).forEach(h => {
      out[mi.get(e.m)].push(!h.acc ? '' : h.acc.cautionary ? '(' + h.acc.type + ')' : h.acc.type);
    }));
  return out;
}

module.exports = { mk, render, parseLine, pitchText, parsePitch, headIndex, runSpec, specGraph, appBrackets, accs, PASS_NAMES };
