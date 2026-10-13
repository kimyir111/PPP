/* G12-5: the home-PC worker reading a printed score (tools/home-worker/worker.js, omr/engine.js) against the real queue service. The engine is a stand-in function here (a real
   Audiveris is the one real run in docs/GOALS/G12_OMR.md section 24; nothing in the test suite starts it); the real worker code runs everything else: the settings, the HTTP calls, the
   page fetch and its checks, the files written, the heartbeat, the cancel, the result, the clean-up.

   What it pins:
     - the settings: where Audiveris is looked for, "omr": false, the page time-out; --check says what is there and what is not
     - the claim says omr: true only when this PC can (the site never hands a score to a PC that cannot)
     - a whole score: every page fetched with the PC's token, written under a name the worker picks (page-N.png / .jpg by what the bytes are), the engine called one page at a time with
       the step time-out, below-normal priority and the page time-out, the result posted in the site's own shape (the DOCTYPE cut out), the scratch folder gone, the images gone from the site
     - what the worker does not trust: a page that is not an image, a picture that claims 100000 x 100000 pixels, a job id or a page count that is not what the site makes
     - the ways it ends: pages that cannot be read (one of them, all of them), a result the site refuses, a cancel while the engine runs (the PROCESS is stopped, by its PID), a rejected token
     - on a PC with a POSIX shell (the gate, not Windows): the real omr/engine.js with a shell script standing in for Audiveris, through the worker

   Run: node tests/home-worker/omr-worker.test.js */
'use strict';
const L = require('./lib');
const { ok, heading, sleep, req } = L;
const W = L.mod('tools/home-worker/worker.js');
const Omr = L.mod('home-omr.js');
const os = require('os');
const zlib = require('zlib');
const { spawn } = require('child_process');
const path = L.path, fs = L.fs;

const FAKE = path.join(__dirname, 'fake-transcribe.js');
const POSIX = process.platform !== 'win32';

function cfgFor(S, token, over) {
  const site = 'http://127.0.0.1:' + S.port;
  return Object.assign({}, W.DEFAULTS, {
    siteUrl: site, audioBase: site, token: token, pythonPath: process.execPath, transcribePy: FAKE, kongCheckpoint: '/fake/kong.pth', ariaCheckpoint: '',
    ffmpegPath: 'ffmpeg-stub', scratchDir: L.tmpDir('ppp-hw-omr-'), maxSeconds: 900, audiverisPath: process.execPath, omr: true, omrPageTimeoutSeconds: 600
  }, over || {});
}
function newWorker(S, user, state, over, depsOver) {
  const cfg = cfgFor(S, S.token(user), over);
  const out = [], err = [];
  const log = W.makeLog(cfg, s => out.push(s), s => err.push(s));
  const deps = Object.assign({
    log: log, waitScale: 0.001, heartbeatMs: 40, noPriority: true,
    engineVersion: async () => '5.11.0',
    recognisePage: async (img, outDir, o) => {
      state.calls.push({ img: path.basename(img), bytes: fs.readFileSync(img), outDir: outDir, o: o });
      const i = state.calls.length - 1;
      if (state.engine) return state.engine(i, img, outDir, o);
      return { ok: true, ms: 1200 + i, musicxml: L.scoreXml(i + 1), movements: [L.scoreXml(i + 1)] };
    }
  }, depsOver || {});
  const w = W.createWorker(cfg, deps);
  return { w: w, cfg: cfg, out: out, err: err, lines: () => out.concat(err) };
}
const scratchLeft = cfg => { try { return fs.readdirSync(cfg.scratchDir).length; } catch (e) { return 0; } };
const pageFilesIn = S => { try { return fs.readdirSync(path.join(S.dir, 'omr-pages')).length; } catch (e) { return 0; } };
const jobOf = (S, id) => S.svc._state.jobs.get(id);
const state0 = () => ({ calls: [], engine: null });
/* the PC has been seen (a claim with nothing waiting) and a score of n pages is queued by the page */
async function queued(S, user, w, n, o) {
  await w.poll(true);
  const pages = L.omrPages(n, Object.assign({ kind: 'png' }, o || {}));
  const q = await S.as(user).post('/api/jobs/omr', { title: 'Czerny.pdf', pages: pages });
  return { q: q, id: q.body.job && q.body.job.id, pages: pages.map(p => Buffer.from(p, 'base64')) };
}

