/* ============================================================================
   PPP Repair (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md §5, G9b) - graph -> graph repair of
   the arrangement G9a selects. Node-only, not loaded by the app (G09 §2, §10).

     repair(graph, ctx, opts) -> { graph, changed, report }

   ctx (everything optional except `profile` for a meaningful hard filter)
     profile       the REQUEST's hand profile - NOT the candidate's own (the round-2 G9a fix): a repair
                   is only accepted if the G5 hard filter passes for the hands actually asked for
     targetLevel   the request's target G6 position (level drift guard)
     stage         G6 stage of that target (register/density bands; from REF.stageForPosition)
     reference     G6 reference-data override (browser require() fix, as everywhere in G8/G9)
     origMelody    `critics/metrics.js originalMelodyNotes(g, plan)` of the plan that made this graph:
                   the notes a repair may never touch, and the melody the guard re-checks
     harmony       the ORIGINAL piece's `sg.harmony`: what per-measure harmony agreement is scored
                   against (default: the input graph's own harmony, i.e. "do not change the reading")
   opts
     maxUnits (64) / maxTrials (160) / maxSweeps (4)   budgets, reported when hit (`report.truncated`)
     seedUnits     TEST/DIAGNOSTIC HOOK: units (repair/plan.js shape) tried before any planned one, so
                   a test can plant a repair that would add a hard violation and watch it roll back

   ---- what "one repair" is, and the rollback (G09 §4: G3-D5's shape, not a second mechanism) ----
   `repair/plan.js` proposes a UNIT: the edits to ONE measure (one octave displacement, or one
   dropped doubling). The unit is applied to a private copy with `scoregraph/ops.js`'s `edit()` (one
   validated transaction) and then judged by the real critics; if any check fails the copy is thrown
   away and the measure stays exactly as it was - a per-measure rollback by construction (a
   rejected unit is never committed; there is nothing to undo). G3's own critic is reused for the
   structural check: `pro-critic.js` `fingerprint`/`diff` over every component a pitch edit may not
   change (rests, pieces, tuplets, beams, keys, clefs, ottava, timeline, play, perf, pedal, xties).

   ---- when a measure has got "worse", defined up front ----
   Compared with the graph the unit was applied to, over EVERY measure (an edit can land its effect
   in the next measure):
     hard       any G5 hard-violation code count, or the total, goes UP for the request's profile
                (so a repair NEVER adds a hard violation; a measure that already had some may not
                gain another)
     smells     a per-category voice-leading smell count goes UP in any measure; and the unit's own
                op must have net-reduced its target (voice-leading ops: total smells strictly
                down; dropDoubling: the measure's chord-load excess strictly down, smells not up)
     harmony    windows whose (root, quality) match the reference go DOWN in any measure
     melody     original melody notes matched go DOWN in any measure (structurally impossible - the
                notes are never edited - but re-checked against the real metric, not assumed)
     density    a measure's register/density overage (critics/register-density.js's own step
                function applied to the measure's local features) goes UP
   And against the ORIGINAL input, cumulatively (not attributable to one measure):
     piece density   the piece-level register/density overage may not exceed the input's
     level           |assessed level - target| may not grow by more than LEVEL_SLACK (0.05)
   The G5 filter is re-run on the FINAL graph too (fingering does not move a pitch, but the
   guarantee is checked, not argued): a final count above the input's returns the input.

   ---- provenance ----
   Every edited head gets `prov.asp.pitch = {src, op:'repaired'}` and head-level op 'repaired'
   (the event too); a dropped-doubling's event gets `prov.asp.exists`. Source: {kind:'repair',
   tool:'ppp.g9b-repair'} - both already in scoregraph/schema.js (PROV_OPS, SOURCE_KINDS): the
   schema is unchanged. Fingering is then recomputed once for the whole graph (the same
   `playability/fingering.js fingerGraph` `realize()` ends with) because an octave shift changes
   the notes a finger DP sees; only heads whose fingering is already 'inferred' are rewritten.

   ---- determinism and idempotence ----
   No randomness, no clock. Sweeps repeat (fresh `failed` set each time) until one accepts
   nothing, so a repaired graph is a fixed point: repair(repair(g)) returns the input object
   itself, byte for byte (tests/repair/repair.test.js). */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/ops.js'), require('../scoregraph/pitch.js'), require('../scoregraph/rational.js'),
      require('../scoregraph/pro-critic.js'), require('../songgraph/util.js'), require('../songgraph/harmony.js'),
      require('../critics/metrics.js'), require('../critics/voice-leading.js'), require('../critics/register-density.js'),
      require('../playability/index.js'), require('../difficulty/index.js'), require('./plan.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const SGG = root.PPPSongGraphModules || {};
    const CM = root.PPPCriticsModules || {};
    const M = root.PPPRepairModules || {};
    root.PPPRepair = factory(SG.ops, SG.pitch, SG.rational, SG.proCritic, SGG.util, SGG.harmony, CM.metrics, CM.voiceLeading,
      CM.registerDensity, root.PPPPlayability, root.PPPDifficulty, M.plan);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (OPS, P, R, PC, U, HARM, METRICS, VL, RD, PLA, DIFF, PLAN) {
  'use strict';

  const VERSION = '1.0.0';
  const SOURCE = Object.freeze({ kind: 'repair', tool: 'ppp.g9b-repair', version: VERSION });
  const LEVEL_SLACK = 0.05;
  const EPS = 1e-9;
  const DEFAULTS = Object.freeze({ maxUnits: 64, maxTrials: 160, maxSweeps: 4 });
  /* the G3-critic components a repair (a pitch edit or a head drop) may not change; 'onsets',
     'sound', 'place', 'spelling', 'acc' and 'marks' carry a pitch and legitimately differ */
  const STRUCTURAL = Object.freeze(['rests', 'pieces', 'tuplets', 'beams', 'keys', 'clefs', 'ottava', 'timeline', 'play', 'perf', 'pedal', 'xties']);
  const DENSITY_LOCAL = Object.freeze([['notesPerBeatRH', 'p90'], ['notesPerBeatLH', 'p90'], ['densityRH', 'p90'], ['densityLH', 'p90'], ['chordLoad', 'max']]);

  /* ---------------------------------------------------------------- snapshot */
  function measureIndex(g) {
    const ids = g.timeline.measures.map(m => m.id);
    const starts = []; let acc = R.ZERO;
    g.timeline.measures.forEach(m => { starts.push(R.toNumber(acc) * 4); acc = R.add(acc, R.parse(m.dur)); });
    return { ids: ids, starts: starts };
  }
  function measureOfQ(mi, q) {
    let k = 0;
    for (let i = 0; i < mi.starts.length; i++) { if (mi.starts[i] <= q + 1e-9) k = i; else break; }
    return mi.ids[k];
  }

  /* everything the guard compares, computed once per graph state */
  function snapshot(g, ctx, cfg) {
    const s = {};
    const an = PLA.analyzeGraph(g, { profile: ctx.profile });
    s.hard = { total: an.totals.hard, byCode: an.totals.byCode, perM: an.measures };

    const notes = U.noteWindows(g);
    const sm = VL.smellsFromNotes(notes, VL.voiceAveragesOf(g));
    const mOfW = new Map(); notes.forEach(n => { const k = R.format(n.w0); if (!mOfW.has(k)) mOfW.set(k, n.m); });
    const perM = {};
    const bump = (w0, cat) => { const m = mOfW.get(w0); if (m == null) return; (perM[m] = perM[m] || { parallels: 0, innerLeaps: 0, crossings: 0 })[cat]++; };
    sm.parallels.forEach(x => bump(x.w0, 'parallels')); sm.innerLeaps.forEach(x => bump(x.w0, 'innerLeaps')); sm.crossings.forEach(x => bump(x.w0, 'crossings'));
    s.smells = { total: sm.count, byCat: { parallels: sm.parallels.length, innerLeaps: sm.innerLeaps.length, crossings: sm.crossings.length }, perM: perM };

    const win = HARM.harmonyOf(g), ref = cfg.refHarmony;
    const n = Math.min(ref.length, win.length);
    const hp = {}; let hm = 0;
    for (let i = 0; i < n; i++) {
      const ok = ref[i].root === win[i].root && ref[i].quality === win[i].quality;
      hp[win[i].m] = (hp[win[i].m] || 0) + (ok ? 1 : 0);
      if (ok) hm++;
    }
    s.harmony = { perM: hp, matched: hm, n: n };

    if (ctx.origMelody) {
      const mi = measureIndex(g);
      const cand = new Map();
      METRICS.graphNoteList(g).forEach(c => { if (!cand.has(c.midi)) cand.set(c.midi, []); cand.get(c.midi).push(c.onsetQ); });
      const mp = {}; let total = 0;
      ctx.origMelody.forEach(o => {
        const hit = (cand.get(o.midi) || []).some(q => Math.abs(q - o.onsetQ) <= PLAN.MELODY_TOL_Q);
        const m = measureOfQ(mi, o.onsetQ);
        mp[m] = (mp[m] || 0) + (hit ? 1 : 0);
        if (hit) total++;
      });
      s.melody = { perM: mp, matched: total, n: ctx.origMelody.length };
    } else s.melody = null;

    s.density = null;
    if (cfg.band) {
      const f = DIFF.features.featuresOf(g);
      const dm = {}, chordExcess = {};
      f.measures.forEach(row => {
        let over = 0;
        DENSITY_LOCAL.forEach(([key, kind]) => {
          const ceiling = cfg.band[key] ? cfg.band[key][kind] : 0;
          over += RD.overageOf(row.local[key], ceiling);
        });
        dm[row.id] = over;
        const cl = cfg.band.chordLoad ? cfg.band.chordLoad.max : 0;
        chordExcess[row.id] = Math.max(0, row.local.chordLoad - cl);
      });
      s.density = { perM: dm, chordExcess: chordExcess, piece: RD.registerDensity(g, ctx.stage, { reference: ctx.reference }).overage };
    }
    s.level = ctx.targetLevel != null ? METRICS.levelOfGraph(g) : null;
    return s;
  }

  /* ---------------------------------------------------------------- judging */
  const get = (o, k, d) => (o && o[k] != null ? o[k] : d);

  function judge(prev, next, unit, base0, ctx) {
    const why = [];
    /* hard: the G5 filter for the request's profile */
    if (next.hard.total > prev.hard.total) why.push('HARD_TOTAL_UP');
    new Set(Object.keys(prev.hard.perM).concat(Object.keys(next.hard.perM))).forEach(m => {
      const a = get(prev.hard.perM, m, { hard: 0, byCode: {} }), b = get(next.hard.perM, m, { hard: 0, byCode: {} });
      if (b.hard > a.hard) why.push('HARD_UP@' + m);
      new Set(Object.keys(a.byCode || {}).concat(Object.keys(b.byCode || {}))).forEach(code => {
        if ((b.byCode[code] || 0) > (a.byCode[code] || 0)) why.push('HARD_' + code + '_UP@' + m);
      });
    });
    /* smells */
    new Set(Object.keys(prev.smells.perM).concat(Object.keys(next.smells.perM))).forEach(m => {
      const a = get(prev.smells.perM, m, {}), b = get(next.smells.perM, m, {});
      PLAN.CATS.forEach(c => { if ((b[c] || 0) > (a[c] || 0)) why.push('SMELL_' + c + '_UP@' + m); });
    });
    if (unit.op === 'dropDoubling') {
      if (next.smells.total > prev.smells.total) why.push('SMELLS_UP');
      if (prev.density && next.density) {
        if (!(get(next.density.chordExcess, unit.m, 0) < get(prev.density.chordExcess, unit.m, 0) - EPS)) why.push('CHORD_EXCESS_NOT_DOWN@' + unit.m);
      } else why.push('NO_DENSITY_BAND');
    } else if (!(next.smells.total < prev.smells.total)) why.push('SMELLS_NOT_DOWN');
    /* harmony, melody */
    new Set(Object.keys(prev.harmony.perM).concat(Object.keys(next.harmony.perM))).forEach(m => {
      if (get(next.harmony.perM, m, 0) < get(prev.harmony.perM, m, 0)) why.push('HARMONY_DOWN@' + m);
    });
    if (prev.melody && next.melody) {
      if (next.melody.matched < prev.melody.matched) why.push('MELODY_DOWN');
      new Set(Object.keys(prev.melody.perM).concat(Object.keys(next.melody.perM))).forEach(m => {
        if (get(next.melody.perM, m, 0) < get(prev.melody.perM, m, 0)) why.push('MELODY_DOWN@' + m);
      });
    }
    /* density: per measure, then the piece, cumulative against the input */
    if (prev.density && next.density) {
      Object.keys(next.density.perM).forEach(m => { if (next.density.perM[m] > get(prev.density.perM, m, 0) + EPS) why.push('DENSITY_UP@' + m); });
      if (next.density.piece > base0.density.piece + EPS) why.push('PIECE_DENSITY_UP');
    }
    if (base0.level != null && next.level != null && Math.abs(next.level - ctx.targetLevel) > Math.abs(base0.level - ctx.targetLevel) + LEVEL_SLACK) why.push('LEVEL_DRIFT');
    return why;
  }

  /* ---------------------------------------------------------------- applying a unit */
  function applyUnit(g, unit) {
    return OPS.edit(g, d => {
      unit.edits.forEach(ed => {
        const h = d.head(ed.headId), e = d.event(ed.eventId);
        const src = d.source();
        /* a head is stamped at head level (op 'repaired', its pitch aspect too); an event only on the
           aspect it changed - an event-level op would be inherited by every untouched sibling head */
        const stamp = (entity, aspect, headLevel) => {
          entity.prov = Object.assign({}, entity.prov || {}, headLevel ? { src: src, op: 'repaired' } : {});
          entity.prov.asp = Object.assign({}, entity.prov.asp || {});
          entity.prov.asp[aspect] = { src: src, op: 'repaired' };
        };
        if (ed.drop) {
          if (e.heads.length < 2) throw new OPS.OpError('E-OP-TARGET', 'dropDoubling would empty ' + e.id);
          e.heads = e.heads.filter(x => x.id !== ed.headId);
          d.hd.delete(ed.headId);
          d.retire(ed.headId, null);
          stamp(e, 'exists');
        } else {
          const cur = h.pitch;
          if (P.midi(cur) !== ed.from) throw new OPS.OpError('E-OP-TARGET', 'head ' + ed.headId + ' is no longer ' + ed.from);
          const dOct = (ed.to - ed.from) / 12;
          if (!Number.isInteger(dOct)) throw new OPS.OpError('E-OP-TARGET', 'a repair only moves a head by whole octaves');
          h.pitch = (cur.alter || 0) ? { step: cur.step, alter: cur.alter, oct: cur.oct + dOct } : { step: cur.step, oct: cur.oct + dOct };
          stamp(h, 'pitch', true);
          stamp(e, 'pitch', false);
        }
        d.touch();
      });
    }, { source: SOURCE });
  }

  function tryUnit(cur, unit, ctx, cfg, prevSnap, prevFp, base0) {
    let res;
    try { res = applyUnit(cur, unit); } catch (e) { return { ok: false, reasons: ['OP_ERROR:' + (e.code || e.message)] }; }
    if (!res.changed) return { ok: false, reasons: ['NOOP'] };
    const fp = PC.fingerprint(res.graph);
    const structural = PC.diff(prevFp, fp, STRUCTURAL);
    if (structural.length) return { ok: false, reasons: structural.map(x => 'STRUCTURE:' + x.component) };
    const snap = snapshot(res.graph, ctx, cfg);
    const why = judge(prevSnap, snap, unit, base0, ctx);
    return why.length ? { ok: false, reasons: why } : { ok: true, graph: res.graph, snap: snap, fp: fp };
  }

  /* ---------------------------------------------------------------- the loop */
  function summary(snap) {
    return {
      hard: snap.hard.total, smells: snap.smells.total, smellsByCat: snap.smells.byCat,
      harmonyRootQuality: snap.harmony.n ? snap.harmony.matched / snap.harmony.n : null,
      melodyMatched: snap.melody ? snap.melody.matched : null,
      densityOverage: snap.density ? snap.density.piece : null, level: snap.level
    };
  }

  function repair(g, ctx, opts) {
    ctx = ctx || {}; opts = opts || {};
    const cfg = Object.assign({}, DEFAULTS, opts);
    cfg.refHarmony = ctx.harmony || HARM.harmonyOf(g);
    cfg.band = ctx.stage != null ? RD.densityBand(ctx.stage, ctx.reference) : null;
    const t0 = Date.now();
    const measureNumber = new Map(g.timeline.measures.map(m => [m.id, m.number]));
    const report = { version: VERSION, units: [], accepted: 0, rolledBack: 0, unplannable: 0, sweeps: 0, truncated: false,
      byOp: {}, repairedMeasures: [], rolledBackMeasures: [], fallback: null };
    const noteOp = (op, k) => { (report.byOp[op] = report.byOp[op] || { accepted: 0, rolledBack: 0 })[k]++; };

    let snap0;
    try { snap0 = snapshot(g, ctx, cfg); } catch (e) { report.fallback = 'BASELINE_FAILED: ' + String(e && e.message || e); return { graph: g, changed: false, report: report }; }
    report.before = summary(snap0);

    let cur = g, snapCur = snap0, fpCur = PC.fingerprint(g), trials = 0;
    const seed = (opts.seedUnits || []).slice();

    const attempt = unit => {
      trials++;
      const r = tryUnit(cur, unit, ctx, cfg, snapCur, fpCur, snap0);
      const rec = { op: unit.op, m: unit.m, measure: measureNumber.get(unit.m), key: unit.key, edits: unit.edits.map(e => ({ headId: e.headId, from: e.from, to: e.drop ? null : e.to })), ok: r.ok };
      if (r.ok) {
        cur = r.graph; snapCur = r.snap; fpCur = r.fp;
        report.accepted++; noteOp(unit.op, 'accepted');
        if (report.repairedMeasures.indexOf(unit.m) < 0) report.repairedMeasures.push(unit.m);
      } else {
        rec.reasons = r.reasons.slice(0, 6);
        report.rolledBack++; noteOp(unit.op, 'rolledBack');
        if (report.rolledBackMeasures.indexOf(unit.m) < 0) report.rolledBackMeasures.push(unit.m);
      }
      report.units.push(rec);
      return r.ok;
    };

    outer:
    for (let sweep = 0; sweep < cfg.maxSweeps; sweep++) {
      report.sweeps++;
      const failed = new Set(), noPlan = new Set();
      let acceptedThisSweep = 0;
      for (;;) {
        if (report.accepted >= cfg.maxUnits || trials >= cfg.maxTrials) { report.truncated = true; break outer; }
        let unit = null;
        if (seed.length) unit = seed.shift();
        else {
          const state = PLAN.annotate(cur, ctx);
          const L = PLAN.listSmells(state);
          for (const item of L.list) {
            const key = PLAN.smellKey(item);
            if (failed.has(key)) continue;
            unit = PLAN.planSmell(state, L.smells, item);
            if (unit) break;
            failed.add(key); noPlan.add(key); /* not repairable within the declared constraints: left in place */
          }
          if (!unit && snapCur.density) {
            const order = cur.timeline.measures.map(m => m.id);
            for (const m of order) {
              if (!(get(snapCur.density.chordExcess, m, 0) > EPS)) continue;
              const us = PLAN.planDropDoubling(state, L.smells, m, failed);
              if (us.length) { unit = us[0]; break; }
            }
          }
          if (!unit) { report.unplannable = noPlan.size; break; }
        }
        if (attempt(unit)) acceptedThisSweep++; else failed.add(unit.key);
      }
      if (!acceptedThisSweep) break;
    }

    if (cur === g) { report.after = report.before; report.ms = Date.now() - t0; return { graph: g, changed: false, report: report }; }

    /* fingering: the notes a finger DP sees changed, so it is recomputed once (inferred heads only) */
    let out = cur;
    try { out = PLA.fingering.fingerGraph(cur, { source: PLA.fingering.SOURCE }).graph; }
    catch (e) { report.fallback = 'FINGERING_FAILED: ' + String(e && e.message || e); return { graph: g, changed: false, report: report }; }
    let final;
    try { final = snapshot(out, ctx, cfg); } catch (e) { report.fallback = 'FINAL_SNAPSHOT_FAILED: ' + String(e && e.message || e); return { graph: g, changed: false, report: report }; }
    /* per code: no G5 hard-violation code's count may rise (a total that stays level could hide one code
       rising while another falls) */
    const codeUp = Object.keys(final.hard.byCode || {}).some(c => (final.hard.byCode[c] || 0) > ((snap0.hard.byCode || {})[c] || 0));
    if (final.hard.total > snap0.hard.total || codeUp || (snap0.melody && final.melody.matched < snap0.melody.matched)) {
      report.fallback = 'FINAL_CHECK_FAILED'; report.after = report.before; return { graph: g, changed: false, report: report };
    }
    report.after = summary(final);
    report.ms = Date.now() - t0;
    return { graph: out, changed: true, report: report };
  }

  /* Repair the graph `candidates/index.js` selected. `selection` is `run()`'s / `select()`'s result
     ({ok, selected}); the request's hand profile, target and the selected candidate's own melody
     plan supply the ctx. Returns repair()'s result, or {graph: null, ok:false} if nothing was selected. */
  function repairSelection(selection, g, sg, request, opts) {
    if (!selection || !selection.ok) return { ok: false, graph: null, changed: false, report: null };
    opts = opts || {};
    const sel = selection.selected;
    const REF = opts.REF || require('../arrangement/reference.js');
    const ctx = {
      profile: request.handProfile, targetLevel: request.targetLevel,
      stage: REF.stageForPosition(request.targetLevel, opts.reference), reference: opts.reference,
      origMelody: METRICS.originalMelodyNotes(g, sel.plan), harmony: sg.harmony
    };
    const r = repair(sel.graph, ctx, opts);
    return Object.assign({ ok: true, ctx: ctx }, r);
  }

  return Object.freeze({ VERSION, SOURCE, LEVEL_SLACK, STRUCTURAL, DEFAULTS, snapshot, judge, applyUnit, tryUnit, repair, repairSelection, plan: PLAN });
});
