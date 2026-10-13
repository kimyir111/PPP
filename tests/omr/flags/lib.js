/* Shared helpers of tests/omr/flags/*.test.js (omr/flags.js, G12-3): a small piano score written as MusicXML (so the graph is what scoregraph/import.js makes,
   the same door the OMR path uses), the graph made from it, and the parameters that make one signal the only one that counts. */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const importer = require(path.join(REPO, 'scoregraph', 'import.js'));
const F = require(path.join(REPO, 'omr', 'flags.js'));

const DIV = 12;                                             /* divisions per quarter: a triplet eighth is 4, a 16th 3 */
const TYPES = [[4, 'whole', 0], [3, 'half', 1], [2, 'half', 0], [1.5, 'quarter', 1], [1, 'quarter', 0], [0.75, 'eighth', 1], [0.5, 'eighth', 0], [0.25, '16th', 0]];
const STEP_ALTER = { C: [0, 0], D: [1, 0], E: [2, 0], F: [3, 0], G: [4, 0], A: [5, 0], B: [6, 0] };

/* ---- note specs: n('C4', 1) a quarter C; n(['C4', 'E4'], 2) a half chord; r(1) a quarter rest; gap(1) a quarter of nothing (a <forward>) */
const n = (p, q, o) => Object.assign({ p: Array.isArray(p) ? p : [p], q: q }, o || {});
const r = (q, o) => Object.assign({ rest: true, q: q }, o || {});
const gap = q => ({ gap: true, q: q });
const measureRest = q => ({ rest: true, q: q, measure: true });

function pitchXml(p) {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d+)$/.exec(p);
  if (!m) throw new Error('pitch ' + p);
  const alter = m[2] ? (m[2][0] === '#' ? m[2].length : -m[2].length) : 0;
  return '<pitch><step>' + m[1] + '</step>' + (alter ? '<alter>' + alter + '</alter>' : '') + '<octave>' + m[3] + '</octave></pitch>';
}
function typeOf(q, tuplet) {
  if (tuplet) { const base = q * 3 / 2; const t = TYPES.find(x => x[0] === base && !x[2]); if (!t) throw new Error('tuplet value ' + q); return t; }
  const t = TYPES.find(x => x[0] === q);
  if (!t) throw new Error('no note value for ' + q + ' quarters');
  return t;
}
/* one voice of one staff for one bar */
function voiceXml(specs, staff, voice) {
  let out = '', total = 0;
  specs.forEach(s => {
    const dur = Math.round(s.q * DIV);
    total += dur;
    if (s.gap) { out += '<forward><duration>' + dur + '</duration></forward>'; return; }
    const tup = s.tuplet ? s.tuplet : null;                                   /* 'start' | 'stop' | 'mid' */
    const t = s.measure ? ['whole', 0] : typeOf(s.q, !!s.tuplet).slice(1);
    const attrs = s.x !== undefined ? ' default-x="' + s.x + '"' : '';
    (s.rest ? [null] : s.p).forEach((p, k) => {
      out += '<note' + attrs + '>' + (k ? '<chord/>' : '') + (s.rest ? '<rest' + (s.measure ? ' measure="yes"' : '') + '/>' : pitchXml(p))
        + '<duration>' + dur + '</duration><voice>' + voice + '</voice><type>' + t[0] + '</type>' + (t[1] ? '<dot/>' : '')
        + (s.tuplet ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' : '')
        + '<staff>' + staff + '</staff>'
        + (tup && tup !== 'mid' && !k ? '<notations><tuplet type="' + tup + '"/></notations>' : '') + '</note>';
    });
  });
  return { xml: out, total: total };
}
/* bars: [{ rh: [specs], lh: [specs], rh2: [specs] (a second voice on the right hand), rh3, lh2, ...}]. opts: time [beats, type], fifths, pickup (the first bar's quarters) */
function doc(bars, opts) {
  opts = opts || {};
  const time = opts.time || [4, 4], fifths = opts.fifths || 0;
  let xml = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">';
  bars.forEach((b, i) => {
    xml += '<measure number="' + (i + 1) + '"' + (i === 0 && opts.pickup ? ' implicit="yes"' : '') + (b.width ? ' width="' + b.width + '"' : '') + '>' + (b.newSystem ? '<print new-system="yes"/>' : '');
    if (i === 0) xml += '<attributes><divisions>' + DIV + '</divisions><key><fifths>' + fifths + '</fifths></key><time><beats>' + time[0] + '</beats><beat-type>' + time[1] + '</beat-type></time><staves>2</staves>'
      + '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>';
    const lines = [['rh', 1, 1], ['rh2', 1, 2], ['rh3', 1, 3], ['lh', 2, 5], ['lh2', 2, 6]].filter(x => b[x[0]]);
    let first = true;
    lines.forEach(([key, staff, voice]) => {
      if (!first) xml += '<backup><duration>' + prevTotal + '</duration></backup>';
      const v = voiceXml(b[key], staff, voice);
      xml += v.xml;
      prevTotal = v.total;
      first = false;
    });
    xml += '</measure>';
  });
  return xml + '</part></score-partwise>';
}
let prevTotal = 0;

/* a bar of four quarters on each hand: the right hand C5 D5 E5 F5, the left hand C3 G3 C3 G3 (plain, in range, in the key of C) */
const plainBar = (o) => Object.assign({ rh: [n('C5', 1), n('D5', 1), n('E5', 1), n('F5', 1)], lh: [n('C3', 1), n('G3', 1), n('C3', 1), n('G3', 1)] }, o || {});
const plainBars = (count, edits) => {
  const out = [];
  for (let i = 0; i < count; i++) out.push(plainBar(edits && edits[i + 1] ? edits[i + 1] : null));
  return out;
};

const cache = new Map();
async function graphOf(xml) {
  if (!cache.has(xml)) {
    const got = await importer.importFile(Buffer.from(xml, 'utf8'), { name: 'flags-test.musicxml' });
    if (!got.ok) throw new Error('fixture does not import: ' + (got.code || '') + ' ' + (got.message || ''));
    cache.set(xml, got.graph);
  }
  return cache.get(xml);
}
const clone = g => JSON.parse(JSON.stringify(g));

/* the parameters that make `code` the only signal, strong, with the default thresholds */
const only = (code, strength, extra) => Object.assign({ strong: strength === 'weak' ? [] : [code], weak: strength === 'weak' ? [code] : [], weakNeeded: 1, thr: Object.assign({}, F.PARAMS.thr) }, extra || {});
const suspectOf = res => res.suspect.slice();

module.exports = { REPO, F, importer, n, r, gap, measureRest, doc, plainBar, plainBars, graphOf, clone, only, suspectOf, DIV };
