/* Shared helpers of tests/omr/normalize/*.test.js (omr/normalize.js, G12-1): a MusicXML BUILDER that writes the shapes Audiveris 5.11 writes
   (<print new-system>, <staves>, numbered clefs, <staff> and <voice> on every note, <backup> between voices, a width on every bar, the
   `divisions` on the first bar of a part only) and an independent READER that turns a document back into what a player hears: bars of notes
   with their onset and length in quarter notes, their staff and pitch. The tests build a page the way the engine would have split it, run the
   normaliser, and compare what the reader finds with the same music written as one grand staff. The reader does not share a line with
   omr/normalize.js (it uses only scoregraph/xml.js, the way the normaliser's own reader does). */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const XML = require(path.join(REPO, 'scoregraph', 'xml.js'));
const N = require(path.join(REPO, 'omr', 'normalize.js'));

const TYPE = { 8: 'breve', 4: 'whole', 2: 'half', 1: 'quarter', 0.5: 'eighth', 0.25: '16th', 0.125: '32nd' };
const STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/* a note: p 'C4' / 'F#3' / 'Bb2' (null = a rest); q the length in QUARTERS (the builder writes it in the part's divisions); v voice; s staff (only
   written when given); chord: sounds with the note before */
const note = (p, q, o) => Object.assign({ kind: 'note', p: p, q: q }, o || {});
const rest = (q, o) => note(null, q, o);
const back = q => ({ kind: 'backup', q: q });
const fwd = q => ({ kind: 'forward', q: q });
const raw = xml => ({ kind: 'raw', xml: xml });

function pitchXml(p) {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d)$/.exec(p);
  if (!m) throw new Error('bad pitch ' + p);
  const alter = m[2] ? (m[2][0] === '#' ? m[2].length : -m[2].length) : 0;
  return '<pitch><step>' + m[1] + '</step>' + (alter ? '<alter>' + alter + '</alter>' : '') + '<octave>' + m[3] + '</octave></pitch>';
}
function noteXml(n, div, staved) {
  const dur = Math.round(n.q * div);
  let s = '<note default-x="10">';
  if (n.grace) s += '<grace/>';
  if (n.chord) s += '<chord/>';
  s += n.p ? pitchXml(n.p) : '<rest' + (n.measure ? ' measure="yes"' : '') + '/>';
  if (!n.grace) s += '<duration>' + dur + '</duration>';
  const tieStop = n.tie === 'stop' || n.tie === 'both', tieStart = n.tie === 'start' || n.tie === 'both';
  if (tieStop) s += '<tie type="stop"/>';
  if (tieStart) s += '<tie type="start"/>';
  s += '<voice>' + (n.v || 1) + '</voice>';
  if (!n.noType) s += '<type>' + (n.type || (n.grace ? 'eighth' : TYPE[n.q]) || 'quarter') + '</type>';
  if (n.dot) s += '<dot/>';
  if (n.tm) s += '<time-modification><actual-notes>' + n.tm[0] + '</actual-notes><normal-notes>' + n.tm[1] + '</normal-notes></time-modification>';
  if (n.p && !n.chord) s += '<stem default-y="10">up</stem>';
  if (n.s || staved) s += '<staff>' + (n.s || 1) + '</staff>';
  if (tieStop || tieStart) s += '<notations>' + (tieStop ? '<tied type="stop"/>' : '') + (tieStart ? '<tied type="start"/>' : '') + '</notations>';
  return s + '</note>';
}
function clefXml(sign, line, number) {
  return '<clef' + (number ? ' number="' + number + '"' : '') + '><sign>' + sign + '</sign><line>' + line + '</line></clef>';
}
const CLEF_LINE = { G: 2, F: 4, C: 3 };

/* a bar. opts: div (divisions, written on this bar's attributes when given), key (fifths), time [beats, type], clefs ['G'] | ['G','F'] (written when given),
   staves (written when given), newSystem, print (a <print> without new-system), width, lead (extra leading XML), items [note|backup|forward|raw], tail (XML after the items),
   mid (XML of a mid-bar <attributes> placed after the items' first note) */
