/* ============================================================================
   TD16: automatic 8va / 8vb (15ma / 15mb) for ARRANGED output (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12, "TD16").

   addOttava(graph, opts?) -> { graph, changed, fallback, spans, report, issues }

   An arranged graph (the G9 realizer's output, or the legacy engine's projected notes) has notes far above or below the staff
   that print on many ledger lines. This puts an ottava spanner over them. The graph keeps the SOUNDING pitch; the spanner
   only makes the engraver print the note an octave (two for 15ma) away (engrave A10; scoregraph/pitch.js displayOctave), and
   playback keeps reading the sounding pitch (MX-1). Nothing about a note changes: not its pitch, onset, duration, staff, voice,
   fingering or tie.

   How it is safe: it is a G3 pass in the sense of scoregraph/pro.js, and runs through `professionalize` with this one pass, so
   scoregraph/pro-critic.js compares the graph's fingerprint before and after (every component but 'ottava' must be equal:
   sounding notes, onsets, places, spelling, marks, pedal ...) and the validator must find no new ERROR or notation warning
   (W-OTTAVA-OVERLAP included); anything else gives the INPUT graph back (`fallback: true`). It does not use G3's permission
   table on purpose: an arranged graph is `generated`, which G3 never rewrites, and an ottava mark is the one thing we add.

   The rule (all lengths in whole notes, as the graph counts; ledger lines are counted on the note's sounding pitch against the
   clef of its staff at that onset - treble G or bass F only; a staff with another clef is left alone):

     HIGH      a note is "high" on a staff when it needs 2 or more ledger lines on one side (2: C6 or above on a treble staff;
               E2 above and below the bass staff's mirror likewise), SEED when it needs 3 or more (E6; G4 on a bass staff).
     A RUN     a stretch of onsets of ONE staff whose groups (all notes of that staff at one onset) are high, allowing
               a gap of at most BRIDGE (1/2 = two quarter beats) between the end of one high group and the next high one,
               and any group between them only if it would still be readable an octave away (the "fit" test below).
     KEPT      a run gets a line when it holds a SEED and has at least two onsets, or a note that needs 4 or more
               ledger lines (a lone note needs the 4); or, with no seed, when the run lasts at least SUSTAIN (1 = four
               quarter beats) with at least two onsets (a passage sitting on 2 lines for a bar).
     SHIFT     8va / 8vb (one octave) unless a note in the run would still need 3 ledger lines after it; then 15ma / 15mb.
     FIT       after the shift, a high note may need at most 2 ledger lines (it is far from the staff, not the staff's
               other end), and any other note in the span at most 1: a note that would drop to a worse spot stops the run.
     THE LINE  starts at the first onset of the run and ends where its last group ends, or where the next note of the
               staff starts if that is earlier (so the line never covers a note it was not built for). Every note of the
               staff that starts inside it is covered: the engraver moves by onset and staff.

   Both directions (8va over a staff and 8vb under it) are done, on both staves. A note high on the treble staff at the
   bottom or the bass staff at the top gets the same treatment; a clef change is the other, older answer for those, and is
   not made here.

   Deterministic (no clock, no randomness, no id order), idempotent (a staff that already has an ottava line is not touched, so
   the second run finds nothing to add), and the output of a graph with nothing to do is the graph itself.
   ========================================================================== */
