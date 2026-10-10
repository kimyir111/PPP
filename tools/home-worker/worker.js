#!/usr/bin/env node
/* PPP home-PC worker (G10b-1, docs/GOALS/G10B_HOME_WORKER.md).

   Runs on YOUR PC. The site queues a YouTube link you asked to convert with the strong piano models (TransKun + Kong, on your GPU);
   this script asks the site for work, does it here, and sends the notes back. The site never connects to this PC: this script
   only makes ordinary HTTPS requests OUT, with the token of your PC link (made on the site, no account needed: Settings > Connect my PC > Create my PC link).

     node tools/home-worker/worker.js              keep checking (about once an hour when idle, every ~15 s while something is going on)
     node tools/home-worker/worker.js --once       check once, do everything that is waiting, exit (the desktop-shortcut mode)
     node tools/home-worker/worker.js --check      test the settings and the token, change nothing
     node tools/home-worker/worker.js --pair       (G10b-3) make the pairing link of this PC's link, copy the phone link to the clipboard and open the PC's own link (with &local=1) in the browser; --show also prints the phone link
     node tools/home-worker/worker.js --register-protocol     (G10b-4) Windows, this user only (HKCU, no admin): let the PPP page start --once at once from this PC's browser (the pppworker:// link; it takes no argument)
     node tools/home-worker/worker.js --unregister-protocol   take that registration away again;  --protocol-status says whether it is there and where it points
     node tools/home-worker/worker.js --log-file [file]       also append every line (the token is hidden as ever) to a file; by itself: worker.log next to the settings file (used by run-once-hidden.cmd)
     node tools/home-worker/worker.js --config <file>

   One job: claim -> download the audio (the site's /api/youtube-audio, as the page does) -> ffmpeg to a 44.1 kHz stereo WAV and a
   16 kHz mono WAV -> transcribe.py (the same call omr-service.js makes) -> the helper's ACCEPTED notes as { on, off, midi, vel }
   (the same conversion as review/h10/helper-heard.js: no pedal) and, G10a-1d, beat_track.py's beats and downbeats -> POST them. Every step has a timeout; a failure is
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
let lastLog = null;      /* the log of this run (main sets it), so that even the last words of a crash reach the log file */
const Result = require(path.join(REPO, 'home-result.js'));
const { convertHelperNotes } = require(path.join(REPO, 'review', 'h10', 'helper-heard.js'));

const sleepPlain = ms => new Promise(r => setTimeout(r, ms));
/* A wait is at most a day: setTimeout fires AT ONCE for anything over about 24.8 days (and for Infinity), so a Retry-After of 99999999 or a nextPollSeconds of 1e10
   would have made the loop poll as fast as it could. A value that is not a number, is negative or is missing is the default. */
