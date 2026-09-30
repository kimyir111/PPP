/* G9c: the two arrangements of one review item.

   For an item (input file, target G6 level, hand profile):
     G9 arm      candidates/index.js `run` (G9a best-of-N with the engrave gate, all defaults) -> repair/index.js
                 `repairSelection` (G9b), at the request { targetLevel, handProfile, sections:'all' } - exactly the wiring
                 realize/tools/harness.js `runFile` uses for its `g9aRepair` row, at the request the G8a plan search finds.
     legacy arm  the app's in-page `ScoreArranger` (realize/tools/legacy.js `runScoreArranger`, run on the wire score of
                 the ORIGINAL piece), tried at each of its four native levels; the one whose measured G6 position is closest
                 to the SAME target is kept (harness.js `bestLegacyRun`, the same fairness every harness row gets).

   Which legacy engine, and why ScoreArranger: of the three legacy engines the G8a harness measured it is the strongest
   on the harness metrics (G09 section 12: hard violations, melody, harmony, level), and it is the engine the app runs in
   the page; arrange_score.py is the Python helper path and audio-score.js has no notated rhythm or hands. Comparing against
   the strongest legacy engine is the conservative test of G9.

   Both arms come back as flat note lists in the SAME shape (the wire-score notes); nothing about how each was made is kept
   on them here. review/lib/neutral.js then draws both through one identical path. */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..');
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
const L = require(path.join(REPO, 'realize/tools/legacy.js'));
const M = require(path.join(REPO, 'critics/metrics.js'));
const CAND = require(path.join(REPO, 'candidates/index.js'));
const REPAIR = require(path.join(REPO, 'repair/index.js'));
const HARNESS = require(path.join(REPO, 'realize/tools/harness.js'));
const NEUTRAL = require('./neutral.js');

const LEGACY_LEVELS = ['beginner', 'intermediate', 'advanced', 'original']; /* the same four, same order as harness.js */
const LEGACY_TIMEOUT_MS = 120000;
const WORKER = path.join(__dirname, 'legacy-worker.js');

/* the legacy engine's four levels for one wire score, each as a note list (or an error), in a child process */
function legacyNotesAllLevels(ws, timeoutMs) {
  const r = spawnSync(process.execPath, [WORKER], {
    input: JSON.stringify({ ws: ws, levels: LEGACY_LEVELS, style: 'balanced' }),
    timeout: timeoutMs || LEGACY_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8'
  });
  if (r.error) return { error: r.error.code === 'ETIMEDOUT' ? 'legacy-timeout' : 'legacy-spawn: ' + r.error.message };
  if (r.status !== 0) return { error: 'legacy-worker exit ' + r.status + ': ' + String(r.stderr).slice(0, 200) };
  try { return JSON.parse(r.stdout); } catch (e) { return { error: 'legacy-worker output: ' + e.message }; }
}

/* one item -> { ok, ... } or { ok:false, reason }. `opts.legacyTimeoutMs` is for tests. Deterministic: no clock, no randomness. */
async function arrangeItem(item, opts) {
  opts = opts || {};
  const file = item.file, profile = item.handProfile, target = item.targetLevel;
  let g, sg;
  try { g = await H.graphOf(file); sg = g && SGG.analyze(g); } catch (e) { return { ok: false, reason: 'import/analyze: ' + String(e && e.message || e) }; }
  if (!g) return { ok: false, reason: 'does not open' };
  const request = { targetLevel: target, handProfile: profile, sections: 'all' };

  /* ---- G9 arm ---- */
  const sel = CAND.run(g, sg, request, opts.singleNoteHands ? { singleNoteHands: true } : {});
  if (!sel.ok) return { ok: false, reason: 'g9-no-selection: ' + sel.reason };
  const rr = REPAIR.repairSelection(sel, g, sg, request);
  if (!rr.ok || !rr.graph) return { ok: false, reason: 'g9-repair-failed' };
  const g9graph = rr.graph;
  const name = path.basename(file);
  const ws = L.wireScoreOf(g, name);
  const ws9 = L.wireScoreOf(g9graph, name);
  const sameMeasures = ws.measures.length === ws9.measures.length &&
    ws.measures.every((m, i) => m.number === ws9.measures[i].number && m.lenQ === ws9.measures[i].lenQ);
  if (!sameMeasures) return { ok: false, reason: 'g9-measures-differ-from-original' };

  /* ---- legacy arm ---- */
  const all = legacyNotesAllLevels(ws, opts.legacyTimeoutMs);
  if (all.error) return { ok: false, reason: all.error };
  const best = HARNESS.bestLegacyRun(levelName => {
    const notes = all.notes[levelName];
    if (!notes || notes.error) return { error: (notes && notes.error) || 'no notes' };
    const proj = L.graphFromLegacyNotes(ws.measures, notes, ws.tempo, name);
    if (!proj.ok) return { error: 'projection failed' };
    /* `level` is the measured G6 position (bestLegacyRun's own contract); the level's name rides along */
    return { levelName: levelName, level: M.levelOfGraph(proj.graph), notes: notes };
  }, target);
  if (!best) return { ok: false, reason: 'legacy-no-usable-level' };

  /* two arms with exactly the same sounding notes (G9 leaves a piece alone at its own level, and so may the legacy engine) give
     the reviewer nothing to compare: reported so the selection can pass over the piece */
  const identical = JSON.stringify(NEUTRAL.audioNotes(ws.measures, ws9.notes)) === JSON.stringify(NEUTRAL.audioNotes(ws.measures, best.notes));

  const meta = g.meta || {};
  return {
    ok: true, identical: identical, item: item, file: file, name: name,
    title: String(meta.title || path.basename(file).replace(/\.(musicxml|xml|mxl)$/i, '')),
    composer: meta.composer ? String(meta.composer) : null,
    tempo: ws.tempo, measures: ws.measures,
    g9: {
      notes: ws9.notes, level: M.levelOfGraph(g9graph),
      hard: M.hardViolationsOfGraph(g9graph, profile).hard,
      spec: sel.selected.spec, repairedUnits: rr.report ? rr.report.accepted : 0, changedByRepair: !!rr.changed,
      explanation: sel.explanation
    },
    legacy: {
      engine: 'ScoreArranger', levelName: best.levelName, level: best.level, notes: best.notes,
      levelDistance: Math.abs(best.level - target)
    }
  };
}

module.exports = { arrangeItem, legacyNotesAllLevels, LEGACY_LEVELS, LEGACY_TIMEOUT_MS };