/* G9e-lite: also a browser <script> (after scoregraph/rational.js, ops.js and pro.js; global root.PPPRealizeModules.ottava). Node: unchanged. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    const path = require('path');
    const SGDIR = path.resolve(__dirname, '..', 'scoregraph');
    module.exports = factory(require(path.join(SGDIR, 'rational.js')), require(path.join(SGDIR, 'ops.js')), require(path.join(SGDIR, 'pro.js')));
  } else {
    const SG = root.PPPScoreGraphModules || {};
    const M = root.PPPRealizeModules = root.PPPRealizeModules || {};
    M.ottava = factory(SG.rational, SG.ops, SG.pro);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, O, PRO) {
'use strict';

/* the named threshold constants (see the header); a caller (or a test) may override any of them through opts.rule */
const OTTAVA_RULE = Object.freeze({
  seedLines: 3,          /* a note this many ledger lines off a staff starts a line */
  highLines: 2,          /* and one this many joins a line that is already there, or makes one that lasts */
  loneLines: 4,          /* a line over a single onset needs a note at least this far out */
  sustain: '1',          /* whole notes: a passage of high notes with no seed lasts this long to get a line (four quarters) */
  bridge: '1/2',         /* whole notes: the largest gap between two high groups a line runs across (two quarters) */
  keepHigh: 2,           /* after the shift a high note needs at most this many ledger lines */
  keepOther: 1,          /* and any other note it covers at most this many, on either side */
  maxShift: 2            /* octaves: 1 = 8va/8vb, 2 = also 15ma/15mb */
});

const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
/* the diatonic index (octave * 7 + step) of the top and bottom staff lines: treble F5 / E4, bass A3 / G2 */
const CLEF_LINES = { G: { top: 38, bottom: 30, line: 2 }, F: { top: 26, bottom: 18, line: 4 } };

const linesUp = (idx, c) => idx > c.top ? Math.floor((idx - c.top) / 2) : 0;
const linesDown = (idx, c) => idx < c.bottom ? Math.floor((c.bottom - idx) / 2) : 0;
const linesAny = (idx, c) => Math.max(linesUp(idx, c), linesDown(idx, c));

/* ---- the graph, read as the rule needs it: per staff, the onset groups in time order ---- */
function readPart(g, part, rule) {
  const measures = g.timeline.measures;
  const mIdx = new Map(measures.map((m, i) => [m.id, i]));
  const mStart = []; let acc = R.ZERO;
  measures.forEach(m => { mStart.push(acc); acc = R.add(acc, R.parse(m.dur)); });
  const absOf = (m, at) => R.add(mStart[mIdx.get(m)], R.parse(at));

  /* the clef of a staff at a position: the last clef at or before it; a staff whose clefs are not all plain G (line 2) or F (line 4)
     is skipped, as is one that already carries an ottava line */
  const staffInfo = new Map();
  part.staves.forEach(st => {
    const own = part.clefs.filter(c => c.staff === st.id).map(c => ({ c: c, t: absOf(c.m, c.at) }))
      .sort((a, b) => R.cmp(a.t, b.t));
    const plain = own.length > 0 && own.every(x => CLEF_LINES[x.c.sign] && !x.c.octave && (x.c.line === undefined || x.c.line === CLEF_LINES[x.c.sign].line));
    const hasOttava = part.spanners.some(s => s.type === 'ottava' && (!s.staff || s.staff === st.id));
    staffInfo.set(st.id, { skip: !plain || hasOttava, clefs: own });
  });
  const clefAt = (staffId, t) => {
    const own = staffInfo.get(staffId).clefs;
    let cur = own[0].c;
    for (const x of own) { if (R.le(x.t, t)) cur = x.c; else break; }
    return CLEF_LINES[cur.sign];
  };

  const byStaff = new Map();
  part.events.forEach(e => {
    if (e.kind !== 'note' || e.grace || !e.heads) return;
    const t = absOf(e.m, e.at), end = R.add(t, R.parse(e.dur));
    e.heads.forEach(h => {
      if (!h.pitch) return;
      const sid = h.staff || e.staff;
      const info = staffInfo.get(sid);
      if (!info || info.skip) return;
      if (!byStaff.has(sid)) byStaff.set(sid, new Map());
      const groups = byStaff.get(sid), key = R.format(t);
      let grp = groups.get(key);
      if (!grp) { grp = { t: t, m: e.m, at: e.at, end: end, clef: clefAt(sid, t), idx: [] }; groups.set(key, grp); }
      if (R.gt(end, grp.end)) grp.end = end;
      grp.idx.push(h.pitch.oct * 7 + STEP_INDEX[h.pitch.step]);
    });
  });
  const out = [];
  Array.from(byStaff.keys()).sort().forEach(sid => {
    const groups = Array.from(byStaff.get(sid).values()).sort((a, b) => R.cmp(a.t, b.t));
    out.push({ staff: sid, groups: groups });
  });
  return { staves: out, mStart: mStart, measures: measures };
}

