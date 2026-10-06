#!/usr/bin/env node
/* PPP home-PC worker (G10b-1, docs/GOALS/G10B_HOME_WORKER.md).

   Runs on YOUR PC. The site queues a YouTube link you asked to convert with the strong piano models (TransKun + Kong, on your GPU);
   this script asks the site for work, does it here, and sends the notes back. The site never connects to this PC: this script
   only makes ordinary HTTPS requests OUT, with a token you made on the site (Settings > Connect my PC).

     node tools/home-worker/worker.js              keep checking (every ~20 minutes when idle, every ~15 s while something is going on)
     node tools/home-worker/worker.js --once       check once, do everything that is waiting, exit (the desktop-shortcut mode)
     node tools/home-worker/worker.js --check      test the settings and the token, change nothing
     node tools/home-worker/worker.js --config <file>

   One job: claim -> download the audio (the site's /api/youtube-audio, as the page does) -> ffmpeg to a 44.1 kHz stereo WAV and a
   16 kHz mono WAV -> transcribe.py (the same call omr-service.js makes) -> the helper's ACCEPTED notes as { on, off, midi, vel }
   (the same conversion as review/h10/helper-heard.js: no pedal, no beats) -> POST them. Every step has a timeout; a failure is
   reported to the site in one short line; the scratch folder is always removed. The loop never ends on a network error, and
   stops (exit 2) when the site says the token is not valid, so a revoked token is not tried for ever.

   How long it waits is the SITE's answer (nextPollSeconds): idle waits are long on purpose, because every request wakes the
   free web service for 15 minutes. A setting here can only make the idle wait LONGER. Settings: worker.config.json (see
   worker.config.example.json), or the file named by --config / PPP_WORKER_CONFIG; PPP_WORKER_TOKEN overrides the token. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');

const REPO = path.resolve(__dirname, '..', '..');
const VERSION = '1.0';
const Result = require(path.join(REPO, 'home-result.js'));
const { convertHelperNotes } = require(path.join(REPO, 'review', 'h10', 'helper-heard.js'));

const sleepPlain = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');
const clock = d => { d = d || new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
const humanWait = s => (s >= 3600 ? Math.round(s / 360) / 10 + ' h' : s >= 90 ? Math.round(s / 60) + ' min' : s + ' s');

/* ---------------- settings ---------------- */
const DEFAULTS = {
  siteUrl: '',
  token: '',
  pythonPath: '',
  transcribePy: path.join(REPO, 'transcribe.py'),
  kongCheckpoint: '',
  ariaCheckpoint: '',
  ffmpegPath: 'ffmpeg',
  ytdlpPath: '',
  audioBase: '',
  scratchDir: path.join(os.tmpdir(), 'ppp-home-worker'),
  idlePollSeconds: 0,
  activePollSeconds: 0,
  maxSeconds: Result.LIMITS.MAX_SECONDS,
  maxAudioMB: 120,
  allowInsecure: false,
  keepScratch: false
};

function firstExisting(list) {
  for (const c of list.filter(Boolean)) { try { if (fs.existsSync(c)) return c; } catch (e) { /* next */ } }
  return '';
}

function findKongCheckpoint(dir) {
  try {
    return fs.readdirSync(dir).filter(f => /\.pth$/i.test(f)).map(f => path.join(dir, f))
      .find(f => { try { return fs.statSync(f).size > 1.6e8; } catch (e) { return false; } }) || '';
  } catch (e) { return ''; }
}

