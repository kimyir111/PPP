/* ============================================================================
   PPP engrave — the engraving layer (docs/GOALS/G04)

   G4a: where the renderer's ScoreGraph comes from, and what it must draw.
     source    createSource(): a graph for every Score (live, kept, rebuilt),
               identity(): the practice map from plan events to Score notes
     store     the graph cache (IndexedDB in the browser, G4-U1)
     plan      plan(graph, config): the NotationPlan and its ledger
     ledger    inventory() and audit(): nothing a graph states goes unaccounted
   Layout, SVG and the renderer switch are G4b and later. Nothing here changes
   what the app draws: the legacy renderer stays the default.

   Browser order: ledger, plan-beams, plan-tuplets, plan, store, source, index,
   after scoregraph/*.js and audio-score.js. Leaves window.PPPEngrave, with
   PPPEngrave.app: the app's one source, over IndexedDB when there is one.
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
  const ledger = get('ledger'), plan = get('plan'), store = get('store'), source = get('source');

  /* what G4 stage this is, so a stale script is visible in a report */
  const version = '0.1.0-g4a';

  let app = null;
  /* The app's single source. Created on first use, over IndexedDB when the browser has it (a private window
     may not): without it graphs are simply not kept between visits, and a reload rebuilds one from the Score. */
  function appSource() {
    if (app) return app;
    let st = null;
    try {
      if (browser && browser.indexedDB) st = store.createStore({ backend: store.idbBackend(browser.indexedDB) });
    } catch (e) { st = null; }
    app = source.createSource({ store: st });
    return app;
  }

  return Object.freeze({
    version: version,
    ledger: ledger, store: store,
    plan: plan.plan, PLAN_VERSION: plan.PLAN_VERSION, PLAN_DEFAULTS: plan.DEFAULTS, onsetKey: plan.onsetKey,
    inventory: ledger.inventory, audit: ledger.audit,
    createSource: source.createSource, identity: source.identity, scoreHash: source.scoreHash,
    get app() { return appSource(); }
  });
});
