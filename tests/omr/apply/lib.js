/* Shared helpers of tests/omr/apply/*.test.js (omr/apply.js, G12-2): a small piano graph, a stand-in for what PdfLayer.apply does to a Score (the same field
   changes as the page's code, written here as the spec of what a finding means), and the view of a Score that two Scores must share. The real PdfLayer is run by
   the browser suite (tests/omr-apply-app.test.js); here only the graph side is tested, so it can run in the gate. */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const A = require(path.join(REPO, 'omr', 'apply.js'));
const SC = require(path.join(REPO, 'tests', 'omr', 'normalize', 'scenarios.js'));

const clone = x => JSON.parse(JSON.stringify(x));

/* the music of SC.truthDoc: right hand four quarters a bar, left hand two halves, 4/4, bars [from, to) */
function graphOf(from, to) {
  const r = SG.musicxml.import(SC.truthDoc(from === undefined ? 0 : from, to === undefined ? 4 : to), { scoreId: 'apply-test', sourceName: 'page.pdf' });
  if (!r.ok) throw new Error('fixture graph: ' + r.message);
  return r.graph;
}
const scoreOf = g => SG.legacy.toScore(g, { name: 'page.pdf', ids: true });

const STEP_OF = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOf = p => { const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d+)$/.exec(p); return (parseInt(m[3], 10) + 1) * 12 + STEP_OF[m[1]] + (m[2] ? (m[2][0] === '#' ? m[2].length : -m[2].length) : 0); };
const nameOf = (step, alter, oct) => step + (alter > 0 ? '#'.repeat(alter) : alter < 0 ? 'b'.repeat(-alter) : '') + oct;
function setAlter(n, alter) {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d+)$/.exec(n.p);
  n.p = nameOf(m[1], alter, m[3]);
  n.midi = midiOf(n.p);
}
function shiftOctave(n, octaves) {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d+)$/.exec(n.p);
  n.p = m[1] + (m[2] || '') + (parseInt(m[3], 10) + octaves);
  n.midi = midiOf(n.p);
}

/* what PdfLayer.apply does, field by field (App: PdfLayer.apply): each helper mutates the Score the way its numbered step does */
const PDF = {
  /* 2. an accidental printed before a note holds for the rest of the bar: that note and the later ones of the same letter and octave without a mark of their own */
  accidental(score, note, kind) {
    const want = kind === 'sharp' ? 1 : kind === 'flat' ? -1 : 0;
    const base = /^([A-G])(#{1,2}|b{1,2})?(-?\d+)$/.exec(note.p);
    setAlter(note, want);
    note.acc = kind;
    score.notes.forEach(x => {
      if (x === note || x.m !== note.m || x.b <= note.b + 1e-6 || x.acc || x.rest) return;
      const r = /^([A-G])(#{1,2}|b{1,2})?(-?\d+)$/.exec(x.p);
      if (r && r[1] === base[1] && r[3] === base[3] && (x.staff || 1) === (note.staff || 1)) setAlter(x, want);
    });
  },
  /* 1. notes the page has only an arpeggio line for: they go, and what followed them in that voice moves back */
  phantom(score, notes) {
    const head = notes[0], d = Math.max(0, head.dur || 0);
    const gone = new Set(notes);
    score.notes.forEach(n => {
      if (gone.has(n) || (n.staff || 1) !== (head.staff || 1) || (n.voice || 1) !== (head.voice || 1) || n.m !== head.m || n.b <= head.b + 1e-6) return;
      n.b = Math.max(head.b, n.b - d);
    });
    score.notes = score.notes.filter(n => !gone.has(n));
  },
  /* 4. a voice started late: its notes from the first one on move back by `shift` quarters */
  realign(score, voiceNotes, shift) {
    voiceNotes.forEach(n => { n.b = Math.max(0, n.b - shift); });
  },
  /* 3. the arpeggio on the chord at one beat of one staff */
  arpeggio(score, notes) { notes.forEach(n => { n.arp = true; }); },
  /* 8va and 8vb: the notes under the bracket sound an octave away, and the bracket is recorded */
  ottava(score, o, notes) {
    notes.forEach(n => shiftOctave(n, o.dir * (o.size >= 15 ? 2 : 1)));
    score.ottavas = (score.ottavas || []).concat([Object.assign({ semitones: o.dir * 12 * (o.size >= 15 ? 2 : 1) }, o)]);
  },
  chords(score, covered, list) { score.chords = (score.chords || []).filter(c => covered.indexOf(c.m) < 0).concat(list); },
  marks(score, covered, list) { score.marks = (score.marks || []).filter(k => covered.indexOf(k.m) < 0).concat(list); },
  heading(score, h) { Object.assign(score, h); }
};

/* snapshot, run a script on the scratch Score, return both sides */
function runDouble(graph, script) {
  const scratch = scoreOf(graph);
  const before = clone(scratch);
  script(scratch, PDF);
  return { before: before, after: scratch };
}

/* what two Scores must share: the notes (place, pitch, printed accidental, arpeggio), the chord names, the marks, the 8va brackets as the notes they cover, the heading */
function view(score) {
  const notes = score.notes.filter(n => !n.rest).map(n => [n.m, Math.round(n.b * 1e4) / 1e4, n.staff || 1, n.voice || 1, n.p, n.acc || '', n.arp ? 'arp' : '', n.hand].join('|')).sort();
  const covers = (score.ottavas || []).map(o => {
    const a = score.notes.length && o.m, z = o.endM;
    const inside = score.notes.filter(n => !n.rest && (o.staff === null || o.staff === undefined || (n.staff || 1) === o.staff)
      && (n.m > o.m || (n.m === o.m && n.b >= o.b - 1e-6)) && (n.m < z || (n.m === z && n.b < o.endB - 1e-6)));
    return [o.m, o.b, o.size, o.dir, o.staff, inside.map(n => n.m + ':' + n.b).join(',')].join('|');
  }).sort();
  const sortC = l => (l || []).map(c => c.m + '|' + Math.round(c.b * 1e4) / 1e4 + '|' + c.text).sort();
  const marks = (score.marks || []).map(k => k.m + '|' + k.kind + '|' + (k.text === undefined || k.text === null ? '' : k.text)).sort();
  return { notes: notes, covers: covers, chords: sortC(score.chords), marks: marks, title: score.title, composer: score.composer, tempo: score.tempo };
}

/* a note of the Score by bar, staff, beat */
const noteAt = (score, m, staff, b) => score.notes.find(n => !n.rest && n.m === m && (n.staff || 1) === staff && Math.abs(n.b - b) < 1e-6);
const notesAt = (score, m, staff, b) => score.notes.filter(n => !n.rest && n.m === m && (n.staff || 1) === staff && Math.abs(n.b - b) < 1e-6);

module.exports = { REPO, SG, A, SC, clone, graphOf, scoreOf, PDF, runDouble, view, noteAt, notesAt, setAlter, shiftOctave, midiOf };
