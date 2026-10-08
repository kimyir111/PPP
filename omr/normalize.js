/* ============================================================================
   PPP OMR normaliser (docs/GOALS/G12_OMR.md section 7.1, phase G12-1 "Keep what the engine read")

   normalize(pages, opts?) -> { ok, xml, pages, report }

   What an OMR engine writes is not always what it read. Audiveris 5.11, measured on 480 pages (tests/omr, G12-0), loses the music
   of a page in four ways that have nothing to do with recognising symbols; this module puts each back, in MusicXML, before the
   file is imported, and says what it did. It is pure (no DOM, no network, no clock): Node and browser, UMD, the one dependency is
   scoregraph/xml.js (the ScoreGraph's own safe reader: a DOCTYPE is skipped, never interpreted).

   Input: one entry per page image, in page order. An entry is
       null                a page the engine could not read
       "<score-partwise>"  one MusicXML document
       ["<..>", "<..>"]    the movements of the page, in order (Audiveris starts a new "movement" at an indented system and
                           exports one file for each: page.mvt1.mxl, page.mvt2.mxl)
   (pagesFromHelper(body) makes this from the helper's /omr answer: its `movements` field, or its old `musicxml` field.)

   The rules, each counted and reported (report.changes, one line each):
     movements     every movement of every page is kept and joined in order (the old helper kept one file a page)
     divisions     a part whose <divisions> is 0 (Audiveris writes that on a page whose shortest value is a half note: every half
                   note is then read as a quarter) gets them from the notes' own <type>: duration / value of the type, the value
                   most notes agree on; durations are scaled to whole numbers. None to read it from: the bars are flagged
                   `divisions-unknown` and the file is read as before
     ghosts        a part that holds no pitched note while another part of the movement does is a ghost (Audiveris keeps a
                   piano part of rests where it read the page's other systems as other parts): dropped
     grand staff   two adjacent parts of one staff each, a G clef over another, are one piano: one part of two staves
                   (<staff> 1 and 2, a <backup> between them). Audiveris reads a page system by system and may put one system in
                   the two-staff part and the next in two one-staff parts, the rest of each part holding whole-bar rests: the
                   groups (a two-staff part, or such a pair) that never have notes in the same bar are one piano, and each bar
                   comes from the group that has its notes. Groups that do share bars (a trio, four voices on four staves) are
                   a score of several parts, not a fragmented piano: they are left as they are and flagged
     systems       one part of one staff that is a run of systems that alternate G clef, F clef, G clef, F clef ... with the
                   same number of bars in each pair is a grand staff read as single staves (a page whose staves no bar line
                   joins): the pairs are folded to two staves, so 16 bars of one staff become 8 bars of two (issue 12)
     zero length   a note whose <duration> is 0 (Audiveris writes <rest measure="yes"/> with <duration>0</duration> for the whole-bar rest of a bar
                   it read nothing in: the ScoreGraph importer refuses such a file, E-DURATION) lasts what it should: a whole-bar rest the bar (beats
                   x 4 / beat-type quarters of the time signature in force), any other note its own <type> (a plain, undotted note). A rest of
                   length 0 did not move the cursor, so what follows it in the bar (the other staff's whole-bar rest, which Audiveris writes with
                   no <backup> between) begins where the rest began: a repaired whole-bar rest that is followed by other content of the bar gets a
                   <backup> of its own length, so the bar is not doubled; one followed by a note of its own voice and staff (a bar the engine
                   read as empty and as full at once) is not repaired. Counted apart for rests and for pitched notes (zeroRestsRepaired,
                   zeroNotesRepaired; flag duration-repaired) and reported. A zero note with no length to be read is left as it was and counted
                   (zeroRestsLeft, zeroNotesLeft; flag duration-zero). No pitched note is dropped
     wedges        a hairpin the engine wrote with its start and stop at one place (a crescendo and a diminuendo read as one mark: start, start,
                   stop, stop) is a wedge that ends where it starts, which the importer refuses (E-SPAN-ORDER). The wedges that do not pair into
                   a wedge of positive length, in a part that has such a pair, are removed (the importer would drop the unpaired ones itself,
                   and a degenerate pair removed alone would let its neighbour pair with a later stop: a mark the page does not show). A hairpin
                   is a mark, never a note. Counted (wedgesDropped, wedgesDegenerate, flag wedge-dropped) and reported
     pages         pages are joined by part AFTER the rules above, so a page whose parts were fragmented differently from page
                   1 lines up; bars are renumbered 1..N; key, time and clef changes are written where they happen
     bar count     a page whose output bar count differs from the bar count its own layout shows (opts.pageBars[i]) is reported
                   and its bars flagged

   It never invents notes and never changes a pitch, an onset or a value, except the one a repaired <divisions> corrects. What it
   drops is counted: ghost parts (no pitched note), and in a bar that two groups both have notes in, the smaller group's notes
   (report.counts.droppedNotes). report.flags maps an output bar number to the signals that bar carries (G12-3 weighs them):
     movement-start  first bar of a movement after the first of its page
     divisions-repaired, divisions-unknown, pair-merged (the bar comes from two one-staff parts), source-switch (the bar's group
     differs from the previous bar's), overlap (two groups had notes here), parts-fragmented (parts the rules could not join),
     folded (the bar comes from a system pair), bar-count, duration-repaired, duration-zero, wedge-dropped

   Deterministic, idempotent in structure (a normalised file normalises to itself), no recursion on input depth beyond the XML's.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../scoregraph/xml.js'));
  else root.PPPOmrNormalize = factory(root.PPPScoreGraphModules && root.PPPScoreGraphModules.xml);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (XML) {
  'use strict';
  if (!XML) throw new Error('omr/normalize.js needs scoregraph/xml.js to be loaded first');

  const VERSION = 2;
  const MAX_DIVISIONS = 5040;     /* the lcm of every divisions of a document may not pass this (96 is the largest seen) */
  const OVERLAP_MAX = 0.25;       /* groups that share more than this share of their bars are parts of a score, not one piano */
  const TYPE_Q = {
    maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125,
    '64th': 0.0625, '128th': 0.03125, '256th': 0.015625, '512th': 0.0078125, '1024th': 0.00390625
  };
  const LEAD_BEFORE_STAFF = ['beam', 'notations', 'lyric', 'play', 'footnote', 'level'];

  /* ---- a small element toolkit over scoregraph/xml.js's {name, attrs, kids, text} ---- */
  const kid = (el, name) => { for (let i = 0; i < el.kids.length; i++) if (el.kids[i].name === name) return el.kids[i]; return null; };
  const kidsOf = (el, name) => el.kids.filter(k => k.name === name);
  const textOf = (el, name) => { const k = kid(el, name); return k ? k.text.trim() : null; };
  const mk = (name, attrs, content) => ({ name: name, attrs: attrs || {}, kids: Array.isArray(content) ? content : [], text: typeof content === 'string' ? content : '' });
  function clone(el) { return { name: el.name, attrs: Object.assign({}, el.attrs), kids: el.kids.map(clone), text: el.text }; }
  const num = s => { const v = parseFloat(s); return isFinite(v) ? v : null; };
  const gcd = (a, b) => { while (b) { const t = a % b; a = b; b = t; } return a; };
  const lcm = (a, b) => (a / gcd(a, b)) * b;

  function ser(el, out) {
    const top = !out;
    out = out || [];
    out.push('<' + el.name);
    for (const k in el.attrs) if (Object.prototype.hasOwnProperty.call(el.attrs, k)) out.push(' ' + k + '="' + XML.attr(el.attrs[k]) + '"');
    if (el.kids.length) { out.push('>'); el.kids.forEach(k => ser(k, out)); out.push('</' + el.name + '>'); }
    else if (el.text !== '') out.push('>' + XML.esc(el.text) + '</' + el.name + '>');
    else out.push('/>');
    return top ? out.join('') : out;
  }
  /* what makes two clef / key / time elements "the same" (not their number attribute) */
  const clefSig = c => (textOf(c, 'sign') || '') + '|' + (textOf(c, 'line') || '') + '|' + (textOf(c, 'clef-octave-change') || '');
  const keySig = k => ser(k);
  const timeSig = t => ser(t);

  /* a kid that has to sit at a place in MusicXML's order: replace its text, or insert before the first of `before` */
  function setKid(el, name, text, before) {
    const k = kid(el, name);
    if (k) { k.text = text; return; }
    let at = el.kids.length;
    if (before) for (let i = 0; i < el.kids.length; i++) if (before.indexOf(el.kids[i].name) >= 0) { at = i; break; }
    el.kids.splice(at, 0, mk(name, {}, text));
  }

  /* ---- reading a part: its bars, the state (divisions, key, time, clefs) at the start of each, its notes ---- */
  function applyAttributes(st, e) {
    e.kids.forEach(c => {
      if (c.name === 'divisions') { const d = num(c.text); if (d != null) st.div = d; }
      else if (c.name === 'key') st.key = { s: keySig(c), el: c };
      else if (c.name === 'time') st.time = { s: timeSig(c), el: c };
      else if (c.name === 'staves') { const v = parseInt(c.text, 10); if (v > 0) st.staves = v; }
      else if (c.name === 'clef') st.clefs[c.attrs.number || '1'] = { s: clefSig(c), el: c };
    });
  }
  const snap = st => ({ div: st.div, key: st.key, time: st.time, clefs: Object.assign({}, st.clefs) });

  /* the smallest k with d * k a whole number, and that number (divisions are whole numbers for every reader) */
  function wholeScale(d) {
    for (let k = 1; k <= 64; k++) {
      const v = d * k;
      if (Math.abs(v - Math.round(v)) < 1e-9 && Math.round(v) >= 1) return { k: k, D: Math.round(v) };
    }
    return null;
  }

  function analysePart(el, idx) {
    const part = { idx: idx, el: el, id: el.attrs.id || ('P' + (idx + 1)), staves: 1, bars: [], pitched: 0, notes: 0,
      zero: false, zeroFix: null, unknownDivisions: false };
    const st = { div: undefined, key: null, time: null, clefs: {}, staves: 1 };
    const samples = new Map();
    let zeroTotal = 0;
    kidsOf(el, 'measure').forEach(m => {
      const bar = { el: m, pitched: 0, notes: 0, newSystem: false, start: null, end: null, zero: false, k: 1, D: 1, divAtStart: undefined, maxVoice: 0 };
      let content = false;
      m.kids.forEach(e => {
        const n = e.name;
        if (n === 'print') { if (e.attrs['new-system'] === 'yes' || e.attrs['new-page'] === 'yes') bar.newSystem = true; }
        else if (n === 'attributes') applyAttributes(st, e);
        else if (n === 'note' || n === 'backup' || n === 'forward') {
          if (!content) { content = true; bar.start = snap(st); bar.divAtStart = st.div; }
          if (n !== 'note') return;
          bar.notes++;
          if (kid(e, 'pitch')) bar.pitched++;
          const sf = parseInt(textOf(e, 'staff'), 10);
          if (sf > part.staves) part.staves = sf;
          const vo = parseInt(textOf(e, 'voice'), 10);
          if (vo > bar.maxVoice) bar.maxVoice = vo;
          if (st.div === 0 && !kid(e, 'grace')) {
            const ty = textOf(e, 'type'), du = num(textOf(e, 'duration'));
            if (ty && TYPE_Q[ty] && du > 0 && !kid(e, 'dot') && !kid(e, 'time-modification')) {
              zeroTotal++;
              const d = du / TYPE_Q[ty];
              samples.set(d, (samples.get(d) || 0) + 1);
            }
          }
        }
      });
      if (!content) { bar.start = snap(st); bar.divAtStart = st.div; }
      bar.end = snap(st);
      bar.zero = bar.divAtStart === 0;
      if (bar.zero) part.zero = true;
      if (st.staves > part.staves) part.staves = st.staves;
      part.pitched += bar.pitched;
      part.notes += bar.notes;
      part.bars.push(bar);
    });
    if (st.staves > part.staves) part.staves = st.staves;
    /* divisions: a zero is read from the notes' own types */
    if (part.zero) {
      let best = null, bestN = 0;
      samples.forEach((n, d) => { if (n > bestN) { best = d; bestN = n; } });
      const fix = best && bestN / zeroTotal >= 0.5 ? wholeScale(best) : null;
      if (fix) part.zeroFix = { d: best, k: fix.k, D: fix.D, support: bestN / zeroTotal, samples: zeroTotal };
      else part.unknownDivisions = true;
    }
    part.bars.forEach(b => {
      let s = null;
      if (b.zero) s = part.zeroFix ? { k: part.zeroFix.k, D: part.zeroFix.D } : { k: 1, D: 1 };
      else if (b.divAtStart != null) s = wholeScale(b.divAtStart);
      if (s) { b.k = s.k; b.D = s.D; }
    });
    part.firstClef = n => { for (let i = 0; i < part.bars.length; i++) { const c = part.bars[i].start.clefs[n]; if (c) return c; } return null; };
    return part;
  }

  function readDoc(text) {
    const root = XML.parse(text).root;
    if (root.name === 'score-timewise') throw new Error('score-timewise: re-export as score-partwise');
    if (root.name !== 'score-partwise') throw new Error('not a MusicXML score-partwise file (' + root.name + ')');
    const parts = kidsOf(root, 'part').map((p, i) => analysePart(p, i));
    return { root: root, parts: parts };
  }

  /* ---- groups: a two-staff part, a pair of one-staff parts (G over another clef), or a lone one-staff part ---- */
  function pairable(p, q) {
    const c = p.firstClef('1');
    return !!c && c.s.split('|')[0] === 'G' && Math.abs(p.bars.length - q.bars.length) <= 1;
  }
  function makeGroups(parts) {
    const groups = [];
    for (let i = 0; i < parts.length;) {
      const p = parts[i], q = parts[i + 1];
      let g;
      if (p.staves === 2) { g = { kind: 'grand', parts: [p] }; i++; }
      else if (p.staves === 1 && q && q.staves === 1 && pairable(p, q)) { g = { kind: 'pair', parts: [p, q] }; i += 2; }
      else { g = { kind: 'single', parts: [p] }; i++; }
      g.len = Math.max.apply(null, g.parts.map(x => x.bars.length));
      g.pitched = g.parts.reduce((s, x) => s + x.pitched, 0);
      g.pitchedAt = b => g.parts.reduce((s, x) => s + (x.bars[b] ? x.bars[b].pitched : 0), 0);
      groups.push(g);
    }
    return groups;
  }

  /* a grand staff read as single staves: one part of one staff whose systems alternate G, F, G, F with equal pairs of lengths.
     Returns a pair group made of the two virtual parts (the G runs joined, the F runs joined), or null. */
  function foldSystems(part) {
    if (part.staves !== 1 || part.bars.length < 2) return null;
    const starts = [];
    part.bars.forEach((b, i) => { if (i === 0 || b.newSystem) starts.push(i); });
    if (starts.length < 2 || starts.length % 2) return null;
    const runs = starts.map((s, i) => ({ from: s, to: i + 1 < starts.length ? starts[i + 1] : part.bars.length }));
    const upper = [], lower = [];
    for (let i = 0; i < runs.length; i += 2) {
      const a = runs[i], b = runs[i + 1];
      if (a.to - a.from !== b.to - b.from) return null;
      const ca = part.bars[a.from].start.clefs['1'], cb = part.bars[b.from].start.clefs['1'];
      if (!ca || !cb || ca.s.split('|')[0] !== 'G' || cb.s.split('|')[0] !== 'F') return null;
      const ta = part.bars[a.from].start.time, tb = part.bars[b.from].start.time;
      if (ta && tb && ta.s !== tb.s) return null;
      for (let j = a.from; j < a.to; j++) upper.push(part.bars[j]);
      for (let j = b.from; j < b.to; j++) lower.push(part.bars[j]);
    }
    const virtual = bars => Object.assign({}, part, { bars: bars, folded: true, pitched: bars.reduce((s, x) => s + x.pitched, 0), staves: 1,
      firstClef: n => { const c = bars[0].start.clefs[n]; return c || null; } });
    const g = { kind: 'pair', parts: [virtual(upper), virtual(lower)], folded: true, runs: runs.length };
    g.len = upper.length;
    g.pitched = part.pitched;
    g.pitchedAt = b => (upper[b] ? upper[b].pitched : 0) + (lower[b] ? lower[b].pitched : 0);
    return g;
  }

  /* the length of a whole bar in the output's divisions, from the time signature in force at its start (null when it has none, or a mixed
     or unmeasured one, or the length is not a whole number of divisions) */
  function barLength(pbar, dOut) {
    const t = pbar.start && pbar.start.time && pbar.start.time.el;
    if (!t || kidsOf(t, 'beats').length !== 1 || kidsOf(t, 'beat-type').length !== 1) return null;
    const bt = num(textOf(t, 'beat-type'));
    let beats = 0;
    const parts = String(textOf(t, 'beats') || '').split('+');
    for (let i = 0; i < parts.length; i++) { const v = num(parts[i]); if (v == null || v <= 0) return null; beats += v; }
    if (!(bt > 0)) return null;
    const len = (beats * 4 / bt) * dOut;
    return len >= 1 && Math.abs(len - Math.round(len)) < 1e-9 ? Math.round(len) : null;
  }
  /* a note of length 0: repaired in place (c is the converted copy) or counted as left; fx collects the answer */
  function fixZeroDuration(c, pbar, dOut, fx) {
    const d = kid(c, 'duration');
    if (!d) return;
    const v = num(d.text);
    if (v == null || v > 0) return;
    const r = kid(c, 'rest');
    let len = null, how = null;
    if (r && r.attrs.measure === 'yes') { len = barLength(pbar, dOut); how = 'measure-rest'; }
    else {
      const ty = textOf(c, 'type');
      if (ty && TYPE_Q[ty] && !kid(c, 'dot') && !kid(c, 'time-modification') && !kid(c, 'grace')) {
        const q = TYPE_Q[ty] * dOut;
        if (q >= 1 && Math.abs(q - Math.round(q)) < 1e-9) { len = Math.round(q); how = 'type'; }
      }
    }
    if (len) {
      d.text = String(len);
      fx.repaired++;
      if (r) fx.rests++; else fx.notes++;
      fx.how[how] = (fx.how[how] || 0) + 1;
      if (how === 'measure-rest') fx.list.push({ el: c, d: d, len: len });
    } else { fx.left++; if (r) fx.leftRests++; else fx.leftNotes++; }
  }
  /* The whole-bar rests repaired in a bar, once the bar's elements are all in (body). A rest of length 0 had not moved the cursor; with its length it does:
     whatever the bar holds after it would start a bar late. A <backup> of the rest's length restores the place the elements after it always had. Notes of the
     rest's own voice and staff after it would play at the same time as the rest (a bar that is empty and full at once): the repair is withdrawn, the zero stays,
     counted as left and said (fx.refused) - the importer will refuse the document and say so. */
  function settleMeasureRests(body, fx) {
    const key = e => (textOf(e, 'voice') || '') + '|' + (textOf(e, 'staff') || '');
    fx.list.forEach(r => {
      const at = body.indexOf(r.el);
      if (at < 0) return;
      const later = body.slice(at + 1);
      if (later.some(e => e.name === 'note' && key(e) === key(r.el))) {
        r.d.text = '0';
        fx.repaired--; fx.rests--; fx.left++; fx.leftRests++; fx.refused++;
        fx.how['measure-rest']--;
        if (!fx.how['measure-rest']) delete fx.how['measure-rest'];
        return;
      }
      if (later.some(e => e.name === 'note' || e.name === 'forward')) {
        body.splice(at + 1, 0, mk('backup', {}, [mk('duration', {}, String(r.len))]));
        fx.backups++;
      }
    });
  }
  const newFixes = () => ({ repaired: 0, left: 0, rests: 0, notes: 0, leftRests: 0, leftNotes: 0, backups: 0, refused: 0, how: {}, list: [] });
  function addFixes(a, b) {
    if (!b) return a;
    ['repaired', 'left', 'rests', 'notes', 'leftRests', 'leftNotes', 'backups', 'refused'].forEach(k => { a[k] += b[k]; });
    Object.keys(b.how).forEach(k => { a.how[k] = (a.how[k] || 0) + b.how[k]; });
    return a;
  }
  /* what a bar's fixes add to its flags */
  function flagFixes(bo) {
    if (!bo.fixes) return;
    if (bo.fixes.repaired && bo.flags.indexOf('duration-repaired') < 0) bo.flags.push('duration-repaired');
    if (bo.fixes.left && bo.flags.indexOf('duration-zero') < 0) bo.flags.push('duration-zero');
  }

  /* ---- one bar of a source part, ready to go into a column: durations scaled to the document's divisions, the leading
          attributes dropped (the column writes its own), the staff and voice of a lower-staff part set ---- */
  function convertBar(pbar, dOut, staffNo, voiceOff, keepFraming) {
    const f = pbar.k * (dOut / pbar.D);
    const pre = [], body = [], barlines = [];
    const fixes = newFixes();
    const attrs = {};
    ['width', 'implicit'].forEach(k => { if (pbar.el.attrs[k] != null) attrs[k] = pbar.el.attrs[k]; });
    let content = false;
    const scaleDur = e => {
      const d = kid(e, 'duration');
      if (d && f !== 1) { const v = num(d.text); if (v != null) d.text = String(Math.round(v * f)); }
    };
    pbar.el.kids.forEach(e => {
      const n = e.name;
      if (n === 'attributes') {
        if (!content) return;
        const c = mk('attributes', {}, []);
        e.kids.forEach(k => { if (k.name === 'clef') { const cc = clone(k); if (staffNo > 0) cc.attrs.number = String(staffNo); c.kids.push(cc); } });
        if (c.kids.length) body.push(c);
        return;
      }
      if (n === 'print') { if (keepFraming) pre.push(clone(e)); return; }
      if (n === 'barline') { if (keepFraming) barlines.push(clone(e)); return; }
      const c = clone(e);
      if (n === 'note' || n === 'backup' || n === 'forward') {
        content = true;
        scaleDur(c);
        if (n === 'note') fixZeroDuration(c, pbar, dOut, fixes);
        if (n === 'note' && staffNo > 0) {
          setKid(c, 'staff', String(staffNo), LEAD_BEFORE_STAFF);
          if (voiceOff > 0) { const v = kid(c, 'voice'); if (v) { const vv = parseInt(v.text, 10); if (vv > 0) v.text = String(vv + voiceOff); } }
        }
      } else if ((n === 'direction' || n === 'harmony') && f !== 1) {
        const o = kid(c, 'offset');
        if (o) { const v = num(o.text); if (v != null) o.text = String(Math.round(v * f)); }
      }
      if ((n === 'direction' || n === 'harmony' || n === 'figured-bass') && staffNo === 2) setKid(c, 'staff', '2', ['sound']);
      body.push(c);
    });
    settleMeasureRests(body, fixes);
    return { pre: pre, body: body, barlines: barlines, attrs: attrs, fixes: fixes };
  }
  /* how far an element of a bar moves the cursor: a note by its duration (a chord note and a grace note do not move it), a <forward> on, a <backup> back */
  function stepOf(e) {
    if (e.name === 'note') { if (!kid(e, 'chord') && !kid(e, 'grace')) return num(textOf(e, 'duration')) || 0; }
    else if (e.name === 'backup') return -(num(textOf(e, 'duration')) || 0);
    else if (e.name === 'forward') return num(textOf(e, 'duration')) || 0;
    return 0;
  }
  function cursorEnd(body) {
    let cur = 0;
    body.forEach(e => { cur += stepOf(e); });
    return Math.max(0, cur);
  }

  /* the BarOut of group g at bar index b */
  function groupBar(g, b, dOut) {
    if (g.kind === 'pair') {
      const gp = g.parts[0].bars[b], fp = g.parts[1].bars[b];
      if (!gp && !fp) return null;
      const upper = gp ? convertBar(gp, dOut, 1, 0, true) : null;
      const voiceOff = Math.max(4, gp ? gp.maxVoice : 0);
      const lower = fp ? convertBar(fp, dOut, 2, voiceOff, !upper) : null;
      let body = upper ? upper.body.slice() : [];
      if (upper && lower && lower.body.length) {
        const cur = cursorEnd(body);
        if (cur > 0) body.push(mk('backup', {}, [mk('duration', {}, String(cur))]));
      }
      if (lower) body = body.concat(lower.body);
      const pre = upper ? upper.pre : lower.pre;
      const barlines = upper ? upper.barlines : lower.barlines;
      const sg = gp ? gp.start : fp.start, sf = fp ? fp.start : gp.start;
      return { pre: pre, body: body.concat(barlines), srcAttrs: upper ? upper.attrs : lower.attrs, flags: ['pair-merged'], pitched: (gp ? gp.pitched : 0) + (fp ? fp.pitched : 0),
        fixes: addFixes(addFixes(newFixes(), upper && upper.fixes), lower && lower.fixes),
        state: { key: sg.key || sf.key, time: sg.time || sf.time, clefs: { '1': gp ? gp.start.clefs['1'] : null, '2': fp ? fp.start.clefs['1'] : null } },
        src: g };
    }
    const pb = g.parts[0].bars[b];
    if (!pb) return null;
    const c = convertBar(pb, dOut, 0, 0, true);
    return { pre: c.pre, body: c.body.concat(c.barlines), srcAttrs: c.attrs, flags: [], pitched: pb.pitched, fixes: c.fixes,
      state: { key: pb.start.key, time: pb.start.time, clefs: pb.start.clefs }, src: g };
  }
  const emptyBar = () => ({ pre: [], body: [], flags: [], pitched: 0, state: { key: null, time: null, clefs: {} }, empty: true });

  /* ---- one movement: its parts become columns (usually one) ---- */
  function buildMovement(mvDoc, dOut, ctx) {
    const parts = mvDoc.doc.parts;
    const info = { page: mvDoc.page, movement: mvDoc.mv, read: parts.map(p => p.staves).join('x'), out: null };
    const note = (rule, extra) => ctx.changes.push(Object.assign({ rule: rule, page: mvDoc.page, movement: mvDoc.mv }, extra || {}));
    /* the divisions of the parts that stay: repaired (read from the notes' types) or unknown (read as 1, as before) */
    const divisions = kept => {
      const seen = new Set(), flags = [];
      kept.forEach(p => {
        if (seen.has(p.id)) return;
        seen.add(p.id);
        if (p.zero && p.zeroFix) {
          ctx.counts.divisionsRepaired++;
          flags.push('divisions-repaired');
          note('divisions', { part: p.id, perQuarter: p.zeroFix.d, scale: p.zeroFix.k, divisions: p.zeroFix.D, agree: +p.zeroFix.support.toFixed(3), notes: p.zeroFix.samples });
        } else if (p.zero) {
          ctx.counts.divisionsUnknown++;
          flags.push('divisions-unknown');
          note('divisions-unknown', { part: p.id });
        }
      });
      return flags.filter((f, i) => flags.indexOf(f) === i);
    };
    const finish = (columns, len, why) => { info.out = columns.map(c => c.staves).join('x'); return { columns: columns, len: len, info: info, kept: why || null }; };
    const flagAll = (columns, flags) => columns.forEach(c => c.bars.forEach(b => flags.forEach(f => { if (b.flags.indexOf(f) < 0) b.flags.push(f); })));

    if (parts.some(p => p.staves > 2)) {
      note('parts-kept', { reason: 'a part of more than two staves' });
      return untouched(parts, finish, flagAll, divisions, ctx, 'more than two staves', dOut);
    }
    const groups = makeGroups(parts);
    const real = groups.filter(g => g.pitched > 0);
    if (!real.length) return untouched(parts, finish, flagAll, divisions, ctx, null, dOut);
    groups.filter(g => g.pitched === 0).forEach(g => g.parts.forEach(p => { ctx.counts.ghostParts++; note('ghost', { part: p.id }); }));
    let use = real;

    if (use.length === 1 && use[0].kind === 'single') {
      const part = use[0].parts[0];
      const folded = foldSystems(part);
      if (folded) {
        use = [folded];
        ctx.counts.systemsFolded++;
        note('systems', { part: part.id, runs: folded.runs, barsRead: part.bars.length, barsOut: folded.len });
      }
    }
    const keptParts = use.reduce((a, g) => a.concat(g.parts), []);
    if (use.length === 1) {
      const g = use[0];
      if (g.kind === 'pair' && !g.folded) { ctx.counts.partsMerged++; note('grand-staff', { parts: g.parts.map(p => p.id), bars: g.len }); }
      const col = { staves: g.kind === 'single' ? 1 : 2, bars: [] };
      for (let b = 0; b < g.len; b++) {
        const bo = groupBar(g, b, dOut) || emptyBar();
        if (g.folded) bo.flags.push('folded');
        col.bars.push(bo);
      }
      flagAll([col], divisions(keptParts));
      return finish([col], g.len);
    }
    /* several groups with notes: one piano read system by system, or a score of several parts */
    const B = Math.max.apply(null, use.map(g => g.len));
    let active = 0, shared = 0;
    for (let b = 0; b < B; b++) {
      const k = use.filter(g => g.pitchedAt(b) > 0).length;
      if (k >= 1) active++;
      if (k >= 2) shared++;
    }
    if (shared > OVERLAP_MAX * active) {
      note('parts-kept', { reason: 'the groups share bars', bars: active, shared: shared });
      return untouched(keptParts, finish, flagAll, divisions, ctx, 'groups share bars', dOut);
    }
    const col = { staves: 2, bars: [] };
    let prev = null;
    for (let b = 0; b < B; b++) {
      let pick = null, best = 0;
      use.forEach(g => { if (g.parts.some(p => p.bars[b])) { const n = g.pitchedAt(b); if (n > best) { best = n; pick = g; } } });
      if (!pick) pick = use.find(g => g.parts.some(p => p.bars[b])) || use[0];
      const bo = groupBar(pick, b, dOut) || emptyBar();
      const holders = use.filter(g => g.pitchedAt(b) > 0);
      if (holders.length > 1) {
        bo.flags.push('overlap');
        ctx.counts.droppedNotes += holders.filter(g => g !== pick).reduce((s, g) => s + g.pitchedAt(b), 0);
        ctx.counts.overlapBars++;
      }
      if (prev && best > 0 && pick !== prev) bo.flags.push('source-switch');
      if (best > 0) prev = pick;
      col.bars.push(bo);
    }
    ctx.counts.partsMerged++;
    note('grand-staff', { groups: use.map(g => g.kind + ':' + g.parts.map(p => p.id).join('+')), bars: B, activeBars: active, sharedBars: shared });
    flagAll([col], divisions(keptParts));
    return finish([col], B);
  }
  /* the parts as they are: one column each (a score of several parts, or a movement the rules cannot read) */
  function untouched(keep, finish, flagAll, divisions, ctx, why, dOut) {
    const cols = [];
    let len = 0;
    keep.forEach(p => {
      const col = { staves: p.staves === 2 ? 2 : 1, bars: [] };
      p.bars.forEach(pb => {
        const c = convertBar(pb, dOut, 0, 0, true);
        col.bars.push({ pre: c.pre, body: c.body.concat(c.barlines), srcAttrs: c.attrs, flags: [], pitched: pb.pitched, fixes: c.fixes,
          state: { key: pb.start.key, time: pb.start.time, clefs: pb.start.clefs } });
      });
      len = Math.max(len, col.bars.length);
      cols.push(col);
    });
    flagAll(cols, divisions(keep));
    if (cols.length > 1) {
      ctx.counts.partsKept++;
      flagAll(cols, ['parts-fragmented']);
    }
    return finish(cols, len, why);
  }

  /* normalize never throws: a document that makes the module fail (a stack overflow on absurdly deep nesting; a bug) is an answer, `ok: false` with
     error 'internal-error', and the caller falls back on what it did before */
  function normalize(pagesIn, opts) {
    try { return normalizePages(pagesIn, opts); } catch (e) {
      const detail = String(e && e.message || e).slice(0, 160);
      return { ok: false, error: 'internal-error', detail: detail, xml: null, pages: [],
        report: { version: VERSION, bars: 0, structure: [], staves: [], counts: {}, changes: [{ rule: 'internal-error', error: detail }], flags: {}, notes: [{ kind: 'internal-error', n: 1 }] } };
    }
  }

  /* ---- joining the movements, then writing the document ---- */
  function normalizePages(pagesIn, opts) {
    opts = opts || {};
    const ctx = { changes: [], counts: { pages: 0, pagesRead: 0, movements: 0, movementsJoined: 0, divisionsRepaired: 0, divisionsUnknown: 0,
      ghostParts: 0, partsMerged: 0, partsKept: 0, systemsFolded: 0, droppedNotes: 0, overlapBars: 0, unreadable: 0, barCountMismatch: 0,
      zeroRestsRepaired: 0, zeroNotesRepaired: 0, zeroRestsLeft: 0, zeroNotesLeft: 0, zeroRestBackups: 0, zeroRestsRefused: 0,
      zeroDurationsRepaired: 0, zeroDurationsLeft: 0, wedgesDropped: 0, wedgesDegenerate: 0 } };
    const list = Array.isArray(pagesIn) ? pagesIn : [];
    ctx.counts.pages = list.length;
    const movs = [];
    list.forEach((entry, pi) => {
      const texts = Array.isArray(entry) ? entry : (typeof entry === 'string' ? [entry] : []);
      let read = 0;
      texts.forEach((text, mi) => {
        if (typeof text !== 'string' || !text) return;
        let doc;
        try { doc = readDoc(text); } catch (e) {
          ctx.counts.unreadable++;
          ctx.changes.push({ rule: 'unreadable', page: pi, movement: mi + 1, error: String(e && e.message || e).slice(0, 160) });
          return;
        }
        if (!doc.parts.length || !doc.parts.some(p => p.bars.length)) {
          ctx.counts.unreadable++;
          ctx.changes.push({ rule: 'unreadable', page: pi, movement: mi + 1, error: 'no bars' });
          return;
        }
        movs.push({ page: pi, mv: mi + 1, doc: doc });
        read++;
      });
      if (read) ctx.counts.pagesRead++;
      if (read > 1) { ctx.counts.movementsJoined += read - 1; ctx.changes.push({ rule: 'movements', page: pi, joined: read }); }
    });
    ctx.counts.movements = movs.length;
    const pagesOut = list.map((_, i) => ({ index: i, ok: false, movements: 0, bars: 0, xml: null }));
    if (!movs.length) return { ok: false, error: 'no-usable-page', xml: null, pages: pagesOut, report: finishReport(ctx, [], 0, []) };

    /* one divisions for the whole document: the lcm of every part's (after the repair) */
    let dOut = 1;
    movs.forEach(m => m.doc.parts.forEach(p => p.bars.forEach(b => { dOut = lcm(dOut, b.D); })));
    if (dOut > MAX_DIVISIONS) return { ok: false, error: 'divisions-too-large', xml: null, pages: pagesOut, report: finishReport(ctx, [], 0, []) };

    const cols = [];            /* {staves, bars: [BarOut + page, mv]} */
    let total = 0;
    const pageBarCount = list.map(() => 0);
    const built = movs.map(m => buildMovement(m, dOut, ctx));
    built.forEach((r, i) => {
      const m = movs[i];
      while (cols.length < r.columns.length) {
        const c = { staves: 1, bars: [] };
        for (let k = 0; k < total; k++) { const e = emptyBar(); e.page = null; c.bars.push(e); }
        cols.push(c);
      }
      cols.forEach((c, j) => {
        const src = r.columns[j];
        if (src) c.staves = Math.max(c.staves, src.staves);
        for (let b = 0; b < r.len; b++) {
          const bo = src && src.bars[b] ? src.bars[b] : emptyBar();
          bo.page = m.page; bo.mv = m.mv;
          if (b === 0 && m.mv > 1 && j === 0) bo.flags.push('movement-start');
          c.bars.push(bo);
        }
      });
      total += r.len;
      pageBarCount[m.page] += r.len;
      pagesOut[m.page].movements++;
    });

    /* the bar count a page's own layout shows, against the bars read */
    const shown = Array.isArray(opts.pageBars) ? opts.pageBars : [];
    pagesOut.forEach((p, i) => {
      p.bars = pageBarCount[i];
      p.ok = p.movements > 0;
      const s = shown[i];
      if (p.ok && typeof s === 'number' && s > 0 && s !== p.bars) {
        ctx.counts.barCountMismatch++;
        ctx.changes.push({ rule: 'bar-count', page: i, read: p.bars, shown: s });
        cols.forEach(c => c.bars.forEach(b => { if (b.page === i && b.flags.indexOf('bar-count') < 0) b.flags.push('bar-count'); }));
      }
    });

    /* notes of length 0, hairpins that end where they start: repaired or dropped, on the bars that are written (not on bars of a group that was left out) */
    cols.forEach(c => {
      c.bars.forEach((bo, i) => {
        const fx = bo.fixes;
        if (!fx || (!fx.repaired && !fx.left)) return;
        ctx.counts.zeroRestsRepaired += fx.rests;
        ctx.counts.zeroNotesRepaired += fx.notes;
        ctx.counts.zeroRestsLeft += fx.leftRests;
        ctx.counts.zeroNotesLeft += fx.leftNotes;
        ctx.counts.zeroRestBackups += fx.backups;
        ctx.counts.zeroRestsRefused += fx.refused;
        ctx.counts.zeroDurationsRepaired += fx.repaired;      /* the sums of the rests and the pitched notes */
        ctx.counts.zeroDurationsLeft += fx.left;
        flagFixes(bo);
        ctx.changes.push({ rule: 'zero-duration', bar: i + 1, page: bo.page, movement: bo.mv, repaired: fx.repaired, left: fx.left, rests: fx.rests, notes: fx.notes,
          backups: fx.backups, refused: fx.refused, how: fx.how });
      });
      dropBadWedges(c, ctx);
    });

    /* the document: the first usable file's header, one part per column */
    const header = movs[0].doc.root.kids.filter(k => k.name !== 'part-list' && k.name !== 'part').map(clone);
    const partList = mk('part-list', {}, cols.map((c, j) => mk('score-part', { id: 'P' + (j + 1) }, [
      mk('part-name', {}, c.staves === 2 ? 'Piano' : 'Staff ' + (j + 1))])));
    const parts = cols.map((c, j) => writeColumn(c, j, dOut));
    const rootEl = mk('score-partwise', Object.assign({}, movs[0].doc.root.attrs), header.concat([partList], parts));
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + ser(rootEl) + '\n';

    /* the flags by output bar number (every column's flags together) */
    const flags = {};
    cols.forEach(c => c.bars.forEach((b, i) => { b.flags.forEach(f => { const a = flags[i + 1] = flags[i + 1] || []; if (a.indexOf(f) < 0) a.push(f); }); }));
    pagesOut.forEach(p => { if (p.ok) p.counting = countingDoc(p.bars); });
    const structure = built.map(r => ({ page: r.info.page, movement: r.info.movement, read: r.info.read, out: r.info.out, bars: r.len, kept: r.kept }));
    return { ok: true, xml: xml, pages: pagesOut, report: finishReport(ctx, structure, total, flags, cols.map(c => c.staves)) };
  }

  /* The wedges of a column the way the ScoreGraph importer pairs them (scoregraph/musicxml-import.js 'wedge': a start while one of that
     number is open drops the open one, a stop pairs the open one, a stop with none open and a start never stopped are dropped) and the way
     the validator judges a pair (E-SPAN-ORDER: the stop at or before the start). Audiveris writes a crescendo and a diminuendo that meet
     as start, start, stop, stop with no note between the middle two. When a column has a pair that ends where it starts, every wedge of the
     column that does not make a pair of positive length is removed (see the header). Positions are bar index and place in the bar, in divisions. */
  function dropBadWedges(col, ctx) {
    const open = new Map(), bad = new Map();
    let degenerate = 0;
    const mark = (w, ref) => { if (!bad.has(w)) bad.set(w, ref); };
    col.bars.forEach((bo, bi) => {
      let cur = 0;
      bo.body.forEach(e => {
        cur += stepOf(e);
        if (e.name === 'direction') {
          const at = cur + (num(textOf(e, 'offset')) || 0);
          kidsOf(e, 'direction-type').forEach(dt => kidsOf(dt, 'wedge').forEach(w => {
            const ref = { w: w, dt: dt, dir: e, bo: bo, bar: bi + 1 };
            const type = w.attrs.type, no = w.attrs.number || '1';
            if (type === 'crescendo' || type === 'diminuendo') {
              const prev = open.get(no);
              if (prev) mark(prev.ref.w, prev.ref);
              open.set(no, { bar: bi, at: at, ref: ref });
            } else if (type === 'stop') {
              const st = open.get(no);
              if (!st) { mark(w, ref); return; }
              open.delete(no);
              if (bi < st.bar || (bi === st.bar && at <= st.at)) { mark(st.ref.w, st.ref); mark(w, ref); degenerate++; }
            }
          }));
        }
      });
    });
    if (!degenerate) return;
    open.forEach(st => mark(st.ref.w, st.ref));
    const perBar = new Map();
    bad.forEach(ref => {
      ref.dt.kids = ref.dt.kids.filter(k => k !== ref.w);
      if (!ref.dt.kids.length) ref.dir.kids = ref.dir.kids.filter(k => k !== ref.dt);
      if (!ref.dir.kids.some(k => k.name === 'direction-type')) ref.bo.body = ref.bo.body.filter(k => k !== ref.dir);
      if (ref.bo.flags.indexOf('wedge-dropped') < 0) ref.bo.flags.push('wedge-dropped');
      perBar.set(ref.bar, (perBar.get(ref.bar) || 0) + 1);
    });
    ctx.counts.wedgesDropped += bad.size;
    ctx.counts.wedgesDegenerate += degenerate;
    perBar.forEach((n, bar) => ctx.changes.push({ rule: 'wedges', bar: bar, dropped: n }));
  }

  /* a column's <part>: its bars, with the attributes written where the state changes */
  function writeColumn(col, j, dOut) {
    const prev = { key: null, time: null, clefs: {} };
    const part = mk('part', { id: 'P' + (j + 1) }, []);
    col.bars.forEach((bo, i) => {
      const first = i === 0;
      const a = [];
      if (first) a.push(mk('divisions', {}, String(dOut)));
      const st = bo.state;
      if (st.key && (first || !prev.key || prev.key.s !== st.key.s)) { a.push(clone(st.key.el)); prev.key = st.key; }
      if (st.time && (first || !prev.time || prev.time.s !== st.time.s)) { a.push(clone(st.time.el)); prev.time = st.time; }
      if (first && col.staves === 2) a.push(mk('staves', {}, '2'));
      for (let n = 1; n <= col.staves; n++) {
        let c = st.clefs[String(n)] || null;
        if (!c && first) c = n === 2 ? { s: 'F|4|', el: mk('clef', {}, [mk('sign', {}, 'F'), mk('line', {}, '4')]) } : { s: 'G|2|', el: mk('clef', {}, [mk('sign', {}, 'G'), mk('line', {}, '2')]) };
        if (c && (!prev.clefs[n] || prev.clefs[n].s !== c.s)) {
          const el = clone(c.el);
          if (col.staves === 2) el.attrs.number = String(n); else delete el.attrs.number;
          a.push(el);
          prev.clefs[n] = c;
        }
      }
      const kids = bo.pre.slice();
      if (a.length) kids.push(mk('attributes', {}, a));
      bo.body.forEach(e => kids.push(e));
      part.kids.push(mk('measure', measureAttrs(bo, i), kids));
    });
    return part;
  }
  function measureAttrs(bo, i) {
    const attrs = { number: String(i + 1) };
    if (bo.srcAttrs) Object.assign(attrs, bo.srcAttrs);
    return attrs;
  }

  /* what PdfLayer.apply reads from each page's "recognised document": the bar count of its first part */
  function countingDoc(bars) {
    let s = '<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">';
    for (let i = 1; i <= bars; i++) s += '<measure number="' + i + '"/>';
    return s + '</part></score-partwise>\n';
  }

  function finishReport(ctx, structure, bars, flags, staves) {
    const c = ctx.counts;
    return {
      version: VERSION,
      bars: bars,
      structure: structure,                                    /* per movement: the staves of its parts as read ("1x1x2") and as written ("2") */
      staves: staves || [],
      counts: c,
      changes: ctx.changes,
      flags: flags || {},
      /* a single sentence per kind of change, for the import report and the review screen */
      notes: notesOf(c)
    };
  }
  function notesOf(c) {
    const n = [];
    if (c.movementsJoined) n.push({ kind: 'movements', n: c.movementsJoined });
    if (c.divisionsRepaired) n.push({ kind: 'divisions', n: c.divisionsRepaired });
    if (c.divisionsUnknown) n.push({ kind: 'divisions-unknown', n: c.divisionsUnknown });
    if (c.ghostParts) n.push({ kind: 'ghost-parts', n: c.ghostParts });
    if (c.partsMerged) n.push({ kind: 'grand-staff', n: c.partsMerged });
    if (c.systemsFolded) n.push({ kind: 'systems', n: c.systemsFolded });
    if (c.partsKept) n.push({ kind: 'parts-kept', n: c.partsKept });
    if (c.unreadable) n.push({ kind: 'unreadable', n: c.unreadable });
    if (c.barCountMismatch) n.push({ kind: 'bar-count', n: c.barCountMismatch });
    if (c.zeroRestsRepaired) n.push({ kind: 'zero-rests', n: c.zeroRestsRepaired });
    if (c.zeroNotesRepaired) n.push({ kind: 'zero-notes', n: c.zeroNotesRepaired });
    if (c.zeroRestsLeft) n.push({ kind: 'zero-rests-left', n: c.zeroRestsLeft });
    if (c.zeroNotesLeft) n.push({ kind: 'zero-notes-left', n: c.zeroNotesLeft });
    if (c.wedgesDropped) n.push({ kind: 'wedges', n: c.wedgesDropped });
    return n;
  }

  /* the helper's /omr answer as normalize()'s input: `movements` (every movement of each page) when it has them, else the one
     document a page the old helper gave */
  function pagesFromHelper(body) {
    if (!body) return [];
    if (Array.isArray(body.movements)) return body.movements.map(p => (Array.isArray(p) ? p.filter(Boolean) : (typeof p === 'string' ? [p] : [])));
    if (Array.isArray(body.musicxml)) return body.musicxml.map(p => (typeof p === 'string' && p ? [p] : []));
    return [];
  }

  return Object.freeze({ VERSION: VERSION, normalize: normalize, pagesFromHelper: pagesFromHelper, OVERLAP_MAX: OVERLAP_MAX });
});
