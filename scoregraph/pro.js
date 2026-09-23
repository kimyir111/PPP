/* ============================================================================
   PPP ScoreGraph — professionalize(): G3's notation pipeline
   (docs/GOALS/G03 §5, §14, §15, §16, §17)

     professionalize(g, opts) -> {graph, report, idMap}

   The same music, better notation: graph -> graph passes in a fixed order,
   each a pure function that returns its input itself when it has nothing to
   do (so the pipeline is a fixed point, §16). After every pass that changed
   something the critic (pro-critic.js) compares the two graphs; a pass that
   touched what it did not declare is run again without the measures it
   broke, and if that is not enough the whole input comes back
   (report.fallback). Nothing is silent: every such step is an N-* issue in
   the report. opts.strict throws instead (tests).

   opts
     mode      'rewrite' (default) | 'fill' | 'force'   what a pass may touch (§14.1)
     passes    {staff, voice, rhythm, tuplet, spell, beam, marks: bool}   one pass off (tests, bisect)
     g3b       false (default)   G3b: R-reg and performance-based voices (§6.4, §8.3; D1: off until M11)
     ottava    false (default)   the automatic 8va pass (§13.3; D2: off until issue 3)
     strict    false             throw a CriticError on the first violation
     passList  (tests only)      run these pass objects instead of G3's own
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./rational.js'), require('./validate.js'), require('./meter-grid.js'), require('./pro-critic.js'),
      require('./pro-staff.js'), require('./pro-voice.js'), require('./pro-rhythm.js'), require('./pro-tuplet.js'),
      require('./pro-spell.js'), require('./pro-beam.js'), require('./pro-marks.js'));
  else {
    const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {};
    M.pro = factory(M.rational, M.validate, M.meterGrid, M.proCritic, M.proStaff, M.proVoice, M.proRhythm, M.proTuplet,
      M.proSpell, M.proBeam, M.proMarks);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, V, MG, C, Pstaff, Pvoice, Prhythm, Ptuplet, Pspell, Pbeam, Pmarks) {
  'use strict';

  /* G3's own version: in the provenance source it registers (§17) and in every report. It changes with any change
     to what G3 writes. */
  const VERSION = '1.0.0';
  const SOURCE = Object.freeze({ kind: 'generator', tool: 'ppp.g3', version: VERSION });
  const MODES = ['rewrite', 'fill', 'force'];

  class CriticError extends Error {
    constructor(pass, violations) {
      super('G3 critic: pass ' + pass + ' changed ' + violations.map(v => v.component + ' (' + v.where.slice(0, 5).join(', ') + ')').join('; '));
      this.name = 'CriticError';
      this.code = 'E-G3-CRITIC';
      this.pass = pass;
      this.violations = violations;
    }
  }

  /* ------------------------------------------------------------ permission (§14.1) */
  /* The op of an entity's aspect, as prov.provOf would give it, from the entity and its containers directly. */
  function opOf(g, entity, aspect, containers) {
    const pick = p => (p && typeof p === 'object' ? p : null);
    const own = pick(entity.prov);
    const chain = [];
    if (own && own.asp && own.asp[aspect]) chain.push(own.asp[aspect]);
    if (own) chain.push(own);
    (containers || []).forEach(c => { if (pick(c.prov)) chain.push(c.prov); });
    const d = (g.provenance && g.provenance.default) || {};
    if (d.asp && d.asp[aspect]) chain.push(d.asp[aspect]);
    chain.push(d);
    for (const p of chain) if (p.op !== undefined) return p.op;
    return undefined;
  }
  /* 'rewrite' | 'fill' | 'none': what a pass may do to an entity with this op in this mode. An unknown op (no
     provenance) is treated as imported: G3 never assumes it may rewrite what it cannot place. */
  function right(op, mode) {
    if (op === 'edited' || op === 'repaired') return 'none';
    if (op === 'inferred') return 'rewrite';
    if (mode === 'force') return 'rewrite';
    if (mode === 'fill') return 'fill';
    return 'none';
  }
  function permission(g, mode) {
    return {
      /* the right on one event (and its heads) for an aspect */
      event(part, e, aspect) {
        let r = right(opOf(g, e, aspect, [part]), mode);
        (e.heads || []).forEach(h => { const x = right(opOf(g, h, aspect, [e, part]), mode); if (x === 'none' || (x === 'fill' && r === 'rewrite')) r = x; });
        return r;
      },
      /* the right on a whole group of events: the weakest of them */
      events(part, evs, aspect) {
        let r = 'rewrite';
        for (const e of evs) { const x = this.event(part, e, aspect); if (x === 'none') return 'none'; if (x === 'fill') r = 'fill'; }
        return r;
      },
      spanner(part, s) { return right(opOf(g, s, 'exists', [part]), mode); },
      graph(aspect) { return right(opOf(g, { prov: undefined }, aspect, []), mode); }
    };
  }

  /* ------------------------------------------------------------ the passes, in §5.3 order */
  function passList(opts) {
    const all = [
      Pstaff.staff, Pvoice.voice, Prhythm.perfVoices, Prhythm.regularize, Prhythm.rhythm, Ptuplet.tuplet, Pspell.spell, Pbeam.beam,
      Pmarks.marks, Pstaff.ottava
    ].filter(Boolean);
    return all.filter(p => {
      if (opts.passes && opts.passes[p.name] === false) return false;
      if (p.g3b && !opts.g3b) return false;
      if (p.name === 'ottava' && !opts.ottava) return false;
      return true;
    });
  }

  /* ------------------------------------------------------------ readability proxy (§15.3.4) */
  function proxy(g) {
    let events = 0, rests = 0, notes = 0, short = 0, ties = 0, tuplets = 0, oneNote = 0, beams = 0, measures = g.timeline.measures.length;
    const sixteenth = R.make(1, 16);
    g.parts.forEach(p => {
      p.events.forEach(e => {
        if (e.grace) return;
        events++;
        if (e.kind === 'rest') rests++; else notes++;
        if (e.display && e.display.type && ['32nd', '64th', '128th', '256th', '512th', '1024th'].indexOf(e.display.type) >= 0) short++;
        void sixteenth;
      });
      p.spanners.forEach(s => {
        if (s.type === 'tie') ties++;
        if (s.type === 'tuplet') { tuplets++; if (s.events.length === 1) oneNote++; }
        if (s.type === 'beam') beams++;
      });
    });
    const codes = {};
    V.validate(g).issues.forEach(i => { if (i.code === 'W-DISPLAY-DURATION' || i.code === 'W-TUPLET-INCOMPLETE' || i.code === 'W-BEAM-SHAPE' || i.code === 'W-TUPLET-DISPLAY') codes[i.code] = (codes[i.code] || 0) + 1; });
    return { measures: measures, events: events, rests: rests, notes: notes, shortValues: short, ties: ties, tuplets: tuplets,
      oneNoteTuplets: oneNote, beams: beams, warnings: codes };
  }

  /* ------------------------------------------------------------ the pipeline */
  function professionalize(g, opts) {
    opts = Object.assign({ mode: 'rewrite', g3b: false, ottava: false, strict: false }, opts || {});
    if (MODES.indexOf(opts.mode) < 0) throw new TypeError('professionalize: mode must be one of ' + MODES.join(', '));
    const t0 = Date.now();
    const report = { version: VERSION, mode: opts.mode, g3b: !!opts.g3b, ottava: !!opts.ottava, passes: [], issues: [],
      rollbacks: [], fallback: false };
    const grids = new Map();
    const ctx = {
      mode: opts.mode, opts: opts, report: report, source: SOURCE, skip: new Set(),
      /* the metric grid of a measure; the timeline never changes, so one per measure for the whole run */
      grid(graph, m) { if (!grids.has(m)) grids.set(m, MG.grid(graph, m)); return grids.get(m); },
      perm: null,
      issue(code, message, where) { const it = { code: code, message: message }; if (where) it.at = where; report.issues.push(it); }
    };
    const fp0 = C.fingerprint(g);
    let cur = g, fpCur = fp0;
    const idMap = {};
    const compose = m => {
      Object.keys(idMap).forEach(k => { if (idMap[k] !== null && idMap[k] in m) idMap[k] = m[idMap[k]]; });
      Object.keys(m).forEach(k => { if (!(k in idMap)) idMap[k] = m[k]; });
    };
    const fail = (why, violations) => {
      if (opts.strict) throw new CriticError(why, violations || []);
      report.fallback = true;
      report.issues.push({ code: 'N-G3-ROLLBACK', message: 'G3 gave back its input: ' + why });
      return { graph: g, report: report, idMap: {} };
    };
    for (const pass of (opts.passList || passList(opts))) {
      const tp = Date.now();
      ctx.perm = permission(cur, opts.mode);
      ctx.skip = new Set(opts._skip || []);
      let r;
      try { r = pass.run(cur, ctx); } catch (e) {
        if (opts.strict) throw e;
        return fail('pass ' + pass.name + ' threw ' + (e.code || '') + ' ' + e.message);
      }
      const entry = { name: pass.name, changed: r.graph !== cur, changes: (r.changes || []).length, ms: 0 };
      report.passes.push(entry);
      if (r.graph === cur) { entry.ms = Date.now() - tp; continue; }
      let fp = C.fingerprint(r.graph);
      let v = C.check(fpCur, fp, pass.may);
      if (v.length) {
        if (opts.strict) throw new CriticError(pass.name, v);
        const where = new Set();
        v.forEach(x => x.where.forEach(w => where.add(w)));
        if (where.has('global')) return fail('pass ' + pass.name + ' changed ' + v.map(x => x.component).join(', ') + ' outside any measure', v);
        ctx.skip = new Set(Array.from(where).concat(opts._skip || []));
        try { r = pass.run(cur, ctx); } catch (e) { return fail('pass ' + pass.name + ' threw on its second run: ' + e.message); }
        ctx.skip = new Set(opts._skip || []);
        fp = C.fingerprint(r.graph);
        const v2 = C.check(fpCur, fp, pass.may);
        if (v2.length) return fail('pass ' + pass.name + ' changed ' + v2.map(x => x.component).join(', ') + ' even without the measures it broke', v2);
        report.rollbacks.push({ pass: pass.name, measures: Array.from(where).sort(), components: v.map(x => x.component) });
        report.issues.push({ code: 'N-G3-ROLLBACK', message: 'pass ' + pass.name + ' left measures ' + Array.from(where).sort().join(', ') + ' as they were (it changed ' + v.map(x => x.component).join(', ') + ')' });
        entry.changed = r.graph !== cur;
      }
      compose(r.idMap || {});
      cur = r.graph; fpCur = fp;
      entry.ms = Date.now() - tp;
    }
    /* the whole run against the input: what no pass may change (and the notated lengths unless G3b ran) */
    let issues = null;
    if (cur !== g) {
      const fixed = C.FIXED.concat(opts.g3b ? [] : ['sound']);
      const v = C.diff(fp0, fpCur, fixed);
      if (v.length) return fail('the result differs from the input in ' + v.map(x => x.component).join(', '), v);
      const val = C.validation(cur, g);
      issues = val.issues;
      if (val.errors.length) return fail('the result has ' + val.errors.length + ' ERROR(s): ' + val.errors.slice(0, 3).map(i => i.code + ' ' + i.message).join('; '));
      if (val.g3warnings.length) {
        if (opts.strict) throw new CriticError('validate', [{ component: 'warnings', where: val.g3warnings.slice(0, 20).map(i => i.code + ' ' + (i.ids || []).join(',')) }]);
        /* §15.3.3: the measures G3 left a notation warning in are handed back (every pass leaves them as they came), once;
           a warning outside any measure, or one that stays, gives back the whole input */
        const where = new Set(val.g3warnings.map(i => i.at && i.at.m).filter(Boolean));
        if (opts._rerun || where.size < new Set(val.g3warnings.map(i => i.at && i.at.m)).size || !where.size)
          return fail('G3 left ' + val.g3warnings.length + ' notation warning(s): ' + val.g3warnings.slice(0, 3).map(i => i.code + ' ' + i.message).join('; '));
        const again = professionalize(g, Object.assign({}, opts, { _rerun: true, _skip: Array.from(where).concat(opts._skip || []) }));
        again.report.rollbacks.push({ pass: 'all', measures: Array.from(where).sort(), components: ['warnings'] });
        again.report.issues.push({ code: 'N-G3-ROLLBACK', message: 'measures ' + Array.from(where).sort().join(', ') + ' left as they came: G3 would have left ' +
          val.g3warnings.map(i => i.code).join(', ') + ' there' });
        return again;
      }
    }
    report.ms = Date.now() - t0;
    /* issues: the validator's issues of the result (null when it is the input) */
    return { graph: cur, report: report, idMap: idMap, issues: issues };
  }

  return Object.freeze({ VERSION, SOURCE, MODES, CriticError, professionalize, permission, opOf, right, passList, proxy });
});