const DAY_S = 86400;
const secs = (v, dflt) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) && n >= 0 ? Math.min(n, DAY_S) : dflt; };
const pad = n => String(n).padStart(2, '0');
const clock = d => { d = d || new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
const humanWait = s => (s >= 3600 ? Math.round(s / 360) / 10 + ' h' : s >= 90 ? Math.round(s / 60) + ' min' : s + ' s');

/* a PC link's client code (64 hex) from what a person pastes: the code itself, or the pairing link https://site/#pc=<code>[&anything] (G10b-4: what follows an & is not part of the code, as in the page);
   spaces, dashes and capitals are forgiven (the page's PcLink.normalize does the same). '' when it is not one. */
const CODE_RE = /^[0-9a-f]{64}$/;
function codeFrom(text) {
  let t = String(text == null ? '' : text);
  const i = t.indexOf('#pc=');
  if (i >= 0) { t = t.slice(i + 4); const a = t.indexOf('&'); if (a >= 0) t = t.slice(0, a); try { t = decodeURIComponent(t); } catch (e) { /* as it is */ } }
  t = t.replace(/[\s-]+/g, '').toLowerCase();
  return CODE_RE.test(t) ? t : '';
}
/* G10b-4: the NON-SECRET name of a PC link (the last 6 hex of its id 'pc_' + 22 hex of sha256('ppp-pc-link-v1:' + code)), the same 6 characters that the site gives as linkTag, that the page shows in its
   banner, its Settings card and under the Add button, and that --pair prints: the owner can tell their own link from somebody else's. No character of the code is in it. '' for what is not a code. */
function linkTagOf(code) {
  if (!CODE_RE.test(String(code))) return '';
  return crypto.createHash('sha256').update('ppp-pc-link-v1:' + code, 'utf8').digest('hex').slice(0, 22).slice(-6);
}

/* ---------------- settings ---------------- */
const DEFAULTS = {
  siteUrl: '',
  token: '',
  clientCode: '',
  pythonPath: '',
  transcribePy: path.join(REPO, 'transcribe.py'),
  kongCheckpoint: '',
  ariaCheckpoint: '',
  /* G10a-1d: beat_track.py (Beat This) beside transcribe.py, run after the piano models; its beats and downbeats go with the notes as evidence of
     the bar phase (the page's v2 conversion reads them so, never as bar lines). false turns it off; a PC without beat-this sends notes only */
  beats: true,
  beatTrackPy: '',
  /* G10d song mode: the folder that holds the source separation (demucs), when it is not installed in the Python itself (pip install --target <folder> demucs ...) */
  songLib: '',
  /* song mode, optional: YourMT3 (multi-instrument transcription) in its own Python. Found by itself in a tools folder (the one beside
     transcribe.py, this repository's, or the one that holds the song-lib or the transcription Python): tools/yourmt3 (the code and checkpoints,
     a clone of the Hugging Face space mimbres/YourMT3) and tools/yourmt3-venv (its Python). setup-yourmt3.cmd makes both */
  mt3Python: '',
  mt3Dir: '',
  /* song mode's melody from SheetSage2 (a lead-sheet transcriber), found the same way: tools/sheetsage2 (the model m-a-p/SheetSage2) and
     tools/sheetsage2-venv (its Python). setup-sheetsage2.cmd makes both; without them the melody comes from YourMT3's lines */
  ss2Python: '',
  ss2Dir: '',
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
  /* next to worker.js, or under the person's own profile (a folder nobody else, and no cloud sync of the project, can see) */
  const where = file || env.PPP_WORKER_CONFIG || firstExisting([path.join(__dirname, 'worker.config.json'), path.join(os.homedir(), '.ppp-home-worker', 'worker.config.json')]);
  if (where) {
    try { raw = JSON.parse(fs.readFileSync(where, 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { throw new Error('The settings file ' + where + ' could not be read as JSON: ' + e.message); }
  } else if (!env.PPP_WORKER_TOKEN) {
    throw new Error('There is no settings file. Copy worker.config.example.json to worker.config.json (next to worker.js, or in ' + path.join(os.homedir(), '.ppp-home-worker') + ') and fill it in; or set PPP_WORKER_TOKEN and PPP_WORKER_SITE.');
  }
  const cfg = Object.assign({}, DEFAULTS, raw);
  if (env.PPP_WORKER_TOKEN) cfg.token = env.PPP_WORKER_TOKEN.trim();
  if (env.PPP_WORKER_SITE) cfg.siteUrl = env.PPP_WORKER_SITE.trim();
  cfg.siteUrl = String(cfg.siteUrl || '').trim().replace(/\/+$/, '');
  cfg.token = String(cfg.token || '').trim();
  /* clientCode (optional, G10b-3): the PC link's client code, or the whole pairing link, for --pair; cleaned here, never used by the worker's loop and never logged */
  cfg._clientCodeGiven = !!String(cfg.clientCode || '').trim();
  cfg.clientCode = codeFrom(cfg.clientCode);
  cfg.audioBase = String(cfg.audioBase || cfg.siteUrl || '').trim().replace(/\/+$/, '');
  cfg._file = where || '';
  if (!cfg.pythonPath) {
    cfg.pythonPath = firstExisting([env.PPP_TRANSCRIBE_PYTHON, path.join(REPO, 'tools', 'transcribe-venv', 'Scripts', 'python.exe'), path.join(REPO, 'tools', 'transcribe-venv', 'bin', 'python')]);
  }
  if (!cfg.beatTrackPy) cfg.beatTrackPy = path.join(path.dirname(cfg.transcribePy), 'beat_track.py');
  cfg.beats = cfg.beats !== false;
  if (!cfg.songLib) cfg.songLib = firstExisting([path.join(path.dirname(cfg.transcribePy), 'tools', 'song-lib'), path.join(REPO, 'tools', 'song-lib')]);
  if (!cfg.mt3Dir || !cfg.mt3Python || !cfg.ss2Dir || !cfg.ss2Python) {
    const toolDirs = [path.join(path.dirname(cfg.transcribePy), 'tools'), path.join(REPO, 'tools')]
      .concat(cfg.songLib ? [path.dirname(cfg.songLib)] : [])
      .concat(cfg.pythonPath ? [path.dirname(path.dirname(path.dirname(cfg.pythonPath)))] : []);
    if (!cfg.mt3Dir) cfg.mt3Dir = firstExisting(toolDirs.map(d => path.join(d, 'yourmt3', 'model_helper.py'))).replace(/[\\/]model_helper\.py$/, '');
    if (!cfg.mt3Python) cfg.mt3Python = firstExisting([].concat(...toolDirs.map(d => [path.join(d, 'yourmt3-venv', 'Scripts', 'python.exe'), path.join(d, 'yourmt3-venv', 'bin', 'python')])));
    if (!cfg.ss2Dir) cfg.ss2Dir = firstExisting(toolDirs.map(d => path.join(d, 'sheetsage2', 'config.json'))).replace(/[\\/]config\.json$/, '');
    if (!cfg.ss2Python) cfg.ss2Python = firstExisting([].concat(...toolDirs.map(d => [path.join(d, 'sheetsage2-venv', 'Scripts', 'python.exe'), path.join(d, 'sheetsage2-venv', 'bin', 'python')])));
  }
  if (!cfg.kongCheckpoint) cfg.kongCheckpoint = env.PPP_TRANSCRIBE_CHECKPOINT || findKongCheckpoint(path.join(path.dirname(cfg.transcribePy), 'tools', 'piano-transcription')) || findKongCheckpoint(path.join(REPO, 'tools', 'piano-transcription'));
  cfg.maxSeconds = Math.max(30, Math.min(Result.LIMITS.MAX_SECONDS, +cfg.maxSeconds || Result.LIMITS.MAX_SECONDS));
  cfg.idlePollSeconds = Math.max(0, Math.min(86400, +cfg.idlePollSeconds || 0));
  cfg.activePollSeconds = cfg.activePollSeconds ? Math.max(5, Math.min(600, +cfg.activePollSeconds)) : 0;
  return cfg;
}

/* what is wrong with the site address, as sentences */
function siteProblems(cfg) {
  const out = [];
  if (!cfg.siteUrl) out.push('siteUrl is empty (the address of the PPP site, e.g. https://ppp-web-2o99.onrender.com).');
  else {
    let u = null;
    try { u = new URL(cfg.siteUrl); } catch (e) { out.push('siteUrl is not an address: ' + cfg.siteUrl); }
    if (u && !/^https?:$/.test(u.protocol)) out.push('siteUrl must start with https://');
    if (u && u.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) && !cfg.allowInsecure) out.push('siteUrl is http://, which would send the token in the clear. Use https:// (or set allowInsecure for a test on your own network).');
  }
  return out;
}

/* what is wrong with the settings, as sentences (empty list: usable) */
function configProblems(cfg) {
  const out = siteProblems(cfg);
  if (!/^ppw_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(cfg.token)) out.push('token is missing or is not a PPP worker token (it starts with ppw_; it is shown once when the PC link is made: Settings > Connect my PC > Create my PC link).');
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
    /* the PC link's client code is the master secret of the link (G10b-3): neither the code nor a pairing link made of it is ever shown by the log */
    if (cfg && cfg.clientCode) t = t.split(cfg.clientCode).join('***');
    return t.replace(/ppw_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}/g, 'ppw_***').replace(/Bearer\s+[^\s]+/gi, 'Bearer ***').replace(/#pc=[0-9a-fA-F]{64}/g, '#pc=***');
  };
  /* text that came from the site or from a video's title must not move the cursor, recolour or reorder the person's terminal: no ESC sequences (a whole one:
     CSI "ESC [ ... final", OSC "ESC ] ... BEL", and the two-character ones, ESC and one of @-Z \ ] ^ _), no other control characters (a newline and a tab
     stay), no zero-width, soft-hyphen or invisible-operator characters (U+200B-200F, U+2060-2064, U+00AD, U+FEFF), no bidi marks or overrides, no line or
     paragraph separators. They are REMOVED, not replaced, and this runs before the token is hidden: a token split by any of them is joined again, and then
     hidden. */
  const clean = s => String(s)
    .replace(/\u001b(?:\[[0-?]*[ -\/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '');
  /* Removing a whole escape sequence also removes the letter after the ESC, and that letter may be a character of the token (ESC G in the middle of it): the
     token is then not whole in the cleaned text and would show. So the text is looked at a second way too: with every control, format, lone-surrogate and
     combining character deleted ONE BY ONE (nothing after it goes), where a token that was cut by any of them is whole again. When that view holds a token, that
     view - token hidden, no control character in it - is what is shown; otherwise the cleaned one is. */
  const flat = s => String(s).replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Mn}\p{Me}\u2028\u2029]/gu, c => (c === '\n' || c === '\t' ? c : ''));
  const shown = m => {
    const raw = String(m), f = flat(raw), hidden = redact(f);
    return hidden !== f ? hidden : redact(clean(raw));
  };
  const log = m => out('[' + clock() + '] ' + shown(m));
  log.warn = m => err('[' + clock() + '] ' + shown(m));
  log.redact = redact;
  log.clean = clean;
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
      /* the answer of the site is a few KB; an endless one (a broken proxy, a hostile page) is cut at 8 MB and the connection dropped, not read for ever */
      res.on('data', c => { n += c.length; if (n > 8 * 1024 * 1024) { req.destroy(new NetError('the answer was larger than 8 MB')); return; } chunks.push(c); });
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
    const retryAfter = r && r.headers ? secs(r.headers['retry-after'], 0) : 0;
    const w = Math.max(wait, retryAfter);
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

/* GET a URL into a file: the audio, as the page asks the site for it. Errors say which kind (retry: true when trying again can help).
   Only a redirect to the SAME origin (the site's own address, https in production) is followed, at most 4 times: a site that sends the worker to
   another host, another scheme (ftp:, file:) or an address that is not one is refused with a sentence - and nothing sent here carries the token. */
function downloadTo(url, dest, o) {
  o = o || {};
  const maxBytes = (o.maxMB || 120) * 1024 * 1024;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (message, retry) => { if (settled) return; settled = true; reject(Object.assign(new Error(message), { retry: !!retry })); };
    const ok = v => { if (settled) return; settled = true; resolve(v); };
    let origin0;
    try { origin0 = new URL(url).origin; } catch (e) { return fail('The audio address is not usable.', false); }
    const hop = (target, hops) => {
      try {
        const u = new URL(target);
        if (u.origin !== origin0) return fail('The site sent the audio download to another address; it was not followed.', false);
        const lib = u.protocol === 'http:' ? http : https;
        const req = lib.get({ protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, agent: false,
          headers: { 'User-Agent': 'ppp-home-worker/' + VERSION, 'Accept': 'audio/*,*/*' } }, res => {
          /* an answer that is not the audio is not read: the connection is dropped (an endless body would otherwise be pulled in for as long as the site sends it) */
          const drop = () => { res.on('error', () => {}); req.destroy(); };
          try {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              drop();
              if (hops >= 4) return fail('Too many redirects fetching the audio.', true);
              let next;
              try { next = new URL(res.headers.location, target); } catch (e) { return fail('The site sent a redirect to an address that cannot be used.', false); }
              return hop(next.href, hops + 1);
            }
            if (res.statusCode !== 200) {
              drop();
              const bad422 = res.statusCode === 422;
              return fail(bad422 ? 'The site says that is not a YouTube video.' : 'The site could not get the audio (HTTP ' + res.statusCode + ').', !bad422);
            }
            const type = String(res.headers['content-type'] || '').toLowerCase();
            if (type.indexOf('text/html') >= 0 || type.indexOf('application/json') >= 0) {
              drop();
              return fail('The site answered with a page, not audio.', true);
            }
            const tooBig = () => fail('The audio is larger than ' + (o.maxMB || 120) + ' MB.', false);
            if (+res.headers['content-length'] > maxBytes) { drop(); return tooBig(); }
            const file = fs.createWriteStream(dest);
            let n = 0, over = false;
            res.on('data', c => { n += c.length; if (n > maxBytes && !over) { over = true; req.destroy(); file.destroy(); tooBig(); } });
            res.pipe(file);
            file.on('finish', () => file.close(() => {
              if (over) return;
              if (!looksLikeAudioFile(dest)) return fail('What came back is not an audio file.', true);
              ok({ bytes: n });
            }));
            file.on('error', e => fail('Could not write the audio: ' + e.message, false));
            res.on('error', e => fail('The audio download broke off.', true));
          } catch (e) { fail('The audio download could not be read (' + (e && e.code || e && e.message || 'error') + ').', false); }
        });
        req.setTimeout(o.idleMs || 180000, () => req.destroy(Object.assign(new Error('The audio download stalled.'), { retry: true })));
        req.on('error', e => fail(e && e.retry !== undefined ? e.message : 'Could not reach the site for the audio (' + (e && (e.code || e.message)) + ').', true));
      } catch (e) { fail('The audio could not be fetched (' + (e && e.code || e && e.message || 'error') + ').', false); }
    };
    hop(url, 0);
  });
}

