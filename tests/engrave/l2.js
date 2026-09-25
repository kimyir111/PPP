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

   Every metric here is a count whose target is 0, except the maxima (MAXIMA): eg.beam.slope_max (the steepest beam,
   <= 0.25), and since G4d-1a eg.curve.endpoint_err_max (the farthest a tie ends from its head, <= 0.5 sp, A22) and
   eg.curve.hit_ratio (the share of slurs that cross a note between their ends, <= 1 %, A22). G4b's two ratchets
   (eg.rest.overlap, eg.voice.stem_over_head) are zero targets since G4c (G04 §33.16.4).

   G4d-1a (G04 §10, §13, §18.3, §21): ties, slurs and glissandi (eng.curves), marks attached to notes, printed fingering,
   the rests' ledger lines and the tuplet numbers by their beams - each rule G04 states, computed here from the boxes and
   curves, with its own geometry (a Bezier sampled every 0.5 sp), not engrave/curves.js or engrave/marks.js. The text
   widths are engrave/metrics-text.js's table: that table is data (§18.3), the one source of widths for everyone.
   opts.missing (a Set): the ledger refs of ties, slurs and marks this layout should draw and does not - bench.js turns
   them into the drawn ratios of §21.1. */
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const proBeam = require(path.join(REPO, 'scoregraph', 'pro-beam.js'));
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const TX = require(path.join(REPO, 'engrave', 'metrics-text.js'));

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
const ACC_VS = ['notehead', 'stem', 'accidental', 'ledger', 'flag', 'beam', 'paren', 'arpeggio'];
const DOT_VS = ['notehead', 'stem', 'flag', 'accidental', 'rest', 'ledger', 'beam', 'paren'];
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
  /* §14.6: a percussion note stems up unless the graph or its kit says otherwise */
  const staffKind = new Map(plan.staves.map(s => [s.id, s.kind || 'standard']));
  const percussive = e => e.kind === 'perc' || staffKind.get(e.staff) === 'percussion';
  const kitStem = e => { const h = e.heads.find(x => x.kit && (x.kit.stem === 'up' || x.kit.stem === 'down')); return h ? h.kit.stem : null; };
  const policy = e => {
    const b = beamOfEv.get(e.id);
    if (b) {
      const ms = b.events.map(id => pe.get(id)).filter(x => x && !x.hidden && x.kind !== 'rest' && x.heads.length);
      const s = ms.map(stated).find(Boolean);
      if (s) return s;
      const r = ms.map(roled).find(Boolean);
      if (r) return r;
      if (ms.every(x => x.grace) || ms.every(percussive)) return 'up';
      return autoDir([].concat(...ms.map(offsOf)));
    }
    if (e.grace) return stated(e) || roled(e) || 'up';
    return stated(e) || roled(e) || kitStem(e) || (percussive(e) ? 'up' : autoDir(offsOf(e)));
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
  set('eg.text.missing_glyph', (codes.get('TEXT_GLYPH_MISSING') || []).length);
  curvesAndMarks(eng, plan, opts, m, { pe, pm, objsOf, spaceOf, staffTop, linesOf, laidOut, stemDirOf, offsOf, codes, ids });
  systemMarks(eng, plan, opts, m, { pe, pm, spaceOf, staffTop, linesOf, laidOut, clefIn });
  return m;
}

/* ---------------------------------------------------------------- G4d-1a: curves and marks attached to notes */
const cxOf = b => (b[0] + b[2]) / 2, cyOf = b => (b[1] + b[3]) / 2;
const unionBox = bs => bs.reduce((u, b) => (u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b.slice()), null);
const pointGap = (p, b) => Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[2]), Math.max(b[1] - p[1], 0, p[1] - b[3]));
const boxGap = (a, b) => Math.hypot(Math.max(0, b[0] - a[2], a[0] - b[2]), Math.max(0, b[1] - a[3], a[1] - b[3]));
/* a curve's point at t, and the boxes it covers (every 0.5 sp of its run), thickened by half its thickness */
const bez = (c, t) => { const u = 1 - t; return [0, 1].map(k => u * u * u * c.p0[k] + 3 * u * u * t * c.c1[k] + 3 * u * t * t * c.c2[k] + t * t * t * c.p3[k]); };
function sampleBoxes(c) {
  const n = Math.max(1, Math.ceil(Math.abs(c.p3[0] - c.p0[0]) / 0.5));
  const out = [], w = (c.t || 0) / 2 + (c.line === 'wavy' ? 0.2 : 0);
  let a = bez(c, 0);
  for (let k = 1; k <= n; k++) {
    const b = bez(c, k / n);
    out.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]) - w, Math.max(a[0], b[0]), Math.max(a[1], b[1]) + w]);
    a = b;
  }
  return out;
}
/* where the curve passes x: its y there (t found by halving - the x of a tie, slur or glissando only ever grows along
   it), or null outside its run */
function yOnCurve(c, x) {
  const lo = Math.min(c.p0[0], c.p3[0]), hi = Math.max(c.p0[0], c.p3[0]);
  if (x < lo - 1e-9 || x > hi + 1e-9) return null;
  const up = c.p3[0] >= c.p0[0];
  let a = 0, b = 1;
  for (let k = 0; k < 40; k++) { const t = (a + b) / 2, bx = bez(c, t)[0]; if ((bx < x) === up) a = t; else b = t; }
  return bez(c, (a + b) / 2)[1];
}
/* does the curve itself (its line, t/2 either side) pass through the box - looked at every 0.05 sp of the box's width */
function curveCrosses(c, box) {
  const w = (c.t || 0) / 2;
  const n = Math.max(1, Math.ceil((box[2] - box[0]) / 0.05));
  for (let k = 0; k <= n; k++) {
    const x = box[0] + (box[2] - box[0]) * k / n, y = yOnCurve(c, x);
    if (y !== null && y + w > box[1] + EPS && y - w < box[3] - EPS && x > box[0] + EPS && x < box[2] - EPS) return true;
  }
  return false;
}
/* which way a curve bows: above its chord (y smaller at the middle) or below */
const bulge = c => { const mid = bez(c, 0.5)[1], chord = (c.p0[1] + c.p3[1]) / 2; return mid < chord - 1e-6 ? 'above' : mid > chord + 1e-6 ? 'below' : null; };
/* §10.2 priority 5, inside to out */
const MARK_RANK = { staccato: 0, staccatissimo: 0, spiccato: 0, 'detached-legato': 0, tenuto: 1, accent: 2, stress: 2, unstress: 2, marcato: 3 };
const HORIZONTAL_ARTS = { 'breath-mark': 1, caesura: 1 };
/* SMuFL's glyph of each articulation (+ Above | Below), with the pinned font's stand-in second where it lacks one (G04 §18.2);
   a fermata by its MusicXML shape */
const ARTIC_GLYPH = { staccato: ['articStaccato'], staccatissimo: ['articStaccatissimo'], tenuto: ['articTenuto'], accent: ['articAccent'],
  marcato: ['articMarcato'], spiccato: ['articStaccatissimoWedge', 'articStaccatissimo'], stress: ['articStress', 'articAccent'],
  unstress: ['articUnstress', 'articTenuto'] };
const FERMATA_GLYPH = { normal: 'fermata', angled: 'fermataShort', square: 'fermataLong' };
/* §10.5: the reference distance from the staff (sp) past which an item is placed anyway with FAR_PLACEMENT; what the one
   placement function sets (§10.1); a finger's pad from its note (G4-D1a-7) */
const FAR = 8;
const PLACED_KINDS = ['articulation', 'ornament', 'fermata', 'tuplet-number', 'tuplet-bracket', 'fingering', 'text'];
const FINGER_PAD = 0.3;
const TEXT_KINDS = ['fingering', 'text'];
const MARK_KINDS = ['articulation', 'ornament', 'fermata', 'tremolo', 'tuplet-number', 'tuplet-bracket'];
/* G4d-1b: the text-like and line-like kinds of the marks attached to systems (below) join them - A20 in full */
TEXT_KINDS.push('dynamic', 'words', 'chord', 'tempo', 'rehearsal', 'jump', 'lyric', 'pedal', 'ottava', 'volta-label');
MARK_KINDS.push('hairpin', 'pedal-line', 'pedal-change', 'ottava-line', 'volta', 'frame', 'lyric-line');
const NOTE_KINDS = ['notehead', 'stem', 'flag', 'beam', 'accidental', 'dot', 'rest', 'ledger', 'paren', 'arpeggio', 'slash'];
/* the mark kinds §21.1's eg.mark.drawn_ratio names that G4d-1a draws, and (G4d-1b) the marks attached to systems: dynamics,
   hairpins (wedge), pedals and their changes, octave lines, voltas (ending), chord names, tempos, rehearsal marks, jumps,
   words, lyrics */
const DRAWN_KINDS = ['articulation', 'ornament', 'fermata', 'fingering', 'gliss', 'arpeggio',
  'dynamic', 'wedge', 'pedal', 'pedal-change', 'ottava', 'ending', 'chord', 'tempo', 'rehearsal', 'jump', 'words', 'lyric'];
/* a pedal change is drawn as a change (A9, §23 M19): the release and the press again (one * and one Ped. naming it) where the pedal
   is a sign, the line's notch where it is a line - never a release alone */
function changeDrawn(objs, p, ref) {
  const sign = !p.mark || p.mark.sign !== false, line = !!(p.mark && p.mark.line) || !sign;
  const cs = objs.filter(o => o.refs.indexOf(ref) >= 0);
  if (sign && !line) return cs.filter(o => o.glyph === 'keyboardPedalUp').length === 1 && cs.filter(o => o.glyph === 'keyboardPedalPed').length === 1;
  return cs.filter(o => o.kind === 'pedal-change' && o.hookLen > 0.5 - TOL).length === 1;
}
/* SMuFL noteheads by shape and fill (G04 §6, §14.6): cross (a plus) has no glyph in the pinned font and stands in as x */
const HEAD_GLYPHS = {
  normal: ['noteheadBlack', 'noteheadHalf', 'noteheadWhole', 'noteheadDoubleWhole'], x: ['noteheadXBlack', 'noteheadXHalf', 'noteheadXWhole', 'noteheadXWhole'],
  cross: ['noteheadXBlack', 'noteheadXHalf', 'noteheadXWhole', 'noteheadXWhole'], 'circle-x': ['noteheadCircleX', 'noteheadCircleX', 'noteheadCircleX', 'noteheadCircleX'],
  diamond: ['noteheadDiamondBlack', 'noteheadDiamondHalf', 'noteheadDiamondWhole', 'noteheadDiamondWhole'],
  triangle: ['noteheadTriangleUpBlack', 'noteheadTriangleUpHalf', 'noteheadTriangleUpWhole', 'noteheadTriangleUpWhole'],
  square: ['noteheadSquareBlack', 'noteheadSquareWhite', 'noteheadSquareWhite', 'noteheadSquareWhite'],
  slash: ['noteheadSlashHorizontalEnds', 'noteheadSlashHorizontalEnds', 'noteheadSlashHorizontalEnds', 'noteheadSlashHorizontalEnds']
};
function headGlyph(type, shape, filled) {
  let k = type === 'whole' ? 2 : (type === 'breve' || type === 'long' || type === 'maxima') ? 3 : type === 'half' ? 1 : 0;
  if (filled === true) k = 0;
  else if (filled === false && k === 0) k = 1;
  return (HEAD_GLYPHS[shape] || HEAD_GLYPHS.normal)[k];
}

