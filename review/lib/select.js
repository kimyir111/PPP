/* G9c: which pieces go into a packet - a documented, deterministic rule (no randomness, no clock; the "seed" below is a public
   constant that only orders candidates, unrelated to the secret blind seed).

   Pool: the 61 files of tests/engrave/corpus.json (the stratified reference corpus every G8/G9 measurement draws from).

   A file can be reviewed only if all of this holds (checked by really running it, not assumed):
     - it opens, and has 8..40 measures (a reviewer reads and listens to every bar; long pieces are out);
     - realize/tools/harness.js `findG8Plan` finds a G7b plan for it (the request G9 is measured at: its own G6 level, first
       reachable hand profile) - about half the corpus has none, so this is the binding constraint;
     - the G9 pipeline (G9a best-of-N + G9b repair) returns an arrangement at that request;
     - ScoreArranger returns at all four levels within the time limit (no timeouts) and a level closest to the target exists;
     - at the level reviewed the two arms are not the same notes (a piece both G9 and the legacy engine leave alone at that level
       gives nothing to compare);
     - both arms draw through review/lib/neutral.js.
   H-8 reviews a piece at a second level only where BOTH arms change between the two levels (see `levelItems`); pieces are taken in
   the order above until there are 16 items, so H-8 is 16 items over more than 8 pieces.

   Order in which files are tried (the first that qualify are taken, until the mode's count is met):
     1. an overlap preference, so the review says as much as it can about pieces G9 was NOT tuned on:
          H-8:  tier 0 (never in any G9 measurement) before tier 1 (the 32-file held-out slice, measured once after the code
                was frozen) before tier 2 (the 16-file tuning sample, which selection was tuned against).
          H-9:  tiers 0 and 1 before tier 2; and within those, pieces not already chosen for H-8 before ones that were (to keep a
                reviewer from meeting the same piece twice when both reviews are done).
     2. within a preference group, the corpus strata (hymns, beyer, czerny599, ...) are taken round-robin in corpus order, and
        inside a stratum files are ordered by sha256(SELECTION_SEED + ':' + path).
   The tiers come from harness.js itself (`sampleFiles(16)` is the tuning sample, `heldOutFiles(32)` the held-out slice), so this
   never drifts from what the measurements used. The chosen inputs' tiers are recorded in the KEY file and stated in the README:
   any piece from tier 2 means the review of that piece is optimistic for G9. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const REPO = path.resolve(__dirname, '..', '..');
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const DIFF = require(path.join(REPO, 'difficulty/index.js'));
const WEIGHTS = require(path.join(REPO, 'difficulty/weights/g6a-v1.json'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
const HARNESS = require(path.join(REPO, 'realize/tools/harness.js'));
const { arrangeItem } = require('./arrange.js');

const SELECTION_SEED = 'g9c-inputs-v1';
const MODES = { h8: { items: 16, twoLevels: true }, h9: { items: 16, twoLevels: false } };
const MIN_MEASURES = 8, MAX_MEASURES = 40;
/* the second H-8 level is the first of these offsets above the piece's own request level at which G9's arrangement is
   really a different, fuller arrangement: its measured G6 level is at least MIN_LEVEL_GAP higher, or it has at least
   MIN_NOTE_GROWTH times the notes (and the notes differ). Plans below a piece's own level do not exist (G7b cannot reduce
   past what the piece asks), and at many targets G9 and the legacy engine both simply stay at the piece's level - only about
   a third of the reachable corpus pieces have such a second level, so H-8 is 16 items over fewer than 16 pieces. */
const SECOND_LEVEL_OFFSETS = [1, 1.5, 2];
const MIN_LEVEL_GAP = 0.25, MIN_NOTE_GROWTH = 1.1;

const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function corpus() { return JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'corpus.json'), 'utf8')); }

function tierOf() {
  const tuning = new Set(HARNESS.sampleFiles(16)), held = new Set(HARNESS.heldOutFiles(32));
  return f => tuning.has(f) ? 2 : held.has(f) ? 1 : 0;
}

/* round-robin over strata (corpus order), each stratum's files in hash order; `files` restricts to a group */
function roundRobin(strata, files, tag) {
  const lists = strata.map(s => s.files.filter(f => files.has(f)).sort((a, b) => cmp(sha(SELECTION_SEED + ':' + a), sha(SELECTION_SEED + ':' + b))));
  const out = [];
  while (lists.some(l => l.length)) lists.forEach(l => { if (l.length) out.push(l.shift()); });
  return out;
}
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/* the order files are tried in for a mode; `avoid` = files already chosen for H-8 (H-9 only) */
function candidateOrder(mode, avoid) {
  const c = corpus(), tier = tierOf();
  const all = c.files.slice();
  const group = mode === 'h8' ? f => tier(f) : f => tier(f) === 2 ? 2 : (avoid && avoid.has(f) ? 1 : 0);
  const out = [];
  [0, 1, 2].forEach(gi => out.push.apply(out, roundRobin(c.strata, new Set(all.filter(f => group(f) === gi)))));
  return { order: out, tier: tier };
}

const keyOf = it => it.file + '|' + it.targetLevel.toFixed(2) + '|' + it.handProfile;

/* `cache`: a Map key -> arrangeItem result, shared by the selection and the build (and by H-9's look at H-8) */
async function arrangeCached(item, cache) {
  const k = keyOf(item);
  if (!cache.has(k)) cache.set(k, await arrangeItem(item));
  return cache.get(k);
}

