/* ============================================================================
   PPP Arrangement Realization — legacy-engine adapters (docs/GOALS/G08 §6a's comparative
   harness). Read-only wrappers around all three legacy engines the roadmap names
   (docs/GOALS/G08 §4's correction to G5a's one-fixture-per-engine baseline):

     1. arrange_score.py  - via realize/tools/legacy-arrange-score.py (a real subprocess,
        the same "import Arranger directly, never touch its code" technique
        tests/playability/tools/arrange-score-baseline.py already uses).
     2. ScoreArranger      - the in-app class, extracted read-only exactly the way
        tests/playability/score-arranger-extract.js already does (reused directly, not
        reimplemented).
     3. audio-score.js's arrangeNotes - Node-requireable directly (no extraction needed).

   None of these three files is ever written to. `scoregraph/legacy-score.js`'s `toScore`/
   `fromScore` (already reviewed G4 code) round-trip a ScoreGraph through the same flat
   "Score" shape arrange_score.py and ScoreArranger both consume/produce, so all three
   engines' outputs (and G8a's own) can be scored by the SAME real tools (playability/,
   difficulty/, songgraph/, the engrave bench) on the SAME real corpus files.
   ========================================================================== */
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..');
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const SG = {
  legacy: require(path.join(REPO, 'scoregraph/legacy-score.js')),
  pitch: require(path.join(REPO, 'scoregraph/pitch.js'))
};
const { scoreArranger } = require(path.join(REPO, 'tests/playability/score-arranger-extract.js'));
const Ops = require(path.join(REPO, 'scoregraph/ops.js'));

/* A real legacy "Score" object for a real ScoreGraph, with real G1 hand assignment
   substituted for legacy-score.js's own always-'r' placeholder - the exact technique
   tests/playability/arranger-baseline.test.js's `legacyScoreFromGraph` already uses (kept
   here, not imported from a test file, since realize/tools/ is a shipped tool, not a test). */
function wireScoreOf(g, name) {
  const score = SG.legacy.toScore(g, { name: name, id: 'g8a:' + name, ids: true });
  const part = g.parts[0];
  score.notes.forEach(n => {
    if (n.rest) return;
    const ev = part.events.find(e => e.id === n.sgEvent);
    if (!ev) return;
    const head = (ev.heads || []).find(h => h.id === n.sgHead);
    const limb = head ? SG.pitch.limbOf(part, ev, head) : undefined;
    if (limb === 'LH') n.hand = 'l'; else if (limb === 'RH') n.hand = 'r';
  });
  const first = score.measures[0], last = score.measures[score.measures.length - 1];
  return Object.assign({}, score, { sections: [{ from: first ? first.number : 1, to: last ? last.number : 1 }] });
}

/* {on, off, midi, vel} per real sounding note, in real seconds from the piece's own tempo -
   audio-score.js's own input shape ("what a performance detector heard"), built from the
   REAL ScoreGraph rather than a synthetic cluster (G05 §11's own baseline had no recorded
   performance sample available and used one; a real corpus file gives real content instead). */
function audioNotesOf(g, qpm) {
  const secPerW = 240 / (qpm || 100);
  const out = [];
  g.parts.forEach(part => {
    part.events.forEach(e => {
      if (e.kind !== 'note' || e.grace) return;
      const mi = mStart(g).get(e.m);
      const w0 = R.add(mi, R.parse(e.at)), w1 = R.add(w0, R.parse(e.dur));
      (e.heads || []).forEach(h => out.push({ on: R.toNumber(w0) * secPerW, off: R.toNumber(w1) * secPerW, midi: SG.pitch.midi(h.pitch), vel: 72 }));
    });
  });
  return out.sort((a, b) => a.on - b.on || a.midi - b.midi);
}
const _mStartCache = new WeakMap();
function mStart(g) {
  if (_mStartCache.has(g)) return _mStartCache.get(g);
  const map = new Map(); let acc = R.ZERO;
  g.timeline.measures.forEach(m => { map.set(m.id, acc); acc = R.add(acc, R.parse(m.dur)); });
  _mStartCache.set(g, map);
  return map;
}

