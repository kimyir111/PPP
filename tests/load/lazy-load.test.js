'use strict';
/* G13-4e: lazy-load.js, the page's code splitting (docs/GOALS/G13_PRODUCTIZATION.md, "G13-4e as built"). Node only: the module is created with a fake window - a vm
   context whose scripts really run, a fetch and a synchronous XMLHttpRequest that answer from a table, a document that records document.write - so every rule can be
   driven, and failed on purpose. The page itself (the real head, the real app) is tests/load-app/split.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
/* PPP_LOAD_ROOT: the mutants (tests/load/mutants.js) run these tests against a copy of the tree with one defect planted in it */
const ROOT = process.env.PPP_LOAD_ROOT ? path.resolve(process.env.PPP_LOAD_ROOT) : path.resolve(__dirname, '..', '..');
const { create } = require(path.join(ROOT, 'lazy-load.js'));

const SRC = {
  'a1.js': "(window.PPPA = window.PPPA || {}).one = 1; window.__order.push('a1');",
  'a2.js': "window.PPPA.two = 2; window.__order.push('a2');",
  'a3.js': "window.PPPAFinal = Object.freeze({ one: window.PPPA.one, two: window.PPPA.two }); window.__order.push('a3');",
  'b1.js': "window.PPPB = { sawA: !!window.PPPAFinal }; window.__order.push('b1');",
  'c1.js': "window.PPPC = { read: typeof window.PPPAFinal }; window.__order.push('c1');",
  'bad.js': "window.__order.push('bad');"      /* does not make its global */
};

/* a fake page: `blocks` are [{ name, files: [src...], after, globals }] in document order */
function page(over) {
  over = over || {};
  const log = { fetches: [], xhrs: [], writes: [], runs: [] };
  const win = { __order: [] };
  vm.createContext(win);
  win.window = win;
  win.location = { search: over.search || '', href: 'http://site.test/Piano%20Coach%20App.dc.html' };
  win.URL = URL; win.URLSearchParams = URLSearchParams; win.Promise = Promise;
  win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
  win.requestAnimationFrame = cb => setTimeout(cb, 0);
  const mem = Object.assign({}, over.stored || {});
  win.localStorage = over.storage === 'throws'
    ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }
    : { getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const table = Object.assign({}, SRC, over.files || {});
  const failing = over.failing || (() => false);      /* (url) => true: the network does not answer this one */
  const answer = url => {
    const u = new URL(url);
    const name = u.pathname.replace(/^\//, '');
    if (failing(url, name)) return null;
    return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : null;
  };
  win.fetch = url => {
    log.fetches.push(String(url));
    const t = answer(url);
    return t === null ? Promise.reject(new Error('network')) : Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(t) });
  };
  win.XMLHttpRequest = class {
    open(m, url) { this.url = url; }
    send() {
      log.xhrs.push(String(this.url));
      const t = answer(this.url);
      if (t === null) { this.status = 404; this.responseText = ''; if (over.xhrThrows) throw new Error('offline'); } else { this.status = 200; this.responseText = t; }
    }
  };
  const doc = win.document = {
    readyState: 'loading', baseURI: 'http://site.test/', head: null, currentScript: null,
    createElement: () => ({ tagName: 'SCRIPT', text: '', parentNode: null }),
    write: s => log.writes.push(s)
  };
  doc.head = {
    appendChild(el) {
      el.parentNode = doc.head;
      log.runs.push(String(el.text).split('\n//# sourceURL=')[1]);
      vm.runInContext(el.text, win);
      return el;
    },
    removeChild(el) { el.parentNode = null; }
  };
  const block = b => ({
    tagName: 'NOSCRIPT',
    hasAttribute: n => n === 'data-ppp-lazy',
    getAttribute: n => (n === 'data-ppp-lazy' ? b.name : n === 'data-after' ? (b.after || '') : n === 'data-globals' ? (b.globals || '') : null),
    textContent: '\n' + b.files.map(f => '<script src="./' + f + '?h=abc123def456"></script>').join('\n') + '\n'
  });
  let fcpCallback = null;
  if (over.perf) {
    /* a browser whose paint timing the test delivers by hand (p.paint()) */
    win.PerformanceObserver = class { constructor(cb) { fcpCallback = cb; } observe() {} disconnect() {} };
    if (over.hidden) doc.visibilityState = 'hidden';
  }
  const L = create(win, over.options);
  const blocks = over.blocks || [
    { name: 'a', files: ['a1.js', 'a2.js', 'a3.js'], globals: 'PPPA PPPAFinal' },
    { name: 'b', files: ['b1.js'], after: 'a', globals: 'PPPB' },
    { name: 'c', files: ['c1.js'], globals: 'PPPC' }
  ];
  if (!over.noRegister) for (const b of blocks) {
    const el = block(b);
    doc.currentScript = { previousElementSibling: el };
    L.here();
  }
  doc.currentScript = null;
  return { win, L, log, mem, doc, deliver: entries => fcpCallback({ getEntries: () => entries }), paint: () => fcpCallback({ getEntries: () => [{ name: 'first-paint' }, { name: 'first-contentful-paint' }] }) };
}
const flush = (n) => new Promise(r => setTimeout(r, n || 20));
/* objects made inside the vm context have another Object.prototype: compare them as data */
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);

