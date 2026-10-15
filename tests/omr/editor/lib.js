/* Shared helpers of tests/omr/editor/*.test.js (omr/edit-ops.js, omr/editor.js, G12-4): a small piano score written as MusicXML from a short description,
   the checks every edit must pass (a valid graph, the Score from toScore agrees with it, the same graph from a serialise and a parse), and a seeded random. */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const OPS = require(path.join(REPO, 'omr', 'edit-ops.js'));

const DIV = 16;                                                  /* divisions: a quarter is 16, a 64th is 1 */
const VAL = { whole: 64, half: 32, quarter: 16, eighth: 8, '16th': 4, '32nd': 2, '64th': 1 };
const ALTER = { '#': 1, b: -1, x: 2 };

/* a note: 'C5/quarter', 'F#4/eighth.' (a dot), 'Bb3/half', with options {acc: 'sharp'} to print an accidental, chord: true, tie: 'start' | 'stop' | 'both'; a rest: 'r/quarter' */
function note(spec, o) {
  o = o || {};
  const m = /^(r|[A-G])([#bx]?)(\d?)\/(\w+)(\.{0,2})$/.exec(spec);
  if (!m) throw new Error('bad note ' + spec);
  return { rest: m[1] === 'r', step: m[1], alter: ALTER[m[2]] || 0, oct: m[3] === '' ? null : +m[3], type: m[4], dots: m[5].length, acc: o.acc || null, chord: !!o.chord, tie: o.tie || null };
}
const len = n => VAL[n.type] * (n.dots === 2 ? 1.75 : n.dots === 1 ? 1.5 : 1);
function noteXml(n, staff, voice) {
  const dur = len(n);
  if (!Number.isInteger(dur)) throw new Error('not a whole number of 64ths: ' + n.type);
  let x = '<note>';
  if (n.chord) x += '<chord/>';
  if (n.rest) x += '<rest/>';
  else x += '<pitch><step>' + n.step + '</step>' + (n.alter ? '<alter>' + n.alter + '</alter>' : '') + '<octave>' + n.oct + '</octave></pitch>';
  x += '<duration>' + dur + '</duration>';
  if (n.tie === 'start' || n.tie === 'both') x += '<tie type="start"/>';
  if (n.tie === 'stop' || n.tie === 'both') x += '<tie type="stop"/>';
  x += '<voice>' + voice + '</voice><type>' + n.type + '</type>' + '<dot/>'.repeat(n.dots);
  if (n.acc) x += '<accidental>' + n.acc + '</accidental>';
  x += '<staff>' + staff + '</staff>';
  if (n.tie) x += '<notations>' + (n.tie === 'start' || n.tie === 'both' ? '<tied type="start"/>' : '') + (n.tie === 'stop' || n.tie === 'both' ? '<tied type="stop"/>' : '') + '</notations>';
  return x + '</note>';
}
const sum = list => list.filter(n => !n.chord).reduce((s, n) => s + len(n), 0);

/* bars: [{rh: [notes], lh: [notes]}]; opts: {fifths, beats, beatType, trebleLh} */
function xmlOf(bars, opts) {
  opts = opts || {};
  const beats = opts.beats || 4, bt = opts.beatType || 4;
  let x = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>Test</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">';
  bars.forEach((b, i) => {
    x += '<measure number="' + (i + (opts.first === undefined ? 1 : opts.first)) + '">';
    if (i === 0) {
      x += '<attributes><divisions>' + DIV + '</divisions><key><fifths>' + (opts.fifths || 0) + '</fifths></key><time><beats>' + beats + '</beats><beat-type>' + bt + '</beat-type></time><staves>2</staves>'
        + '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>' + (opts.trebleLh ? 'G' : 'F') + '</sign><line>' + (opts.trebleLh ? 2 : 4) + '</line></clef></attributes>';
    }
    (b.rh || []).forEach(n => { x += noteXml(n, 1, 1); });
    const rhLen = sum(b.rh || []);
    if (rhLen > 0 && (b.lh || []).length) x += '<backup><duration>' + rhLen + '</duration></backup>';
    (b.lh || []).forEach(n => { x += noteXml(n, 2, 5); });
    x += '</measure>';
  });
  return x + '</part></score-partwise>';
}
function graphOf(bars, opts) {
  const r = SG.musicxml.import(xmlOf(bars, opts), { scoreId: 'editor-test', sourceName: 'page.xml' });
  if (!r.ok) throw new Error('fixture: ' + r.code + ' ' + r.message);
  return r.graph;
}
const N = note;
const q = (p, o) => N(p + '/quarter', o), h = (p, o) => N(p + '/half', o), w = (p, o) => N(p + '/whole', o), e8 = (p, o) => N(p + '/eighth', o);
const rq = () => N('r/quarter'), rh = () => N('r/half'), rw = () => N('r/whole');

/* nbars of 4/4: the right hand four quarters C D E F, the left hand a whole note */
function plain(nbars, opts) {
  const bars = [];
  for (let i = 0; i < (nbars || 4); i++) bars.push({ rh: [q('C5'), q('D5'), q('E5'), q('F5')], lh: [w('C3')] });
  return graphOf(bars, opts);
}

/* the graph's events of a bar k (0-based): [{id, kind, at, dur, voice, staff, pitches, heads, display}], time order */
function barOf(g, k) {
  const m = g.timeline.measures[k];
  const out = [];
  g.parts.forEach(p => p.events.forEach(e => {
    if (e.m !== m.id) return;
    out.push({ id: e.id, kind: e.kind, at: e.at, dur: e.dur, voice: e.voice, staff: e.staff, grace: !!e.grace,
      pitches: (e.heads || []).map(hh => hh.pitch.step + (hh.pitch.alter > 0 ? '#'.repeat(hh.pitch.alter) : hh.pitch.alter < 0 ? 'b'.repeat(-hh.pitch.alter) : '') + hh.pitch.oct),
      heads: (e.heads || []).map(hh => hh.id), display: e.display });
  }));
  const R = SG.rational;
  out.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)) || a.staff.localeCompare(b.staff) || a.id.localeCompare(b.id));
  return out;
}
const notesOf = (g, k) => barOf(g, k).filter(e => e.kind === 'note' && !e.grace);
const names = list => list.map(e => e.pitches.join('+'));

