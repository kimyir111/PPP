/* G04 §21.1-§21.2 at the layout level: the geometry metrics of an EngravedScore (G4b), and what the notation the layout
   adds (G4c: beams, stems, tuplets, voices, rests, grace notes) must be.

   Computed from the EngravedScore's boxes, the NotationPlan and - when given - the graph itself, independently of
   engrave/skyline.js and engrave/notation.js: the collision checks the layout runs on itself are one more number here
   (eg.layout.hard_violations), not the only one, and the rules below are written from G04's text, not copied from
   the layout's code. Touching (less than 0.01 sp of overlap) is not overlapping.

     l2(engraved, plan, {prepared, layout, graph})  -> { 'eg.<metric>': number }

   prepared/layout (engrave/layout.js) are needed only for eg.systems.one_bar, which asks the layout's own width model
   whether a one-bar system could have joined a neighbour. graph (the ScoreGraph the plan was made from) makes the beam
   and tuplet checks read what the graph states rather than what the plan passed on - a plan that drops a graph beam or
   ignores a tuplet's show options is then caught too (§23 M1, M5); without it they read the plan.

   Every metric here is a count whose target is 0, except eg.beam.slope_max (the steepest beam, <= 0.25: a maximum,
   summed as one) - see ZERO_TARGET. G4b's two ratchets (eg.rest.overlap, eg.voice.stem_over_head) are zero targets
   since G4c (G04 §33.16.4). */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const proBeam = require(path.join(REPO, 'scoregraph', 'pro-beam.js'));
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));

const EPS = 0.01;
/* a comparison of sums of coordinates each rounded to 0.01 sp: two roundings' worth */
const TOL = 0.02;
const ROD = 0.3, BEFORE_BAR = 1.0;     /* G04 §9.3: the least gaps between columns and before a bar line */
const RAGGED_MAX = 0.8;                /* G4-B3: a last system is left ragged only at most this share of the width */
/* G04 §11.2: the least stem under a beam (2.5 sp, +0.75 a beam more), an unbeamed stem (3.5 sp), the steepest beam;
   §14.5: grace notes at 0.66 */
const STEM = { beamed: 2.5, perBeam: 0.75, free: 3.5 }, MAX_SLOPE = 0.25, GRACE = 0.66;
/* §10.3 H1-H3, H7 and A26, with kind lists of their own (not skyline.js's H-rules, review O4: the two must not be blind
   together - these are wider): what an accidental, a dot, a rest may not touch, and what of one voice may not cross
   another voice's head */
const ACC_VS = ['notehead', 'stem', 'accidental', 'ledger', 'flag', 'beam'];
const DOT_VS = ['notehead', 'stem', 'flag', 'accidental', 'rest', 'ledger', 'beam'];
const REST_VS = ['notehead', 'stem', 'flag', 'rest', 'ledger', 'accidental', 'beam', 'dot'];
const STEM_KINDS = ['stem', 'flag', 'beam'];
const STEPS = 'CDEFGAB';
/* two boxes overlap by more than 0.01 sp both ways - compared in whole hundredths, the coordinates' own precision, so
   two boxes that touch are never called overlapping by a floating point last bit */
const cent = v => Math.round(v * 100);
const over = (a, b) => cent(b[2]) - cent(a[0]) > 1 && cent(a[2]) - cent(b[0]) > 1 && cent(b[3]) - cent(a[1]) > 1 && cent(a[3]) - cent(b[1]) > 1;
const q = s => { const m = /^(-?\d+)(?:\/(\d+))?$/.exec(s); return m ? +m[1] / (m[2] ? +m[2] : 1) : NaN; };
const FLAGS = { eighth: 1, '16th': 2, '32nd': 3, '64th': 4, '128th': 5, '256th': 6 };
const STEMLESS = { whole: 1, breve: 1, long: 1, maxima: 1 };
const CLEF_GLYPH = { G: 'gClef', F: 'fClef', C: 'cClef', percussion: 'unpitchedPercussionClef1', TAB: '6stringTabClef' };
/* merged (a shared unison, a merged rest, G04 §14.2-§14.3, G4-C4, G4-C14): the two objects name each other and stand
   at one place. The layout's label alone is not trusted (the G4c review R2): only a merge the rules allow is left out of
   the overlap counts, and any other is eg.voice.merge_illegal - see legalMerge in l2(). */
const namesEachOther = (a, b) => !!(a.merged && b.merged && a.merged.indexOf(b.id) >= 0 && b.merged.indexOf(a.id) >= 0);
const samePlace = (a, b) => a.system === b.system && a.staffKey === b.staffKey && a.box.every((v, i) => Math.abs(v - b.box[i]) < EPS);
/* G04 §14.2, G4-C3: voices side by side - the moved voice starts this far past the other (VexFlow 4.2.3's h + 2 px) */
const VOICE_GAP = 0.2;

/* a beam is a slanted band, not its box: does the band itself cross the box (by more than 0.01 sp)? */
function bandHits(beam, b) {
  const l = beam.line, dx = l[2] - l[0];
  const a = Math.max(b[0], l[0]), z = Math.min(b[2], l[2]);
  if (cent(z) - cent(a) <= 1) return false;
  const topAt = x => l[1] + (l[3] - l[1]) * (dx > 1e-9 ? (x - l[0]) / dx : 0);
  const t0 = Math.min(topAt(a), topAt(z)), b1 = Math.max(topAt(a), topAt(z)) + beam.t;
  return cent(b[3]) - cent(t0) > 1 && cent(b1) - cent(b[1]) > 1;
}
/* each pair of objects of `list` that overlap, once, in a sweep over x (a beam by its band) */
function pairs(list, fn) {
  const xs = list.slice().sort((a, b) => a.box[0] - b.box[0] || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length && cent(xs[i].box[2]) - cent(xs[j].box[0]) > 1; j++) {
      const a = xs[i], b = xs[j];
      if (!over(a.box, b.box)) continue;
      if (a.kind === 'beam' && b.kind === 'beam') continue;
      if ((a.kind === 'beam' && !bandHits(a, b.box)) || (b.kind === 'beam' && !bandHits(b, a.box))) continue;
      fn(a, b);
    }
}
const groupBy = (list, key) => {
  const m = new Map();
  list.forEach(o => { const k = key(o); if (!m.has(k)) m.set(k, []); m.get(k).push(o); });
  return m;
};
/* a staff position under a clef (G04 §8.3: heads sit at their written pitch): y from the top line, half a staff space a
   step. The clef's line holds its note (G on line 2 from the bottom is G4, F on line 4 is F3, C on line 3 is C4; an
   octave clef moves it; percussion and TAB read as treble). */
