/* G04 §21.2, §24.7 at the print layout level (G4e): named zero-target metrics a print EngravedScore (and its
   comparison against the screen plan's ledger) must hold. Deliberately separate from l2.js (§21.1-§21.2's screen and
   shared geometry metrics): l2.js's many checks assume one continuous page (a system's y only ever grows down the
   one page a screen layout has) - reading a multi-page print EngravedScore through it would ask questions across a
   page boundary that make no sense (system 4 on page 2 is not "below" system 3 on page 1, it is near the top of its
   own page). Everything here is computed straight from the EngravedScore/plan's own arrays, page by page where a
   metric is about one page, so nothing here needs l2.js's assumptions at all.

     pageMetrics(eng)                    -> { 'eg.page.<metric>': number } for a print EngravedScore
     ledgerAllowDiff(screenPlan, printPlan) -> { ok, diffs } - A40: the two ledgers the same ref for ref, except the
                                            allow-listed print-only differences (multi-rest merging, the title area)
*/
'use strict';

/* every object and curve that names a system (system >= 0) must have exactly one page - the DP never splits a
   system (G04 §15.5), so this is a defect metric, not a design choice (M25 forces it to prove the metric is live) */
function splitSystem(eng) {
  const pageOfSystem = new Map();
  let bad = 0;
  const check = list => list.forEach(o => {
    if (o.system === undefined || o.system === null || o.system < 0) return;
    if (!pageOfSystem.has(o.system)) pageOfSystem.set(o.system, o.page);
    else if (pageOfSystem.get(o.system) !== o.page) bad++;
  });
  check(eng.objects || []);
  check(eng.curves || []);
  /* eng.systems and eng.pages must agree too: a system's own `page` and the page that lists it among its `systems` */
  const bySystem = new Map((eng.systems || []).map(s => [s.index, s.page]));
  (eng.pages || []).forEach(pg => pg.systems.forEach(si => { if (bySystem.get(si) !== pg.index) bad++; }));
  return bad;
}

/* every object's box inside its own page's box (A17, A38's "잘림 0" for print - page sizes are uniform, so any one
   page's w/h is every page's) */
function overflow(eng) {
  const EPS = 0.01;
  const pg = (eng.pages || [])[0];
  if (!pg) return 0;
  return (eng.objects || []).filter(o => o.box[0] < -EPS || o.box[1] < -EPS || o.box[2] > pg.w + EPS || o.box[3] > pg.h + EPS).length;
}

/* every system appears in exactly one page's `systems`, covering 0..N-1 once each - a page-assignment bug (a system
   dropped, duplicated, or left off every page) shows here even when it happens not to overlap anything (splitSystem
   would miss a system with no objects of its own, which cannot happen, but this is the direct structural check) */
function breakCountErr(eng) {
  const n = (eng.systems || []).length;
  const seen = new Array(n).fill(0);
  (eng.pages || []).forEach(pg => pg.systems.forEach(si => { if (si >= 0 && si < n) seen[si]++; }));
  return seen.filter(c => c !== 1).length;
}

/* a print system of one bar, when the piece has more than one bar: the DP's own +50 (breaks.js PCOST.ONE) is what
   keeps this at 0 on ordinary music - a mutation that removes the penalty (or a bar so wide it cannot share a line)
   raises it. Named apart from eg.system.scaled_avoidable (screen's own, a different cost model, §15.2 vs §15.5) */
function oneBarAvoidable(eng) {
  const n = (eng.systems || []).length;
  if (n < 2) return 0;
  const totalBars = (eng.measures || []).length;
  if (totalBars < 2) return 0;
  return eng.systems.filter(s => s.measures.length === 1).length;
}

/* screen never merges a multi-measure rest into one bar (§15.1, §17.3: practice is by measure, G3's decision) - a
   run's covered bars must still be separate, present measures in a SCREEN EngravedScore, and no synthetic
   'd:multirest:' object may appear there at all. graph: the ScoreGraph the plan was made from (multiRest lives on
   its measures, G1 schema); screenEng: layout(plan(graph, {mode:'screen'})) */