/* Runs arrange_score.py's real Arranger over N real jobs in ONE subprocess (not one per
   job - matches arrange-score-baseline.py's own single-process-for-the-whole-run design). */
function runArrangeScorePy(jobs) {
  const payload = JSON.stringify({ jobs: jobs });
  const out = execFileSync(process.platform === 'win32' ? 'python' : 'python3',
    [path.join(__dirname, 'legacy-arrange-score.py')],
    { input: payload, maxBuffer: 256 * 1024 * 1024, timeout: 120000, killSignal: 'SIGKILL' }).toString();
  return JSON.parse(out).results;
}

let SA_CACHE = null;
function runScoreArranger(wireScore, level, style) {
  if (!SA_CACHE) SA_CACHE = scoreArranger();
  const arranged = SA_CACHE.arrange(wireScore, { level: level, style: style || 'balanced' });
  return { notes: arranged.notes, tempo: wireScore.tempo || 80 };
}

function runAudioScore(notes, level, style) {
  const AS = require(path.join(REPO, 'audio-score.js'));
  return AS.arrangeNotes(notes, { level: level, style: style || 'balanced' });
}

/* fromScore()'s own staff/voice construction (scoregraph/legacy-score.js ~895-905) never
   sets Staff.limb or Voice.limb at all - checked directly, not assumed, after every
   hand-dependent playability/difficulty metric on a first projected graph came back as a
   uniform, suspicious 0 (playability/pitch.js's limbOf falls back through
   `head.limb ?? voice.limb ?? staff.limb`; with none of the three ever set, every attack in
   playability/graph.js's attacksOf silently has NO hand at all, so "0 hard violations" and
   G6's per-hand features were measuring an EMPTY set, not a real result - a real
   methodological bug this harness must not ship). The fix: this codebase's own established
   convention (G1's rule, cited in docs/GOALS/G05_PLAYABILITY_FINGERING.md §11 - "a 2-staff
   piano part gives staff 1 RH and staff 2 LH uniformly") applied to the SAME order
   fromScore's own `partsFromHands` already builds `part.staves` in (the original Score's
   staff numbers, ascending) - staff[0] -> RH, staff[1] -> LH, written onto every Voice on
   that staff via one ops.js edit (real, load-bearing, not decorative provenance). */
function assignHandLimbs(graph) {
  const part = graph.parts.slice().sort((a, b) => b.voices.length - a.voices.length)[0];
  if (!part || part.staves.length < 1) return graph;
  const limbOfStaff = new Map();
  part.staves.forEach((st, i) => limbOfStaff.set(st.id, i === 0 ? 'RH' : i === 1 ? 'LH' : null));
  const res = Ops.edit(graph, d => {
    part.voices.forEach(v => {
      const limb = limbOfStaff.get(v.staff);
      if (!limb) return;
      const mv = d.voice(v.id);
      mv.limb = limb;
      d.touch();
    });
  }, { source: { kind: 'generator', tool: 'ppp.g8a-harness', version: '1.0.0' } });
  return res.graph;
}

/* arrange_score.py's own `_new_note` (line ~628) hardcodes `"chord": False` on EVERY note it
   emits, even when several of its own notes share one exact onset (a real, genuine chord it
   itself constructed - `_texture`'s block-chord voicings, for one) - checked directly, not
   assumed, after a real corpus file's 'advanced'/'original' output failed `fromScore`'s
   `chord-without-first-note` validation while 'beginner' (fewer simultaneous notes) did not.
   Separately, a style can also emit two notes in the SAME voice number whose time ranges
   overlap (`voice-overlap`) - a real shape neither legacy engine ever has to notate
   correctly, since neither one ever imports its own output back through a notation-valid
   ScoreGraph. Both are real properties of the legacy engines' loose flat JSON, not artifacts
   of this harness - sanitizeLegacyNotes derives the flags/voice-splitting a valid single-
   voice notation needs FROM the engine's own note content (exact onsets, an interval-
   scheduling voice split for genuine overlaps), inventing no pitch or rhythm, so `fromScore`
   can build a valid graph to actually measure. */