/* ---------------- one job ---------------- */
const YT_RE = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/;
/* G10d: a job of kind 'youtube-song' is a song that is not a piano recording (home-jobs.js JOB_KINDS); every other kind, and none, is a piano recording */
const isSong = job => !!job && job.kind === 'youtube-song';
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
        ms = Number.isFinite(ms) && ms >= 0 ? Math.min(ms, DAY_S * 1000) : 3600 * 1000;   /* the last line of defence: never longer than a day, never NaN */
        const t = setTimeout(done, ms * (deps.waitScale == null ? 1 : deps.waitScale));   /* waitScale: tests only */
        function done() { clearTimeout(t); ctl.wake = null; resolve(); }
        ctl.wake = done;
      });
    }
  };
  const scratchRoot = cfg.scratchDir;
  const stats = { done: 0, failed: 0, checks: 0 };

  /* a crash or a power cut leaves a job-XXXXXX folder (audio, WAVs) behind: at the start, those older than 2 hours go (a newer one may belong to another
     run of this script that is working right now) */
  function sweepScratch(maxAgeMs) {
    let n = 0;
    try {
      fs.readdirSync(scratchRoot).forEach(name => {
        if (!/^job-[A-Za-z0-9]{6}$/.test(name)) return;
        const p = path.join(scratchRoot, name);
        try {
          const st = fs.statSync(p);
          if (st.isDirectory() && Date.now() - st.mtimeMs > (maxAgeMs == null ? 2 * 3600 * 1000 : maxAgeMs)) { fs.rmSync(p, { recursive: true, force: true }); n++; }
        } catch (e) { /* in use, or gone */ }
      });
    } catch (e) { /* no scratch folder yet */ }
    if (n) log('Removed ' + n + ' old scratch folder' + (n === 1 ? '' : 's') + ' left by an earlier run.');
    return n;
  }

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
    const r1 = await run(cfg.ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-i', input, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '44100', '-t', String(cfg.maxSeconds), '-c:a', 'pcm_s16le', '-f', 'wav', master],
      { cwd: dir, timeoutMs: 5 * 60 * 1000, onChild: c => { ctl.child = c; } });
    check();
    let bytes = 0; try { bytes = fs.statSync(master).size; } catch (e) { /* none */ }
    if (r1.spawnError) throw new JobError('ffmpeg could not be started on this PC (ffmpegPath: ' + cfg.ffmpegPath + ').', false);
    if (r1.code !== 0 || bytes < 16000) {
      const noAudio = /does not contain any stream|Output file #0 does not contain|matches no streams/i.test(r1.tail || '');
      throw new JobError(noAudio ? 'That video has no audio track.' : 'The audio could not be decoded.', false);
    }
    const r2 = await run(cfg.ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-i', master, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', kong],
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
    if (isSong(job)) {
      argv.push('--mode', 'song');
      if (cfg.songLib) argv.push('--song-lib', cfg.songLib);
      if (cfg.mt3Python && cfg.mt3Dir) argv.push('--mt3-python', cfg.mt3Python, '--mt3-dir', cfg.mt3Dir);
      if (cfg.ss2Python && cfg.ss2Dir) argv.push('--ss2-python', cfg.ss2Python, '--ss2-dir', cfg.ss2Dir);
    }
    let engines = '';
    const r = await run(cfg.pythonPath, argv, {
      cwd: dir, timeoutMs: Math.max(10 * 60 * 1000, wavs.seconds * 8000), onChild: c => { ctl.child = c; },
      onLine: line => {
        const m = /^PROGRESS\s+([\d.]+)/.exec(line);
        if (m) onPct(Math.min(1, +m[1]));
        const e = /^ENGINE\s+(\S+)/.exec(line);
        if (e) { engines += (engines ? ' + ' : '') + e[1]; log('Listening with ' + e[1] + '...'); }
        /* transcribe.py's NOTE lines say why an optional engine (YourMT3, Basic Pitch) gave way to the next one: without them a fallback is silent */
        if (/^NOTE\s/.test(line)) log(line.slice(0, 600));
      }
    });
    check();
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { raw = null; }
    if (r.code !== 0 || !raw) {
      log.warn('transcribe.py failed (exit ' + r.code + (r.timedOut ? ', timed out' : '') + '):\n' + String(r.tail || '').slice(-1200));
      /* song mode on a PC without the separation: trying again cannot help, and the person has to know what to install */
      if (/SONG_SEPARATION_MISSING/.test(String(r.tail || ''))) throw new JobError('Song mode needs the source separation (demucs) on this PC; see tools/home-worker/README.md, "Song mode".', false);
      if (/SONG_NO_NOTES/.test(String(r.tail || ''))) throw new JobError('No melody, bass or accompaniment was heard in this recording.', false);
      if (r.timedOut && isSong(job)) throw new JobError('Song mode took too long on this PC.', false);   /* the same song takes as long the next time */
      throw new JobError(r.timedOut ? 'The piano models took too long on this PC.' : 'The piano models failed on this PC' + (r.spawnError ? ' (Python could not be started).' : '.'), !r.spawnError);
    }
    return raw;
  }

  /* G10a-1d: Beat This's beats and downbeats (beat_track.py, on the CPU: a few seconds a song), or null. Never fails the job: a PC without beat-this, a
     crash or a timeout sends the notes alone, as before */
  async function beatTrack(dir, wavs) {
    if (!cfg.beats || !cfg.beatTrackPy || !fs.existsSync(cfg.beatTrackPy)) return null;
    const out = path.join(dir, 'beats.json');
    const r = await run(cfg.pythonPath, [cfg.beatTrackPy, '--wav', wavs.master, '--out', out], { cwd: dir, timeoutMs: Math.max(3 * 60 * 1000, wavs.seconds * 2000), onChild: c => { ctl.child = c; } });
    check();
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { raw = null; }
    if (r.code !== 0 || !raw || !Array.isArray(raw.beats)) { log('The beat tracker did not run here (beat-this missing or failed): the notes go alone.'); return null; }
    return { beats: raw.beats, downbeats: Array.isArray(raw.downbeats) ? raw.downbeats : [] };
  }
  /* rising, finite, within the cut, at most MAX_BEATS: what the site accepts (home-result.js) */
  function beatList(xs, cut) {
    const outList = [];
    (xs || []).forEach(t => { if (typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= cut && (!outList.length || t > outList[outList.length - 1] + 1e-4)) outList.push(Math.round(t * 10000) / 10000); });
    return outList.slice(0, Result.LIMITS.MAX_BEATS);
  }

  /* the helper's notes -> what the site accepts (the accepted notes only, no pedal; G10a-1d: the beats and downbeats when beat_track.py ran), cut to the 15-minute limit */
  function toResult(raw, bt) {
    let c;
    try { c = convertHelperNotes(raw); } catch (e) { throw new JobError(/at least/.test(e.message) ? 'No piano notes were heard in this recording.' : 'The piano models gave nothing usable.', false); }
    const h = c.heard, hh = h.helper || {};
    const cut = cfg.maxSeconds + 1;
    const notes = h.notes.filter(n => n.on < cut).map(n => (n.off > cut ? Object.assign({}, n, { off: cut }) : n));
    const result = {
      notes: notes, duration: Math.min(h.duration, cut), engine: h.engine, model: hh.model || null, device: hh.device || null,
      ensemble: { models: hh.models || [], primary: hh.primary || null, agreement: hh.agreement, accepted: notes.length, uncertain: hh.uncertain || 0 }
    };
    if (bt) {
      const beats = beatList(bt.beats, result.duration + 1);
      if (beats.length >= 4) {
        result.beats = beats;
        const downs = beatList(bt.downbeats, result.duration + 1);
        if (downs.length) result.downbeats = downs;
      }
    }
    /* G10d song mode: the notes carry their layer (convertHelperNotes keeps it), and the result says so */
    if (h.song) {
      result.mode = 'song';
      result.song = { separation: h.song.separation || null, melodyFrom: h.song.melodyFrom || null, melodyTracker: h.song.melodyTracker || null };
      if (h.song.accompFrom) result.song.accompFrom = h.song.accompFrom;
      if (h.song.beatsFrom && result.beats) result.song.beatsFrom = h.song.beatsFrom;
      if (h.song.key) result.song.key = h.song.key;
    }
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
    const label = (job.title ? '"' + job.title + '"' : job.url) + (isSong(job) ? ' (song mode: separate, then melody, bass and accompaniment)' : '');
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
      log('Decoded ' + Math.round(wavs.seconds) + ' s of audio. ' + (isSong(job) ? 'Separating the song, then the models' : 'Starting the piano models') + (cfg.kongCheckpoint ? '' : ' (no Kong checkpoint found: TransKun alone)') + '.');
      stage = 'transcribe'; pct = 0;
      let lastShown = -1;
      const raw = await transcribe(job, dir, wavs, p => {
        pct = p;
        const s = Math.floor(p * 10) * 10;
        if (s > lastShown) { lastShown = s; log('  listening: ' + Math.round(p * 100) + '%'); }
      });
      stage = 'beats'; pct = 0;
      /* a song's lead sheet (SheetSage2) came with its beats and bar lines: those are the song's, Beat This is not run */
      const bt = raw && Array.isArray(raw.beats) && raw.beats.length >= 4 ? { beats: raw.beats, downbeats: Array.isArray(raw.downbeats) ? raw.downbeats : [] } : await beatTrack(dir, wavs);
      const r = toResult(raw, bt);
      const beatsNote = r.result.beats ? ' and ' + r.result.beats.length + ' beats' : '';
      if (r.result.mode === 'song') {
        const layer = k => r.result.notes.filter(n => n.track === Result.SONG_TRACKS[k]).length;
        log('Heard ' + r.result.notes.length + ' notes: melody ' + layer('melody') + ', bass ' + layer('bass') + ', accompaniment ' + layer('accomp') + ' (the drums are left out)' + beatsNote + ', ' + Math.round(r.result.duration) + ' s of music, ' + Math.round((Date.now() - t0) / 1000) + ' s here. Sending them to the site...');
      } else log('Heard ' + r.result.notes.length + ' notes (' + r.result.ensemble.uncertain + ' more were kept apart: the models did not agree)' + beatsNote + ', ' + Math.round(r.result.duration) + ' s of music, ' + Math.round((Date.now() - t0) / 1000) + ' s here. Sending them to the site...');
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
    /* song: this worker knows song mode (G10d), so the site may hand it song jobs (a PC without the separation fails them with what to install) */
    const r = await callSite(cfg, 'POST', '/api/worker/claim', { json: { once: !!once, waitSeconds: cfg.idlePollSeconds || 0, song: true }, timeoutMs: 60000 });
    stats.checks++;
    if (r.status === 401) throw Object.assign(new Error('token'), { fatalToken: true });
    if (r.status === 200 && r.body) return { job: r.body.job || null, next: secs(r.body.nextPollSeconds, 0) };
    return { failed: true, status: r.status, retryAfter: secs(r.headers && r.headers['retry-after'], 0), message: r.body && r.body.error };
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
    next = secs(next, 0);
    let w = next > 0 ? next : (cfg.idlePollSeconds || 3600);
    if (w >= 300) { if (cfg.idlePollSeconds > w) w = cfg.idlePollSeconds; }
    else if (cfg.activePollSeconds) w = Math.max(cfg.activePollSeconds, 5);
    return Math.min(DAY_S, Math.max(5, w));
  }

  const tokenRejected = () => log('The site does not accept this token (the PC link was removed, a newer token replaced it, or it is mistyped). Stopping. Get a new token: Settings > Connect my PC > New PC token (or Create my PC link).');

  /* --once: check, do everything waiting, leave. Returns the exit code. */
  async function runOnce() {
    log('PPP home worker ' + VERSION + ': one check of ' + cfg.siteUrl);
    sweepScratch();
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
  /* The wait after a poll that did not work, from ONE counter of consecutive failures (a network that is down, a 5xx, a 429, anything that is
     not a 200): it doubles from 30 s (60 s for an answer from the site) and stops growing at the idle wait (at least 15 minutes), and a 200 resets it.
     A site that answers 404, 405 or 410 no longer has this feature (a revert): the worker waits as long as an idle wait, never less than an hour. */
  function failureWait(kind, status, retryAfter, count, idleKnown) {
    count = Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1;
    idleKnown = Number.isFinite(idleKnown) && idleKnown > 0 ? Math.min(idleKnown, DAY_S) : 3600;
    retryAfter = secs(retryAfter, 0);
    const cap = Math.max(900, idleKnown);
    if (status === 404 || status === 405 || status === 410 || status === 501) return Math.min(DAY_S, Math.max(3600, idleKnown));
    const base = kind === 'net' ? 30 : 60;
    const w = Math.min(base * Math.pow(2, Math.min(count - 1, 30)), cap);
    return Math.min(DAY_S, status === 429 ? Math.max(retryAfter, Math.min(w, cap)) : w);
  }
  const jitter = deps.jitter || (() => Math.floor(Math.random() * 10));

  /* the loop: poll, work, wait as told. Resolves when stopped; returns the exit code. */
  async function runForever() {
    log('PPP home worker ' + VERSION + ' is watching ' + cfg.siteUrl + '. Ctrl-C stops it' + (cfg.idlePollSeconds ? '; idle checks are at least ' + humanWait(cfg.idlePollSeconds) + ' apart.' : '.'));
    sweepScratch();
    let failures = 0;
    let idleKnown = cfg.idlePollSeconds || 3600;
    while (!ctl.stop) {
      let p, why = null, status = 0, retryAfter = 0, kind = 'net';
      try { p = await poll(false); }
      catch (e) {
        if (e.fatalToken) { tokenRejected(); return 2; }
        why = 'Could not reach the site (' + e.message + ')';
      }
      if (p && p.failed) {
        kind = 'http'; status = p.status; retryAfter = p.retryAfter;
        why = 'The site answered ' + p.status + (p.message ? ' (' + p.message + ')' : '');
      }
      if (why) {
        failures++;
        const w = failureWait(kind, status, retryAfter, failures, idleKnown) + (status === 404 || status === 405 || status === 410 ? 0 : jitter());
        log(why + '. Trying again in ' + humanWait(w) + '.' + (status === 404 || status === 405 || status === 410 ? ' (This site does not have the conversion queue now.)' : ''));
        await ctl.sleep(w * 1000);
        continue;
      }
      failures = 0;
      if (p.next >= 300) idleKnown = Math.max(p.next, cfg.idlePollSeconds || 0);
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

  return { runOnce: runOnce, runForever: runForever, processJob: processJob, poll: poll, waitFor: waitFor, toResult: toResult, ctl: ctl, stats: stats, failureWait: failureWait, sweepScratch: sweepScratch, getAudio: getAudio, decode: decode, transcribe: transcribe, log: log };
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
    /* G10a-1d: optional; without it the notes go alone (not a thing to fix) */
    if (cfg.beats) {
      const bt = await (deps.runTool || runTool)(cfg.pythonPath, ['-c', 'import beat_this.inference'], { timeoutMs: 60000 });
      log(bt.code === 0 && fs.existsSync(cfg.beatTrackPy) ? 'ok    the beat tracker (beat-this) is there: the beats go with the notes'
        : 'note  no beat tracker (beat-this in the Python and beat_track.py beside transcribe.py): the notes go alone; nothing to fix');
    }
    /* song mode is optional: without the separation only song-mode conversions fail (with a message that says what to install) */
    const sep = await (deps.runTool || runTool)(cfg.pythonPath, ['-c', 'import sys\nif sys.argv[1]: sys.path.insert(0, sys.argv[1])\nimport demucs, librosa\nprint("ok")', cfg.songLib || ''], { timeoutMs: 60000 });
    log(sep.code === 0 ? 'ok    song mode: the source separation (demucs) is there' + (cfg.songLib ? ' (' + cfg.songLib + ')' : '') : 'note  song mode is not set up (no demucs): piano conversions work; see tools/home-worker/README.md, "Song mode"');
    log(cfg.mt3Python && cfg.mt3Dir ? 'ok    song mode: YourMT3 is there (' + cfg.mt3Dir + '); a song is transcribed by it first, by the separation if it fails'
      : 'note  song mode without YourMT3 (tools/home-worker/setup-yourmt3.cmd adds it): songs use the separation; nothing to fix');
    log(cfg.ss2Python && cfg.ss2Dir ? 'ok    song mode: SheetSage2 is there (' + cfg.ss2Dir + '); a song\'s melody comes from it'
      : 'note  song mode without SheetSage2 (tools/home-worker/setup-sheetsage2.cmd adds it): the melody comes from YourMT3; nothing to fix');
  }
  if (!problems.some(p => /^(siteUrl|token)/.test(p))) {
    try {
      const r = await (deps.request || request)(cfg, 'GET', '/api/worker/ping', { timeoutMs: 60000 });
      if (r.status === 200) say(true, 'the site accepts the token; its idle wait is ' + humanWait(r.body && r.body.nextPollSeconds || 0));
      else if (r.status === 401) say(false, 'the site does not accept this token (the PC link was removed, a newer token replaced it, or it is mistyped).');
      else say(false, 'the site answered ' + r.status + '.');
    } catch (e) { say(false, 'the site could not be reached: ' + e.message); }
  }
  log(bad ? bad + ' thing(s) to fix.' : 'Everything is ready. Run: node tools/home-worker/worker.js --once');
  return bad ? 1 : 0;
}

/* ---------------- --pair: connect the person's other devices with ONE link (G10b-3) ----------------
   The pairing link is  <siteUrl>/#pc=<the PC link's client code>  (a URL fragment: browsers never send it to a server). Opened on any device it pairs that device with this PC's link
   (the page does the rest). This puts it in the Windows clipboard, so it can be pasted into a message to oneself, and opens it in this PC's own browser, which pairs this PC too.
   The code is the MASTER secret of the link (it can queue conversions, read results, replace the worker token, remove the link), so: it is read from the settings (clientCode: the code or the whole
   link) or from pc-code.txt next to them; it goes to the clipboard through the standard input of the tool, to the browser as ONE argument (no shell is ever involved, nothing is put in a command
   line string); and it is never printed - not by the log (which hides it) and not on the console, unless --show is given. Nothing is sent to the site by this command.
   G10b-4: TWO links come out of it. The PHONE link (<siteUrl>/#pc=<code>) is what goes to the clipboard (and is the one --show prints); the link that is OPENED in this PC's browser is the same with
   "&local=1" added, which tells the page that this browser is on the PC that runs the worker (so "High-quality (my PC)" starts the conversion at once). The phone link never carries it. What is printed
   is the link's NAME (linkTagOf: 6 characters that are not secret), so the owner sees the same characters here, in the page's confirmation and in its Settings card. This command does not know whether
   the page accepted the link (the page asks first when this browser already has another link), so it never says the PC is connected. */
const PAIR_TOOLS = {
  win32: { copy: ['clip', []], open: ['rundll32', ['url.dll,FileProtocolHandler']] },
  darwin: { copy: ['pbcopy', []], open: ['open', []] },
  linux: { copy: ['xclip', ['-selection', 'clipboard']], open: ['xdg-open', []] }
};

/* where the code is: the settings' clientCode, else pc-code.txt next to the settings file (or in ~/.ppp-home-worker when the settings are only the environment).
   { code, from } | { code: '', problem, file } - the content of a file is never put in a message. */
function findPcCode(cfg, deps) {
  deps = deps || {};
  const read = deps.readFile || (f => fs.readFileSync(f, 'utf8'));
  if (cfg.clientCode) return { code: cfg.clientCode, from: 'settings' };
  const file = path.join(cfg._file ? path.dirname(cfg._file) : path.join((deps.homedir || os.homedir)(), '.ppp-home-worker'), 'pc-code.txt');
  let text = null;
  try { text = read(file).replace(/^﻿/, ''); } catch (e) { text = null; }
  if (text === null) return { code: '', problem: cfg._clientCodeGiven ? 'bad-setting' : 'none', file: file };
  const code = codeFrom(text);
  return code ? { code: code, from: file } : { code: '', problem: 'bad-file', file: file };
}

/* run a tool with no shell: argv, and (copy) the text on its standard input. Resolves { ok, why } - never rejects. */
function runPiped(spawnFn, cmd, args, input) {
  return new Promise(resolve => {
    let child;
    try { child = spawnFn(cmd, args, { windowsHide: true, shell: false, stdio: [input == null ? 'ignore' : 'pipe', 'ignore', 'ignore'] }); }
    catch (e) { return resolve({ ok: false, why: String((e && e.code) || (e && e.message) || e) }); }
    let done = false;
    const fin = r => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* gone */ } fin({ ok: false, why: 'timeout' }); }, 15000);
    child.on('error', e => fin({ ok: false, why: String((e && e.code) || (e && e.message) || e) }));
    child.on('close', code => fin({ ok: code === 0, why: 'exit ' + code }));
    if (input != null && child.stdin) { child.stdin.on('error', () => { /* the tool went away: close says so */ }); child.stdin.end(input); }
  });
}

