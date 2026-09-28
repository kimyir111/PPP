/* ============================================================================
   PPP SongGraph — sections and repetition (docs/GOALS/G07 §5 "sections and repetition")

   NOT Score.deriveSections (the app's unrelated ~8-bar practice-chunk heuristic, G07 design doc
   §2/§4): this segments a whole piece into labelled sections by real repeated content, at
   whatever length the repeat actually is, not a fixed 8 bars.

   sectionsOf(g, opts) -> [{from, to, label}] (measure IDs, in time order, non-overlapping,
   covering the whole piece): a two-stage read of a ScoreGraph's own written measures —

     1. exact repeated measure-runs: every measure gets an exact content signature — every note's
        (voice, onset offset in the measure, pitch class, duration), across every part (see
        measureSignature below for why this replaced an earlier, over-matching pitch-class-histogram
        signature); candidate run lengths [16, 8, 4, 2] measures are tried longest-first, and a run
        that recurs (2+ non-overlapping copies) claims those measures and is labelled with one
        shared letter (A, B, …) — an AABA-style form falls out of this directly.
     2. whatever measures no repeat claims become their own single-run sections, each a new letter.

   This is real, measurable structure (an exact repeat is either there in the notation or it is
   not) but it is NOT scored against a ground truth: no annotated section/form dataset exists
   anywhere in this repo (structure.sections was schema-only before this Goal, §3) — reported as
   such in the design doc's §12, the same honesty the melody/bass ground-truth gap gets, rather
   than inventing a number. The mutation suite (tests/songgraph) is what actually exercises this:
   a planted verbatim repeat must be found, and a planted near-miss must not be over-claimed.

   promoteSections(g, candidates, opts) writes them via ops.addSection, prov {op:'inferred',
   source:{kind:'generator', tool:'ppp.songgraph.sections'}} — promotion only ever goes through the
   op (G07 §1's direction rule), never a direct structure.sections write.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('../scoregraph/time.js'), require('../scoregraph/ops.js'), require('./util.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const M = root.PPPSongGraphModules = root.PPPSongGraphModules || {};
    M.sections = factory(SG.rational, SG.time, SG.ops, M.util);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, T, O, U) {
  'use strict';

  const LENS = [16, 8, 4, 2];

  /* One exact content signature per measure: every note's (voice, onset offset in the measure, pitch
     class, duration), across every part, in time order. This is deliberately NOT a pitch-class
     histogram (an earlier version was, and over-matched constantly — any two measures that simply
     sit on the same tonic triad got the same histogram regardless of what tune was being sung over
     it, "detecting" dozens of false repeats in a piece that never states the same passage twice).
     Pitch class rather than absolute MIDI so a repeat printed an octave apart (a common engraving
     choice, not a real difference) still matches; onset/duration are exact, so this catches a real
     repeated passage and (by design) misses one that is transposed to a different key. */
  function measureSignature(part, notesByM, m, start) {
    const list = (notesByM.get(m.id) || []).filter(n => n.partId === part.id)
      .slice().sort((a, b) => R.cmp(a.w0, b.w0) || (a.voiceId < b.voiceId ? -1 : a.voiceId > b.voiceId ? 1 : 0) || a.pc - b.pc);
    if (!list.length) return '_';
    return list.map(n => n.voiceId + ':' + R.format(R.sub(n.w0, start)) + ':' + n.pc + ':' + R.format(R.sub(n.w1, n.w0))).join(';');
  }

  /* One combined signature per measure across every part (a repeated verse repeats in every staff at
     once; restricting to one part would just as validly find repeats within a single line, but the
     combined signature is what "the same passage played again" actually means end to end). */
  function measureSignatures(g) {
    const notes = U.noteWindows(g);
    const notesByM = new Map();
    notes.forEach(n => { if (!notesByM.has(n.m)) notesByM.set(n.m, []); notesByM.get(n.m).push(n); });
    return g.timeline.measures.map(m => {
      const start = T.measureStart(g, m.id);
      return g.parts.map(part => measureSignature(part, notesByM, m, start)).join('||');
    });
  }

  /* [{starts: [i, j, ...], len}], longest length first, each measure claimed by at most one match. */
  function findRepeats(sigs) {
    const n = sigs.length;
    const claimed = new Array(n).fill(false);
    const found = [];
    LENS.forEach(L => {
      if (L * 2 > n) return;
      const groups = new Map();
      for (let i = 0; i + L <= n; i++) {
        if (claimed.slice(i, i + L).some(Boolean)) continue;
        const key = sigs.slice(i, i + L).join('|');
        if (sigs.slice(i, i + L).every(s => /^[_|]+$/.test(s))) continue; /* an all-silent window claims nothing */
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
      }
      groups.forEach(starts => {
        if (starts.length < 2) return;
        const chosen = [];
        let lastEnd = -1;
        starts.forEach(s => { if (s >= lastEnd) { chosen.push(s); lastEnd = s + L; } });
        if (chosen.length < 2) return;
        chosen.forEach(s => { for (let k = s; k < s + L; k++) claimed[k] = true; });
        found.push({ starts: chosen, len: L });
      });
    });
    return { found: found, claimed: claimed };
  }

  function letterFor(n) {
    let s = '';
    n = n + 1;
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
  }

  /* [{from, to, label}], measure IDs, covering the whole piece, in time order. */
  function sectionsOf(g) {
    const ms = g.timeline.measures;
    if (ms.length < 2) return [{ from: ms[0].id, to: ms[0].id, label: 'A' }].slice(0, ms.length);
    const sigs = measureSignatures(g);
    const { found } = findRepeats(sigs);
    /* index -> family key (a shared letter across every run of one repeated family) */
    const family = new Map();
    let nextLabel = 0;
    const labelOf = new Map(); /* found[i] -> letter */
    found.forEach((f, fi) => {
      const letter = letterFor(nextLabel++);
      labelOf.set(fi, letter);
      f.starts.forEach(s => { for (let k = s; k < s + f.len; k++) family.set(k, letter); });
    });
    const out = [];
    let i = 0;
    while (i < ms.length) {
      if (family.has(i)) {
        const letter = family.get(i);
        let j = i;
        while (j < ms.length && family.get(j) === letter) j++;
        out.push({ from: ms[i].id, to: ms[j - 1].id, label: letter });
        i = j;
      } else {
        let j = i;
        while (j < ms.length && !family.has(j)) j++;
        out.push({ from: ms[i].id, to: ms[j - 1].id, label: letterFor(nextLabel++) });
        i = j;
      }
    }
    return out;
  }

  const SOURCE = Object.freeze({ kind: 'generator', tool: 'ppp.songgraph.sections' });

  /* Write candidates (sectionsOf's own output, or any [{from,to,label,parent?}]) via ops.addSection. */
  function promoteSections(g, candidates, opts) {
    opts = opts || {};
    let out = g, idMaps = [];
    candidates.forEach(c => {
      const res = O.addSection(out, c.from, c.to, {
        label: c.label, parent: c.parent,
        prov: { op: 'inferred', source: opts.source || SOURCE }
      });
      out = res.graph;
      idMaps.push(res.idMap);
    });
    return { graph: out, idMaps: idMaps };
  }

  return Object.freeze({ measureSignatures, findRepeats, sectionsOf, promoteSections, SOURCE });
});