function bar(opts) {
  opts = opts || {};
  const div = opts.divForNotes || opts.div || 1;
  let s = '<measure number="' + (opts.number || 1) + '"' + (opts.width !== undefined ? ' width="' + opts.width + '"' : ' width="200"') + (opts.implicit ? ' implicit="yes"' : '') + '>';
  if (opts.newSystem) s += '<print new-system="yes"><system-layout><system-margins><left-margin>55</left-margin><right-margin>56</right-margin></system-margins><system-distance>79</system-distance></system-layout></print>';
  else if (opts.print) s += '<print><system-layout><top-system-distance>117</top-system-distance></system-layout><measure-numbering>system</measure-numbering></print>';
  const a = [];
  if (opts.div !== undefined) a.push('<divisions>' + opts.div + '</divisions>');
  if (opts.key !== undefined) a.push('<key><fifths>' + opts.key + '</fifths></key>');
  if (opts.time) a.push('<time><beats>' + opts.time[0] + '</beats><beat-type>' + opts.time[1] + '</beat-type></time>');
  if (opts.staves) a.push('<staves>' + opts.staves + '</staves>');
  if (opts.clefs) opts.clefs.forEach((c, i) => a.push(clefXml(c, CLEF_LINE[c] || 2, opts.clefs.length > 1 || opts.staves ? i + 1 : 0)));
  if (a.length) s += '<attributes>' + a.join('') + '<staff-details print-object="yes"></staff-details></attributes>';
  if (opts.lead) s += opts.lead;
  const staved = !!opts.staved;
  (opts.items || []).forEach((it, i) => {
    if (it.kind === 'note') s += noteXml(it, div, staved);
    else if (it.kind === 'backup') s += '<backup><duration>' + Math.round(it.q * div) + '</duration></backup>';
    else if (it.kind === 'forward') s += '<forward><duration>' + Math.round(it.q * div) + '</duration></forward>';
    else s += it.xml;
    if (i === 0 && opts.mid) s += opts.mid;
  });
  if (opts.tail) s += opts.tail;
  return s + '</measure>';
}

/* a part. bars: array of bar() strings, or of option objects (numbered 1.. in order; `div` is carried into the notes' durations from the first bar that has one) */
function part(id, bars, o) {
  let div = (o && o.div) || 1;
  const out = bars.map((b, i) => {
    if (typeof b === 'string') return b;
    if (b.div !== undefined) div = b.div;
    return bar(Object.assign({ number: i + 1, divForNotes: div }, b, { staved: b.staved !== undefined ? b.staved : !!(o && o.staved) }));
  });
  return '<part id="' + id + '">' + out.join('') + '</part>';
}
function doc(parts, o) {
  o = o || {};
  const list = parts.map((p, i) => '<score-part id="P' + (i + 1) + '"><part-name>' + (o.names ? o.names[i] : 'Voice') + '</part-name></score-part>').join('');
  const software = o.software === undefined ? 'Audiveris 5.11.0' : o.software;
  return (o.noDecl ? '' : '<?xml version="1.0" encoding="UTF-8"?>\n') + (o.doctype === false ? '' : '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0.3 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n') +
    '<score-partwise version="4.0.3"><movement-number>test</movement-number><identification><encoding><software>' + software + '</software></encoding></identification>' +
    '<part-list>' + list + '</part-list>' + parts.join('') + '</score-partwise>';
}

