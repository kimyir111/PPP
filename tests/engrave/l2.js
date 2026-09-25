/* G04 §21.2 L2 - geometry metrics of an EngravedScore (G4b: what the layout core places).

   Computed from the EngravedScore's boxes and the NotationPlan alone, independently of engrave/skyline.js: the
   collision checks the layout runs on itself are one more number here (eg.layout.hard_violations), not the only one.
   Touching (less than 0.01 sp of overlap) is not overlapping.

     l2(engraved, plan, {prepared, layout})  -> { 'eg.<metric>': number }

   prepared/layout (engrave/layout.js) are needed only for eg.systems.one_bar, which asks the layout's own width model
   whether a one-bar system could have joined a neighbour. */
'use strict';

const EPS = 0.01;
/* a comparison of sums of coordinates each rounded to 0.01 sp: two roundings' worth */
const TOL = 0.02;
const ROD = 0.3, BEFORE_BAR = 1.0;     /* G04 §9.3: the least gaps between columns and before a bar line */
const over = (a, b) => a[0] < b[2] - EPS && b[0] < a[2] - EPS && a[1] < b[3] - EPS && b[1] < a[3] - EPS;
const q = s => { const m = /^(-?\d+)(?:\/(\d+))?$/.exec(s); return m ? +m[1] / (m[2] ? +m[2] : 1) : NaN; };

/* each pair of objects of `list` whose boxes overlap, once, in a sweep over x */
function pairs(list, fn) {
  const xs = list.slice().sort((a, b) => a.box[0] - b.box[0] || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length && xs[j].box[0] < xs[i].box[2] - EPS; j++)
      if (over(xs[i].box, xs[j].box)) fn(xs[i], xs[j]);
}
const groupBy = (list, key) => {
  const m = new Map();
  list.forEach(o => { const k = key(o); if (!m.has(k)) m.set(k, []); m.get(k).push(o); });
  return m;
};

