/* ============================================================================
   PPP ScoreGraph - triplets of a recording (docs/GOALS/G09 section 12: "Recording notation: tuplets and the grid")

     addTriplets(graph) -> { graph, changed, stats, issues }

   A recording's quantiser (audio-score.js) decides which beats of a piece are a triplet feel (three notes on the thirds of a beat), and writes the events in them as the plain values
   a triplet is printed with: a third of a beat (1/12 of a whole note in 4/4) is an eighth, two thirds (1/6) a quarter, and a rest in a triplet is printed with the same plain value.
   What it never wrote is the tuplet: a bar of such a voice added up to more than 4/4 as drawn (bar 12 of the teacher's piece showed six beats), and the one-note tuplets it did
   write for a note of exactly a third or two thirds of a beat (one bracket per note, "3" over each) are not what a printed edition does (one bracket per beat), and gave none to a rest.

   The rule, per voice and measure of a SIMPLE-TIME bar whose beat is a quarter (4/4, 3/4, 2/4 ...; a compound, additive or other-beat measure and a measure that is not the
   metre's full length are never touched): for each beat, the events (notes, chords and rests alike; grace notes are not events of the beat) that START in the beat are a TRIPLET
   BEAT when they tile it exactly - the first starts at the beat's start, each next starts where the one before ends, the last ends at the beat's end - and every one of them is a third of
   the beat or two thirds of it, printed as the value that is 3:2 of its length (an eighth for a third, a quarter for two thirds), and there are at least two of them. That beat gets ONE
   3:2 tuplet spanner over those events, in unit eighth (3 eighths in the time of 2: the bracket of a beat, whatever mix of thirds and two-thirds it holds: a quarter and an eighth, a
   rest and two eighths). Nothing else changes: no onset, no length, no printed value; the sound is the sound it was.
   A beat the rule does not describe (one note a whole beat long, a straight beat, a beat with a note that crosses into it, one with an odd length) is left as it was.

   Tuplets that are already there: an event that is in a ONE-NOTE tuplet (audio-score.js's own: one per note of a third or two thirds) in a beat the rule describes is moved to the beat's
   tuplet (the one-note spanner goes: no event is in two tuplets); a tuplet that is anything else (imported, another ratio, nested, longer than the beat) is kept, and a beat that
   shares an event with one is left alone. A tuplet that is the very one this pass would make (same events, 3:2, unit eighth) is kept as it is.

   Idempotent: a graph it has run on holds exactly the tuplets it would make, so a second run returns the very same object. Never a throw: a graph the pass does not understand comes
   back as it is, with `stats.failed` saying why. Gated by its callers (a recording: audio-score.js, repair/index.js for the arrangement of one), like scoregraph/gaps.js; on any other
   graph it is simply not called. Node and browser (a <script> after scoregraph/ops.js and rational.js).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ops.js'), require('./rational.js'), require('./schema.js'));
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.recTuplet = factory(M.ops, M.rational, M.schema); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (OPS, R, S) {
  'use strict';

  const TUPLET_SOURCE = Object.freeze({ kind: 'repair', tool: 'ppp.recording-tuplets', version: '1.0.0' });
  const THIRD = R.make(1, 3);

  /* is this graph a transcription (a recording's heard notes turned into a score by audio-score.js)? the same test as scoregraph/gaps.js */
  function isTranscription(g) { return !!(g && g.provenance && (g.provenance.sources || []).some(x => x.kind === 'audio-score')); }

  /* the printed value of an event, as a rational; null when it has none */
  function printed(e) {
    if (!e.display || !e.display.type) return null;
    return S.noteValue(e.display.type, e.display.dots) || null;
  }

  /* the beat (whole notes) of the metre in force in each measure when it is a simple one with a quarter-note beat; else null */
  function measureBeats(g) {
    const byM = new Map((g.timeline.meters || []).map(x => [x.m, x]));
    let cur = null;
    return g.timeline.measures.map(m => {
      if (byM.has(m.id)) cur = byM.get(m.id);
      if (!cur || !Array.isArray(cur.beats) || cur.beats.length !== 1 || cur.beatType !== 4) return null;
      if (Array.isArray(cur.groups) && cur.groups.length) return null;
      const nominal = R.make(cur.beats[0], 4);
      return R.eq(R.parse(m.dur), nominal) ? { beats: cur.beats[0], beat: R.make(1, 4) } : null;
    });
  }

  /* the triplet beats of one voice-measure: [{events: [event], first: index}] (events sorted by onset); `evs` are the non-grace events of the voice in the measure */
  function tripletBeatsOf(evs, info) {
    const out = [];
    const third = R.mul(info.beat, THIRD), twoThirds = R.mul(info.beat, R.make(2, 3));
    for (let k = 0; k < info.beats; k++) {
      const bs = R.mul(info.beat, R.make(k, 1)), be = R.add(bs, info.beat);
      const inBeat = evs.filter(e => { const at = R.parse(e.at); return R.ge(at, bs) && R.lt(at, be); });
      if (inBeat.length < 2) continue;
      let cur = bs, ok = true;
      for (const e of inBeat) {
        const at = R.parse(e.at), d = R.parse(e.dur);
        if (!R.eq(at, cur) || !(R.eq(d, third) || R.eq(d, twoThirds))) { ok = false; break; }
        const v = printed(e);
        if (!v || !R.eq(R.mul(v, R.make(2, 3)), d) || (e.display && e.display.measureRest)) { ok = false; break; }
        cur = R.add(at, d);
      }
      if (ok && R.eq(cur, be)) out.push(inBeat);
    }
    return out;
  }

  function addTriplets(g) {
    try { return addTripletsUnsafe(g); } catch (e) { /* never a throw (a graph this pass does not understand is returned as it is) */
      return { graph: g, changed: false, stats: { beats: 0, tuplets: 0, restsInside: 0, replaced: 0, kept: 0, skipped: 0, failed: String(e && e.message || e).slice(0, 120) }, issues: [] };
    }
  }

  function addTripletsUnsafe(g) {
    const stats = { beats: 0, tuplets: 0, restsInside: 0, replaced: 0, kept: 0, skipped: 0 };
    const infos = measureBeats(g);
    const mIndex = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
    const batches = [];                                   /* per part: [{voice, m, groups}] */
    g.parts.forEach(part => {
      const tupsOf = new Map();                           /* event id -> its tuplets */
      part.spanners.forEach(s => { if (s.type === 'tuplet') (s.events || []).forEach(id => { if (!tupsOf.has(id)) tupsOf.set(id, []); tupsOf.get(id).push(s); }); });
      const by = new Map();
      part.events.forEach(e => {
        if (e.grace || (e.kind !== 'note' && e.kind !== 'rest')) return;
        const k = e.voice + '|' + e.m;
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(e);
      });
      const items = [];
      by.forEach(evs => {
        const mi = mIndex.get(evs[0].m);
        const info = mi === undefined ? null : infos[mi];
        if (!info) { stats.skipped++; return; }
        evs.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)));
        const inside = new Set(evs.map(e => e.id));
        const found = tripletBeatsOf(evs, info);
        /* the tuplets of this voice-measure that stay as they are, and the groups to make */
        const existing = [];
        evs.forEach(e => (tupsOf.get(e.id) || []).forEach(s => { if (existing.indexOf(s) < 0) existing.push(s); }));
        const dropped = new Set();                        /* one-note tuplets this pass replaces */
        const groups = [];
        found.forEach(list => {
          const ids = list.map(e => e.id), idSet = new Set(ids);
          const touching = existing.filter(s => s.events.some(id => idSet.has(id)));
          const same = touching.find(s => s.events.length === ids.length && s.events.every((id, i) => id === ids[i]));
          /* every tuplet the beat shares an event with must be this very one or a one-note tuplet wholly inside the voice-measure (a spanner that leaves it, another ratio, a nested one: the beat is left alone) */
          const blocking = touching.some(s => s !== same && !(s.events.length === 1 && s.parent === undefined && s.events.every(id => inside.has(id))));
          if (blocking || (same && (same.actual !== 3 || same.normal !== 2 || same.parent !== undefined))) { stats.skipped++; return; }
          stats.beats++;
          touching.forEach(s => { if (s !== same) { dropped.add(s.id); stats.replaced++; } });
          if (same) { stats.kept++; return; }
          stats.tuplets++;
          stats.restsInside += list.filter(e => e.kind === 'rest').length;
          groups.push({ events: ids, actual: 3, normal: 2, unit: { type: 'eighth' }, isNew: true });
        });
        if (!groups.length && !dropped.size) return;
        /* the tuplets that stay: every existing one wholly inside the voice-measure that is not dropped, exactly as it is */
        const plan = [];
        existing.forEach(s => {
          if (dropped.has(s.id) || !s.events.every(id => inside.has(id))) return;
          const x = { events: s.events.slice(), actual: s.actual, normal: s.normal };
          ['unit', 'parent', 'show', 'printed', 'prov'].forEach(k => { if (s[k] !== undefined) x[k] = JSON.parse(JSON.stringify(s[k])); });
          plan.push(x);
        });
        groups.forEach(x => plan.push(x));
        items.push({ voice: evs[0].voice, m: evs[0].m, groups: plan });
      });
      if (items.length) batches.push({ part: part, items: items });
    });
    if (!batches.length) return { graph: g, changed: false, stats: stats, issues: [] };
    const res = OPS.edit(g, d => {
      batches.forEach(b => {
        b.items.forEach(it => it.groups.forEach(x => { if (x.isNew) { delete x.isNew; x.prov = { src: d.source() }; } }));
        d.setGroupsBatch('tuplet', b.items);
      });
    }, { source: TUPLET_SOURCE });
    return { graph: res.graph, changed: res.changed, stats: stats, issues: res.issues };
  }

  return Object.freeze({ TUPLET_SOURCE, addTriplets, isTranscription, tripletBeatsOf });
});