/* the settings file (JSON), the environment, and what can be found next to transcribe.py */
function loadConfig(file, env) {
  env = env || process.env;
  let raw = {};
  const where = file || env.PPP_WORKER_CONFIG || firstExisting([path.join(__dirname, 'worker.config.json')]);
  if (where) {
    try { raw = JSON.parse(fs.readFileSync(where, 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { throw new Error('The settings file ' + where + ' could not be read as JSON: ' + e.message); }
  } else if (!env.PPP_WORKER_TOKEN) {
    throw new Error('There is no settings file. Copy worker.config.example.json to worker.config.json (next to worker.js) and fill it in.');
  }
  const cfg = Object.assign({}, DEFAULTS, raw);
  if (env.PPP_WORKER_TOKEN) cfg.token = env.PPP_WORKER_TOKEN.trim();
  if (env.PPP_WORKER_SITE) cfg.siteUrl = env.PPP_WORKER_SITE.trim();
  cfg.siteUrl = String(cfg.siteUrl || '').trim().replace(/\/+$/, '');
  cfg.token = String(cfg.token || '').trim();
  cfg.audioBase = String(cfg.audioBase || cfg.siteUrl || '').trim().replace(/\/+$/, '');
  cfg._file = where || '';
  if (!cfg.pythonPath) {
    cfg.pythonPath = firstExisting([env.PPP_TRANSCRIBE_PYTHON, path.join(REPO, 'tools', 'transcribe-venv', 'Scripts', 'python.exe'), path.join(REPO, 'tools', 'transcribe-venv', 'bin', 'python')]);
  }
  if (!cfg.kongCheckpoint) cfg.kongCheckpoint = env.PPP_TRANSCRIBE_CHECKPOINT || findKongCheckpoint(path.join(path.dirname(cfg.transcribePy), 'tools', 'piano-transcription')) || findKongCheckpoint(path.join(REPO, 'tools', 'piano-transcription'));
  cfg.maxSeconds = Math.max(30, Math.min(Result.LIMITS.MAX_SECONDS, +cfg.maxSeconds || Result.LIMITS.MAX_SECONDS));
  cfg.idlePollSeconds = Math.max(0, Math.min(86400, +cfg.idlePollSeconds || 0));
  cfg.activePollSeconds = cfg.activePollSeconds ? Math.max(5, Math.min(600, +cfg.activePollSeconds)) : 0;
  return cfg;
}

/* what is wrong with the settings, as sentences (empty list: usable) */
function configProblems(cfg) {
  const out = [];
  if (!cfg.siteUrl) out.push('siteUrl is empty (the address of the PPP site, e.g. https://ppp-web-2o99.onrender.com).');
  else {
    let u = null;
    try { u = new URL(cfg.siteUrl); } catch (e) { out.push('siteUrl is not an address: ' + cfg.siteUrl); }
    if (u && !/^https?:$/.test(u.protocol)) out.push('siteUrl must start with https://');
    if (u && u.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) && !cfg.allowInsecure) out.push('siteUrl is http://, which would send the token in the clear. Use https:// (or set allowInsecure for a test on your own network).');
  }
  if (!/^ppw_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(cfg.token)) out.push('token is missing or is not a PPP worker token (it starts with ppw_; make one on the site: Settings > Connect my PC).');
  if (!cfg.pythonPath || !fs.existsSync(cfg.pythonPath)) out.push('pythonPath does not exist: ' + (cfg.pythonPath || '(empty)') + ' (the Python of the transcription environment, e.g. D:/PPP/tools/transcribe-venv/Scripts/python.exe).');
  if (!cfg.transcribePy || !fs.existsSync(cfg.transcribePy)) out.push('transcribePy does not exist: ' + cfg.transcribePy);
  return out;
}

/* ---------------- logging that never shows the token ---------------- */
function makeLog(cfg, out, err) {
  out = out || (s => process.stdout.write(s + '\n'));
  err = err || (s => process.stderr.write(s + '\n'));
  const redact = s => {
    let t = String(s);
    if (cfg && cfg.token) t = t.split(cfg.token).join('ppw_***');
    return t.replace(/ppw_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}/g, 'ppw_***').replace(/Bearer\s+[^\s]+/gi, 'Bearer ***');
  };
  const log = m => out('[' + clock() + '] ' + redact(m));
  log.warn = m => err('[' + clock() + '] ' + redact(m));
  log.redact = redact;
  return log;
}

/* ---------------- the site ---------------- */
class NetError extends Error {}

function request(cfg, method, p, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(cfg.siteUrl + p); } catch (e) { return reject(new NetError('bad address')); }
    const lib = u.protocol === 'http:' ? http : https;
    const body = o.json == null ? null : Buffer.from(JSON.stringify(o.json));
    const headers = { 'Authorization': 'Bearer ' + cfg.token, 'Accept': 'application/json', 'User-Agent': 'ppp-home-worker/' + VERSION };
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = body.length; }
    const req = lib.request({ protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: method, headers: headers, agent: false }, res => {
      const chunks = [];
      let n = 0;
      res.on('data', c => { n += c.length; if (n < 8 * 1024 * 1024) chunks.push(c); });
      res.on('end', () => {
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch (e) { json = null; }
        resolve({ status: res.statusCode, body: json, text: text, headers: res.headers });
      });
      res.on('error', e => { clearTimeout(timer); reject(new NetError(e.code || e.message)); });
    });
    /* the whole exchange, long-poll included, must finish: a request a proxy forgot is cut and tried again */
    const timer = setTimeout(() => req.destroy(new NetError('timeout')), o.timeoutMs || 60000);
    req.on('error', e => { clearTimeout(timer); reject(e instanceof NetError ? e : new NetError(e.code || e.message)); });
    req.end(body);
  });
}

