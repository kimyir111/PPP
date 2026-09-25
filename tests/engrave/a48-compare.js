/* G04 A48: the strict comparison of two legacy Scores, shared by tests/engrave/a48.test.js (Node) and
   tests/engrave/tools/a48-coverage.js (the page), so both gates read the same fields the same way.

   fieldsThatDiffer(L, a, b) -> sorted list of what differs ('notes.writtenP', 'measures', 'wedges', ...), [] when the
   two Scores state the same music. Every note field the app keeps - written and sounding pitch, the microtone
   approximation, the 8va shift, positions - the measures, every list and the Score's ottavaRule; notes as multisets
   (which of two simultaneous notes the app sorts first is not music); nothing rounded but floating noise (1e-9). L is
   PPPScoreGraph.legacy (its field lists). */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPPA48 = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const EXTRA_NOTE_FIELDS = ['writtenP', 'writtenMidi', 'approx', 'soundingMidi', 'ottavaShift', 'abs'];
  const r9 = v => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v);
  const val = v => (v === undefined || v === null || v === false ? null : r9(v));
  /* a nested value read as music: keys in one order, numbers without floating noise (a clef change at beat
     1.9999999999999998 is at beat 2; a barline's keys in another order are the same barline) */
  function canon(v) {
    if (typeof v === 'number') return r9(v);
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { o[k] = canon(v[k]); }); return o; }
    return v === undefined ? null : v;
  }
  const J = v => JSON.stringify(canon(v));

  /* What belongs to a chord is read at the chord, as agree() reads it (legacy-score.js chordLevel, G4-F8): MusicXML
     writes a chord's tuplet bracket, slur ends, accent and note dynamic on one <note>, the app's reader keeps it on
     that note and toScore on every head - which note carries it is order, not music; whether the chord has it is
     compared. `chord` then says only that the note is one of a chord of more than one. */
  const CHORD_FLAGS = ['tupletStart', 'tupletStop', 'slurStart', 'slurStop', 'accent', 'marcato'];
  const soft = v => Math.round((+v || 0) * 1e6);
  function atChord(notes) {
    const out = notes.map(n => Object.assign({}, n));
    const groups = new Map();
    out.forEach(n => {
      if (n.rest || n.p === null || n.p === undefined) return;
      const k = n.m + '|' + soft(n.b) + '|' + (n.voice || 1) + '|' + soft(n.dur);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    });
    groups.forEach(g => {
      CHORD_FLAGS.forEach(f => { const v = g.some(n => n[f]); g.forEach(n => { n[f] = v; }); });
      const withDyn = g.find(n => n.dyn !== undefined && n.dyn !== null);
      g.forEach(n => { n.dyn = withDyn ? withDyn.dyn : null; n.chord = g.length > 1; });
    });
    return out;
  }

  function fieldsThatDiffer(L, a, b) {
    const NOTE_FIELDS = L.NOTE_SCALARS.concat(EXTRA_NOTE_FIELDS);
    const out = new Set();
    const notes = s => atChord(s.notes || []).map(n => NOTE_FIELDS.map(f => [f, val(n[f])]).concat([['tm', n.tm ? [n.tm.a, n.tm.n] : null]]));
    const na = notes(a), nb = notes(b);
    if (na.length !== nb.length) out.add('notes.count');
    const key = x => JSON.stringify(x);
    const sa = na.map(key).sort(), sb = nb.map(key).sort();
    for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
      if (sa[i] === sb[i]) continue;
      const x = JSON.parse(sa[i]), y = JSON.parse(sb[i]);
      x.forEach((fv, k) => { if (JSON.stringify(fv[1]) !== JSON.stringify(y[k][1])) out.add('notes.' + fv[0]); });
    }
    /* measure by measure, named by field, so an allowed loss in one field hides nothing in another */
    const MF = L.MEASURE_SCALARS.concat(['startQ']).concat(L.MEASURE_OBJECTS);
    const ma = a.measures || [], mb = b.measures || [];
    if (ma.length !== mb.length) out.add('measures.count');
    for (let i = 0; i < Math.min(ma.length, mb.length); i++) MF.forEach(f => { if (J(ma[i][f]) !== J(mb[i][f])) out.add('measures.' + f); });
    L.SCORE_LISTS.forEach(k => {
      /* an 8va's `number` pairs its ends while a file is read and means nothing after (compare() skips it too) */
      const s = l => (l || []).map(x => J(Object.keys(x).filter(f => f !== 'number').reduce((o, f) => { o[f] = x[f]; return o; }, {}))).sort();
      if (JSON.stringify(s(a[k])) !== JSON.stringify(s(b[k]))) out.add(k);
    });
    if (val(a.staves) !== val(b.staves)) out.add('staves');
    /* the rule the pitch layers were made by (MX-1 fixer, M1): finalize marks every Score it reads afresh, a rebuilt one
       too, so both sides of every Score A48 holds carry it; a Score saved before MX-1 has none, and its rebuild - its own
       music read again under D-1 - is marked (tests/scoregraph/app-playback.test.js) */
    if (val(a.ottavaRule) !== val(b.ottavaRule)) out.add('ottavaRule');
    return Array.from(out).sort();
  }

  /* a loss is known when fromScore named its code and it changed only the fields that code explains */
  function knownLoss(rule, codes, fields) {
    return !!rule && codes.indexOf(rule.code) >= 0 && fields.every(f => rule.fields.indexOf(f) >= 0);
  }

  return Object.freeze({ EXTRA_NOTE_FIELDS, fieldsThatDiffer, knownLoss });
});