/* what every edit must leave: the validator is satisfied, the Score the app plays is the graph's (compare() on both), the bytes survive a serialise and a parse */
function check(g, label) {
  const bad = [];
  const v = SG.validate(g);
  if (!v.ok) bad.push('invalid: ' + v.issues.filter(i => i.severity === 'ERROR').slice(0, 3).map(i => i.code + ' ' + i.message).join('; '));
  let score = null;
  try { score = SG.legacy.toScore(g, { name: 'x', ids: true }); } catch (e) { bad.push('toScore threw: ' + e.message); }
  if (score) {
    const ag = SG.legacy.agree(score, g);
    if (!ag.ok) bad.push('agree: ' + JSON.stringify(ag.diffs && ag.diffs[0]));
    const lk = SG.legacy.link(score, g);
    if (!lk.ok) bad.push('link: ' + JSON.stringify(lk.mismatch));
  }
  const text = SG.serialize(g);
  let again = null;
  try { again = SG.serialize(SG.parse(text)); } catch (e) { bad.push('parse threw: ' + e.message); }
  if (again !== null && again !== text) bad.push('serialise/parse differs');
  return bad.length ? (label ? label + ': ' : '') + bad.join(' | ') : null;
}

/* a small seeded random (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
module.exports = { REPO, SG, OPS, N, note, q, h, w, e8, rq, rh, rw, xmlOf, graphOf, plain, barOf, notesOf, names, check, rng };