/* a request that is tried again, with a growing wait, while the network or the site is down (5xx, 429) */
async function withRetry(label, tries, fn, ctl, log) {
  let wait = 5;
  for (let i = 1; ; i++) {
    let r = null, err = null;
    try { r = await fn(); } catch (e) { err = e; }
    if (r && r.status < 500 && r.status !== 429) return r;
    if (i >= tries || (ctl && ctl.stopNow)) {
      if (r) return r;
      throw err;
    }
    const why = r ? 'the site answered ' + r.status : (err && err.message) || 'no connection';
    const retryAfter = r && r.headers && +r.headers['retry-after'];
    const w = Math.max(wait, retryAfter || 0);
    log(label + ': ' + why + '. Trying again in ' + humanWait(w) + '.');
    await ctl.sleep(w * 1000);
    wait = Math.min(wait * 3, 300);
  }
}

/* ---------------- running the tools ---------------- */
function runTool(cmd, args, o) {
  o = o || {};
  return new Promise(resolve => {
    let tail = '';
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, cwd: o.cwd, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }) });
    } catch (e) { return resolve({ code: -1, tail: String(e.message), spawnError: true }); }
    if (o.onChild) o.onChild(child);
    let killedBy = null;
    const timer = setTimeout(() => { killedBy = 'timeout'; killTree(child); }, o.timeoutMs || 600000);
    const onText = chunk => {
      const s = chunk.toString('utf8');
      tail = (tail + s).slice(-6000);
      if (o.onLine) s.split(/\r?\n|\r/).forEach(l => { if (l.trim()) o.onLine(l.trim()); });
    };
    child.stdout.on('data', onText);
    child.stderr.on('data', onText);
    child.on('error', e => { clearTimeout(timer); resolve({ code: -1, tail: String(e.message), spawnError: true }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (o.onChild) o.onChild(null);
      resolve({ code: code == null ? -1 : code, signal: signal, tail: tail, timedOut: killedBy === 'timeout' });
    });
  });
}

/* a Windows child (python) has children of its own (transkun): kill the tree, by the PID of the process this script started */
function killTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    else child.kill('SIGKILL');
  } catch (e) { /* gone */ }
}

function looksLikeAudioFile(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(12);
    const n = fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    if (n >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') return true;
    if (n >= 3 && buf.toString('ascii', 0, 3) === 'ID3') return true;
    if (n >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true;
    if (n >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return true;
    if (n >= 4 && buf.toString('ascii', 0, 4) === 'OggS') return true;
    if (n >= 4 && buf.toString('ascii', 0, 4) === 'RIFF') return true;
    return false;
  } catch (e) { return false; }
}

/* GET a URL into a file: the audio, as the page asks the site for it. Errors say which kind (retry: true when trying again can help). */
function downloadTo(url, dest, o) {
  o = o || {};
  const maxBytes = (o.maxMB || 120) * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const hop = (target, hops) => {
      let u;
      try { u = new URL(target); } catch (e) { return reject(Object.assign(new Error('The audio address is not usable.'), { retry: false })); }
      const lib = u.protocol === 'http:' ? http : https;
      const req = lib.get({ protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, agent: false,
        headers: { 'User-Agent': 'ppp-home-worker/' + VERSION, 'Accept': 'audio/*,*/*' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (hops >= 4) return reject(Object.assign(new Error('Too many redirects fetching the audio.'), { retry: true }));
          return hop(new URL(res.headers.location, target).href, hops + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          const bad422 = res.statusCode === 422;
          return reject(Object.assign(new Error(bad422 ? 'The site says that is not a YouTube video.' : 'The site could not get the audio (HTTP ' + res.statusCode + ').'), { retry: !bad422 }));
        }
        const type = String(res.headers['content-type'] || '').toLowerCase();
        if (type.indexOf('text/html') >= 0 || type.indexOf('application/json') >= 0) {
          res.resume();
          return reject(Object.assign(new Error('The site answered with a page, not audio.'), { retry: true }));
        }
        const file = fs.createWriteStream(dest);
        let n = 0, over = false;
        res.on('data', c => { n += c.length; if (n > maxBytes && !over) { over = true; req.destroy(); file.destroy(); reject(Object.assign(new Error('The audio is larger than ' + (o.maxMB || 120) + ' MB.'), { retry: false })); } });
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          if (over) return;
          if (!looksLikeAudioFile(dest)) return reject(Object.assign(new Error('What came back is not an audio file.'), { retry: true }));
          resolve({ bytes: n });
        }));
        file.on('error', e => reject(Object.assign(new Error('Could not write the audio: ' + e.message), { retry: false })));
        res.on('error', e => reject(Object.assign(new Error('The audio download broke off.'), { retry: true })));
      });
      req.setTimeout(o.idleMs || 180000, () => req.destroy(Object.assign(new Error('The audio download stalled.'), { retry: true })));
      req.on('error', e => reject(Object.assign(e.retry === undefined ? new Error('Could not reach the site for the audio (' + (e.code || e.message) + ').') : e, { retry: true })));
    };
    hop(url, 0);
  });
}

