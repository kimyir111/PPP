/* Adapters: a legacy arranger's own output -> playability/analyze.js's Attack shape, without going
   through a ScoreGraph (none of the three legacy arrangers produce one). Each arranger's notes already
   carry {m (measure number), b (beat offset, quarters), dur (quarters), midi, hand: 'l'|'r'|'x'} or
   equivalent; this file only does unit conversion (quarters -> seconds via the arrangement's own tempo)
   and grouping (same hand + same onset = one Attack), the same job playability/graph.js does for a
   ScoreGraph. G05 §3(a)'s "playability baseline of all three legacy arrangers run over their own
   output" (closing half of G0 Step 14) is measured this way in arranger-baseline.test.js. */
'use strict';

/* notes: [{m, b, dur, midi, hand}], tempo: quarters per minute (qpm) - the wire-score convention
   arrange_score.py and the app's ScoreArranger both use (a "quarter" is 1.0 in their b/dur units). */
function attacksFromWireNotes(notes, tempo) {
  const qpm = tempo > 0 ? tempo : 96;
  const secPerQ = 60 / qpm;
  const groups = new Map();
  notes.forEach(n => {
    if (n.midi == null || n.hand === 'x') return;
    const hand = n.hand === 'l' ? 'LH' : 'RH';
    const key = hand + '@' + n.m + ':' + n.b.toFixed(6);
    if (!groups.has(key)) groups.set(key, { limb: hand, m: 'm' + n.m, onsetQAbs: (n.m - 1) * 1000 + n.b, heads: [] });
    groups.get(key).heads.push({ id: 'n' + groups.size + '.' + groups.get(key).heads.length, midi: n.midi, offQAbs: (n.m - 1) * 1000 + n.b + n.dur });
  });
  const attacks = Array.from(groups.values()).map(a => {
    a.onsetSec = a.onsetQAbs * secPerQ;
    a.heads.forEach(h => { h.offSec = h.offQAbs * secPerQ; });
    a.midis = a.heads.map(h => h.midi).sort((x, y) => x - y);
    return a;
  });
  attacks.sort((x, y) => x.onsetSec - y.onsetSec || (x.limb < y.limb ? -1 : 1));
  return attacks;
}

/* audio-score.js's arrangeNotes has no hand split at all (docs/PPP_MASTER_ROADMAP.md §5.3: "a subset of
   heard notes") - every kept note is one performer's one hand. All assigned 'RH' here only so the
   analyzer's per-hand grouping has something to group; a single-stream input never triggers a
   two-hand-only check (crossing) but every per-hand check (span, keys, velocity, holds) still applies,
   which is the honest reading of "one hand plays whatever this arranger kept". */
function attacksFromAudioScoreNotes(notes) {
  const groups = new Map();
  notes.forEach(n => {
    const key = n.on.toFixed(6);
    if (!groups.has(key)) groups.set(key, { limb: 'RH', m: 'm1', onsetSec: n.on, heads: [] });
    groups.get(key).heads.push({ midi: n.midi, offSec: n.off });
  });
  const attacks = Array.from(groups.values()).map(a => {
    a.midis = a.heads.map(h => h.midi).sort((x, y) => x - y);
    return a;
  });
  attacks.sort((x, y) => x.onsetSec - y.onsetSec);
  return attacks;
}

module.exports = { attacksFromWireNotes, attacksFromAudioScoreNotes };