function l2(eng, plan, opts) {
  const m = {};
  const set = (k, v) => { m[k] = v; };
  const page = eng.pages[0];
  const sys = new Map(eng.systems.map(s => [s.index, s]));

  /* clipping: inside the page */
  set('eg.clip.count', eng.objects.filter(o => o.box[0] < -EPS || o.box[1] < -EPS || o.box[2] > page.w + EPS || o.box[3] > page.h + EPS).length);

  /* overlaps on one staff of one system */
  let hh = 0, acc = 0, dot = 0;
  groupBy(eng.objects.filter(o => o.staffKey), o => o.system + '|' + o.staffKey).forEach(list => {
    pairs(list, (a, b) => {
      const k = [a.kind, b.kind].sort().join('/');
      if (k === 'notehead/notehead' && a.event !== b.event) hh++;
      if (a.kind === 'accidental' || b.kind === 'accidental') {
        const other = a.kind === 'accidental' ? b : a;
        if (['notehead', 'stem', 'accidental', 'ledger'].indexOf(other.kind) >= 0) acc++;
      }
      if (a.kind === 'dot' || b.kind === 'dot') {
        const other = a.kind === 'dot' ? b : a;
        if (['notehead', 'stem', 'flag', 'accidental', 'rest'].indexOf(other.kind) >= 0 && other.id !== (a.kind === 'dot' ? a : b).id) dot++;
      }
    });
  });
  set('eg.overlap.head_head', hh);
  set('eg.overlap.acc', acc);
  set('eg.overlap.dot', dot);

  /* staves and systems: nothing of one staff on anything of another (bar lines through a part's gap meet the next
     staff by design), system bands apart */
  let so = 0;
  const frame = k => k === 'barline' || k === 'staff';
  groupBy(eng.objects.filter(o => o.staffKey), o => o.system).forEach(list => {
    pairs(list, (a, b) => { if (a.staffKey !== b.staffKey && !(frame(a.kind) && frame(b.kind))) so++; });
  });
  set('eg.staff.overlap', so);
  let sy = 0;
  for (let i = 1; i < eng.systems.length; i++) if (eng.systems[i].box[1] < eng.systems[i - 1].box[3] - EPS) sy++;
  set('eg.system.overlap', sy);
  set('eg.system.overflow', eng.systems.filter(s => s.w > eng.config.width + EPS).length);
  set('eg.system.scaled', eng.systems.filter(s => s.space < 1).length);

  /* columns: x strictly increasing with time inside a measure, measures left to right inside a system */
  const pm = new Map(plan.measures.map(x => [x.id, x]));
  let order = 0;
  eng.measures.forEach(me => {
    const t = me.columns.filter(c => c.time);
    for (let i = 1; i < t.length; i++) if (!(q(t[i].at) > q(t[i - 1].at)) || !(t[i].x > t[i - 1].x + EPS)) order++;
    for (let i = 1; i < me.columns.length; i++) if (me.columns[i].x < me.columns[i - 1].x - EPS) order++;
  });
  groupBy(eng.measures, x => x.system).forEach(list => { for (let i = 1; i < list.length; i++) if (list[i].x < list[i - 1].x + list[i - 1].w - EPS) order++; });
  set('eg.column.order_violations', order);

  /* rods: on each staff, what stands at one column ends a rod before what stands at the next begins, and the last
     column's objects end BEFORE_BAR before the measure's content ends (all in the system's staff space) */
  let rod = 0;
  const anchored = eng.objects.filter(o => o.anchor && o.staffKey);
  const byCol = groupBy(anchored, o => o.measure + '|' + o.anchor[0]);
  eng.measures.forEach(me => {
    const s = sys.get(me.system), f = s.space || 1;
    const cols = me.columns.map(c => (byCol.get(me.id + '|' + c.x) || []));
    const staves = [...new Set(cols.flat().map(o => o.staffKey))];
    staves.forEach(st => {
      let prevRight = null;
      cols.forEach(list => {
        const here = list.filter(o => o.staffKey === st);
        if (!here.length) return;
        const left = Math.min(...here.map(o => o.box[0])), right = Math.max(...here.map(o => o.box[2]));
        if (prevRight !== null && prevRight + ROD * f > left + TOL) rod++;
        prevRight = prevRight === null ? right : Math.max(prevRight, right);
      });
      if (prevRight !== null && prevRight + BEFORE_BAR * f > me.content[1] + TOL) rod++;
    });
  });
  set('eg.spacing.rod_violations', rod);

  /* monotonic: in one system a longer time step is never narrower than a shorter one, unless a rod widened the
     shorter one (its gap is above u·(Δ/¼)^0.65 in the system's staff space) */
  let mono = 0;
  groupBy(eng.measures, x => x.system).forEach((list, si) => {
    const s = sys.get(si), f = s.space || 1;
    const steps = [];
    list.forEach(me => {
      const cols = me.columns;
      for (let i = 0; i < cols.length; i++) {
        if (!cols[i].time) continue;
        const nx = cols[i + 1];
        if (nx && !nx.time) continue;          /* a clef column splits the step: not a plain spring */
        const d = (nx ? q(nx.at) : q(pm.get(me.id).dur)) - q(cols[i].at);
        if (!(d > 0)) continue;
        const gap = (nx ? nx.x : me.content[1]) - cols[i].x;
        const ideal = s.u * Math.pow(d / 0.25, 0.65) * f;
        steps.push({ d: d, gap: gap, forced: gap > ideal + TOL });
      }
    });
    steps.forEach(a => steps.forEach(b => { if (a.d > b.d + 1e-9 && a.gap < b.gap - TOL && !b.forced) mono++; }));
  });
  set('eg.spacing.monotonic_violations', mono);

  /* events: every event the plan draws has its objects, no object names an event the plan lacks, every drawn head
     is on the staff the graph gives it (A14, A15) */
  const deferred = new Set(plan.ledger.filter(x => x.status === 'deferred').map(x => x.ref));
  const liveStaff = st => !deferred.has(st);
  const expected = new Set(), heads = new Map();
  const laidOut = new Set(eng.measures.map(x => x.id));      /* all of them, or a close view's window */
  plan.events.forEach(e => {
    if (e.hidden || (e.grace && e.grace.after) || deferred.has(e.id) || !laidOut.has(e.m)) return;
    if (e.kind === 'rest') { if (liveStaff(e.staff)) expected.add(e.id); return; }
    e.heads.forEach(h => {
      const st = h.staff || e.staff;
      if (liveStaff(st) && (h.written || h.pos)) { expected.add(e.id); heads.set(h.id, st); }
    });
  });
  const drawnEv = new Set(eng.objects.filter(o => o.event).map(o => o.event));
  const planEv = new Set(plan.events.map(e => e.id));
  set('eg.layout.event_missing', [...expected].filter(id => !drawnEv.has(id)).length);
  set('eg.layout.event_unknown', [...drawnEv].filter(id => !planEv.has(id)).length);
  const headObjs = groupBy(eng.objects.filter(o => o.kind === 'notehead'), o => o.id);
  let hm = 0, hs = 0;
  heads.forEach((st, id) => {
    const got = headObjs.get(id) || [];
    if (got.length !== 1) hm++;
    else if (got[0].staffKey !== st) hs++;
  });
  set('eg.layout.head_missing', hm);
  set('eg.layout.head_staff_wrong', hs);

  /* one-bar systems a neighbour could have taken (G4-U4: density may force them; this counts the avoidable ones) */
  let one = 0;
  if (opts && opts.prepared && opts.layout && eng.measures.length > 1) {
    const P = opts.prepared, W = eng.config.width;
    const idx = new Map(P.measures.map((x, i) => [x.id, i]));
    const span = s => [idx.get(s.measures[0]), idx.get(s.measures[s.measures.length - 1])];
    const fits = (i, j, last) => {
      const p = opts.layout.systemParts(P, i, j, last);
      return (p.fixed + p.springs.reduce((a, x) => a + x.rod, 0)) * 1.05 <= W;
    };
    eng.systems.forEach((s, k) => {
      if (s.measures.length !== 1) return;
      const [i] = span(s);
      const prev = eng.systems[k - 1], next = eng.systems[k + 1];
      const lastSys = k === eng.systems.length - 1;
      if ((prev && fits(span(prev)[0], i, lastSys)) || (next && fits(i, span(next)[1], k + 1 === eng.systems.length - 1))) one++;
    });
  }
  set('eg.systems.one_bar', one);

  const codes = groupBy(eng.diagnostics, d => d.code);
  set('eg.layout.hard_violations', (codes.get('HARD_VIOLATION') || []).length);
  set('eg.glyph.fallback', (codes.get('GLYPH_FALLBACK') || []).length);
  return m;
}

module.exports = { l2, EPS, TOL };