/* ---------------- one job ---------------- */
const YT_RE = /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{6,}$/;
class JobError extends Error {
  constructor(message, retry) { super(message); this.retry = !!retry; }
}
class Cancelled extends Error {}

function createWorker(cfg, deps) {
  deps = deps || {};
  const log = deps.log || makeLog(cfg);
  const run = deps.runTool || runTool;
  const callSite = deps.request || request;
  const download = deps.download || downloadTo;
  const ctl = {
    stop: false, stopNow: false, cancelled: false, child: null, wake: null,
    sleep(ms) {
      return new Promise(resolve => {
        const t = setTimeout(done, ms * (deps.waitScale == null ? 1 : deps.waitScale));   /* waitScale: tests only */
        function done() { clearTimeout(t); ctl.wake = null; resolve(); }
        ctl.wake = done;
      });
    }
  };
  const scratchRoot = cfg.scratchDir;
  const stats = { done: 0, failed: 0, checks: 0 };

  /* tell the site where the job is; the answer says whether the person cancelled it meanwhile */
  async function beat(job, stage, pct) {
    try {
      const r = await callSite(cfg, 'POST', '/api/worker/jobs/' + job.id + '/heartbeat', { json: { stage: stage, pct: pct }, timeoutMs: 20000 });
      if ((r.status === 200 && r.body && r.body.cancelled) || r.status === 404) { ctl.cancelled = true; killTree(ctl.child); }
    } catch (e) { /* the next beat, or the result, tells the site */ }
  }
  const check = () => { if (ctl.cancelled) throw new Cancelled('cancelled'); };

  /* audio: the site's endpoint (what the page uses), or yt-dlp on this PC when the settings name it (and the site as the fallback) */
  async function getAudio(job, dir) {
    const dest = path.join(dir, 'source.audio');
    const tries = 3;
    let last = null;
    if (cfg.ytdlpPath) {
      log('Downloading the audio with yt-dlp on this PC...');
      const r = await run(cfg.ytdlpPath, ['--no-playlist', '--no-progress', '--no-warnings', '-f', 'bestaudio[ext=m4a]/bestaudio/best', '--max-filesize', cfg.maxAudioMB + 'M', '--match-filter', '!is_live',
        '-o', path.join(dir, 'source.%(ext)s'), '--', job.url], { cwd: dir, timeoutMs: 10 * 60 * 1000, onChild: c => { ctl.child = c; } });
      const f = (() => { try { return fs.readdirSync(dir).filter(x => /^source\./.test(x) && !/\.part$/.test(x) && x !== 'source.audio').map(x => path.join(dir, x))[0]; } catch (e) { return null; } })();
      if (r.code === 0 && f && looksLikeAudioFile(f)) return { file: f, bytes: fs.statSync(f).size, how: 'yt-dlp' };
      log('yt-dlp did not work here; asking the site for the audio instead.');
    }
    const url = cfg.audioBase + '/api/youtube-audio?url=' + encodeURIComponent(job.url);
    for (let i = 1; i <= tries; i++) {
      check();
      try {
        log('Downloading the audio' + (i > 1 ? ' (try ' + i + ')' : '') + '...');
        const got = await download(url, dest, { maxMB: cfg.maxAudioMB });
        return { file: dest, bytes: got.bytes, how: 'site' };
      } catch (e) {
        last = e;
        if (e.retry === false || i >= tries) break;
        log('That did not work (' + e.message + '). Trying again in ' + 10 * i + ' s.');
        await ctl.sleep(10000 * i);
      }
    }
    throw new JobError('The audio could not be downloaded: ' + (last && last.message || 'unknown'), !last || last.retry !== false);
  }

  async function decode(input, dir) {
    const master = path.join(dir, 'audio-master.wav'), kong = path.join(dir, 'audio-kong-16k.wav');
    const r1 = await run(cfg.ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '44100', '-t', String(cfg.maxSeconds), '-c:a', 'pcm_s16le', '-f', 'wav', master],
      { cwd: dir, timeoutMs: 5 * 60 * 1000, onChild: c => { ctl.child = c; } });
    check();
    let bytes = 0; try { bytes = fs.statSync(master).size; } catch (e) { /* none */ }
    if (r1.spawnError) throw new JobError('ffmpeg could not be started on this PC (ffmpegPath: ' + cfg.ffmpegPath + ').', false);
    if (r1.code !== 0 || bytes < 16000) {
      const noAudio = /does not contain any stream|Output file #0 does not contain|matches no streams/i.test(r1.tail || '');
      throw new JobError(noAudio ? 'That video has no audio track.' : 'The audio could not be decoded.', false);
    }
    const r2 = await run(cfg.ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-i', master, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', kong],
      { cwd: dir, timeoutMs: 5 * 60 * 1000, onChild: c => { ctl.child = c; } });
    check();
    let kb = 0; try { kb = fs.statSync(kong).size; } catch (e) { /* none */ }
    if (r2.code !== 0 || kb < 16000) throw new JobError('The audio could not be prepared for the piano model.', false);
    const seconds = Math.max(0, (bytes - 44) / (44100 * 2 * 2));
    return { master: master, kong: kong, seconds: seconds };
  }

  async function transcribe(job, dir, wavs, onPct) {
    const out = path.join(dir, 'notes.json');
    const argv = [cfg.transcribePy, '--wav', wavs.master, '--kong-wav', wavs.kong, '--out', out, '--engine', 'auto'];
    if (cfg.kongCheckpoint) argv.push('--checkpoint', cfg.kongCheckpoint);
    if (cfg.ariaCheckpoint) argv.push('--aria-checkpoint', cfg.ariaCheckpoint);
    let engines = '';
    const r = await run(cfg.pythonPath, argv, {
      cwd: dir, timeoutMs: Math.max(10 * 60 * 1000, wavs.seconds * 8000), onChild: c => { ctl.child = c; },
      onLine: line => {
        const m = /^PROGRESS\s+([\d.]+)/.exec(line);
        if (m) onPct(Math.min(1, +m[1]));
        const e = /^ENGINE\s+(\S+)/.exec(line);
        if (e) { engines += (engines ? ' + ' : '') + e[1]; log('Listening with ' + e[1] + '...'); }
      }
    });
    check();
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { raw = null; }
    if (r.code !== 0 || !raw) {
      log.warn('transcribe.py failed (exit ' + r.code + (r.timedOut ? ', timed out' : '') + '):\n' + String(r.tail || '').slice(-1200));
      throw new JobError(r.timedOut ? 'The piano models took too long on this PC.' : 'The piano models failed on this PC' + (r.spawnError ? ' (Python could not be started).' : '.'), !r.spawnError);
    }
    return raw;
  }

  /* the helper's notes -> what the site accepts (the accepted notes only, no pedal, no beats), cut to the 15-minute limit */
  function toResult(raw) {
    let c;
    try { c = convertHelperNotes(raw); } catch (e) { throw new JobError(/at least/.test(e.message) ? 'No piano notes were heard in this recording.' : 'The piano models gave nothing usable.', false); }
    const h = c.heard, hh = h.helper || {};
    const cut = cfg.maxSeconds + 1;
    const notes = h.notes.filter(n => n.on < cut).map(n => (n.off > cut ? { on: n.on, off: cut, midi: n.midi, vel: n.vel } : n));
    const result = {
      notes: notes, duration: Math.min(h.duration, cut), engine: h.engine, model: hh.model || null, device: hh.device || null,
      ensemble: { models: hh.models || [], primary: hh.primary || null, agreement: hh.agreement, accepted: notes.length, uncertain: hh.uncertain || 0 }
    };
    const v = Result.validateResult(result);
    if (!v.ok) throw new JobError('The notes did not pass the site\'s checks: ' + v.error, false);
    return { result: result, report: c.report, bytes: v.bytes };
  }

  async function postResult(job, result) {
    const r = await withRetry('Sending the notes', 4, () => callSite(cfg, 'POST', '/api/worker/jobs/' + job.id + '/result', { json: result, timeoutMs: 120000 }), ctl, log);
    if (r.status === 200) return 'ok';
    if (r.status === 409) return r.body && r.body.code === 'cancelled' ? 'cancelled' : 'gone';
    if (r.status === 401) throw Object.assign(new Error('token'), { fatalToken: true });
    throw new JobError('The site did not take the notes (' + r.status + (r.body && r.body.error ? ': ' + r.body.error : '') + ').', false);
  }

  async function postFail(job, message, retry) {
    try {
      const r = await withRetry('Reporting the failure', 3, () => callSite(cfg, 'POST', '/api/worker/jobs/' + job.id + '/fail', { json: { error: message, retry: !!retry }, timeoutMs: 30000 }), ctl, log);
      return r.status === 200;
    } catch (e) { return false; }
  }

  /* one claimed job, start to finish. Never throws except for a rejected token (fatalToken). */
  async function processJob(job) {
    const t0 = Date.now();
    /* the site is trusted with the queue, not with what this PC runs: only a YouTube watch link is ever handed to the download or to yt-dlp */
    if (!job || typeof job.id !== 'string' || !YT_RE.test(String(job.url || ''))) {
      log.warn('The site sent a job whose link is not a YouTube video; it is not run.');
      stats.failed++;
      if (job && typeof job.id === 'string') await postFail(job, 'The link is not a YouTube video.', false);
      return false;
    }
    const label = job.title ? '"' + job.title + '"' : job.url;
    log('A conversion is waiting: ' + label + (job.attempt > 1 ? ' (attempt ' + job.attempt + ' of ' + (job.maxAttempts || 3) + ')' : ''));
    fs.mkdirSync(scratchRoot, { recursive: true });
    const dir = fs.mkdtempSync(path.join(scratchRoot, 'job-'));
    ctl.cancelled = false;
    let stage = 'download', pct = 0;
    const hbTimer = setInterval(() => { beat(job, stage, pct); }, deps.heartbeatMs || 60000);
    if (hbTimer.unref) hbTimer.unref();
    try {
      await beat(job, 'download', 0);
      check();
      const audio = await getAudio(job, dir);
      log('Audio ready: ' + (audio.bytes / 1048576).toFixed(1) + ' MB (' + audio.how + '). Decoding...');
      stage = 'decode'; pct = 0; await beat(job, stage, 0);
      const wavs = await decode(audio.file, dir);
      log('Decoded ' + Math.round(wavs.seconds) + ' s of audio. Starting the piano models' + (cfg.kongCheckpoint ? '' : ' (no Kong checkpoint found: TransKun alone)') + '.');
      stage = 'transcribe'; pct = 0;
      let lastShown = -1;
      const raw = await transcribe(job, dir, wavs, p => {
        pct = p;
        const s = Math.floor(p * 10) * 10;
        if (s > lastShown) { lastShown = s; log('  listening: ' + Math.round(p * 100) + '%'); }
      });
      const r = toResult(raw);
      log('Heard ' + r.result.notes.length + ' notes (' + r.result.ensemble.uncertain + ' more were kept apart: the models did not agree), ' + Math.round(r.result.duration) + ' s of music, ' + Math.round((Date.now() - t0) / 1000) + ' s here. Sending them to the site...');
      stage = 'upload'; pct = 1;
      check();
      const sent = await postResult(job, r.result);
      if (sent === 'ok') { stats.done++; log('Done: the notes are on the site (' + (r.bytes / 1024).toFixed(0) + ' KB). Open PPP to see the score.'); }
      else log('The site no longer wanted these notes (' + (sent === 'cancelled' ? 'you cancelled it' : 'it was already finished') + ').');
      return true;
    } catch (e) {
      if (e && e.fatalToken) throw e;
      if (e instanceof Cancelled || ctl.cancelled) { log('That conversion was cancelled on the site. Stopped.'); return false; }
      const jobErr = e instanceof JobError ? e : new JobError('Something unexpected went wrong on this PC.', true);
      if (!(e instanceof JobError)) log.warn('Unexpected: ' + (e && e.stack || e));
      stats.failed++;
      log('This conversion failed: ' + jobErr.message + (jobErr.retry ? ' (the site will try again)' : ''));
      await postFail(job, jobErr.message, jobErr.retry);
      return false;
    } finally {
      clearInterval(hbTimer);
      ctl.child = null;
      if (!cfg.keepScratch) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the temp folder is cleaned by the OS in the end */ } }
    }
  }

  /* one poll: { job, nextPollSeconds } or { error } */
  async function poll(once) {
    const r = await callSite(cfg, 'POST', '/api/worker/claim', { json: { once: !!once, waitSeconds: cfg.idlePollSeconds || 0 }, timeoutMs: 60000 });
    stats.checks++;
    if (r.status === 401) throw Object.assign(new Error('token'), { fatalToken: true });
    if (r.status === 200 && r.body) return { job: r.body.job || null, next: +r.body.nextPollSeconds || 0 };
    return { failed: true, status: r.status, retryAfter: +(r.headers && r.headers['retry-after']) || 0, message: r.body && r.body.error };
  }
  /* --once: a poll that is tried again (3 times, growing waits) when the network or the site is down */
  async function pollRetry(once) {
    let wait = 5, err = null;
    for (let i = 1; ; i++) {
      let retryAfter = 0;
      try {
        const p = await poll(once);
        if (!p.failed) return p;
        err = new NetError('the site answered ' + p.status + (p.message ? ' (' + p.message + ')' : ''));
        retryAfter = p.retryAfter;
      } catch (e) { if (e.fatalToken) throw e; err = e; }
      if (i >= 3 || ctl.stop) throw err;
      const w = Math.max(wait, retryAfter);
      log('Checking the site: ' + err.message + '. Trying again in ' + humanWait(w) + '.');
      await ctl.sleep(w * 1000);
      wait *= 3;
    }
  }
  /* how long to wait: the site's word, lengthened (never shortened) by the settings */
  function waitFor(next) {
    let w = next > 0 ? next : (cfg.idlePollSeconds || 1200);
    if (w >= 300) { if (cfg.idlePollSeconds > w) w = cfg.idlePollSeconds; }
    else if (cfg.activePollSeconds) w = Math.max(cfg.activePollSeconds, 5);
    return Math.max(5, w);
  }

  const tokenRejected = () => log('The site does not accept this token (it was removed on the site, or is mistyped). Stopping. Make a new one: Settings > Connect my PC.');

  /* --once: check, do everything waiting, leave. Returns the exit code. */
  async function runOnce() {
    log('PPP home worker ' + VERSION + ': one check of ' + cfg.siteUrl);
    let jobs = 0;
    for (;;) {
      let p;
      try { p = await pollRetry(true); } catch (e) {
        if (e.fatalToken) { tokenRejected(); return 2; }
        log('Could not reach the site: ' + e.message + '. Nothing was done. Try again later.');
        return 1;
      }
      if (p.job) {
        jobs++;
        try { await processJob(p.job); } catch (e) { if (e.fatalToken) { tokenRejected(); return 2; } }
        if (ctl.stop) break;
        continue;
      }
      break;
    }
    log(jobs ? 'All waiting conversions are handled (' + stats.done + ' done, ' + stats.failed + ' failed).' : 'Nothing is waiting.');
    return stats.failed && !stats.done ? 1 : 0;
  }
  /* the loop: poll, work, wait as told. Resolves when stopped; returns the exit code. */
  async function runForever() {
    log('PPP home worker ' + VERSION + ' is watching ' + cfg.siteUrl + '. Ctrl-C stops it' + (cfg.idlePollSeconds ? '; idle checks are at least ' + humanWait(cfg.idlePollSeconds) + ' apart.' : '.'));
    let backoff = 0;
    while (!ctl.stop) {
      let p;
      try { p = await poll(false); backoff = 0; }
      catch (e) {
        if (e.fatalToken) { tokenRejected(); return 2; }
        backoff = Math.min(backoff ? backoff * 2 : 30, 900);
        const w = backoff + Math.floor(Math.random() * 10);
        log('Could not reach the site (' + e.message + '). Trying again in ' + humanWait(w) + '.');
        await ctl.sleep(w * 1000);
        continue;
      }
      if (p.failed) {
        const w = Math.max(p.retryAfter || 0, p.status >= 500 ? 60 : 30);
        log('The site answered ' + p.status + (p.message ? ' (' + p.message + ')' : '') + '. Trying again in ' + humanWait(w) + '.');
        await ctl.sleep(w * 1000);
        continue;
      }
      if (p.job) {
        try { await processJob(p.job); } catch (e) { if (e.fatalToken) { tokenRejected(); return 2; } }
        continue;
      }
      const w = waitFor(p.next);
      log('Nothing is waiting. Next check in ' + humanWait(w) + ' (' + clock(new Date(Date.now() + w * 1000)) + ').');
      await ctl.sleep(w * 1000);
    }
    log('Stopped.');
    return 0;
  }

  return { runOnce: runOnce, runForever: runForever, processJob: processJob, poll: poll, waitFor: waitFor, toResult: toResult, ctl: ctl, stats: stats, getAudio: getAudio, decode: decode, transcribe: transcribe, log: log };
}