/* ---- the rule ---- */
/* lines of the group's worst note in direction dir (+1 above the staff, -1 below) at its sounding pitch */
const groupLines = (grp, dir) => Math.max.apply(null, grp.idx.map(i => dir > 0 ? linesUp(i, grp.clef) : linesDown(i, grp.clef)));
/* the group moved k octaves toward the staff (dir +1: down, for an 8va): does it read well there? */
function fits(grp, dir, k, rule) {
  return grp.idx.every(i => {
    const was = dir > 0 ? linesUp(i, grp.clef) : linesDown(i, grp.clef);
    const now = linesAny(i - dir * 7 * k, grp.clef);
    return now <= (was >= rule.highLines ? rule.keepHigh : rule.keepOther);
  });
}

/* the runs of one direction at one shift over the groups still free: [{ from, to }] as group indices */
function runsOf(groups, avail, dir, k, rule, needsMore) {
  const runs = [], bridge = R.parse(rule.bridge), sustain = R.parse(rule.sustain);
  const highOk = i => avail[i] && groupLines(groups[i], dir) >= rule.highLines && fits(groups[i], dir, k, rule);
  const between = (a, b) => { for (let i = a + 1; i < b; i++) if (!avail[i] || !fits(groups[i], dir, k, rule)) return false; return true; };
  for (let i = 0; i < groups.length; i++) {
    if (!highOk(i)) continue;
    let last = i, endT = groups[i].end;
    for (let j = i + 1; j < groups.length; j++) {
      if (!avail[j] || !fits(groups[j], dir, k, rule)) break;           /* a group that cannot go there ends the search */
      if (R.gt(groups[j].t, R.add(endT, bridge))) break;                 /* nothing high within reach */
      if (!highOk(j)) continue;
      if (!between(last, j)) break;
      last = j; if (R.gt(groups[j].end, endT)) endT = groups[j].end;
    }
    const gs = groups.slice(i, last + 1);
    const lines = Math.max.apply(null, gs.map(x => groupLines(x, dir)));
    const dur = R.sub(endT, groups[i].t);
    const keep = (lines >= rule.seedLines && (last > i || lines >= rule.loneLines)) ||
      (last > i && R.ge(dur, sustain));
    if (keep && (!needsMore || gs.some(x => needsMore(x)))) runs.push({ from: i, to: last, lines: lines, k: k, dir: dir });
    i = last;                                                            /* the run's groups belong to it; a discarded run's groups are not retried */
  }
  return runs;
}

/* the spans of one staff: 15ma / 15mb runs first (those with a note that an 8va would leave on 3 or more lines),
   then 8va / 8vb on what is left; up before down; never two on one group */
function spansOfStaff(groups, rule) {
  const avail = groups.map(() => true), spans = [];
  const take = runs => runs.forEach(r => {
    for (let i = r.from; i <= r.to; i++) avail[i] = false;
    spans.push(r);
  });
  const keepHigh = rule.keepHigh;
  const shifts = [];
  for (let k = Math.min(2, rule.maxShift); k >= 1; k--) shifts.push(k);
  shifts.forEach(k => [1, -1].forEach(dir => {
    /* a group needs a bigger shift when, moved one octave, one of its high notes is still past the limit */
    const needsMore = k > 1 ? (x => x.idx.some(i => (dir > 0 ? linesUp(i, x.clef) : linesDown(i, x.clef)) >= rule.highLines &&
      linesAny(i - dir * 7 * (k - 1), x.clef) > keepHigh)) : null;
    take(runsOf(groups, avail, dir, k, rule, needsMore));
  }));
  return spans;
}

