/* G10b-1: the home-PC worker (tools/home-worker/worker.js) against the real queue service, with stand-ins for the two things this test
   machine may not have: ffmpeg (a stub that writes a wav-sized file) and transcribe.py (tests/home-worker/fake-transcribe.js, run by Node,
   which prints the same PROGRESS lines and writes the same JSON). The real worker code runs everything else: the settings, the HTTP
   calls, the download, the process handling, the heartbeat, the conversion, the retries, the clean-up.

   What it pins: the settings and their complaints; that the notes sent are the helper's ACCEPTED notes in the page's format (the same
   conversion as review/h10/helper-heard.js) with no pedal and no beats, cut at 15 minutes, and accepted by the site; the arguments
   transcribe.py is given; every failure path (download, decode, the models, no notes, a rejected result) ends in ONE short line on the
   site and a removed scratch folder; a cancel on the site stops the work; the token never appears in a log; a rejected token stops the
   loop (exit 2); a network that is down never ends the loop; the waits are the site's, lengthened and never shortened by the settings.

   Run: node tests/home-worker/worker.test.js (an optional real run - ffmpeg, the venv, the GPU - is skipped unless PPP_HOME_WORKER_REAL=1) */
'use strict';
const L = require('./lib');
const { ok, heading, sleep, req, WATCH } = L;
const W = require('../../tools/home-worker/worker.js');
const { convertHelperNotes } = require('../../review/h10/helper-heard.js');
const path = require('path');
const fs = require('fs');

const FAKE = path.join(__dirname, 'fake-transcribe.js');
const WAVHDR = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(32)]);

function cfgFor(S, token, over) {
  const site = 'http://127.0.0.1:' + S.port;
  return Object.assign({}, W.DEFAULTS, {
    siteUrl: site, audioBase: site, token: token, pythonPath: process.execPath, transcribePy: FAKE, kongCheckpoint: '/fake/kong.pth', ariaCheckpoint: '',
    ffmpegPath: 'ffmpeg-stub', scratchDir: L.tmpDir('ppp-hw-scratch-'), maxSeconds: 900
  }, over || {});
}
/* ffmpeg is a stub; everything else (the "python") is run for real */
function tools(state) {
  return (cmd, args, o) => {
    if (cmd !== 'ffmpeg-stub') return W.runTool(cmd, args, o);
    state.ffmpegCalls.push(args);
    if (state.ffmpegFail) return Promise.resolve({ code: 1, tail: state.ffmpegFail === 'noaudio' ? 'Output file #0 does not contain any stream' : 'Invalid data found when processing input' });
    if (args[0] === '-version') return Promise.resolve({ code: 0, tail: 'ffmpeg version stub' });
    fs.writeFileSync(args[args.length - 1], Buffer.alloc(60000));
    return Promise.resolve({ code: 0, tail: '' });
  };
}
function siteRoutes(state) {
  return (rq, rs, url) => {
    if (url.pathname !== '/api/youtube-audio') return false;
    state.audioRequests.push(url.searchParams.get('url'));
    const mode = state.audioMode;
    if (mode === '502') { L.send(rs, 502, { error: 'The audio could not be downloaded from that link.', code: 'download-failed' }); return true; }
    if (mode === 'html') { L.send(rs, 200, '<html>blocked</html>', { 'Content-Type': 'text/html' }); return true; }
    if (mode === '422') { L.send(rs, 422, { error: 'Not a YouTube video.' }); return true; }
    rs.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': 5000 });
    rs.end(Buffer.concat([WAVHDR, Buffer.alloc(5000 - WAVHDR.length)]));
    return true;
  };
}
function logs() { const out = [], err = []; return { out: out, err: err, lines: () => out.concat(err) }; }
function newWorker(S, token, st, over, depsOver) {
  const cfg = cfgFor(S, token, over);
  const cap = logs();
  const log = W.makeLog(cfg, s => cap.out.push(s), s => cap.err.push(s));
  const w = W.createWorker(cfg, Object.assign({ log: log, runTool: tools(st), waitScale: 0.001, heartbeatMs: 50 }, depsOver || {}));
  return { w: w, cfg: cfg, cap: cap };
}
const scratchLeft = cfg => { try { return fs.readdirSync(cfg.scratchDir).length; } catch (e) { return 0; } };
const jobOf = (S, id) => S.svc._state.jobs.get(id);
async function mkToken(S, user) { return (await S.as(user).post('/api/worker/tokens', { label: 'PC' })).body.token; }
async function queue(S, user, id) { return (await S.as(user).post('/api/jobs', { url: WATCH(id), title: 'Piece ' + id })).body.job; }

