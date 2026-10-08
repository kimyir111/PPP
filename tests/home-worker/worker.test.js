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
const W = L.mod('tools/home-worker/worker.js');
const { convertHelperNotes } = L.mod('review/h10/helper-heard.js');
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
    if (url.pathname === '/api/audio-final' || url.pathname === '/api/hop') (state.audioHeaders = state.audioHeaders || []).push({ authorization: rq.headers.authorization, cookie: rq.headers.cookie });
    if (url.pathname === '/api/audio-final') { rs.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': 5000 }); rs.end(Buffer.concat([WAVHDR, Buffer.alloc(5000 - WAVHDR.length)])); return true; }
    if (url.pathname === '/api/hop') { const n = +url.searchParams.get('n'); if (n >= 6) { rs.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': 5000 }); rs.end(Buffer.concat([WAVHDR, Buffer.alloc(5000 - WAVHDR.length)])); return true; } rs.writeHead(302, { Location: '/api/hop?n=' + (n + 1) }); rs.end(); return true; }
    if (url.pathname !== '/api/youtube-audio') return false;
    state.audioRequests.push(url.searchParams.get('url'));
    (state.audioHeaders = state.audioHeaders || []).push({ authorization: rq.headers.authorization, cookie: rq.headers.cookie });
    const mode = state.audioMode;
    const wav = () => { rs.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': 5000 }); rs.end(Buffer.concat([WAVHDR, Buffer.alloc(5000 - WAVHDR.length)])); return true; };
    const to = loc => { rs.writeHead(302, { Location: loc }); rs.end(); return true; };
    if (mode === 'redir') return to('/api/audio-final');
    if (mode === 'chain') return to('/api/hop?n=1');
    if (mode === 'ftp') return to('ftp://example.com/a.m4a');
    if (mode === 'file') return to('file:///etc/passwd');
    if (mode === 'garbage') return to('http://[');
    if (mode === 'other') return to('http://127.0.0.1:' + state.lanPort + '/steal');
    if (mode === 'big-length') { rs.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': 3 * 1048576 }); rs.write(WAVHDR); rs.end(Buffer.alloc(3 * 1048576 - WAVHDR.length)); return true; }
    if (mode === 'big-chunked') { rs.writeHead(200, { 'Content-Type': 'audio/wav' }); rs.write(WAVHDR); let k = 0; const more = () => { if (k++ >= 60 || rs.destroyed) return rs.end(); rs.write(Buffer.alloc(64 * 1024), more); }; more(); return true; }
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
async function mkToken(S, user) { return S.token(user); }   /* the token the link was made with */
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
    ok('the site says 3600: it waits 3600', wait({}, 3600) === 3600);
    ok('the site says 15: it waits 15', wait({}, 15) === 15);
    ok('a setting of 7200 lengthens an idle wait of 3600 to 7200, and a setting of 60 does not shorten it', wait({ idlePollSeconds: 7200 }, 3600) === 7200 && wait({ idlePollSeconds: 60 }, 3600) === 3600);
    ok('the setting does not touch the active wait (15 s)...', wait({ idlePollSeconds: 3600 }, 15) === 15);
    ok('...which has its own setting, never under 5 s', wait({ activePollSeconds: 40 }, 15) === 40 && wait({ activePollSeconds: 1 }, 15) === 5 && wait({}, 1) === 5);
    ok('no answer from the site: the idle wait of the settings, or an hour', wait({}, 0) === 3600 && wait({ idlePollSeconds: 2000 }, 0) === 2000);
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
      ok('there is no pedal and no beats in what is sent without a beat tracker, and no per-note confidence', !('pedals' in r.result) && !('beats' in r.result) && !('uncertainNotes' in r.result) && r.result.notes.every(n => Object.keys(n).sort().join() === 'midi,off,on,vel'));
      /* G10a-1d: the beat tracker's beats and downbeats go with the notes, cut to the piece, rising, rounded */
      const rb = w.toResult(fakeRaw, { beats: [3, 1, 2, 2, 4.123456, 200, NaN, 5, 6], downbeats: [1, 'x', 4.123456] });
      ok('the beat tracker\'s beats go with the notes: finite, rising, within the piece, rounded; its downbeats likewise', JSON.stringify(rb.result.beats) === JSON.stringify([3, 4.1235, 5, 6]) && JSON.stringify(rb.result.downbeats) === JSON.stringify([1, 4.1235]) && L.mod('home-result.js').validateResult(rb.result).ok, JSON.stringify([rb.result.beats, rb.result.downbeats]));
      const rf = w.toResult(fakeRaw, { beats: [1, 2, 3], downbeats: [1] });
      ok('fewer than four usable beats: the notes go alone', !('beats' in rf.result) && !('downbeats' in rf.result));
      ok('the ensemble summary is what the page reads: models, primary, agreement', r.result.ensemble.models.join() === 'transkun,piano-transcription' && r.result.ensemble.primary === 'transkun' && r.result.ensemble.agreement === 0.812 && r.result.device === 'cuda' && r.result.engine === 'ensemble');
      ok('what is sent passes the site\'s own checks', L.mod('home-result.js').validateResult(r.result).ok);
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
    ok('ffmpeg ran twice as in omr-service.js: 44.1 kHz stereo master cut at 900 s, then 16 kHz mono for Kong - each limited to local files and pipes (-protocol_whitelist file,pipe before -i), so a container cannot make it open a network address', st.ffmpegCalls.length === 2 && f1.join(' ').includes('-ac 2 -ar 44100 -t 900') && f2.join(' ').includes('-ac 1 -ar 16000') && [f1, f2].every(f => f[f.indexOf('-protocol_whitelist') + 1] === 'file,pipe' && f.indexOf('-protocol_whitelist') < f.indexOf('-i')), st.ffmpegCalls.map(x => x.join(' ')).join(' || ').slice(0, 300));
    ok('the scratch folder is gone', scratchLeft(cfg) === 0);
    ok('the log tells the person, in plain lines, what happened', /A conversion is waiting/.test(cap.out.join('\n')) && /Heard 120 notes \(17 more were kept apart/.test(cap.out.join('\n')) && /Done: the notes are on the site/.test(cap.out.join('\n')), cap.out.join('\n').slice(0, 900));
    ok('the token never went to the audio endpoint: no Authorization header, no cookie (the site\'s audio endpoint is public; the worker\'s token is for the queue only)', st.audioHeaders.length === 1 && st.audioHeaders.every(h => h.authorization === undefined && h.cookie === undefined), JSON.stringify(st.audioHeaders));
    ok('the token is nowhere in the log', cap.lines().every(l => l.indexOf(token) < 0 && l.indexOf(token.slice(17)) < 0 && !/ppw_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{20}/.test(l)));
    const none = await newWorker(S, token, st).w.runOnce();
    ok('--once with nothing waiting says so and exits 0', none === 0);
    ok('the log line of a token it would otherwise show is cut', W.makeLog({ token: token }, () => {}, () => {}).redact('x ' + token + ' y Bearer abc.def') === 'x ppw_*** y Bearer ***');

    heading('G10a-1d: the beat tracker (beat_track.py) runs after the models; its beats go with the notes; a failure of it fails nothing');
    {
      const FAKE_BT = path.join(__dirname, 'fake-beat-track.js');
      const jb = await queue(S, 'u1', 'beatsbeats1');
      const xb = newWorker(S, token, st, { beatTrackPy: FAKE_BT });
      ok('a job with the beat tracker is done', (await xb.w.runOnce()) === 0 && xb.w.stats.done === 1);
      const gb = (await S.as('u1').get('/api/jobs/' + jb.id)).body;
      ok('the site keeps its beats and downbeats beside the notes (rising, within the piece)', gb.result && Array.isArray(gb.result.beats) && gb.result.beats.length === 240 && gb.result.downbeats.length === 60 && gb.result.beats.every((t, i, a) => !i || t > a[i - 1]), gb.result ? Object.keys(gb.result).join() : 'none');
      ok('the log says the beats went too', /and 240 beats/.test(xb.cap.out.join('\n')), xb.cap.out.join('\n').slice(-400));
      process.env.FAKE_BEATS_MODE = 'fail';
      const jf = await queue(S, 'u1', 'beatsfails1');
      const xf = newWorker(S, token, st, { beatTrackPy: FAKE_BT });
      ok('a beat tracker that fails: the job is done with the notes alone', (await xf.w.runOnce()) === 0 && xf.w.stats.done === 1);
      const gf = (await S.as('u1').get('/api/jobs/' + jf.id)).body;
      ok('...no beats in it, and the log says why', gf.result && !('beats' in gf.result) && /beat tracker did not run/.test(xf.cap.out.join('\n')));
      process.env.FAKE_BEATS_MODE = 'garbage';
      const jg = await queue(S, 'u1', 'beatsjunk01');
      const xg = newWorker(S, token, st, { beatTrackPy: FAKE_BT });
      ok('a beat tracker that writes junk: the same', (await xg.w.runOnce()) === 0 && !('beats' in (await S.as('u1').get('/api/jobs/' + jg.id)).body.result));
      delete process.env.FAKE_BEATS_MODE;
      const jo = await queue(S, 'u1', 'beatsoff001');
      const xo = newWorker(S, token, st, { beatTrackPy: FAKE_BT, beats: false });
      ok('beats: false in the settings: the tracker is not run', (await xo.w.runOnce()) === 0 && !('beats' in (await S.as('u1').get('/api/jobs/' + jo.id)).body.result));
    }

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

    heading('the audio download: redirects, sizes');
    {
      const LAN = L.http.createServer((q, r) => { lan.hits.push(q.url); r.writeHead(200, { 'Content-Type': 'audio/wav' }); r.end('RIFFxxxx'); });
      const lan = { hits: [] };
      await new Promise(r => LAN.listen(0, '127.0.0.1', r));
      st.lanPort = LAN.address().port;
      let rn = 0;
      const run = async (name, mode, over) => {
        reset(); st.audioMode = mode;
        const j = await queue(S, 'u1', 'redirtest' + String(rn++).padStart(2, '0'));
        const x = newWorker(S, token, st, over || {});
        const rc = await x.w.runOnce();
        const row = jobOf(S, j.id);
        return { rc: rc, row: row, x: x, name: name, text: x.cap.lines().join('\n') };
      };
      const same = await run('same origin', 'redir');
      ok('a redirect to the site\'s own address is followed', same.row.status === 'done' && same.rc === 0, same.row.status + ' ' + same.row.error);
      const chain = await run('chain', 'chain');
      ok('five redirects in a row are too many (4 at most): the job is given back, not run for ever', chain.row.status !== 'done' && /Too many redirects/.test(chain.text), chain.row.status + ' ' + chain.row.error);
      if (chain.row.status === 'queued') await S.as('u1').post('/api/jobs/' + chain.row.id + '/cancel');
      for (const mode of ['ftp', 'file', 'garbage']) {
        const r = await run(mode, mode);
        ok('a redirect to ' + (mode === 'ftp' ? 'ftp://' : mode === 'file' ? 'file://' : 'an address that is not one (http://[)') + ' fails that job cleanly (no crash, the process goes on, failed for good, a sentence)', r.row.status === 'failed' && /another address|cannot be used/.test(r.row.error) && scratchLeft(r.x.cfg) === 0, r.row.status + ' / ' + r.row.error + ' / exit ' + r.rc);
      }
      const other = await run('other', 'other');
      ok('a redirect to another origin (a machine on the local network) is not followed: the other machine is never asked', other.row.status === 'failed' && /another address/.test(other.row.error) && lan.hits.length === 0, other.row.status + ' ' + other.row.error + ' hits ' + lan.hits.length);
      st.audioHeaders = [];
      await run('headers', 'redir');
      ok('nothing sent for the audio, redirects included, carried the token or a cookie', st.audioHeaders.length === 2 && st.audioHeaders.every(h => h.authorization === undefined && h.cookie === undefined), JSON.stringify(st.audioHeaders));
      for (const mode of ['big-length', 'big-chunked']) {
        const r = await run(mode, mode, { maxAudioMB: 1 });
        ok('audio of 3 MB against a cap of 1 MB (' + (mode === 'big-length' ? 'announced by its length' : 'streamed, no length') + '): refused for good, nothing kept', r.row.status === 'failed' && /larger than 1 MB/.test(r.row.error) && scratchLeft(r.x.cfg) === 0, r.row.status + ' / ' + r.row.error);
      }
      await new Promise(r => LAN.close(r));
      reset();
    }

    heading('scratch folders left by a crash');
    {
      const x = newWorker(S, token, st);
      fs.mkdirSync(x.cfg.scratchDir, { recursive: true });
      const old = fs.mkdtempSync(path.join(x.cfg.scratchDir, 'job-')), fresh = fs.mkdtempSync(path.join(x.cfg.scratchDir, 'job-')), other = path.join(x.cfg.scratchDir, 'photos');
      fs.mkdirSync(other); fs.writeFileSync(path.join(old, 'source.audio'), 'x');
      const three = new Date(Date.now() - 3 * 3600 * 1000);
      fs.utimesSync(old, three, three);
      const rc = await x.w.runOnce();
      ok('at the start, a job-XXXXXX folder older than 2 hours is removed; a newer one (another run may be using it) and folders that are not the worker\'s stay', rc === 0 && !fs.existsSync(old) && fs.existsSync(fresh) && fs.existsSync(other) && /Removed 1 old scratch folder/.test(x.cap.out.join('\n')), x.cap.out.join(' | '));
      ok('...and a name that only looks like one is not touched', (() => { const odd = path.join(x.cfg.scratchDir, 'job-keep'); fs.mkdirSync(odd); fs.utimesSync(odd, three, three); x.w.sweepScratch(); const kept = fs.existsSync(odd); return kept; })());
    }

    heading('what the log may show: no escape sequences, no bidi tricks');
    {
      const lg = W.makeLog({ token: token }, () => {}, () => {});
      ok('colour and cursor sequences (CSI), operating-system commands (OSC) and the other control characters are removed (not replaced); a newline and a tab stay', lg.clean('a\u001b[31mRED\u001b[0m b\u001b]0;pwned\u0007c \u001b[2J\u001b[Hd\u0000e\u0008f\tg\nh') === 'aRED bc def\tg\nh', JSON.stringify(lg.clean('a\u001b[31mRED\u001b[0m b\u001b]0;pwned\u0007c \u001b[2J\u001b[Hd\u0000e\u0008f\tg\nh')));
      ok('bidi overrides and isolates, directional marks and line separators are removed (a file name that reads as photo.jpg and is photo.exe cannot be written)', lg.clean('x\u202etxt.exe\u2066y\u2069z\u2028w\u200fv') === 'xtxt.exeyzwv', JSON.stringify(lg.clean('x\u202etxt.exe\u2066y\u2069z\u2028w\u200fv')));
      const hostile = (cfg, m, p, o) => /claim$/.test(p) ? Promise.resolve({ status: 200, body: n0++ === 0 ? { job: { id: 'abcdefgh1234', url: WATCH('abcdefghijk'), title: 'Song\u001b[31m RED \u001b]0;pwned\u0007\u202etxt.exe', attempt: 1 }, nextPollSeconds: 15 } : { job: null, nextPollSeconds: 15 }, text: '', headers: {} }) : Promise.resolve({ status: 200, body: { ok: true }, text: '', headers: {} });
      let n0 = 0;
      const xh = newWorker(S, token, st, {}, { request: hostile, download: () => Promise.reject(Object.assign(new Error('no audio here'), { retry: false })) });
      await xh.w.runOnce();
      const all = xh.cap.lines().join('\n');
      ok('a title that carries escape sequences and a bidi override reaches the log without them', /Song/.test(all) && !/[\u001b\u202e\u0007]/.test(all), JSON.stringify(all.slice(0, 200)));
    }

    heading('the log hides the token even when something is put in the middle of it');
    {
      const out = [], err = [];
      const lg = W.makeLog({ token: token }, s => out.push(s), s => err.push(s));
      const cut = 20;
      const splits = ['\u001b[31m', '\u001b]0;pwned\u0007', '\u001b[2J\u001b[H', '\u0000', '\u0008', '\u202e', '\u2066', '\u200f', '\u2028', '\u001b[1;31m\u001b[0m'];
      splits.forEach(sp => { lg('x ' + token.slice(0, cut) + sp + token.slice(cut) + ' y'); lg.warn('x ' + token.slice(0, cut) + sp + token.slice(cut) + ' y'); });
      const all = out.concat(err);
      ok(splits.length * 2 + ' lines with the token split by an escape sequence, a control character, a bidi mark or a line separator: every one shows only ppw_***, no piece of the secret', all.length === splits.length * 2 && all.every(l => /^\[\d\d:\d\d:\d\d\] x ppw_\*\*\* y$/.test(l)) && all.every(l => l.indexOf(token.slice(cut)) < 0 && l.indexOf(token.slice(4, 14)) < 0), JSON.stringify(all.slice(0, 2)));
      ok('the same through log.warn and through a token the log was not told about (the shape alone)', (() => { const o2 = [], lg2 = W.makeLog({}, s => o2.push(s), () => {}); lg2('t ' + token.slice(0, 30) + '\u001b[0m' + token.slice(30)); return /ppw_\*\*\*$/.test(o2[0]) && o2[0].indexOf(token.slice(30)) < 0; })());
    }

    heading('the log hides the token whatever is put in it: escape sequences that swallow a letter of it, zero-width and invisible characters');
    {
      const out = [];
      const lg = W.makeLog({ token: token }, s => out.push(s), s => out.push(s));
      /* a character of the token is the letter an ESC sequence takes (ESC then one of @-Z \ ] ^ _): removed with the sequence, the token is not whole in the cleaned text */
      const swallowed = [];
      for (let i = 1; i < token.length; i++) if (/[@-Z\\-_]/.test(token[i])) swallowed.push(i);
      ok('the token has letters that an ESC would swallow (so the cases below are real ones)', swallowed.length >= 3, swallowed.join());
      const leaks = [];
      const windows = []; for (let i = 0; i + 9 <= token.length; i++) windows.push(token.slice(i, i + 9));
      const shows = line => windows.some(w => line.indexOf(w) >= 0);
      let cases = 0;
      /* every character the cleaner removes (found by trying them all), and the ones a reviewer found that split a token */
      const seps = [];
      for (let c = 0; c < 0x3000; c++) { const ch = String.fromCharCode(c); if (lg.clean('a' + ch + 'b') === 'ab') seps.push(ch); }
      const more = ['\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00ad', '\u180e', '\u2061', '\u2062', '\u2063', '\u2064', '\ud800', '\u0301', '\u001b'];
      const positions = [1, 4, 5, 10, 16, 17, 30, token.length - 1].concat(swallowed.slice(0, 6));
      for (const sep of seps.concat(more)) {
        for (const pos of positions) {
          for (const how of ['log', 'warn']) {
            out.length = 0; cases++;
            (how === 'log' ? lg : lg.warn)('boom ' + token.slice(0, pos) + sep + token.slice(pos) + ' end');
            if (shows(out[0]) || /[\u001b]/.test(out[0])) leaks.push(JSON.stringify(sep) + '@' + pos + ' ' + how + ' -> ' + JSON.stringify(out[0].slice(0, 100)));
          }
        }
      }
      ok(cases + ' lines (each of the ' + seps.length + ' removed characters and ' + more.length + ' invisible or combining ones, at ' + positions.length + ' places in the token, through log and log.warn): not one shows 9 characters of the token, and none keeps an ESC', leaks.length === 0, leaks.length + ' leaks, e.g. ' + leaks.slice(0, 2).join(' | '));
      /* an ESC and then the token's own letter, spelled out: the letter is not lost */
      out.length = 0;
      lg('x ' + token.slice(0, swallowed[0]) + '\u001b' + token.slice(swallowed[0]) + ' y');
      ok('an ESC put in front of a letter of the token (ESC takes that letter as its second character): the line still shows only ppw_*** and no ESC', /^\[\d\d:\d\d:\d\d\] x ppw_\*\*\* y$/.test(out[0]), JSON.stringify(out[0]));
      /* zero-width and invisible characters are removed from the text itself, token or not */
      const zw = ['\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u2060', '\ufeff'];
      ok('the zero-width space, non-joiner, joiner, the two directional marks, the word joiner and the byte order mark are removed (not replaced)', zw.every(c => lg.clean('a' + c + 'b') === 'ab'), zw.filter(c => lg.clean('a' + c + 'b') !== 'ab').map(c => c.charCodeAt(0).toString(16)).join());
      out.length = 0;
      lg('Song' + zw.join('') + ' title \u2060x\ufeff');
      ok('and a line with them reaches the log without them', /^\[\d\d:\d\d:\d\d\] Song title x$/.test(out[0]), JSON.stringify(out[0]));
      out.length = 0;
      lg('colour \u001b[31mred\u001b[0m and a title\u001b]0;pwned\u0007 stay\ttabbed\nnext');
      ok('a line without a token is cleaned as before: the whole sequences go, a tab and a newline stay', out[0].replace(/^\[\d\d:\d\d:\d\d\] /, '') === 'colour red and a title stay\ttabbed\nnext', JSON.stringify(out[0]));
    }

    heading('a wait is never longer than a day, and never NaN');
    {
      const waitsFor2 = async (script, over, nWaits) => {
        let i = 0;
        const request = () => { const a2 = script[Math.min(i++, script.length - 1)]; return Promise.resolve(Object.assign({ text: '', headers: {} }, a2)); };
        const x = newWorker(S, token, st, over || {}, { request: request, jitter: () => 0 });
        const waits = [];
        const orig = x.w.ctl.sleep;
        x.w.ctl.sleep = ms => { waits.push(ms / 1000); if (waits.length >= nWaits) x.w.ctl.stop = true; return orig(0); };
        const polls0 = Date.now();
        await x.w.runForever();
        return { waits: waits, ms: Date.now() - polls0, polls: i };
      };
      const ra = async v => waitsFor2(Array(6).fill({ status: 429, body: { error: 'x' }, headers: { 'retry-after': v } }), {}, 4);
      for (const v of ['99999999', '1e999', 'Infinity', '86400', '999999999999999999999']) {
        const r = await ra(v);
        ok('429 with Retry-After ' + v + ': no wait over a day, and the loop is NOT firing again at once (' + r.polls + ' polls for 4 waits)', r.waits.every(x => x >= 60 && x <= 86400) && r.polls <= 6, r.waits.join());
      }
      const rb = await ra('Wed, 21 Oct 2026 07:28:00 GMT'), rc = await ra('-5'), rd = await ra('');
      ok('a Retry-After that is a date, negative or empty is ignored (the ordinary backoff: 60, 120, ...)', [rb, rc, rd].every(r => r.waits.join() === '60,120,240,480'), [rb, rc, rd].map(r => r.waits.join()).join(' | '));
      for (const v of [1e10, 1e300, Infinity, -Infinity, NaN, 'abc', -1, 0, null, undefined, '3600', 86401, 7200]) {
        const r = await waitsFor2(Array(6).fill({ status: 200, body: { job: null, nextPollSeconds: v } }), {}, 3);
        const want = typeof v === 'number' && Number.isFinite(v) && v >= 5 ? Math.min(v, 86400) : v === '3600' ? 3600 : 3600;
        ok('nextPollSeconds ' + String(v) + ': every wait is ' + want + ' (a day at most; a number that is not one, or none, is the hour)', r.waits.every(x => x === want) && r.polls <= 4, r.waits.join());
      }
      const { createWorker } = W;
      const ww = newWorker(S, token, st).w;
      ok('failureWait is safe with anything: no NaN, nothing over a day, a count of 2000 does not overflow', [[NaN, NaN], [undefined, undefined], [0, 0], [-3, -1], [2000, 3600], [5, 1e12], [Infinity, Infinity]].every(([count, idle]) => { const x = ww.failureWait('http', 502, 0, count, idle), y = ww.failureWait('net', 429, 1e12, count, idle); return Number.isFinite(x) && x >= 30 && x <= 86400 && Number.isFinite(y) && y <= 86400; }));
      const seen = [];
      const realSet = global.setTimeout;
      global.setTimeout = (f, ms, ...r) => { seen.push(ms); return realSet(f, 0, ...r); };
      try { for (const v of [1e12, Infinity, NaN, -5, 0, 5000]) await ww.ctl.sleep(v); } finally { global.setTimeout = realSet; }
      ok('and the sleep itself is the last line of defence: 1e12, Infinity, NaN and -5 ms are a day, an hour, an hour and an hour (scaled 1/1000 here), never NaN or Infinity', seen.length === 6 && seen.every(x => Number.isFinite(x)) && seen[0] === 86400 && seen[1] === 3600 && seen[2] === 3600 && seen[3] === 3600 && seen[4] === 0 && seen[5] === 5, JSON.stringify(seen));
    }

    heading('an answer that never ends is cut, not read');
    {
      /* a server that answers and then never stops sending: the worker reads what it needs (a few KB, or 8 MB at the most) and drops the connection */
      const make = (status, type, headers) => {
        const st2 = { sent: 0, closed: false, hits: 0 };
        const srv = L.http.createServer((q, r) => {
          st2.hits++;
          r.on('close', () => { st2.closed = true; });
          r.writeHead(status, Object.assign({ 'Content-Type': type }, headers || {}));
          const chunk = Buffer.alloc(64 * 1024, 'x');
          const pump = () => { if (r.destroyed || r.writableEnded) return; st2.sent += chunk.length; r.write(chunk, () => setImmediate(pump)); };
          pump();
        });
        return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ srv: srv, port: srv.address().port, st: st2, close: () => new Promise(r2 => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(r2); }) })));
      };
      const dl = async (status, type, headers, over) => {
        const m = await make(status, type, headers);
        const t0 = Date.now();
        let err = null;
        try { await W.downloadTo('http://127.0.0.1:' + m.port + '/a', path.join(S.dir, 'dl.bin'), Object.assign({ maxMB: 1 }, over)); } catch (x) { err = x; }
        await sleep(200);
        const r = { err: err, ms: Date.now() - t0, sent: m.st.sent, closed: m.st.closed };
        await m.close();
        return r;
      };
      const html = await dl(200, 'text/html', {}), json = await dl(200, 'application/json', {}), s503 = await dl(503, 'text/plain', {}), s404 = await dl(404, 'audio/wav', {}), red = await dl(302, 'text/plain', { Location: '/elsewhere' });
      ok('a page instead of audio (200 text/html), a JSON answer, a 503 and a 404, all with an endless body: each fails at once with a sentence, the connection is DROPPED (closed on the server), and well under 4 MB was sent', [html, json, s503, s404].every(r => r.err && r.closed && r.sent < 4 * 1048576 && r.ms < 4000) && /page, not audio/.test(html.err.message) && /HTTP 503/.test(s503.err.message), JSON.stringify([html, json, s503, s404].map(r => [r.err && r.err.message.slice(0, 30), r.closed, r.sent])));
      const big = await dl(200, 'audio/wav', { 'Content-Length': String(3 * 1048576 * 1024) });
      const chunked = await dl(200, 'audio/wav', {});
      ok('audio announced as 3 GB is refused before it is read; audio with no length that goes on past the cap is cut at the cap (1 MB here): "larger than 1 MB", closed, nothing more than a few MB sent', [big, chunked].every(r => r.err && /larger than 1 MB/.test(r.err.message) && r.closed && r.sent < 8 * 1048576), JSON.stringify([big, chunked].map(r => [r.err && r.err.message.slice(0, 40), r.closed, r.sent])));
      /* the site's own answers: the claim, the heartbeat... are cut at 8 MB */
      const m = await make(200, 'application/json');
      const cfgE = { siteUrl: 'http://127.0.0.1:' + m.port, token: token };
      const t1 = Date.now();
      let errE = null; try { await W.request(cfgE, 'POST', '/api/worker/claim', { json: {}, timeoutMs: 30000 }); } catch (x) { errE = x; }
      await sleep(200);
      ok('an answer of the site that never ends is cut at 8 MB (not read for 60 s): a NetError "larger than 8 MB", the connection dropped', errE && /larger than 8 MB/.test(errE.message) && m.st.closed && m.st.sent < 64 * 1048576 && Date.now() - t1 < 20000, errE && errE.message + ' sent ' + m.st.sent + ' ms ' + (Date.now() - t1));
      await m.close();
    }

    heading('the 8 MB cut is for the site\'s JSON answers only: a recording longer than that is downloaded whole (its own cap is 120 MB)');
    {
      const MB = 1048576;
      /* a server with a body of exactly `bytes` (finite), announced by its length or not; `kind` is the content type; the body starts like a wav, or like JSON */
      const serveBytes = (bytes, announced, kind) => new Promise(res => {
        const srv = L.http.createServer((q, r) => {
          const json = kind === 'application/json';
          r.writeHead(200, Object.assign({ 'Content-Type': kind }, announced ? { 'Content-Length': String(bytes) } : {}));
          const head = json ? Buffer.from('{"pad":"') : Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
          const tail = json ? Buffer.from('"}') : Buffer.alloc(0);
          let sent = 0;
          const chunk = Buffer.alloc(256 * 1024, json ? 0x61 : 1);
          const pump = () => {
            if (r.destroyed) return;
            if (sent === 0) { sent = head.length; return r.write(head, pump); }
            const left = bytes - tail.length - sent;
            if (left <= 0) { sent += tail.length; return r.end(tail); }
            const n = Math.min(chunk.length, left); sent += n; r.write(chunk.subarray(0, n), pump);
          };
          pump();
        });
        srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, close: () => new Promise(r2 => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(r2); }) }));
      });
      const target = path.join(S.dir, 'big.bin');
      for (const announced of [true, false]) {
        const m = await serveBytes(12 * MB, announced, 'audio/wav');
        let got = null, err = null;
        try { got = await W.downloadTo('http://127.0.0.1:' + m.port + '/a', target, {}); } catch (x) { err = x; }
        await m.close();
        ok('a 12 MB recording (' + (announced ? 'its length announced' : 'streamed with no length') + ') is downloaded in full with the default cap: no "larger than" error, all 12 MB on disk', !err && got && got.bytes === 12 * MB && fs.statSync(target).size === 12 * MB, err ? err.message : JSON.stringify(got));
        try { fs.unlinkSync(target); } catch (x) { /* gone */ }
      }
      {
        const m = await serveBytes(12 * MB, true, 'audio/wav');
        let err = null; try { await W.downloadTo('http://127.0.0.1:' + m.port + '/a', target, { maxMB: 10 }); } catch (x) { err = x; }
        await m.close();
        ok('...and the cap that does apply to audio is its own: with 10 MB set, the same 12 MB is refused with "larger than 10 MB"', err && /larger than 10 MB/.test(err.message), err && err.message);
        try { fs.unlinkSync(target); } catch (x) { /* gone */ }
      }
      /* the site's answers: 7 MB of JSON is read, 9 MB is cut at 8 */
      const cfgJ = port => ({ siteUrl: 'http://127.0.0.1:' + port, token: token });
      const m7 = await serveBytes(7 * MB, true, 'application/json');
      let r7 = null, e7 = null; try { r7 = await W.request(cfgJ(m7.port), 'POST', '/api/worker/claim', { json: {}, timeoutMs: 30000 }); } catch (x) { e7 = x; }
      await m7.close();
      ok('an answer of the site of 7 MB is read (under the 8 MB cut)', !e7 && r7 && r7.status === 200 && r7.text.length === 7 * MB && r7.body && r7.body.pad.length > 6 * MB, e7 ? e7.message : r7 && r7.text.length);
      const m9 = await serveBytes(9 * MB, true, 'application/json');
      let r9 = null, e9 = null; try { r9 = await W.request(cfgJ(m9.port), 'POST', '/api/worker/claim', { json: {}, timeoutMs: 30000 }); } catch (x) { e9 = x; }
      await m9.close();
      ok('an answer of the site of 9 MB (not endless, just long) is cut at 8 MB: a NetError "larger than 8 MB", nothing returned', !r9 && e9 && /larger than 8 MB/.test(e9.message), e9 ? e9.message : 'read ' + (r9 && r9.text.length));
    }

    heading('a redirect is followed only to the same origin - compared as parsed, not as text');
    {
      const hits = { a: [], b: [] };
      const B = L.http.createServer((q, r) => { hits.b.push(q.url); r.writeHead(200, { 'Content-Type': 'audio/wav' }); r.end('RIFFxxxxWAVE'); });
      await new Promise(r => B.listen(0, '127.0.0.1', r));
      const bp = B.address().port;
      let loc = null;
      const A = L.http.createServer((q, r) => { hits.a.push(q.url); if (q.url === '/start') { r.writeHead(302, { Location: loc }); r.end(); } else { r.writeHead(200, { 'Content-Type': 'audio/wav' }); r.end('RIFFxxxxWAVE'); } });
      await new Promise(r => A.listen(0, '127.0.0.1', r));
      const ap = A.address().port;
      const tryTo = async location => { loc = location; hits.a.length = 0; hits.b.length = 0; try { await W.downloadTo('http://127.0.0.1:' + ap + '/start', path.join(S.dir, 'rd.bin'), {}); return null; } catch (x) { return x; } };
      const cases = [
        ['userinfo that looks like the site, then another host and port', 'http://127.0.0.1:' + ap + '@127.0.0.1:' + bp + '/steal'],
        ['the site\'s name as the start of another host (a port followed by more)', 'http://127.0.0.1:' + ap + '.evil.example/x'],
        ['the same address by another name (localhost)', 'http://localhost:' + ap + '/x'],
        ['the same host, another port', 'http://127.0.0.1:' + bp + '/steal'],
        ['the same host and port with userinfo of someone else', 'http://user:pw@127.0.0.1:' + bp + '/steal']
      ];
      for (const [name, location] of cases) {
        const err = await tryTo(location);
        ok('redirect to ' + name + ': refused, and neither the other server nor a second request to the site was made', !!err && /another address|cannot be used/.test(err.message) && hits.b.length === 0 && hits.a.length === 1, (err && err.message) + ' a=' + hits.a.join() + ' b=' + hits.b.join());
      }
      const okErr = await tryTo('http://127.0.0.1:' + ap + '/fine');
      ok('and the same origin spelled out in full is followed', okErr === null && hits.a.join() === '/start,/fine', (okErr && okErr.message) + ' ' + hits.a.join());
      await new Promise(r => A.close(r)); await new Promise(r => B.close(r));
    }

    heading('the network and the token');
    const jr = await queue(S, 'u1', 'retryresult');
    let posts = 0;
    const real = W.request;
    const flaky = (cfg, m, p, o) => { if (/\/result$/.test(p) && posts++ === 0) return Promise.resolve({ status: 503, body: { error: 'x' }, text: '', headers: {} }); return real(cfg, m, p, o); };
    const xr = newWorker(S, token, st, {}, { request: flaky });
    ok('a result the site answers 503 to is sent again, and then taken', (await xr.w.runOnce()) === 0 && jobOf(S, jr.id).status === 'done' && posts === 2, jobOf(S, jr.id).status + ' ' + posts);
    const bad = newWorker(S, 'ppw_' + 'Z'.repeat(12) + '_' + 'y'.repeat(43), st);
    ok('a token the site rejects: --once exits 2 and says what to do', (await bad.w.runOnce()) === 2 && /does not accept this token/.test(bad.cap.out.join('\n')));
    const loopBad = newWorker(S, 'ppw_' + 'Z'.repeat(12) + '_' + 'y'.repeat(43), st);
    ok('the loop stops on it too (exit 2), instead of trying for ever', (await loopBad.w.runForever()) === 2);
    const rev = await mkToken(S, 'u2');
    await S.as('u2').post('/api/pc-links/me/worker-token', {});
    ok('a token that was replaced by a new one (rotated) is the same: --once exits 2', (await newWorker(S, rev, st).w.runOnce()) === 2);
    await S.makeLink('gone');
    const rev2 = S.token('gone');
    await S.as('gone').del('/api/pc-links/me');
    ok('and so is the token of a link that was removed', (await newWorker(S, rev2, st).w.runOnce()) === 2);
    const dead = L.http.createServer(() => {}); await new Promise(r => dead.listen(0, '127.0.0.1', r)); const deadPort = dead.address().port; await new Promise(r => dead.close(r));
    const down = newWorker(S, token, st, { siteUrl: 'http://127.0.0.1:' + deadPort, audioBase: 'http://127.0.0.1:' + deadPort });
    ok('--once with the site unreachable: tries 3 times, says so, exits 1 (not 0, not a crash)', (await down.w.runOnce()) === 1 && /Could not reach the site/.test(down.cap.out.join('\n')) && (down.cap.out.join('\n').match(/Trying again/g) || []).length === 2, down.cap.out.join('\n').slice(0, 400));
    {
      /* --once and a site that asks for a wait of 99999999 seconds: what the person reads (and what the timer gets) is a day at most, not 27777 hours */
      const slept = [];
      const hostileWait = newWorker(S, token, st, {}, { request: () => Promise.resolve({ status: 503, body: { error: 'busy' }, text: '', headers: { 'retry-after': '99999999' } }) });
      hostileWait.w.ctl.sleep = ms => { slept.push(ms / 1000); return Promise.resolve(); };
      const code = await hostileWait.w.runOnce();
      const said = hostileWait.cap.out.join('\n');
      ok('--once, the site answers 503 with Retry-After 99999999: it tries twice more, waits a day at most and SAYS a day at most (24 h), exit 1', code === 1 && slept.length === 2 && slept.every(x => x === 86400) && /Trying again in 24 h\./.test(said) && !/\d{3,} h/.test(said), slept.join() + ' | ' + said.slice(0, 300));
    }

    heading('the site is trusted with the queue, not with what this PC runs');
    {
      const links = ['file:///etc/passwd', 'https://evil.example/x.mp3', 'https://www.youtube.com.evil.example/watch?v=abcdefghijk', 'http://www.youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk&list=x',
        'https://www.youtube.com/watch?v=abcdefghijk\nHost: evil', 'https://evil.example/https://www.youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijkl', 'https://www.youtube.com/watch?v=abcde',
        'https://youtu.be/abcdefghijk', ' https://www.youtube.com/watch?v=abcdefghijk', '--exec=calc https://www.youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk#x', 'https://user@www.youtube.com/watch?v=abcdefghijk',
        'https://www.youtube.com/watch?v=abcdefghi$(id)', 'https://www.youtube.com/watch?v=\u202eabcdefghij', 'https://www.youtube.com/watch?v=', 'javascript:alert(1)', '', null];
      const seen = []; const ran = [];
      let at = 0;
      const evil = (cfg, m, p, o) => {
        seen.push(m + ' ' + p.replace(/[A-Za-z0-9_-]{12,}/, ':id'));
        if (/claim$/.test(p)) return Promise.resolve({ status: 200, body: at < links.length ? { job: { id: 'abcdefgh' + String(1000 + at++), url: links[at - 1], title: 'x', attempt: 1 }, nextPollSeconds: 15 } : { job: null, nextPollSeconds: 15 }, text: '', headers: {} });
        return Promise.resolve({ status: 200, body: { ok: true }, text: '', headers: {} });
      };
      const xe = newWorker(S, token, st, { ytdlpPath: 'yt-dlp-stub' }, { request: evil, runTool: (c, a2, o) => { ran.push(c); return tools(st)(c, a2, o); }, download: () => { ran.push('download'); return Promise.reject(new Error('no')); } });
      const rc = await xe.w.runOnce();
      ok(links.length + ' hostile or malformed links from the site (another host, a look-alike host, http, extra query, a newline, a nested URL, 5 or 12 characters of id, an option, credentials, a command substitution, a bidi character, nothing): none is downloaded, none reaches yt-dlp or ffmpeg; each is failed for good', ran.length === 0 && seen.filter(x => /\/fail$/.test(x)).length === links.length && !seen.some(x => /heartbeat/.test(x)) && rc === 1, JSON.stringify({ ran: ran, fails: seen.filter(x => /fail$/.test(x)).length, of: links.length, rc: rc }));
      /* and the one good link goes through to the download and to yt-dlp, with -- before it (an id that begins with - is not an option) */
      const calls = [];
      let once = 0;
      const good = (cfg, m, p, o) => /claim$/.test(p) ? Promise.resolve({ status: 200, body: once++ === 0 ? { job: { id: 'abcdefgh2000', url: 'https://www.youtube.com/watch?v=-abcdefghij', title: 'x', attempt: 1 }, nextPollSeconds: 15 } : { job: null, nextPollSeconds: 15 }, text: '', headers: {} }) : Promise.resolve({ status: 200, body: { ok: true }, text: '', headers: {} });
      const xg = newWorker(S, token, st, { ytdlpPath: 'yt-dlp-stub' }, { request: good, runTool: (c, a2, o) => { calls.push([c, a2]); return c === 'yt-dlp-stub' ? Promise.resolve({ code: 1, tail: 'blocked' }) : tools(st)(c, a2, o); }, download: () => Promise.reject(Object.assign(new Error('no'), { retry: false })) });
      await xg.w.runOnce();
      const yd = calls.find(c => c[0] === 'yt-dlp-stub');
      ok('a canonical link (even an id that begins with -) is handed to yt-dlp after "--", as its last argument, and the site\'s download is the fallback', !!yd && yd[1][yd[1].length - 2] === '--' && yd[1][yd[1].length - 1] === 'https://www.youtube.com/watch?v=-abcdefghij' && yd[1].indexOf('--') === yd[1].length - 2, JSON.stringify(yd && yd[1].slice(-4)));
    }

    heading('the loop: patient, and it never dies of the network');
    {
      /* what the loop waits (in seconds, as it asks to sleep) after a script of answers; then it is stopped */
      const waitsFor = async (script, over, nWaits) => {
        let i = 0;
        const request = () => { const a2 = script[Math.min(i++, script.length - 1)]; return a2 instanceof Error ? Promise.reject(a2) : Promise.resolve(Object.assign({ text: '', headers: {} }, a2)); };
        const x = newWorker(S, token, st, over || {}, { request: request, jitter: () => 0 });
        const waits = [];
        const orig = x.w.ctl.sleep;
        x.w.ctl.sleep = ms => { waits.push(ms / 1000); if (waits.length >= nWaits) x.w.ctl.stop = true; return orig(0); };
        const code = await x.w.runForever();
        return { waits: waits, code: code, text: x.cap.out.join('\n') };
      };
      const r502 = Array(9).fill({ status: 502, body: null });
      const w502 = await waitsFor(r502, {}, 8);
      ok('a 502 again and again: 60, 120, 240, 480, 960, 1920, then an hour (the idle wait) - never a fixed loop', w502.waits.join() === '60,120,240,480,960,1920,3600,3600', w502.waits.join());
      const w503 = await waitsFor(Array(9).fill({ status: 503, body: { error: 'x', code: 'store' } }), {}, 8);
      ok('a 503 from the queue\'s store the same', w503.waits.join() === '60,120,240,480,960,1920,3600,3600', w503.waits.join());
      const wnet = await waitsFor(Array(10).fill(new Error('ECONNREFUSED')), {}, 9);
      ok('a network that is down: 30, 60, 120 ... 1920, then an hour', wnet.waits.join() === '30,60,120,240,480,960,1920,3600,3600', wnet.waits.join());
      for (const code of [404, 405, 410]) {
        const w4 = await waitsFor(Array(5).fill({ status: code, body: null }), {}, 4);
        ok('a site that answers ' + code + ' (the queue is gone: a revert) is asked once an hour at most, from the first answer on', w4.waits.every(x => x === 3600) && /does not have the conversion queue/.test(w4.text), w4.waits.join());
      }
      const w404long = await waitsFor(Array(5).fill({ status: 404, body: null }), { idlePollSeconds: 7200 }, 3);
      ok('...or as long as the idle wait the person set, when that is longer', w404long.waits.every(x => x === 7200), w404long.waits.join());
      const w429 = await waitsFor(Array(8).fill({ status: 429, body: { error: 'slow' }, headers: { 'retry-after': '600' } }), {}, 6);
      ok('a 429 with Retry-After 600: never sooner than that, and it grows like the rest', w429.waits.every(x => x >= 600) && w429.waits[5] > w429.waits[0] && w429.waits.every((x, i, a2) => !i || x >= a2[i - 1]), w429.waits.join());
      const wreset = await waitsFor([{ status: 502, body: null }, { status: 502, body: null }, { status: 200, body: { job: null, nextPollSeconds: 3600 } }, { status: 502, body: null }, { status: 502, body: null }], {}, 4);
      ok('an answer that works starts the count again (60, 120, then the site\'s hour, then 60 again)', wreset.waits.join() === '60,120,3600,60', wreset.waits.join());
      const wcap = await waitsFor([{ status: 200, body: { job: null, nextPollSeconds: 7200 } }].concat(Array(9).fill({ status: 502, body: null })), {}, 9);
      ok('the growth stops at the idle wait the site last told (7200 here)', wcap.waits[0] === 7200 && wcap.waits.slice(1).join() === '60,120,240,480,960,1920,3840,7200', wcap.waits.join());
      const wpeak = await waitsFor(r502, {}, 40);
      ok('forty failures in a row: the waits only ever grow, and the last ten are all an hour', wpeak.waits.every((x, i, a2) => !i || x >= a2[i - 1]) && wpeak.waits.slice(-10).every(x => x === 3600), wpeak.waits.slice(-12).join());
      ok('the log says what happened, in a sentence', /The site answered 502\. Trying again in 60 s\./.test(w502.text), w502.text.slice(0, 200));
    }
    {
      const lp = newWorker(S, token, st, {}, {});
      const seenPolls = [];
      let calls = 0;
      const scripted = (cfg, m, p, o) => {
        calls++;
        if (calls === 1) return Promise.reject(new Error('ECONNREFUSED'));
        if (calls === 2) return Promise.resolve({ status: 502, body: null, text: 'bad gateway', headers: {} });
        if (calls === 3) return Promise.resolve({ status: 429, body: { error: 'slow down' }, text: '', headers: { 'retry-after': '1' } });
        seenPolls.push(o.json);
        if (calls === 4) return Promise.resolve({ status: 200, body: { job: null, nextPollSeconds: 1200 }, text: '', headers: {} });
        lw.w.ctl.stop = true; if (lw.w.ctl.wake) lw.w.ctl.wake();
        return Promise.resolve({ status: 200, body: { job: null, nextPollSeconds: 15 }, text: '', headers: {} });
      };
      const lw = newWorker(S, token, st, { idlePollSeconds: 3000 }, { request: scripted });
      const stopLater = setTimeout(() => { lw.w.ctl.stop = true; if (lw.w.ctl.wake) lw.w.ctl.wake(); }, 3000);
      const lrc = await lw.w.runForever();
      clearTimeout(stopLater);
      const text = lw.cap.out.join('\n');
      ok('a refused connection, a 502 and a 429 are each waited out with a sentence, and the loop goes on', lrc === 0 && /Could not reach the site/.test(text) && /answered 502/.test(text) && /answered 429/.test(text), text.slice(0, 700));
      ok('an idle answer (1200) with the setting 3000 is waited as 3000 and said so', /Next check in 50 min/.test(text), text.slice(-300));
      ok('the poll tells the site how long it will wait when idle (so "is the PC alive" is right)', seenPolls.length >= 1 && seenPolls[0].waitSeconds === 3000 && seenPolls[0].once === false, JSON.stringify(seenPolls));
    }

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