/* deps (tests): spawn, platform, tools ({ copy: [cmd, args], open: [cmd, args] }), out (the console, for --show), stdout and stderr (what the log writes to), log, readFile, homedir, show */
async function pairThisPc(cfg, deps) {
  deps = deps || {};
  const found = findPcCode(cfg, deps);
  const secretCfg = Object.assign({}, cfg, { clientCode: found.code || cfg.clientCode });
  const log = deps.log || makeLog(secretCfg, deps.stdout, deps.stderr);
  const out = deps.out || (s => process.stdout.write(s + '\n'));
  const say = (ko, en) => { log(ko); log(en); };
  const warn = (ko, en) => { log.warn(ko); log.warn(en); };
  const bad = siteProblems(cfg);
  if (bad.length) { bad.forEach(b => log.warn('Settings: ' + b)); warn('사이트 주소(siteUrl)를 설정 파일에 적어 주세요.', 'Put the site address (siteUrl) in the settings file.'); return 1; }
  if (!found.code) {
    if (found.problem === 'bad-file') warn('pc-code.txt 안의 내용이 PC 코드(또는 링크)가 아니에요. ' + found.file + ' 를 열어 PPP에서 복사한 링크를 다시 붙여 넣어 주세요.', 'The text in pc-code.txt is not a PC code or a pairing link. Paste the link copied from PPP again: ' + found.file);
    else if (found.problem === 'bad-setting') warn('설정의 clientCode가 PC 코드(64자리 영문·숫자)나 링크가 아니에요.', 'clientCode in the settings is not a PC code (64 letters and digits) or a pairing link.');
    else warn('이 PC가 아직 PC 링크의 코드를 몰라요. PPP > 설정 > 내 PC 연결 > "다른 기기 연결: 링크 복사"로 링크를 복사한 뒤, 이 파일에 붙여 넣고 다시 실행하세요: ' + found.file, 'This PC does not know the PC link code yet. In PPP: Settings > Connect my PC > "Connect another device: copy link", then paste the link into this file and run this again: ' + found.file + ' (or put "clientCode" in the settings).');
    return 1;
  }
  const link = cfg.siteUrl.replace(/\/+$/, '') + '/#pc=' + found.code;        /* the phone link */
  const pcLink = link + '&local=1';                                              /* the link of this PC's own browser */
  const tag = linkTagOf(found.code);
  /* the links go to a program as one argument: each must be exactly what it should be, an http(s) address with no space, quote or shell character in it */
  const LINK_RE = /^https?:\/\/[A-Za-z0-9.\-_:[\]]+(\/[A-Za-z0-9._~\-/]*)?\/#pc=[0-9a-f]{64}(&local=1)?$/;
  if (!LINK_RE.test(link) || !LINK_RE.test(pcLink)) { warn('사이트 주소(siteUrl)에 쓸 수 없는 글자가 있어요.', 'siteUrl has characters that cannot be used in a link.'); return 1; }
  const tools = deps.tools || PAIR_TOOLS[deps.platform || process.platform];
  if (!tools) {
    warn('이 운영체제에서는 링크를 자동으로 복사하거나 열 수 없어요. --show 로 실행해 링크를 직접 복사하세요.', 'Copying and opening the link is not supported on this system. Run with --show and copy the link yourself.');
    if (deps.show) out(link);
    return 1;
  }
  const spawnFn = deps.spawn || spawn;
  const copied = await runPiped(spawnFn, tools.copy[0], tools.copy[1], link);
  const opened = await runPiped(spawnFn, tools.open[0], tools.open[1].concat([pcLink]), null);
  if (deps.show) out(link);
  const name = '…' + tag;
  if (copied.ok && opened.ok) {
    say('브라우저에서 링크를 열었고, 휴대폰용 링크를 복사했어요. 브라우저에 보이는 PC 링크 이름이 ' + name + ' 인지 확인하세요(다른 링크가 이미 연결돼 있으면 브라우저가 먼저 물어봐요). 복사한 링크는 나에게 보내는 메시지에 붙여 넣고 휴대폰에서 열어 주세요.',
      'Opened the link in your browser and copied the phone link. Check that the PC link name on the screen is ' + name + ' (the browser asks first if another link is already connected). Paste the copied link in a message to yourself and open it on the phone.');
    return 0;
  }
  if (copied.ok) {
    say('휴대폰용 링크를 복사했어요(PC 링크 이름 ' + name + '). 나에게 보내는 메시지에 붙여 넣고 휴대폰에서 열어 주세요.', 'The link for your phone is copied (PC link name ' + name + '): paste it in a message to yourself and open it on the phone.');
    warn('이 PC의 브라우저는 열지 못했어요. 이 PC에서도 쓰려면 복사한 링크를 브라우저 주소창에 붙여 넣으세요.', 'This PC\'s browser could not be opened: paste the copied link into its address bar to use this PC too.');
    return 0;
  }
  warn('링크를 복사하지 못했어요. --show 로 다시 실행해 링크를 직접 복사하세요.', 'The link could not be copied. Run again with --show and copy it yourself.');
  return 1;
}