/* --check: say what is set up and what is not, without claiming a job */
async function checkSetup(cfg, log, deps) {
  deps = deps || {};
  let bad = 0;
  const say = (ok, line) => { log((ok ? 'ok    ' : 'FIX   ') + line); if (!ok) bad++; };
  log('Settings file: ' + (cfg._file || '(none: environment only)'));
  const problems = configProblems(cfg);
  problems.forEach(p => say(false, p));
  if (!problems.length) say(true, 'site ' + cfg.siteUrl + ', token ' + cfg.token.slice(0, 8) + '..., python ' + cfg.pythonPath + ', ' + cfg.transcribePy);
  const f = await (deps.runTool || runTool)(cfg.ffmpegPath, ['-version'], { timeoutMs: 15000 });
  say(f.code === 0, f.code === 0 ? 'ffmpeg runs (' + cfg.ffmpegPath + ')' : 'ffmpeg does not run (ffmpegPath: ' + cfg.ffmpegPath + '). Install it, or put its full path in the settings.');
  say(!!cfg.kongCheckpoint, cfg.kongCheckpoint ? 'Kong checkpoint ' + cfg.kongCheckpoint : 'no Kong checkpoint found (tools/piano-transcription/*.pth): TransKun would run alone. Set kongCheckpoint.');
  if (cfg.pythonPath && fs.existsSync(cfg.pythonPath)) {
    const py = await (deps.runTool || runTool)(cfg.pythonPath, ['-c', 'import torch, soundfile, transkun; print("cuda" if torch.cuda.is_available() else "cpu")'], { timeoutMs: 60000 });
    say(py.code === 0, py.code === 0 ? 'Python has torch, soundfile and transkun; it will run on the ' + String(py.tail).trim().split(/\s+/).pop().toUpperCase() : 'Python cannot import torch, soundfile and transkun: ' + String(py.tail).trim().split('\n').pop());
  }
  if (!problems.some(p => /^(siteUrl|token)/.test(p))) {
    try {
      const r = await (deps.request || request)(cfg, 'GET', '/api/worker/ping', { timeoutMs: 60000 });
      if (r.status === 200) say(true, 'the site accepts the token; its idle wait is ' + humanWait(r.body && r.body.nextPollSeconds || 0));
      else if (r.status === 401) say(false, 'the site does not accept this token (removed, or mistyped).');
      else say(false, 'the site answered ' + r.status + '.');
    } catch (e) { say(false, 'the site could not be reached: ' + e.message); }
  }
  log(bad ? bad + ' thing(s) to fix.' : 'Everything is ready. Run: node tools/home-worker/worker.js --once');
  return bad ? 1 : 0;
}