/* runs -> spanner data: [{ staff, shift, from: {m, at}, to: {m, at}, onsets, lines }] */
function spansOfPart(g, part, rule) {
  const info = readPart(g, part, rule);
  const posOf = t => {
    /* the (measure, offset) of an absolute time: inside a measure, the later of two that touch, unless it is the piece's end */
    const ms = info.measures;
    for (let i = 0; i < ms.length; i++) {
      const len = R.parse(ms[i].dur), rel = R.sub(t, info.mStart[i]);
      if (R.lt(rel, len) || i === ms.length - 1) return { m: ms[i].id, at: R.format(rel) };
    }
    return null;
  };
  const out = [];
  info.staves.forEach(s => {
    const spans = spansOfStaff(s.groups, rule);
    spans.forEach(r => {
      const first = s.groups[r.from], last = s.groups[r.to];
      const next = s.groups[r.to + 1];
      /* the line stops where the last group ends, or where the next note starts if that comes first */
      const to = next && R.lt(next.t, last.end) ? next.t : last.end;
      out.push({ staff: s.staff, shift: r.dir * r.k, from: { m: first.m, at: first.at }, toT: to, toLast: { m: last.m }, fromT: first.t,
        onsets: r.to - r.from + 1, lines: r.lines, posOf: posOf });
    });
  });
  /* a stable order: by staff, then start */
  out.sort((a, b) => (a.staff < b.staff ? -1 : a.staff > b.staff ? 1 : R.cmp(a.fromT, b.fromT)));
  return { spans: out, info: info };
}

/* the end position of a span: in the measure of its last note when the line ends there (an end that touches the barline stays
   at the measure's length, `at` = its length), else in the measure the end falls in */
function endOf(span, info) {
  const idx = info.measures.findIndex(m => m.id === span.toLast.m);
  const len = R.parse(info.measures[idx].dur), rel = R.sub(span.toT, info.mStart[idx]);
  if (R.le(rel, len) && R.gt(rel, R.ZERO)) return { m: info.measures[idx].id, at: R.format(rel) };
  return span.posOf(span.toT);
}

function makePass(rule, sink) {
  return Object.freeze({
    name: 'ottava',
    may: ['ottava'],
    run(g, ctx) {
      sink.length = 0;                                                   /* professionalize may run a pass twice */
      const res = O.edit(g, d => {
        g.parts.forEach((gpart, pi) => {
          const part = d.doc.parts[pi];
          const { spans, info } = spansOfPart(g, gpart, rule);
          spans.forEach(s => {
            const to = endOf(s, info);
            d.addSpanner(part, { type: 'ottava', staff: s.staff, shift: s.shift, from: s.from, to: to, prov: { src: d.source() } });
            sink.push({ part: gpart.id, staff: s.staff, shift: s.shift, from: s.from, to: to, onsets: s.onsets, lines: s.lines });
          });
        });
      }, { validate: false, source: ctx.source });
      return { graph: res.graph, idMap: res.idMap, changes: sink.map(s => ({ pass: 'ottava', kind: 'add', ids: [], m: s.from.m })) };
    }
  });
}

/* graph -> { graph, changed, fallback, spans, report, issues }. `issues` is the validator's issues of the result graph (null when the result is the input graph). `opts.rule` overrides any of OTTAVA_RULE's constants. */
function addOttava(g, opts) {
  opts = opts || {};
  const rule = Object.assign({}, OTTAVA_RULE, opts.rule || {});
  const spans = [];
  const r = PRO.professionalize(g, { mode: 'rewrite', passList: [makePass(rule, spans)] });
  const changed = r.graph !== g;
  return { graph: r.graph, changed: changed, fallback: !!r.report.fallback, spans: changed ? spans : [], report: r.report, issues: r.issues || null };
}

return { addOttava, OTTAVA_RULE, CLEF_LINES };
});
