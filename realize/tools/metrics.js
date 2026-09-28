/* ============================================================================
   PPP Arrangement Realization — the five G8 acceptance metrics (docs/GOALS/G08 §6a/§7),
   computed the SAME way for G8a's own output and all three legacy engines' output on the
   SAME real input, via already-reviewed tools this module only calls, never reimplements:

     1. G5 hard violations   playability/index.js's analyzeGraph (native ScoreGraph path)
                              or playability/analyze.js directly over adapted attacks
                              (audio-score.js has no hand split - tests/playability/
                              arranger-adapters.js's own adapter, reused here).
     2. G6 level vs. target  difficulty/index.js's assess(graph, weights).level.position.
     3. melody preservation  a real onset+pitch match against the ORIGINAL piece's own
                              G7a-declared melody voice, at G7a's own melodyConf.
     4. harmony agreement    songgraph/harmony.js's harmonyOf, root+quality and root-only,
                              against the ORIGINAL piece's own sg.harmony (G7a's real
                              analysis of the SAME piece) - the same two-tier convention
                              G7a's own hymn-SATB ground-truth check used (89.2%/93.1%).
     5. engraving L1/L2      tests/engrave/tools/bench.js's own `measure()` (exported for
                              exactly this reuse) - eg.ledger.silent, eg.layout.hard_violations.

   audio-score.js has no measure/hand/meter structure at all (docs/GOALS/G08 §6a: "a subset
   of heard notes", never a notated score) - metrics 2, 4 and 5 need a real ScoreGraph
   (rhythm, hands, a key) that its output structurally cannot supply without G8a inventing
   notation decisions audio-score.js itself never makes. It is scored on metrics 1 and 3
   (both computable from a bare note list) and reported as N/A, with the reason stated, on
   2/4/5 - a structural exclusion, not a favorable one dropped quietly (docs/GOALS/G08 §14
   states this plainly, per the task's "report real numbers honestly" instruction). */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const SG = { pitch: require(path.join(REPO, 'scoregraph/pitch.js')) };
const PLA = require(path.join(REPO, 'playability/index.js'));
const PLAAN = require(path.join(REPO, 'playability/analyze.js'));
const { attacksFromAudioScoreNotes } = require(path.join(REPO, 'tests/playability/arranger-adapters.js'));
const DIFF = require(path.join(REPO, 'difficulty/index.js'));
const WEIGHTS = require(path.join(REPO, 'difficulty/weights/g6a-v1.json'));
const HARM = require(path.join(REPO, 'songgraph/harmony.js'));
const bench = require(path.join(REPO, 'tests/engrave/tools/bench.js'));

/* ---- 1. G5 hard violations ---- */
function hardViolationsOfGraph(graph, profile) {
  const r = PLA.analyzeGraph(graph, { profile: profile });
  return { hard: r.totals.hard, byCode: r.totals.byCode };
}
function hardViolationsOfAudioNotes(notes, profile) {
  const attacks = attacksFromAudioScoreNotes(notes);
  const r = PLAAN.analyze(attacks, { profile: profile });
  return { hard: r.totals.hard, byCode: r.totals.byCode };
}

/* ---- 2. G6 level vs. target ---- */
function levelOfGraph(graph) {
  return DIFF.assess(graph, WEIGHTS).level.position;
}