/* ---------------- G10b-4: one run at a time ----------------
   The scheduled task, the desktop shortcut (run-once.cmd) and the pppworker:// launch from the page all start `--once`. Two of them at the same moment would run the piano models twice on one GPU. So a
   `--once` takes a LOCK first: the file worker.lock in the settings folder (next to the settings file; ~/.ppp-home-worker when the settings are only the environment), made with the "create, fail if it
   exists" flag so that two starters cannot both win, holding { pid, startedAt }. A second `--once` that finds a lock whose process is alive and that is younger than 45 minutes stops at once with
   ONE line and exit code 0. A lock whose process is gone, that is 45 minutes old or older (a conversion is at most 15 minutes of audio; a machine that slept), or that cannot be read (and is more than
   a few seconds old, so its maker is not still writing it) is taken over. It is removed when the run ends - normally, by an error, by Ctrl-C (process 'exit') - and only if it is still OURS. */
const LOCK_STALE_MS = 45 * 60 * 1000;
const settingsDirOf = (cfg, deps) => (cfg && cfg._file ? path.dirname(cfg._file) : path.join(((deps && deps.homedir) || os.homedir)(), '.ppp-home-worker'));
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return !!e && e.code === 'EPERM'; }
}
/* { ok: true, file, pid, startedAt } when this run holds the lock (or none could be made: a settings folder that cannot be written does not stop the work, ok with skipped);
   { ok: false, pid, startedAt, file } when a live run holds it */