function sameNotes(a, b) {
  const f = ns => JSON.stringify(ns.filter(n => !n.rest).map(n => [n.m, n.b, n.dur, n.midi]).sort());
  return f(a) === f(b);
}

/* The levels a piece is reviewed at. Candidate targets are the request level G9 is measured at (offset 0) and the offsets in
   SECOND_LEVEL_OFFSETS above it; a target is usable only if both arms are ok and give different notes there. Walking them in
   order, a usable target is kept if it is the first. A SECOND target is kept only if BOTH arms changed: G9's arrangement is
   really fuller than at the first (G6 level at least MIN_LEVEL_GAP higher, or MIN_NOTE_GROWTH times the notes) with different
   notes, AND the legacy arm's notes differ from the legacy notes at the first level. (Review finding, G9c: ScoreArranger has only
   four native levels and usually returns the same notes at two nearby targets; two items of one piece then showed a byte-identical
   legacy side, which gave the arm away without the key, and made 16 items cover fewer pieces.) So a piece gets a second item
   only when no side of it repeats; otherwise one level per piece. */
async function levelItems(file, found, cache, want) {
  const kept = [];
  const offsets = want > 1 ? [0].concat(SECOND_LEVEL_OFFSETS) : [0];
  for (const off of offsets) {
    if (kept.length >= want) break;
    const item = { file: file, targetLevel: Math.round((found.targetLevel + off) * 100) / 100, handProfile: found.profile };
    const r = await arrangeCached(item, cache);
    if (!r.ok || r.identical) { if (!r.ok && off === 0) return { failed: r.reason, kept: [] }; continue; }
    if (kept.length) {
      const prev = kept[kept.length - 1];
      const n = x => x.g9.notes.filter(q => !q.rest).length;
      const fuller = r.g9.level - prev.g9.level >= MIN_LEVEL_GAP || n(r) >= MIN_NOTE_GROWTH * n(prev);
      if (!fuller || sameNotes(r.g9.notes, prev.g9.notes) || sameNotes(r.legacy.notes, prev.legacy.notes)) continue;
    }
    kept.push(r);
  }
  return { kept: kept };
}

/* -> { mode, items: [arrangeItem result with .tier .stratum], skipped: [{file, reason}], rule } */
async function selectItems(mode, opts) {
  opts = opts || {};
  const spec = Object.assign({}, MODES[mode], opts.count ? { items: opts.count } : {});
  if (!MODES[mode]) throw new Error('mode must be h8 or h9');
  const cache = opts.cache || new Map();
  const log = opts.log || (() => {});
  let avoid = null;
  if (mode === 'h9' && !opts.onlyFiles) {
    const h8 = await selectItems('h8', { cache: cache, log: log });
    avoid = new Set(h8.items.map(r => r.file));
  }
  const cand = candidateOrder(mode, avoid), tier = cand.tier;
  const order = opts.onlyFiles ? cand.order.filter(f => opts.onlyFiles.indexOf(f) >= 0) : cand.order; /* opts.onlyFiles/opts.count: tests only */
  const strata = corpus().strata;
  const stratumOf = f => (strata.find(s => s.files.indexOf(f) >= 0) || {}).name;
  const chosen = [], skipped = [];
  const take = (entries, file) => { entries.forEach(r => { r.tier = tier(file); r.stratum = stratumOf(file); chosen.push(r); }); };
  for (const file of order) {
    if (chosen.length >= spec.items) break;
    let g, sg;
    try { g = await H.graphOf(file); sg = g && SGG.analyze(g); } catch (e) { g = null; }
    if (!g) { skipped.push({ file: file, reason: 'does not open' }); continue; }
    const nm = g.timeline.measures.length;
    if (nm < MIN_MEASURES || nm > MAX_MEASURES) { skipped.push({ file: file, reason: nm + ' measures (need ' + MIN_MEASURES + '..' + MAX_MEASURES + ')' }); continue; }
    const own = DIFF.assess(g, WEIGHTS).level.position;
    const found = HARNESS.findG8Plan(g, sg, own);
    if (!found) { skipped.push({ file: file, reason: 'no reachable G7b plan' }); continue; }
    const lv = await levelItems(file, found, cache, spec.twoLevels ? 2 : 1);
    if (lv.failed) { skipped.push({ file: file, reason: lv.failed }); continue; }
    if (!lv.kept.length) { skipped.push({ file: file, reason: 'both arms give the same notes at every level tried' }); continue; }
    /* a two-level piece adds two items unless only one place is left */
    const entries = chosen.length + lv.kept.length <= spec.items ? lv.kept : lv.kept.slice(0, 1);
    take(entries, file);
    log('  ' + mode + ' ' + file + ' (tier ' + tier(file) + ', level' + (entries.length > 1 ? 's ' : ' ') + entries.map(r => r.item.targetLevel).join(' & ') + ')');
  }
  if (chosen.length < spec.items) throw new Error(mode + ': only ' + chosen.length + ' of ' + spec.items + ' items qualify; skipped: ' + JSON.stringify(skipped));
  return { mode: mode, items: chosen, skipped: skipped };
}

module.exports = { selectItems, candidateOrder, tierOf, arrangeCached, keyOf, SELECTION_SEED, MODES, MIN_MEASURES, MAX_MEASURES, SECOND_LEVEL_OFFSETS, MIN_LEVEL_GAP, MIN_NOTE_GROWTH };