async function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*/, '').trim());
    return 0;
  }
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  let cfg;
  try { cfg = loadConfig(opt('--config')); } catch (e) { console.error(e.message); return 1; }
  const log = makeLog(cfg);
  if (args.includes('--check')) return checkSetup(cfg, log);
  const problems = configProblems(cfg);
  if (problems.length) { problems.forEach(p => log.warn('Settings: ' + p)); log.warn('Run with --check for more.'); return 1; }
  const w = createWorker(cfg);
  let signals = 0;
  const onSignal = sig => {
    signals++;
    if (signals === 1) {
      w.ctl.stop = true;
      log('Stopping (' + sig + '). ' + (w.ctl.child ? 'Finishing the conversion in progress; press Ctrl-C again to quit now.' : ''));
      if (w.ctl.wake) w.ctl.wake();
      if (!w.ctl.child) setTimeout(() => process.exit(0), 200).unref();
    } else {
      w.ctl.stopNow = true;
      killTree(w.ctl.child);
      log('Quitting now. The site will give the conversion to a later check.');
      setTimeout(() => process.exit(130), 500).unref();
    }
  };
  process.on('SIGINT', () => onSignal('Ctrl-C'));
  process.on('SIGTERM', () => onSignal('terminate'));
  process.on('unhandledRejection', e => log.warn('Unexpected: ' + (e && e.stack || e)));
  return args.includes('--once') ? w.runOnce() : w.runForever();
}

module.exports = { loadConfig, configProblems, createWorker, checkSetup, makeLog, request, downloadTo, runTool, looksLikeAudioFile, DEFAULTS, VERSION };

if (require.main === module) {
  main(process.argv).then(code => process.exit(code), e => { console.error('The worker stopped: ' + (e && e.message || e)); process.exit(1); });
}