function curvesAndMarks(eng, plan, opts, m, C) {
  const set = (k, v) => { m[k] = v; };
  const { pe, pm, objsOf, spaceOf, staffTop, linesOf, laidOut, stemDirOf, offsOf, codes, ids } = C;
  const curves = eng.curves || [];
  const miss = ref => { if (opts.missing) opts.missing.add(ref); };
  const headsById = new Map(eng.objects.filter(o => o.kind === 'notehead').map(o => [o.id, o]));
  const curvesOf = groupBy(curves, c => c.refs[0]);
  const sysStaff = groupBy(eng.objects.filter(o => o.staffKey), o => o.system + '|' + o.staffKey);
  const curveSamples = new Map(curves.map(c => [c, sampleBoxes(c)]));
  /* voice roles (§14.1): the plan's, of the sounding voices; a rest's by the graph's order of every voice of its staff and
     measure (§14.3) */
  const roleOf = new Map();
  (plan.roles || []).forEach(r => Object.keys(r.role || {}).forEach(v => roleOf.set(r.staff + '|' + r.m + '|' + v, r.role[v])));
  const rank = new Map((plan.voices || []).map((v, i) => { const n = parseInt(v.label, 10); return [v.id, [isFinite(n) ? n : 1e6, i]]; }));
  const vm = groupBy(plan.events.filter(e => !e.grace && !e.hidden), e => e.staff + '|' + e.m);
  const restRole = new Map();
  vm.forEach((evs, k) => {
    const vs = [...new Set(evs.map(e => e.voice))];
    if (vs.length < 2) return;
    const r = v => rank.get(v) || [1e6, 1e6];
    vs.sort((a, b) => r(a)[0] - r(b)[0] || r(a)[1] - r(b)[1]).forEach((v, i) => restRole.set(k + '|' + v, i % 2 === 0 ? 'up' : 'down'));
  });
  const voiceRole = e => (e.kind === 'rest' ? restRole.get(e.staff + '|' + e.m + '|' + e.voice) : roleOf.get(e.staff + '|' + e.m + '|' + e.voice)) || null;
  const stemDir = e => stemDirOf.get(e.id) || autoDir(offsOf(e));

  /* ---- ties (§13.1, A5, A22): every tie drawn where its heads are - one curve in one system, two halves across a
     break, one part from the head that is there when the other end is not (an open tie, or outside a close view); each
     drawn end within 0.5 sp of its own head (with its dots, at the start) and nearer it than any other head of its chord,
     a head set past the stem at a second too (G4-L4: no allowance to the chord's front); bowing the way §13.1 says; not
     through a head, stem, flag, dot or accidental of the two notes it joins */
  let tieMiss = 0, tieEnd = 0, endMax = 0, tieDir = 0, tieCross = 0;
  /* the heads of a head's chord: its event's heads on its staff in its system, grace or not as it is */
  const chordOf = h => objsOf(h.event).filter(o => o.kind === 'notehead' && o.system === h.system && o.staffKey === h.staffKey && !!o.grace === !!h.grace);
  /* §13.1 as G4-L4 amends it: two voices - the upper voice's ties up, the lower's down; one note - away from its stem; a
     chord - by the head's place in its own chord (every head, tied or not): the top head's up and the bottom head's down,
     the upper half up and the lower half down, the exact middle of an odd chord away from the stem */
  const tieRule = h => {
    const e = pe.get(h.event);
    if (!e) return null;
    const role = voiceRole(e);
    if (role === 'up') return 'above';
    if (role === 'down') return 'below';
    const away = stemDir(e) === 'up' ? 'below' : 'above';
    const chord = chordOf(h).sort((a, b) => cent(cyOf(a.box)) - cent(cyOf(b.box)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const n = chord.length, k = chord.indexOf(h);
    if (n <= 1 || k < 0 || (n % 2 === 1 && k === (n - 1) / 2)) return away;
    return k < n / 2 ? 'above' : 'below';
  };
  (plan.ties || []).forEach(t => {
    const fh = t.from ? headsById.get(t.from) : null, th = t.to ? headsById.get(t.to) : null;
    const want = fh && th ? (fh.system === th.system ? [['whole', fh.system]] : [['start', fh.system], ['end', th.system]]) : fh ? [['start', fh.system]] : th ? [['end', th.system]] : [];
    const got = (curvesOf.get(t.id) || []).filter(c => c.kind === 'tie');
    if (!(got.length === want.length && want.every(([part, s]) => got.some(c => c.part === part && c.system === s)))) { tieMiss++; miss(t.id); }
    got.forEach(c => {
      const ends = [];
      if ((c.part === 'whole' || c.part === 'start') && fh && fh.system === c.system) ends.push([c.p0, fh, true]);
      if ((c.part === 'whole' || c.part === 'end') && th && th.system === c.system) ends.push([c.p3, th, false]);
      ends.forEach(([p, h, start]) => {
        const f = spaceOf(h);
        /* its own head - at the start with the dots of its row (§13.1: after the dot) and its note's flag where the flag
           reaches that row (a tie on the stem's side of a flagged note starts after the flag, as after a dot) */
        let b = h.box;
        if (start) {
          const cy = cyOf(h.box);
          const after = objsOf(h.event).filter(o => o.system === h.system && o.staffKey === h.staffKey && !!o.grace === !!h.grace &&
            ((o.kind === 'dot' && Math.abs(cyOf(o.box) - cy) <= 0.75 * f) || (o.kind === 'flag' && o.box[1] < cy + 0.75 * f && o.box[3] > cy - 0.75 * f)));
          if (after.length) b = unionBox([b].concat(after.map(o => o.box)));
        }
        const d = pointGap(p, b) / f;
        endMax = Math.max(endMax, d);
        /* nearer its own head than any other head of the chord (G4-L4) */
        const other = chordOf(h).filter(o => o !== h).map(o => pointGap(p, o.box) / f);
        if (d > 0.5 + TOL || other.some(x => x <= d + TOL)) tieEnd++;
      });
      /* the rule of the head the tie leaves (both halves of a tie across a break bow one way), else the head it meets */
      const h = fh || th;
      const rule = h ? tieRule(h) : null;
      if (rule && bulge(c) !== rule) tieDir++;
      /* §13.1: after the dot, before the accidental - the tie crosses nothing its two notes draw */
      const evs = [fh, th].filter(Boolean).map(x => x.event);
      const own = [...new Set(evs)].flatMap(id => objsOf(id)).filter(o => o.system === c.system && o.staffKey === c.staffKey &&
        ['notehead', 'stem', 'flag', 'dot', 'accidental'].indexOf(o.kind) >= 0);
      if (own.some(o => curveCrosses(c, o.box))) tieCross++;
    });
  });
  set('eg.tie.missing', tieMiss);
  set('eg.tie.endpoint_err', tieEnd);
  set('eg.curve.endpoint_err_max', Math.round(endMax * 100) / 100);
  set('eg.tie.dir_err', tieDir);
  set('eg.tie.crossings', tieCross);

  /* ---- slurs (§13.2, A6, A22): the graph's own pair - the first part starts at the from note, the last ends at the to
     note (within 0.6 sp of what the note draws); each end just outside what stands right under it on the slur's side
     (the note's head or stem end, its marks wherever they stand, another voice there, a beam, a tie or shorter slur): 0.1 to 1.25 sp away,
     more by as far as the slur's ends were moved out to clear what lies under it (lift); a slur whose arc crosses a head
     or stem of a note between its
     ends is a hit - at most 1 % of the slurs (eg.curve.hit_ratio), every one named by SLUR_COLLIDES */
  let pair = 0, slurEnd = 0, hits = 0, undiag = 0, slurs = 0, slurParts = 0, slurSide = 0;
  const collides = new Set((codes.get('SLUR_COLLIDES') || []).flatMap(d => d.refs));
  const beams = eng.objects.filter(o => o.kind === 'beam');
  const evBox = (id, s) => unionBox(objsOf(id).filter(o => o.system === s && (o.kind === 'notehead' || o.kind === 'rest' || o.kind === 'stem')).map(o => o.box));
  const drawnAt = id => objsOf(id).find(o => o.kind === 'notehead' || o.kind === 'rest') || null;
  /* §13.2's side: the graph's placement; else a voice's own side where two voices share the staff (§14.1: the upper voice's
     slur above, the lower's below); else below when every note it spans (its voice, from its first note to its last) stems
     up, above when all stem down or they are mixed */
  const voiceNotes = groupBy(plan.events.filter(e => !e.hidden && !(e.grace && e.grace.after)), e => e.voice);
  voiceNotes.forEach(list => list.sort((a, b) => pm.get(a.m).i - pm.get(b.m).i || q(a.at) - q(b.at) || (!!a.grace === !!b.grace ? 0 : a.grace ? -1 : 1) ||
    SG.schema.idNumber(a.id) - SG.schema.idNumber(b.id)));
  const slurRule = s => {
    if (s.placement === 'above' || s.placement === 'below') return s.placement;
    const fe = pe.get(s.from) || pe.get(s.to);
    if (!fe) return null;
    const role = [s.from, s.to].map(id => pe.get(id)).filter(Boolean).map(voiceRole).find(Boolean);
    if (role === 'up') return 'above';
    if (role === 'down') return 'below';
    const seq = voiceNotes.get(fe.voice) || [];
    const a = seq.findIndex(e => e.id === s.from), b = seq.findIndex(e => e.id === s.to);
    const spanned = a >= 0 && b >= a ? seq.slice(a, b + 1) : [s.from, s.to].map(id => pe.get(id)).filter(Boolean);
    const dirs = spanned.filter(e => e.kind !== 'rest' && e.heads.length).map(stemDir);
    return dirs.length && dirs.every(d => d === 'up') ? 'below' : 'above';
  };
  (plan.slurs || []).forEach(s => {
    const got = (curvesOf.get(s.id) || []).filter(c => c.kind === 'slur');
    const fa = s.from ? drawnAt(s.from) : null, ta = s.to ? drawnAt(s.to) : null;
    if (!fa && !ta) { if (got.length) pair++; return; }
    slurs++;
    const start = got.find(c => c.part === 'whole' || c.part === 'start'), end = got.find(c => c.part === 'whole' || c.part === 'end');
    let bad = !got.length;
    if (fa) { const b = evBox(s.from, fa.system); bad = bad || !start || start.system !== fa.system || start.p0[0] < b[0] - 0.6 || start.p0[0] > b[2] + 0.6; }
    if (ta) { const b = evBox(s.to, ta.system); bad = bad || !end || end.system !== ta.system || end.p3[0] < b[0] - 0.6 || end.p3[0] > b[2] + 0.6; }
    if (bad) { pair++; miss(s.id); }
    /* every part its notes call for (§13.2): one curve in one system; across breaks the first half, one middle part for each
       system between, the last half; one half where only one end is laid out - nothing more */
    const wantParts = fa && ta ? (fa.system === ta.system ? [['whole', fa.system]] : [['start', fa.system]].concat(
      eng.systems.filter(y => y.index > fa.system && y.index < ta.system).map(y => ['mid', y.index]), [['end', ta.system]])) : fa ? [['start', fa.system]] : [['end', ta.system]];
    if (got.length !== wantParts.length || !wantParts.every(([part, sy]) => got.filter(c => c.part === part && c.system === sy).length === 1)) { slurParts++; miss(s.id); }
    /* each part bows to the side the rule gives */
    const side = slurRule(s);
    if (side && got.some(c => (bulge(c) || c.side) !== side)) slurSide++;
    [[start, 'p0', s.from, fa], [end, 'p3', s.to, ta]].forEach(([c, k, id, anchor]) => {
      if (!c || !anchor || c.system !== anchor.system || c.staffKey !== anchor.staffKey) return;
      const p = c[k], above = (bulge(c) || c.side) === 'above', f = spaceOf(anchor);
      const x0 = p[0] - 0.1 * f, x1 = p[0] + 0.1 * f;
      const inX = b => b[0] < x1 - EPS && x0 < b[2] - EPS;
      const under = b => (above ? b[3] >= p[1] - TOL : b[1] <= p[1] + TOL);
      /* what stands under the end: the note's own head or stem end, its marks and fingering wherever they stand, another
         voice's notes there, a beam, fingering, a tie or a shorter slur (G4-L5: fingering is placed before slurs; a
         glissando's word after them) */
      const boxes = (sysStaff.get(c.system + '|' + c.staffKey) || []).filter(o => o.kind !== 'text' && under(o.box) &&
        ((inX(o.box) && (o.layer === 'note' || o.kind === 'fingering' || MARK_KINDS.indexOf(o.kind) >= 0)) ||
          (o.event === id && ['articulation', 'ornament', 'fermata', 'tremolo', 'fingering'].indexOf(o.kind) >= 0))).map(o => o.box)
        .concat(curves.filter(q => q !== c && q.system === c.system && q.staffKey === c.staffKey).flatMap(q => curveSamples.get(q)).filter(b => inX(b) && under(b)));
      if (!boxes.length) { slurEnd++; return; }
      const reach = above ? Math.min(...boxes.map(b => b[1])) : Math.max(...boxes.map(b => b[3]));
      const d = (above ? reach - p[1] : p[1] - reach) / f;
      if (d < 0.1 - TOL || d > 1.25 + (c.lift || 0) / f + TOL) slurEnd++;
    });
    let hit = false;
    got.forEach(c => {
      const a = Math.min(c.p0[0], c.p3[0]), b = Math.max(c.p0[0], c.p3[0]);
      const inner = (sysStaff.get(c.system + '|' + c.staffKey) || []).filter(o => (o.kind === 'notehead' || o.kind === 'stem') && o.event !== s.from && o.event !== s.to &&
        cxOf(o.box) > a + 0.5 && cxOf(o.box) < b - 0.5);
      if (inner.some(o => curveCrosses(c, o.box))) hit = true;
    });
    if (hit) { hits++; if (!collides.has(s.id)) undiag++; }
  });
  set('eg.slur.pair_errors', pair);
  set('eg.slur.missing', slurParts);
  set('eg.slur.side_err', slurSide);
  set('eg.slur.endpoint_err', slurEnd);
  set('eg.curve.hits', hits);
  set('eg.curve.slurs', slurs);
  set('eg.curve.hit_ratio', slurs ? Math.round(hits / slurs * 10000) / 10000 : 0);
  set('eg.curve.hits_undiagnosed', undiag);

  /* ---- glissandi (§13.4): from after the first head to before the second - each end at its own head's height (the
     line joins the two pitches; a glissando drawn across staves keeps the height of the staff it leaves) - wavy when the
     graph says so */
  let glissErr = 0;
  (plan.lines || []).filter(l => l.kind === 'gliss').forEach(l => {
    const fh = l.from ? headsById.get(l.from) : null, th = l.to ? headsById.get(l.to) : null;
    (curvesOf.get(l.id) || []).filter(c => c.kind === 'gliss').forEach(c => {
      if (fh && fh.system === c.system && (c.p0[0] < fh.box[2] - TOL || Math.abs(c.p0[1] - cyOf(fh.box)) > 0.25 * spaceOf(fh))) glissErr++;
      if (th && th.system === c.system && (c.p3[0] > th.box[0] + TOL ||
        (th.staffKey === c.staffKey && Math.abs(c.p3[1] - cyOf(th.box)) > 0.25 * spaceOf(th)))) glissErr++;
      if ((c.line === 'wavy') !== (l.line === 'wavy')) glissErr++;
    });
  });
  set('eg.gliss.errors', glissErr);

  /* ---- what the ledger draws is drawn (§21.1 eg.ledger.drawn_missing, eg.mark.drawn_ratio; §23 M23): every tie, slur and
     mark attached to a note the ledger calls drawn, of a note (or measure) this layout draws, is an object or a curve
     naming its ref */
  const named = new Set();
  eng.objects.forEach(o => o.refs.forEach(r => named.add(r)));
  curves.forEach(c => c.refs.forEach(r => named.add(r)));
  const drawnEvents = new Set(eng.objects.filter(o => o.kind === 'notehead' || o.kind === 'rest').map(o => o.event));
  const byId = new Map([...(plan.ties || []), ...(plan.slurs || []), ...(plan.lines || []), ...(plan.marks || []), ...(plan.tempos || []), ...(plan.jumps || []),
    ...(plan.endings || [])].map(x => [x.id, x]));
  /* G4d-1b: when the marks attached to systems are due - a direction, tempo or jump in a measure this layout draws (a word or
     rehearsal mark with text to show), a hairpin or pedal over one, a pedal change in one, an octave line over a note drawn,
     a volta over a measure drawn, a lyric of a note drawn */
  const mIdx = m => (pm.get(m) || { i: -1 }).i;
  const lastI = plan.measures.length - 1;
  const spanLaid = (from, to) => { const a = mIdx(from.m), b = to ? mIdx(to.m) : lastI; return [...laidOut].some(mid => mIdx(mid) >= a && mIdx(mid) <= b); };
  const qT = pos => { const mm = pm.get(pos.m); return mm ? q(String(mm.start)) + q(String(pos.at)) : null; };
  const evTime = new Map(plan.events.map(e => [e.id, qT(e)]));
  const drawnHeadsOn = st => eng.objects.filter(o => (o.kind === 'notehead' || o.kind === 'rest') && !o.grace && o.staffKey === st);
  const sysDue = (en, x) => {
    const k = en.kind;
    if (k === 'dynamic') return laidOut.has(x.m) && (/^[pmfrsz]+$/.test(x.value || '') || !!String(x.value === 'other' || !x.value ? x.text || '' : x.value).trim());
    if (k === 'words' || k === 'rehearsal') return laidOut.has(x.m) && !!String(x.text || '').trim();
    if (k === 'chord' || k === 'tempo' || k === 'jump') return laidOut.has(x.m);
    if (k === 'wedge') return !!x.from && !!x.to && spanLaid(x.from, x.to);
    if (k === 'pedal') return !!x.from && x.visible && spanLaid(x.from, x.to);
    if (k === 'ottava') {
      if (!x.visible || !x.from || !x.to) return false;
      const A = qT(x.from), Z = qT(x.to);
      return (x.covers || []).some(st => drawnHeadsOn(st).some(o => evTime.get(o.event) >= A - 1e-9 && evTime.get(o.event) < Z - 1e-9));
    }
    if (k === 'ending') return spanLaid({ m: x.from }, { m: x.to || x.from });
    return false;
  };
  const markMiss = {};
  DRAWN_KINDS.forEach(k => { markMiss[k] = 0; });
  let drawnMissing = 0;
  plan.ledger.forEach(en => {
    if ((en.status !== 'drawn' && en.status !== 'merged') || (DRAWN_KINDS.indexOf(en.kind) < 0 && en.kind !== 'tie' && en.kind !== 'slur')) return;
    const x = byId.get(en.ref);
    let due;
    if (en.kind === 'fermata' && /#bar\.(left|right)\.fermata$/.test(en.ref)) due = laidOut.has(en.plan);
    else if (en.kind === 'tie' || en.kind === 'gliss') due = !!x && [x.from, x.to].some(h => h && headsById.has(h));
    else if (en.kind === 'slur') due = !!x && [x.from, x.to].some(id => id && drawnEvents.has(id));
    else if (en.kind === 'arpeggio') due = !!x && (x.heads || []).some(h => headsById.has(h));
    else if (en.kind === 'pedal-change') {
      const p = byId.get(en.plan), c = p ? (p.changes || [])[+String(en.ref).split('#change')[1]] : null;
      due = !!p && p.visible && !!c && laidOut.has(c.m);
      if (due && changeDrawn(eng.objects, p, en.ref)) return;
      if (due) { drawnMissing++; markMiss[en.kind]++; miss(en.ref); }
      return;
    } else if (en.kind === 'lyric') {
      const e = pe.get(en.plan), l = e ? e.lyrics[+String(en.ref).split('#lyric')[1]] : null;
      due = drawnEvents.has(en.plan) && !!l && !!String(l.text || '').trim();
    } else if (x && ['dynamic', 'words', 'chord', 'rehearsal', 'tempo', 'jump', 'wedge', 'pedal', 'ottava', 'ending'].indexOf(en.kind) >= 0) due = sysDue(en, x);
    else due = drawnEvents.has(en.plan);
    /* G4d-1b: a mark attached to the system is drawn when an object of its own kind names it (a volta's number alone is not
       the volta, an octave line's dashes alone not its label) */
    if (due && SYS_OBJ[en.kind]) { if (!eng.objects.some(o => o.kind === SYS_OBJ[en.kind] && o.refs.indexOf(en.ref) >= 0)) { drawnMissing++; markMiss[en.kind]++; miss(en.ref); } return; }
    if (!due || named.has(en.ref)) return;
    drawnMissing++;
    if (markMiss[en.kind] !== undefined) markMiss[en.kind]++;
    miss(en.ref);
  });
  set('eg.ledger.drawn_missing', drawnMissing);
  DRAWN_KINDS.forEach(k => set('eg.mark.missing.' + k, markMiss[k]));

  /* ---- marks on a note (§10.2 priority 5): on the side the rule gives - a voice's own side where two share the staff,
     else opposite the stem (a rest's above); an ornament above (the lower voice's below), a fermata above unless
     inverted (or the lower voice's) - and outside the note (beyond the stem's end, on its side); inside to out staccato
     and staccatissimo, tenuto, accent,
     marcato, ornament, fermata; a staccato or tenuto inside the staff in a space, never on a line */
  let sideErr = 0, orderErr = 0, onLine = 0, glyphErr = 0;
  const artOf = o => { const mt = /#art(\d+)/.exec(o.refs[1] || ''), e = pe.get(o.event); return mt && e ? e.arts[+mt[1]] : null; };
  const rankOf = o => (o.kind === 'fermata' ? 5 : o.kind === 'ornament' ? 4 : MARK_RANK[artOf(o)]);
  const noteMarks = eng.objects.filter(o => (o.kind === 'articulation' || o.kind === 'ornament' || o.kind === 'fermata') && o.event && !HORIZONTAL_ARTS[artOf(o)]);
  noteMarks.forEach(o => {
    const e = pe.get(o.event);
    if (!e) { sideErr++; return; }
    const role = voiceRole(e);
    const want = o.kind === 'fermata' ? ((e.fermata && e.fermata.inverted) || role === 'down' ? 'below' : 'above')
      : o.kind === 'ornament' ? (role === 'down' ? 'below' : 'above')
        : role === 'up' ? 'above' : role === 'down' ? 'below' : e.kind === 'rest' || !e.heads.length ? 'above' : stemDir(e) === 'up' ? 'below' : 'above';
    const own = objsOf(e.id).filter(x => x.system === o.system && x.staffKey === o.staffKey && (x.kind === 'notehead' || x.kind === 'rest'));
    if (!own.length) { sideErr++; return; }
    const top = Math.min(...own.map(x => x.box[1])), bot = Math.max(...own.map(x => x.box[3]));
    /* on the stem's side, beyond the stem's end */
    const st = objsOf(e.id).find(x => x.kind === 'stem' && x.system === o.system && x.staffKey === o.staffKey && /#stem$/.test(x.id));
    const stemSide = st && (st.dir === 'up') === (want === 'above');
    if (want === 'above' ? o.box[3] > (stemSide ? st.box[1] : top) + TOL : o.box[1] < (stemSide ? st.box[3] : bot) - TOL) sideErr++;
    const r = rankOf(o);
    if ((r === 0 || r === 1) && o.kind === 'articulation') {
      const f = spaceOf(o), t0 = staffTop.get(o.system + '|' + o.staffKey), last = Math.max(0, (linesOf.get(o.staffKey) || 5) - 1);
      const c = (cyOf(o.box) - t0) / f;
      if (c > -0.25 && c < last + 0.25 && Math.abs((c - 0.5) - Math.round(c - 0.5)) > TOL / f) onLine++;
    }
  });
  /* which side of its note a mark stands on, from where it is */
  const geoSide = o => {
    const own = objsOf(o.event).filter(x => x.system === o.system && x.staffKey === o.staffKey && (x.kind === 'notehead' || x.kind === 'rest'));
    return own.length && cyOf(o.box) < Math.min(...own.map(x => cyOf(x.box))) ? 'above' : 'below';
  };
  groupBy(noteMarks, o => o.event + '|' + o.system + '|' + geoSide(o)).forEach(list => {
    if (list.length < 2) return;
    const above = geoSide(list[0]) === 'above';
    const near = list.slice().sort((a, b) => (above ? b.box[3] - a.box[3] : a.box[1] - b.box[1]));
    for (let i = 1; i < near.length; i++) if (rankOf(near[i]) < rankOf(near[i - 1])) { orderErr++; break; }
  });
  /* a fermata over a bar line: above the top staff, below the bottom one when inverted */
  (plan.measures || []).forEach(me => ['left', 'right'].forEach(side => {
    const b = me.barline && me.barline[side];
    if (!b || b.fermata === undefined || b.fermata === null || !laidOut.has(me.id)) return;
    const o = (ids.get(me.id + '#bar.' + side + '.fermata') || [])[0];
    if (!o) return;
    const inv = !!b.fermata.inverted, st = inv ? plan.staves[plan.staves.length - 1].id : plan.staves[0].id;
    const t0 = staffTop.get(o.system + '|' + st), last = Math.max(0, (linesOf.get(st) || 5) - 1) * spaceOf(o);
    if (o.staffKey !== st || (inv ? o.box[1] < t0 + last - TOL : o.box[3] > t0 + TOL)) sideErr++;
    if (o.glyph !== FERMATA_GLYPH[b.fermata.shape || 'normal'] + (inv ? 'Below' : 'Above')) glyphErr++;
  }));
  /* the glyph the graph asks for (G04 §6, §18.2; the review's RV17-RV19): an articulation's SMuFL glyph for its side (the
     pinned font's stand-in where it lacks one - GLYPH_FALLBACK says so), detached-legato as a staccato and a tenuto, the
     ornament the plan names, a fermata of its shape (normal, angled, square) */
  noteMarks.forEach(o => {
    const e = pe.get(o.event);
    if (!e) return;
    const d = geoSide(o) === 'above' ? 'Above' : 'Below';
    let want;
    if (o.kind === 'fermata') want = [FERMATA_GLYPH[(e.fermata && e.fermata.shape) || 'normal'] + d];
    else if (o.kind === 'ornament') { const mt = /#orn(\d+)/.exec(o.refs[1] || ''), orn = mt ? (e.orn || [])[+mt[1]] : null; want = orn ? [orn.glyph] : []; }
    else {
      const a = artOf(o), part = /\.(\d+)$/.exec(o.id.slice((o.refs[1] || '').length));
      want = (a === 'detached-legato' ? [part && part[1] === '1' ? 'articTenuto' : 'articStaccato'] : (ARTIC_GLYPH[a] || [])).map(g => g + d);
    }
    if (want.indexOf(o.glyph) < 0) glyphErr++;
  });
  set('eg.mark.side_err', sideErr);
  set('eg.mark.glyph_err', glyphErr);
  set('eg.mark.order_err', orderErr);
  set('eg.mark.on_line', onLine);

  /* ---- printed fingering (§10.2 priority 7): the graph's placement, else above on a part's first staff and below on its
     second; outside the heads; a chord's fingers stacked in the order of its heads (the top finger the top note's) */
  let fSide = 0, fOrder = 0;
  const partStaves = groupBy(plan.staves, s => s.part);
  const staffRank = new Map();
  partStaves.forEach(list => list.forEach((s, i) => staffRank.set(s.id, i)));
  const fings = eng.objects.filter(o => o.kind === 'fingering');
  fings.forEach(o => {
    const e = pe.get(o.event), mt = /^(.*)#fing(\d+)$/.exec(o.refs[1] || '');
    const h = e && mt ? e.heads.find(x => x.id === mt[1]) : null, fg = h ? (h.fingering || [])[+mt[2]] : null, ho = h ? headsById.get(h.id) : null;
    if (!fg || !ho) { fSide++; return; }
    const want = fg.placement === 'above' || fg.placement === 'below' ? fg.placement : staffRank.get(ho.staffKey) === 1 ? 'below' : 'above';
    const hs = objsOf(e.id).filter(x => x.kind === 'notehead' && x.staffKey === ho.staffKey && x.system === ho.system);
    const top = Math.min(...hs.map(x => x.box[1])), bot = Math.max(...hs.map(x => x.box[3]));
    if (want === 'above' ? o.box[3] > top + TOL : o.box[1] < bot - TOL) fSide++;
  });
  /* stacked: sorted by their heads top down (then by finger, then by line), each stands no lower than the one before */
  const fKey = o => {
    const mt = /^(.*)#fing(\d+)$/.exec(o.refs[1] || ''), h = mt ? headsById.get(mt[1]) : null;
    const k = /\.(\d+)$/.exec(o.id.slice((o.refs[1] || '').length));
    return [h ? cyOf(h.box) : 0, mt ? +mt[2] : 0, k ? +k[1] : 0];
  };
  const fSideOf = o => { const mt = /^(.*)#fing/.exec(o.refs[1] || ''), h = mt ? headsById.get(mt[1]) : null; return h && cyOf(o.box) < cyOf(h.box) ? 'a' : 'b'; };
  groupBy(fings, o => o.event + '|' + o.system + '|' + o.staffKey + '|' + fSideOf(o)).forEach(list => {
    const sorted = list.slice().sort((a, b) => { const ka = fKey(a), kb = fKey(b); return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2]; });
    for (let i = 1; i < sorted.length; i++) if (sorted[i].box[1] < sorted[i - 1].box[1] - TOL) { fOrder++; break; }
  });
  set('eg.fingering.side_err', fSide);
  set('eg.fingering.order_err', fOrder);
  /* fingering by its notes (G4-L5; §10.2 as amended: ties, tuplets, articulations/ornaments/fermatas/tremolos, then
     fingering, then slurs and glissandi). A finger stands no farther from its note than what must stand between them
     requires: over its own x (a skyline cell, 0.25 sp, either side), the notes of its staff (any voice), the ties, tuplet
     numbers and brackets and the marks, the fingering of its own column stacked inside it (a chord's, another voice's at
     the same time), and the staff itself (fingering stays outside it) - then its pad (0.3 sp from a note, 0.15 between
     stacked fingers). A slur or glissando is never a reason (they come after and clear the fingering), nor a finger of
     another column (the spacing gives each column its fingering's width, §9). eg.fingering.far counts the fingers farther
     than that; 0 is the target. */
  let fFar = 0;
  const colOf = id => { const e = pe.get(id); return e ? e.m + '|' + q(e.at) + '|' + (e.grace ? 'g' : '') : id; };
  fings.forEach(o => {
    const mt = /^(.*)#fing\d+$/.exec(o.refs[1] || ''), ho = mt ? headsById.get(mt[1]) : null;
    if (!ho) return;
    const above = cyOf(o.box) < cyOf(ho.box), f = spaceOf(o);
    const w0 = o.box[0] - 0.25 * f, w1 = o.box[2] + 0.25 * f;
    const inX = b => b[0] < w1 - EPS && w0 < b[2] - EPS;
    const inside = b => (above ? b[1] >= o.box[3] - TOL : b[3] <= o.box[1] + TOL);
    const col = colOf(o.event);
    const boxes = (sysStaff.get(o.system + '|' + o.staffKey) || []).filter(x => x !== o && inX(x.box) && inside(x.box) &&
      (NOTE_KINDS.indexOf(x.kind) >= 0 || MARK_KINDS.indexOf(x.kind) >= 0 || (x.kind === 'fingering' && colOf(x.event) === col))).map(x => x.box)
      .concat(curves.filter(c => c.kind === 'tie' && c.system === o.system && c.staffKey === o.staffKey).flatMap(c => curveSamples.get(c)).filter(b => inX(b) && inside(b)));
    const t0 = staffTop.get(o.system + '|' + o.staffKey), last = t0 + Math.max(0, (linesOf.get(o.staffKey) || 5) - 1) * f;
    const reach = above ? Math.min(t0, ...boxes.map(b => b[1])) : Math.max(last, ...boxes.map(b => b[3]));
    const gap = (above ? reach - o.box[3] : o.box[1] - reach) / f;
    if (gap > FINGER_PAD + TOL) fFar++;
  });
  set('eg.fingering.far', fFar);

  /* ---- §10.5 FAR_PLACEMENT: an item the placement function set more than 8 sp from its staff (its near edge from the staff's
     outer line) is placed anyway and says so. eg.layout.far_placements counts the diagnostics (recorded: lower is better);
     eg.layout.far_undiagnosed counts the items that far with no FAR_PLACEMENT naming them (their id; a tuplet's by the
     tuplet) - 0 */
  const farNamed = new Set((codes.get('FAR_PLACEMENT') || []).flatMap(d => d.refs));
  let farUndiag = 0;
  /* G4d-1b: an item of a row attached to the system is named by its row item - the mark (its first ref or its group), or the
     object it leads (a line after its label, a hyphen after its syllable) */
  const sysNamed = o => [o.id, o.group, o.refs[0], o.id.lastIndexOf('#') > 0 ? o.id.slice(0, o.id.lastIndexOf('#')) : null].some(k => k && farNamed.has(k));
  const nextInPart = new Map();
  (plan.parts || []).forEach(pt => pt.staves.forEach((st, i) => { if (pt.staves[i + 1]) nextInPart.set(st, pt.staves[i + 1]); }));
  /* a mark attached to the system is placed as one item with all its pieces (a label and its line, a tempo's words and note):
     its distance is the nearest of them */
  const sysItem = new Map();
  eng.objects.filter(o => SYS_PLACED.indexOf(o.kind) >= 0 && o.staffKey).forEach(o => {
    const k = o.system + '|' + o.staffKey + '|' + (o.group || o.refs[0]);
    sysItem.set(k, sysItem.has(k) ? unionBox([sysItem.get(k), o.box]) : o.box.slice());
  });
  eng.objects.filter(o => (PLACED_KINDS.indexOf(o.kind) >= 0 || SYS_PLACED.indexOf(o.kind) >= 0) && o.staffKey && staffTop.has(o.system + '|' + o.staffKey)).forEach(o => {
    const f = spaceOf(o), t0 = staffTop.get(o.system + '|' + o.staffKey), last = t0 + Math.max(0, (linesOf.get(o.staffKey) || 5) - 1) * f;
    const bx = SYS_PLACED.indexOf(o.kind) >= 0 ? sysItem.get(o.system + '|' + o.staffKey + '|' + (o.group || o.refs[0])) : o.box;
    let d = Math.max(t0 - bx[3], bx[1] - last, 0) / f;
    /* G4d-1b: a mark between two staves of a part (below the upper one) is as far as it is from the nearer of them */
    const nx = nextInPart.get(o.staffKey), nt = nx ? staffTop.get(o.system + '|' + nx) : undefined;
    if (SYS_PLACED.indexOf(o.kind) >= 0 && bx[1] > last && nt !== undefined) d = Math.min(d, Math.max(nt - bx[3], 0) / f);
    if (d > FAR + TOL && !farNamed.has(o.id) && !(o.kind.indexOf('tuplet') === 0 && farNamed.has(o.refs[0])) && !(SYS_PLACED.indexOf(o.kind) >= 0 && sysNamed(o))) farUndiag++;
  });
  /* the marks at the notes (G4d-1a's count) and the rows attached to systems (G4d-1b: an outer row stands over high notes and
     the rows inside it - recorded apart, each lower is better) */
  const sysRefs = new Set();
  eng.objects.filter(o => SYS_PLACED.indexOf(o.kind) >= 0).forEach(o => [o.id, o.group, o.refs[0]].forEach(k => { if (k) sysRefs.add(k); }));
  const farDiags = codes.get('FAR_PLACEMENT') || [];
  set('eg.layout.far_placements', farDiags.filter(d => !d.refs.some(r => sysRefs.has(r))).length);
  set('eg.layout.far_placements_system', farDiags.filter(d => d.refs.some(r => sysRefs.has(r))).length);
  set('eg.layout.far_undiagnosed', farUndiag);

  /* ---- arpeggios (§6): left of the chord's heads on every staff they reach, over those heads, the arrow where the graph
     points it, a bracket against arpeggiating */
  let arpErr = 0;
  (plan.lines || []).filter(l => l.kind === 'arpeggio').forEach(l => {
    const hs = (l.heads || []).map(h => headsById.get(h)).filter(Boolean);
    if (!hs.length) return;
    const parts = eng.objects.filter(o => o.kind === 'arpeggio' && o.refs[0] === l.id);
    const byStaff = groupBy(hs, h => h.system + '|' + h.staffKey);
    byStaff.forEach(list => {
      const o = parts.find(p => p.system === list[0].system && p.staffKey === list[0].staffKey);
      const f = spaceOf(list[0]);
      if (!o || o.box[2] > Math.min(...list.map(h => h.box[0])) + TOL || o.line[1] > Math.min(...list.map(h => cyOf(h.box))) - 0.5 * f + TOL ||
        o.line[3] < Math.max(...list.map(h => cyOf(h.box))) + 0.5 * f - TOL || !!o.non !== !!l.non) arpErr++;
    });
    if (l.dir === 'up' || l.dir === 'down') {
      const arrows = parts.filter(p => p.dir === l.dir);
      const ys = hs.map(h => cyOf(h.box));
      if (arrows.length !== 1 || (l.dir === 'up' ? arrows[0].box[1] > Math.min(...ys) - 0.5 : arrows[0].box[3] < Math.max(...ys) + 0.5)) arpErr++;
    } else if (parts.some(p => p.dir)) arpErr++;
  });
  set('eg.arpeggio.errors', arpErr);

  /* ---- noteheads (§6, §14.6, A7, A12): the glyph of the shape the graph states (a percussion kit's, else normal), in
     parentheses when the graph says so; accidentals in brackets or parentheses as stated */
  let shapeErr = 0, encl = 0;
  eng.objects.filter(o => o.kind === 'notehead' && !o.grace).forEach(o => {
    const e = pe.get(o.event), h = e && e.heads.find(x => x.id === o.id);
    if (!h) return;
    const shape = (h.notehead && h.notehead.shape) || (h.kit && h.kit.notehead) || 'normal';
    if (o.glyph !== headGlyph(e.type || 'quarter', shape, h.notehead ? h.notehead.filled : undefined)) shapeErr++;
    const parens = objsOf(e.id).filter(x => x.kind === 'paren' && x.refs[1] === h.id && x.system === o.system);
    const want = !!(h.notehead && h.notehead.paren);
    if (want ? !(parens.length === 2 && parens.some(p => p.box[2] <= o.box[0] + TOL) && parens.some(p => p.box[0] >= o.box[2] - TOL)) : parens.length) shapeErr++;
    const accs = objsOf(e.id).filter(x => x.kind === 'accidental' && x.refs[0] === h.id && !x.grace).sort((a, b) => a.box[0] - b.box[0]);
    if (!h.acc || !accs.length) return;
    const first = accs[0].glyph, last = accs[accs.length - 1].glyph;
    const br = first === 'accidentalBracketLeft' && last === 'accidentalBracketRight', pa = first === 'accidentalParensLeft' && last === 'accidentalParensRight';
    if (h.acc.bracket ? !br : h.acc.paren ? !pa : (br || pa)) encl++;
  });
  set('eg.notehead.shape_err', shapeErr);
  set('eg.accidental.enclosure_err', encl);

  /* ---- a whole, half or breve rest off the staff hangs from (sits on) a ledger line of its own (the G4c review M1) */
  let restLedger = 0;
  eng.objects.filter(o => o.kind === 'rest' && o.origin && (o.glyph === 'restWhole' || o.glyph === 'restHalf' || o.glyph === 'restDoubleWhole')).forEach(o => {
    const f = spaceOf(o), t0 = staffTop.get(o.system + '|' + o.staffKey), last = Math.max(0, (linesOf.get(o.staffKey) || 5) - 1);
    const ly = (o.origin[1] - t0) / f;
    const lys = (o.glyph === 'restDoubleWhole' ? [ly, ly - 1] : [ly]).filter(v => Math.abs(v - Math.round(v)) < 0.02 && (v < -0.02 || v > last + 0.02));
    const evs = [o.event].concat(o.merged || []);
    const ledgers = eng.objects.filter(x => x.kind === 'ledger' && x.system === o.system && x.staffKey === o.staffKey && evs.indexOf(x.event) >= 0);
    lys.forEach(v => {
      const y = t0 + v * f;
      if (!ledgers.some(L => Math.abs(cyOf(L.box) - y) <= TOL && L.box[0] <= o.box[0] + TOL && L.box[2] >= o.box[2] - TOL)) restLedger++;
    });
    if (!lys.length && ledgers.length) restLedger++;
  });
  set('eg.rest.ledger_missing', restLedger);

  /* ---- a tuplet number without a bracket stands by its notes (§12.2; the G4c review M2): within 1.5 sp of the nearest
     head, stem, flag, rest or beam of its members */
  let far = 0;
  const tupBy = groupBy(eng.objects.filter(o => o.kind === 'tuplet-number' || o.kind === 'tuplet-bracket'), o => o.refs[0]);
  tupBy.forEach((list, tid) => {
    if (list.some(o => o.kind === 'tuplet-bracket')) return;
    const t = (plan.tuplets || []).find(x => x.id === tid);
    if (!t) return;
    const evs = new Set(t.events);
    list.forEach(n => {
      const mem = (sysStaff.get(n.system + '|' + n.staffKey) || []).filter(o => (o.event && evs.has(o.event) && ['notehead', 'rest', 'stem', 'flag'].indexOf(o.kind) >= 0) ||
        (o.kind === 'beam' && (o.events || []).some(id => evs.has(id))));
      if (!mem.length) return;
      if (Math.min(...mem.map(o => boxGap(n.box, o.box))) / spaceOf(n) > 1.5 + TOL) far++;
    });
  });
  set('eg.tuplet.number_far', far);

  /* ---- A20 for what G4d-1a places: text (fingering, a glissando's word) on nothing - no note element, curve, mark or
     other text; marks on no note element or curve and not on each other (a tuplet's number cuts its own bracket; a
     tremolo crosses its own stem and beam by design) */
  let text = 0, textText = 0, markMark = 0, markNote = 0;
  const isText = o => TEXT_KINDS.indexOf(o.kind) >= 0, isMark = o => MARK_KINDS.indexOf(o.kind) >= 0, isNote = o => NOTE_KINDS.indexOf(o.kind) >= 0;
  const own = (a, b) => (a.kind === 'tremolo' && (b.event === a.event || (b.kind === 'beam' && (b.events || []).indexOf(a.event) >= 0)));
  sysStaff.forEach(list => {
    pairs(list.filter(o => isText(o) || isMark(o) || isNote(o)), (a, b) => {
      /* G4d-1b: the pieces of one mark (a dynamic's letters, a chord name's runs, a tempo's words and note, a rehearsal mark and
         its frame, a volta and its number) stand together by design */
      if (a.group && a.group === b.group) return;
      if (isText(a) && isText(b)) textText++;
      else if (isText(a) || isText(b)) text++;
      else if (isMark(a) && isMark(b)) { if (!((a.kind === 'tuplet-number' || b.kind === 'tuplet-number') && a.refs[0] === b.refs[0])) markMark++; }
      else if (isMark(a) || isMark(b)) { if (!own(a, b) && !own(b, a)) markNote++; }
    });
  });
  curves.forEach(c => {
    (sysStaff.get(c.system + '|' + c.staffKey) || []).forEach(o => {
      if (!isText(o) && !(isMark(o) && o.kind !== 'tuplet-bracket')) return;
      if (curveCrosses(c, o.box)) { if (isText(o)) text++; else markNote++; }
    });
  });
  set('eg.overlap.text', text);
  set('eg.overlap.text_text', textText);
  set('eg.overlap.mark_mark', markMark);
  set('eg.overlap.mark_note', markNote);
  /* §18.3: text is as wide as the table says (the layout reads no other width) */
  set('eg.text.width_err', eng.objects.filter(o => {
    if (o.text === undefined) return false;
    const w = TX.measure(o.text, o.font, o.size).w;
    /* the size is written to 0.01 sp (a staff drawn smaller scales it, G4d-1b's long words): up to 0.005 sp an em apart */
    return Math.abs((o.box[2] - o.box[0]) - w) > TOL + (o.size > 0 ? w / o.size : 0) * 0.005;
  }).length);
  /* every curve lies on the page */
  const page = eng.pages[0];
  set('eg.clip.curves', curves.filter(c => curveSamples.get(c).some(b => b[0] < -EPS || b[1] < -EPS || b[2] > page.w + EPS || b[3] > page.h + EPS)).length);
}


/* ---------------------------------------------------------------- G4d-1b: marks attached to systems, vertical spacing,
   courtesy signs (G04 §10.2 priorities 7-11, §10.4 S2 and S5, §15.3, §15.4; A8-A10, A12 lyrics, A20, A25). Written from G04's
   text with geometry of its own - engrave/sysmarks.js is not read: what G4-D1b fixes (sizes, gaps) is restated here. */
/* the gaps G4-D1b sets: a hairpin 0.5 sp from a dynamic on its line (S5), its axis 0.35 sp above the dynamics' baseline; a
   volta 0.3 sp inside its bar lines; items a row pushes apart 0.4 sp; staves of a part 5.0 sp apart at least, of different
   parts 6.0, their content 1.0 sp apart; systems 6.0 sp line to line, their bands 1.5 sp (§15.3) */
const SYS = { hairpinClear: 0.5, hairpinRise: 0.35, voltaInset: 0.3, apart: 0.4, inPart: 5.0, betweenParts: 6.0, pad: 1.0, system: 6.0, systemPad: 1.5,
  cell: 0.25, staffLine: 0.13, bracketOver: 0.1, bracketOn: 0.15, curveSlack: 0.1 };
/* the text-like and line-like kinds of the marks attached to systems (A20 covers them all) */
const SYS_TEXT = ['dynamic', 'words', 'chord', 'tempo', 'rehearsal', 'jump', 'lyric', 'pedal', 'ottava', 'volta-label'];
const SYS_MARK = ['hairpin', 'pedal-line', 'pedal-change', 'ottava-line', 'volta', 'frame', 'lyric-line'];
const SYS_PLACED = SYS_TEXT.concat(SYS_MARK);
/* the object kind that draws each ledger kind of them (a pedal is any of its pieces; its change is its own rule, changeDrawn) */
const SYS_OBJ = { ending: 'volta', ottava: 'ottava', dynamic: 'dynamic', wedge: 'hairpin', chord: 'chord', tempo: 'tempo', jump: 'jump', words: 'words',
  rehearsal: 'rehearsal', lyric: 'lyric' };
/* the app's chord kinds (App CHORD_KIND; G04 §10.2 priority 10), a flat or sharp in a kind as its sign */
const CHORD_TEXT = { major: '', minor: 'm', augmented: 'aug', diminished: 'dim', dominant: '7', 'major-seventh': 'M7', 'minor-seventh': 'm7',
  'diminished-seventh': 'dim7', 'augmented-seventh': 'aug7', 'half-diminished': 'm7♭5', 'major-minor': 'mM7', 'major-sixth': '6', 'minor-sixth': 'm6',
  'dominant-ninth': '9', 'major-ninth': 'M9', 'minor-ninth': 'm9', 'dominant-11th': '11', 'major-11th': 'M11', 'minor-11th': 'm11', 'dominant-13th': '13',
  'major-13th': 'M13', 'minor-13th': 'm13', 'suspended-second': 'sus2', 'suspended-fourth': 'sus4', power: '5', none: 'N.C.', other: '', pedal: 'ped',
  Neapolitan: 'N', Italian: 'It', French: 'Fr', German: 'Ger', Tristan: 'Tristan' };
const ALTER_TEXT = { '-2': '♭♭', '-1': '♭', 0: '', 1: '♯', 2: '♯♯' };
const JUMP_WORDS = { dacapo: 'D.C.', dalsegno: 'D.S.', fine: 'Fine', tocoda: 'To Coda' };
const OTT_LABEL = { 1: '8va', 2: '15ma', 3: '22ma', '-1': '8vb', '-2': '15mb', '-3': '22mb' };
const OTT_CONT = { 1: '(8)', 2: '(15)', 3: '(22)', '-1': '(8)', '-2': '(15)', '-3': '(22)' };
const DYN_GLYPH = { p: 'dynamicPiano', m: 'dynamicMezzo', f: 'dynamicForte', r: 'dynamicRinforzando', s: 'dynamicSforzando', z: 'dynamicZ' };
const HEAD_OF = { whole: 'noteheadWhole', breve: 'noteheadDoubleWhole', half: 'noteheadHalf' };
const normText = s => String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim();
function chordSpelling(d) {
  const acc = a => ALTER_TEXT[String(a || 0)] || '';
  let s = d.root ? d.root.step + acc(d.root.alter) : '';
  const kind = d.text !== null && d.text !== undefined ? String(d.text) : (CHORD_TEXT[d.chordKind] !== undefined ? CHORD_TEXT[d.chordKind] : '');
  s += kind.replace(/b(?=\d)/g, '♭').replace(/#(?=\d)/g, '♯');
  (d.degrees || []).forEach(g => { s += (g.type === 'subtract' ? 'no' : g.type === 'add' ? 'add' : '') + acc(g.alter) + g.value; });
  if (d.bass) s += '/' + d.bass.step + acc(d.bass.alter);
  s = s.replace(/\s+/g, ' ').trim();
  if (d.chordKind === 'none' && (d.text === null || d.text === undefined)) s = 'N.C.';
  return s;
}

function systemMarks(eng, plan, opts, m, C) {
  const set = (k, v) => { m[k] = v; };
  const { pm, spaceOf, staffTop, linesOf, laidOut, clefIn } = C;
  const objs = eng.objects;
  const sysById = new Map(eng.systems.map(s => [s.index, s]));
  const measOut = new Map(eng.measures.map(x => [x.id, x]));
  const Tnum = s => q(String(s));
  const start = new Map(plan.measures.map(x => [x.id, Tnum(x.start)])), dur = new Map(plan.measures.map(x => [x.id, Tnum(x.dur)]));
  const Tof = pos => (pos && start.has(pos.m) ? start.get(pos.m) + Tnum(pos.at) : null);
  const deferred = new Set(plan.ledger.filter(x => x.status === 'deferred').map(x => x.ref));
  const live = st => !deferred.has(st);
  const partStaves = new Map((plan.parts || []).map(p => [p.id, p.staves.filter(live)]));
  const voiceStaff = new Map((plan.voices || []).map(v => [v.id, v.staff]));
  const drawnRef = new Set(plan.ledger.filter(x => x.status === 'drawn' || x.status === 'merged').map(x => x.ref));
  const sung = new Set((plan.parts || []).filter(p => p.instrument === 'voice' || plan.events.some(e => e.part === p.id && (e.lyrics || []).length)).map(p => p.id));
  const staffOf = (sys, key) => { const s = sysById.get(sys); return s ? s.staves.find(t => t.key === key) : null; };
  const lineY = (sys, key) => { const t = staffOf(sys, key); return t ? { top: t.y, bottom: t.y + t.h } : null; };
  const sysOfM = mid => (measOut.has(mid) ? measOut.get(mid).system : undefined);
  /* the marks by every graph ID they name (one mark may name two: the same dynamic or hairpin stated for both staves) */
  const byRef = new Map();
  objs.filter(o => SYS_PLACED.indexOf(o.kind) >= 0).forEach(o => o.refs.forEach(r => { if (!byRef.has(r)) byRef.set(r, []); byRef.get(r).push(o); }));
  /* the notes a mark lines up with (a whole-measure rest stands in its measure's middle, not at its time) */
  const heads = objs.filter(o => (o.kind === 'notehead' || o.kind === 'rest') && !o.grace && o.event && !o.center);
  const evT = new Map(plan.events.map(e => [e.id, start.get(e.m) + Tnum(e.at)]));
  const pe = C.pe;
  /* the x of a time in a system: at a column its x, between two in proportion, from the measure's start to its first column,
     from its last to the bar line */
  const xOfT = (sys, T) => {
    const ms = eng.measures.filter(x => x.system === sys);
    const M = ms.find(x => T >= start.get(x.id) - 1e-9 && T < start.get(x.id) + dur.get(x.id) - 1e-9) ||
      (ms.length && Math.abs(T - start.get(ms[ms.length - 1].id) - dur.get(ms[ms.length - 1].id)) < 1e-9 ? ms[ms.length - 1] : null);
    if (!M) return null;
    const a = T - start.get(M.id), d = dur.get(M.id), end = M.x + M.w;
    if (Math.abs(a - d) < 1e-9) return end;
    const cols = M.columns.filter(c => c.time).map(c => ({ at: q(c.at), x: c.x }));
    if (!cols.length) return M.x + (end - M.x) * a / (d || 1);
    const hit = cols.find(c => Math.abs(c.at - a) < 1e-9);
    if (hit) return hit.x;
    if (a < cols[0].at) return M.x + (cols[0].x - M.x) * a / (cols[0].at || 1);
    for (let k = 0; k + 1 < cols.length; k++) if (a > cols[k].at && a < cols[k + 1].at) return cols[k].x + (cols[k + 1].x - cols[k].x) * (a - cols[k].at) / (cols[k + 1].at - cols[k].at);
    const L = cols[cols.length - 1];
    return L.x + (end - L.x) * (a - L.at) / ((d - L.at) || 1);
  };
  /* where a mark at T stands on staves: the notes starting there ([left, right]), else the time's x */
  const anchor = (sys, T, staves) => {
    for (const st of staves) {
      const hs = heads.filter(o => o.system === sys && o.staffKey === st && Math.abs(evT.get(o.event) - T) < 1e-9);
      if (hs.length) return [Math.min(...hs.map(o => o.box[0])), Math.max(...hs.map(o => o.box[2]))];
    }
    const x = xOfT(sys, T);
    return x === null ? null : [x, x];
  };
  const endPos = (sys, pos, staves) => {
    if (measOut.has(pos.m) && Math.abs(Tnum(pos.at) - dur.get(pos.m)) < 1e-9) return measOut.get(pos.m).x + measOut.get(pos.m).w;
    const a = anchor(sys, Tof(pos), staves);
    return a ? a[0] : null;
  };
  const baseOf = o => (o.kind === 'hairpin' ? o.line[1] + SYS.hairpinRise * spaceOf(o) : o.kind === 'pedal-line' || o.kind === 'pedal-change' ? o.line[1] : o.origin ? o.origin[1] : null);

  /* ---- the side a dynamic stands on (§10.2 priority 8): its graph staff and placement; a part of several staves between the
     first two unless the graph says otherwise; a sung part above its staff; above a lower staff of a part is between it and the
     one above (one row there) */
  const dynPlace = d => {
    const ps = partStaves.get(d.part) || [];
    if (!ps.length) return null;
    let st = d.staff && ps.indexOf(d.staff) >= 0 ? d.staff : null;
    let side = d.placement === 'above' || d.placement === 'below' ? d.placement : null;
    if (!side) side = sung.has(d.part) && ps.length === 1 ? 'above' : 'below';
    if (!st) st = side === 'above' ? ps[0] : ps[0];
    if (side === 'above' && ps.indexOf(st) > 0) { st = ps[ps.indexOf(st) - 1]; side = 'below'; }
    return { staff: st, side: side, next: side === 'below' && ps.indexOf(st) < ps.length - 1 ? ps[ps.indexOf(st) + 1] : null };
  };
  let dynSide = 0;
  (plan.marks || []).filter(d => d.kind === 'dynamic').forEach(d => {
    const list = (byRef.get(d.id) || []).filter(o => o.kind === 'dynamic');
    if (!list.length) return;
    const r = dynPlace(d);
    if (!r || list.some(o => {
      const L = lineY(o.system, r.staff), N = r.next ? lineY(o.system, r.next) : null;
      if (o.staffKey !== r.staff || !L) return true;
      if (r.side === 'above') return o.box[3] > L.top + TOL;
      return o.box[1] < L.bottom - TOL || (N && o.box[3] > N.top + TOL);
    })) dynSide++;
  });
  set('eg.dynamic.side_err', dynSide);

  /* ---- §10.4 S2: one baseline per system for each kind - the dynamics (a line further out only for one that would meet one
     on the line inside it; hairpins on the first line), the pedal, chord names, octave-line labels, each verse of lyrics */
  let baseErr = 0;
  /* the distinct lines among baselines, each read to within the two roundings of 0.01 sp its glyph origin went through */
  const distinct = vs => {
    const out = [];
    vs.slice().sort((a, b) => a - b).forEach(v => { if (!out.length || v - out[out.length - 1] > TOL) out.push(v); });
    return out;
  };
  groupBy(objs.filter(o => o.kind === 'dynamic' || o.kind === 'hairpin'), o => o.system + '|' + o.staffKey + '|' + o.side).forEach(list => {
    const above = list[0].side === 'above';
    const items = [...groupBy(list, o => (o.kind === 'hairpin' ? o.id : o.refs[0])).values()].map(ps => {
      const bs = distinct(ps.map(baseOf).filter(v => v !== null));
      if (bs.length !== 1) baseErr++;
      return { base: bs[0], x0: Math.min(...ps.map(o => o.box[0])), x1: Math.max(...ps.map(o => o.box[2])), hairpin: ps[0].kind === 'hairpin' };
    });
    const lines = distinct(items.map(it => it.base));
    if (above) lines.reverse();
    items.forEach(it => {
      const k = lines.findIndex(v => Math.abs(v - it.base) <= TOL);
      if (k > 0 && !items.some(o => Math.abs(o.base - lines[k - 1]) <= TOL && it.x0 < o.x1 + 0.2 + TOL && o.x0 < it.x1 + 0.2 + TOL)) baseErr++;
    });
  });
  const oneLine = (kinds, key) => groupBy(objs.filter(o => kinds.indexOf(o.kind) >= 0 && (o.kind !== 'chord' || o.text !== undefined)), key)
    .forEach(list => { baseErr += Math.max(0, distinct(list.map(baseOf).filter(v => v !== null)).length - 1); });
  oneLine(['pedal', 'pedal-line', 'pedal-change'], o => o.system + '|' + o.staffKey);
  oneLine(['chord'], o => o.system + '|' + o.staffKey + '|' + o.side);
  oneLine(['ottava'], o => o.system + '|' + o.staffKey + '|' + o.side);
  oneLine(['lyric'], o => o.system + '|' + o.staffKey + '|' + o.verse);
  set('eg.row.baseline_err', baseErr);

  /* ---- §10.4 S5: a hairpin is level, opens the way its wedge goes (a crescendo from its point, a diminuendo to it), and keeps
     0.5 sp from every dynamic on its line */
  let hLevel = 0, hShape = 0, hClear = 0;
  const wedges = new Map((plan.lines || []).filter(l => l.kind === 'wedge').map(l => [l.id, l]));
  objs.filter(o => o.kind === 'hairpin').forEach(o => {
    if (!o.line || Math.abs(o.line[1] - o.line[3]) > EPS) hLevel++;
    const w = wedges.get(o.refs[0]), e = o.ends || [0, 0];
    const cresc = w && w.wedge !== 'diminuendo';
    const whole = o.id === o.refs[0];
    if (!w || o.wedge !== (cresc ? 'crescendo' : 'diminuendo') || (cresc ? !(e[0] < e[1]) : !(e[0] > e[1])) || (whole && Math.min(e[0], e[1]) > EPS)) hShape++;
    const base = baseOf(o);
    objs.filter(d => d.kind === 'dynamic' && d.system === o.system && d.staffKey === o.staffKey && Math.abs(baseOf(d) - base) <= TOL).forEach(d => {
      const gap = Math.max(d.box[0] - o.box[2], o.box[0] - d.box[2]);
      if (gap < SYS.hairpinClear * spaceOf(o) - TOL) hClear++;
    });
  });
  set('eg.hairpin.level_err', hLevel);
  set('eg.hairpin.shape_err', hShape);
  set('eg.hairpin.clear_err', hClear);

  /* ---- A9: the pedal under its part's lowest staff; down at its press - Ped. by the note, or the line's hook - and up at its
     release (* before it, or the hook); a change drawn as a change: the release and the press again, or the line's notch */
  let pedErr = 0, chErr = 0;
  const pedals = (plan.lines || []).filter(l => l.kind === 'pedal' && l.visible && drawnRef.has(l.id) && l.from);
  pedals.forEach(p => {
    const ps = partStaves.get(p.part) || [];
    const low = ps[ps.length - 1];
    const sign = !p.mark || p.mark.sign !== false, line = !!(p.mark && p.mark.line) || !sign;
    const mine = byRef.get(p.id) || [];
    if (mine.some(o => o.staffKey !== low || (lineY(o.system, low) && o.box[1] < lineY(o.system, low).bottom - TOL))) pedErr++;
    const s0 = sysOfM(p.from.m);
    if (s0 !== undefined) {
      const a = anchor(s0, Tof(p.from), [low].concat(ps));
      const ok = a && (sign ? mine.some(o => o.system === s0 && o.glyph === 'keyboardPedalPed' && o.refs.length === 1 && o.box[0] >= a[0] - 0.8 && o.box[0] <= a[0] + 0.2)
        : mine.some(o => o.system === s0 && o.kind === 'pedal-line' && o.hooks && o.hooks[0] && Math.abs(o.line[0] - a[0]) <= 0.3 + TOL));
      if (!ok) pedErr++;
    }
    /* a release at a measure's start is the end of the measure before (it stands at that bar line) */
    const toM = p.to && q(String(p.to.at)) === 0 && pm.get(p.to.m) && pm.get(p.to.m).i > 0 ? plan.measures[pm.get(p.to.m).i - 1] : null;
    const to = toM ? { m: toM.id, at: toM.dur } : p.to;
    const s1 = to ? sysOfM(to.m) : undefined;
    if (s1 !== undefined) {
      const x = endPos(s1, to, [low].concat(ps));
      const ok = x !== null && (sign && !line ? mine.some(o => o.system === s1 && o.glyph === 'keyboardPedalUp' && o.refs.length === 1 && o.box[2] <= x + TOL && o.box[2] >= x - 2.0)
        : mine.some(o => o.system === s1 && o.kind === 'pedal-line' && o.hooks && o.hooks[1] && o.line[2] <= x + TOL && o.line[2] >= x - 0.8));
      if (!ok) pedErr++;
    }
    (p.changes || []).forEach((c, i) => {
      const s = sysOfM(c.m);
      if (s === undefined) return;
      const ref = p.id + '#change' + i, cx = (anchor(s, Tof(c), [low].concat(ps)) || [null])[0];
      const cs = mine.filter(o => o.refs.indexOf(ref) >= 0);
      let shown, placed;
      if (sign && !line) {
        const up = cs.filter(o => o.glyph === 'keyboardPedalUp'), down = cs.filter(o => o.glyph === 'keyboardPedalPed');
        shown = up.length === 1 && down.length === 1;
        placed = shown && cx !== null && up[0].box[2] <= down[0].box[0] + TOL && down[0].box[0] >= cx - 0.8 && down[0].box[0] <= cx + 0.2;
      } else {
        const n = cs.filter(o => o.kind === 'pedal-change');
        shown = n.length === 1 && n[0].hookLen > 0.5 - TOL;
        placed = shown && cx !== null && Math.abs((n[0].line[0] + n[0].line[2]) / 2 - cx) <= 0.3 + TOL;
      }
      if (!placed) chErr++;
    });
  });
  set('eg.pedal.errors', pedErr);
  set('eg.pedal.change_err', chErr);

  /* ---- A10: an octave line over exactly the notes it moves - per staff and system, from before the first to past the last
     (on to the system's end where it goes on) and over no other note of the staff; labelled 8va, 8vb, 15ma ... where it starts,
     "(8)" where it goes on after a break; above its staff for 8va, 15ma, below for 8vb, 15mb; hooked where it ends */
  let ottExt = 0, ottLab = 0;
  (plan.lines || []).filter(l => l.kind === 'ottava' && l.visible && drawnRef.has(l.id) && l.from && l.to).forEach(o => {
    const A = Tof(o.from), Z = Tof(o.to);
    (o.covers || []).filter(live).forEach(st => {
      const onSt = e => (e.kind === 'rest' ? e.staff === st : e.heads.some(h => (h.staff || e.staff) === st));
      const cov = new Set(plan.events.filter(e => !e.hidden && !e.grace && onSt(e) && evT.get(e.id) >= A - 1e-9 && evT.get(e.id) < Z - 1e-9).map(e => e.id));
      const drawn = heads.filter(h => h.staffKey === st && cov.has(h.event));
      const systems = [...new Set(drawn.map(h => h.system))].sort((a, b) => a - b);
      const firstSys = systems[0], lastSys = systems[systems.length - 1];
      const allSys = [...new Set(plan.events.filter(e => cov.has(e.id)).map(e => sysOfM(e.m)))];
      systems.forEach(s => {
        const labels = (byRef.get(o.id) || []).filter(x => x.kind === 'ottava' && x.system === s && x.staffKey === st);
        const lines = (byRef.get(o.id) || []).filter(x => x.kind === 'ottava-line' && x.system === s && x.staffKey === st);
        if (labels.length !== 1 || lines.length > 1) { ottExt++; ottLab++; return; }
        const lab = labels[0], ln = lines[0];
        const span = [lab.box[0], Math.max(lab.box[2], ln ? ln.line[2] : -Infinity)];
        const here = drawn.filter(h => h.system === s);
        const others = heads.filter(h => h.system === s && h.staffKey === st && !cov.has(h.event));
        const goesOn = allSys.some(x => x === undefined ? false : x > s);
        const sys = sysById.get(s);
        if (here.some(h => h.box[0] < span[0] - TOL || h.box[2] > span[1] + TOL) ||
          others.some(h => h.box[2] > span[0] + TOL && h.box[0] < span[1] - TOL) ||
          (goesOn && span[1] < sys.x + sys.w - 2.0)) ottExt++;
        const L = lineY(s, st);
        const want = s === firstSys && !allSys.some(x => x !== undefined && x < s) ? OTT_LABEL[o.shift] : OTT_CONT[o.shift];
        const sideOk = o.shift > 0 ? lab.box[3] <= L.top + TOL : lab.box[1] >= L.bottom - TOL;
        const hookOk = !ln || !!(ln.hooks && ln.hooks[1]) === (s === lastSys && !goesOn);
        if (lab.text !== want || !sideOk || !hookOk) ottLab++;
      });
    });
  });
  set('eg.ottava.extent_err', ottExt);
  set('eg.ottava.label_err', ottLab);

  /* ---- §23 M20, D-1: the heads drawn at their written pitch - the pitch that sounds, less the octave line over it (a transposing
     part at its written pitch), read from the graph when it is given: the multiset (head, event, measure, written staff step)
     the graph asks for against the one the drawn heads show */
  const want = new Map(), got = new Map();
  const bump = (mp, k) => mp.set(k, (mp.get(k) || 0) + 1);
  const g = opts.graph || null;
  const gParts = g ? g.parts : null;
  const ottOf = [];
  if (g) g.parts.forEach(p => {
    const all = p.staves.map(s => s.id);
    p.spanners.filter(s => s.type === 'ottava' && s.from && s.to).forEach(s => {
      const assumed = !s.staff || !!(s.ext && s.ext['musicxml.ottava'] && s.ext['musicxml.ottava'].staff === 'assumed');
      ottOf.push({ covers: assumed ? all : [s.staff], shift: s.shift, A: Tof(s.from), Z: Tof(s.to) });
    });
  });
  else (plan.lines || []).filter(l => l.kind === 'ottava' && l.from && l.to).forEach(l => ottOf.push({ covers: l.covers || [], shift: l.shift, A: Tof(l.from), Z: Tof(l.to) }));
  const transOf = new Map();
  if (gParts) gParts.forEach(p => { if (p.instrument && p.instrument.transpose) transOf.set(p.id, p.instrument.transpose); });
  const gHead = new Map();
  if (gParts) gParts.forEach(p => p.events.forEach(e => (e.heads || []).forEach(h => gHead.set(h.id, { h: h, part: p.id }))));
  const STEP_I = 'CDEFGAB';
  objs.filter(o => o.kind === 'notehead').forEach(o => {
    const e = pe.get(o.event);
    if (!e) return;
    const ph = e.heads.find(x => x.id === o.id);
    if (!ph || !ph.pitch) return;
    const gh = gHead.get(o.id);
    let p = gh ? gh.h.pitch : ph.pitch;
    if (gh && transOf.has(gh.part)) p = SG.pitch.written(p, transOf.get(gh.part));
    const st = ph.staff || e.staff, T = evT.get(e.id);
    let k = 0;
    ottOf.forEach(x => { if (x.covers.indexOf(st) >= 0 && T >= x.A - 1e-9 && T < x.Z - 1e-9) k = x.shift; });
    const dia = (p.oct - k) * 7 + STEP_I.indexOf(p.step);
    bump(want, [o.id, o.event, e.m, dia].join('|'));
    const clef = clefIn(o.staffKey, e.m, e.at, false);
    const top = staffTop.get(o.system + '|' + o.staffKey), f = spaceOf(o);
    const y = ((o.box[1] + o.box[3]) / 2 - top) / f;
    /* staffY inverted: y = (5 - line) - (dia - ref) / 2 */
    const sign = clef ? clef.sign : 'G';
    const line = sign === 'F' ? (clef.line || 4) : sign === 'C' ? (clef.line || 3) : sign === 'G' ? ((clef && clef.line) || 2) : 2;
    const ref = (sign === 'F' ? 3 * 7 + 3 : sign === 'C' ? 4 * 7 : 4 * 7 + 4) + 7 * ((clef && clef.octave) || 0);
    bump(got, [o.id, o.event, e.m, Math.round(ref + ((5 - line) - y) * 2)].join('|'));
  });
  let wd = 0;
  new Set([...want.keys(), ...got.keys()]).forEach(k => { wd += Math.abs((want.get(k) || 0) - (got.get(k) || 0)); });
  set('eg.event.written_diff', wd);

  /* ---- voltas: a bracket over exactly its bars in each system, 0.3 sp inside their bar lines, open at its start's bar line
     only where it starts, closed at its end only where it ends (and is not left open); its number where it starts */
  let voltaErr = 0;
  (plan.endings || []).forEach(en => {
    const a = pm.get(en.from) ? pm.get(en.from).i : -1, b = pm.get(en.to) ? pm.get(en.to).i : a;
    groupBy(eng.measures.filter(x => pm.get(x.id).i >= a && pm.get(x.id).i <= b), x => x.system).forEach((ms, s) => {
      ms.sort((u, v) => u.x - v.x);
      const vs = (byRef.get(en.id) || []).filter(o => o.kind === 'volta' && o.system === s);
      if (vs.length !== 1) { voltaErr++; return; }
      const v = vs[0], x0 = ms[0].x + SYS.voltaInset, x1 = ms[ms.length - 1].x + ms[ms.length - 1].w - SYS.voltaInset;
      const first = ms[0].id === en.from, closes = ms[ms.length - 1].id === en.to && !en.open;
      const label = first ? normText(en.text || ((en.numbers || []).join(', ') + '.')) : null;
      const lab = (byRef.get(en.id) || []).filter(o => o.kind === 'volta-label' && o.system === s);
      if (Math.abs(v.box[0] - x0) > TOL || Math.abs(v.box[2] - x1) > TOL || !!v.start !== first || !!v.open === closes ||
        (label ? !(lab.length === 1 && lab[0].text === label) : lab.length)) voltaErr++;
    });
  });
  set('eg.volta.extent_err', voltaErr);

  /* ---- §10.5 chord names: left at their note (never pushed left of it, but for one pulled back inside the system's end), in
     order of time and graph order, apart from each other */
  let chordErr = 0;
  const chordIdx = new Map((plan.marks || []).map((d, i) => [d.id, i]));
  groupBy(objs.filter(o => o.kind === 'chord'), o => o.system + '|' + o.staffKey + '|' + o.side).forEach(list => {
    const sys = sysById.get(list[0].system), right = sys.x + sys.w;
    const items = [...groupBy(list, o => o.refs[0]).entries()].map(([id, ps]) => {
      const d = (plan.marks || []).find(x => x.id === id);
      return { d: d, T: Tof(d), x0: Math.min(...ps.map(o => o.box[0])), x1: Math.max(...ps.map(o => o.box[2])) };
    }).sort((a, b) => a.T - b.T || chordIdx.get(a.d.id) - chordIdx.get(b.d.id));
    items.forEach((it, k) => {
      const ps = partStaves.get(it.d.part) || [];
      const a = anchor(list[0].system, it.T, [list[0].staffKey].concat(ps));
      const pulled = Math.abs(it.x1 - right) <= TOL;
      if (a && it.x0 < a[0] - TOL && !pulled) chordErr++;
      if (k && it.x0 < items[k - 1].x1 + SYS.apart - TOL) chordErr++;
    });
  });
  set('eg.chord.order_err', chordErr);

  /* ---- A12: a lyric under its voice's staff, centred on its note (or pushed right of the syllable before it), a hyphen between
     the syllables of a word where they leave room for one */
  let lyStaff = 0, lyPlace = 0;
  const lyrics = objs.filter(o => o.kind === 'lyric');
  lyrics.forEach(o => {
    const e = pe.get(o.refs[0]);
    if (!e) { lyStaff++; return; }
    const st = voiceStaff.get(e.voice) || e.staff, L = lineY(o.system, st);
    if (o.staffKey !== st || !L || o.box[1] < L.bottom - TOL) lyStaff++;
  });
  groupBy(lyrics, o => o.system + '|' + o.staffKey + '|' + o.verse).forEach(list => {
    list.sort((a, b) => a.box[0] - b.box[0]);
    list.forEach((o, k) => {
      const e = pe.get(o.refs[0]);
      const hs = heads.filter(h => h.event === o.refs[0] && h.system === o.system && e && h.staffKey === e.staff);
      if (!hs.length) { lyPlace++; return; }
      const c = (Math.min(...hs.map(h => h.box[0])) + Math.max(...hs.map(h => h.box[2]))) / 2, oc = (o.box[0] + o.box[2]) / 2;
      const pushed = oc > c + TOL && k && Math.abs(o.box[0] - list[k - 1].box[2] - SYS.apart / 2) <= TOL;
      if (Math.abs(oc - c) > TOL && !pushed) lyPlace++;
      const i = +String(o.refs[1]).split('#lyric')[1];
      const ly = e && e.lyrics[i];
      const next = list[k + 1];
      const hyph = objs.some(x => x.kind === 'lyric-line' && x.refs[1] === o.refs[1]);
      if (ly && (ly.syllabic === 'begin' || ly.syllabic === 'middle') && next && next.box[0] - o.box[2] >= 1.0 + TOL && !hyph) lyPlace++;
    });
  });
  set('eg.lyric.staff_err', lyStaff);
  set('eg.lyric.place_err', lyPlace);

  /* ---- §10.2 priority 10: above a staff, inside to out - octave lines, chord names, voltas, tempo and rehearsal marks */
  const RANK = { ottava: 0, 'ottava-line': 0, chord: 1, volta: 2, 'volta-label': 2, tempo: 3, rehearsal: 3, frame: 3 };
  let orderErr = 0;
  groupBy(objs.filter(o => RANK[o.kind] !== undefined && o.side === 'above'), o => o.system + '|' + o.staffKey).forEach(list => {
    for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
      const a = list[i], b = list[j];
      /* a (inner) and b (outer) over the same x: a stands under b */
      if (RANK[a.kind] >= RANK[b.kind] || !(a.box[0] < b.box[2] - EPS && b.box[0] < a.box[2] - EPS)) continue;
      if (a.box[1] < b.box[3] - TOL) orderErr++;
    }
  });
  set('eg.row.order_err', orderErr);

  /* ---- what the marks say is what the graph says: a dynamic's letters (or words), words, chord names, a tempo's words and
     metronome mark, jumps, rehearsal marks, lyrics */
  let content = 0;
  const pieces = id => (byRef.get(id) || []).filter(o => o.text !== undefined || o.glyph).sort((a, b) => a.box[0] - b.box[0] || (a.id < b.id ? -1 : 1));
  const seq = list => list.map(o => (o.text !== undefined ? 't:' + o.text : 'g:' + o.glyph)).join(' ');
  const dynSeq = (value, text) => (/^[pmfrsz]+$/.test(value || '') ? value.split('').map(c => 'g:' + DYN_GLYPH[c]) : [normText(value === 'other' || !value ? text : value)].filter(Boolean).map(t => 't:' + t));
  (plan.marks || []).forEach(d => {
    if (!drawnRef.has(d.id) || !laidOut.has(d.m)) return;
    const ps = pieces(d.id);
    if (d.kind === 'dynamic') {
      const w = dynSeq(d.value, d.text).concat(...(d.more || []).map(x => dynSeq(x.value, x.text)));
      if (seq(ps.filter(o => o.kind === 'dynamic')) !== w.join(' ')) content++;
    } else if (d.kind === 'words' || d.kind === 'rehearsal') {
      const t = normText(d.text);
      if (t && seq(ps.filter(o => o.kind === d.kind)) !== 't:' + t) content++;
    } else if (d.kind === 'chord') {
      const s = ps.map(o => (o.text !== undefined ? o.text : o.glyph === 'accidentalSharp' ? '♯' : o.glyph === 'accidentalFlat' ? '♭' : '?')).join('');
      if (s !== chordSpelling(d)) content++;
    }
  });
  (plan.tempos || []).forEach(t => {
    if (!drawnRef.has(t.id) || !laidOut.has(t.m)) return;
    const ps = pieces(t.id), mk = t.mark || {};
    const texts = ps.filter(o => o.text !== undefined).map(o => o.text);
    const words = normText(mk.text);
    let unit = mk.unit || null, per = mk.perMinute ? q(String(mk.perMinute)) : null;
    if (!unit && !per && t.heading && t.qpm) { unit = 'quarter'; per = q(String(t.qpm)); }
    const w = [];
    if (words) w.push(words);
    if (unit && per) {
      if (mk.parens) w.push('(');
      w.push('= ' + (Math.abs(per - Math.round(per)) < 1e-6 ? String(Math.round(per)) : String(Math.round(per * 100) / 100)) + (mk.parens ? ')' : ''));
    }
    const head = ps.find(o => /^notehead/.test(o.glyph || ''));
    if (texts.join('|') !== w.join('|') || (unit && per ? !head || head.glyph !== (HEAD_OF[unit] || 'noteheadBlack') : !!head)) content++;
  });
  (plan.jumps || []).forEach(j => {
    if (!drawnRef.has(j.id) || !laidOut.has(j.m)) return;
    const ps = pieces(j.id), text = normText(j.text);
    const w = (j.kind === 'segno' || j.kind === 'coda') && !text ? 'g:' + j.kind : 't:' + (text || JUMP_WORDS[j.kind] || '');
    if (seq(ps) !== w) content++;
  });
  lyrics.forEach(o => {
    const e = pe.get(o.refs[0]), i = +String(o.refs[1]).split('#lyric')[1];
    if (!e || !e.lyrics[i] || o.text !== normText(e.lyrics[i].text)) content++;
  });
  set('eg.text.content_err', content);

  /* ---- §15.3, A25: staves and systems (their content) never meet; a part's staves at least 5.0 sp apart (6.0 between parts),
     further only as far as their content needs - 1.0 sp between what reaches down from one and up from the next, one value per
     system (a 0.25 sp cell of the skyline decides what stands over what); systems 6.0 sp line to line at least, their bands
     1.5 sp, no further than that needs */
  let vcol = 0, gapErr = 0, sysGap = 0;
  /* the cells a box covers - widened by a rounding step either side: the layout's boxes before they are rounded to 0.01 sp */
  const cells = b => [Math.floor((b[0] - EPS) / SYS.cell + 1e-9), Math.floor((b[2] + EPS - 1e-9) / SYS.cell)];
  const contentOf = (s, key) => {
    const out = [];
    objs.forEach(o => {
      if (o.system !== s.index || o.staffKey !== key || o.kind === 'barline') return;
      if (o.kind === 'staff') { const t = SYS.staffLine * (o.space || 1) / 2; out.push([o.box[0], o.box[1] + t, o.box[2], o.box[3] - t]); }
      else out.push(o.box);
    });
    /* a curve as the boxes it covers every 0.5 sp - the layout samples it at its own points, so a sample may stand up to 0.1 sp
       off the layout's (CURVE_SLACK) */
    (eng.curves || []).forEach(c => { if (c.system === s.index && c.staffKey === key) sampleBoxes(c).forEach(b => { const x = b.slice(); x.curve = true; out.push(x); }); });
    return out;
  };
  eng.systems.forEach(s => {
    for (let k = 0; k + 1 < s.staves.length; k++) {
      const up = s.staves[k], lo = s.staves[k + 1];
      /* the staff space, read from the staff's height (the system's `space` is rounded to 0.01) */
      const n = (linesOf.get(up.key) || 5) - 1, f = n > 0 && up.h > 0 ? up.h / n : s.space || 1;
      const U = contentOf(s, up.key), D = contentOf(s, lo.key);
      let tight = Infinity;
      U.forEach(a => {
        const ca = cells(a);
        D.forEach(b => {
          const cb = cells(b);
          if (ca[0] > cb[1] || cb[0] > ca[1]) return;
          const d = b[1] - a[3];
          tight = Math.min(tight, d);
          if (a[0] < b[2] - EPS && b[0] < a[2] - EPS && d < SYS.pad * f - (a.curve || b.curve ? SYS.curveSlack : TOL)) vcol++;
        });
      });
      const pu = (plan.staves.find(x => x.id === up.key) || {}).part, pl = (plan.staves.find(x => x.id === lo.key) || {}).part;
      const min = (pu === pl ? SYS.inPart : SYS.betweenParts) * f;
      const gap = lo.y - (up.y + up.h);
      if (gap < min - TOL || (gap > min + TOL && !(tight <= SYS.pad * f + 0.1))) gapErr++;
    }
  });
  for (let i = 1; i < eng.systems.length; i++) {
    const a = eng.systems[i - 1], b = eng.systems[i];
    const la = a.staves[a.staves.length - 1];
    const lines = b.staves[0].y - (la.y + la.h), band = b.box[1] - a.box[3];
    if (lines < SYS.system - TOL || band < SYS.systemPad - TOL || (lines > SYS.system + TOL && band > SYS.systemPad + TOL)) sysGap++;
  }
  set('eg.skyline.vertical_collisions', vcol);
  set('eg.staff.gap_err', gapErr);
  set('eg.system.gap_err', sysGap);

  /* ---- §15.4: a system before a key or time change ends with the courtesy signature (key and meter as the next system's head
     shows them, after its last bar line), before a clef change with the small clef before its last bar line */
  let cour = 0;
  const liveStaves = plan.staves.filter(s => live(s.id));
  const keysSorted = (plan.keys || []).slice().sort((a, b) => pm.get(a.m).i - pm.get(b.m).i || q(a.at) - q(b.at));
  const keyBefore = mid => { let cur = null; keysSorted.forEach(k => { if (pm.get(k.m).i < pm.get(mid).i) cur = k; }); return cur; };
  for (let i = 0; i + 1 < eng.systems.length; i++) {
    const s = eng.systems[i], lastM = s.measures[s.measures.length - 1], nextM = eng.systems[i + 1].measures[0];
    const inLast = objs.filter(o => o.system === s.index && o.measure === lastM);
    const kc = keysSorted.find(k => k.m === nextM && q(k.at) === 0 && !k.hidden);
    const kb = keyBefore(nextM);
    if (kc && (kb && !kb.hidden ? kb.fifths : 0) !== kc.fifths) liveStaves.forEach(st => {
      const c = clefIn(st.id, nextM, '0', false);
      if (c && (c.sign === 'percussion' || c.sign === 'TAB')) return;
      const o = kb && !kb.hidden ? kb.fifths : 0, n = kc.fifths;
      const cancel = !o ? 0 : Math.sign(o) === Math.sign(n) ? Math.max(0, Math.abs(o) - Math.abs(n)) : Math.abs(o);
      const ks = inLast.filter(x => x.kind === 'keysig' && x.courtesy && x.staffKey === st.id && x.refs[0] === kc.id);
      if (ks.length !== Math.abs(n) + cancel) cour++;
    });
    const mc = (plan.meters || []).find(x => x.m === nextM && !x.hidden);
    if (mc) liveStaves.forEach(st => { if (!inLast.some(x => x.kind === 'timesig' && x.courtesy && x.staffKey === st.id && x.refs[0] === mc.id)) cour++; });
    (plan.clefs || []).filter(c => c.m === nextM && q(c.at) === 0 && live(c.staff) && c.sign !== 'none').forEach(c => {
      const b = clefIn(c.staff, nextM, '0', true);
      if (b && b.sign === c.sign && (b.line || 0) === (c.line || 0) && (b.octave || 0) === (c.octave || 0)) return;
      if (!inLast.some(x => x.kind === 'clef' && x.id === c.id && x.staffKey === c.staff)) cour++;
    });
  }
  set('eg.courtesy.missing', cour);

  /* ---- the G4d-1a review R5: an editorial accidental's square brackets as tall as the accidental they enclose (0.1 sp beyond
     it at least), their ends off the staff lines */
  let brErr = 0;
  objs.filter(o => o.glyph === 'accidentalBracketLeft' || o.glyph === 'accidentalBracketRight').forEach(o => {
    const inner = objs.filter(x => x.kind === 'accidental' && x.refs[0] === o.refs[0] && x.system === o.system && x.glyph && !/Bracket/.test(x.glyph));
    if (!inner.length) { brErr++; return; }
    const f = spaceOf(o), top = Math.min(...inner.map(x => x.box[1])), bot = Math.max(...inner.map(x => x.box[3]));
    const t0 = staffTop.get(o.system + '|' + o.staffKey), n = (linesOf.get(o.staffKey) || 5) - 1;
    const onLine = y => { for (let k = 0; k <= n; k++) if (Math.abs(y - (t0 + k * f)) < SYS.bracketOn * f - EPS) return true; return false; };
    if (o.box[1] > top - SYS.bracketOver * f + TOL || o.box[3] < bot + SYS.bracketOver * f - TOL || onLine(o.box[1]) || onLine(o.box[3])) brErr++;
  });
  set('eg.accidental.bracket_err', brErr);
}

/* the metrics whose target is 0 (all but the maximum and the recorded count of smaller staves) */
const MAXIMA = { 'eg.beam.slope_max': MAX_SLOPE, 'eg.curve.endpoint_err_max': 0.5, 'eg.curve.hit_ratio': 0.01 };
/* recorded, not zero: systems drawn smaller; the slurs that cross a note between their ends (each diagnosed, at most 1 %
   of the slurs - eg.curve.hit_ratio, over a suite in bench.js) and the slurs drawn; the items placed more than 8 sp from
   their staff (§10.5 FAR_PLACEMENT, §21.2: recorded - each one named, eg.layout.far_undiagnosed) */
const RECORDED = ['eg.system.scaled', 'eg.curve.hits', 'eg.curve.slurs', 'eg.layout.far_placements', 'eg.layout.far_placements_system'];

module.exports = { l2, EPS, TOL, MAXIMA, RECORDED, ACC_VS, DOT_VS, REST_VS, STEM_KINDS, DRAWN_KINDS, staffY, autoDir, sampleBoxes, bulge };
