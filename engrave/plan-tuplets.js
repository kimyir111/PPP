/* ============================================================================
   PPP engrave — how a tuplet is shown (docs/GOALS/G04 §12, G4-D4, G4-U2)

   merges(graph, ctx)                  -> the one-note groups (before the beams)
   tuplets(graph, ctx, beams, merges)  -> { tuplets: [...], ledger: [...] }

   A tuplet is drawn as the graph states it. Its time is never touched here.
     printed: false                 nothing (the file printed no bracket)
     show.number / show.bracket     as stated; with no bracket stated, a bracket
                                    unless the notes are exactly one beam
     parent                         nested: two levels drawn, a third deferred

   One-note tuplets (G4-U2 B). PPP's transcriptions open a bracket on every
   triplet piece. Adjacent ones are shown as one group only when every
   condition below holds; otherwise each is drawn as the graph states it.
     - printed, exactly one event, no parent, no child, no explicit `show`
     - same part, voice, staff and measure; not a grace note, not hidden
     - the same ratio and the same unit (the stated unit, or else the same
       written value on every member)
     - consecutive in time with no gap, no grace note inside, and no
       tuplet of more than one event in that voice-measure (printed or not)
     - the members fill exactly one tuplet (normal x unit), starting on a
       multiple of that length from the bar line, in a measure that is not a
       pickup, and there are at least two of them
     - no semantic boundary inside the group or across its edges:
         in a part that states beams, one graph beam holds exactly the
         group's notes (a beam crossing an edge, a beam over part of the
         group, a beam over two groups, or unbeamed notes the file chose to
         flag are all a boundary or ambiguous - no merge); in a part with no
         graph beam there is no beam to cross;
         no slur starts or ends strictly inside it;
         no clef or key changes inside it; no head of a member on another staff
   The group is a display object ('d:tuplet:<first event>'); the ledger records
   each member as merged, code 'merged-for-display'.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../scoregraph/index.js'), require('./ledger.js'));
  else { const M = root.PPPEngraveModules = root.PPPEngraveModules || {}; M.planTuplets = factory(root.PPPScoreGraph, M.ledger); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SG, L) {
  'use strict';

  const R = SG.rational, S = SG.schema;

  /* The one-note merge (G4-U2 B), worked out before the beams: a derived beam then treats a merged group as the
     one tuplet it is shown as. -> { groupOf: Map(spanner id -> group id), groups: [display tuplet] } */
  function merges(g, ctx) {
    const groupOf = new Map(), groups = [];
    const events = ctx.eventById;
    if (ctx.config.oneNoteTupletMerge === false) return { groupOf: groupOf, groups: groups };
    g.parts.forEach(part => {
      const tups = part.spanners.filter(s => s.type === 'tuplet');
      const hasChild = new Set(tups.filter(s => s.parent).map(s => s.parent));
      {
        const cand = tups.filter(s => s.printed !== false && (s.events || []).length === 1 && !s.parent && !hasChild.has(s.id) &&
          s.show === undefined && events.get(s.events[0]) && !events.get(s.events[0]).grace && !events.get(s.events[0]).hidden);
        /* a voice-measure that already states a tuplet of several notes - printed or not - groups its triplets itself */
        const multiInVm = new Set();
        tups.forEach(s => {
          if ((s.events || []).length < 2) return;
          s.events.forEach(id => { const e = events.get(id); if (e) multiInVm.add(e.voice + '|' + e.m); });
        });
        /* the boundaries a display group may not cross: the graph's beams, slur ends, clef and key changes */
        const beamOf = new Map(), beamEvents = new Map();
        part.spanners.forEach(s => {
          if (s.type !== 'beam') return;
          beamEvents.set(s.id, (s.events || []).join(' '));
          (s.events || []).forEach(id => beamOf.set(id, s.id));
        });
        const partBeams = beamEvents.size > 0;
        const slurFrom = new Set(), slurTo = new Set();
        part.spanners.forEach(s => { if (s.type === 'slur') { if (s.from) slurFrom.add(s.from); if (s.to) slurTo.add(s.to); } });
        const changesIn = (m, staff, a, z) =>
          part.clefs.some(c => c.m === m && c.staff === staff && R.lt(a, R.parse(c.at)) && R.lt(R.parse(c.at), z)) ||
          (g.timeline.keys || []).some(k => k.m === m && R.lt(a, R.parse(k.at)) && R.lt(R.parse(k.at), z));
        const boundaryInside = members => {
          /* G4-U2 B: in a part that beams, only a beam over exactly these notes proves one visual group */
          if (partBeams) {
            const b0 = beamOf.get(members[0].e.id);
            if (!b0 || members.some(x => beamOf.get(x.e.id) !== b0)) return true;
            if (beamEvents.get(b0) !== members.map(x => x.e.id).join(' ')) return true;
          }
          if (members.some(x => (x.e.heads || []).some(h => h.staff !== undefined && h.staff !== x.e.staff))) return true;
          if (members.some((x, k) => (k > 0 && slurFrom.has(x.e.id)) || (k < members.length - 1 && slurTo.has(x.e.id)))) return true;
          const last = members[members.length - 1];
          return changesIn(members[0].e.m, members[0].e.staff, members[0].at, R.add(last.at, last.dur));
        };
        const graceAt = new Map();       /* voice|m -> [at] of grace events */
        part.events.forEach(e => { if (e.grace) { const k = e.voice + '|' + e.m; if (!graceAt.has(k)) graceAt.set(k, []); graceAt.get(k).push(R.parse(e.at)); } });
        const vms = new Map();
        cand.forEach(s => {
          const e = events.get(s.events[0]);
          const k = e.voice + '|' + e.m;
          if (multiInVm.has(k)) return;
          if (!vms.has(k)) vms.set(k, []);
          vms.get(k).push({ s: s, e: e, at: R.parse(e.at), dur: R.parse(e.dur) });
        });
        vms.forEach((list, k) => {
          const m = list[0].e.m;
          const gr = ctx.gridOf(m);
          if (!gr || gr.pickup) return;             /* a pickup's grid is measured from its end: not certain enough */
          list.sort((a, b) => R.cmp(a.at, b.at) || S.idNumber(a.s.id) - S.idNumber(b.s.id));
          const unitOf = x => x.s.unit ? S.noteValue(x.s.unit.type, x.s.unit.dots || 0)
            : (x.e.display && x.e.display.type ? S.noteValue(x.e.display.type, x.e.display.dots || 0) : null);
          const graces = graceAt.get(k) || [];
          let i = 0;
          while (i < list.length) {
            const a = list[i], unit = unitOf(a);
            let grouped = false;
            if (unit) {
              const span = R.mul(R.make(a.s.normal), unit);
              const q = R.div(a.at, span);
              if (q.d === 1) {
                let sum = R.ZERO, end = a.at, j = i;
                while (j < list.length) {
                  const x = list[j];
                  const u = unitOf(x);
                  if (x.s.actual !== a.s.actual || x.s.normal !== a.s.normal || !u || !R.eq(u, unit) ||
                    x.e.staff !== a.e.staff || !R.eq(x.at, end)) break;
                  if (j > i && graces.some(t => R.eq(t, x.at))) break;
                  sum = R.add(sum, x.dur);
                  end = R.add(x.at, x.dur);
                  if (!R.lt(sum, span)) break;
                  j++;
                }
                if (j < list.length && j > i && R.eq(sum, span) && !boundaryInside(list.slice(i, j + 1))) {
                  const members = list.slice(i, j + 1);
                  const evIds = members.map(x => x.e.id);
                  const id = L.ref.derived('tuplet', evIds[0]);
                  const unitCopy = u => (u ? { type: u.type, dots: u.dots || 0 } : null);
                  groups.push({ id: id, events: evIds, actual: a.s.actual, normal: a.s.normal, unit: unitCopy(a.s.unit), parent: null,
                    number: 'actual', bracket: null, placement: null, source: 'merged', members: members.map(x => x.s.id),
                    memberUnits: members.map(x => unitCopy(x.s.unit)) });
                  members.forEach(x => groupOf.set(x.s.id, id));
                  i = j + 1;
                  grouped = true;
                }
              }
            }
            if (!grouped) i++;
          }
        });
      }
    });
    return { groupOf: groupOf, groups: groups };
  }

  function tuplets(g, ctx, beamList, merged) {
    const out = [], ledger = [];
    /* a beam whose notes are exactly a tuplet's carries the grouping: the number alone is enough (§12.1) */
    const beamKeys = new Set(beamList.map(b => b.events.join(' ')));
    const bracketDefault = evIds => !beamKeys.has(evIds.join(' '));
    merged = merged || { groupOf: new Map(), groups: [] };
    merged.groups.forEach(x => out.push(Object.assign({}, x, { bracket: bracketDefault(x.events) })));

    g.parts.forEach(part => {
      const tups = part.spanners.filter(s => s.type === 'tuplet');
      const byId = new Map(tups.map(s => [s.id, s]));
      const depth = s => { let d = 0, p = s.parent; while (p && d < 8) { d++; p = byId.get(p) && byId.get(p).parent; } return d; };

      /* ---- every tuplet of the graph */
      tups.forEach(s => {
        if (merged.groupOf.has(s.id)) {
          ledger.push({ ref: s.id, kind: 'tuplet', status: 'merged', code: 'merged-for-display', plan: merged.groupOf.get(s.id) });
          return;
        }
        if (s.printed === false) { ledger.push({ ref: s.id, kind: 'tuplet', status: 'suppressed', code: 'printed-false' }); return; }
        const show = s.show || {};
        const number = show.number || 'actual';
        const bracket = show.bracket !== undefined ? show.bracket : bracketDefault(s.events || []);
        if (number === 'none' && bracket === false) { ledger.push({ ref: s.id, kind: 'tuplet', status: 'suppressed', code: 'show-none' }); return; }
        const d = depth(s);
        const t = { id: s.id, events: (s.events || []).slice(), actual: s.actual, normal: s.normal,
          unit: s.unit ? { type: s.unit.type, dots: s.unit.dots || 0 } : null,
          parent: s.parent || null, number: number, bracket: bracket, placement: show.placement || null, source: 'graph' };
        if (d >= 2) {
          t.deferred = 'nested-3';
          out.push(t);
          ledger.push({ ref: s.id, kind: 'tuplet', status: 'deferred', code: 'nested-3', plan: s.id });
          return;
        }
        out.push(t);
        ledger.push({ ref: s.id, kind: 'tuplet', status: 'drawn', code: (s.events || []).length === 1 ? 'one-note' : undefined, plan: s.id });
      });
    });
    return { tuplets: out, ledger: ledger };
  }

  return Object.freeze({ merges, tuplets });
});