function acquireRunLock(cfg, deps) {
  deps = deps || {};
  const file = path.join(settingsDirOf(cfg, deps), 'worker.lock');
  const now = (deps.now || Date.now)();
  const alive = deps.pidAlive || pidAlive;
  const pid = deps.pid || process.pid;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (e) { return { ok: true, file: '', pid: pid, skipped: String((e && e.code) || e) }; }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      try { fs.writeSync(fd, JSON.stringify({ pid: pid, startedAt: now })); } finally { fs.closeSync(fd); }
      return { ok: true, file: file, pid: pid, startedAt: now };
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return { ok: true, file: '', pid: pid, skipped: String((e && e.code) || e) };
    }
    let cur = null, young = false;
    try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { cur = null; }
    if (!cur) { try { young = now - fs.statSync(file).mtimeMs < 5000; } catch (e) { young = false; } }
    const valid = !!cur && Number.isInteger(cur.pid) && cur.pid > 0 && Number.isFinite(cur.startedAt);
    const age = valid ? now - cur.startedAt : 0;
    if (young || (valid && age > -60000 && age < LOCK_STALE_MS && alive(cur.pid))) return { ok: false, pid: valid ? cur.pid : 0, startedAt: valid ? cur.startedAt : 0, file: file };
    try { fs.unlinkSync(file); } catch (e) { /* somebody else took it over first: the next round sees theirs */ }
  }
  return { ok: false, pid: 0, startedAt: 0, file: file };
}
/* only our own lock is removed (a lock taken over after 45 minutes now belongs to the new run) */
function releaseRunLock(lock) {
  if (!lock || !lock.file || lock.released) return;
  lock.released = true;
  try {
    const cur = JSON.parse(fs.readFileSync(lock.file, 'utf8'));
    if (cur && cur.pid === lock.pid && cur.startedAt === lock.startedAt) fs.unlinkSync(lock.file);
  } catch (e) { /* already gone */ }
}

