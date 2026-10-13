/* ============================================================================
   PPP code splitting (G13-4e; docs/GOALS/G13_PRODUCTIZATION.md, "G13-4e as built")

   Most of the 80 scripts the page used to name in its <head> are not needed to draw Home: the ScoreGraph library (30 files), the engraver's
   source and plan (8), audio-score.js, the arranger (playability, difficulty, songgraph, arrangement, realize: 20), the backup module and the
   lessons. They were 440 KB of gzip in front of the first paint. The head now keeps them as TEXT, in <noscript data-ppp-lazy="group"> blocks
   (a browser that runs scripts does not read a noscript's content as markup: nothing is requested for it, not even by the preload scanner),
   and this file decides what to do with each block:

     'on'   (default) the block is registered as a group. Nothing is fetched until the page asks (ensure) or has drawn its first frame (start):
            then the group's files are fetched, in parallel, and run in the order they were written, one per task. The globals the group
            makes (data-globals) are accessors until it is in: a read of one that comes too early loads the group synchronously (sync
            XMLHttpRequest, once) instead of seeing "undefined", so no caller can see a missing global - slower, never wrong.
     'off'  the block is written back into the page with document.write at the place it stands: the same scripts, in the same order, parser-
            inserted, as the page had before G13-4e. No accessor, no fetch of ours.

   The choice, like PPP.cdn and PPP.recording: ?split=on|off for this visit, the remembered localStorage 'ppp.split.v1' ('on' | 'off'), then
   the default. Anything else (a typo, null, a storage that throws) is no choice. This file is the whole mechanism; the app only asks it
   (PPP_LAZY.ensure / have / peek / start).

   A file asked for a second time (a failed one) carries &retry=<stamp>: the server answers such a url no-store (static-assets.js), so a
   stale cached failure or a stale hash cannot answer it - the rule the recovery of the head's scripts has always had.

   No dependencies; ES5 syntax (it runs in the head of every browser the app runs in). It also loads in Node (module.exports.create) so
   that tests/load/lazy-load.test.js can drive it with a fake window.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = { create: factory };
  else root.PPP_LAZY = factory(root);
})(typeof window !== 'undefined' ? window : this, function create(win, options) {
  'use strict';
  var doc = win.document;
  var KEY = 'ppp.split.v1';
  var DEFAULT = (options && options.defaultMode) || 'on';
  /* what the page needs first, then what a person is likely to open next, then the rest */
  var PRIORITY = (options && options.priority) || ['score', 'engrave', 'backup', 'lessons', 'audio', 'arranger'];

  function readMode() {
    var m = null;
    try { m = win.localStorage.getItem(KEY); } catch (e) { m = null; }
    try { var q = new win.URLSearchParams(win.location.search).get('split'); if (q === 'on' || q === 'off') m = q; } catch (e) { /* no address to read */ }
    return m === 'on' || m === 'off' ? m : DEFAULT;
  }
  /* a test switch: the address, then localStorage 'ppp.<name>' (a suite sets it before the page runs, without editing the address it opens) */
  function readSwitch(name, dflt) {
    try { var q = new win.URLSearchParams(win.location.search).get(name); if (q !== null) return q; } catch (e) { /* none */ }
    try { var v = win.localStorage.getItem('ppp.' + name); if (v !== null) return v; } catch (e) { /* none */ }
    return dflt;
  }
  var mode = readMode();
  /* a browser with no fetch or Promise cannot run the loader below: it gets the page as it was (every script in the head, written back) */
  if (mode === 'on' && (typeof win.fetch !== 'function' || typeof win.Promise !== 'function')) mode = 'off';
  /* tests only: ?splitStart=0 keeps the idle prefetch from ever starting, so that only what a caller asks for is loaded (and a caller that does not ask shows up in status().syncLoads) */
  var autoStart = readSwitch('splitStart', '1') !== '0';

  var groups = [];         /* document order */
  var byName = {};
  var managed = {};        /* global name -> { value, group } while the group is not in */
  var evaluating = 0;      /* > 0 while a lazy file runs: reads then see what is there, they never start a load */
  var syncLog = [];        /* the reads that had to load a group synchronously (diagnosis; capped) */
  var syncCount = 0;
  var started = false;
  var prefetched = null;   /* a promise: every group is in, or has given up */
  var resolvePrefetched = null;
  var stampValue = 0;

  function stamp() { return stampValue || (stampValue = Date.now()); }
  function withRetry(url) { return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'retry=' + stamp(); }

  /* ---- registering a block ---- */
  function split(v) { return String(v || '').split(/[\s,]+/).filter(Boolean); }
  function register(el) {
    var name = el.getAttribute('data-ppp-lazy');
    if (!name || byName[name]) return;
    var files = [];
    String(el.textContent || '').replace(/<script\s+src="([^"]+)"\s*>\s*<\/script>/g, function (all, src) {
      var url = src;
      try { url = new win.URL(src, doc.baseURI || win.location.href).href; } catch (e) { /* as written */ }
      files.push({ src: src, url: url, text: null, done: false, failures: 0 });
      return all;
    });
    var g = { name: name, files: files, after: split(el.getAttribute('data-after')), globals: split(el.getAttribute('data-globals')),
      done: false, failed: false, fetching: null, running: null, syncFailedAt: 0 };
    groups.push(g);
    byName[name] = g;
    g.globals.forEach(function (n) { manage(g, n); });
  }

  /* a global the group will make: until then a read loads the group (once, synchronously) and never answers "undefined" */
  function manage(g, name) {
    var m = { name: name, group: g, value: undefined };
    try {
      if (Object.prototype.hasOwnProperty.call(win, name)) m.value = win[name];   /* already there (a test, or the page): kept */
      Object.defineProperty(win, name, {
        configurable: true, enumerable: true,
        get: function () {
          if (m.value === undefined && !m.group.done) loadSync(m.group, name);   /* (loadSync does nothing while a lazy file is running) */
          return m.value;
        },
        set: function (v) { m.value = v; }
      });
      managed[name] = m;
    } catch (e) { /* not definable: the name stays a plain property, and the group still loads on demand */ }
  }
  function unmanage(name) {
    var m = managed[name];
    if (!m) return;
    delete managed[name];
    try { Object.defineProperty(win, name, { value: m.value, writable: true, configurable: true, enumerable: true }); } catch (e) { /* stays an accessor, harmless */ }
  }

  /* ---- getting the text ---- */
  /* one download of one file; callers share it through fetchGroup (a group's download is in g.fetching until it is in). A file that has failed once is asked for with
     &retry=<stamp>; one that has not is asked for by the page's own url - also by the synchronous path, so that it is answered from the cache the parallel download fills. */
  function urlOf(f) { return f.failures ? withRetry(f.url) : f.url; }
  function fetchFile(f) {
    if (f.done || f.text !== null) return Promise.resolve(true);
    var p;
    try {
      p = win.fetch(urlOf(f), { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      });
    } catch (e) { p = Promise.reject(e); }
    /* a file the synchronous path has run meanwhile does not keep its text */
    return p.then(function (t) { if (!f.done) f.text = t; return true; }, function () { f.failures++; return false; });
  }
  function fetchGroup(g) {
    if (g.done) return Promise.resolve(true);
    if (g.fetching) return g.fetching;
    g.fetching = Promise.all(g.files.map(fetchFile)).then(function (rs) { g.fetching = null; return rs.every(Boolean); });
    return g.fetching;
  }
  function xhrText(f) {
    try {
      var x = new win.XMLHttpRequest();
      x.open('GET', urlOf(f), false);
      x.send();
      if (x.status >= 200 && x.status < 300) return x.responseText;
    } catch (e) { /* the network is gone: null */ }
    f.failures++;
    return null;
  }

  /* ---- running it ---- */
  function run(f) {
    var text = f.text;
    f.text = null; f.done = true;
    evaluating++;
    try {
      var s = doc.createElement('script');
      s.text = text + '\n//# sourceURL=' + f.url;
      (doc.head || doc.documentElement).appendChild(s);   /* a classic script with text runs when it is inserted, before this call returns */
      if (s.parentNode) s.parentNode.removeChild(s);
    } finally { evaluating--; }
  }
  var chan = null, waiting = [];
  /* hand the thread back between files (a MessageChannel: a timer in a background tab is held to one tick a second, a message is not) */
  function tick() {
    return new Promise(function (resolve) {
      try {
        if (!chan) { chan = new win.MessageChannel(); chan.port1.onmessage = function () { var r = waiting.shift(); if (r) r(); }; }
        waiting.push(resolve);
        chan.port2.postMessage(0);
      } catch (e) { win.setTimeout(resolve, 0); }
    });
  }
  function present(n) { return managed[n] ? managed[n].value !== undefined : win[n] !== undefined; }
  /* the group has run: is what it promised there? If not (a file threw before it made its global) it starts over next time, as the recovery of the head's scripts did */
  function finish(g) {
    if (g.done) return true;
    if (!g.files.every(function (f) { return f.done; })) return false;
    if (!g.globals.every(present)) {
      g.files.forEach(function (f) { f.done = false; f.text = null; f.failures = Math.max(f.failures, 1); });
      g.failed = true;
      return false;
    }
    g.done = true; g.failed = false;
    g.globals.forEach(unmanage);
    return true;
  }
  function runFiles(g, i) {
    while (i < g.files.length && g.files[i].done) i++;
    if (i >= g.files.length) return Promise.resolve(true);
    run(g.files[i]);
    return tick().then(function () { return runFiles(g, i + 1); });
  }
  function runGroup(g) {
    if (g.done) return Promise.resolve(true);
    if (g.running) return g.running;
    var deps = g.after.map(function (n) { return byName[n]; }).filter(Boolean);
    g.running = Promise.all(deps.map(runGroup)).then(function (oks) {
      if (!oks.every(Boolean)) return false;
      return fetchGroup(g).then(function (ok) { return ok ? runFiles(g, 0) : false; });
    }).then(function (ok) { return ok && finish(g); }, function () { return false; })
      .then(function (ok) { g.running = null; if (!ok) g.failed = true; return ok; });
    return g.running;
  }
  /* the named groups and what each needs first, in the order they must run */
  function closure(names) {
    var out = [], seen = {};
    function add(n) {
      var g = byName[n];
      if (!g || seen[n]) return;
      seen[n] = true;
      g.after.forEach(add);
      out.push(g);
    }
    names.forEach(add);
    return out;
  }
  /* the synchronous way: for a read that comes before the group is in */
  function loadSync(g, why) {
    if (mode !== 'on' || g.done || evaluating) return;
    if (g.syncFailedAt && Date.now() - g.syncFailedAt < 5000) return;
    var list = closure([g.name]);
    /* the downloads of the whole closure start at once (they are not on this thread): the files below, asked for one by one, are then answered from the cache they fill, and the
       wait is about one download and not one round trip for every file */
    list.forEach(function (h) { if (!h.done) fetchGroup(h); });
    syncCount++;
    if (syncLog.length < 40) syncLog.push({ group: g.name, global: why || null, stack: String(new Error().stack || '').split('\n').slice(2, 9).join('\n') });
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      if (h.done) continue;
      for (var j = 0; j < h.files.length; j++) {
        var f = h.files[j];
        if (f.done) continue;
        if (f.text === null) f.text = xhrText(f);
        if (f.text === null) { g.syncFailedAt = Date.now(); return; }
        run(f);
      }
      if (!finish(h)) { g.syncFailedAt = Date.now(); return; }
    }
  }

  /* ---- what the page calls ---- */
  /* resolves once the page has painted something (the first contentful paint, then one task more), or, where the browser reports no paint (a tab in the background, an old
     engine), after a wait: 1 s when the tab is hidden, 10 s otherwise. Nothing of the deferred code is asked for before it: the first paint is Home, and the bytes of the
     rest never compete with it, on any device. */
  var painted = null;
  function afterPaint() {
    if (painted) return painted;
    painted = new Promise(function (resolve) {
      var fired = false, timer = null;
      function fire() {
        if (fired) return;
        fired = true;
        if (timer !== null) win.clearTimeout(timer);
        win.setTimeout(resolve, 0);
      }
      var observed = false;
      try {
        var po = new win.PerformanceObserver(function (list) {
          var es = list.getEntries();
          for (var i = 0; i < es.length; i++) {
            if (es[i].name === 'first-contentful-paint') { try { po.disconnect(); } catch (e) { /* done */ } fire(); return; }
          }
        });
        po.observe({ type: 'paint', buffered: true });
        observed = true;
      } catch (e) { observed = false; }
      if (!observed) { try { win.requestAnimationFrame(function () { win.setTimeout(fire, 0); }); } catch (e) { win.setTimeout(fire, 100); } }
      var hidden = false;
      try { hidden = doc.visibilityState === 'hidden'; } catch (e) { hidden = false; }
      timer = win.setTimeout(fire, hidden ? 1000 : 10000);
    });
    return painted;
  }
  /* resolves true when every group named (and what it needs) has run, false when one could not be loaded after one more try with a fresh url. Never rejects. */
  function ensure(names) {
    if (mode !== 'on') return Promise.resolve(true);
    var list = closure([].concat(names || []));
    if (!list.length || list.every(function (g) { return g.done; })) return Promise.resolve(true);
    function attempt() {
      list.forEach(function (g) { if (!g.done) fetchGroup(g); });   /* everything asked for downloads at once; what the prefetch had begun is shared */
      return Promise.all(list.map(runGroup)).then(function (oks) { return oks.every(Boolean); });
    }
    return afterPaint().then(attempt).then(function (ok) { return ok ? true : attempt(); });
  }
  function have(names) {
    if (mode !== 'on') return true;
    return [].concat(names || []).every(function (n) { return !byName[n] || byName[n].done; });
  }
  function peek(name) { return managed[name] ? managed[name].value : win[name]; }

  /* after the first frame: the rest of the page's code, in the order of PRIORITY, one group's downloads at a time (the bandwidth goes to the group a person is
     likely to need first), each group running as soon as it is in while the next one downloads */
  function drain() {
    var order = PRIORITY.filter(function (n) { return byName[n]; }).concat(groups.map(function (g) { return g.name; }).filter(function (n) { return PRIORITY.indexOf(n) < 0; }));
    var runs = [];
    var p = Promise.resolve();
    order.forEach(function (n) {
      var g = byName[n];
      p = p.then(function () {
        if (g.done) return null;
        return fetchGroup(g).then(function () { runs.push(runGroup(g)); });
      });
    });
    return p.then(function () { return Promise.all(runs); });
  }
  function start() {
    if (mode !== 'on' || started || !autoStart) return prefetched;
    started = true;
    afterPaint().then(function () {
      drain().then(function () { resolvePrefetched(true); }, function () { resolvePrefetched(false); });
    });
    return prefetched;
  }
  prefetched = new Promise(function (r) { resolvePrefetched = r; });

  /* the call that follows each <noscript data-ppp-lazy> in the head */
  function here() {
    var s = doc.currentScript, el = s && s.previousElementSibling;
    if (!el || !/^noscript$/i.test(el.tagName) || !el.hasAttribute('data-ppp-lazy')) return;
    if (mode === 'off') {
      if (doc.readyState === 'loading') doc.write(el.textContent);   /* parser-inserted, in order, here: what the page did before */
      return;
    }
    register(el);
  }
  function remember(v) {
    try {
      if (v === 'on' || v === 'off') win.localStorage.setItem(KEY, v); else win.localStorage.removeItem(KEY);
    } catch (e) { /* not remembered: this visit is what it is */ }
  }
  function status() {
    return {
      mode: mode, started: started, syncLoads: syncCount, syncLog: syncLog.slice(),
      groups: groups.map(function (g) {
        return { name: g.name, files: g.files.length, fetched: g.files.filter(function (f) { return f.done || f.text !== null; }).length, run: g.files.filter(function (f) { return f.done; }).length, done: g.done, failed: g.failed, after: g.after.slice(), globals: g.globals.slice() };
      })
    };
  }

  return {
    version: 1,
    get mode() { return mode; },
    here: here, ensure: ensure, have: have, peek: peek, start: start, afterPaint: afterPaint, remember: remember, status: status,
    get prefetched() { return prefetched; }
  };
});
