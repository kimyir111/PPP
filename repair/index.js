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
     registerFloor the register floor's guard (G9 post-H-8; default realize/theory.js REGISTER_FLOOR, `null` = off): no
                   edit may put a note below it, or lower than it was when it is already below it (`BELOW_FLOOR`)
     leftHandJumpGuard  default on; `false` turns it off (G9 post-H-8 re-look): a repair may not create a left-hand jump (the lowest
                   note below middle C moving an octave or more between consecutive onsets) that was not there (`LEFT_HAND_JUMP`)
     clashGuard    default on; `false` turns it off: a repair may not create a one-hand simultaneous second, a one-hand span of an octave or more (stages <= 3) or a
                   harsh vertical pair (minor second, major seventh, minor ninth) that was not there (`SECOND_UP`, `OCTAVE_CHORD_UP`, `HARSH_PAIR_UP`)
     handChordsGuard  (set by repairSelection for a candidate that went through realize()'s handChords pass; `opts.handChordsGuard: false` turns it off) a repair may not
                   write a violating chord (in the groupings the pass searched: the hands as written, seconds between the two hands' notes, or the pitch grouping around middle C) that the
                   graph did not have (`HAND_CHORD_UP`); `clashStage` is then the plan's stage, for the two guards above
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
      require('../critics/left-hand-jump.js'), require('../critics/register-floor.js'), require('../critics/vertical-clash.js'),
      require('../playability/index.js'), require('../difficulty/index.js'), require('./plan.js'), require('../realize/theory.js'));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const SGG = root.PPPSongGraphModules || {};
    const CM = root.PPPCriticsModules || {};
    const M = root.PPPRepairModules || {};
    root.PPPRepair = factory(SG.ops, SG.pitch, SG.rational, SG.proCritic, SGG.util, SGG.harmony, CM.metrics, CM.voiceLeading,
      CM.registerDensity, CM.leftHandJump, CM.registerFloor, CM.verticalClash, root.PPPPlayability, root.PPPDifficulty, M.plan, (root.PPPRealizeModules || {}).theory);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (OPS, P, R, PC, U, HARM, METRICS, VL, RD, LHJ, RF, VCL, PLA, DIFF, PLAN, TH) {
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
    /* the register floor's guard, checked on the unit itself (so a seeded/test unit is held to it too): a repair
       never moves a note below the floor, or further down when it is already below it */
    if (unit.edits.some(ed => !ed.drop && PLAN.belowFloor(ed.from, ed.to, cfg.floor))) return { ok: false, reasons: ['BELOW_FLOOR'] };
    let res;
    try { res = applyUnit(cur, unit); } catch (e) { return { ok: false, reasons: ['OP_ERROR:' + (e.code || e.message)] }; }
    if (!res.changed) return { ok: false, reasons: ['NOOP'] };
    /* the left-hand jump guard, checked on the applied unit itself (so a seeded/test unit is held to it too): a repair never
       creates a jump (bass moving an octave or more between consecutive onsets) that the graph did not already have */
    if (ctx.leftHandJumpGuard !== false && LHJ.newJumps(RF.notesOf(cur), RF.notesOf(res.graph)) > 0) return { ok: false, reasons: ['LEFT_HAND_JUMP'] };
    /* the clash guard's guard (G9 clash guard, docs/GOALS/G09 section 12): a repair never creates a one-hand simultaneous second or a one-hand span of an
       octave or more (at the stages where the realizer's `handGuard` applies: ctx.stage <= theory.NO_SECONDS_MAX_STAGE; with no stage given only the harsh-pair part runs), nor a harsh vertical pair
       (minor second, major seventh, minor ninth), that the graph did not already have (`SECOND_UP`, `OCTAVE_CHORD_UP`, `HARSH_PAIR_UP`). `ctx.clashGuard: false` turns it off. */
    if (ctx.clashGuard !== false) {
      const created = VCL.newClashes(cur, res.graph);
      const reasons = [];
      const clashStage = ctx.clashStage != null ? ctx.clashStage : ctx.stage;
      if (clashStage != null && clashStage <= TH.NO_SECONDS_MAX_STAGE) { if (created.seconds > 0) reasons.push('SECOND_UP'); if (created.octave > 0) reasons.push('OCTAVE_CHORD_UP'); }
      if (created.harsh > 0) reasons.push('HARSH_PAIR_UP');
      /* G9 source-copied hand chords (docs/GOALS/G09 section 12 "post user review 4"): when the candidate came out of realize()'s `handChords` pass (repairSelection sets
         ctx.handChordsGuard), a repair may not write ANY violating chord the graph did not have, in either grouping (the hands as written and the pitch grouping around
         middle C), by identity (an edit that clears one chord and makes another is refused) */
      if (ctx.handChordsGuard && !reasons.length) {
        const nv = VCL.newViolations(cur, res.graph, ctx.handMaxNotes != null ? { maxNotes: ctx.handMaxNotes } : undefined);
        if ((ctx.handChordsKinds || ['limb', 'pitch']).some(k => nv[k] > 0)) reasons.push('HAND_CHORD_UP');
        /* single-note hands (G9 post user review 5): a hand may not hold more notes at an onset than the pass allowed (a chord made bigger is a new one) */
        if (ctx.handMaxNotes != null && nv.multi > 0) reasons.push('HAND_NOTES_UP');
      }
      if (reasons.length) return { ok: false, reasons: reasons };
    }
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
    /* register floor: `ctx.registerFloor` (default realize/theory.js REGISTER_FLOOR; null = no guard) */
    cfg.floor = ctx.registerFloor === null ? null : (ctx.registerFloor == null ? TH.REGISTER_FLOOR : ctx.registerFloor);
    ctx = Object.assign({}, ctx, { registerFloor: cfg.floor });
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

  /* ---------------------------------------------------------------- G9f: closing sub-sixteenth gaps
     A transcription's note lengths are what a player did, not what a printed edition writes: the arrangement copies the right hand verbatim, so the silences
     between its notes come along as rests of a 32nd, a 64th or a triplet 64th (i10, the 90-bar audio piece: 102 of 169 gaps between right-hand notes were
     shorter than a 16th, 323 rests in the graph, 62 of them 32nd and 53 64th). A printed edition never writes such a rest between two notes: it
     lengthens the note before it or leaves the space. This is run last on the finished arrangement (after selection and repair, so which notes there are, and where,
     is exactly what those two decided), and ONLY for a transcription (repairSelection's `closeGaps`, 'auto': the source graph's provenance says audio-score): a printed
     score's own short rests (czerny849/005 has 50 printed 32nd rests between notes) are what its edition wrote and are left as written.
     The rule, per staff (hand) and measure: a GAP is a stretch in which no note of the staff sounds, from the end of the last note before it (a note of the
     same measure must precede it: a gap at the start of a measure, which would need a note of the measure before, is never touched, so no note crosses a
     barline) to the next onset of any note of the staff or to the end of the measure. A gap of more than 0 and less than a 16th (1/16 of a whole note,
     exactly) is closed: every note that ends where the gap starts is lengthened to the end of the gap (never past the next onset of the hand, never past the
     measure), and the rests of the staff that lie wholly inside the gap are removed (a rest that reaches beyond the gap belongs to another voice that is
     silent there, and stays). No note is shortened, no onset or pitch changes. A lengthened note whose new length is a plain written value (a 32nd and a
     64th make a dotted 16th) takes it as its written value; any other keeps the value it was written with (the importer's own convention: a written value and an
     exact length that differ). The other half: a 32nd or 64th rest among the pieces of a LONGER silence that has a note after it (and the pieces at the start of a measure) is not
     drawn either: the rest event is omitted and the silence stays as it was (no note changes, so the sound is untouched; i10: 25 such rests). A silence with no note after it (the end of a
     measure) keeps its rests. Sound: a lengthened note rings, at most a 16th of a whole note (a quarter of a beat in 4/4) less one grid step, longer, and always
     stops where the hand's next note starts (a few tens of milliseconds at a normal tempo, and with the pedal as it was). */
  const GAP_LIMIT = R.make(1, 16);
  const SIXTEENTH_OR_LONGER = new Set(['whole', 'half', 'quarter', 'eighth', '16th']);
  const GAP_SOURCE = Object.freeze({ kind: 'repair', tool: 'ppp.g9f-gaps', version: '1.0.0' });
  function plainValue(dur) {
    const names = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th'];
    for (let i = 0; i < names.length; i++) {
      for (let dots = 0; dots <= 1; dots++) { /* one dot at most: a double-dotted note is not what a gap's closing should write */
        const v = R.mul(R.make(1, Math.pow(2, i)), R.make(Math.pow(2, dots + 1) - 1, Math.pow(2, dots)));
        if (R.eq(v, dur)) return dots ? { type: names[i], dots: dots } : { type: names[i] };
      }
    }
    return null;
  }
  /* the gaps to close in a graph: [{part, staff, m, a, b, notes: [event], rests: [event]}] (rationals a, b: measure-relative, whole notes) */
  function smallGaps(g, kept) {
    const out = [];
    g.parts.forEach(part => {
      const byKey = new Map();
      part.events.forEach(e => {
        if ((e.kind !== 'note' && e.kind !== 'rest') || e.grace || !e.staff) return;
        const k = e.staff + '|' + e.m;
        if (!byKey.has(k)) byKey.set(k, { staff: e.staff, m: e.m, notes: [], rests: [] });
        byKey.get(k)[e.kind === 'note' ? 'notes' : 'rests'].push(e);
      });
      const mDur = new Map(g.timeline.measures.map(m => [m.id, R.parse(m.dur)]));
      byKey.forEach(grp => {
        if (!grp.notes.length || !mDur.has(grp.m)) return;
        const spans = grp.notes.map(e => { const on = R.parse(e.at); return { e: e, on: on, off: R.add(on, R.parse(e.dur)) }; });
        spans.sort((x, y) => R.cmp(x.on, y.on));
        /* `hasPrev`: a note of this measure ends where the gap starts; `bounded`: a note of this staff starts where it ends */
        const consider = (a, b, hasPrev, bounded) => {
          const len = R.sub(b, a);
          if (!(R.sign(len) > 0)) return;
          const inside = grp.rests.filter(r => { const on = R.parse(r.at); return R.ge(on, a) && R.le(R.add(on, R.parse(r.dur)), b); });
          if (hasPrev && R.lt(len, GAP_LIMIT)) {
            const ending = spans.filter(s => R.eq(s.off, a)).map(s => s.e);
            /* a lengthened note must not run into another event of ITS OWN voice (a rest of that voice that reaches past the gap, or a note of it): then this gap is left as it is */
            const gone = new Set(inside.map(r => r.id));
            const clash = ending.some(n => grp.rests.concat(grp.notes).some(o => o !== n && o.voice === n.voice && !gone.has(o.id) && R.lt(R.parse(o.at), b) && R.gt(R.add(R.parse(o.at), R.parse(o.dur)), a)));
            if (clash) { kept.skipped++; return; }
            out.push({ part: part, staff: grp.staff, m: grp.m, a: a, b: b, notes: ending, rests: inside });
            return;
          }
          /* a silence of a 16th or more (or at the start of the measure), with a note after it: the 32nd and 64th rests among the pieces that tile it are not drawn (the silence stays, in the
             sound too: no note changes). A silence with no note after it (the end of the measure) keeps its rests. */
          if (bounded) {
            const omit = inside.filter(r => r.display && !SIXTEENTH_OR_LONGER.has(r.display.type));
            if (omit.length) out.push({ part: part, staff: grp.staff, m: grp.m, a: a, b: b, notes: [], rests: omit, omitOnly: true });
          }
        };
        if (R.sign(spans[0].on) > 0) consider(R.ZERO, spans[0].on, false, true);
        let cur = spans[0].off;
        for (let i = 1; i < spans.length; i++) {
          if (R.gt(spans[i].on, cur)) consider(cur, spans[i].on, true, true);
          if (R.gt(spans[i].off, cur)) cur = spans[i].off;
        }
        if (R.lt(cur, mDur.get(grp.m))) consider(cur, mDur.get(grp.m), true, false);
      });
    });
    return out;
  }
  /* is this graph a transcription (a recording's heard notes turned into a score by audio-score.js)? */
  function isTranscription(g) { return !!(g && g.provenance && (g.provenance.sources || []).some(x => x.kind === 'audio-score')); }
  function closeSmallGaps(g) {
    try { return closeSmallGapsUnsafe(g); } catch (e) { /* never a throw (a graph this pass does not understand is returned as it is) */ return { graph: g, changed: false, stats: { gaps: 0, notesLengthened: 0, restsRemoved: 0, rewritten: 0, longest: '0', omitted: 0, skipped: 0, failed: String(e && e.message || e).slice(0, 120) } }; }
  }
  function closeSmallGapsUnsafe(g) {
    const stats = { gaps: 0, notesLengthened: 0, restsRemoved: 0, rewritten: 0, longest: '0', omitted: 0, skipped: 0 };
    const gaps = smallGaps(g, stats);
    if (!gaps.length) return { graph: g, changed: false, stats: stats };
    const res = OPS.edit(g, d => {
      const gone = [];
      gaps.forEach(gp => {
        const add = R.sub(gp.b, gp.a);
        gp.notes.forEach(n => {
          const e = d.event(n.id);
          const nd = R.add(R.parse(e.dur), add);
          e.dur = R.format(nd);
          const disp = plainValue(nd);
          if (disp) { e.display = Object.assign({}, e.display || {}, { type: disp.type }); if (disp.dots) e.display.dots = disp.dots; else delete e.display.dots; stats.rewritten++; }
          d.markProv(e, ['rhythm'], 'repaired');
          stats.notesLengthened++;
        });
        gp.rests.forEach(r => gone.push(r.id));
        if (gp.omitOnly) { stats.omitted += gp.rests.length; return; }
        stats.gaps++;
        if (R.gt(add, R.parse(stats.longest))) stats.longest = R.format(add);
      });
      stats.restsRemoved = gone.length;
      d.removeEvents(gone);
      d.touch();
    }, { source: GAP_SOURCE });
    return { graph: res.graph, changed: true, stats: stats };
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
      origMelody: METRICS.originalMelodyNotes(g, sel.plan), harmony: sg.harmony, registerFloor: opts.registerFloor, leftHandJumpGuard: opts.leftHandJumpGuard, clashGuard: opts.clashGuard
    };
    /* the candidate came out of the hand-chords pass (candidates/ turns it on): repair may not bring a violating chord back (ctx.handChordsGuard), at the plan's
       stage (the pass ran at plan.stage, which can be below the request's stage when the candidate was planned at a lower offset) */
    if (sel.report && sel.report.handChords && sel.report.handChords.active && opts.handChordsGuard !== false) {
      ctx.handChordsGuard = true;
      /* which groupings the pass searched (realize/handchords.js MODEL_RULES): the guard watches the same ones */
      const rules = { limb: ['limb'], limbSeconds: ['limb', 'cross'], pitch: ['pitch'], both: ['limb', 'pitch'] };
      ctx.handChordsKinds = rules[sel.report.handChords.model] || ['limb', 'cross'];
      if (sel.report.handChords.handMaxNotes != null) ctx.handMaxNotes = sel.report.handChords.handMaxNotes;
      ctx.clashStage = sel.plan && sel.plan.stage != null ? Math.min(ctx.stage, sel.plan.stage) : ctx.stage;
    }
    /* G9f: a smell the SOURCE graph has itself (the same parallel octaves between the hands, the same leap, the same crossing, at the same place) is only repaired towards the
       source's own pitches (repair/plan.js). `opts.sourceGuard: false` turns it off. */
    if (opts.sourceGuard !== false) {
      try {
        ctx.sourceSmells = VL.voiceLeadingSmells(g);
        const at = new Map();
        U.noteWindows(g).forEach(n => { const k = R.format(n.w0); if (!at.has(k)) at.set(k, new Set()); at.get(k).add(n.midi); });
        ctx.sourcePitchAt = at;
      } catch (e) { delete ctx.sourceSmells; delete ctx.sourcePitchAt; /* no source smells: the guard is off */ }
    }
    const r = repair(sel.graph, ctx, opts);
    const single = !!(sel.report && sel.report.handChords && sel.report.handChords.handMaxNotes != null);
    /* `opts.closeGaps`: 'auto' (the default) closes only for a TRANSCRIPTION: a source graph made by audio-score.js (provenance source kind 'audio-score': a recording's heard notes);
       `true` closes whatever the source (the review packet passes it for an item that is a transcription saved as a file); `false` never. A printed score's own short rests are what
       its edition wrote and are left exactly as written. */
    const closeOpt = opts.closeGaps === undefined ? 'auto' : opts.closeGaps;
    if (single && r.graph && (closeOpt === true || (closeOpt === 'auto' && isTranscription(g)))) {
      const cg = closeSmallGaps(r.graph);
      return Object.assign({ ok: true, ctx: ctx }, r, { graph: cg.graph, report: r.report ? Object.assign({}, r.report, { closedGaps: cg.stats }) : r.report });
    }
    return Object.assign({ ok: true, ctx: ctx }, r);
  }

  return Object.freeze({ VERSION, SOURCE, LEVEL_SLACK, STRUCTURAL, DEFAULTS, snapshot, judge, applyUnit, tryUnit, repair, repairSelection, closeSmallGaps, isTranscription, plan: PLAN });
});