(async () => {
  heading('the settings');
  const dir = L.tmpDir('ppp-hw-cfg-');
  const cfgFile = path.join(dir, 'worker.config.json');
  fs.writeFileSync(cfgFile, '﻿' + JSON.stringify({ siteUrl: 'https://ppp.example.com/', token: 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43), pythonPath: process.execPath, transcribePy: FAKE, idlePollSeconds: 5000, scratchDir: dir }));
  const c0 = W.loadConfig(cfgFile, {});
  ok('a settings file is read (a BOM is fine); a trailing / is cut from the site', c0.siteUrl === 'https://ppp.example.com' && c0.audioBase === 'https://ppp.example.com' && c0.idlePollSeconds === 5000 && c0.scratchDir === dir);
  ok('a good file has no problems', W.configProblems(c0).length === 0, W.configProblems(c0).join(' | '));
  ok('PPP_WORKER_TOKEN and PPP_WORKER_SITE override the file', (() => { const t = 'ppw_' + 'C'.repeat(12) + '_' + 'd'.repeat(43); const c = W.loadConfig(cfgFile, { PPP_WORKER_TOKEN: t, PPP_WORKER_SITE: 'https://other.example.com' }); return c.token === t && c.siteUrl === 'https://other.example.com'; })());
  const probs = c => W.configProblems(c).join(' | ');
  ok('an empty site, a token of the wrong shape, a missing python and a missing transcribe.py are each said', /siteUrl is empty/.test(probs(Object.assign({}, c0, { siteUrl: '' }))) && /token is missing/.test(probs(Object.assign({}, c0, { token: 'nope' })))
    && /pythonPath does not exist/.test(probs(Object.assign({}, c0, { pythonPath: '/no/such/python' }))) && /transcribePy does not exist/.test(probs(Object.assign({}, c0, { transcribePy: '/no/such.py' }))));
  ok('http:// to another host would send the token in the clear: refused unless allowInsecure; localhost is fine', /clear/.test(probs(Object.assign({}, c0, { siteUrl: 'http://ppp.example.com' }))) && !/clear/.test(probs(Object.assign({}, c0, { siteUrl: 'http://127.0.0.1:8777' })))
    && !/clear/.test(probs(Object.assign({}, c0, { siteUrl: 'http://ppp.example.com', allowInsecure: true }))));
  ok('a file that is not JSON, and no file at all, are said in a sentence', (() => { fs.writeFileSync(path.join(dir, 'bad.json'), '{oops'); try { W.loadConfig(path.join(dir, 'bad.json'), {}); return false; } catch (e) { return /could not be read as JSON/.test(e.message); } })()
    && (() => { try { W.loadConfig(path.join(dir, 'missing.json'), {}); return false; } catch (e) { return /could not be read|no settings file/.test(e.message); } })());
  ok('maxSeconds cannot be raised past the site\'s 15 minutes', W.loadConfig(cfgFile, {}).maxSeconds === 900 && W.loadConfig((fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ siteUrl: 'https://x', token: 'x', maxSeconds: 5000 })), path.join(dir, 'm.json')), {}).maxSeconds === 900);
  L.rmDir(dir);

  heading('how long it waits: the site decides; the settings only lengthen');
  const st0 = { ffmpegCalls: [], audioRequests: [] };
  const S0 = await L.startService({ extra: siteRoutes(st0) });
  try {
    const wait = (over, n) => newWorker(S0, 'ppw_x', st0, over).w.waitFor(n);
    ok('the site says 1200: it waits 1200', wait({}, 1200) === 1200);
    ok('the site says 15: it waits 15', wait({}, 15) === 15);
    ok('a setting of 3600 lengthens an idle wait of 1200 to 3600, and a setting of 60 does not shorten it', wait({ idlePollSeconds: 3600 }, 1200) === 3600 && wait({ idlePollSeconds: 60 }, 1200) === 1200);
    ok('the setting does not touch the active wait (15 s)...', wait({ idlePollSeconds: 3600 }, 15) === 15);
    ok('...which has its own setting, never under 5 s', wait({ activePollSeconds: 40 }, 15) === 40 && wait({ activePollSeconds: 1 }, 15) === 5 && wait({}, 1) === 5);
    ok('no answer from the site: the idle wait of the settings, or 20 minutes', wait({}, 0) === 1200 && wait({ idlePollSeconds: 2000 }, 0) === 2000);
  } finally { await S0.close(); }

  heading('the conversion of the helper\'s notes');
  {
    const fakeRaw = JSON.parse(await (async () => { const f = path.join(L.tmpDir(), 'n.json'); await new Promise(r => { const c = require('child_process').spawn(process.execPath, [FAKE, '--wav', 'x', '--out', f], { stdio: 'ignore' }); c.on('close', r); }); return fs.readFileSync(f, 'utf8'); })());
    const st = { ffmpegCalls: [], audioRequests: [] };
    const S = await L.startService({ extra: siteRoutes(st) });
    try {
      const { w } = newWorker(S, 'ppw_x', st);
      const r = w.toResult(fakeRaw);
      const heard = convertHelperNotes(fakeRaw).heard;
      ok('the notes are exactly those of review/h10/helper-heard.js (the accepted ones, rounded, sorted)', JSON.stringify(r.result.notes) === JSON.stringify(heard.notes), r.result.notes.length + ' vs ' + heard.notes.length);
      ok('the 17 uncertain notes are not notes: they are a number', r.result.notes.length === 120 && r.result.ensemble.uncertain === 17 && r.result.ensemble.accepted === 120);
      ok('there is no pedal and no beats in what is sent, and no per-note confidence', !('pedals' in r.result) && !('beats' in r.result) && !('uncertainNotes' in r.result) && r.result.notes.every(n => Object.keys(n).sort().join() === 'midi,off,on,vel'));
      ok('the ensemble summary is what the page reads: models, primary, agreement', r.result.ensemble.models.join() === 'transkun,piano-transcription' && r.result.ensemble.primary === 'transkun' && r.result.ensemble.agreement === 0.812 && r.result.device === 'cuda' && r.result.engine === 'ensemble');
      ok('what is sent passes the site\'s own checks', require('../../home-result').validateResult(r.result).ok);
      const long = JSON.parse(JSON.stringify(fakeRaw)); long.notes.forEach((n, i) => { n.on = i * 10; n.off = i * 10 + 5; }); long.duration = 1200;
      const lr = w.toResult(long);
      ok('notes past 15 minutes are cut, so a long piece is the first 15 minutes (as in the app), and still accepted', lr.result.notes.every(n => n.on < 901 && n.off <= 901) && lr.result.duration <= 901 && lr.result.notes.length > 80);
      let msg = ''; try { w.toResult({ notes: [{ on: 0, off: 1, midi: 60, vel: 5 }] }); } catch (e) { msg = e.message; }
      ok('fewer than 4 usable notes: "no piano notes were heard", not retried', /No piano notes/.test(msg));
    } finally { await S.close(); }
  }

  heading('a whole job, the real way round');
  const st = { ffmpegCalls: [], audioRequests: [], audioMode: 'ok' };
  const S = await L.startService({ extra: siteRoutes(st), config: { longPollMs: 100 } });
  try {
    const token = await mkToken(S, 'u1');
    process.env.FAKE_ARGV_FILE = path.join(S.dir, 'argv.json');
    delete process.env.FAKE_MODE;
    const job = await queue(S, 'u1', 'vgnliVjJUOo');
    const { w, cfg, cap } = newWorker(S, token, st);
    const code = await w.runOnce();
    ok('--once does the waiting job and exits 0', code === 0 && w.stats.done === 1 && w.stats.failed === 0, cap.lines().join('\n').slice(-600));
    const got = (await S.as('u1').get('/api/jobs/' + job.id)).body;
    ok('the site has the job done, with the helper\'s 120 accepted notes', got.job.status === 'done' && got.result.notes.length === 120 && got.result.ensemble.uncertain === 17, JSON.stringify(got.job));
    ok('the audio was asked for once, as the page asks: /api/youtube-audio?url=<the link>', st.audioRequests.length === 1 && st.audioRequests[0] === WATCH('vgnliVjJUOo'));
    const argv = JSON.parse(fs.readFileSync(process.env.FAKE_ARGV_FILE, 'utf8'));
    const a = argv.argv;
    ok('transcribe.py was given what omr-service.js gives it: --wav, --kong-wav, --out, --engine auto, --checkpoint', a[a.indexOf('--engine') + 1] === 'auto' && a[a.indexOf('--checkpoint') + 1] === '/fake/kong.pth' && /audio-master\.wav$/.test(a[a.indexOf('--wav') + 1]) && /audio-kong-16k\.wav$/.test(a[a.indexOf('--kong-wav') + 1]) && /notes\.json$/.test(a[a.indexOf('--out') + 1]) && a.indexOf('--aria-checkpoint') < 0, JSON.stringify(a));
    ok('and the two WAVs existed when it ran', argv.wavExists && argv.kongExists);
    const f1 = st.ffmpegCalls[0], f2 = st.ffmpegCalls[1];
    ok('ffmpeg ran twice as in omr-service.js: 44.1 kHz stereo master cut at 900 s, then 16 kHz mono for Kong', st.ffmpegCalls.length === 2 && f1.join(' ').includes('-ac 2 -ar 44100 -t 900') && f2.join(' ').includes('-ac 1 -ar 16000'), st.ffmpegCalls.map(x => x.join(' ')).join(' || ').slice(0, 300));
    ok('the scratch folder is gone', scratchLeft(cfg) === 0);
    ok('the log tells the person, in plain lines, what happened', /A conversion is waiting/.test(cap.out.join('\n')) && /Heard 120 notes \(17 more were kept apart/.test(cap.out.join('\n')) && /Done: the notes are on the site/.test(cap.out.join('\n')), cap.out.join('\n').slice(0, 900));
    ok('the token is nowhere in the log', cap.lines().every(l => l.indexOf(token) < 0 && l.indexOf(token.slice(17)) < 0 && !/ppw_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{20}/.test(l)));
    const none = await newWorker(S, token, st).w.runOnce();
    ok('--once with nothing waiting says so and exits 0', none === 0);
    ok('the log line of a token it would otherwise show is cut', W.makeLog({ token: token }, () => {}, () => {}).redact('x ' + token + ' y Bearer abc.def') === 'x ppw_*** y Bearer ***');

    heading('failures: one short line on the site, the scratch removed');
    const fail = async (name, setup, expectText, retryExpected, mkJob) => {
      setup();
      const j = await queue(S, 'u1', 'fail' + String(Math.random()).slice(2, 9));
      const x = newWorker(S, token, st);
      const rc = await x.w.runOnce();
      const row = jobOf(S, j.id);
      const okState = retryExpected ? row.status === 'queued' || row.status === 'claimed' : row.status === 'failed';
      ok(name, okState && expectText.test(row.error) && scratchLeft(x.cfg) === 0, row.status + ' / ' + row.error + ' / exit ' + rc);
      if (row.status === 'queued') await S.as('u1').post('/api/jobs/' + j.id + '/cancel');
      return { x: x, row: row, rc: rc };
    };
    const reset = () => { st.audioMode = 'ok'; st.ffmpegFail = false; delete process.env.FAKE_MODE; delete process.env.FAKE_NOTES; };
    await fail('the site cannot get the audio (502 three times): requeued with a reason', () => { reset(); st.audioMode = '502'; }, /audio could not be downloaded/, true);
    ok('...and it asked three times (as the page asks twice) with waits between', st.audioRequests.length >= 4);
    await fail('a page instead of audio (a block): the same', () => { reset(); st.audioMode = 'html'; }, /audio could not be downloaded/, true);
    await fail('the site says it is not a YouTube video (422): failed for good, no retry', () => { reset(); st.audioMode = '422'; }, /not a YouTube video/, false);
    await fail('ffmpeg cannot decode: failed for good', () => { reset(); st.ffmpegFail = 'bad'; }, /could not be decoded/, false);
    await fail('a video with no audio track: said so', () => { reset(); st.ffmpegFail = 'noaudio'; }, /no audio track/, false);
    await fail('the piano models crash (CUDA out of memory): the site may try again', () => { reset(); process.env.FAKE_MODE = 'fail'; }, /piano models failed/, true);
    await fail('the models write something that is not JSON: the same', () => { reset(); process.env.FAKE_MODE = 'garbage'; }, /piano models failed/, true);
    await fail('only two notes heard: "no piano notes", failed for good', () => { reset(); process.env.FAKE_MODE = 'empty'; }, /No piano notes/, false);
    reset();
    const bigNotes = await fail('a result the site refuses (too many notes) is failed with the site\'s reason, not retried', () => { reset(); process.env.FAKE_NOTES = '20500'; }, /did not pass the site's checks|More than 20000/, false);
    void bigNotes;
    reset();

    heading('after three attempts');
    st.audioMode = '502';
    const j3 = await queue(S, 'u1', 'attempts123');
    const afterFirst = await newWorker(S, token, st).w.runOnce();
    ok('one --once run tries it once (the site holds it back for a few minutes), exits 1 because it failed', afterFirst === 1 && jobOf(S, j3.id).status === 'queued' && jobOf(S, j3.id).attempts === 1);
    for (let i = 0; i < 2; i++) { S.advance(10 * 60 * 1000); await newWorker(S, token, st).w.runOnce(); }
    ok('a job that cannot be downloaded is tried three times (in three runs) and then failed (the site counts)', jobOf(S, j3.id).status === 'failed' && jobOf(S, j3.id).attempts === 3, jobOf(S, j3.id).status + ' ' + jobOf(S, j3.id).attempts);
    reset();

    heading('a cancel on the site stops the work');
    process.env.FAKE_MODE = 'slow';
    const jc = await queue(S, 'u1', 'cancelmid01');
    const xc = newWorker(S, token, st);
    const running = xc.w.runOnce();
    for (let i = 0; i < 100 && !(jobOf(S, jc.id) && jobOf(S, jc.id).status === 'claimed' && xc.w.ctl.child); i++) await sleep(50);
    await sleep(150);
    await S.as('u1').post('/api/jobs/' + jc.id + '/cancel');
    const t0 = Date.now();
    await running;
    ok('the heartbeat hears it, the models are killed (no 30 s wait), nothing is sent', Date.now() - t0 < 8000 && jobOf(S, jc.id).status === 'cancelled' && /cancelled on the site/.test(xc.cap.out.join('\n')), (Date.now() - t0) + ' ms');
    ok('the scratch folder is gone', scratchLeft(xc.cfg) === 0);
    reset();
    delete process.env.FAKE_ARGV_FILE;

    heading('the network and the token');
    const jr = await queue(S, 'u1', 'retryresult');
    let posts = 0;
    const real = require('../../tools/home-worker/worker.js').request;
    const flaky = (cfg, m, p, o) => { if (/\/result$/.test(p) && posts++ === 0) return Promise.resolve({ status: 503, body: { error: 'x' }, text: '', headers: {} }); return real(cfg, m, p, o); };
    const xr = newWorker(S, token, st, {}, { request: flaky });
    ok('a result the site answers 503 to is sent again, and then taken', (await xr.w.runOnce()) === 0 && jobOf(S, jr.id).status === 'done' && posts === 2, jobOf(S, jr.id).status + ' ' + posts);
    const bad = newWorker(S, 'ppw_' + 'Z'.repeat(12) + '_' + 'y'.repeat(43), st);
    ok('a token the site rejects: --once exits 2 and says what to do', (await bad.w.runOnce()) === 2 && /does not accept this token/.test(bad.cap.out.join('\n')));
    const loopBad = newWorker(S, 'ppw_' + 'Z'.repeat(12) + '_' + 'y'.repeat(43), st);
    ok('the loop stops on it too (exit 2), instead of trying for ever', (await loopBad.w.runForever()) === 2);
    const rev = await mkToken(S, 'u2');
    const id2 = rev.slice(4, 16);
    await S.as('u2').del('/api/worker/tokens/' + id2);
    ok('a revoked token is the same', (await newWorker(S, rev, st).w.runOnce()) === 2);
    const dead = L.http.createServer(() => {}); await new Promise(r => dead.listen(0, '127.0.0.1', r)); const deadPort = dead.address().port; await new Promise(r => dead.close(r));
    const down = newWorker(S, token, st, { siteUrl: 'http://127.0.0.1:' + deadPort, audioBase: 'http://127.0.0.1:' + deadPort });
    ok('--once with the site unreachable: tries 3 times, says so, exits 1 (not 0, not a crash)', (await down.w.runOnce()) === 1 && /Could not reach the site/.test(down.cap.out.join('\n')) && (down.cap.out.join('\n').match(/Trying again/g) || []).length === 2, down.cap.out.join('\n').slice(0, 400));

    heading('the loop: patient, and it never dies of the network');
    const lp = newWorker(S, token, st, {}, {});
    const seenPolls = [];
    const realPoll = lp.w.poll;
    void realPoll;
    let calls = 0;
    const scripted = (cfg, m, p, o) => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('ECONNREFUSED'));
      if (calls === 2) return Promise.resolve({ status: 502, body: null, text: 'bad gateway', headers: {} });
      if (calls === 3) return Promise.resolve({ status: 429, body: { error: 'slow down' }, text: '', headers: { 'retry-after': '1' } });
      seenPolls.push(o.json);
      if (calls === 4) return Promise.resolve({ status: 200, body: { job: null, nextPollSeconds: 1200 }, text: '', headers: {} });
      lp.w.ctl.stop = true; if (lp.w.ctl.wake) lp.w.ctl.wake();
      return Promise.resolve({ status: 200, body: { job: null, nextPollSeconds: 15 }, text: '', headers: {} });
    };
    const lw = newWorker(S, token, st, { idlePollSeconds: 3000 }, { request: scripted });
    lp.w.ctl.stop = false;
    lw.w.ctl.stop = false;
    const stopLater = setTimeout(() => { lw.w.ctl.stop = true; if (lw.w.ctl.wake) lw.w.ctl.wake(); }, 3000);
    const origCall = scripted;
    void origCall;
    const lrc = await lw.w.runForever();
    clearTimeout(stopLater);
    const text = lw.cap.out.join('\n');
    ok('a refused connection, a 502 and a 429 are each waited out with a sentence, and the loop goes on', lrc === 0 && /Could not reach the site/.test(text) && /answered 502/.test(text) && /answered 429/.test(text), text.slice(0, 700));
    ok('an idle answer (1200) with the setting 3000 is waited as 3000 and said so', /Next check in 50 min/.test(text), text.slice(-300));
    ok('the poll tells the site how long it will wait when idle (so "is the PC alive" is right)', seenPolls.length >= 1 && seenPolls[0].waitSeconds === 3000 && seenPolls[0].once === false, JSON.stringify(seenPolls));

    heading('a job found by the loop, then a stop');
    const jl = await queue(S, 'u1', 'loopjob0001');
    const lw2 = newWorker(S, token, st, {}, {});
    const lp2 = lw2.w.runForever();
    for (let i = 0; i < 200 && jobOf(S, jl.id).status !== 'done'; i++) await sleep(50);
    ok('the loop takes the job at once and finishes it', jobOf(S, jl.id).status === 'done');
    lw2.w.ctl.stop = true; if (lw2.w.ctl.wake) lw2.w.ctl.wake();
    ok('and a stop ends it cleanly (exit 0, "Stopped")', (await lp2) === 0 && /Stopped\./.test(lw2.cap.out.join('\n')));

    heading('--check');
    const chk = newWorker(S, token, st);
    const chkCode = await W.checkSetup(chk.cfg, chk.w.log, { runTool: (c, a, o) => (c === 'ffmpeg-stub' ? Promise.resolve({ code: 0, tail: '' }) : Promise.resolve({ code: 0, tail: 'cuda\n' })) });
    ok('a good setup says "Everything is ready" and exits 0', chkCode === 0 && /Everything is ready/.test(chk.cap.out.join('\n')) && /the site accepts the token/.test(chk.cap.out.join('\n')), chk.cap.out.join('\n').slice(-500));
    const chk2 = newWorker(S, 'ppw_' + 'Z'.repeat(12) + '_' + 'y'.repeat(43), st, { kongCheckpoint: '' });
    const chkCode2 = await W.checkSetup(chk2.cfg, chk2.w.log, { runTool: () => Promise.resolve({ code: 1, tail: 'ModuleNotFoundError: No module named torch' }) });
    const t2 = chk2.cap.out.join('\n');
    ok('a bad one lists what to fix: the token, ffmpeg, Kong, Python', chkCode2 === 1 && /does not accept this token/.test(t2) && /ffmpeg does not run/.test(t2) && /no Kong checkpoint/.test(t2) && /cannot import torch/.test(t2) && /thing\(s\) to fix/.test(t2), t2.slice(0, 700));
  } finally { await S.close(); }

  heading('what the site was asked, from the site\'s side');
  {
    /* the requests a worker makes are the documented ones, and nothing else */
    const seen = [];
    const st2 = { ffmpegCalls: [], audioRequests: [], audioMode: 'ok' };
    const S2 = await L.startService({ extra: siteRoutes(st2) });
    try {
      const token = await mkToken(S2, 'u1');
      const job = await queue(S2, 'u1', 'sitesideaaa');
      const real = W.request;
      const spy = (cfg, m, p, o) => { seen.push(m + ' ' + p.replace(job.id, ':id')); return real(cfg, m, p, o); };
      const x = newWorker(S2, token, st2, {}, { request: spy });
      await x.w.runOnce();
      const uniq = Array.from(new Set(seen));
      ok('a one-job --once run uses only claim, heartbeat and result (two claims: the job, then "nothing waiting")', uniq.every(u => /^(POST \/api\/worker\/claim|POST \/api\/worker\/jobs\/:id\/(heartbeat|result))$/.test(u)) && seen.filter(s => /claim/.test(s)).length === 2, JSON.stringify(seen));
    } finally { await S2.close(); }
  }

  if (process.env.PPP_HOME_WORKER_REAL === '1') {
    heading('the real tools (ffmpeg, the venv)');
    console.log('  - run by hand: see docs/GOALS/G10B_HOME_WORKER.md, "the real end-to-end run"');
  } else console.log('\n  - the real-tools run (ffmpeg, the venv, the GPU) is not part of this test: it is the end-to-end run in docs/GOALS/G10B_HOME_WORKER.md.');
})().then(() => L.finish('the home-PC worker'), e => { console.error(e); process.exit(1); });