function multirestScreenBars(graph, screenEng) {
  let bad = 0;
  const ids = new Set((screenEng.measures || []).map(m => m.id));
  const tl = graph.timeline;
  for (let k = 0; k < tl.measures.length;) {
    const nr = tl.measures[k].multiRest;
    if (nr && nr >= 2 && k + nr <= tl.measures.length) {
      for (let j = k; j < k + nr; j++) if (!ids.has(tl.measures[j].id)) bad++;
      k += nr;
    } else k += 1;
  }
  if ((screenEng.objects || []).some(o => typeof o.id === 'string' && o.id.indexOf('d:multirest:') === 0)) bad++;
  return bad;
}

function pageMetrics(eng, graph, screenEng) {
  const m = {
    'eg.page.split_system': splitSystem(eng),
    'eg.page.overflow': overflow(eng),
    'eg.page.break_count_err': breakCountErr(eng),
    'eg.page.one_bar_avoidable': oneBarAvoidable(eng)
  };
  if (graph && screenEng) m['eg.page.multirest_screen_bars'] = multirestScreenBars(graph, screenEng);
  return m;
}

/* A40: the screen and print ledgers agree, ref for ref, with an explicit allow-list of print-only differences -
   multi-rest merging ('multi-rest' kind: suppressed on screen, drawn in print), the title area ('meta' kind:
   title/composer drawn in both, the rest deferred in print / suppressed on screen - already how plan.js reads
   G4-U5, not a new difference this stage makes), a part's name and abbreviation on a multi-part score's first
   system ('part-name', 'part-abbr': print-only, §15.5) and the screen-only playback tempo heading ('tempo' kind: a
   mark-less first tempo is drawn on screen only, G4-U5's other allowance). Nothing else may differ - a code, a
   status, a whole ref present on one side and not the other, on any other kind, is named. */
const ALLOWED_KINDS = new Set(['multi-rest', 'meta', 'tempo', 'part-name', 'part-abbr']);
function ledgerAllowDiff(screenPlan, printPlan) {
  const byRef = list => new Map(list.map(e => [e.ref, e]));
  const a = byRef(screenPlan.ledger), b = byRef(printPlan.ledger);
  const diffs = [];
  const refs = new Set([...a.keys(), ...b.keys()]);
  refs.forEach(ref => {
    const ea = a.get(ref), eb = b.get(ref);
    if (!ea || !eb) { diffs.push({ ref: ref, a: ea || null, b: eb || null, reason: 'present on one side only' }); return; }
    if (ea.status === eb.status && ea.code === eb.code) return;
    if (ALLOWED_KINDS.has(ea.kind)) return;
    diffs.push({ ref: ref, a: ea, b: eb, reason: 'status/code differ on a kind not on the allow-list' });
  });
  return { ok: diffs.length === 0, diffs: diffs };
}

/* respectSourceBreaks (default false, §15.5): honouring the source's forced breaks must actually depend on the
   flag - a graph with at least one Measure.layout.newSystem gives a DIFFERENT system list under true and false
   (unless the density DP would have broken there anyway, which the two callers below choose fixtures to avoid).
   sysTrue/sysFalse: eng.systems from respectSourceBreaks true/false on the same graph; hadBreak: P.layoutBreaks.size
   > 0. 1 (a defect) when the flag made no difference on a graph that had a break to honour or not. */
function sourceBreakIgnored(sysTrue, sysFalse, hadBreak) {
  if (!hadBreak) return 0;
  const key = list => list.map(s => s.measures.length).join(',');
  return key(sysTrue) === key(sysFalse) ? 1 : 0;
}

module.exports = { splitSystem, overflow, breakCountErr, oneBarAvoidable, multirestScreenBars, sourceBreakIgnored, pageMetrics, ledgerAllowDiff, ALLOWED_KINDS };
