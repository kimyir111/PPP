/* ============================================================================
   PPP engrave — a ScoreGraph for every score on screen (docs/GOALS/G04 §8.2, G4-D2)

   The app's screens hold a legacy Score. The renderer is to draw a
   ScoreGraph. createSource() is where the two meet:

     remember(score, graph | () => graph, producer)
         the graph a producer made the Score from (an import, a transcription,
         a catalogue piece), kept beside the Score object in memory only
     persist(key, score)      that graph into the store, under the song's key
     forget(key)              the song is gone: so is its graph
     resolve(score, {key})    -> Promise<RenderSource>
     resolveSync(score)       -> RenderSource, without the store

   A RenderSource is {graph, via, link, agree, unsupported, diagnostics}:
     via 'live'       the producer's own graph, and it states the same music
     via 'store'      the graph kept for this song, intact and not stale
     via 'projected'  legacy.fromScore(score): the Score is all there is
     via 'none'       not even that (the renderer keeps the legacy one)
   A graph is used only when it agrees with the Score (legacy.agree, the G2
   comparator): practice, playback and the page then speak of the same notes.

   identity(score, source, plan) is the practice map: for every plan event the
   Score notes it is (their indices, the legacy data-onset keys, positions,
   pitches, hands), and for every Score note its graph event.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('../scoregraph/index.js'), require('../scoregraph/serialize.js'), require('./plan.js'));
  else {
    const M = root.PPPEngraveModules = root.PPPEngraveModules || {};
    M.source = factory(root.PPPScoreGraph, (root.PPPScoreGraphModules || {}).serialize, M.plan);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SG, Z, Plan) {
  'use strict';

  const L = SG.legacy;

  /* The music of a Score, as a hash: what agree() compares, without the title, composer and score tempo. A kept
     graph is stale when this has changed since it was kept. Values are read the way compare() reads them - a null,
     an absent field and false are one thing, numbers to six places, keys in order - because a song slot drops the
     null fields of every note (packScore/unpackScore) and a reloaded Score must hash as it did before. */
  function norm(v) {
    if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const o = {};
      Object.keys(v).sort().forEach(k => { if (v[k] !== null && v[k] !== undefined && v[k] !== false) o[k] = norm(v[k]); });
      return o;
    }
    return v;
  }
  function scoreHash(score) {
    const c = L.comparable(score);
    delete c.title; delete c.composer; delete c.tempo;
    return Z.fnv1a64(Z.utf8(JSON.stringify(norm(c))));
  }

  function createSource(opts) {
    opts = opts || {};
    const store = opts.store || null;
    const live = new WeakMap();
    const memo = new WeakMap();
    const stats = { remembered: 0, resolved: { live: 0, store: 0, projected: 0, none: 0 }, persisted: 0, persist: {}, disagree: 0 };
    const count = (o, k) => { o[k] = (o[k] || 0) + 1; };

    const liveGraph = entry => {
      if (!entry) return null;
      if (entry.graph === undefined && entry.thunk) {
        try { entry.graph = entry.thunk() || null; } catch (e) { entry.graph = null; entry.error = String(e && e.message); }
        entry.thunk = null;
      }
      return entry.graph || null;
    };

    function remember(score, graph, producer) {
      if (!score || typeof score !== 'object' || !graph) return false;
      const entry = typeof graph === 'function' ? { thunk: graph } : { graph: graph };
      entry.producer = producer || null;
      live.set(score, entry);
      memo.delete(score);
      stats.remembered++;
      return true;
    }

    function fromLive(score, diagnostics) {
      const entry = live.get(score);
      const g = liveGraph(entry);
      if (!g) return null;
      const ag = L.agree(score, g);
      if (!ag.ok) {
        stats.disagree++;
        diagnostics.push({ code: 'SOURCE_DISAGREE', via: 'live', producer: entry.producer, detail: ag.diffs[0] || null });
        return null;
      }
      const link = L.link(score, g);
      if (!link.ok) { diagnostics.push({ code: 'LINK_FAILED', via: 'live', detail: link.mismatch }); return null; }
      return { graph: g, via: 'live', producer: entry.producer, link: link, agree: ag, unsupported: [], diagnostics: diagnostics };
    }

    function projected(score, diagnostics) {
      let fr;
      try { fr = L.fromScore(score); } catch (e) { fr = { ok: false, error: String(e && e.message) }; }
      if (!fr.ok) {
        diagnostics.push({ code: 'PROJECTION_FAILED', detail: fr.error || null });
        return { graph: null, via: 'none', link: { ok: false, byNote: [] }, agree: null, unsupported: fr.unsupported || [], diagnostics: diagnostics };
      }
      const ag = L.agree(score, fr.graph);
      /* when the projection states the same music, the full check links it; otherwise fromScore's own map is what
         there is, and the notes it could not rebuild stay unlinked */
      const link = ag.ok ? L.link(score, fr.graph) : { ok: false, byNote: fr.byNote, mismatch: 'projection disagrees' };
      if (!ag.ok) diagnostics.push({ code: 'PROJECTION_DISAGREES', detail: ag.diffs[0] || null });
      return { graph: fr.graph, via: 'projected', link: link, agree: ag, unsupported: fr.unsupported, removed: fr.removed, diagnostics: diagnostics };
    }

    function finish(score, res) {
      count(stats.resolved, res.via);
      memo.set(score, res);
      return res;
    }

    function resolveSync(score) {
      if (memo.has(score)) return memo.get(score);
      const diagnostics = [];
      return finish(score, fromLive(score, diagnostics) || projected(score, diagnostics));
    }

    async function resolve(score, ropts) {
      ropts = ropts || {};
      /* a projection resolveSync() made earlier does not stand in for a graph the store may still have */
      const known = memo.get(score);
      if (known && known.via !== 'projected' && known.via !== 'none') return known;
      const diagnostics = [];
      const l = fromLive(score, diagnostics);
      if (l) return finish(score, l);
      if (store && ropts.key && ropts.key !== 'demo') {
        const r = await store.get(ropts.key);
        if (r.ok) {
          const rec = r.record;
          if (rec.scoreId !== score.id) { diagnostics.push({ code: 'STORE_OTHER_SCORE' }); await store.del(ropts.key); }
          else if (rec.scoreHash !== scoreHash(score)) { diagnostics.push({ code: 'STORE_STALE' }); await store.del(ropts.key); }
          else {
            const link = L.link(score, r.graph);
            if (link.ok) return finish(score, { graph: r.graph, via: 'store', producer: rec.producer, link: link, agree: { ok: true, diffs: [], info: [] },
              unsupported: [], migrated: !!r.migrated, diagnostics: diagnostics });
            diagnostics.push({ code: 'STORE_LINK_FAILED', detail: link.mismatch });
            await store.del(ropts.key);
          }
        } else if (r.code !== 'missing') diagnostics.push({ code: 'STORE_' + r.code.toUpperCase().replace(/-/g, '_') });
      }
      return finish(score, projected(score, diagnostics));
    }

    /* Keep the producer's graph for this song. Only a live graph that agrees with the Score is kept, once per
       Score and key; everything that goes wrong is counted, and nothing throws into the save it runs beside. */
    async function persist(key, score) {
      try {
        if (!store) return { ok: false, code: 'no-store' };
        if (!key || key === 'demo' || !score) return { ok: false, code: 'no-key' };
        const entry = live.get(score);
        if (!entry) return { ok: false, code: 'no-live-graph' };
        if (entry.persisted === key + '|' + score.id) return { ok: true, code: 'already' };
        if (entry.pending) return entry.pending;
        entry.pending = (async () => {
          const g = liveGraph(entry);
          if (!g) return { ok: false, code: 'no-graph' };
          const ag = L.agree(score, g);
          if (!ag.ok) { stats.disagree++; return { ok: false, code: 'disagree' }; }
          const r = await store.put(key, g, { via: 'live', scoreId: score.id, scoreHash: scoreHash(score), producer: entry.producer });
          if (r.ok) { entry.persisted = key + '|' + score.id; stats.persisted++; }
          return r;
        })();
        const r = await entry.pending;
        entry.pending = null;
        count(stats.persist, r.ok ? 'ok' : r.code);
        return r;
      } catch (e) {
        count(stats.persist, 'error');
        return { ok: false, code: 'error' };
      }
    }

    async function forget(key) { return store ? store.del(key) : false; }

    return { remember, resolve, resolveSync, persist, forget, stats, store, scoreHash, hasLive: score => live.has(score) };
  }

  /* The practice map (G04 §8.2 link): which Score notes each plan event is. Everything the practice layer reads -
     the data-onset key the legacy renderer puts on a note, the absolute position a seek uses, the pitches MIDI
     feedback compares, the hand a filter hides - comes from the Score notes themselves, so the page and the app
     cannot disagree about what a note is. */
  function identity(score, src, plan) {
    const byNote = (src && src.link && src.link.byNote) || [];
    const events = {};
    let unmatchedNotes = 0;
    (score.notes || []).forEach((n, i) => {
      const l = byNote[i];
      if (!l) { unmatchedNotes++; return; }
      const x = events[l.event] = events[l.event] || { notes: [], heads: [], onsetKeys: [], midis: [], hands: [], abs: null, m: n.m };
      x.notes.push(i);
      if (l.head) x.heads.push(l.head);
      const k = n.m + '|' + (+n.b).toFixed(3) + '|' + n.staff;
      if (x.onsetKeys.indexOf(k) < 0) x.onsetKeys.push(k);
      if (n.midi != null) x.midis.push(n.midi);
      if (x.hands.indexOf(n.hand) < 0) x.hands.push(n.hand);
      if (x.abs === null && n.abs !== undefined) x.abs = n.abs;
    });
    const unmatchedEvents = [];
    if (plan) plan.events.forEach(e => { if (!e.grace && !events[e.id]) unmatchedEvents.push(e.id); });
    const measures = plan ? plan.measures.map((m, i) => {
      const sm = (score.measures || [])[i];
      return { id: m.id, number: sm ? sm.number : null, startQ: sm && sm.startQ !== undefined ? sm.startQ : null };
    }) : [];
    return {
      events: events, measures: measures,
      byNote: byNote.map(l => (l ? l.event : null)),
      unmatchedNotes: unmatchedNotes, unmatchedEvents: unmatchedEvents,
      complete: unmatchedNotes === 0 && unmatchedEvents.length === 0
    };
  }

  return Object.freeze({ scoreHash, createSource, identity });
});