function sanitizeLegacyNotes(notes) {
  const groups = new Map(); /* (m,voice) -> notes, in original order */
  notes.forEach(n => {
    if (n.rest || n.midi == null) return;
    const key = n.m + ':' + n.voice;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  });
  const out = [];
  groups.forEach((list, key) => {
    const voice = list[0].voice;
    /* A legal chord (scoregraph/legacy-score.js's own `slotOf`, checked directly: `m + b +
       voice + dur`, ALL four) needs identical b AND identical dur, not just a shared onset -
       arrange_score.py's own `_finalize_notes` marks chord=true by onset+staff alone
       (per_staff[staff] > 0), so two of its own notes can share an onset with DIFFERENT
       durations and still both claim `chord:true`, which is exactly the
       chord-without-first-note case a real corpus file (catalog/method/beyer/001.mxl,
       'advanced'/'original') triggers. Sub-group by (b, dur) first, so only genuinely
       identical-duration simultaneous notes are ever treated as one chord. */
    const byKey = new Map();
    list.forEach(n => { const k = Math.round(n.b * 1000) + ':' + Math.round(n.dur * 1000); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(n); });
    const events = Array.from(byKey.values())
      .map(g => ({ b: g[0].b, dur: Math.max.apply(null, g.map(n => n.dur)), notes: g }))
      .sort((a, b) => a.b - b.b);
    const lanes = []; /* interval-scheduling: each lane's next-free time, in quarters */
    events.forEach(ev => {
      let lane = lanes.find(l => ev.b >= l.end - 1e-6);
      if (!lane) { lane = { end: -Infinity, suffix: lanes.length }; lanes.push(lane); }
      lane.end = ev.b + ev.dur;
      const ordered = ev.notes.slice().sort((a, b) => a.midi - b.midi);
      ordered.forEach((n, i) => out.push(Object.assign({}, n, { voice: lane.suffix === 0 ? voice : voice * 100 + lane.suffix, chord: i > 0 })));
    });
  });
  return out;
}

/* A legacy engine's {m,b,dur,midi,hand,type?,dots?} notes -> a real ScoreGraph, via
   scoregraph/legacy-score.js's own fromScore (the same projection tests/engrave/tools/
   bench.js's suite 'x' already uses for "graphs rebuilt from the Scores the app holds"),
   with real RH/LH hand limbs restored (see assignHandLimbs above) so every hand-dependent
   metric run on the result is measuring something real, not an empty set. */
function graphFromLegacyNotes(measures, notes, tempo, id) {
  /* A ScoreGraph id must match /^[A-Za-z0-9._:-]{1,64}$/ (E-SHAPE) - fromScore only
     sanitizes this itself when `opts.id` is left unset (its own `idOf` helper); passing a
     real corpus PATH here (slashes included) directly as opts.id bypassed that and produced
     an invalid graph id, caught directly (not assumed) via a real corpus file. */
  const safeId = ('g8a-' + String(id)).replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64);
  const score = { id: safeId, tempo: tempo || 80, staves: 2, measures: measures, notes: sanitizeLegacyNotes(notes), sections: [] };
  const r = SG.legacy.fromScore(score, { id: safeId, inferred: true });
  if (r.ok) r.graph = assignHandLimbs(r.graph);
  return r;
}

module.exports = { wireScoreOf, audioNotesOf, runArrangeScorePy, runScoreArranger, runAudioScore, graphFromLegacyNotes };
