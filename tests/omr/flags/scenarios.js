/* The scenarios of omr/flags.js (G12-3): one case for every signal, built so that the signal fires on one named bar and on no other, and the same music
   without the fault, where it does not fire. The mutation suite runs the same cases against copies of the module with one line broken. */
'use strict';
const L = require('./lib.js');
const { n, r, gap, measureRest, doc, plainBars, graphOf, clone, only } = L;

const bar2 = o => ({ 2: o });
const quarters = (names, q) => names.map(p => n(p, q === undefined ? 1 : q));
const evalAt = s => { const m = /^(\d+)(?:\/(\d+))?$/.exec(s); return +m[1] / (m[2] ? +m[2] : 1); };
/* a graph with one event of bar `i` (0-based) in the right hand tweaked */
async function tweaked(bars, fn, opts) {
  const g = clone(await graphOf(doc(bars, opts)));
  const staff = g.parts[0].staves[0].id;
  const evs = i => g.parts[0].events.filter(e => e.m === g.timeline.measures[i].id && e.staff === staff).sort((a, b) => evalAt(a.at) - evalAt(b.at));
  fn(g, evs);
  return g;
}

/* ---- the case table. build(): {graph, opts}; bar: the 1-based bar(s) the signal must fire on (and no other bar is suspect); code: the signal */
const CASES = [
  { id: 'fill-short: three quarters in a bar of four', code: 'fill-short', bar: 2, build: async () => ({ graph: await graphOf(doc(plainBars(4, bar2({ rh: quarters(['C5', 'D5', 'E5']) })))) }) },
  { id: 'fill-short: a hole in the middle (a voice leaves time uncovered)', code: 'fill-short', bar: 3, build: async () => ({ graph: await graphOf(doc(plainBars(4, { 3: { rh: [n('C5', 1), gap(1), n('E5', 1), n('F5', 1)] } }))) }) },
  { id: 'fill-short: the left hand ends early', code: 'fill-short', bar: 2, build: async () => ({ graph: await graphOf(doc(plainBars(4, bar2({ lh: [n('C3', 2), n('G3', 1)] })))) }) },
  { id: 'fill-over: five quarters in a bar of four', code: 'fill-over', bar: 3, build: async () => ({ graph: await graphOf(doc(plainBars(4, { 3: { rh: quarters(['C5', 'D5', 'E5', 'F5', 'G5']) } }))) }) },
  { id: 'fill-over: a voice runs past the bar line although the bar says it is 4/4', code: 'fill-over', bar: 2,
    build: async () => ({ graph: await tweaked(plainBars(3), (g, evs) => { evs(1)[3].dur = '1/2'; }) }) },
  { id: 'fill-over: the bar itself is longer than its metre (what the importer makes of too many notes)', code: 'fill-over', bar: 2,
    build: async () => ({ graph: await tweaked(plainBars(3), g => { g.timeline.measures[1].dur = '5/4'; }) }) },
  { id: 'fill-overlap: a note starts before the one before it has ended', code: 'fill-overlap', bar: 2,
    build: async () => ({ graph: await tweaked(plainBars(3), (g, evs) => { evs(1)[1].at = '1/8'; }) }) },
  { id: 'empty-staff: the left hand has nothing at all in a bar', code: 'empty-staff', bar: 3, build: async () => ({ graph: await graphOf(doc(plainBars(4, { 3: { lh: null } }))) }) },
  { id: 'many-voices: three voices on the right hand', code: 'many-voices', bar: 2,
    build: async () => ({ graph: await graphOf(doc(plainBars(3, bar2({ rh2: quarters(['A4', 'B4', 'C5', 'D5']), rh3: quarters(['E4', 'F4', 'G4', 'A4']) })))) }) },
  { id: 'tuplet: a bracket that holds two thirds of a beat', code: 'tuplet', bar: 2,
    build: async () => ({ graph: await tweaked(plainBars(3, bar2({ rh: [n('C5', 1 / 3, { tuplet: 'start' }), n('D5', 1 / 3, { tuplet: 'mid' }), n('E5', 1 / 3, { tuplet: 'stop' }), n('C5', 1), n('D5', 1), n('E5', 1)] })),
      g => { g.parts[0].spanners.filter(s => s.type === 'tuplet')[0].events.pop(); }) }) },
  { id: 'value: a note drawn as a half that lasts a quarter', code: 'value', bar: 2,
    build: async () => ({ graph: await tweaked(plainBars(3), (g, evs) => { evs(1)[0].display.type = 'half'; }) }) },
  { id: 'sum-mismatch: drawn values that do not add up to the bar', code: 'sum-mismatch', bar: 2,
    build: async () => ({ graph: await tweaked(plainBars(3), (g, evs) => { evs(1)[0].display.type = 'half'; }) }) },
  { id: 'same-note: both hands strike C4 together', code: 'same-note', bar: 2, build: async () => ({ graph: await graphOf(doc(plainBars(3, bar2({ rh: quarters(['C4', 'D4', 'E4', 'F4']), lh: quarters(['C4', 'G3', 'C3', 'G3']) })))) }) },
  { id: 'x-misaligned: two notes that start together are 50 tenths apart on the page', code: 'x-misaligned', bar: 2,
    build: async () => ({ graph: await graphOf(doc(plainBars(3, bar2({ rh: [n('C5', 1, { x: 10 }), n('D5', 1, { x: 60 }), n('E5', 1, { x: 110 }), n('F5', 1, { x: 160 })], lh: [n('C3', 1, { x: 10 }), n('G3', 1, { x: 12 }), n('C3', 1, { x: 112 }), n('G3', 1, { x: 162 })] })))) }) },
  { id: 'hands-cross: the right hand reaches below the left', code: 'hands-cross', bar: 2, build: async () => ({ graph: await graphOf(doc(plainBars(3, bar2({ rh: quarters(['C3', 'D3', 'E3', 'F3']), lh: quarters(['C4', 'G3', 'C4', 'G3']) })))) }) },
  { id: 'big-leap: C4 then C6 in one voice', code: 'big-leap', bar: 2, build: async () => ({ graph: await graphOf(doc(plainBars(3, bar2({ rh: quarters(['C4', 'C6', 'D6', 'E6']) })))) }) },
  { id: 'big-leap: across a bar line, counted in the bar it lands in', code: 'big-leap', bar: 3,
    build: async () => ({ graph: await graphOf(doc(plainBars(4, { 2: { rh: quarters(['C5', 'D5', 'E5', 'C4']) }, 3: { rh: quarters(['C6', 'D5', 'E5', 'F5']) } }))) }) },
  { id: 'sparse: one note a hand in a bar whose neighbours have four', code: 'sparse', bar: 3,
    build: async () => ({ graph: await graphOf(doc(plainBars(5, { 3: { rh: [n('C5', 4)], lh: [n('C3', 4)] } }))) }) },
  { id: 'dense: thirty-two notes in a bar whose neighbours have eight', code: 'dense', bar: 3,
    build: async () => ({ graph: await graphOf(doc(plainBars(5, { 3: { rh: new Array(16).fill(0).map((_, i) => n(['C5', 'D5', 'E5', 'F5'][i % 4], 0.25)), lh: new Array(16).fill(0).map((_, i) => n(['C3', 'G3'][i % 2], 0.25)) } }))) }) },
  { id: 'voice-loss: a bar with a voice fewer than the rest of the piece', code: 'voice-loss', bar: 3,
    build: async () => ({ graph: await graphOf(doc(plainBars(5, { 3: { lh: [measureRest(4)] } }))) }) },
  { id: 'dup-pitch: the same note twice at once in one hand', code: 'dup-pitch', bar: 2,
    build: async () => ({ graph: await graphOf(doc(plainBars(3, bar2({ rh2: quarters(['C5', 'D5', 'E5', 'F5']) })))) }) },
  { id: 'off-key: two notes outside the key of C', code: 'off-key', bar: 2,
    build: async () => ({ graph: await graphOf(doc(plainBars(3, bar2({ rh: quarters(['C#5', 'D5', 'F#5', 'F5']) })))) }) },
  { id: 'ledger: C7 sits five ledger lines above the treble staff', code: 'ledger', bar: 2,
    build: async () => ({ graph: await graphOf(doc(plainBars(3, bar2({ rh: quarters(['C7', 'D5', 'E5', 'F5']) })))) }) },
  // what the normaliser says about a bar (report.flags by bar number)
  { id: 'rebuilt: the normaliser merged two staves into this bar', code: 'rebuilt', bar: 2, build: async () => ({ graph: await graphOf(doc(plainBars(3))), opts: { normalize: { flags: { 2: ['pair-merged'] } } } }) },
  { id: 'rebuilt: or folded a system pair', code: 'rebuilt', bar: 3, build: async () => ({ graph: await graphOf(doc(plainBars(3))), opts: { normalize: { flags: { 3: ['folded'] } } } }) },
  { id: 'switched: the bar came from another staff group than the one before', code: 'switched', bar: 2, build: async () => ({ graph: await graphOf(doc(plainBars(3))), opts: { normalize: { flags: { 2: ['source-switch'] } } } }) },
  { id: 'repaired: the divisions were repaired', code: 'repaired', bar: 2, build: async () => ({ graph: await graphOf(doc(plainBars(3))), opts: { normalize: { flags: { 2: ['divisions-repaired'] } } } }) },
  { id: 'repaired: or a zero length was', code: 'repaired', bar: 3, build: async () => ({ graph: await graphOf(doc(plainBars(3))), opts: { normalize: { flags: { 3: ['duration-repaired'] } } } }) },
  { id: 'unreadable-lengths: divisions unknown', code: 'unreadable-lengths', bar: 2, build: async () => ({ graph: await graphOf(doc(plainBars(3))), opts: { normalize: { flags: { 2: ['divisions-unknown'] } } } }) },
  { id: 'unreadable-lengths: or a length left at zero', code: 'unreadable-lengths', bar: 3, build: async () => ({ graph: await graphOf(doc(plainBars(3))), opts: { normalize: { flags: { 3: ['duration-zero'] } } } }) },
  { id: 'dropped: two readings of a bar disagreed and notes were dropped', code: 'dropped', bar: 2, build: async () => ({ graph: await graphOf(doc(plainBars(3))), opts: { normalize: { flags: { 2: ['overlap'] } } } }) },
  { id: 'fragmented: the parts could not be joined', code: 'fragmented', bar: 1, build: async () => ({ graph: await graphOf(doc(plainBars(1))), opts: { normalize: { flags: { 1: ['parts-fragmented'] } } } }) },
  { id: 'joined: the bar starts a separate movement', code: 'joined', bar: 3, build: async () => ({ graph: await graphOf(doc(plainBars(3))), opts: { normalize: { flags: { 3: ['movement-start'] } } } }) },
  // what the pages show
  { id: 'page-bars: the page shows 3 bars on the second line, 2 were read', code: 'page-bars', bar: [3, 4],
    build: async () => ({ graph: await graphOf(doc(plainBars(4, { 3: { newSystem: true } }))), opts: { normalize: { structure: [{ page: 0, movement: 1, bars: 4 }] }, layout: { pages: [[2, 3]] } } }),
    expectReason: { shown: 3, read: 2 } },
  { id: 'page-bars: the page shows 6 bars in all, 4 were read (the lines differ in number)', code: 'page-bars', bar: [1, 2, 3, 4],
    build: async () => ({ graph: await graphOf(doc(plainBars(4))), opts: { normalize: { structure: [{ page: 0, movement: 1, bars: 4 }] }, layout: { pages: [[3, 3]] } } }),
    expectReason: { shown: 6, read: 4, page: true } },
  { id: 'page-bars: the second page only', code: 'page-bars', bar: [4, 5, 6],
    build: async () => ({ graph: await graphOf(doc(plainBars(6, { 4: { newSystem: true } }))), opts: { normalize: { structure: [{ page: 0, movement: 1, bars: 3 }, { page: 1, movement: 1, bars: 3 }] }, layout: { pages: [[3], [2]] } } }),
    expectReason: { shown: 2, read: 3 } }
];