/* ---- the reader ---- */
function pitchOf(el) {
  const k = n => el.kids.find(x => x.name === n);
  const alter = k('alter') ? parseInt(k('alter').text, 10) : 0;
  return k('step').text.trim() + (alter > 0 ? '#'.repeat(alter) : alter < 0 ? 'b'.repeat(-alter) : '') + k('octave').text.trim();
}
/* {parts: [{staves, divisions: [per bar], bars: [{number, len, notes: [{p, on, dur, staff, voice, rest}], clefs, key, time}]}]} (quarters) */
const TYPEQ = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125 };
/* divisions per quarter of a part written with <divisions>0</divisions>: from the first note that has a type, no dot and a duration */
function inferDivisions(pe) {
  let found = null;
  const walk = e => {
    if (found !== null) return;
    if (e.name === 'note' && !e.kids.some(k => k.name === 'grace' || k.name === 'dot' || k.name === 'time-modification')) {
      const ty = e.kids.find(k => k.name === 'type'), du = e.kids.find(k => k.name === 'duration');
      if (ty && du && TYPEQ[ty.text.trim()] && parseFloat(du.text) > 0) { found = parseFloat(du.text) / TYPEQ[ty.text.trim()]; return; }
    }
    e.kids.forEach(walk);
  };
  walk(pe);
  return found === null ? 1 : found;
}
function read(xml) {
  const root = XML.parse(xml).root;
  const kid = (el, n) => el.kids.find(x => x.name === n);
  const out = { parts: [], header: root.kids.filter(k => k.name !== 'part' && k.name !== 'part-list').map(k => k.name) };
  root.kids.filter(k => k.name === 'part').forEach(pe => {
    const P = { id: pe.attrs.id, staves: 1, bars: [], divisionsSeen: [], backups: 0 };
    let div = 1, key = null, time = null;
    const clefs = {};
    pe.kids.filter(k => k.name === 'measure').forEach(me => {
      const B = { number: me.attrs.number, attrs: Object.assign({}, me.attrs), notes: [], keyChange: null, timeChange: null, clefChanges: {}, kids: me.kids.map(k => k.name), midClefs: 0, hasAttributes: false };
      let cur = 0, last = 0, content = false;
      me.kids.forEach(e => {
        if (e.name === 'attributes') {
          B.hasAttributes = true;
          e.kids.forEach(c => {
            if (c.name === 'divisions') { div = parseFloat(c.text); if (div === 0) div = inferDivisions(pe); P.divisionsSeen.push(div); }
            if (c.name === 'staves') P.staves = Math.max(P.staves, parseInt(c.text, 10));
            if (c.name === 'key') { key = parseInt(kid(c, 'fifths').text, 10); B.keyChange = key; }
            if (c.name === 'time') { time = kid(c, 'beats').text + '/' + kid(c, 'beat-type').text; B.timeChange = time; }
            if (c.name === 'clef') { const n = c.attrs.number || '1'; clefs[n] = kid(c, 'sign').text; B.clefChanges[n] = clefs[n]; if (content) B.midClefs++; }
          });
        } else if (e.name === 'backup') { content = true; cur -= parseFloat(kid(e, 'duration').text) / div; P.backups++; }
        else if (e.name === 'forward') { content = true; cur += parseFloat(kid(e, 'duration').text) / div; }
        else if (e.name === 'note') {
          content = true;
          const grace = !!kid(e, 'grace');
          const dur = grace ? 0 : parseFloat(kid(e, 'duration').text) / div;
          const tie = e.kids.filter(k => k.name === 'tie').map(k => k.attrs.type).sort().join('+');
          const chord = !!kid(e, 'chord');
          const isRest = !!kid(e, 'rest');
          const staff = kid(e, 'staff') ? parseInt(kid(e, 'staff').text, 10) : 1;
          P.staves = Math.max(P.staves, staff);
          B.notes.push({ p: isRest ? null : pitchOf(kid(e, 'pitch')), on: chord ? last : cur, dur: dur, staff: staff, voice: kid(e, 'voice') ? parseInt(kid(e, 'voice').text, 10) : 1, rest: isRest, chord: chord, grace: grace, tie: tie });
          if (!chord && !grace) { last = cur; cur += dur; }
        }
      });
      B.key = key; B.time = time; B.clefs = Object.assign({}, clefs); B.div = div;
      P.bars.push(B);
    });
    out.parts.push(P);
  });
  return out;
}
/* the sounding content of a bar as a comparable string: sorted "staff on dur pitch", rests left out */
const sig = (b, o) => b.notes.filter(n => !n.rest).map(n => (o && o.noStaff ? '' : n.staff + ' ') + n.on + ' ' + n.dur + ' ' + n.p + (n.chord ? ' chord' : '') + (n.grace ? ' grace' : '') + (n.tie ? ' tie:' + n.tie : '')).sort().join(' | ');
/* every sounding note of the documents as (pitch, onset in its bar, duration, tie, chord, grace) in quarters, whatever its bar, staff, part or voice: what normalisation may move but never change */
const multiset = texts => {
  const out = [];
  texts.forEach(t => read(t).parts.forEach(p => p.bars.forEach(b => b.notes.forEach(n => { if (!n.rest) out.push([n.p, n.on, n.dur, n.tie, n.chord ? 'chord' : '', n.grace ? 'grace' : ''].join('|')); }))));
  return out.sort();
};
const sigs = (p, o) => p.bars.map(b => sig(b, o));
const pitched = r => r.parts.reduce((s, p) => s + p.bars.reduce((t, b) => t + b.notes.filter(n => !n.rest).length, 0), 0);

/* the output of normalize() for the pages (each: a text, or an array of texts), as read */
function run(pages, opts) {
  const r = N.normalize(pages, opts);
  return Object.assign({ r: r }, r.ok ? { out: read(r.xml) } : {});
}

module.exports = { REPO, N, XML, note, rest, back, fwd, raw, bar, part, doc, read, sig, sigs, multiset, pitched, run, pitchXml, clefXml };