/* ---------------------------------------------------------------- the choice */
test('the mode: default on; ?split= for this visit; the remembered value; anything else is no choice', () => {
  assert.equal(page({ noRegister: true }).L.mode, 'on');
  assert.equal(page({ noRegister: true, search: '?split=off' }).L.mode, 'off');
  assert.equal(page({ noRegister: true, stored: { 'ppp.split.v1': 'off' } }).L.mode, 'off');
  assert.equal(page({ noRegister: true, stored: { 'ppp.split.v1': 'on' } }).L.mode, 'on');
  assert.equal(page({ noRegister: true, stored: { 'ppp.split.v1': 'off' }, search: '?split=on' }).L.mode, 'on', 'the address beats the remembered value');
  assert.equal(page({ noRegister: true, search: '?split=OFF' }).L.mode, 'on', 'a typo is no choice');
  assert.equal(page({ noRegister: true, search: '?split=' }).L.mode, 'on');
  assert.equal(page({ noRegister: true, stored: { 'ppp.split.v1': 'garbage' } }).L.mode, 'on');
  assert.equal(page({ noRegister: true, stored: { 'ppp.split.v1': '' } }).L.mode, 'on');
  assert.equal(page({ noRegister: true, storage: 'throws' }).L.mode, 'on', 'a storage that throws is no choice');
  assert.equal(page({ noRegister: true, storage: 'throws', search: '?split=off' }).L.mode, 'off', 'but the address still counts');
  assert.equal(page({ noRegister: true, options: { defaultMode: 'off' } }).L.mode, 'off', 'the default is one constant');
});
test('a browser with no fetch gets the page as it was, whatever was chosen', () => {
  const p = page({ noRegister: true });
  /* a window without fetch: the module says off, so every block is written back */
  p.win.fetch = undefined;
  const L2 = create(p.win);
  assert.equal(L2.mode, 'off');
  assert.equal(L2.have(['anything']), true);
  p.win.fetch = () => Promise.resolve();
  p.win.Promise = undefined;
  assert.equal(create(p.win).mode, 'off', 'nor Promise');
});
test('remember(): on and off are kept, anything else forgets the choice, a throwing storage is survived', () => {
  const p = page({ noRegister: true });
  p.L.remember('off'); assert.equal(p.mem['ppp.split.v1'], 'off');
  p.L.remember('on'); assert.equal(p.mem['ppp.split.v1'], 'on');
  p.L.remember('maybe'); assert.equal('ppp.split.v1' in p.mem, false);
  p.L.remember('off'); p.L.remember(null); assert.equal('ppp.split.v1' in p.mem, false);
  assert.doesNotThrow(() => page({ noRegister: true, storage: 'throws' }).L.remember('off'));
});

