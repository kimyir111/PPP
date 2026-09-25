/* ============================================================================
   PPP engrave — a ScoreGraph for every score on screen (docs/GOALS/G04 §8.2, G4-D2)

   The app's screens hold a legacy Score. The renderer is to draw a
   ScoreGraph. createSource() is where the two meet:

     remember(score, graph | () => graph, producer)
         the graph a producer made the Score from (an import, a transcription,
         a catalogue piece), kept beside the Score in memory only
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

   Identity is by content, not by object. A producer's graph is found for the
   Score object it was made with, or - when the app has since replaced that
   object with another holding the same music (a copy, a Score read back from
   its slot) - by the Score's music hash among the last few producers. Results
   are remembered per Score object together with that hash, so a Score changed
   in place is resolved again, and a song's graph is kept once per song and
   music hash, not per Score id.

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
  /* how scoreHash reads a Score (h2: chords compared at the chord, legacy-score chordLevel); a kept record hashed another way
     is checked by agree() again before it is used */
  const HASH_VERSION = 'h2';
  /* how many recent producers' graphs are kept for finding a replaced Score object by its music */
  const RECENT = 8;

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

  /* hand the main thread back between the heavy steps of a save (the page passes requestIdleCallback) */
  const defaultYield = () => new Promise(r => setTimeout(r, 0));

  function createSource(opts) {
    opts = opts || {};
    const store = opts.store || null;
    const yieldNow = opts.yield || defaultYield;
    /* score => true when the Score's notation was worked out by PPP (a transcription), for fromScore's provenance;
       the page passes the app's own inferredAudioNotation */
    const inferredOf = typeof opts.inferred === 'function' ? opts.inferred : null;
    const live = new WeakMap();
    const recent = [];
    const memo = new WeakMap();
    const stats = { remembered: 0, resolved: { live: 0, store: 0, projected: 0, none: 0 }, byContent: 0, persisted: 0, persist: {},
      disagree: 0, revalidated: 0 };
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
      entry.score = score;
      entry.persisted = new Set();
      entry.pending = new Map();
      live.set(score, entry);
      memo.delete(score);
      recent.push(entry);
      if (recent.length > RECENT) recent.shift();
      stats.remembered++;
      return true;
    }
    /* The producer's graph for this Score: the one remembered with this very object, else the most recent one
       remembered with a Score of the same music (the app replaced the object). agree() still decides. */
    function entryFor(score, hash) {
      const e = live.get(score);
      if (e) return e;
      for (let i = recent.length - 1; i >= 0; i--) {
        const r = recent[i];
        if (r.hash === undefined) { try { r.hash = scoreHash(r.score); } catch (err) { r.hash = null; } }
        if (r.hash === hash) { stats.byContent++; return r; }
      }
      return null;
    }

    function fromLive(score, hash, diagnostics) {
      const entry = entryFor(score, hash);
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
      try { fr = L.fromScore(score, { inferred: inferredOf ? !!inferredOf(score) : undefined }); }
      catch (e) { fr = { ok: false, error: String(e && e.message) }; }
      if (!fr.ok) {
        diagnostics.push({ code: 'PROJECTION_FAILED', detail: fr.error || null });
        return { graph: null, via: 'none', link: { ok: false, byNote: [] }, agree: null, unsupported: fr.unsupported || [], diagnostics: diagnostics };
      }
      const ag = L.agree(score, fr.graph);
      /* The notes are linked whenever they all came back, even if something else the graph refuses did not (an
         ending closed with no opening, a hairpin never opened - named in `unsupported`); only when notes themselves
         are missing is fromScore's own map what there is, and the notes it could not rebuild stay unlinked. */
      const full = L.link(score, fr.graph);
      const link = full.ok ? full : { ok: false, byNote: fr.byNote, mismatch: full.mismatch };
      if (!ag.ok) diagnostics.push({ code: 'PROJECTION_DISAGREES', detail: ag.diffs[0] || null });
      return { graph: fr.graph, via: 'projected', link: link, agree: ag, unsupported: fr.unsupported, removed: fr.removed, diagnostics: diagnostics };
    }

    function finish(score, hash, res) {
      count(stats.resolved, res.via);
      res.scoreHash = hash;
      memo.set(score, { hash: hash, res: res });
      return res;
    }
    /* a result for this Score object, if its music is still what it was when resolved */
    const known = (score, hash) => { const m = memo.get(score); return m && m.hash === hash ? m.res : null; };

    function resolveSync(score) {
      const hash = scoreHash(score);
      const k = known(score, hash);
      if (k) return k;
      const diagnostics = [];
      return finish(score, hash, fromLive(score, hash, diagnostics) || projected(score, diagnostics));
    }

    async function resolve(score, ropts) {
      ropts = ropts || {};
      const hash = scoreHash(score);
      /* a projection made earlier does not stand in for a graph the store may still have */
      const k = known(score, hash);
      if (k && k.via !== 'projected' && k.via !== 'none') return k;
      const diagnostics = [];
      const l = fromLive(score, hash, diagnostics);
      if (l) return finish(score, hash, l);
      if (store && ropts.key && ropts.key !== 'demo') {
        const got = await fromStore(ropts.key, score, hash, diagnostics);
        if (got) return finish(score, hash, got);
      }
      return finish(score, hash, projected(score, diagnostics));
    }

    /* The kept graph, when it is this Score's and still states its music. A record kept under this library and hash
       version, of this schema, was found to agree when kept and its music hash is the Score's: that is enough, and
       link() checks every note. Otherwise - another library, another hash, a migrated schema - agree() decides again,
       and a graph that still agrees is kept again under this library.
       A record that is not this Score's - another Score under the key, the music since changed, a graph that no
       longer agrees - is not used, and it is not deleted either: the Score asked about may be one the song has not
       saved (a review-screen arrangement), and the song's own graph must outlive that question (final review,
       G4-U1). The next save of the song replaces it; one that cannot be read at all (store.get) or whose notes no
       longer link is dropped. */
    async function fromStore(key, score, hash, diagnostics) {
      const r = await store.get(key);
      if (!r.ok) { if (r.code !== 'missing') diagnostics.push({ code: 'STORE_' + r.code.toUpperCase().replace(/-/g, '_') }); return null; }
      const rec = r.record;
      if (rec.scoreId !== score.id) { diagnostics.push({ code: 'STORE_OTHER_SCORE' }); return null; }
      const sameRules = rec.agreeLib === SG.version && rec.hashV === HASH_VERSION && !r.migrated;
      if (sameRules && rec.scoreHash !== hash) { diagnostics.push({ code: 'STORE_STALE' }); return null; }
      let ag = { ok: true, diffs: [], info: [] };
      if (!sameRules) {
        ag = L.agree(score, r.graph);
        if (!ag.ok) { diagnostics.push({ code: 'STORE_INCOMPATIBLE', detail: ag.diffs[0] || null }); return null; }
        stats.revalidated++;
        diagnostics.push({ code: 'STORE_REVALIDATED', detail: { lib: rec.agreeLib, hashV: rec.hashV, migrated: !!r.migrated } });
        await store.put(key, r.graph, { via: 'revalidated', scoreId: score.id, scoreHash: hash, hashV: HASH_VERSION, agreeLib: SG.version,
          producer: rec.producer });
      }
      const link = L.link(score, r.graph);
      if (!link.ok) { diagnostics.push({ code: 'STORE_LINK_FAILED', detail: link.mismatch }); await store.del(key); return null; }
      return { graph: r.graph, via: 'store', producer: rec.producer, link: link, agree: ag, unsupported: [], migrated: !!r.migrated,
        revalidated: !sameRules, diagnostics: diagnostics };
    }

    /* Keep the producer's graph for this song. Only a live graph that agrees with the Score is kept, once per song and
       music hash; a failure of any kind is counted and leaves the next save free to try again. Nothing throws into the
       save it runs beside. The heavy steps (agree, the canonical text, gzip) each run after the page yields. */
    async function persist(key, score) {
      let code = 'error';
      try {
        if (!store) return done({ ok: false, code: 'no-store' });
        if (!key || key === 'demo' || !score) return done({ ok: false, code: 'no-key' });
        await yieldNow();
        const hash = scoreHash(score);
        const entry = entryFor(score, hash);
        if (!entry) return done({ ok: false, code: 'no-live-graph' });
        const job = key + '|' + hash;
        if (entry.persisted.has(job)) return done({ ok: true, code: 'already' });
        if (entry.pending.has(job)) return entry.pending.get(job);
        const run = (async () => {
          try {
            const g = liveGraph(entry);
            if (!g) return { ok: false, code: 'no-graph' };
            /* agree(), in its two halves: each side read in its own step */
            await yieldNow();
            const mine = L.comparable(score);
            await yieldNow();
            const theirs = L.comparable(L.toScore(g));
            await yieldNow();
            const ag = L.agreeFrom(mine, theirs);
            if (!ag.ok) { stats.disagree++; return { ok: false, code: 'disagree', detail: ag.diffs[0] || null }; }
            await yieldNow();
            const text = SG.serialize(g);
            await yieldNow();
            const r = await store.put(key, g, { via: 'live', text: text, scoreId: score.id, scoreHash: hash, hashV: HASH_VERSION,
              agreeLib: SG.version, producer: entry.producer });
            if (r.ok) { entry.persisted.add(job); stats.persisted++; }
            return r;
          } catch (e) {
            return { ok: false, code: 'error', detail: String(e && e.message) };
          }
        })();
        entry.pending.set(job, run);
        let r;
        try { r = await run; } finally { entry.pending.delete(job); }
        return done(r);
      } catch (e) {
        return done({ ok: false, code: code, detail: String(e && e.message) });
      }
      function done(r) { count(stats.persist, r.ok ? (r.code === 'already' ? 'already' : 'ok') : r.code); return r; }
    }

    async function forget(key) { return store ? store.del(key) : false; }

    return { remember, resolve, resolveSync, persist, forget, stats, store, scoreHash, HASH_VERSION,
      hasLive: score => live.has(score) };
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

  return Object.freeze({ scoreHash, HASH_VERSION, createSource, identity });
});