/* music that none of the signals should touch: a pickup and the bar that completes it, a left hand that rests a whole bar next to bars where it plays,
   a plain run */
const CLEAN = [
  { id: 'four plain bars', build: async () => ({ graph: await graphOf(doc(plainBars(4))) }) },
  { id: 'a pickup and the bar that completes it', build: async () => ({ graph: await graphOf(doc([
    { rh: [n('G4', 1)], lh: [r(1)] }, L.plainBar(), L.plainBar(), { rh: quarters(['C5', 'D5', 'E5']), lh: [n('C3', 2), n('G3', 1)] }], { pickup: true })) }) },
  { id: 'sharps that belong to the key of D', build: async () => ({ graph: await graphOf(doc(
    [0, 1, 2].map(() => ({ rh: quarters(['C#5', 'D5', 'E5', 'F#5']), lh: quarters(['D3', 'A3', 'D3', 'A3']) })), { fifths: 2 })) }) },
  { id: 'a measure rest whose own length is short still fills its bar', skip: ['sum-mismatch'], build: async () => ({ graph: await tweaked(plainBars(3, { 2: { lh: [measureRest(4)] } }), (g) => {
    const staff = g.parts[0].staves[1].id;
    g.parts[0].events.filter(e => e.m === g.timeline.measures[1].id && e.staff === staff).forEach(e => { e.dur = '1/4'; });
  }) }) },
  { id: 'a bar of one hand resting', build: async () => ({ graph: await graphOf(doc(plainBars(3, bar2({ lh: [measureRest(4)] })))) }) }
];

