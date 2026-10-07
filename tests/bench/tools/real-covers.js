#!/usr/bin/env node
/* G10c-1a: the arranger on real piano covers (the private heard notes of the teacher's six pieces), reduce against leadsheet.

     node tests/bench/tools/real-covers.js --heard DIR [--mode reduce|leadsheet|both] [--levels beginner,intermediate,advanced] [--only p1,p2] [--out result.json]

   DIR holds `<id>.json` heard notes ({ notes: [{on, off, midi, vel}], duration, ... }, the shape review/h10/collect.js writes). They are PRIVATE: this tool reads them, prints
   and writes AGGREGATES ONLY (made / refused, checker classes, hard violations, attacks per bar and hand, share of right-hand attacks above C6), never a note, and
   nothing it writes carries heard-note data. Each piece goes through the app's own recording conversion (review/lib/appcode.js convertHeard: the options of
   Import.finishHeard, v2) and then through the app's own arrangeSingleNote (tests/realize/app-single-extract.js) at each level with the given `recordingArrange` mode. */
'use strict';
const fs = require('fs');
const path = require('path');

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const REPO = path.resolve(__dirname, '..', '..', '..');
const R = p => require(path.join(REPO, p));

const APP = R('review/lib/appcode.js');
const E = R('tests/realize/app-single-extract.js');
const RAT = R('scoregraph/rational.js');
const UTIL = R('songgraph/util.js');
const PLA = R('playability/index.js');
const NC = R('scoregraph/tools/notation-check.js');
const M = R('tests/bench/node/rec-arrange-metrics.js');

const heardDir = arg('--heard');
const mode = arg('--mode') || 'both';
const levels = (arg('--levels') || 'beginner,intermediate,advanced').split(',');
const only = arg('--only') ? arg('--only').split(',') : null;
const outPath = arg('--out');
if (!heardDir) { process.stderr.write('usage: real-covers.js --heard DIR [--mode reduce|leadsheet|both] [--levels a,b] [--only p1,p2] [--out result.json]\n'); process.exit(2); }

function staffIndex(g) { const m = new Map(); g.parts.forEach(p => p.staves.forEach((s, i) => m.set(s.id, i))); return m; }
function tieStops(g) { const s = new Set(); g.parts.forEach(p => (p.spanners || []).forEach(sp => { if (sp.type === 'tie' && sp.to) s.add(sp.to); })); return s; }
function notesOf(g) {
  const si = staffIndex(g), ts = tieStops(g);
  return UTIL.noteWindows(g).map(n => ({ q0: RAT.toNumber(n.w0) * 4, q1: RAT.toNumber(n.w1) * 4, midi: n.midi, staff: si.get(n.staff) || 0, tieStop: ts.has(n.headId) }));
}
const r3 = x => (x == null ? null : Math.round(x * 1000) / 1000);

/* aggregates of one arrangement graph */
function measure(g, request) {
  const ix = M.indexNotes(notesOf(g));
  const bars = g.timeline.measures.length;
  const rh = ix.onsets.filter(n => n.staff === 0), lh = ix.onsets.filter(n => n.staff === 1);
  let hard = null;
  try { hard = PLA.analyzeGraph(g, { profile: (request && request.handProfile) || 'medium' }).totals.hard; } catch (e) { hard = null; }
  const out = { bars: bars, rh_per_bar: r3(rh.length / bars), lh_per_bar: r3(lh.length / bars), rh_above_c6: r3(rh.length ? rh.filter(n => n.midi > M.C6).length / rh.length : null), hard: hard };
  try {
    const rep = NC.checkGraph(g);
    out.classes = {};
    for (let c = 1; c <= 7; c++) out.classes[c] = rep.classes[c].count;
    out.classes_total = Object.keys(out.classes).reduce((a, k) => a + out.classes[k], 0);
  } catch (e) { out.classes = null; out.check_error = String(e && e.message || e); }
  return out;
}

(async () => {
  const ref = E.reference();
  const app = E.make({ window: E.nodeWindow(), Score: {}, loadArrangerReference: () => Promise.resolve(ref) });
  const files = fs.readdirSync(heardDir).filter(f => /^p\d+\.json$/.test(f)).sort();
  const result = { mode: mode, levels: levels, pieces: {} };
  for (const f of files) {
    const id = f.replace(/\.json$/, '');
    if (only && only.indexOf(id) < 0) continue;
    const heard = JSON.parse(fs.readFileSync(path.join(heardDir, f), 'utf8'));
    const t0 = Date.now();
    const conv = APP.convertHeard(heard, id, true);
    const g = conv.built.graph;
    const piece = { heard_notes: heard.notes.length, v2: conv.v2, rejected: conv.rejected, bars: g.timeline.measures.length, convert_ms: Date.now() - t0, transcription: measure(g, { handProfile: 'medium' }), arrangements: {} };
    for (const m of (mode === 'both' ? ['reduce', 'leadsheet'] : [mode])) {
      piece.arrangements[m] = {};
      for (const level of levels) {
        const t1 = Date.now();
        let a;
        try { a = await app.arrangeSingleNote(g, { level: level, recordingArrange: m }); } catch (e) { a = { ok: false, reason: 'THROW', message: String(e && e.message || e) }; }
        const row = { ok: !!a.ok, ms: Date.now() - t1 };
        if (a.ok) Object.assign(row, measure(a.graph, a.report && a.report.request), { levelNote: a.levelNote || null, rescued: a.rescued ? a.rescued.length : 0, degraded: !!a.degraded, leadsheet: a.leadsheet || null });
        else { row.reason = a.reason; if (a.message) row.message = String(a.message).slice(0, 200); }
        piece.arrangements[m][level] = row;
        process.stderr.write(id + ' ' + m + ' ' + level + ': ' + (a.ok ? 'made' : 'REFUSED ' + a.reason) + ' (' + row.ms + ' ms)\n');
      }
    }
    result.pieces[id] = piece;
  }
  const text = JSON.stringify(result, null, 1);
  if (outPath) fs.writeFileSync(outPath, text + '\n'); else process.stdout.write(text + '\n');
})().catch(e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