/* a log file that also gets every line (the lines are already clean: makeLog hides the token and the client code before it calls its output). Kept small: past 512 KB the old file is set aside as <file>.old. */
function appendLog(file, line) {
  if (!file) return;
  try {
    try { if (fs.statSync(file).size > 512 * 1024) fs.renameSync(file, file + '.old'); } catch (e) { /* no file yet */ }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line + '\n');
  } catch (e) { /* a log that cannot be written must not stop the work */ }
}

/* ---------------- G10b-4: the pppworker:// link (Windows, this user only) ----------------
   A web page can ask the browser to open a link whose scheme is registered with Windows. Registering "pppworker" (under HKCU\Software\Classes: the current user's own part of the registry, no administrator needed) lets the
   PPP page start THIS worker at once when the person presses "High-quality (my PC)" in the PC's own browser, instead of waiting for the next scheduled check.
   What registering does: three values, nothing else -
     HKCU\Software\Classes\pppworker                     (Default) = "URL:PPP worker"     and     "URL Protocol" = ""
     HKCU\Software\Classes\pppworker\shell\open\command  (Default) = wscript.exe //B //Nologo "<this folder>\run-hidden.vbs"
   The command has NO %1 and run-hidden.vbs never reads its arguments: whatever follows pppworker:// is thrown away, so no page can pass this PC anything - a page that fires pppworker://anything only makes the browser ask
   "Open PPP worker?" and, if the person agrees, starts one bounded `--once` run, which asks the PPP site for the jobs of the user's OWN link (and does nothing if there are none). The run lock keeps those runs from piling up.
   reg.exe is started with an argument VECTOR and no shell (never a command line built as a string); the one text that is built - the command value - is made of the fixed wscript words and this folder's
   run-hidden.vbs path, which must be absolute, exist, end in run-hidden.vbs and hold no quote, percent sign, control character or line break (a %1 or %L in the path would be replaced by Windows). */
const REG_HIVE = 'HKCU';
const PROTO_ROOT = REG_HIVE + '\\Software\\Classes\\pppworker';
const PROTO_CMD_KEY = PROTO_ROOT + '\\shell\\open\\command';
const PROTO_TITLE = 'URL:PPP worker';
const regExeOf = deps => (deps && deps.regExe) || path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'reg.exe');

/* what is wrong with the path of run-hidden.vbs, as a sentence ('' when it can be used) */
function vbsProblem(vbs, exists) {
  if (typeof vbs !== 'string' || !vbs) return 'no path';
  if (/["%\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(vbs)) return 'the path has a quote, a percent sign or a control character';
  if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(vbs)) return 'the path is not absolute';
  if (!/[\\/]run-hidden\.vbs$/.test(vbs)) return 'the file is not run-hidden.vbs';
  if (!exists(vbs)) return 'run-hidden.vbs is not there';
  return '';
}
const protocolCommand = vbs => 'wscript.exe //B //Nologo "' + vbs + '"';

/* run reg.exe with an argument vector, no shell; resolves { ok, code, out } and never rejects */
function runReg(spawnFn, regExe, args) {
  return new Promise(resolve => {
    let child, out = '', done = false;
    const fin = r => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    try { child = spawnFn(regExe, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ ok: false, code: -1, out: '', why: String((e && e.code) || (e && e.message) || e) }); }
    const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* gone */ } fin({ ok: false, code: -1, out: out, why: 'timeout' }); }, 20000);
    if (child.stdout) child.stdout.on('data', d => { out += d.toString('utf8'); });
    if (child.stderr) child.stderr.on('data', () => {});
    child.on('error', e => fin({ ok: false, code: -1, out: out, why: String((e && e.code) || (e && e.message) || e) }));
    child.on('close', code => fin({ ok: code === 0, code: code, out: out }));
  });
}
/* the REG_SZ value of a key, or null: `reg query <key> /ve` (or /v <name>) prints   (Default)    REG_SZ    <value>   in the console's language */
async function regValue(spawnFn, regExe, key, name) {
  const r = await runReg(spawnFn, regExe, name ? ['query', key, '/v', name] : ['query', key, '/ve']);
  if (!r.ok) return null;
  const m = String(r.out).match(/REG_SZ[ \t]*(.*)$/m);
  return m ? m[1].replace(/\r$/, '') : '';
}
/* paths printed by reg.exe come back in the console's code page: compare only what is ASCII in both (a Korean user name is the same on both sides, but not the same bytes) */
const asciiOnly = s => String(s).replace(/[^\x20-\x7e]/g, '').toLowerCase();

async function protocolState(deps) {
  deps = deps || {};
  const spawnFn = deps.spawn || spawn, regExe = regExeOf(deps);
  const title = await regValue(spawnFn, regExe, PROTO_ROOT);
  const command = await regValue(spawnFn, regExe, PROTO_CMD_KEY);
  const vbs = deps.vbsPath || path.join(__dirname, 'run-hidden.vbs');
  const exists = deps.exists || (f => fs.existsSync(f));
  const registered = title !== null || command !== null;
  const ours = title === PROTO_TITLE && command !== null && /run-hidden\.vbs"?$/i.test(command) && /^wscript\.exe\s+\/\/B\s+\/\/Nologo\s+"/i.test(command);
  const here = command !== null && asciiOnly(command) === asciiOnly(protocolCommand(vbs));
  return { registered: registered, ours: ours, here: here, title: title, command: command, vbs: vbs, vbsExists: exists(vbs) };
}

function protocolSay(deps) {
  const log = (deps && deps.log) || makeLog({}, deps && deps.stdout, deps && deps.stderr);
  return { log: log, say: (ko, en) => { log(ko); log(en); }, warn: (ko, en) => { log.warn(ko); log.warn(en); } };
}
const notWindows = (deps, o) => {
  if ((deps.platform || process.platform) === 'win32') return false;
  o.warn('이 기능은 Windows 전용이에요.', 'The pppworker:// link is for Windows only.');
  return true;
};
const UNDO_HELP = ['되돌리려면: tools\\home-worker\\unregister-protocol.cmd 를 더블클릭하거나 node tools/home-worker/worker.js --unregister-protocol', 'To undo it: double-click tools\\home-worker\\unregister-protocol.cmd or run node tools/home-worker/worker.js --unregister-protocol'];