/* ---------------------------------------------------------------- off: the page as it was */
test('off: each block is written back where it stands, in order, and nothing is fetched or made lazy', async () => {
  const p = page({ search: '?split=off' });
  assert.equal(p.log.writes.length, 3);
  assert.match(p.log.writes[0], /<script src="\.\/a1\.js\?h=abc123def456"><\/script>\n<script src="\.\/a2\.js/);
  assert.deepEqual(p.L.status().groups, []);
  assert.equal(p.log.fetches.length, 0);
  assert.equal(Object.getOwnPropertyDescriptor(p.win, 'PPPA'), undefined, 'no accessor is installed');
  assert.equal(await p.L.ensure(['a', 'b']), true);
  assert.equal(p.L.have(['a']), true);
  p.win.PPPX = 1;
  assert.equal(p.L.peek('PPPX'), 1);
  assert.equal(p.log.fetches.length + p.log.xhrs.length, 0);
});
test('off: nothing is written once the document is no longer being parsed (a document.write then would blank the page)', () => {
  const p = page({ search: '?split=off', noRegister: true });
  p.doc.readyState = 'complete';
  p.doc.currentScript = { previousElementSibling: { tagName: 'NOSCRIPT', hasAttribute: () => true, getAttribute: n => (n === 'data-ppp-lazy' ? 'a' : null), textContent: '<script src="./a1.js"></script>' } };
  p.L.here();
  assert.equal(p.log.writes.length, 0);
});
test('a script that is not in front of a lazy block is ignored by here()', () => {
  const p = page({ noRegister: true });
  p.doc.currentScript = { previousElementSibling: { tagName: 'DIV', hasAttribute: () => true, getAttribute: () => 'a', textContent: '' } };
  assert.doesNotThrow(() => p.L.here());
  p.doc.currentScript = null;
  assert.doesNotThrow(() => p.L.here());
  assert.deepEqual(p.L.status().groups, []);
});

/* ---------------------------------------------------------------- on: registering */
test('on: blocks become groups; the globals are accessors; nothing is fetched, nothing runs', () => {
  const p = page();
  const s = p.L.status();
  assert.equal(s.mode, 'on');
  assert.deepEqual(s.groups.map(g => g.name), ['a', 'b', 'c']);
  assert.deepEqual(s.groups.map(g => g.files), [3, 1, 1]);
  assert.deepEqual(s.groups[1].after, ['a']);
  assert.equal(p.log.fetches.length, 0);
  assert.equal(p.log.xhrs.length, 0);
  assert.equal(p.log.writes.length, 0);
  assert.deepEqual(p.win.__order, []);
  assert.equal(typeof Object.getOwnPropertyDescriptor(p.win, 'PPPA').get, 'function');
  assert.equal(p.L.have(['a']), false);
  assert.equal(p.L.have(['nosuchgroup']), true, 'a group the page does not have is not waited for');
});
test('on: a group name seen twice is registered once; urls are made absolute against the document', () => {
  const p = page({ blocks: [{ name: 'a', files: ['a1.js'], globals: 'PPPA' }, { name: 'a', files: ['a2.js'], globals: 'PPPA' }] });
  assert.equal(p.L.status().groups.length, 1);
  assert.equal(p.L.status().groups[0].files, 1);
});

/* ---------------------------------------------------------------- ensure */
test('ensure: files fetched in parallel, run in the written order, one task each, globals made, accessors replaced by plain properties', async () => {
  const p = page();
  assert.equal(await p.L.ensure(['a']), true);
  assert.deepEqual(p.win.__order, ['a1', 'a2', 'a3']);
  assert.deepEqual(p.log.fetches.map(u => u.replace(/\?.*/, '')), ['http://site.test/a1.js', 'http://site.test/a2.js', 'http://site.test/a3.js']);
  assert.equal(p.log.fetches[0], 'http://site.test/a1.js?h=abc123def456', 'the url is the page\'s own (its hash is what makes it cacheable)');
  assert.deepEqual(p.log.runs.map(r => r.replace(/\?.*/, '')), ['http://site.test/a1.js', 'http://site.test/a2.js', 'http://site.test/a3.js'], 'each file runs under its own name');
  assert.equal(p.log.xhrs.length, 0);
  assert.equal(p.L.have(['a']), true);
  const d = Object.getOwnPropertyDescriptor(p.win, 'PPPAFinal');
  assert.equal(typeof d.get, 'undefined', 'a data property again: the page is what it was once everything is in');
  assert.equal(d.writable, true);
  same(p.win.PPPAFinal, { one: 1, two: 2 });
  assert.equal(p.L.status().syncLoads, 0);
});
test('ensure: what a group needs first runs first, even when only the dependent is asked for', async () => {
  const p = page();
  assert.equal(await p.L.ensure(['b']), true);
  assert.deepEqual(p.win.__order, ['a1', 'a2', 'a3', 'b1']);
  assert.equal(p.win.PPPB.sawA, true);
});
test('ensure: callers share one download; a second call after it is in fetches nothing', async () => {
  const p = page();
  const [x, y] = await Promise.all([p.L.ensure(['a']), p.L.ensure(['a', 'b'])]);
  assert.equal(x && y, true);
  assert.equal(p.log.fetches.filter(u => /a1\.js/.test(u)).length, 1);
  assert.deepEqual(p.win.__order, ['a1', 'a2', 'a3', 'b1']);
  const n = p.log.fetches.length;
  assert.equal(await p.L.ensure(['a', 'b']), true);
  assert.equal(p.log.fetches.length, n);
});
test('ensure never rejects, and an unknown name is not an error', async () => {
  const p = page();
  assert.equal(await p.L.ensure(['zzz']), true);
  assert.equal(await p.L.ensure([]), true);
  assert.equal(await p.L.ensure(undefined), true);
  assert.equal(await p.L.ensure('a'), true, 'a single name works too');
});

/* ---------------------------------------------------------------- failure */
test('a failed file is asked for once more at once, with &retry=<stamp> (the server answers that url no-store); the group then runs', async () => {
  const p = page({ failing: url => /a2\.js\?h=abc123def456$/.test(url) });
  assert.equal(await p.L.ensure(['a']), true);
  const a2 = p.log.fetches.filter(u => /a2\.js/.test(u));
  assert.equal(a2.length, 2);
  assert.match(a2[1], /a2\.js\?h=abc123def456&retry=\d+$/);
  assert.equal(p.log.fetches.filter(u => /a1\.js/.test(u)).length, 1, 'what had arrived is not fetched again');
  assert.deepEqual(p.win.__order, ['a1', 'a2', 'a3'], 'and the order is still the written one');
});
test('a network that stays down: false, never a throw; nothing half-run; the next ask tries again and then succeeds', async () => {
  let down = true;
  const p = page({ failing: () => down });
  assert.equal(await p.L.ensure(['a']), false);
  assert.deepEqual(p.win.__order, [], 'no file runs until the whole group is in');
  assert.equal(p.L.have(['a']), false);
  assert.equal(p.L.status().groups[0].failed, true);
  down = false;
  assert.equal(await p.L.ensure(['a']), true);
  assert.deepEqual(p.win.__order, ['a1', 'a2', 'a3']);
  assert.equal(p.L.status().groups[0].failed, false);
});
test('a group whose scripts do not make what it promised is not done: it starts over on the next ask', async () => {
  const p = page({ blocks: [{ name: 'bad', files: ['bad.js'], globals: 'PPPNever' }] });
  assert.equal(await p.L.ensure(['bad']), false);
  assert.equal(p.L.have(['bad']), false);
  p.win.__order.length = 0;
  p.L.status();
  /* the script is fixed (the file now makes its global): the retry runs it again from the top */
  const q = page({ blocks: [{ name: 'bad', files: ['bad.js'], globals: 'PPPNever' }], files: {} });
  assert.equal(await q.L.ensure(['bad']), false);
  assert.equal(await q.L.ensure(['bad']), false);
  assert.ok(q.win.__order.length >= 2, 'the file ran again on the second ask');
});

/* ---------------------------------------------------------------- the safety net */
test('a read of a global before its group is in loads the group synchronously, once - never "undefined"', () => {
  const p = page();
  const v = vm.runInContext('PPPAFinal', p.win);          /* a bare read, as the app's own code does it */
  same(v, { one: 1, two: 2 });
  assert.deepEqual(p.win.__order, ['a1', 'a2', 'a3']);
  assert.equal(p.log.xhrs.length, 3);
  assert.equal(p.log.fetches.length, 3, 'the downloads of the group were also started in parallel: the one-by-one asks of the synchronous path are answered from the cache they fill');
  assert.ok(p.log.xhrs.every(u => !/retry=/.test(u)) && p.log.fetches.every(u => !/retry=/.test(u)), 'by the address in the page, so that the cache answers (a retry url is no-store)');
  const s = p.L.status();
  assert.equal(s.syncLoads, 1);
  assert.equal(s.syncLog[0].group, 'a');
  assert.equal(s.syncLog[0].global, 'PPPAFinal');
  assert.equal(p.L.have(['a']), true);
  vm.runInContext('PPPAFinal; PPPA', p.win);
  assert.equal(p.log.xhrs.length, 3, 'read again: nothing more is asked');
});
test('the safety net loads what a group needs first, in order', () => {
  const p = page();
  same(vm.runInContext('PPPB', p.win), { sawA: true });
  assert.deepEqual(p.win.__order, ['a1', 'a2', 'a3', 'b1']);
});
test('peek() never loads: it answers what is there, or undefined', async () => {
  const p = page();
  assert.equal(p.L.peek('PPPAFinal'), undefined);
  assert.equal(p.log.xhrs.length, 0);
  assert.deepEqual(p.win.__order, []);
  await p.L.ensure(['a']);
  same(p.L.peek('PPPAFinal'), { one: 1, two: 2 });
});
test('a script of a group that reads a global of another group sees what is there; it never starts a load from inside a load', async () => {
  const p = page();
  assert.equal(await p.L.ensure(['c']), true);
  assert.equal(p.win.PPPC.read, 'undefined', 'c1.js read PPPAFinal (a group that is not in) and saw nothing');
  assert.equal(p.log.xhrs.length, 0);
  assert.equal(p.L.status().syncLoads, 0);
});
test('a synchronous load that the network refuses answers undefined, does not throw, and is not retried for a while', () => {
  const p = page({ failing: () => true });
  assert.equal(vm.runInContext('PPPAFinal', p.win), undefined);
  const n = p.log.xhrs.length;
  assert.ok(n >= 1);
  assert.equal(vm.runInContext('PPPAFinal', p.win), undefined);
  assert.equal(p.log.xhrs.length, n, 'a second read does not hammer the network');
});
test('a file the synchronous path ran while its download was in flight is not run again, and keeps no text', async () => {
  const p = page();
  const pending = p.L.ensure(['a']);                  /* the fetches are on their way */
  vm.runInContext('PPPAFinal', p.win);                /* a read comes first: loaded synchronously */
  assert.equal(await pending, true);
  assert.deepEqual(p.win.__order, ['a1', 'a2', 'a3'], 'each file exactly once');
});

test('a read that comes between two files of a group that is running: the rest runs at once, and the group does not run any file again', async () => {
  const p = page();
  const asked = p.L.ensure(['a']);
  for (let i = 0; i < 200 && p.win.__order.length < 1; i++) await flush(1);
  assert.equal(p.win.__order.length, 1, 'one file has run, the others have not');
  vm.runInContext('PPPAFinal', p.win);              /* the safety net runs the rest */
  assert.equal(await asked, true);
  assert.deepEqual(p.win.__order, ['a1', 'a2', 'a3'], 'every file exactly once, in order');
});

/* ---------------------------------------------------------------- the idle prefetch */
test('start(): after the frame, group by group in priority order; prefetched resolves when every group is in', async () => {
  const p = page({ options: { priority: ['c', 'a', 'b'] } });
  p.L.start();
  assert.equal(p.log.fetches.length, 0, 'nothing is fetched by the call itself (it waits for the frame)');
  await p.L.prefetched;
  assert.deepEqual(p.win.__order, ['c1', 'a1', 'a2', 'a3', 'b1']);
  assert.equal(p.L.have(['a', 'b', 'c']), true);
  assert.equal(p.L.status().syncLoads, 0);
  assert.equal(p.L.status().started, true);
});
test('start() twice starts once; ?splitStart=0 (a test switch) never starts', async () => {
  const p = page();
  p.L.start(); p.L.start();
  await p.L.prefetched;
  assert.equal(p.log.fetches.filter(u => /a1\.js/.test(u)).length, 1);
  const q = page({ search: '?splitStart=0' });
  q.L.start();
  await flush(60);
  assert.equal(q.log.fetches.length, 0);
  assert.equal(q.L.status().started, false);
  const r = page({ stored: { 'ppp.splitStart': '0' } });
  r.L.start();
  await flush(60);
  assert.equal(r.log.fetches.length, 0, 'the same switch from localStorage, which a suite can set without touching the address');
});
test('a group asked for while the prefetch is on another is not made to wait for the queue', async () => {
  const p = page({ options: { priority: ['a', 'b', 'c'] } });
  p.L.start();
  const asked = await p.L.ensure(['c']);
  assert.equal(asked, true);
  assert.ok(p.win.__order.includes('c1'));
  await p.L.prefetched;
  assert.equal(p.win.__order.filter(x => x === 'c1').length, 1);
});
test('a prefetch that fails resolves prefetched (the samples must not wait for ever) and leaves the groups to be asked for again', async () => {
  let down = true;
  const p = page({ failing: () => down });
  p.L.start();
  await p.L.prefetched;
  assert.equal(p.L.have(['a']), false);
  down = false;
  assert.equal(await p.L.ensure(['a', 'b', 'c']), true);
});

/* ---------------------------------------------------------------- off is not the stand-in */
test('a window that already has the global (a test, the page) keeps it when the group registers', () => {
  const p = page({ noRegister: true });
  p.win.PPPA = { mine: true };
  const el = { tagName: 'NOSCRIPT', hasAttribute: () => true, getAttribute: n => (n === 'data-ppp-lazy' ? 'a' : n === 'data-globals' ? 'PPPA' : ''), textContent: '<script src="./a1.js"></script>' };
  p.doc.currentScript = { previousElementSibling: el };
  p.L.here();
  same(p.win.PPPA, { mine: true });
  assert.equal(p.log.xhrs.length, 0, 'reading it loads nothing');
});

/* ---------------------------------------------------------------- not before the first paint */
test('nothing is asked for before the first contentful paint - not by ensure, not by the prefetch - and everything right after it', async () => {
  const p = page({ perf: true });
  const asked = p.L.ensure(['a']);
  p.L.start();
  await flush(60);
  assert.equal(p.log.fetches.length, 0, 'the page has not painted: nothing is fetched');
  assert.deepEqual(p.win.__order, []);
  p.paint();
  assert.equal(await asked, true);
  assert.ok(p.log.fetches.length >= 3);
  await p.L.prefetched;
  assert.equal(p.L.have(['a', 'b', 'c']), true);
});
test('a first-paint entry alone is not the contentful paint', async () => {
  const p = page({ perf: true });
  const asked = p.L.ensure(['a']);
  p.deliver([{ name: 'first-paint' }]);
  await flush(40);
  assert.equal(p.log.fetches.length, 0, 'a blank first paint is not Home');
  p.deliver([{ name: 'first-contentful-paint' }]);
  assert.equal(await asked, true);
});
test('a tab in the background makes no paint: the wait ends after a second, not never', async () => {
  const p = page({ perf: true, hidden: true });
  const t0 = Date.now();
  assert.equal(await p.L.ensure(['a']), true);
  const waited = Date.now() - t0;
  assert.ok(waited >= 900 && waited < 3000, 'waited ' + waited + ' ms');
});
test('a browser with no paint timing falls back to a frame, and the page is not stuck', async () => {
  const p = page();               /* the fake window has no PerformanceObserver */
  assert.equal(await p.L.ensure(['a']), true);
});
