/* ============================================================================
   PPP engrave — the engraving layer (docs/GOALS/G04)

   G4a: where the renderer's ScoreGraph comes from, and what it must draw.
     source    createSource(): a graph for every Score (live, kept, rebuilt),
               identity(): the practice map from plan events to Score notes
     store     the graph cache (IndexedDB in the browser, G4-U1)
     plan      plan(graph, config): the NotationPlan and its ledger
     ledger    inventory() and audit(): nothing a graph states goes unaccounted
   G4b: where it is drawn (the layout core; the app does not load it yet).
     metrics   glyph sizes from the pinned font data
     space     springs and rods: horizontal spacing
     breaks    screen line breaking (G4-U4)
     skyline   extents, placement, clearance, hard-collision checks
     canon     the EngravedScore's canonical form and hash
     notation  G4c: stem directions, beams, rests between voices, tuplets
     layout    prepare(plan), layout(prepared, config): the EngravedScore
     practice  the practice map (ids -> geometry) and the highlighter
     outlines  G4c: the pinned Bravura outlines (generated)
     svg       G4c: svg(engraved, plan): the EngravedScore as an SVG string
     metrics-text  G4d-1a: text widths from the page's fonts (generated)
     curves    G4d-1a: ties, slurs, glissandi (Bezier geometry)
     marks     G4d-1a: ties, tuplets, articulations, ornaments, fermatas,
               slurs, glissandi and fingering placed through the skylines
     sysmarks  G4d-1b: the marks attached to systems - lyrics, dynamics and
               hairpins, pedal, octave lines, chord names, voltas, tempo,
               rehearsal marks, jumps, words - placed through the same skylines
   Pages and the renderer switch are G4d-2-G4f.
   Nothing here changes what the app draws: the legacy renderer stays the
   default.

   Browser order: ledger, plan-beams, plan-tuplets, plan, store, source, index,
   after scoregraph/*.js and audio-score.js; the layout files (metrics,
   metrics-text, space, breaks, skyline, canon, notation, curves, marks,
   sysmarks, layout, practice, outlines, svg), where loaded, go before index.js.
   The app does not load them until the renderer switch (G4f); without them
   PPPEngrave.layout is null. Leaves window.PPPEngrave, with PPPEngrave.app:
   the app's one source, over IndexedDB when there is one.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(name => require('./' + name + '.js'), null);
  } else {
    const M = root.PPPEngraveModules || {};
    root.PPPEngrave = factory(name => {
      const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (!M[key]) throw new Error('PPPEngrave: engrave/' + name + '.js is not loaded (load it before index.js)');
      return M[key];
    }, root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (get, browser) {
  'use strict';
  const ledger = get('ledger'), glyphs = get('glyphs'), plan = get('plan'), store = get('store'), source = get('source');
  /* the layout core: always in Node; in a browser only where a page loads it (the app does not, before G4f) */
  const optional = name => { if (!browser) return get(name); try { return get(name); } catch (e) { return null; } };
  const layout = optional('layout'), practice = optional('practice'), canon = optional('canon'), metrics = optional('metrics'), svg = optional('svg');

  /* what G4 stage this is, so a stale script is visible in a report */
  const version = '0.5.0-g4d1b';

  let app = null;
  /* The app's single source. Created on first use, over IndexedDB when the browser has it (a private window
     may not): without it graphs are simply not kept between visits, and a reload rebuilds one from the Score.
     A save's heavy steps wait for idle time; the cache stops writing before the origin's storage runs short
     (navigator.storage.estimate), leaving the room to the song videos; a Score rebuilt into a graph is marked
     inferred exactly when the app itself calls its notation inferred (PPP.inferredAudioNotation). */
  function appSource() {
    if (app) return app;
    let st = null;
    try {
      if (browser && browser.indexedDB) {
        const nav = browser.navigator;
        const estimate = nav && nav.storage && typeof nav.storage.estimate === 'function' ? () => nav.storage.estimate() : null;
        st = store.createStore({ backend: store.idbBackend(browser.indexedDB), estimate: estimate });
      }
    } catch (e) { st = null; }
    const idle = browser && typeof browser.requestIdleCallback === 'function'
      ? () => new Promise(r => browser.requestIdleCallback(() => r(), { timeout: 2000 }))
      : () => new Promise(r => setTimeout(r, 0));
    const inferred = score => {
      const P = browser && browser.PPP;
      return P && typeof P.inferredAudioNotation === 'function' ? P.inferredAudioNotation(score) : undefined;
    };
    app = source.createSource({ store: st, yield: idle, inferred: s => { const v = inferred(s); return v === undefined ? SGL().scoreNotationInferred(s) : v; } });
    return app;
  }
  const SGL = () => (browser && browser.PPPScoreGraph ? browser.PPPScoreGraph.legacy : require('../scoregraph/index.js').legacy);

  return Object.freeze({
    version: version,
    ledger: ledger, store: store, glyphs: glyphs,
    plan: plan.plan, PLAN_VERSION: plan.PLAN_VERSION, PLAN_DEFAULTS: plan.DEFAULTS, onsetKey: plan.onsetKey,
    inventory: ledger.inventory, audit: ledger.audit,
    createSource: source.createSource, identity: source.identity, scoreHash: source.scoreHash,
    layout: layout, practice: practice, metrics: metrics,
    engrave: layout ? layout.engrave : null, layoutHash: canon ? canon.hash : null,
    /* G4c: the SVG backend (EngravedScore -> an SVG string) */
    svg: svg ? svg.svg : null,
    get app() { return appSource(); }
  });
});