async function registerProtocol(deps) {
  deps = deps || {};
  const o = protocolSay(deps);
  if (notWindows(deps, o)) return 1;
  const spawnFn = deps.spawn || spawn, regExe = regExeOf(deps);
  const vbs = deps.vbsPath !== undefined ? deps.vbsPath : path.join(__dirname, 'run-hidden.vbs');
  const exists = deps.exists || (f => fs.existsSync(f));
  const problem = vbsProblem(vbs, exists) || (exists(path.join(path.dirname(vbs), 'run-once-hidden.cmd')) ? '' : 'run-once-hidden.cmd is not next to it');
  if (problem) { o.warn('등록하지 않았어요: ' + problem + '.', 'Not registered: ' + problem + '.'); return 1; }
  const steps = [
    ['add', PROTO_ROOT, '/ve', '/t', 'REG_SZ', '/d', PROTO_TITLE, '/f'],
    ['add', PROTO_ROOT, '/v', 'URL Protocol', '/t', 'REG_SZ', '/d', '', '/f'],
    ['add', PROTO_CMD_KEY, '/ve', '/t', 'REG_SZ', '/d', protocolCommand(vbs), '/f']
  ];
  for (const args of steps) {
    const r = await runReg(spawnFn, regExe, args);
    if (!r.ok) { o.warn('등록하지 못했어요(reg.exe가 실패했어요: ' + (r.why || 'exit ' + r.code) + '). 아무것도 바뀌지 않았거나 일부만 바뀌었을 수 있어요: 다시 실행하거나 등록 해제를 실행하세요.', 'Could not register (reg.exe failed: ' + (r.why || 'exit ' + r.code) + '). Nothing, or only part, was written: run it again, or run the unregister command.'); return 1; }
  }
  o.say('등록했어요. 이제 이 PC의 브라우저에서 PPP의 「고품질 변환(내 PC)」을 누르면 바로 시작해요(처음 한 번 브라우저가 「PPP worker를 열까요?」 하고 물어요). 현재 사용자 계정에만 적용돼요(관리자 권한 없음).', 'Registered. Now "High-quality (my PC)" in PPP, pressed in this PC\'s browser, starts the conversion at once (the first time, the browser asks "Open PPP worker?"). It applies to your Windows user only (no administrator rights).');
  o.say('쓰인 곳: ' + PROTO_ROOT + ' (3개 값). 실행되는 것: ' + protocolCommand(vbs) + ' — 주소 뒤의 내용은 받지 않아요.', 'Written under ' + PROTO_ROOT + ' (three values). What runs: ' + protocolCommand(vbs) + ' - anything after pppworker:// is ignored.');
  o.say(UNDO_HELP[0], UNDO_HELP[1]);
  return 0;
}

async function unregisterProtocol(deps) {
  deps = deps || {};
  const o = protocolSay(deps);
  if (notWindows(deps, o)) return 1;
  const st = await protocolState(deps);
  if (!st.registered) { o.say('등록된 게 없어요. 할 일이 없어요.', 'Nothing is registered. Nothing to do.'); return 0; }
  if (!st.ours) { o.warn('pppworker 항목이 이 도구가 만든 것 같지 않아서 지우지 않았어요.', 'The pppworker entry does not look like the one this tool makes, so it was not removed.'); return 1; }
  const r = await runReg(deps.spawn || spawn, regExeOf(deps), ['delete', PROTO_ROOT, '/f']);
  if (!r.ok) { o.warn('지우지 못했어요(reg.exe가 실패했어요: ' + (r.why || 'exit ' + r.code) + ').', 'Could not remove it (reg.exe failed: ' + (r.why || 'exit ' + r.code) + ').'); return 1; }
  o.say('등록을 지웠어요(' + PROTO_ROOT + ' 와 그 아래 항목만). 이제 PPP 페이지는 이 PC를 바로 시작하지 못하고, 다음 확인 때 처리돼요.', 'Removed the registration (' + PROTO_ROOT + ' and what is under it, nothing else). The PPP page can no longer start this PC at once; jobs wait for the next check.');
  return 0;
}

async function protocolStatus(deps) {
  deps = deps || {};
  const o = protocolSay(deps);
  if (notWindows(deps, o)) return 1;
  const st = await protocolState(deps);
  if (!st.registered) { o.say('등록되어 있지 않아요(register-protocol.cmd 를 더블클릭하면 등록해요).', 'Not registered (double-click register-protocol.cmd to register it).'); return 1; }
  if (!st.ours) { o.warn('pppworker 항목이 있지만 이 도구가 만든 것 같지 않아요.', 'A pppworker entry exists but it does not look like the one this tool makes.'); return 1; }
  if (!st.here) { o.warn('등록되어 있지만 다른 폴더를 가리켜요: ' + st.command + ' (이 폴더에서 다시 등록하세요).', 'Registered, but it points to another folder: ' + st.command + ' (register it again from this folder).'); return 1; }
  if (!st.vbsExists) { o.warn('등록되어 있지만 run-hidden.vbs 파일이 없어요.', 'Registered, but run-hidden.vbs is missing.'); return 1; }
  o.say('등록되어 있고 이 폴더를 가리켜요.', 'Registered, and it points to this folder.');
  return 0;
}

async function main(argv, deps) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*/, '').trim());
    return 0;
  }
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  /* G10b-4: the pppworker:// registration needs no settings (a PC that is only being set up can have it) */
  if (args.includes('--register-protocol')) return registerProtocol(Object.assign({}, deps && deps.protocol));
  if (args.includes('--unregister-protocol')) return unregisterProtocol(Object.assign({}, deps && deps.protocol));
  if (args.includes('--protocol-status')) return protocolStatus(Object.assign({}, deps && deps.protocol));
  let cfg;
  try { cfg = loadConfig(opt('--config')); } catch (e) { console.error(e.message); return 1; }
  if (args.includes('--pair')) return pairThisPc(cfg, Object.assign({ show: args.includes('--show') }, deps && deps.pair));
  /* --log-file [file]: every line the worker prints also goes to a file (default: worker.log next to the settings file) */
  const li = args.indexOf('--log-file');
  const logFile = li < 0 ? '' : (args[li + 1] && !/^--/.test(args[li + 1]) ? path.resolve(args[li + 1]) : path.join(settingsDirOf(cfg, deps && deps.lock), 'worker.log'));
  const tee = to => line => { to(line); appendLog(logFile, line); };
  const log = logFile ? makeLog(cfg, tee(s => process.stdout.write(s + '\n')), tee(s => process.stderr.write(s + '\n'))) : makeLog(cfg);
  lastLog = log;
  if (logFile) appendLog(logFile, '---- ' + new Date().toISOString() + ' ' + args.filter(a => /^--(once|check|log-file)$/.test(a)).join(' ') + ' ----');
  if (args.includes('--check')) return checkSetup(cfg, log);
  const problems = configProblems(cfg);
  if (problems.length) { problems.forEach(p => log.warn('Settings: ' + p)); log.warn('Run with --check for more.'); return 1; }
  const w = createWorker(cfg, { log: log });
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
  if (!args.includes('--once')) return w.runForever();
  /* --once takes the run lock first (see acquireRunLock): the scheduled task, the desktop shortcut and the pppworker:// launch can never run the models twice at once */
  const lock = acquireRunLock(cfg, Object.assign({}, deps && deps.lock));
  if (!lock.ok) {
    log('이미 다른 실행이 진행 중이에요(시작 ' + (lock.startedAt ? clock(new Date(lock.startedAt)) : '?') + ', pid ' + lock.pid + '): 이번 실행은 끝냅니다. / Another run is already going (started ' + (lock.startedAt ? clock(new Date(lock.startedAt)) : '?') + ', pid ' + lock.pid + '): this one stops.');
    return 0;
  }
  const onExit = () => releaseRunLock(lock);
  process.on('exit', onExit);
  try { return await w.runOnce(); } finally { releaseRunLock(lock); process.removeListener('exit', onExit); }
}

module.exports = { main, loadConfig, configProblems, siteProblems, codeFrom, linkTagOf, findPcCode, pairThisPc, createWorker, checkSetup, makeLog, request, downloadTo, runTool, looksLikeAudioFile,
  acquireRunLock, releaseRunLock, LOCK_STALE_MS, appendLog, registerProtocol, unregisterProtocol, protocolStatus, vbsProblem, protocolCommand, PROTO_ROOT, PROTO_CMD_KEY, DEFAULTS, VERSION };

if (require.main === module) {
  main(process.argv).then(code => process.exit(code), e => { const m = 'The worker stopped: ' + (e && e.message || e); if (lastLog) lastLog.warn(m); else console.error(m); process.exit(1); });
}
