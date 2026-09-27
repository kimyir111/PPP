/* ============================================================================
   PPP Playability — the fingering DP (docs/GOALS/G05 §3(b), §11 G5b)

   A pure-function UMD module, alongside reach.js/graph.js/analyze.js (not loaded by the app, G05 §9).
   Ports the app's own `Fingering` model (App 8337-8775) from the legacy `Score` shape to the
   ScoreGraph, reusing `playability/graph.js`'s `attacksOf` (the same, already-reviewed mechanism G5a
   uses to turn a graph into per-hand keyboard events) instead of re-deriving hand assignment. Nothing
   here changes a note, a pitch or a hand (G05 §2 non-goals) — it only assigns fingers 1-5 to heads that
   have none yet, and only within a `Head.fingering` provenance guard (G3-D4, `docs/DECISIONS.md`).

   ---- What the legacy DP actually is (verified against the code, not assumed from the goal doc) ----

   `Fingering.solve(evs, hand)` (App 8596-8650) is a genuine second-order Viterbi: the state at event i
   is the pair (finger choice at i-1, finger choice at i), because `tripleCost` (Rules 4/5/7, App
   8491-8519 — a hand relocation when the first and third of three notes in a row are further apart than
   the two outer fingers can comfortably span) needs to see three consecutive events at once. The cost
   model IS Parncutt-style spans (`SPANS`, App 8343-8354 — Parncutt, Sloboda, Clarke, Raekallio and
   Desain 1997, the same table `playability/reach.js` already cites) plus a keyboard-distance metric
   (`dist`/`keyX`, App 8363-8367, physical position in white-key widths, a black key halfway) plus the
   second-order finger-transition DP itself. The goal doc's one-line description (§3(b)) is accurate.

   `Fingering.plan(score)` (App 8754-8774), the top-level entry, is **NOT joint across hands**: it loops
   `['r', 'l'].forEach(hand => { const evs = Fingering.events(...); Fingering.solveHand(evs, hand); })`
   — two completely independent DPs, no shared state, no term in `pairCost`/`stepCost`/`tripleCost`/
   `selfCost` that reads the other hand's notes or fingers at all. The ONE place two hands are compared
   anywhere in this codebase is `playability/analyze.js`'s `crossingStrain` (G5a), a same-onset
   lowest-RH-vs-highest-LH check that scores soft strain — it is not a fingering decision and does not
   feed back into either hand's DP. So "extend... to both hands jointly" (G05 §3(b)) is corrected here:
   there is no cross-hand cost term to port, because the legacy model has none, and nothing about the
   piano (each hand plays a disjoint set of keys at any instant, crossing passages included — G1's hand
   assignment already fixed which hand plays what, G05 §2) gives one finger-choice a physical reason to
   depend on the other hand's finger choice. `solveGraph` below still calls this "joint" in the sense the
   goal doc actually needs: ONE function, ONE `attacksOf` pass over the whole graph, both hands' phrases
   solved from that one shared traversal — not two callers each re-deriving hand assignment their own
   way. The DP itself factors into two independent optimizations because the legacy cost model already
   does, and solving them separately gives the identical answer a coupled joint DP with no cross terms
   would give, at a fraction of the state space. See docs/GOALS/G05_PLAYABILITY_FINGERING.md §11 (G5b).

   Deliberately NOT ported: `Fingering.positions`/`restFingers` (App 8667-8750, where the whole hand
   sits and where idle fingers rest for the hand-guide drawing) and the `candidates()` "a written
   fingering is kept" hint path being wired to `Head.fingering` — both are display/UI concerns (G5c) or
   would leak the very ground truth this module is measured against back into its own predictions. The
   `fixed` array `candidates()` still accepts (App 8524-8558, kept verbatim below) is always the zero
   array here; a future phase can pass real hints once that leakage question has its own design pass.
   Also not ported: `scoreNoteEnd`'s `SCORE_HAND_HOLD_Q` floor (App 8306-8307), a 0.25-beat minimum
   visual hold for the hand-guide's drawing so very short notes do not flicker — a display-only hack,
   irrelevant to a pure notation-based DP; this module uses `attacksOf`'s real, tie-resolved head timing.

   ---- Units ----

   The legacy model's timing (`e.at`, `e.end`, `gapFactor`'s 0.5/1/4 thresholds) is in QUARTER-NOTE
   beats, tempo-independent — the same DP answer at any tempo, which is correct for a model that is
   about notated rhythm and hand geometry, not real seconds. `attacksOf` gives `onsetW`/`offW` in W
   (whole note = 1); `beats(w) = R.toNumber(w) * 4` converts to the legacy's own unit exactly.

   ---- Provenance guard (G3-D4) ----

   `provOf(g, headId, 'fingering').op` is NOT "does this head's fingering already exist" by itself: the
   MusicXML importer (`scoregraph/musicxml-import.js`) never stamps a per-aspect `prov.asp.fingering` on
   a head — it only sets one GRAPH-LEVEL default, `provenance.default = {op: 'imported'}`
   (`scoregraph/build.js` `setDefault`). `provOf`'s fallback chain (`scoregraph/prov.js`) means EVERY
   head with no fingering opinion of its own still resolves to `op: 'imported'` through that default —
   so "skip when provOf(...).op is imported" would refuse to write fingering to almost the entire
   corpus, not just the heads that print one. The real guard has to be about CONTENT: a head only needs
   protecting once it actually carries a `fingering` value (printed by the source, or a later user edit);
   a head with none has nothing to protect regardless of the graph's ambient default. `write()` below
   therefore checks `Head.fingering` for existing content FIRST, and only consults `provOf` to allow a
   previously G5b-written ('inferred') value to be recomputed — an 'imported' or 'edited' (or
   'generated'/'repaired') value with real content is never touched, per G05 §3(b) and G3-D4.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scoregraph/rational.js'), require('../scoregraph/ops.js'),
      require('../scoregraph/prov.js'), require('./graph.js'));
  } else {
    const M = root.PPPPlayabilityModules = root.PPPPlayabilityModules || {};
    const SG = root.PPPScoreGraphModules || {};
    M.fingering = factory(SG.rational, SG.ops, SG.prov, M.graph);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, Ops, Prov, Graph) {
  'use strict';

  /* ---- the Parncutt span table and cost weights, verbatim (App 8343-8361) ---- */
  const SPANS = Object.freeze({
    '1-2': [-5, -3, 1, 5, 7, 9], '1-3': [-4, -2, 3, 7, 9, 11], '1-4': [-3, -1, 5, 9, 11, 13],
    '1-5': [-1, 1, 7, 10, 12, 14], '2-3': [1, 1, 1, 2, 3, 5], '2-4': [1, 1, 3, 4, 5, 7],
    '2-5': [2, 2, 5, 6, 8, 10], '3-4': [1, 1, 1, 2, 2, 4], '3-5': [1, 1, 3, 4, 5, 7], '4-5': [1, 1, 1, 2, 3, 5]
  });
  const W = Object.freeze({
    stretch: 2, small: 1, large: 1, beyond: 10, sameFinger: 12,
    posFull: 2, posHalf: 1, posSize: 1, weak: 0.5, threeFourFive: 1, threeToFour: 1,
    fourOnBlack: 1, thumbBlack: 4, thumbBlackNear: 2, fiveBlack: 2,
    thumbPass: 1, thumbPassBlack: 3, heldFinger: 8, chord: 1.5, compact: 0.4,
    beyondSeq: 2, chordCompact: 1, thumbBlackChord: 1.5, blackRoom: 0.7, move: 0.8, swap: 0.5
  });
  const KEY_POS = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
  const KEY_BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  const PHRASE_REST_BEATS = 4; /* App 8658: a rest this long (a bar of 4/4) splits phrases */

  function isBlack(m) { return KEY_BLACK[((m % 12) + 12) % 12] === 1; }
  /* horizontal position in white-key widths, a black key halfway (App 8365) */
  function keyX(m) { return Math.floor(m / 12) * 7 + KEY_POS[((m % 12) + 12) % 12] / 2; }
  /* physical distance expressed in semitone-equivalents, so SPANS applies (App 8367) */
  function dist(a, b) { return 0.75 * (keyX(b) - keyX(a)) * 12 / 7 + 0.25 * (b - a); }
  /* the signed span between two fingers of one hand, lower-numbered finger to higher (App 8371-8375) */
  function span(fa, ma, fb, mb, hand) {
    let d = fa < fb ? dist(ma, mb) : dist(mb, ma);
    if (hand === 'l') d = -d;
    return d;
  }

  /* What a pair of fingers costs sounding one after another (or together, in a chord); App 8381-8402. */
  function pairCost(fa, ma, fb, mb, hand, simul) {
    if (fa === fb) return ma === mb ? 0 : W.sameFinger + Math.abs(dist(ma, mb)) * 0.5;
    const lo = Math.min(fa, fb), hi = Math.max(fa, fb);
    const t = SPANS[lo + '-' + hi];
    const d = span(fa, ma, fb, mb, hand);
    const thumb = lo === 1;
    let c = 0;
    if (d > t[4]) c += W.stretch * (d - t[4]);
    if (d < t[1]) c += W.stretch * (t[1] - d);
    if (d > t[3]) c += (thumb ? 1 : 2) * W.large * (d - t[3]);
    if (d < t[2]) c += (thumb ? 1 : 2) * W.small * (t[2] - d);
    const beyond = simul ? W.beyond : W.beyondSeq;
    if (d > t[5]) c += beyond * (d - t[5]);
    if (d < t[0]) c += beyond * (t[0] - d);
    if (d >= 0) c += (simul ? W.chordCompact : W.compact) * Math.abs(d * 7 / 12 - (hi - lo));
    return c;
  }

  /* Where a fingering puts the hand: the key the thumb would be over if the fingers were a white key
     apart, averaged over the notes (App 8447-8455). */
  function frame(e, f, hand) {
    const dir = hand === 'l' ? -1 : 1;
    let sum = 0, n = 0;
    for (let i = 0; i < e.midi.length; i++) {
      if (!f[i]) continue;
      sum += keyX(e.midi[i]) - dir * (f[i] - 1); n++;
    }
    return n ? sum / n : 0;
  }

  /* To or from a chord the hand takes its new shape as a whole (App 8460-8468). */
  function chordStep(a, fa, b, fb, hand) {
    let c = W.move * Math.abs(frame(b, fb, hand) - frame(a, fa, hand));
    for (let i = 0; i < a.midi.length; i++) {
      const j = b.midi.indexOf(a.midi[i]);
      if (j > -1 && fa[i] && fb[j] && fa[i] !== fb[j]) c += W.swap;
    }
    return c;
  }

  /* One note to the next in a single line (App 8420-8443). */
  function lineCost(m1, f1, m2, f2, hand) {
    if (!f1 || !f2) return 0;
    if (f1 === f2) return m1 === m2 ? (f2 >= 4 ? -W.weak : 0) : W.sameFinger + Math.abs(dist(m1, m2));
    let pc = pairCost(f1, m1, f2, m2, hand, false);
    const bl1 = isBlack(m1), bl2 = isBlack(m2);
    if (f1 === 3 && f2 === 4) pc += W.threeToFour;
    if ((f1 === 3 && f2 === 4 && !bl1 && bl2) || (f1 === 4 && f2 === 3 && bl1 && !bl2)) pc += W.fourOnBlack;
    if ((f1 === 1 || f2 === 1) && span(f1, m1, f2, m2, hand) < 0) {
      const tm = f1 === 1 ? m1 : m2, om = f1 === 1 ? m2 : m1;
      const tb = isBlack(tm), ob = isBlack(om);
      if (ob && !tb) pc *= W.blackRoom;
      pc += tb === ob ? W.thumbPass : (tb && !ob ? W.thumbPassBlack : 0);
    }
    if (f2 === 1 && bl2 && !bl1) pc += W.thumbBlackNear;
    if (f1 === 1 && bl1 && !bl2) pc += W.thumbBlackNear;
    if (f2 === 5 && bl2 && !bl1) pc += W.fiveBlack / 2;
    if (f1 === 5 && bl1 && !bl2) pc += W.fiveBlack / 2;
    return pc;
  }

  /* Rest between events (in beats) shapes how much a position change costs (App 8472). */
  function gapFactor(gap) { return gap >= 1 - 1e-6 ? 0.15 : gap >= 0.5 - 1e-6 ? 0.4 : gap > 1e-6 ? 0.75 : 1; }

  /* The cost of one step, event a to event b, not counting what b costs on its own (App 8406-8417). */
  function stepCost(a, fa, b, fb, hand, gap) {
    const c = a.midi.length === 1 && b.midi.length === 1
      ? lineCost(a.midi[0], fa[0], b.midi[0], fb[0], hand)
      : chordStep(a, fa, b, fb, hand);
    let held = 0;
    for (let i = 0; i < a.midi.length; i++) {
      if (!fa[i] || !(a.until[i] > b.at + 1e-6)) continue;
      for (let j = 0; j < b.midi.length; j++) if (fb[j] === fa[i] && b.midi[j] !== a.midi[i]) held += W.heldFinger;
    }
    return c * gapFactor(gap) + held;
  }

  /* What b costs on its own: the fingers it uses, and the shape of a chord (App 8474-8489). */
  function selfCost(b, fb, hand) {
    let c = 0;
    for (let j = 0; j < b.midi.length; j++) {
      const f = fb[j];
      if (!f) continue;
      if (f >= 4) c += W.weak;
      if (f === 1 && isBlack(b.midi[j])) c += b.midi.length > 1 ? W.thumbBlackChord : W.thumbBlack;
      for (let k = j + 1; k < b.midi.length; k++) {
        if (!fb[k]) continue;
        c += W.chord * pairCost(f, b.midi[j], fb[k], b.midi[k], hand, true) / 2;
      }
    }
    return c;
  }

  /* Rules 4, 5 and 7: three notes in a row — a hand relocation when the outer two are further apart
     than their fingers can comfortably span (App 8491-8519). */
  function tripleCost(a, fa, b, fb, c, fc, hand, gap) {
    if (a.midi.length > 1 || b.midi.length > 1 || c.midi.length > 1) return 0;
    const f1 = fa[0], f2 = fb[0], f3 = fc[0];
    if (!f1 || !f2 || !f3) return 0;
    const m1 = a.midi[0], m2 = b.midi[0], m3 = c.midi[0];
    let cost = 0, d, t;
    if (f1 === f3) { d = dist(m1, m3) * (hand === 'l' ? -1 : 1); t = [0, 0, 0, 0, 0, 0]; }
    else { t = SPANS[Math.min(f1, f3) + '-' + Math.max(f1, f3)]; d = span(f1, m1, f3, m3, hand); }
    if (d > t[4] + 1e-6 || d < t[1] - 1e-6) {
      const between = (m2 - m1) * (m3 - m2) > 0;
      const full = f2 === 1 && between && (d > t[5] || d < t[0]);
      cost += full ? W.posFull : W.posHalf;
      cost += W.posSize * (d > t[4] ? d - t[4] : t[1] - d);
    }
    if (f1 !== f2 && f2 !== f3 && f1 !== f3 && f1 >= 3 && f2 >= 3 && f3 >= 3) cost += W.threeFourFive;
    return cost * gapFactor(gap);
  }

  /* Every way to finger one onset (App 8524-8558). `e.fixed[i]` (kept for a future phase; always 0 in
     this one, see the header) forces that note's finger when set. More than five notes keeps the outer
     ones and whatever fits between — the same rule the legacy model uses for a very wide cluster. */
  function candidates(e, hand) {
    const k = e.midi.length;
    const want = e.fixed;
    const out = [];
    let use = [];
    for (let i = 0; i < k; i++) use.push(i);
    if (k > 5) {
      use = [0];
      for (let s = 1; s < 4; s++) use.push(Math.round(s * (k - 1) / 4));
      use.push(k - 1);
    }
    const n = use.length;
    const pick = (start, left, acc) => {
      if (!left) {
        const f = new Array(k).fill(0);
        let okFixed = true;
        use.forEach((idx, j) => {
          f[idx] = hand === 'l' ? acc[n - 1 - j] : acc[j];
          if (want[idx] && want[idx] !== f[idx]) okFixed = false;
        });
        if (okFixed) out.push(f);
        return;
      }
      for (let x = start; x <= 5 - left + 1; x++) pick(x + 1, left - 1, acc.concat(x));
    };
    pick(1, n, []);
    if (!out.length) {
      const f = new Array(k).fill(0);
      use.forEach((idx, j) => { f[idx] = want[idx] || (hand === 'l' ? n - j : j + 1); });
      out.push(f);
    }
    return out;
  }

  /* The second-order shortest path: states are (previous fingering, this fingering), since tripleCost
     needs both (App 8594-8650), verbatim. */
  function solve(evs, hand) {
    const N = evs.length;
    if (!N) return [];
    const C = evs.map(e => candidates(e, hand));
    const gapBefore = evs.map((e, i) => i ? Math.max(0, e.at - evs[i - 1].end) : 0);
    const self = C.map((cs, i) => cs.map(f => selfCost(evs[i], f, hand)));
    if (N === 1) {
      let best = 0;
      self[0].forEach((v, j) => { if (v < self[0][best]) best = j; });
      return [C[0][best]];
    }
    let V = [];
    for (let p = 0; p < C[0].length; p++) {
      V[p] = [];
      for (let q = 0; q < C[1].length; q++) V[p][q] = self[0][p] + self[1][q] + stepCost(evs[0], C[0][p], evs[1], C[1][q], hand, gapBefore[1]);
    }
    const back = [null, null];
    for (let i = 2; i < N; i++) {
      const Cp = C[i - 1], Cq = C[i], Co = C[i - 2];
      const nV = [], nB = [];
      const step = [];
      for (let p = 0; p < Cp.length; p++) {
        step[p] = [];
        for (let q = 0; q < Cq.length; q++) step[p][q] = stepCost(evs[i - 1], Cp[p], evs[i], Cq[q], hand, gapBefore[i]);
      }
      const gap2 = Math.max(gapBefore[i - 1], gapBefore[i]);
      for (let p = 0; p < Cp.length; p++) {
        nV[p] = []; nB[p] = [];
        for (let q = 0; q < Cq.length; q++) {
          let best = Infinity, arg = 0;
          for (let o = 0; o < Co.length; o++) {
            const v = V[o][p];
            if (v >= best) continue;
            const t = v + tripleCost(evs[i - 2], Co[o], evs[i - 1], Cp[p], evs[i], Cq[q], hand, gap2);
            if (t < best) { best = t; arg = o; }
          }
          nV[p][q] = best + step[p][q] + self[i][q];
          nB[p][q] = arg;
        }
      }
      back[i] = nB;
      V = nV;
    }
    let bp = 0, bq = 0, bv = Infinity;
    for (let p = 0; p < V.length; p++) for (let q = 0; q < V[p].length; q++) if (V[p][q] < bv) { bv = V[p][q]; bp = p; bq = q; }
    const pick = new Array(N);
    pick[N - 1] = bq; pick[N - 2] = bp;
    for (let i = N - 1; i >= 2; i--) pick[i - 2] = back[i][pick[i - 1]][pick[i]];
    return pick.map((j, i) => C[i][j]);
  }

  /* Long rests split a hand's part into phrases, solved one at a time (App 8652-8665): the path is
     exact within a phrase, a piece of any length stays fast, AND a single passage can be re-solved
     alone without the rest of the piece (G05 §7's later G9 requirement) — it is already just one more
     call to `solve()` on that phrase's slice of events, nothing here needs whole-piece state. */
  function solveHand(evs, hand) {
    const out = [];
    let start = 0;
    for (let i = 1; i <= evs.length; i++) {
      if (i === evs.length || evs[i].at - evs[i - 1].end >= PHRASE_REST_BEATS - 1e-6) {
        solve(evs.slice(start, i), hand).forEach(f => out.push(f));
        start = i;
      }
    }
    return out;
  }

  /* W (whole note = 1) -> quarter-note beats, the legacy model's own unit (see header). */
  function beats(w) { return R.toNumber(w) * 4; }

  /* One hand's `attacksOf` attacks (playability/graph.js) -> the legacy DP's own event shape: notes
     sorted by pitch (ascending, both hands — App 8585), `until` the real tie-resolved release time of
     each note (no SCORE_HAND_HOLD_Q floor, see header), `fixed` always the zero array (see header).

     Same-pitch dedup (App 8580, `Fingering.events`: "the same key twice: one finger"): `attacksOf`
     groups by (limb, onset) across every voice on a hand's staff, so a sustained note in one voice and a
     newly-struck note of the SAME pitch in another voice at the same instant (a held bass note under a
     broken-chord figure restriking it, say) arrive as two separate heads. Physically that is one key —
     it needs exactly one finger, not two competing for it — so heads sharing a pitch within one attack
     collapse to a single DP "note" here, and every head at that pitch gets the SAME chosen finger back
     (`headIds` is therefore an array of ID GROUPS, one group per unique pitch, not one ID per note).
     G5a's own review found the identical gap in the KEYS hard-violation count (analyze.js counting two
     "keys" for one physically-struck pitch, burgmuller25/019) and deferred the fix here (G05 §11 G5a).
     Measured impact (docs/GOALS/G05_PLAYABILITY_FINGERING.md §11 G5b): before this dedup, G5b UNDER-
     performed the legacy model on printed-finger agreement (a duplicated pitch forced the DP to invent
     two distinct fingers for one key, corrupting that whole phrase's second-order path) — this is what
     closed the gap and is also the mutation suite's own planted-defect invariant (a fingering DP must
     never assign two different fingers to one physical key at one instant). The held-until time kept for
     a deduplicated pitch is the LATEST of its duplicates' releases (the key is down for as long as any
     of them says it is). */
  function eventsForHand(attacksForHand) {
    return attacksForHand.map(a => {
      const byMidi = new Map();
      a.heads.forEach(h => {
        let g = byMidi.get(h.midi);
        if (!g) { g = { midi: h.midi, ids: [], offW: h.offW }; byMidi.set(h.midi, g); }
        else if (R.cmp(h.offW, g.offW) > 0) g.offW = h.offW;
        g.ids.push(h.id);
      });
      const notes = Array.from(byMidi.values()).sort((x, y) => x.midi - y.midi);
      return {
        at: beats(a.onsetW),
        end: Math.max.apply(null, notes.map(n => beats(n.offW))),
        midi: notes.map(n => n.midi),
        until: notes.map(n => beats(n.offW)),
        fixed: notes.map(() => 0),
        headIds: notes.map(n => n.ids),
        m: a.m
      };
    });
  }

  const HAND_OF_LIMB = { RH: 'r', LH: 'l' };
  const LIMB_OF_HAND = { r: 'RH', l: 'LH' };

  /* The whole graph, both hands (docs/GOALS/G05 §3(b)) — see the header for why the two hands' DPs run
     independently, which is what the ported cost model actually is, not an unexamined shortcut. One
     `attacksOf` pass over the graph feeds both. Returns per-head predictions (no writing, no
     provenance) — `write()` below is the separate, guarded step that touches a graph. */
  function solveGraph(g, opts) {
    opts = opts || {};
    const attacks = Graph.attacksOf(g, opts);
    const byHand = { r: [], l: [] };
    attacks.forEach(a => { const h = HAND_OF_LIMB[a.limb]; if (h) byHand[h].push(a); });
    const results = [];
    const hands = {};
    ['r', 'l'].forEach(hand => {
      const evs = eventsForHand(byHand[hand]);
      const fingers = solveHand(evs, hand);
      evs.forEach((e, i) => e.headIds.forEach((ids, j) => {
        const f = fingers[i][j] || null;
        ids.forEach(id => results.push({ headId: id, limb: LIMB_OF_HAND[hand], m: e.m, finger: f }));
      }));
      hands[LIMB_OF_HAND[hand]] = { events: evs, fingers: fingers };
    });
    return { results: results, hands: hands };
  }

  const SOURCE = Object.freeze({ kind: 'generator', tool: 'ppp.g5b', version: '1.0.0' });

  /* Write `solveGraph`'s results into `Head.fingering` (docs/GOALS/G05 §3(b), G3-D4). Guard: a head
     that already carries a fingering VALUE is left alone unless that value's own provenance is
     'inferred' (i.e. an earlier G5b run's own output, safe to recompute) — see the header for why this
     cannot be "skip when provOf(...).op is imported". One `Ops.edit` transaction for every head, so
     applying to a whole corpus file costs one validate/seal pass, not one per head. */
  function write(g, results, opts) {
    opts = opts || {};
    const res = Ops.edit(g, d => {
      results.forEach(r => {
        if (r.finger == null) return;
        let h;
        try { h = d.head(r.headId); } catch (e) { return; }
        if (Array.isArray(h.fingering) && h.fingering.length > 0) {
          const op = Prov.provOf(g, r.headId, 'fingering').op;
          if (op !== 'inferred') return;
        }
        h.fingering = [{ f: String(r.finger) }];
        d.markProv(h, ['fingering'], 'inferred');
        d.touch();
      });
    }, { source: opts.source || SOURCE, validate: opts.validate });
    return { graph: res.graph, idMap: res.idMap, issues: res.issues, written: res.changed };
  }

  /* solveGraph + write in one call — the common case (tests, measurement, a future G5c). */
  function fingerGraph(g, opts) {
    const solved = solveGraph(g, opts);
    return Object.assign({ before: g }, write(g, solved.results, opts), { solved: solved });
  }

  return Object.freeze({
    SPANS, W, PHRASE_REST_BEATS, SOURCE,
    isBlack, keyX, dist, span, pairCost, lineCost, frame, chordStep, gapFactor, stepCost, selfCost,
    tripleCost, candidates, solve, solveHand, beats, eventsForHand, solveGraph, write, fingerGraph
  });
});
