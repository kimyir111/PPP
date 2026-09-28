/* ============================================================================
   PPP SongGraph (docs/GOALS/G07_SONGGRAPH_CORE.md) — G7a: SongGraph analysis over a ScoreGraph.

   A pure-function UMD module outside the app file, alongside scoregraph/, playability/ and
   difficulty/. Not loaded by the app (G07 §10/§13): Node-only.

     keys        keyRegionsOf(g): regionKeys() reused directly (songgraph/keys.js)
     harmony     harmonyOf(g): a chord per beat window (songgraph/harmony.js)
     voices      melodyBassOf(g), voiceRolesOf(g) (songgraph/voices.js)
     sections    sectionsOf(g), promoteSections (songgraph/sections.js)
     phrases     phrasesOf(g), promotePhrases (songgraph/phrases.js)
     energy      energyOf(g): a per-measure density/intensity curve (songgraph/energy.js)

   analyze(g, opts) -> a SongGraph: every pass above, plus `ref` (scoregraph/serialize.js's
   scoreRef(g): {scoreId, rev, fp}) — the "what ScoreGraph did this analyse" pointer the design
   doc's direction rule (G07 §1) requires. A SongGraph never copies notes and is never itself
   written into the ScoreGraph; the ScoreGraph never points back at it.

   isFresh(g, sg) / refresh(g, sg, opts): fingerprint(g) recomputed and compared to sg.ref.fp — a
   graph edit invalidates a cached SongGraph, and refresh() re-analyses from scratch rather than
   ever serving stale output (G07 §5 "Freshness"; this phase does not implement the idMap-remap
   fast path the design doc allows as an alternative — re-analysis is correct and, per §8's
   ≤500ms/piece budget being met with room to spare, cheap enough that the fast path is not needed
   yet; noted in the design doc's §12 as a real, not-yet-taken optimization, not a gap in
   correctness).

   promote(g, sg, opts) -> {graph, sectionIdMaps, phraseIdMaps}: the ONLY way sections/phrases
   become first-class graph objects (G07 §1, §5 "Promotion") — every call goes through
   ops.addSection/ops.addPhrase (scoregraph/ops.js), each with prov {op:'inferred', source:
   {kind:'generator', tool:'ppp.songgraph.<pass>'}}. Nothing in this module ever writes
   g.structure directly.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../scoregraph/serialize.js'), require('./keys.js'), require('./harmony.js'),
      require('./voices.js'), require('./sections.js'), require('./phrases.js'), require('./energy.js'));
  } else {
    const M = root.PPPSongGraphModules = root.PPPSongGraphModules || {};
    root.PPPSongGraph = factory(root.PPPScoreGraphModules.serialize, M.keys, M.harmony, M.voices, M.sections, M.phrases, M.energy);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Z, K, H, V, SEC, PH, E) {
  'use strict';

  const version = '0.1.0';

  function analyze(g, opts) {
    opts = opts || {};
    return {
      version: version,
      ref: Z.scoreRef(g),
      keyRegions: K.keyRegionsOf(g, opts),
      harmony: opts.part ? H.harmonyOf(g, opts) : H.harmonyOf(g),
      melodyBass: V.melodyBassOf(g, opts),
      voiceRoles: V.voiceRolesOf(g, opts),
      sections: SEC.sectionsOf(g),
      phrases: PH.phrasesOf(g, opts),
      energy: E.energyOf(g, opts)
    };
  }

  function isFresh(g, sg) { return !!(sg && sg.ref && sg.ref.fp === Z.fingerprint(g)); }

  function refresh(g, sg, opts) { return isFresh(g, sg) ? sg : analyze(g, opts); }

  /* Promote every candidate section, then every candidate phrase (a phrase may name a `section`
     id — only meaningful once the sections it could refer to already exist). */
  function promote(g, sg, opts) {
    opts = opts || {};
    let out = g;
    const secRes = SEC.promoteSections(out, sg.sections, opts.sections);
    out = secRes.graph;
    const phraseCandidates = [];
    (sg.phrases || []).forEach(pp => (pp.phrases || []).forEach(ph => {
      phraseCandidates.push({ part: pp.part, from: ph.from, to: ph.to });
    }));
    const phRes = PH.promotePhrases(out, phraseCandidates, opts.phrases);
    out = phRes.graph;
    return { graph: out, sectionIdMaps: secRes.idMaps, phraseIdMaps: phRes.idMaps };
  }

  return Object.freeze({
    version: version, keys: K, harmony: H, voices: V, sections: SEC, phrases: PH, energy: E,
    analyze: analyze, isFresh: isFresh, refresh: refresh, promote: promote
  });
});