/* ---- running a case against a module M (the real one, or a mutant) */
async function runCase(M, c) {
  const built = await c.build();
  const params = Object.assign(only(c.code, c.strength), c.params || {});
  const res = M.analyze(built.graph, Object.assign({}, built.opts || {}, { params }));
  const want = [].concat(c.bar);
  const got = res.suspect;
  const ok = res.ok && got.length === want.length && got.every((b, i) => b === want[i]) && want.every(b => res.bars[b - 1].reasons.some(x => x.code === c.code
    && (!c.expectReason || Object.keys(c.expectReason).every(k => x[k] === c.expectReason[k]))));
  return { ok, got, want, reasons: res.bars ? res.bars.map(b => b.reasons.map(x => x.code)) : null };
}
/* the same music under the real module with EVERY single-bar signal strong: nothing may be suspect */
async function runClean(M, c) {
  const built = await c.build();
  const strong = M.CODES.filter(x => x !== 'bad-page' && x !== 'next-to-bad' && x !== 'sparse' && x !== 'dense' && x !== 'voice-loss' && !(c.skip || []).includes(x));
  const res = M.analyze(built.graph, Object.assign({}, built.opts || {}, { params: { strong, weak: [], weakNeeded: 1, thr: Object.assign({}, M.PARAMS.thr) } }));
  return { ok: res.ok && res.suspect.length === 0, got: res.suspect, reasons: res.bars.map(b => b.reasons.map(x => x.code)) };
}

module.exports = { CASES, CLEAN, runCase, runClean, L };