(async () => {
  heading('the settings: where Audiveris is looked for');
  {
    const root = L.tmpDir('ppp-hw-find-');
    const tools = path.join(root, 'tools', 'audiveris', 'Audiveris');
    fs.mkdirSync(tools, { recursive: true });
    const exe = path.join(tools, 'Audiveris.exe');
    fs.writeFileSync(exe, '');
    const file = path.join(root, 'worker.config.json');
    const base = { siteUrl: 'https://ppp.example.com', token: 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43), pythonPath: process.execPath, transcribePy: path.join(root, 'transcribe.py') };
    fs.writeFileSync(path.join(root, 'transcribe.py'), '');
    const load = (extra, env) => { fs.writeFileSync(file, JSON.stringify(Object.assign({}, base, extra))); return W.loadConfig(file, env || {}); };
    ok('found beside transcribe.py: tools/audiveris/Audiveris/Audiveris.exe', load({}).audiverisPath === exe, load({}).audiverisPath);
    const named = path.join(root, 'elsewhere.exe'); fs.writeFileSync(named, '');
    ok('the setting audiverisPath wins when the file is there', load({ audiverisPath: named }).audiverisPath === named);
    ok('PPP_AUDIVERIS is next', load({}, { PPP_AUDIVERIS: named }).audiverisPath === named);
    ok('a setting that names a file that is not there is passed over (the search goes on)', load({ audiverisPath: path.join(root, 'nope.exe') }).audiverisPath === exe);
    ok('"omr": false leaves none: this PC does not take scores', load({ omr: false }).audiverisPath === '' && load({ omr: false }).omr === false);
    ok('the page time-out is 60 s to an hour, 600 s by default', load({}).omrPageTimeoutSeconds === 600 && load({ omrPageTimeoutSeconds: 5 }).omrPageTimeoutSeconds === 60 && load({ omrPageTimeoutSeconds: 99999 }).omrPageTimeoutSeconds === 3600);
    fs.unlinkSync(exe);
    ok('and with the file gone the search finds the places omr-service.js looks (or nothing); never a path that does not exist', (a => a === '' || fs.existsSync(a))(load({}).audiverisPath));
    L.rmDir(root);
  }

  heading('the claim says whether this PC can read a score');
  {
    const S = await L.startService({ users: ['u1', 'u2', 'u3'] });
    try {
      const a = newWorker(S, 'u1', state0()); await a.w.poll(true);
      ok('with Audiveris on the PC: omrMode true', (await S.as('u1').get('/api/worker/status')).body.worker.omrMode === true);
      const b = newWorker(S, 'u2', state0(), { audiverisPath: '' }); await b.w.poll(true);
      ok('without it: omrMode false (and the site then refuses to queue a score for this link: no-omr-pc)', (await S.as('u2').get('/api/worker/status')).body.worker.omrMode === false
        && (await S.as('u2').post('/api/jobs/omr', { pages: L.omrPages(1) })).body.code === 'no-omr-pc');
      const c = newWorker(S, 'u3', state0(), { omr: false }); await c.w.poll(true);
      ok('"omr": false in the settings: omrMode false though the program is there', (await S.as('u3').get('/api/worker/status')).body.worker.omrMode === false);
      ok('a path that does not exist is "cannot" at the claim, whatever the setting says', await (async () => {
        const d = newWorker(S, 'u3', state0(), { audiverisPath: '/no/such/Audiveris.exe' }); await d.w.poll(true);
        return (await S.as('u3').get('/api/worker/status')).body.worker.omrMode === false;
      })());
    } finally { await S.close(); }
  }

  heading('a whole score, with a stand-in for the engine');
  {
    const S = await L.startService({ users: ['u1'] });
    try {
      const st = state0();
      const { w, cfg, lines } = newWorker(S, 'u1', st);
      const { id, pages, q } = await queued(S, 'u1', w, 3);
      ok('(queued, 3 page files on the site)', q.status === 201 && pageFilesIn(S) === 3, q.status + ' ' + q.text);
      const p = await w.poll(true);
      ok('the claim hands this worker the score (kind omr, 3 pages, no url)', p.job && p.job.id === id && p.job.kind === 'omr' && p.job.pages === 3 && p.job.url === '', JSON.stringify(p.job));
      ok('processing it is true', (await w.processJob(p.job)) === true, lines().slice(-4).join(' | '));
      ok('the engine was called once per page, one after the other', st.calls.length === 3);
      ok('each page is the very bytes that were uploaded, in order', st.calls.every((c, i) => c.bytes.equals(pages[i])));
      ok('written under names the worker picked: page-1.png, page-2.png, page-3.png', st.calls.map(c => c.img).join() === 'page-1.png,page-2.png,page-3.png', st.calls.map(c => c.img).join());
      ok('the engine got the step time-out (-option ...sheetStepTimeOut=1800), below-normal priority and the page time-out', st.calls.every(c => c.o.lowPriority === true && c.o.timeoutMs === 600000 && c.o.extraArgs.join(' ') === '-option org.audiveris.omr.Main.sheetStepTimeOut=1800'), JSON.stringify(st.calls[0].o));
      ok('and a folder of its own per page, inside the job\'s scratch folder', new Set(st.calls.map(c => c.outDir)).size === 3 && st.calls.every(c => c.outDir.indexOf(cfg.scratchDir) === 0));
      const j = jobOf(S, id);
      ok('the site has it: done, and the images are gone from the site (counted)', j.status === 'done' && pageFilesIn(S) === 0 && S.store.calls.deleteOmrPages === 1, j.status + ' ' + pageFilesIn(S));
      const r = (await S.as('u1').get('/api/jobs/' + id)).body.result;
      ok('the result: Audiveris 5.11.0, three pages, each with its movement, the standard DOCTYPE already cut out here', r.engine === 'Audiveris' && r.engineVersion === '5.11.0' && r.pages.length === 3 && r.pages.every((pg, i) => pg.ok && pg.ms === 1200 + i && pg.movements.length === 1 && pg.movements[0].indexOf('<!DOCTYPE') < 0), JSON.stringify(r).slice(0, 160));
      ok('the scratch folder is empty (the job\'s folder with the pages and the outputs was removed)', scratchLeft(cfg) === 0);
      ok('the log says what happened, page by page, and shows no image', lines().some(l => /Page 1 of 3: read in/.test(l)) && lines().some(l => /Done: the score is on the site/.test(l)) && !lines().some(l => /iVBOR|PNG/.test(l)));
      ok('the token is not in the log', !lines().some(l => l.indexOf(cfg.token) >= 0));
    } finally { await S.close(); }
  }

  heading('PNG or JPEG by what the bytes are; a page the engine cannot read; no page read');
  {
    const S = await L.startService({ users: ['u1'] });
    try {
      const st = state0();
      const { w, cfg, lines } = newWorker(S, 'u1', st);
      await w.poll(true);
      const pngs = L.omrPages(1, { w: 1000 }), jpgs = L.omrPages(1, { kind: 'jpeg', w: 1001 });
      const q = await S.as('u1').post('/api/jobs/omr', { pages: pngs.concat(jpgs) });
      st.engine = async (i) => (i === 1 ? { ok: false, ms: 800, error: 'No musical notation was detected on this page.' } : { ok: true, ms: 1000, musicxml: L.scoreXml(2), movements: [L.scoreXml(2), L.scoreXml(1)] });
      const p = await w.poll(true);
      await w.processJob(p.job);
      ok('a PNG is written as .png and a JPEG as .jpg, by their own header', st.calls.map(c => c.img).join() === 'page-1.png,page-2.jpg', st.calls.map(c => c.img).join());
      const r = (await S.as('u1').get('/api/jobs/' + q.body.job.id)).body;
      ok('one page not read: the job is done, the other page stands with both its movements, the failed one says why', r.job.status === 'done' && r.result.pages[0].ok && r.result.pages[0].movements.length === 2 && r.result.pages[1].ok === false && /No musical notation/.test(r.result.pages[1].error), JSON.stringify(r).slice(0, 220));
      ok('the log names the page that was not read', lines().some(l => /Page 2 of 2: not read \(No musical notation/.test(l)));
    } finally { await S.close(); }
  }
  {
    const S = await L.startService({ users: ['u1'] });
    try {
      const st = state0();
      st.engine = async () => ({ ok: false, ms: 500, error: 'Audiveris produced no MusicXML for this page.' });
      const { w, cfg, lines } = newWorker(S, 'u1', st);
      const { id } = await queued(S, 'u1', w, 2);
      const p = await w.poll(true);
      ok('no page read: processJob is false', (await w.processJob(p.job)) === false);
      const j = jobOf(S, id);
      ok('the site has it failed for good (no retry: the same page reads the same), with the engine\'s own line, and the images are deleted', j.status === 'failed' && j.error === 'Audiveris produced no MusicXML for this page.' && pageFilesIn(S) === 0, j.status + ' ' + j.error);
      ok('and the scratch folder is gone', scratchLeft(cfg) === 0);
      void lines;
    } finally { await S.close(); }
  }

  heading('what the worker does not trust');
  {
    const S = await L.startService({ users: ['u1'] });
    try {
      /* a site (or a man in the middle) that hands over pages that are not what the site checked: the request function is wrapped */
      const evil = { mode: null };
      const real = W.request;
      const wrapped = (cfg, method, p, o) => {
        if (evil.mode && /\/pages\/\d+$/.test(p)) {
          if (evil.mode === 'html') return Promise.resolve({ status: 200, body: null, text: '', headers: {}, raw: Buffer.from('<html><script>alert(1)</script></html>'.padEnd(200, ' ')) });
          if (evil.mode === 'bomb') return Promise.resolve({ status: 200, body: null, text: '', headers: {}, raw: L.pngBytes(100000, 100000, 500) });
          if (evil.mode === 'big') return Promise.resolve({ status: 200, body: null, text: '', headers: {}, raw: L.pngBytes(1240, 1754, 1.6 * 1048576) });
          if (evil.mode === 'empty') return Promise.resolve({ status: 200, body: null, text: '', headers: {}, raw: Buffer.alloc(0) });
          if (evil.mode === '500') return Promise.resolve({ status: 503, body: { error: 'no' }, text: '', headers: {}, raw: null });
          if (evil.mode === 'gone') return Promise.resolve({ status: 410, body: { error: 'gone' }, text: '', headers: {}, raw: null });
        }
        return real(cfg, method, p, o);
      };
      for (const mode of ['html', 'bomb', 'big', 'empty']) {
        evil.mode = mode;
        const st = state0();
        const { w, cfg } = newWorker(S, 'u1', st, null, { request: wrapped });
        const { id } = await queued(S, 'u1', w, 1, { w: 900 + mode.length });
        const p = await w.poll(true);
        await w.processJob(p.job);
        const j = jobOf(S, id);
        ok('a page that is ' + { html: 'an HTML page', bomb: 'a PNG that says it is 100000 x 100000 pixels', big: 'over 1.5 MB', empty: 'empty' }[mode] + ': the engine is never started, the score is failed for good with a sentence, nothing is left on this PC',
          st.calls.length === 0 && j.status === 'failed' && /not a usable image/.test(j.error) && scratchLeft(cfg) === 0, st.calls.length + ' ' + j.status + ' ' + j.error);
        await S.as('u1').del('/api/jobs/' + id);
      }
      evil.mode = null;
    } finally { await S.close(); }
  }
  {
    /* the job the site hands over: its id and page count are checked before anything is done */
    const S = await L.startService({ users: ['u1'] });
    try {
      const st = state0();
      const requests = [];
      const spy = (cfg, method, p, o) => { requests.push(method + ' ' + p); return W.request(cfg, method, p, o); };
      const { w, lines } = newWorker(S, 'u1', st, null, { request: spy });
      await w.poll(true);
      for (const bad of [{ id: '../../etc', kind: 'omr', pages: 2 }, { id: 'a'.repeat(41), kind: 'omr', pages: 2 }, { id: 'ab', kind: 'omr', pages: 2 }, { id: 'x%00y-0123456', kind: 'omr', pages: 2 },
        { id: 'abcdefghijklmnop', kind: 'omr', pages: 0 }, { id: 'abcdefghijklmnop', kind: 'omr', pages: 25 }, { id: 'abcdefghijklmnop', kind: 'omr', pages: '2' }, { id: 'abcdefghijklmnop', kind: 'omr', pages: 1e9 }, { id: 'abcdefghijklmnop', kind: 'omr' }]) {
        requests.length = 0;
        const r = await w.processJob(bad);
        const onlyFail = requests.filter(x => !/\/fail$/.test(x));
        ok('a score job with id ' + JSON.stringify(bad.id).slice(0, 24) + ' and pages ' + JSON.stringify(bad.pages) + ' is not run: no page fetched, no engine', r === false && onlyFail.length === 0 && st.calls.length === 0, requests.join(' | '));
      }
      ok('a hostile id never reaches a URL (no request names ../)', !requests.some(x => /\.\./.test(x)));
      void lines;
    } finally { await S.close(); }
  }
  {
    /* a PC without the engine that is handed a score anyway (the site's omr flag was out of date) */
    const S = await L.startService({ users: ['u1'] });
    try {
      const st = state0();
      const a = newWorker(S, 'u1', st);
      const { id } = await queued(S, 'u1', a.w, 1);
      const b = newWorker(S, 'u1', st, { audiverisPath: '' });
      const r = await b.w.processJob({ id: id, kind: 'omr', title: 't', pages: 1, attempt: 1 });
      ok('processJob on a PC with no Audiveris: false, the engine not called, the site told "not installed" for good', r === false && st.calls.length === 0 && S.svc._state.jobs.get(id).status === 'failed' && /not installed/.test(String(S.svc._state.jobs.get(id).error || '')), r + ' ' + st.calls.length + ' ' + S.svc._state.jobs.get(id).error);
    } finally { await S.close(); }
  }

  heading('the priority, the cancel, the rejected token, a result the site refuses');
  {
    const S = await L.startService({ users: ['u1'] });
    try {
      const st = state0();
      let seen = null;
      const before = os.getPriority(process.pid);
      st.engine = async () => { seen = os.getPriority(process.pid); return { ok: true, ms: 10, musicxml: L.scoreXml(1), movements: [L.scoreXml(1)] }; };
      const { w } = newWorker(S, 'u1', st, null, { noPriority: false });
      const { id } = await queued(S, 'u1', w, 1, { w: 940 });
      await w.processJob((await w.poll(true)).job);
      ok('while the engine runs, the worker itself is below normal priority (what it starts inherits it), and it is put back after', seen === os.constants.priority.PRIORITY_BELOW_NORMAL && os.getPriority(process.pid) === before && jobOf(S, id).status === 'done', seen + ' ' + before + ' ' + os.getPriority(process.pid));
    } finally { await S.close(); }
  }
  {
    /* a cancel while the engine is running stops the PROCESS (by the PID the worker was told of) */
    const S = await L.startService({ users: ['u1'] });
    try {
      const st = state0();
      let child = null;
      st.engine = (i, img, outDir, o) => new Promise(resolve => {
        child = spawn(process.execPath, ['-e', 'setTimeout(function () {}, 60000)'], { stdio: 'ignore', windowsHide: true });
        o.onChild(child);
        child.on('close', () => { o.onChild(null); resolve({ ok: false, ms: 50, error: 'Recognition was stopped.' }); });
      });
      const { w, cfg, lines } = newWorker(S, 'u1', st);
      const { id } = await queued(S, 'u1', w, 2, { w: 950 });
      const p = await w.poll(true);
      const run = w.processJob(p.job);
      for (let i = 0; i < 100 && !child; i++) await sleep(20);
      ok('(the engine stand-in is running as a process of its own)', !!child && child.exitCode === null);
      const pid = child.pid;
      const tCancel = Date.now();
      await S.as('u1').post('/api/jobs/' + id + '/cancel', {});
      const done = await run;
      const stoppedIn = Date.now() - tCancel;
      let alive = true; try { process.kill(pid, 0); } catch (e) { alive = false; }
      ok('cancelled on the site: the worker stops the engine\'s process within seconds (at its next heartbeat; the stand-in would run a minute), does not go on to page 2, posts no result, and logs it', stoppedIn < 15000 && done === false && !alive && st.calls.length === 1 && lines().some(l => /cancelled on the site/.test(l)) && jobOf(S, id).status === 'cancelled', done + ' alive=' + alive + ' calls=' + st.calls.length);
      ok('and nothing is left in the scratch folder', scratchLeft(cfg) === 0);
    } finally { await S.close(); }
  }
  {
    const S = await L.startService({ users: ['u1'] });
    try {
      const st = state0();
      const { w } = newWorker(S, 'u1', st);
      const { id } = await queued(S, 'u1', w, 1, { w: 960 });
      const p = await w.poll(true);
      await S.as('u1').post('/api/pc-links/me/worker-token', {});         /* the token the worker holds is dead now */
      let err = null;
      try { await w.processJob(p.job); } catch (e) { err = e; }
      ok('a token the site no longer accepts ends the run with the fatal-token error (the loop stops: exit 2), as for a conversion', !!err && err.fatalToken === true, String(err));
      void id;
    } finally { await S.close(); }
  }
  {
    const S = await L.startService({ users: ['u1'] });
    try {
      const st = state0();
      st.engine = async () => ({ ok: true, ms: 5, musicxml: '<html/>', movements: ['<html><body>not music</body></html>'] });
      const { w } = newWorker(S, 'u1', st);
      const { id } = await queued(S, 'u1', w, 1, { w: 970 });
      await w.processJob((await w.poll(true)).job);
      ok('an engine that wrote something that is not MusicXML is caught here (the site\'s rules, run first): the score is failed for good, nothing of it is posted', jobOf(S, id).status === 'failed' && /did not pass the site's checks/.test(jobOf(S, id).error), jobOf(S, id).status + ' ' + jobOf(S, id).error);
    } finally { await S.close(); }
  }
  {
    /* a result that the site refuses (here: it was cancelled after the engine finished) is not an error of the PC */
    const S = await L.startService({ users: ['u1'] });
    try {
      const st = state0();
      let id = null;
      st.engine = async () => { await S.as('u1').post('/api/jobs/' + id + '/cancel', {}); return { ok: true, ms: 5, musicxml: L.scoreXml(1), movements: [L.scoreXml(1)] }; };
      const { w, lines } = newWorker(S, 'u1', st, null, { heartbeatMs: 100000 });
      const q = await queued(S, 'u1', w, 1, { w: 980 });
      id = q.id;
      const r = await w.processJob((await w.poll(true)).job);
      ok('cancelled while the last page was being read: stopped, no error line to the site, the job stays cancelled', jobOf(S, id).status === 'cancelled' && r !== undefined, r + ' ' + lines().slice(-2).join('|'));
    } finally { await S.close(); }
  }

  heading('--check: the engine, said plainly');
  {
    const S = await L.startService({ users: ['u1'] });
    try {
      const lines = [];
      const cfg = cfgFor(S, S.token('u1'));
      const log = W.makeLog(cfg, s => lines.push(s), s => lines.push(s));
      const fakeRun = async (cmd, args) => (cmd === 'ffmpeg-stub' ? { code: 0, tail: 'ffmpeg stub' } : W.runTool(cmd, args, {}));
      await W.checkSetup(cfg, log, { runTool: fakeRun, engineVersion: async () => '5.11.0' });
      ok('with the engine: "scores: Audiveris 5.11.0 at <path> - one page at a time, below-normal priority, 600 s a page at most"', lines.some(l => /ok\s+scores: Audiveris 5\.11\.0 at .* one page at a time, below-normal priority, 600 s a page at most/.test(l)), lines.filter(l => /Audiveris|scores/.test(l)).join(' | '));
      lines.length = 0;
      await W.checkSetup(Object.assign({}, cfg, { audiverisPath: '' }), log, { runTool: fakeRun });
      ok('without it a NOTE, not a FIX (a PC that only converts recordings is fine), with where it looked and the README', lines.some(l => /^\[.*\] note\s+no Audiveris found/.test(l)) && !lines.some(l => /FIX\s+.*Audiveris/.test(l)));
      lines.length = 0;
      await W.checkSetup(Object.assign({}, cfg, { omr: false }), log, { runTool: fakeRun });
      ok('"omr": false says that it is switched off on purpose', lines.some(l => /switched off in the settings/.test(l)));
    } finally { await S.close(); }
  }

  /* ---- the real omr/engine.js with a shell script for Audiveris, through the worker (POSIX only) ---- */
  heading('the shared engine module: the command line, the answer, a zip bomb');
  {
    const E = L.mod('omr/engine.js');
    const crc = b => zlib.crc32(b) >>> 0;
    const zipOf = (xml, deflate) => {
      const name = Buffer.from('score.xml'), raw = Buffer.from(xml, 'utf8'), data = deflate ? zlib.deflateRawSync(raw) : raw;
      const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(crc(raw), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
      const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(deflate ? 8 : 0, 10); central.writeUInt32LE(crc(raw), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
      const head = Buffer.concat([local, name, data]);
      const cd = Buffer.concat([central, name]);
      const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(head.length, 16);
      return Buffer.concat([head, cd, end]);
    };
    const dir = L.tmpDir('ppp-engine-');
    const xml = L.scoreXml(3);
    fs.writeFileSync(path.join(dir, 'stored.mxl'), zipOf(xml, false));
    fs.writeFileSync(path.join(dir, 'deflated.mxl'), zipOf(xml, true));
    ok('readMxlSync reads a stored and a deflated .mxl', E.readMxlSync(path.join(dir, 'stored.mxl')) === xml && E.readMxlSync(path.join(dir, 'deflated.mxl')) === xml);
    fs.writeFileSync(path.join(dir, 'bomb.mxl'), zipOf('<score-partwise>' + 'a'.repeat(70 * 1048576) + '</score-partwise>', true));
    ok('a .mxl that inflates past 64 MB is refused, not expanded into memory', (() => { try { E.readMxlSync(path.join(dir, 'bomb.mxl')); return false; } catch (e) { return /Cannot create a Buffer|maxOutputLength|larger than|ERR_BUFFER/i.test(String(e && (e.code || e.message))); } })());
    fs.writeFileSync(path.join(dir, 'junk.mxl'), 'not a zip');
    ok('a file that is not a zip is an error, not a crash', (() => { try { E.readMxlSync(path.join(dir, 'junk.mxl')); return false; } catch (e) { return /not a zip/.test(e.message); } })());
    ok('STEP_TIMEOUT_ARGS is the option the benchmark uses', E.STEP_TIMEOUT_ARGS.join(' ') === '-option org.audiveris.omr.Main.sheetStepTimeOut=1800');
    ok('findAudiveris: an explicit existing path wins; nothing is returned for a place that is not there', E.findAudiveris(path.join(dir, 'stored.mxl'), dir) === path.join(dir, 'stored.mxl') && (r => r === null || fs.existsSync(r))(E.findAudiveris('', path.join(dir, 'nope'))));
    L.rmDir(dir);
  }
  if (POSIX) {
    const S = await L.startService({ users: ['u1'] });
    try {
      const root = L.tmpDir('ppp-engine-sh-');
      const argsFile = path.join(root, 'args.txt');
      const mxlFile = path.join(root, 'page.mvt1.mxl');
      fs.writeFileSync(mxlFile, Buffer.from('placeholder'));
      /* a shell script that records its arguments and writes one .mxl (stored zip) into the -output folder */
      const crc = b => zlib.crc32(b) >>> 0;
      const name = Buffer.from('score.xml'), data = Buffer.from(L.scoreXml(2), 'utf8');
      const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
      const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc(data), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
      const head = Buffer.concat([local, name, data]); const cd = Buffer.concat([central, name]);
      const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(head.length, 16);
      fs.writeFileSync(mxlFile, Buffer.concat([head, cd, end]));
      const sh = path.join(root, 'fake-audiveris.sh');
      fs.writeFileSync(sh, '#!/bin/sh\necho "$@" >> "' + argsFile + '"\nif [ "$1" = "-version" ]; then echo "- Version:      5.11.0"; exit 0; fi\nout=""\nwhile [ $# -gt 0 ]; do if [ "$1" = "-output" ]; then out="$2"; shift; fi; shift; done\ncp "' + mxlFile + '" "$out/page.mvt1.mxl"\n', { mode: 0o755 });
      const st = state0();
      const cfg = cfgFor(S, S.token('u1'), { audiverisPath: sh });
      const out = [], err = [];
      const log = W.makeLog(cfg, s => out.push(s), s => err.push(s));
      const w = W.createWorker(cfg, { log: log, waitScale: 0.001, heartbeatMs: 40, noPriority: true });
      await w.poll(true);
      const q = await S.as('u1').post('/api/jobs/omr', { title: 'x', pages: L.omrPages(2, { w: 990 }) });
      const p = await w.poll(true);
      const r = await w.processJob(p.job);
      const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
      ok('the real omr/engine.js ran the script: -version once, then -batch -export -option ...=1800 -output <dir> -- <image> for each page', r === true && args.length === 3 && /^-version$/.test(args[0])
        && args.slice(1).every((a, i) => new RegExp('^-batch -export -option org\\.audiveris\\.omr\\.Main\\.sheetStepTimeOut=1800 -output \\S+out-' + (i + 1) + ' -- \\S+page-' + (i + 1) + '\\.png$').test(a)), JSON.stringify(args).slice(0, 300) + ' ' + out.concat(err).slice(-3).join('|'));
      ok('and the site has the two pages\' movements, the version named', jobOf(S, q.body.job.id).status === 'done' && (await S.as('u1').get('/api/jobs/' + q.body.job.id)).body.result.engineVersion === '5.11.0');
      void st;
      L.rmDir(root);
    } finally { await S.close(); }
  } else console.log('  - the real engine module through a shell-script stand-in is skipped on Windows (it runs in the gate, on Linux)');

  L.finish('the home-PC worker reads a score');
})().catch(e => { console.error(e); process.exit(1); });