function staffY(pos, clef) {
  const sign = clef ? clef.sign : 'G';
  const line = sign === 'F' ? (clef.line || 4) : sign === 'C' ? (clef.line || 3) : sign === 'G' ? ((clef && clef.line) || 2) : 2;
  const ref = (sign === 'F' ? 3 * 7 + 3 : sign === 'C' ? 4 * 7 : 4 * 7 + 4) + 7 * ((clef && clef.octave) || 0);
  return (5 - line) - (pos.oct * 7 + STEPS.indexOf(pos.step) - ref) / 2;
}
/* G04 §11.2, §14.1: a group with no stated or voice direction points away from its head farthest from the middle
   line; a tie between above and below goes to the majority of heads, then down */
function autoDir(offs) {
  const far = Math.max(0, ...offs.map(Math.abs));
  if (far < 1e-9) return 'down';
  const up = offs.some(d => d < 0 && Math.abs(-d - far) < 1e-9), down = offs.some(d => d > 0 && Math.abs(d - far) < 1e-9);
  if (down && !up) return 'up';
  if (up && !down) return 'down';
  return offs.filter(d => d > 1e-9).length > offs.filter(d => d < -1e-9).length ? 'up' : 'down';
}

function l2(eng, plan, opts) {
  opts = opts || {};
  const m = {};
  const set = (k, v) => { m[k] = v; };
  const page = eng.pages[0];
  const sys = new Map(eng.systems.map(s => [s.index, s]));
  const staffTop = new Map(), staffSp = new Map();
  const linesOf = new Map(plan.staves.map(s => [s.id, s.lines === undefined || s.lines === null ? 5 : s.lines]));
  /* a staff's space, read from its height (to 0.01 over four spaces) rather than the system's rounded `space` */
  eng.systems.forEach(s => s.staves.forEach(t => {
    staffTop.set(s.index + '|' + t.key, t.y);
    const n = (linesOf.get(t.key) || 5) - 1;
    staffSp.set(s.index + '|' + t.key, n > 0 && t.h > 0 ? t.h / n : s.space || 1);
  }));
  const spaceOf = o => (o.staffKey && staffSp.has(o.system + '|' + o.staffKey) ? staffSp.get(o.system + '|' + o.staffKey) : (sys.get(o.system) || {}).space || 1);
  const pe = new Map(plan.events.map(e => [e.id, e]));
  const pm = new Map(plan.measures.map((x, i) => [x.id, Object.assign({ i: i }, x)]));
  const byEvent = groupBy(eng.objects.filter(o => o.event), o => o.event);
  const objsOf = id => byEvent.get(id) || [];

  /* ids: every object its own (G4b review R5: a cross-staff chord's stem and flag named once per staff) */
  const ids = groupBy(eng.objects, o => o.id);
  let dup = 0;
  ids.forEach(list => { if (list.length > 1) dup += list.length - 1; });
  set('eg.layout.duplicate_ids', dup);

  /* clipping: inside the page */
  set('eg.clip.count', eng.objects.filter(o => o.box[0] < -EPS || o.box[1] < -EPS || o.box[2] > page.w + EPS || o.box[3] > page.h + EPS).length);

  /* ---- merges (G04 §14.2-§14.3, G4-C4, G4-C14; the G4c review R2): a pair of objects that name each other and stand
     at one place is legal only as
       two noteheads of different voices, one written pitch (step, octave, alter), one glyph and size, the same dots, the
         stems opposite (or neither stemmed) - a shared unison;
       two rests of different voices at one time, one glyph, the same length and dots, neither at a position the graph
         states - a merged rest;
       two accidentals of one glyph on such a pair of heads.
     Grace notes never merge. Only a legal pair is left out of the overlap counts; every object naming a partner it may
     not stand with is eg.voice.merge_illegal. */
  const stemDirOf = new Map(eng.objects.filter(o => o.kind === 'stem' && /#stem$/.test(o.id)).map(o => [o.event, o.dir]));
  const writtenOf = o => { const e = pe.get(o.event), h = e && e.heads.find(x => x.id === o.id); return h ? h.written || h.pos || null : null; };
  const headAcc = o => { const e = pe.get(o.event), h = e && e.heads.find(x => x.id === o.id); return h && h.acc ? h.acc.type : null; };
  const legalMerge = (a, b) => {
    if (!a || !b || a === b || a.kind !== b.kind || !namesEachOther(a, b) || !samePlace(a, b)) return false;
    if (a.kind === 'accidental') {
      const ha = (ids.get(a.refs[0]) || []).find(o => o.kind === 'notehead'), hb = (ids.get(b.refs[0]) || []).find(o => o.kind === 'notehead');
      return a.glyph === b.glyph && legalMerge(ha, hb);
    }
    const ea = pe.get(a.event), eb = pe.get(b.event);
    if (!ea || !eb || ea.voice === eb.voice || a.grace || b.grace || ea.grace || eb.grace) return false;
    if (a.glyph !== b.glyph || (a.scale || 1) !== (b.scale || 1) || (ea.dots || 0) !== (eb.dots || 0)) return false;
    if (a.kind === 'notehead') {
      const wa = writtenOf(a), wb = writtenOf(b);
      if (!wa || !wb || wa.step !== wb.step || wa.oct !== wb.oct || (wa.alter || 0) !== (wb.alter || 0)) return false;
      const da = stemDirOf.get(ea.id), db = stemDirOf.get(eb.id);
      return da && db ? da !== db : !da && !db;
    }
    if (a.kind === 'rest') return ea.m === eb.m && q(ea.at) === q(eb.at) && q(ea.dur) === q(eb.dur) && !ea.restPos && !eb.restPos;
    return false;
  };
  let illegal = 0;
  eng.objects.forEach(o => {
    if (!o.merged) return;
    if (!o.merged.length || o.merged.some(id => !(ids.get(id) || []).some(p => legalMerge(o, p)))) illegal++;
  });
  set('eg.voice.merge_illegal', illegal);

  /* overlaps on one staff of one system */
  const voiceOf = new Map(plan.events.map(e => [e.id, e.voice]));
  const voiceOfObj = o => (o.event ? voiceOf.get(o.event) : o.kind === 'beam' && o.events ? voiceOf.get(o.events[0]) : undefined);
  const otherVoice = (a, b) => { const va = voiceOfObj(a), vb = voiceOfObj(b); return va !== undefined && vb !== undefined && va !== vb; };
  let hh = 0, acc = 0, dot = 0, restOv = 0, stemHead = 0;
  groupBy(eng.objects.filter(o => o.staffKey), o => o.system + '|' + o.staffKey).forEach(list => {
    pairs(list, (a, b) => {
      if (legalMerge(a, b)) return;
      const k = [a.kind, b.kind].sort().join('/');
      if (k === 'notehead/notehead' && a.event !== b.event) hh++;
      if (a.kind === 'accidental' || b.kind === 'accidental') {
        const other = a.kind === 'accidental' ? b : a;
        if (ACC_VS.indexOf(other.kind) >= 0) acc++;
      }
      if (a.kind === 'dot' || b.kind === 'dot') {
        const d = a.kind === 'dot' ? a : b, other = a.kind === 'dot' ? b : a;
        if (DOT_VS.indexOf(other.kind) >= 0 && other.id !== d.id) dot++;
      }
      /* a rest on another voice's head, stem, flag, rest, ledger line, accidental or dot, or on any beam (its own
         voice's too: a beam over a rest must clear it, §11.2) */
      const rest = a.kind === 'rest' ? a : b.kind === 'rest' ? b : null;
      if (rest) {
        const other = rest === a ? b : a;
        if (other.kind === 'beam' || (REST_VS.indexOf(other.kind) >= 0 && otherVoice(a, b))) restOv++;
      }
      /* a stem, flag or beam across another voice's notehead (a shared unison's own head is its partner's) */
      const head = a.kind === 'notehead' ? a : b.kind === 'notehead' ? b : null;
      const st = head === a ? b : a;
      if (head && STEM_KINDS.indexOf(st.kind) >= 0 && otherVoice(a, b)) {
        const own = (head.merged || []).some(id => (ids.get(id) || []).some(h => legalMerge(head, h) && (h.event === st.event || (st.events && st.events.indexOf(h.event) >= 0))));
        if (!own) stemHead++;
      }
    });
  });
  set('eg.overlap.head_head', hh);
  set('eg.overlap.acc', acc);
  set('eg.overlap.dot', dot);
  set('eg.rest.overlap', restOv);
  set('eg.voice.stem_over_head', stemHead);

  /* ---- two voices at one column (G04 §14.2, G4-C3, G4-C13; the G4c review R1): the noteheads of a system, staff and
     column, by event */
  const stemObjOf = new Map(eng.objects.filter(o => o.kind === 'stem' && /#stem$/.test(o.id)).map(o => [o.event, o]));
  const flagObjOf = new Map(eng.objects.filter(o => o.kind === 'flag' && !o.grace).map(o => [o.event, o]));
  let unshared = 0, offErr = 0;
  groupBy(eng.objects.filter(o => o.kind === 'notehead' && !o.grace && o.anchor && o.staffKey), o => o.system + '|' + o.staffKey + '|' + o.anchor[0]).forEach(list => {
    const evs = [...groupBy(list, o => o.event).entries()].map(([id, hs]) => ({ e: pe.get(id), hs: hs })).filter(x => x.e);
    /* a unison of two single notes - different voices, one written pitch and accidental, one glyph and size, the same
       dots, the stems opposite - shares its head (§14.2): a legal merge, else eg.voice.unison_unshared */
    const single = evs.filter(x => x.e.heads.length === 1 && x.hs.length === 1 && x.e.staff === x.hs[0].staffKey);
    for (let i = 0; i < single.length; i++) {
      for (let j = i + 1; j < single.length; j++) {
        const A = single[i], B = single[j], a = A.hs[0], b = B.hs[0];
        if (A.e.voice === B.e.voice || a.glyph !== b.glyph || (a.scale || 1) !== (b.scale || 1) || (A.e.dots || 0) !== (B.e.dots || 0)) continue;
        const wa = writtenOf(a), wb = writtenOf(b);
        if (!wa || !wb || wa.step !== wb.step || wa.oct !== wb.oct || (wa.alter || 0) !== (wb.alter || 0)) continue;
        const ca = headAcc(a), cb = headAcc(b), da = stemDirOf.get(A.e.id), db = stemDirOf.get(B.e.id);
        if ((ca && cb && ca !== cb) || !da || !db || da === db) continue;
        if (!legalMerge(a, b)) unshared++;
      }
    }
    /* two voices side by side (§14.2, G4-C3, G4-C13): the voice that moved - its stem is not where its heads' column puts
       it - starts VOICE_GAP past the other voice's heads and stem, and past that voice's flag only where the flag reaches
       beside the moved heads (their heights overlap): no further, no nearer. Two stemmed events of two voices, every
       head on its home staff; one of them stays. */
    if (evs.length !== 2 || evs[0].e.voice === evs[1].e.voice) return;
    if (evs.some(x => x.hs.some(h => h.staffKey !== x.e.staff) || x.e.heads.some(h => (h.staff || x.e.staff) !== x.e.staff))) return;
    const st = evs.map(x => stemObjOf.get(x.e.id));
    if (st.some((s, k) => !s || s.system !== evs[k].hs[0].system)) return;
    const colX = list[0].anchor[0];
    const moved = evs.map((x, k) => {
      const w = Math.max(...x.hs.map(h => h.box[2] - h.box[0]));
      return (st[k].dir === 'up' ? st[k].box[2] - w : st[k].box[0]) - colX > TOL;
    });
    if (!moved[0] && !moved[1]) return;
    if (moved[0] && moved[1]) { offErr++; return; }
    const u = moved[0] ? 1 : 0, U = evs[u], D = evs[1 - u];
    const fl = flagObjOf.get(U.e.id);
    const beside = !!fl && fl.system === st[u].system && D.hs.some(h => cent(h.box[3]) - cent(fl.box[1]) > 1 && cent(fl.box[3]) - cent(h.box[1]) > 1);
    const reach = Math.max(...U.hs.map(h => h.box[2]), st[u].box[2], beside ? fl.box[2] : -Infinity);
    if (Math.abs(Math.min(...D.hs.map(h => h.box[0])) - (reach + VOICE_GAP * spaceOf(D.hs[0]))) > TOL) offErr++;
  });
  set('eg.voice.unison_unshared', unshared);
  set('eg.voice.offset_err', offErr);

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
  /* the smaller staff size is for one measure wider than the width (G4-B5). A system of several measures that needed it,
     or overflows, could have been broken: a line break the layout dropped (§23 M9) shows here, not as an overflow,
     since G4-B5 draws smaller what would overflow unless even the floor is too wide */
  set('eg.system.scaled_avoidable', eng.systems.filter(s => s.measures.length > 1 && (s.space < 1 || s.w > eng.config.width + EPS)).length);
  /* justification (§9.4, G4-B3; review O3): a system that is not ragged spans the width to 0.01 sp - one u solved
     exactly, or the smaller staff size that fits it - unless it overflows (eg.system.overflow counts that one); a
     ragged system is the piece's last and at most RAGGED_MAX of the width. */
  const W = eng.config.width;
  set('eg.system.fill_err', eng.systems.filter((s, k) => s.ragged
    ? k !== eng.systems.length - 1 || s.w > RAGGED_MAX * W + EPS
    : s.w <= W + EPS && Math.abs(s.w - W) > EPS).length);

  /* columns: x strictly increasing with time inside a measure, measures left to right inside a system */
  let order = 0;
  eng.measures.forEach(me => {
    const t = me.columns.filter(c => c.time);
    for (let i = 1; i < t.length; i++) if (!(q(t[i].at) > q(t[i - 1].at)) || !(t[i].x > t[i - 1].x + EPS)) order++;
    for (let i = 1; i < me.columns.length; i++) if (me.columns[i].x < me.columns[i - 1].x - EPS) order++;
  });
  groupBy(eng.measures, x => x.system).forEach(list => { for (let i = 1; i < list.length; i++) if (list[i].x < list[i - 1].x + list[i - 1].w - EPS) order++; });
  set('eg.column.order_violations', order);

  /* rods: on each staff, what stands at one column ends a rod before what stands at the next begins, and the last
     column's objects end BEFORE_BAR before the measure's content ends (all in the system's staff space). A measure rest
     centred in its measure is not at its column. */
  let rod = 0;
  const anchored = eng.objects.filter(o => o.anchor && o.staffKey && !o.center);
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
        if (nx && !nx.time) continue;          /* a clef or key column splits the step: not a plain spring */
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
  const drawable = e => !(e.hidden || (e.grace && e.grace.after) || deferred.has(e.id) || !laidOut.has(e.m));
  plan.events.forEach(e => {
    if (!drawable(e)) return;
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

  /* the drawn events as a multiset (A14 at the layout level; §23 M11, M16): each rest the plan draws is exactly one
     'rest' object and each head exactly one 'notehead' object, keyed (kind, id, event, measure, column time, staff,
     grace or not). A copy under the same id or a new one, a missing one, one on another staff or at another time, a
     grace note drawn as an ordinary note, is a difference. The count is the size of the multiset difference, both ways. */
  const colAt = new Map();
  eng.measures.forEach(me => me.columns.forEach(c => { if (c.time) colAt.set(me.id + '|' + c.x, q(c.at)); }));
  const want = new Map(), got = new Map();
  const bump = (mp, k) => mp.set(k, (mp.get(k) || 0) + 1);
  const primaryKey = (kind, id, ev, meas, at, st, grace) => [kind, id, ev, meas, at, st, grace ? 'g' : ''].join('|');
  plan.events.forEach(e => {
    if (!drawable(e)) return;
    if (e.kind === 'rest') { if (liveStaff(e.staff)) bump(want, primaryKey('rest', e.id, e.id, e.m, q(e.at), e.staff, false)); return; }
    e.heads.forEach(h => {
      const st = h.staff || e.staff;
      if (liveStaff(st) && (h.written || h.pos)) bump(want, primaryKey('notehead', h.id, e.id, e.m, q(e.at), st, !!e.grace));
    });
  });
  eng.objects.forEach(o => {
    if (o.kind !== 'rest' && o.kind !== 'notehead') return;
    const at = o.anchor ? colAt.get(o.measure + '|' + o.anchor[0]) : undefined;
    bump(got, primaryKey(o.kind, o.id, o.event, o.measure, at === undefined ? 'no-column' : at, o.staffKey, !!o.grace));
  });
  let md = 0;
  new Set([...want.keys(), ...got.keys()]).forEach(k => { md += Math.abs((want.get(k) || 0) - (got.get(k) || 0)); });
  set('eg.layout.multiset_diff', md);

  /* ---- R4 (G4b review): the layout-level objects beyond events and heads, and written pitch -> staff position */
  const clefsOf = groupBy(plan.clefs, c => c.staff);
  clefsOf.forEach(list => list.sort((a, b) => pm.get(a.m).i - pm.get(b.m).i || q(a.at) - q(b.at)));
  const clefIn = (staff, mid, at, strict) => {
    let cur = null;
    (clefsOf.get(staff) || []).forEach(c => {
      const d = pm.get(c.m).i - pm.get(mid).i || q(c.at) - q(at);
      if (d < 0 || (d === 0 && !strict)) cur = c;
    });
    return cur;
  };
  let yErr = 0;
  eng.objects.forEach(o => {
    if (o.kind !== 'notehead') return;
    const e = pe.get(o.event);
    const h = e && e.heads.find(x => x.id === o.id);
    if (!h || !(h.written || h.pos)) { yErr++; return; }
    const top = staffTop.get(o.system + '|' + o.staffKey);
    const want = top + spaceOf(o) * staffY(h.written || h.pos, clefIn(o.staffKey, e.m, e.at, false));
    if (Math.abs((o.box[1] + o.box[3]) / 2 - want) > TOL) yErr++;
  });
  set('eg.layout.pitch_y_err', yErr);
  /* attachments: every head the plan gives an accidental has one (and no other head has one); an event's dots are a
     whole number of its dot count (a row per space its heads use), and a whole-measure rest has none (R6) */
  const wholeBar = e => e.kind === 'rest' && (e.measureRest || (q(e.at) === 0 && pm.has(e.m) && q(e.dur) === q(pm.get(e.m).dur) &&
    plan.events.filter(x => !x.grace && x.voice === e.voice && x.m === e.m).length === 1));
  let att = 0;
  const accHeads = new Set(eng.objects.filter(o => o.kind === 'accidental').map(o => o.refs[0]));
  heads.forEach((st, hid) => {
    const e = pe.get((headObjs.get(hid) || [{}])[0].event);
    const h = e ? e.heads.find(x => x.id === hid) : null;
    if (h && !!h.acc !== accHeads.has(hid)) att++;
  });
  accHeads.forEach(hid => { if (!heads.has(hid)) att++; });
  plan.events.forEach(e => {
    if (!drawable(e) || !expected.has(e.id)) return;
    const n = objsOf(e.id).filter(o => o.kind === 'dot').length;
    const d = e.dots || 0;
    if (!d || wholeBar(e)) { if (n) att++; } else if (!n || n % d) att++;
  });
  set('eg.layout.attachment_diff', att);
  /* signatures: each system's head shows the clef in force on every staff, the key in force as that many sharps or
     flats (none when hidden, or on a percussion staff), the time signature where the meter starts or changes; a key or
     meter change inside a system shows where it happens, with naturals for what the old key drops; a clef change shows
     at its place (before the bar line when it starts a measure inside a system) */
  const keysSorted = (plan.keys || []).slice().sort((a, b) => pm.get(a.m).i - pm.get(b.m).i || q(a.at) - q(b.at));
  const keyIn = (mid, at, strict) => {
    let cur = null;
    keysSorted.forEach(k => { const d = pm.get(k.m).i - pm.get(mid).i || (at === Infinity ? -1 : q(k.at) - q(at)); if (d < 0 || (d === 0 && !strict)) cur = k; });
    return cur;
  };
  const cancels = (prev, next) => {
    const o = prev && !prev.hidden ? prev.fifths : 0, n = next.fifths;
    return !o ? 0 : Math.sign(o) === Math.sign(n) ? Math.max(0, Math.abs(o) - Math.abs(n)) : Math.abs(o);
  };
  const keyGlyphs = (list, k, prev) => {
    const acc = list.filter(o => o.glyph === (k.fifths > 0 ? 'accidentalSharp' : 'accidentalFlat')).length;
    const nat = list.filter(o => o.glyph === 'accidentalNatural').length;
    return acc === Math.abs(k.fifths) && nat === cancels(prev, k) && list.length === acc + nat;
  };
  let sig = 0;
  const liveStaves = plan.staves.filter(s => liveStaff(s.id));
  const sigObjs = groupBy(eng.objects.filter(o => ['clef', 'keysig', 'timesig'].indexOf(o.kind) >= 0), o => o.system + '|' + o.staffKey + '|' + (o.measure || 'head'));
  eng.systems.forEach(s => {
    const first = s.measures[0];
    liveStaves.forEach(st => {
      const head = sigObjs.get(s.index + '|' + st.id + '|head') || [];
      const c = clefIn(st.id, first, '0', false);
      const clefs = head.filter(o => o.kind === 'clef' && o.id === 'd:clef:' + st.id + ':' + first);
      if (c && c.sign !== 'none' ? !(clefs.length === 1 && clefs[0].glyph === CLEF_GLYPH[c.sign]) : clefs.length) sig++;
      const k = keyIn(first, '0', false);
      const perc = c && (c.sign === 'percussion' || c.sign === 'TAB');
      const ks = head.filter(o => o.kind === 'keysig');
      if (k && !k.hidden && k.fifths && !perc ? !keyGlyphs(ks, k, null) : ks.length) sig++;
      const meter = (plan.meters || []).find(x => x.m === first);
      const ts = head.filter(o => o.kind === 'timesig');
      if ((pm.get(first).i === 0 || meter) && meter && !meter.hidden ? !ts.length : ts.length) sig++;
    });
    s.measures.forEach((mid, k) => {
      const mi = pm.get(mid).i;
      liveStaves.forEach(st => {
        const inM = sigObjs.get(s.index + '|' + st.id + '|' + mid) || [];
        const c = clefIn(st.id, mid, '0', false), perc = c && (c.sign === 'percussion' || c.sign === 'TAB');
        /* key changes in this measure: at its start (inside a system) and in it */
        keysSorted.filter(x => x.m === mid && !x.hidden && (k > 0 || q(x.at) > 0)).forEach(x => {
          const list = inM.filter(o => o.kind === 'keysig' && o.refs[0] === x.id && !o.courtesy);
          const prev = q(x.at) > 0 ? keyIn(mid, x.at, true) : mi > 0 ? keyIn(plan.measures[mi - 1].id, Infinity, false) : null;
          if (perc ? list.length : !keyGlyphs(list, x, prev)) sig++;
        });
        const mc = (plan.meters || []).find(x => x.m === mid);
        if (k > 0 && mc && !mc.hidden && !inM.some(o => o.kind === 'timesig' && o.refs[0] === mc.id && !o.courtesy)) sig++;
        /* clef changes inside the measure, and at the next measure's start (drawn at this one's end) */
        (clefsOf.get(st.id) || []).filter(x => x.sign !== 'none' && ((x.m === mid && q(x.at) > 0) ||
          (k + 1 < s.measures.length && x.m === s.measures[k + 1] && q(x.at) === 0 && (() => {
            const b = clefIn(st.id, x.m, '0', true);
            return !b || b.sign !== x.sign || (b.line || 0) !== (x.line || 0) || (b.octave || 0) !== (x.octave || 0);
          })()))).forEach(x => { if (!inM.some(o => o.kind === 'clef' && o.id === x.id)) sig++; });
      });
    });
  });
  set('eg.layout.signature_diff', sig);

  /* ---- stems (§11.2, §14.1, A21, A26) */
  const planBeams = plan.beams || [];
  const beamOfEv = new Map();
  planBeams.forEach(b => b.events.forEach(id => { if (!beamOfEv.has(id)) beamOfEv.set(id, b); }));
  const homeHeads = (e, system) => objsOf(e.id).filter(o => o.kind === 'notehead' && o.staffKey === e.staff && (system === undefined || o.system === system));
  const offsOf = e => homeHeads(e).map(h => {
    const top = staffTop.get(h.system + '|' + h.staffKey), f = spaceOf(h);
    const lines = (plan.staves.find(s => s.id === h.staffKey) || { lines: 5 }).lines;
    /* a staff position is a whole number of half spaces: read it to the nearest (the boxes are rounded to 0.01 sp) */
    return Math.round((((h.box[1] + h.box[3]) / 2 - top) / f - Math.max(0, lines - 1) / 2) * 2) / 2;
  });
  const stated = e => (e.stemFrom === 'graph' && (e.stem === 'up' || e.stem === 'down') ? e.stem : null);
  const roled = e => (e.stemFrom === 'voice' && (e.stem === 'up' || e.stem === 'down') ? e.stem : null);
  const policy = e => {
    const b = beamOfEv.get(e.id);
    if (b) {
      const ms = b.events.map(id => pe.get(id)).filter(x => x && !x.hidden && x.kind !== 'rest' && x.heads.length);
      const s = ms.map(stated).find(Boolean);
      if (s) return s;
      const r = ms.map(roled).find(Boolean);
      if (r) return r;
      if (ms.every(x => x.grace)) return 'up';
      return autoDir([].concat(...ms.map(offsOf)));
    }
    if (e.grace) return stated(e) || roled(e) || 'up';
    return stated(e) || roled(e) || autoDir(offsOf(e));
  };
  let pol = 0, short = 0;
  eng.objects.forEach(o => {
    if (o.kind !== 'stem' || !/#stem$/.test(o.id)) return;
    const e = pe.get(o.event);
    if (!e) { pol++; return; }
    const hsHere = homeHeads(e, o.system);
    if (!hsHere.length) return;
    const top = Math.min(...hsHere.map(h => (h.box[1] + h.box[3]) / 2)), bot = Math.max(...hsHere.map(h => (h.box[1] + h.box[3]) / 2));
    const dir = o.dir;
    const geomUp = o.box[1] < top - EPS, geomDown = o.box[3] > bot + EPS;
    if (dir !== policy(e) || (dir === 'up' ? !geomUp : !geomDown)) pol++;
    /* A21: no stem shorter than its least length, from the head at its end */
    const f = spaceOf(o) * (e.grace ? GRACE : 1);
    const len = (dir === 'up' ? top - o.box[1] : o.box[3] - bot) / f;
    const n = Math.max(1, FLAGS[e.type] || 0);
    const need = o.beam ? STEM.beamed + STEM.perBeam * (n - 1) : STEM.free;
    if (len < need - TOL / f) short++;
  });
  set('eg.voice.stem_policy_violations', pol);
  set('eg.stem.short', short);
  /* §11.2 (the G4c review R2): where one voice sounds in a staff-measure, every stem reaches the middle line - an
     unbeamed one from a ledger-line note, and a beam whose stems all stand in such staff-measures (G4-C2: not where two
     voices share the staff, nor for grace notes) */
  const sounding = new Map();
  plan.events.forEach(e => {
    if (e.grace || e.hidden || e.kind === 'rest') return;
    const k = e.staff + '|' + e.m;
    if (!sounding.has(k)) sounding.set(k, new Set());
    sounding.get(k).add(e.voice);
  });
  const oneVoice = o => { const e = pe.get(o.event); return !!e && (sounding.get(o.staffKey + '|' + e.m) || new Set()).size === 1; };
  const beamParts = groupBy(eng.objects.filter(o => o.kind === 'stem' && o.beam && !o.grace), o => o.beam + '|' + o.system + '|' + o.staffKey);
  let midShort = 0;
  eng.objects.forEach(o => {
    if (o.kind !== 'stem' || !/#stem$/.test(o.id) || o.grace || !oneVoice(o)) return;
    if (o.beam && !(beamParts.get(o.beam + '|' + o.system + '|' + o.staffKey) || []).every(oneVoice)) return;
    const f = spaceOf(o), mid = staffTop.get(o.system + '|' + o.staffKey) + f * Math.max(0, (linesOf.get(o.staffKey) || 5) - 1) / 2;
    if (o.dir === 'up' ? o.box[1] > mid + TOL : o.box[3] < mid - TOL) midShort++;
  });
  set('eg.stem.middle_line', midShort);

  /* ---- beams (§11, A2, A3, A21) */
  const beamObjs = eng.objects.filter(o => o.kind === 'beam');
  const beamsBy = groupBy(beamObjs, o => o.refs[0]);
  /* the stemmed, drawn members of a beam, by system and staff (a beam split by a system break, or a deferred cross-staff
     beam drawn per staff, is drawn in parts); a part of one stem has none */
  const stemOf = new Map(eng.objects.filter(o => o.kind === 'stem' && /#stem$/.test(o.id)).map(o => [o.event, o]));
  const partsOf = evIds => {
    const parts = groupBy(evIds.map(id => stemOf.get(id)).filter(Boolean), st => st.system + '|' + st.staffKey);
    return [...parts.values()].filter(p => p.length >= 2).map(p => p.map(st => st.event));
  };
  const drawnAs = (id, evIds) => {
    const want = partsOf(evIds);
    const prim = (beamsBy.get(id) || []).filter(o => o.level === 1);
    const have = prim.map(o => o.events.join(' ')).sort();
    return want.map(p => p.join(' ')).sort().join('\n') === have.join('\n');
  };
  const cross = evIds => new Set(evIds.map(id => (pe.get(id) || {}).staff)).size > 1;
  /* graph beams: what the graph states (or the plan's graph beams without a graph) */
  const g = opts.graph || null;
  const graphBeams = g ? g.parts.flatMap(pt => pt.spanners.filter(s => s.type === 'beam').map(s => ({ id: s.id, events: (s.events || []).slice() })))
    : planBeams.filter(b => b.source === 'graph');
  let gmiss = 0;
  graphBeams.forEach(b => { if (!b.events.some(id => !laidOut.has((pe.get(id) || {}).m)) && !cross(b.events) && !drawnAs(b.id, b.events)) gmiss++; });
  set('eg.beam.graph_missing', gmiss);
  /* derived beams (G4-D3, G4-I1, A3): in a part the graph beams nowhere, exactly pro-beam.groups() per voice-measure,
     with a merged one-note tuplet group standing for one tuplet */
  let dmiss = 0;
  const derived = [];
  if (g) {
    const shownAs = new Map();
    (plan.tuplets || []).filter(t => t.source === 'merged').forEach(t => (t.members || []).forEach(sid => shownAs.set(sid, t.id)));
    g.parts.forEach(pt => {
      if (pt.spanners.some(s => s.type === 'beam')) return;
      const tupOf = new Map();
      pt.spanners.forEach(s => { if (s.type === 'tuplet' && s.printed !== false) (s.events || []).forEach(id => tupOf.set(id, shownAs.get(s.id) || s.id)); });
      groupBy(pt.events.filter(e => !e.grace), e => e.voice + '|' + e.m).forEach(evs => {
        let gr = null;
        try { gr = SG.meterGrid.grid(g, evs[0].m); } catch (err) { gr = null; }
        if (!gr) return;
        const sorted = evs.slice().sort((a, b) => SG.rational.cmp(SG.rational.parse(a.at), SG.rational.parse(b.at)) || SG.schema.idNumber(a.id) - SG.schema.idNumber(b.id));
        let groups = [];
        try { groups = proBeam.groups(sorted, gr, id => tupOf.get(id)); } catch (err) { groups = []; }
        groups.forEach(x => derived.push({ id: 'd:beam:' + x.events[0], events: x.events.slice() }));
      });
    });
  } else planBeams.filter(b => b.source === 'derived').forEach(b => derived.push({ id: b.id, events: b.events.slice() }));
  derived.forEach(b => { if (!b.events.some(id => !laidOut.has((pe.get(id) || {}).m)) && !cross(b.events) && !drawnAs(b.id, b.events)) dmiss++; });
  set('eg.beam.derived_missing', dmiss);
  /* a beam drawn for no beam of the graph or the derivation rule, or joining notes the beam does not hold */
  const known = new Map(graphBeams.concat(derived).map(b => [b.id, new Set(b.events)]));
  set('eg.beam.unplanned', beamObjs.filter(o => !known.has(o.refs[0]) || o.events.some(id => !known.get(o.refs[0]).has(id))).length);
  /* levels and flags: at each stem of a drawn beam part, as many beam levels as its value has flags (hooks included),
     none crossing a break the graph states at that level, and no flag; an unbeamed stemmed note of a flagged value at
     home has its flag */
  let lvl = 0, flagErr = 0;
  const flagOf = new Set(eng.objects.filter(o => o.kind === 'flag').map(o => o.event));
  const breaksOf = new Map(planBeams.map(b => [b.id, b.breaks || []]));
  beamsBy.forEach((list, bid) => {
    const members = new Set(list.flatMap(o => o.events));
    members.forEach(id => {
      const e = pe.get(id), st = stemOf.get(id);
      if (!e || !st) return;
      const x = (st.box[0] + st.box[2]) / 2;
      const levels = list.filter(o => o.system === st.system && o.box[0] <= x + EPS && x <= o.box[2] + EPS && o.events.indexOf(id) >= 0).map(o => o.level);
      const n = Math.max(1, FLAGS[e.type] || 0);
      const lv = [...new Set(levels)].sort((a, b) => a - b);
      if (lv.length !== n || lv.some((v, i) => v !== i + 1)) lvl++;
      if (flagOf.has(id)) flagErr++;
    });
    (breaksOf.get(bid) || []).forEach(br => {
      list.forEach(o => {
        const i = o.events.indexOf(br.after);
        if (i >= 0 && i < o.events.length - 1 && o.level >= br.level) lvl++;
      });
    });
  });
  plan.events.forEach(e => {
    if (!drawable(e) || e.kind === 'rest' || STEMLESS[e.type] || !FLAGS[e.type]) return;
    const st = stemOf.get(e.id);
    if (!st) return;
    const beamed = beamObjs.some(o => o.events.indexOf(e.id) >= 0);
    if (!beamed && !flagOf.has(e.id)) flagErr++;
  });
  set('eg.beam.level_errors', lvl);
  set('eg.beam.flag_errors', flagErr);
  /* §11.2 hooks (the G4c review R2): a hook stands where the rule puts it - the beam part's first note right, its last
     left, after a dotted note left, in the beat of the note before left, else right - and is drawn on that side of its
     stem. The beat is the meter's: a dotted one in compound time, a group of an additive meter (G04 §34.3). */
  const meters = (plan.meters || []).filter(x => pm.has(x.m)).sort((a, b) => pm.get(a.m).i - pm.get(b.m).i);
  const beatOf = e => {
    let mt = null;
    meters.forEach(x => { if (pm.get(x.m).i <= pm.get(e.m).i) mt = x; });
    const t = q(e.at);
    if (!mt) return Math.floor(t * 4 + 1e-9);
    const bt = mt.beatType || 4, beats = mt.beats && mt.beats.length ? mt.beats : [4];
    if (beats.length > 1) {
      let acc = 0;
      for (let i = 0; i < beats.length; i++) { acc += beats[i] / bt; if (t < acc - 1e-9) return i; }
      return beats.length;
    }
    return Math.floor(t / (beats[0] % 3 === 0 && beats[0] > 3 && bt >= 8 ? 3 / bt : 1 / bt) + 1e-9);
  };
  let hookErr = 0;
  beamObjs.filter(o => o.hook).forEach(o => {
    const id = o.events[0], st = stemOf.get(id);
    const part = beamObjs.find(p => p.level === 1 && p.refs[0] === o.refs[0] && p.system === o.system && p.staffKey === o.staffKey && p.events.indexOf(id) >= 0);
    if (o.events.length !== 1 || !st || !part) { hookErr++; return; }
    const i = part.events.indexOf(id), e = pe.get(id), prev = i > 0 ? pe.get(part.events[i - 1]) : null;
    const want = i === 0 ? 'right' : i === part.events.length - 1 ? 'left' : prev.dots ? 'left' : beatOf(prev) === beatOf(e) ? 'left' : 'right';
    const drawn = o.line[0] < st.box[0] - EPS ? 'left' : o.line[2] > st.box[2] + EPS ? 'right' : null;
    if (o.hook !== want || drawn !== want) hookErr++;
  });
  set('eg.beam.hook_side_err', hookErr);
  /* slope (<= 0.25) and H7: no beam through a head of its own group */
  let slopeMax = 0, steep = 0, cross7 = 0;
  beamObjs.forEach(o => {
    const l = o.line, dx = l[2] - l[0];
    const sl = dx > EPS ? Math.abs(l[3] - l[1]) / dx : 0;
    /* the steepest beam, read on primary beams at least 4 sp long, where the 0.01 sp rounding of the ends tilts the slope
       by no more than 0.0025 (and reported to 0.01); a violation is a rise beyond 0.25 of the run by more than the two
       roundings, on any segment */
    if (o.level === 1 && dx >= 4) slopeMax = Math.max(slopeMax, sl);
    if (Math.abs(l[3] - l[1]) > MAX_SLOPE * dx + TOL) steep++;
    const topAt = x => l[1] + (l[3] - l[1]) * (dx > EPS ? (x - l[0]) / dx : 0);
    o.events.forEach(id => objsOf(id).filter(h => h.kind === 'notehead' && h.system === o.system).forEach(h => {
      const a = Math.max(h.box[0], l[0]), b = Math.min(h.box[2], l[2]);
      if (a >= b - EPS) return;
      const ys = [topAt(a), topAt(b)];
      const bandTop = Math.min(...ys), bandBot = Math.max(...ys) + o.t;
      if (bandTop < h.box[3] - EPS && h.box[1] < bandBot - EPS) cross7++;
    }));
  });
  set('eg.beam.slope_max', Math.round(slopeMax * 100) / 100);
  set('eg.beam.slope_violations', steep);
  set('eg.beam.head_crossings', cross7);

  /* ---- tuplets (§12, A4) */
  const tupObjs = eng.objects.filter(o => o.kind === 'tuplet-number' || o.kind === 'tuplet-bracket');
  const tupBy = groupBy(tupObjs, o => o.refs[0]);
  const graphTup = g ? new Map(g.parts.flatMap(pt => pt.spanners.filter(s => s.type === 'tuplet').map(s => [s.id, s]))) : null;
  const beamKeys = new Set(planBeams.map(b => b.events.join(' ')));
  let tmiss = 0, show = 0, ext = 0, nest = 0;
  const drawnEvs = evIds => evIds.filter(id => objsOf(id).some(o => o.kind === 'notehead' || o.kind === 'rest'));
  (plan.tuplets || []).forEach(t => {
    if (t.deferred || !drawnEvs(t.events).length) return;
    const list = tupBy.get(t.id) || [];
    if (!list.length) { tmiss++; return; }
    /* what the graph states (a display group of one-note tuplets states nothing: the number of the merged tuplet) */
    const s = graphTup && t.source === 'graph' ? graphTup.get(t.id) : null;
    const sh = s ? (s.show || {}) : { number: t.number === 'actual' ? undefined : t.number, bracket: t.source === 'graph' ? t.bracketStated === null ? undefined : t.bracketStated : undefined, placement: t.placement || undefined };
    const number = sh.number || 'actual';
    const bracket = sh.bracket !== undefined ? !!sh.bracket : t.events.length > 1 && !beamKeys.has(t.events.join(' '));
    const want = number === 'none' ? '' : number === 'both' ? t.actual + ':' + t.normal : String(t.actual);
    const nums = list.filter(o => o.kind === 'tuplet-number' && o.id.indexOf('@') < 0).sort((a, b) => a.box[0] - b.box[0] || a.box[1] - b.box[1]);
    let text = '';
    nums.forEach((o, i) => {
      if (o.glyph === 'augmentationDot') { if (!(i > 0 && nums[i - 1].glyph === 'augmentationDot' && Math.abs(nums[i - 1].box[0] - o.box[0]) < EPS)) text += ':'; }
      else text += o.glyph.replace('timeSig', '');
    });
    const hasBracket = list.some(o => o.kind === 'tuplet-bracket');
    const sides = new Set(list.map(o => o.side));
    if (text !== want || hasBracket !== bracket || (sh.placement && (sides.size !== 1 || !sides.has(sh.placement)))) show++;
    /* the bracket covers its members from the first one's head (or rest) to the last one's right edge, dots included -
       rests at either end too (§12.2, M24) */
    list.filter(o => o.kind === 'tuplet-bracket').forEach(o => {
      const here = t.events.filter(id => objsOf(id).some(x => (x.kind === 'notehead' || x.kind === 'rest') && x.system === o.system && x.staffKey === o.staffKey));
      if (!here.length) { ext++; return; }
      const left = Math.min(...objsOf(here[0]).filter(x => (x.kind === 'notehead' || x.kind === 'rest') && x.system === o.system).map(x => x.box[0]));
      const right = Math.max(...objsOf(here[here.length - 1]).filter(x => (x.kind === 'notehead' || x.kind === 'rest' || x.kind === 'dot') && x.system === o.system).map(x => x.box[2]));
      if (o.line[0] > left + TOL || o.line[2] < right - TOL) ext++;
    });
    /* nested: the inner tuplet nearer the notes than the outer one on the same side */
    if (t.parent) {
      const outer = tupBy.get(t.parent) || [];
      list.forEach(a => outer.forEach(b => {
        if (a.system !== b.system || a.side !== b.side || !(a.box[0] < b.box[2] && b.box[0] < a.box[2])) return;
        if (a.side === 'above' ? a.box[1] < b.box[3] - EPS : a.box[3] > b.box[1] + EPS) nest++;
      }));
    }
  });
  set('eg.tuplet.missing', tmiss);
  set('eg.tuplet.show_errors', show);
  set('eg.tuplet.extent_err', ext);
  set('eg.tuplet.nesting_errors', nest);
  /* §12.2 (the G4c review R2): a bracket's hooks turn toward the notes - down from a bracket above, up from one below -
     hookLen (> 0) from its line, the box spanning line and hooks */
  let hookDir = 0;
  tupObjs.filter(o => o.kind === 'tuplet-bracket' && (o.hooks || []).some(Boolean)).forEach(o => {
    const y = o.line[1], hl = o.hookLen;
    const ok = hl > EPS && (o.side === 'above' ? Math.abs(o.box[1] - y) <= TOL && Math.abs(o.box[3] - (y + hl)) <= TOL
      : o.side === 'below' && Math.abs(o.box[3] - y) <= TOL && Math.abs(o.box[1] - (y - hl)) <= TOL);
    if (!ok) hookDir++;
  });
  set('eg.tuplet.hook_dir_err', hookDir);
  /* nothing for a tuplet printed:false, or shown with no number and no bracket */
  const quiet = g ? [...graphTup.values()].filter(s => s.printed === false || (s.show && s.show.number === 'none' && s.show.bracket === false)).map(s => s.id)
    : plan.ledger.filter(x => x.kind === 'tuplet' && x.status === 'suppressed').map(x => x.ref);
  set('eg.tuplet.suppressed_rendered', quiet.filter(id => tupObjs.some(o => o.refs.indexOf(id) >= 0)).length);

  /* ---- grace notes (§14.5, A7, M16): small, to the left of the note they lead into, never on a time column of their
     own; stemmed, flagged or beamed as their value is, slashed when the graph says acciaccatura */
  let gmis = 0, gstem = 0;
  plan.events.forEach(e => {
    if (!e.grace || !drawable(e) || !expected.has(e.id)) return;
    const os = objsOf(e.id);
    const hsG = os.filter(o => o.kind === 'notehead');
    const bad = hsG.some(o => !o.grace || Math.abs((o.scale || 1) / spaceOf(o) - GRACE) > 0.01 || !o.anchor || o.box[2] > o.anchor[0] + EPS ||
      colAt.get(o.measure + '|' + o.anchor[0]) !== q(e.at));
    if (bad || !hsG.length) gmis++;
    if (STEMLESS[e.type] || e.stem === 'none' || !hsG.some(h => h.staffKey === e.staff)) return;
    const st = os.find(o => o.kind === 'stem' && o.grace);
    const beamed = beamObjs.some(o => o.events.indexOf(e.id) >= 0);
    let okG = !!st;
    if (FLAGS[e.type] && !beamed && !os.some(o => o.kind === 'flag')) okG = false;
    if (e.grace.slash) {
      const b = beamed ? beamObjs.find(o => o.events.indexOf(e.id) >= 0) : null;
      const first = !b || b.events[0] === e.id;
      if (first && !os.some(o => o.kind === 'slash')) okG = false;
    }
    if (!okG) gstem++;
  });
  set('eg.grace.misplaced', gmis);
  set('eg.grace.stem_errors', gstem);

  /* ---- rests (§14.3, A11): a whole-measure rest is a whole (or breve) rest, undotted, in the middle of its measure */
  let mr = 0;
  const mBox = new Map(eng.measures.map(x => [x.id, x]));
  plan.events.forEach(e => {
    if (!wholeBar(e) || !expected.has(e.id)) return;
    const r = objsOf(e.id).find(o => o.kind === 'rest');
    if (!r) { mr++; return; }
    const me = mBox.get(e.m), f = spaceOf(r);
    const centre = (me.content[0] + me.content[1] - BEFORE_BAR * f) / 2;
    if (['restWhole', 'restDoubleWhole'].indexOf(r.glyph) < 0 || objsOf(e.id).some(o => o.kind === 'dot') || Math.abs((r.box[0] + r.box[2]) / 2 - centre) > 0.05) mr++;
  });
  set('eg.rest.measure_errors', mr);
  /* §14.3 (the G4c review R2): a rest keeps line or space as it moves, a whole staff space at a time - its glyph's
     origin stands a whole number of staff spaces from where it starts: the position the graph states, else a line (a
     whole or breve rest hangs from the line above the middle one, a half rest sits on the middle line, the others centre
     on it) */
  let rpos = 0;
  eng.objects.forEach(o => {
    const e = o.kind === 'rest' && o.origin ? pe.get(o.event) : null;
    if (!e) return;
    const f = spaceOf(o), mid = Math.max(0, (linesOf.get(o.staffKey) || 5) - 1) / 2;
    const base = e.restPos ? staffY(e.restPos, clefIn(o.staffKey, e.m, e.at, false)) : o.glyph === 'restWhole' || o.glyph === 'restDoubleWhole' ? mid - 1 : mid;
    const k = (o.origin[1] - staffTop.get(o.system + '|' + o.staffKey)) / f - base;
    if (Math.abs(k - Math.round(k)) > TOL / f) rpos++;
  });
  set('eg.rest.position_err', rpos);

  /* one-bar systems a neighbour could have taken (G4-U4: density may force them; this counts the avoidable ones) */
  let one = 0;
  if (opts.prepared && opts.layout && eng.measures.length > 1) {
    const P = opts.prepared;
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

/* the metrics whose target is 0 (all but the maximum and the recorded count of smaller staves) */
const MAXIMA = { 'eg.beam.slope_max': MAX_SLOPE };
const RECORDED = ['eg.system.scaled'];

module.exports = { l2, EPS, TOL, MAXIMA, RECORDED, ACC_VS, DOT_VS, REST_VS, STEM_KINDS, staffY, autoDir };