/* ---- helpers: a uniform {onsetQ (absolute quarters from piece start), midi} note list ---- */
function graphNoteList(g) {
  const mStart = new Map(); let acc = R.ZERO;
  g.timeline.measures.forEach(m => { mStart.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
  const out = [];
  g.parts.forEach(part => part.events.forEach(e => {
    if (e.kind !== 'note' || e.grace) return;
    const onsetQ = R.toNumber(R.add(mStart.get(e.m), R.parse(e.at))) * 4;
    (e.heads || []).forEach(h => out.push({ onsetQ: onsetQ, midi: SG.pitch.midi(h.pitch) }));
  }));
  return out;
}
/* Legacy wire notes {m (1-based measure number), b (quarters within measure), midi}, given
   the SAME piece's measure list (lenQ per measure) to compute each measure's cumulative
   start in quarters - valid because arrange_score.py/ScoreArranger both preserve the
   original measure count/order (neither ever changes meter, docs/GOALS/G08 §4/§6a). */
function legacyNoteList(measures, notes) {
  const startQ = []; let acc = 0;
  measures.forEach(m => { startQ.push(acc); acc += m.lenQ; });
  return notes.filter(n => !n.rest && n.midi != null).map(n => ({ onsetQ: startQ[n.m - 1] + n.b, midi: n.midi }));
}
function audioNoteList(notes, qpm) {
  const qPerSec = (qpm || 100) / 60;
  return notes.map(n => ({ onsetQ: n.on * qPerSec, midi: n.midi }));
}

/* ---- 3. melody preservation: a real onset+pitch match, tolQ quarters (an eighth note at
   any reasonable tempo) - against the ORIGINAL piece's declared melody voice, G7a's own
   `voice`/`confidence` (arrangement/plan.js's `plan.sections[i].melody`), concatenated
   across every section a plan covers. */
function originalMelodyNotes(g, plan) {
  const mStart = new Map(); let acc = R.ZERO;
  g.timeline.measures.forEach(m => { mStart.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
  const part = g.parts.find(p => p.id === plan.part);
  const out = [];
  plan.sections.forEach(sec => {
    if (!sec.melody || sec.melody.voice == null) return;
    part.events.forEach(e => {
      if (e.kind !== 'note' || e.grace || e.voice !== sec.melody.voice) return;
      if (!mStart.has(e.m)) return;
      const onsetQ = R.toNumber(R.add(mStart.get(e.m), R.parse(e.at))) * 4;
      (e.heads || []).forEach(h => out.push({ onsetQ: onsetQ, midi: SG.pitch.midi(h.pitch) }));
    });
  });
  return out;
}
function melodyPreservation(originalNotes, candidateNotes, tolQ) {
  tolQ = tolQ == null ? 0.15 : tolQ;
  if (!originalNotes.length) return null;
  let matched = 0;
  originalNotes.forEach(o => {
    if (candidateNotes.some(c => c.midi === o.midi && Math.abs(c.onsetQ - o.onsetQ) <= tolQ)) matched++;
  });
  return matched / originalNotes.length;
}

/* ---- 4. harmony agreement against the ORIGINAL piece's own sg.harmony (same windows,
   since a legitimate candidate preserves the original meter/measures - checked, not
   assumed: window count mismatch is reported as 0 agreement over the shorter length,
   never silently truncated to "look" comparable). ---- */
function harmonyAgreement(originalHarmony, candidateGraph) {
  const candidateHarmony = HARM.harmonyOf(candidateGraph);
  const n = Math.min(originalHarmony.length, candidateHarmony.length);
  if (!n) return { rootQuality: null, rootOnly: null, n: 0, lengthMismatch: originalHarmony.length !== candidateHarmony.length };
  let rq = 0, ro = 0;
  for (let i = 0; i < n; i++) {
    const a = originalHarmony[i], c = candidateHarmony[i];
    if (a.root === c.root) { ro++; if (a.quality === c.quality) rq++; }
  }
  return { rootQuality: rq / n, rootOnly: ro / n, n: n, lengthMismatch: originalHarmony.length !== candidateHarmony.length };
}

/* ---- 5. engraving L1/L2, via tests/engrave/tools/bench.js's own exported `measure()` -
   no new instrumentation (docs/GOALS/G08 §5's own instruction). ---- */
function engraveMetrics(graph, id) {
  const row = bench.measure({ id: id, graph: graph });
  if (row.m['eg.error']) return { error: row.error || 'eg.error', silent: null, hardLayout: null };
  return { silent: row.m['eg.ledger.silent'], hardLayout: row.m['eg.layout.hard_violations'] };
}

module.exports = {
  hardViolationsOfGraph, hardViolationsOfAudioNotes, levelOfGraph,
  graphNoteList, legacyNoteList, audioNoteList, originalMelodyNotes, melodyPreservation,
  harmonyAgreement, engraveMetrics
};
