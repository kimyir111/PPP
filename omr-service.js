#!/usr/bin/env node
/* ============================================================================
   PPP local service

   Optical music recognition cannot run in a browser: there is no production
   grade OMR in JS or WASM, and writing one is not this project's business. So
   this small local service stands between PPP and Audiveris.

   It takes page images, runs Audiveris on each, and returns MusicXML. The
   browser rasterises PDFs itself (pdf.js at 300 DPI) because Audiveris wants
   that resolution and the review screen needs the page images anyway.

   MusicXML is the only thing that crosses back. Everything downstream — the
   parser, Score, practice, weakness and memory systems — is untouched and has
   no idea a PDF was ever involved.

     node omr-service.js [--port 8788] [--audiveris <path to Audiveris.exe>]

   Also hosts the AI coach (/coach), so the Anthropic key stays server-side,
   and audio transcription (/transcribe): a YouTube link, an MP3 or an MP4 in,
   the notes a piano model hears out. Notation is still PPP's job, in the
   browser, so MusicXML remains the only thing the parser ever reads.

   OMR needs no dependencies; the coach needs @anthropic-ai/sdk and zod, and is
   simply off without them; transcription needs ffmpeg and the Python model in
   tools/ (yt-dlp too, for links). Binds to 127.0.0.1 only.
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

/* ---- .env, for development ----
   The key belongs to the environment, not to the source tree, and never to the
   browser. Reading a local .env is a convenience for development only: it is
   gitignored, a real environment variable always wins over it, and no value
   read here is ever logged or returned. Names are all this function reports. */
function loadDotEnv() {
  const file = path.join(__dirname, '.env');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const names = [];
  text.split(/\r?\n/).forEach(line => {
    if (/^\s*#/.test(line)) return;
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) return;
    let v = m[2].trim();
    const q = v.charAt(0);
    if ((q === '"' || q === "'") && v.charAt(v.length - 1) === q && v.length > 1) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '').trim();   /* an unquoted trailing comment, never mid-token */
    if (!v) return;
    names.push(m[1]);
    if (process.env[m[1]] == null || process.env[m[1]] === '') process.env[m[1]] = v;
  });
  return names;
}
const DOTENV = loadDotEnv();

/* Defence in depth. Nothing leaving this process — an error to the browser, a
   line to the console — may carry the key, even if a provider error quotes the
   request it came from. */
function redact(v) {
  let out = String(v == null ? '' : v);
  const k = process.env.ANTHROPIC_API_KEY;
  if (k && k.length >= 8) out = out.split(k).join('sk-***');
  return out.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-***');
}

/* The coach runs here, not in the browser, so the API key never reaches the
   frontend or localStorage. Loaded lazily: PPP works without it. */
let _sdk = null;
function sdk() {
  if (_sdk !== null) return _sdk;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
    const { z } = require('zod');
    _sdk = { Anthropic: Anthropic.default || Anthropic, zodOutputFormat, z };
  } catch (e) { _sdk = false; }
  return _sdk;
}
const COACH_MODEL = process.env.PPP_COACH_MODEL || 'claude-opus-5';

const LIMITS = {
  maxPages: 24,
  maxPageBytes: 16 * 1024 * 1024,
  maxTotalBytes: 80 * 1024 * 1024,
  perPageTimeoutMs: 180000
};

const args = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i > -1 && args[i + 1] ? args[i + 1] : dflt;
};
const PORT = +argVal('--port', 8788);

/* ---- locating Audiveris ---- */
function findAudiveris() {
  const explicit = argVal('--audiveris', process.env.PPP_AUDIVERIS);
  const candidates = [
    explicit,
    path.join(__dirname, 'tools', 'audiveris', 'Audiveris', 'Audiveris.exe'),
    path.join(__dirname, 'tools', 'audiveris', 'Audiveris', 'bin', 'Audiveris.bat'),
    'C:\\Program Files\\Audiveris\\Audiveris.exe',
    '/usr/bin/audiveris', '/usr/local/bin/audiveris'
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}
const AUDIVERIS = findAudiveris();

/* A notation editor's PDF is not a photograph: its glyphs and staff lines are
   vector objects. PDFtoMusic Pro can recover those objects directly and is a
   much better first route than raster OMR. It is optional/proprietary and is
   only used when the owner has installed it on this computer. */
function findPdfToMusic() {
  const candidates = [
    process.env.PPP_PDFTOMUSIC,
    'C:\\Program Files\\PDFtoMusic Pro\\p2mp.exe',
    'C:\\Program Files (x86)\\PDFtoMusic Pro\\p2mp.exe',
    '/usr/bin/p2mp', '/usr/local/bin/p2mp'
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}
const PDFTOMUSIC = findPdfToMusic();

/* ---- minimal .mxl reader (a zip of one MusicXML file) ----
   Read through the central directory rather than walking local headers: a
   writer that streams entries leaves the sizes in the local header at zero and
   puts the real ones in a trailing data descriptor. The central directory
   always has them. */
function readMxlSync(file) {
  const buf = fs.readFileSync(file);
  const entries = {};

  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    /* the local header repeats the name and extra field, at its own lengths */
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    entries[name] = { method, start: localOff + 30 + lNameLen + lExtraLen, compSize };
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = key => {
    const e = entries[key];
    if (!e) return null;
    const raw = buf.subarray(e.start, e.start + e.compSize);
    if (e.method === 0) return raw.toString('utf8');
    if (e.method === 8) return zlib.inflateRawSync(raw).toString('utf8');
    throw new Error('unsupported compression in .mxl');
  };
  let target = null;
  const container = read('META-INF/container.xml');
  if (container) {
    const m = /full-path\s*=\s*"([^"]+)"/.exec(container);
    if (m) target = m[1];
  }
  if (!target || !entries[target])
    target = Object.keys(entries).find(k => /\.(xml|musicxml)$/i.test(k) && k.indexOf('META-INF') !== 0);
  if (!target) throw new Error('no MusicXML inside the .mxl');
  return read(target);
}

/* ---- run Audiveris on one page image ---- */
function recognisePage(imgPath, outDir) {
  return new Promise(resolve => {
    if (!AUDIVERIS) return resolve({ ok: false, error: 'Audiveris is not installed' });
    const t0 = Date.now();
    execFile(AUDIVERIS,
      ['-batch', '-export', '-output', outDir, '--', imgPath],
      { timeout: LIMITS.perPageTimeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const log = String(stdout || '') + String(stderr || '');
        let mxl = null;
        try {
          mxl = fs.readdirSync(outDir).filter(f => /\.mxl$/i.test(f))
            .map(f => path.join(outDir, f))
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
        } catch (e) {}
        if (!mxl) {
          /* Audiveris exits 0 even when it finds nothing worth exporting, so the
             absence of an export is the real signal. */
          const noStaff = /No staff|no system|Could not find|not a supported/i.test(log);
          return resolve({
            ok: false, ms: Date.now() - t0,
            error: noStaff ? 'No musical notation was detected on this page.'
              : (err && err.killed) ? 'Recognition timed out on this page.'
                : 'Audiveris produced no MusicXML for this page.',
            log: log.slice(-1500)
          });
        }
        try {
          const xml = readMxlSync(mxl);
          resolve({ ok: true, ms: Date.now() - t0, musicxml: xml });
        } catch (e) {
          resolve({ ok: false, ms: Date.now() - t0, error: 'The MusicXML Audiveris produced could not be read: ' + e.message });
        }
      });
  });
}

function convertVectorPdf(bytes) {
  return new Promise(resolve => {
    if (!PDFTOMUSIC) return resolve({ ok: false, code: 'engine-missing', error: 'PDFtoMusic Pro is not installed.' });
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-vector-pdf-'));
    const source = path.join(work, 'source.pdf');
    fs.writeFileSync(source, bytes);
    const t0 = Date.now();
    execFile(PDFTOMUSIC, [source], {
      cwd: work, timeout: 5 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, windowsHide: true
    }, (err, stdout, stderr) => {
      try {
        const files = fs.readdirSync(work).filter(f => /\.(mxl|musicxml|xml)$/i.test(f))
          .map(f => path.join(work, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        if (!files.length) {
          const log = String(stdout || '') + String(stderr || '');
          return resolve({
            ok: false, code: /vector|scan|picture/i.test(log) ? 'not-vector' : 'conversion-failed',
            error: err && err.killed ? 'Vector PDF conversion timed out.'
              : 'This PDF did not produce MusicXML. It may be a scan, or MusicXML export is not enabled in PDFtoMusic Pro.'
          });
        }
        const file = files[0];
        const xml = /\.mxl$/i.test(file) ? readMxlSync(file) : fs.readFileSync(file, 'utf8');
        resolve({ ok: true, musicxml: xml, engine: 'PDFtoMusic Pro', ms: Date.now() - t0 });
      } catch (e) {
        resolve({ ok: false, code: 'conversion-failed', error: 'The vector PDF result could not be read: ' + e.message });
      } finally {
        try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
      }
    });
  });
}

/* ---- http ---- */
function send(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(s),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(s);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('upload exceeds ' + Math.round(limit / 1048576) + ' MB')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ============================================================================
   COACH ENDPOINT

   Takes a CoachContext, asks a model for a session plan, returns structured
   JSON. Any API key lives here and is never sent to the browser.

   Two providers answer the same endpoint in the same shape:

     Claude   the Anthropic API. Needs ANTHROPIC_API_KEY.
     Ollama   a model running on this machine. Needs nothing, costs nothing.

   PPP picks whichever is available, preferring Anthropic, and reports which
   one by name so the panel can say who actually planned the session. Forcing
   one or the other is PPP_COACH_PROVIDER=anthropic|ollama.

   The model is asked to interpret, never to measure: the context carries every
   figure it is allowed to cite, and PPP validates the result again in the
   browser before acting on any of it.
   ========================================================================== */

/* zod is loaded on its own, so the Ollama path works with no Anthropic SDK. */
let _zod = null;
function zodLib() {
  if (_zod !== null) return _zod;
  try { _zod = require('zod').z; } catch (e) { _zod = false; }
  return _zod;
}

function coachSchema(z) {
  return z.object({
    summary: z.string().describe('One sentence on where this player stands, using only figures from the context.'),
    todayGoal: z.string().describe('The single thing this session should achieve.'),
    tasks: z.array(z.object({
      range: z.object({
        start: z.number().int().describe('First measure number. Must exist in allowed.measures.'),
        end: z.number().int().describe('Last measure number. Must exist in allowed.measures.')
      }),
      hand: z.enum(['left', 'right', 'both']),
      tempoPercent: z.number().int().describe('Percent of the score tempo, 30 to 120.'),
      mode: z.enum(['practice', 'memory']).describe('memory is only allowed for ranges in allowed.memoryEligibleSections.'),
      repetitions: z.number().int().describe('1 to 8.'),
      reason: z.string().describe('Why this task, grounded in the measured facts.')
    })).describe('Three to five tasks, in the order they should be done.'),
    coachNote: z.string().describe('One short observation. Specific, not encouragement.'),
    sessionMinutes: z.number().int().describe('Total minutes, 5 to 60.')
  });
}

/* One schema, two wire formats. Ollama takes plain JSON Schema, so it is
   derived from the same zod definition rather than written out twice. */
function coachJsonSchema() {
  const z = zodLib();
  if (!z || typeof z.toJSONSchema !== 'function') return null;
  const s = z.toJSONSchema(coachSchema(z));
  delete s.$schema;
  return s;
}

const COACH_SYSTEM = [
  'You are the practice coach inside PPP, a piano practice app.',
  '',
  'PPP has already measured this player. The context you are given is the truth:',
  'it contains what was played, how accurately, with which hand, at which tempo,',
  'and what PPP has concluded. You do not assess playing and you do not decide',
  'what is weak or memorized — those are already decided.',
  '',
  'Your job is to turn those facts into a short practice session the player can',
  'do right now.',
  '',
  'Rules, all enforced after you answer:',
  '- Only use measure numbers from allowed.measures.',
  '- mode "memory" is only permitted for ranges inside allowed.memoryEligibleSections.',
  '  A passage that has not earned memory work cannot be given blind recall.',
  '  If that list is empty, every task must be mode "practice".',
  '- Only cite numbers that appear in the context. Never estimate a figure.',
  '  If you do not have a number, describe the problem without one.',
  '- structural.* is predicted from the notation, not measured from this player.',
  '  Never present it as something they did.',
  '- Order tasks so the session builds: isolate, then combine, then confirm.',
  '- Be specific and plain. No encouragement, no exclamation marks, no praise.',
  '  "Your left hand is at 56% in measures 21-24" is useful; "keep it up" is not.',
  '- Be brief. summary and todayGoal are one short line each; coachNote is one',
  '  sentence; each task reason is one sentence. This panel is read at a glance',
  '  between attempts, not studied. Never repeat what the task already says.',
  '- Write in the language the request names, not in English by default.'
].join('\n');

const COACH_USER = ctx => 'Plan the next practice session from these measurements.\n\n' +
  'Write every sentence you return in ' + (ctx.language || 'English') +
  ', including summary, todayGoal, coachNote and every task reason.\n' +
  'Keep coachNote to one sentence.\n\n' +
  '```json\n' + JSON.stringify(ctx, null, 1) + '\n```';

/* ---- which provider is answering right now ---- */
const COACH_PROVIDER = (process.env.PPP_COACH_PROVIDER || 'auto').toLowerCase();
const OLLAMA_URL = (process.env.PPP_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.PPP_OLLAMA_MODEL || 'qwen3:8b';
const OLLAMA_TIMEOUT_MS = +(process.env.PPP_OLLAMA_TIMEOUT_MS || 180000);

function anthropicUp() { return !!(process.env.ANTHROPIC_API_KEY && sdk()); }

/* Probed rather than assumed, and cached briefly so /health stays cheap. */
let _ollamaSeen = { at: 0, ok: false };
async function ollamaUp() {
  if (Date.now() - _ollamaSeen.at < 15000) return _ollamaSeen.ok;
  let ok = false;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(OLLAMA_URL + '/api/tags', { signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const j = await r.json();
      ok = (j.models || []).some(m => m.name === OLLAMA_MODEL || m.model === OLLAMA_MODEL);
    }
  } catch (e) { ok = false; }
  _ollamaSeen = { at: Date.now(), ok: ok };
  return ok;
}

/* The name here is what the panel prints, so it has to be the truth. */
async function coachStatus() {
  if (COACH_PROVIDER !== 'ollama' && anthropicUp())
    return { kind: 'anthropic', name: 'Claude', model: COACH_MODEL };
  if (COACH_PROVIDER !== 'anthropic' && zodLib() && await ollamaUp())
    return { kind: 'ollama', name: 'Ollama', model: OLLAMA_MODEL };
  return null;
}

function coachOffReason() {
  if (COACH_PROVIDER === 'anthropic')
    return !process.env.ANTHROPIC_API_KEY
      ? 'No ANTHROPIC_API_KEY is set, so the AI coach is off. PPP will plan the session itself.'
      : 'The Anthropic SDK is not installed. PPP will plan the session itself.';
  if (COACH_PROVIDER === 'ollama')
    return 'Ollama is not reachable at ' + OLLAMA_URL + ' with model ' + OLLAMA_MODEL +
      '. PPP will plan the session itself.';
  return 'No AI coach is available — set ANTHROPIC_API_KEY, or run Ollama with ' + OLLAMA_MODEL +
    '. PPP will plan the session itself.';
}

/* ---- Anthropic ---- */
async function planWithAnthropic(ctx) {
  const { Anthropic, zodOutputFormat, z } = sdk();
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: COACH_MODEL,
    max_tokens: 16000,
    system: COACH_SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: zodOutputFormat(coachSchema(z)) },
    messages: [{ role: 'user', content: COACH_USER(ctx) }]
  });
  if (response.stop_reason === 'refusal') {
    const e = new Error('The coach declined to answer.');
    e.code = 'refused';
    throw e;
  }
  if (!response.parsed_output) {
    const e = new Error('The coach did not return a usable plan.');
    e.code = 'unparsed';
    throw e;
  }
  return {
    plan: response.parsed_output,
    usage: response.usage ? {
      input: response.usage.input_tokens, output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens || 0
    } : null
  };
}

/* ---- Ollama ----
   Same schema, same system prompt, same validation afterwards. The only thing
   that differs is which process the tokens come out of. */
async function planWithOllama(ctx) {
  const schema = coachJsonSchema();
  if (!schema) {
    const e = new Error('zod is not installed, so the Ollama schema cannot be built.');
    e.code = 'unparsed';
    throw e;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), OLLAMA_TIMEOUT_MS);
  let r, j;
  try {
    r = await fetch(OLLAMA_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        think: false,
        format: schema,
        options: { num_ctx: 16384, temperature: 0.3 },
        messages: [
          { role: 'system', content: COACH_SYSTEM },
          { role: 'user', content: COACH_USER(ctx) }
        ]
      })
    });
    j = await r.json();
  } catch (err) {
    const e = new Error(err && err.name === 'AbortError'
      ? 'Ollama did not answer within ' + Math.round(OLLAMA_TIMEOUT_MS / 1000) + 's.'
      : 'Ollama could not be reached at ' + OLLAMA_URL + '.');
    e.code = 'provider-error';
    throw e;
  } finally { clearTimeout(timer); }

  if (!r.ok) {
    const e = new Error('Ollama returned ' + r.status + (j && j.error ? ': ' + j.error : '') + '.');
    e.code = 'provider-error';
    throw e;
  }
  let plan;
  try { plan = JSON.parse(j.message.content); } catch (e2) {
    const e = new Error('Ollama did not return a usable plan.');
    e.code = 'unparsed';
    throw e;
  }
  return {
    plan: plan,
    usage: { input: j.prompt_eval_count || 0, output: j.eval_count || 0, cacheRead: 0 }
  };
}

async function handleCoach(req, res) {
  const status = await coachStatus();
  if (!status) return send(res, 503, { ok: false, code: 'coach-unavailable', error: coachOffReason() });

  let payload;
  try {
    payload = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8'));
  } catch (e) {
    return send(res, 400, { ok: false, code: 'bad-request', error: redact(e.message) });
  }
  const ctx = payload && payload.context;
  if (!ctx || !ctx.allowed || !Array.isArray(ctx.allowed.measures))
    return send(res, 400, { ok: false, code: 'bad-context', error: 'A CoachContext with an allowed.measures list is required.' });

  const t0 = Date.now();
  try {
    const out = status.kind === 'anthropic' ? await planWithAnthropic(ctx) : await planWithOllama(ctx);
    send(res, 200, {
      ok: true, plan: out.plan,
      provider: status.name, model: status.model,
      ms: Date.now() - t0, usage: out.usage
    });
  } catch (err) {
    const httpStatus = err && err.status;
    const code = err && err.code ? err.code
      : httpStatus === 401 ? 'auth' : httpStatus === 429 ? 'rate-limit' : 'provider-error';
    send(res, code === 'refused' || code === 'unparsed' ? 422 : 502, {
      ok: false, code: code,
      error: redact(err && err.message ? err.message : 'The coach provider failed.') +
        ' PPP will plan the session itself.'
    });
  }
}

/* ============================================================================
   AUDIO TRANSCRIPTION

   A recording in, the notes a piano model hears out:

     YouTube link ─ yt-dlp ─┐
     MP3 / MP4 / … ─────────┴─ ffmpeg → 16 kHz mono WAV ─ transcribe.py → notes

   The model is Kong et al.'s high-resolution piano transcription (ByteDance,
   Apache-2.0), run by transcribe.py in the Python environment in tools/. It
   hears notes, velocities and the sustain pedal. It does not hear bars, beats,
   hands or spelling — PPP works those out in the browser, so the notes that
   come back here are the whole contract.

   A long recording takes a while, so this is a job: POST starts it, GET
   reports the stage and how far along it is, and the result is collected once.
   Uploads go straight to a private temp directory and are only ever read by
   ffmpeg, never executed. Everything a job wrote is deleted when it expires.
   ========================================================================== */

const TRANSCRIBE = {
  maxUploadBytes: 400 * 1024 * 1024,
  maxSeconds: 15 * 60,           /* longer recordings are cut here, and say so */
  jobTtlMs: 30 * 60 * 1000,
  maxJobs: 3                     /* at once — a model run is a whole CPU */
};

function firstExisting(list) {
  for (const c of list.filter(Boolean)) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}
const TOOLS_DIR = path.join(__dirname, 'tools');
const TRANSCRIBE_PY = path.join(__dirname, 'transcribe.py');
const BEAT_PY = path.join(__dirname, 'beat_track.py');
const PM2S_PY = path.join(__dirname, 'pm2s_quant.py');
const CATALOG_DIR = path.join(__dirname, 'catalog');
const PYTHON = firstExisting([
  process.env.PPP_TRANSCRIBE_PYTHON,
  path.join(TOOLS_DIR, 'transcribe-venv', 'Scripts', 'python.exe'),
  path.join(TOOLS_DIR, 'transcribe-venv', 'bin', 'python')
]);
let ScoreSearch = null;
try { ScoreSearch = require('./score-search.js'); } catch (e) { ScoreSearch = null; }
/* The checkpoint is ~172 MB; anything much smaller is a download that stopped. */
const CHECKPOINT = (() => {
  const dir = path.join(TOOLS_DIR, 'piano-transcription');
  const found = [process.env.PPP_TRANSCRIBE_CHECKPOINT];
  try { fs.readdirSync(dir).filter(f => /\.pth$/i.test(f)).forEach(f => found.push(path.join(dir, f))); } catch (e) {}
  return found.filter(Boolean).find(f => { try { return fs.statSync(f).size > 1.6e8; } catch (e) { return false; } }) || null;
})();
const ARIA_CHECKPOINT = (() => {
  const roots = [
    process.env.PPP_ARIA_AMT_CHECKPOINT,
    path.join(TOOLS_DIR, 'aria-amt'),
    path.join(TOOLS_DIR, 'models', 'aria-amt')
  ].filter(Boolean);
  for (const root of roots) {
    try {
      if (fs.statSync(root).isFile() && /\.safetensors$/i.test(root)) return root;
      const found = fs.readdirSync(root).filter(f => /\.safetensors$/i.test(f))
        .map(f => path.join(root, f)).find(f => fs.statSync(f).size > 10 * 1024 * 1024);
      if (found) return found;
    } catch (e) {}
  }
  return null;
})();

/* ffmpeg and yt-dlp may be vendored in tools/ or on PATH. Asked once, by
   running them, because a path that exists is not a program that works. */
const EXE = process.platform === 'win32' ? '.exe' : '';
function probe(cmd, argv) {
  return new Promise(resolve => {
    execFile(cmd, argv, { timeout: 15000, windowsHide: true }, err => resolve(!err));
  });
}
const TOOL = { ffmpeg: null, ytdlp: null, transkun: false, kong: false, aria: false, beatThis: false, pm2s: false };
function pyHas(mod) {
  if (!PYTHON) return Promise.resolve(false);
  return new Promise(resolve => {
    execFile(PYTHON, ['-c', 'import ' + mod], { timeout: 20000, windowsHide: true }, err => resolve(!err));
  });
}
const toolsReady = (async () => {
  for (const c of [process.env.PPP_FFMPEG, path.join(TOOLS_DIR, 'ffmpeg' + EXE), 'ffmpeg'].filter(Boolean)) {
    if (await probe(c, ['-version'])) { TOOL.ffmpeg = c; break; }
  }
  for (const c of [process.env.PPP_YTDLP, path.join(TOOLS_DIR, 'yt-dlp' + EXE), 'yt-dlp'].filter(Boolean)) {
    if (await probe(c, ['--version'])) { TOOL.ytdlp = c; break; }
  }
  if (PYTHON) {
    TOOL.transkun = await pyHas('transkun');
    TOOL.kong = await pyHas('piano_transcription_inference');
    TOOL.aria = !!ARIA_CHECKPOINT && await pyHas('amt');
    TOOL.beatThis = await pyHas('beat_this');
    TOOL.pm2s = await pyHas('pm2s');
  }
})();

function transcriberStatus() {
  const missing = [];
  if (!TOOL.ffmpeg) missing.push('ffmpeg');
  if (!PYTHON) missing.push('the Python environment in tools/transcribe-venv');
  const engines = [];
  if (TOOL.transkun) engines.push('transkun');
  if (TOOL.kong && CHECKPOINT) engines.push('kong');
  if (TOOL.aria && ARIA_CHECKPOINT) engines.push('aria-amt');
  const amt = engines.length > 1 ? 'ensemble' : (engines[0] || null);
  if (!amt) missing.push('TransKun, Aria-AMT, or the Kong piano model checkpoint in tools/piano-transcription');
  return {
    ok: !missing.length,
    youtube: !missing.length && !!TOOL.ytdlp,
    amt: amt,
    engines: engines,
    beatThis: !!TOOL.beatThis,
    pm2s: !!TOOL.pm2s,
    transkun: !!TOOL.transkun,
    kong: !!(TOOL.kong && CHECKPOINT),
    aria: !!(TOOL.aria && ARIA_CHECKPOINT),
    missing: missing.concat(TOOL.ytdlp ? [] : ['yt-dlp (for YouTube links only)'])
  };
}

function loadCatalog() {
  if (!ScoreSearch) return null;
  try { return ScoreSearch.loadCatalogSync(fs, path, CATALOG_DIR); } catch (e) { return null; }
}
function catalogHit(title) {
  const cat = loadCatalog();
  if (!cat || !title) return null;
  const hit = ScoreSearch.search(title, cat);
  if (!hit || !hit.entry || !hit.entry.xml) return null;
  return hit;
}

/* Only YouTube, and only as a link to one video. The URL is handed to yt-dlp
   after "--", so it can never be read as an option. */
function youtubeUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') return /^\/[\w-]{6,}$/.test(u.pathname) ? u.toString() : null;
  if (host !== 'youtube.com') return null;
  if (u.pathname === '/watch' && /^[\w-]{6,}$/.test(u.searchParams.get('v') || ''))
    return 'https://www.youtube.com/watch?v=' + u.searchParams.get('v');
  const m = /^\/(shorts|live|embed)\/([\w-]{6,})/.exec(u.pathname);
  return m ? 'https://www.youtube.com/watch?v=' + m[2] : null;
}

const jobs = new Map();

function newJob(kind) {
  const id = crypto.randomBytes(12).toString('hex');
  const job = {
    id, kind, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-audio-')),
    state: 'running', stage: 'queued', pct: 0,
    title: null, duration: null, truncated: false,
    error: null, code: null, result: null,
    audioPath: null, audioType: null, child: null,
    createdAt: Date.now()
  };
  jobs.set(id, job);
  return job;
}
function endJob(job) {
  if (job.child) { try { job.child.kill(); } catch (e) {} job.child = null; }
  try { fs.rmSync(job.dir, { recursive: true, force: true }); } catch (e) {}
  jobs.delete(job.id);
}
setInterval(() => {
  const now = Date.now();
  jobs.forEach(job => { if (now - job.createdAt > TRANSCRIBE.jobTtlMs) endJob(job); });
}, 60000).unref();
function running() { let n = 0; jobs.forEach(j => { if (j.state === 'running') n++; }); return n; }

function fail(job, code, message) {
  if (job.state !== 'running') return;
  job.state = 'error'; job.code = code; job.error = redact(message);
  job.child = null;
}

/* Run a tool, relay its progress, keep only the tail of what it said. */
function run(job, cmd, argv, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    let tail = '';
    const child = spawn(cmd, argv, {
      windowsHide: true, cwd: job.dir,
      env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' })
    });
    job.child = child;
    const timer = setTimeout(() => { try { child.kill(); } catch (e) {} }, opts.timeoutMs || 600000);
    const onText = chunk => {
      const s = chunk.toString('utf8');
      tail = (tail + s).slice(-6000);
      if (opts.onLine) s.split(/\r?\n|\r/).forEach(l => { if (l.trim()) opts.onLine(l.trim()); });
    };
    child.stdout.on('data', onText);
    child.stderr.on('data', onText);
    child.on('error', e => { clearTimeout(timer); resolve({ code: -1, tail: String(e.message) }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (job.child === child) job.child = null;
      resolve({ code: code == null ? -1 : code, signal: signal, tail: tail });
    });
  });
}

async function downloadYoutube(job, url) {
  job.stage = 'download';
  let info = null;
  const r = await run(job, TOOL.ytdlp, [
    '--no-playlist', '--no-progress', '--newline', '--no-warnings',
    '--js-runtimes', 'node:' + process.execPath,
    '-f', 'bestaudio[ext=m4a]/bestaudio/best',
    '--max-filesize', String(TRANSCRIBE.maxUploadBytes),
    '--match-filter', '!is_live',
    '--print', 'before_dl:PPPINFO %(.{title,duration,uploader})j',
    '--progress', '--progress-template', 'download:PPPDL %(progress._percent_str)s',
    '--no-simulate',
    '-o', path.join(job.dir, 'source.%(ext)s'),
    '--', url
  ], {
    timeoutMs: 10 * 60 * 1000,
    onLine: line => {
      if (line.indexOf('PPPINFO ') === 0) {
        try { info = JSON.parse(line.slice(8)); } catch (e) {}
        if (info) { job.title = info.title || null; job.duration = info.duration || null; }
      } else if (line.indexOf('PPPDL ') === 0) {
        const p = parseFloat(line.slice(6));
        if (isFinite(p)) job.pct = Math.min(0.99, p / 100);
      }
    }
  });
  const file = (() => {
    try { return fs.readdirSync(job.dir).filter(f => /^source\./.test(f) && !/\.part$/.test(f)).map(f => path.join(job.dir, f))[0]; }
    catch (e) { return null; }
  })();
  if (r.code !== 0 || !file) {
    const t = r.tail;
    const msg = /Private video|Sign in to confirm your age|age-restricted/i.test(t) ? 'That video is private or age-restricted, so it cannot be downloaded.'
      : /Video unavailable|This video is not available|removed/i.test(t) ? 'That video is unavailable.'
        : /is_live|live event|premieres in/i.test(t) ? 'That is a live stream. PPP can only read a finished recording.'
          : /File is larger than max-filesize/i.test(t) ? 'That recording is too large to download.'
            : /Sign in to confirm you.re not a bot|HTTP Error 429/i.test(t) ? 'YouTube refused the download for now. Try again later, or download the audio yourself and upload the file.'
              : /Unable to download|getaddrinfo|timed out|Connection/i.test(t) ? 'YouTube could not be reached.'
                : 'The audio could not be downloaded from that link.';
    throw Object.assign(new Error(msg), { code: 'download-failed' });
  }
  job.audioPath = file;
  job.audioType = /\.m4a$|\.mp4$/i.test(file) ? 'audio/mp4' : /\.webm$/i.test(file) ? 'audio/webm'
    : /\.mp3$/i.test(file) ? 'audio/mpeg' : /\.ogg|\.opus$/i.test(file) ? 'audio/ogg' : 'application/octet-stream';
  return file;
}

async function toWav(job, input) {
  job.stage = 'decode'; job.pct = 0;
  /* Keep a full-band stereo master. TransKun, Aria, beat tracking and future
     source classification get the information present in the recording;
     Kong alone receives the 16 kHz mono copy its published model expects. */
  const out = path.join(job.dir, 'audio-master.wav');
  const kong = path.join(job.dir, 'audio-kong-16k.wav');
  let total = job.duration || null;
  const r = await run(job, TOOL.ffmpeg, [
    '-hide_banner', '-nostdin', '-y', '-i', input,
    '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '44100', '-t', String(TRANSCRIBE.maxSeconds),
    '-c:a', 'pcm_s16le', '-f', 'wav', out
  ], {
    timeoutMs: 5 * 60 * 1000,
    onLine: line => {
      const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(line);
      if (d && !total) total = (+d[1]) * 3600 + (+d[2]) * 60 + (+d[3]);
      const t = /time=(\d+):(\d+):([\d.]+)/.exec(line);
      if (t && total) job.pct = Math.min(0.99, ((+t[1]) * 3600 + (+t[2]) * 60 + (+t[3])) / Math.min(total, TRANSCRIBE.maxSeconds));
    }
  });
  let bytes = 0;
  try { bytes = fs.statSync(out).size; } catch (e) {}
  if (r.code !== 0 || bytes < 16000) {
    const noAudio = /does not contain any stream|Output file #0 does not contain|matches no streams/i.test(r.tail);
    throw Object.assign(new Error(noAudio ? 'That file has no audio track.'
      : 'That file could not be decoded as audio or video.'), { code: noAudio ? 'no-audio' : 'bad-audio' });
  }
  const seconds = total || Math.max(0, (bytes - 44) / (44100 * 2 * 2));
  const kr = await run(job, TOOL.ffmpeg, [
    '-hide_banner', '-nostdin', '-y', '-i', out,
    '-vn', '-ac', '1', '-ar', '16000',
    '-c:a', 'pcm_s16le', '-f', 'wav', kong
  ], { timeoutMs: 5 * 60 * 1000 });
  let kongBytes = 0;
  try { kongBytes = fs.statSync(kong).size; } catch (e) {}
  if (kr.code !== 0 || kongBytes < 16000)
    throw Object.assign(new Error('PPP could not prepare the piano model audio.'), { code: 'bad-audio' });
  if (total && total > TRANSCRIBE.maxSeconds + 1) job.truncated = true;
  job.duration = total || seconds;
  return { wav: out, kongWav: kong, seconds: seconds };
}

async function transcribeWav(job, wav, kongWav, seconds) {
  job.stage = 'transcribe'; job.pct = 0;
  const out = path.join(job.dir, 'notes.json');
  const argv = [TRANSCRIBE_PY, '--wav', wav, '--kong-wav', kongWav, '--out', out, '--engine', 'auto'];
  if (CHECKPOINT) argv.push('--checkpoint', CHECKPOINT);
  if (ARIA_CHECKPOINT) argv.push('--aria-checkpoint', ARIA_CHECKPOINT);
  const r = await run(job, PYTHON, argv, {
    timeoutMs: Math.max(5 * 60 * 1000, seconds * 4000),
    onLine: line => {
      const m = /^PROGRESS\s+([\d.]+)/.exec(line);
      if (m) job.pct = Math.min(1, +m[1]);
    }
  });
  let result = null;
  try { result = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) {}
  if (r.code !== 0 || !result) {
    console.error('transcribe.py failed:\n' + redact(r.tail.slice(-2000)));
    throw Object.assign(new Error('The piano model failed on this recording.'), { code: 'engine-failed' });
  }
  return result;
}

async function beatTrackWav(job, wav) {
  if (!TOOL.beatThis || !fs.existsSync(BEAT_PY)) return null;
  job.stage = 'beats'; job.pct = 0;
  const out = path.join(job.dir, 'beats.json');
  const r = await run(job, PYTHON, [BEAT_PY, '--wav', wav, '--out', out], {
    timeoutMs: 8 * 60 * 1000,
    onLine: line => {
      const m = /^PROGRESS\s+([\d.]+)/.exec(line);
      if (m) job.pct = Math.min(1, +m[1]);
    }
  });
  if (r.code !== 0) {
    console.error('beat_track.py skipped:\n' + redact(r.tail.slice(-800)));
    return null;
  }
  try { return JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { return null; }
}

async function pm2sQuant(job, notesPath) {
  if (!TOOL.pm2s || !fs.existsSync(PM2S_PY)) return null;
  job.stage = 'quantize'; job.pct = 0;
  const out = path.join(job.dir, 'grid.json');
  const r = await run(job, PYTHON, [PM2S_PY, '--notes', notesPath, '--out', out], {
    timeoutMs: 10 * 60 * 1000,
    onLine: line => {
      const m = /^PROGRESS\s+([\d.]+)/.exec(line);
      if (m) job.pct = Math.min(1, +m[1]);
    }
  });
  if (r.code !== 0) {
    console.error('pm2s_quant.py skipped:\n' + redact(r.tail.slice(-800)));
    return null;
  }
  try { return JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { return null; }
}

async function runJob(job, source) {
  const t0 = Date.now();
  try {
    await toolsReady;
    const input = source.url ? await downloadYoutube(job, source.url) : source.file;
    const { wav, kongWav, seconds } = await toWav(job, input);
    if (job.state !== 'running') return;

    const hit = catalogHit(job.title);
    if (hit) {
      job.stage = 'catalog';
      const beats = await beatTrackWav(job, wav);
      const aligned = ScoreSearch.align(hit.entry.xml, {
        duration: job.duration || seconds,
        downbeats: beats && beats.downbeats,
        beats: beats && beats.beats
      });
      job.result = {
        engine: 'catalog',
        catalogId: hit.entry.id,
        license: hit.entry.license || 'CC0',
        title: hit.entry.title,
        composer: hit.entry.composer || '',
        xml: hit.entry.xml,
        duration: job.duration || seconds,
        truncated: job.truncated,
        sourceDuration: job.duration,
        beats: beats && beats.beats,
        downbeats: beats && beats.downbeats,
        barStarts: aligned.barStarts,
        retrieved: true,
        totalMs: Date.now() - t0
      };
      job.stage = 'done'; job.pct = 1; job.state = 'done';
      try { fs.rmSync(wav, { force: true }); } catch (e) {}
      try { fs.rmSync(kongWav, { force: true }); } catch (e) {}
      if (source.file) { try { fs.rmSync(source.file, { force: true }); } catch (e) {} }
      return;
    }

    const result = await transcribeWav(job, wav, kongWav, seconds);
    if (job.state !== 'running') return;
    const beats = await beatTrackWav(job, wav);
    if (beats) {
      result.beats = beats.beats;
      result.downbeats = beats.downbeats;
      result.beatEngine = beats.engine;
    }
    const notesPath = path.join(job.dir, 'notes.json');
    try { fs.writeFileSync(notesPath, JSON.stringify(result)); } catch (e) {}
    const grid = await pm2sQuant(job, notesPath);
    if (grid) result.grid = grid;
    result.title = job.title;
    result.taskMode = source.mode === 'arrange' ? 'piano-arrangement' : 'faithful-transcription';
    result.truncated = job.truncated;
    result.sourceDuration = job.duration;
    result.totalMs = Date.now() - t0;
    job.result = result;
    job.stage = 'done'; job.pct = 1; job.state = 'done';
    try { fs.rmSync(wav, { force: true }); } catch (e) {}
    try { fs.rmSync(kongWav, { force: true }); } catch (e) {}
    if (source.file) { try { fs.rmSync(source.file, { force: true }); } catch (e) {} }
  } catch (err) {
    fail(job, (err && err.code) || 'failed', (err && err.message) || 'Transcription failed.');
  }
}

/* The upload goes to disk as it arrives; a video can be hundreds of MB. */
function saveUpload(req, file, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const out = fs.createWriteStream(file);
    req.on('data', c => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('That file is larger than ' + Math.round(limit / 1048576) + ' MB.'), { code: 'too-large' }));
        req.destroy(); out.destroy();
      }
    });
    req.pipe(out);
    out.on('finish', () => resolve(size));
    out.on('error', reject);
    req.on('error', reject);
  });
}

/* A transcription downloads and burns CPU, so unlike a health check it is
   only started for a page served from this machine. The helper listens on
   127.0.0.1, but any website open in the same browser can still reach it. */
const LOCAL_ORIGIN = /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?|null)$/i;
function fromLocalPage(req) {
  const o = req.headers.origin;
  return !o || LOCAL_ORIGIN.test(o);
}

async function handleTranscribe(req, res) {
  if (!fromLocalPage(req))
    return send(res, 403, { ok: false, code: 'forbidden', error: 'Transcription is only offered to PPP pages on this machine.' });
  await toolsReady;
  const status = transcriberStatus();
  if (!status.ok)
    return send(res, 503, {
      ok: false, code: 'engine-missing',
      error: 'Audio transcription is not set up here. Missing: ' + status.missing.filter(m => !/yt-dlp/.test(m)).join(', ') + '.'
    });
  if (running() >= TRANSCRIBE.maxJobs)
    return send(res, 429, { ok: false, code: 'busy', error: 'PPP is already transcribing ' + TRANSCRIBE.maxJobs + ' recordings. Try again when one finishes.' });

  const type = String(req.headers['content-type'] || '');
  if (/application\/json/.test(type)) {
    let body;
    try { body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8')); } catch (e) {
      return send(res, 400, { ok: false, code: 'bad-request', error: 'Expected {"url": "..."}.' });
    }
    const url = youtubeUrl(body && body.url);
    if (!url) return send(res, 400, { ok: false, code: 'bad-url', error: 'That is not a link to a YouTube video.' });
    if (!status.youtube)
      return send(res, 503, { ok: false, code: 'youtube-missing', error: 'yt-dlp is not installed, so PPP cannot download from YouTube. Upload the audio file instead.' });
    const job = newJob('youtube');
    const mode = body && body.mode === 'arrange' ? 'arrange' : body && body.mode === 'solo' ? 'solo' : 'auto';
    runJob(job, { url: url, mode: mode });
    return send(res, 202, { ok: true, job: job.id });
  }

  /* the custom header makes every browser ask first (a CORS preflight), so a
     plain cross-site form post cannot start a job */
  if (!req.headers['x-ppp-filename'])
    return send(res, 400, { ok: false, code: 'bad-request', error: 'Send the file with an X-PPP-Filename header.' });
  const job = newJob('file');
  const rawName = String(req.headers['x-ppp-filename'] || 'upload');
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(rawName) || [])[1] || 'bin';
  const file = path.join(job.dir, 'upload.' + ext.toLowerCase());
  try {
    const size = await saveUpload(req, file, TRANSCRIBE.maxUploadBytes);
    if (!size) throw Object.assign(new Error('That file is empty.'), { code: 'empty' });
  } catch (e) {
    endJob(job);
    return send(res, e.code === 'too-large' ? 413 : 400, { ok: false, code: e.code || 'bad-request', error: e.message });
  }
  job.title = decodeURIComponent(rawName).replace(/\.[^.]+$/, '');
  const uploadMode = req.headers['x-ppp-mode'] === 'arrange' ? 'arrange'
    : req.headers['x-ppp-mode'] === 'solo' ? 'solo' : 'auto';
  runJob(job, { file: file, mode: uploadMode });
  return send(res, 202, { ok: true, job: job.id });
}

function jobView(job) {
  return {
    ok: job.state !== 'error', id: job.id, state: job.state, stage: job.stage,
    pct: Math.round(job.pct * 1000) / 1000, title: job.title, duration: job.duration,
    truncated: job.truncated, hasAudio: !!job.audioPath,
    code: job.code, error: job.error,
    result: job.state === 'done' ? job.result : null
  };
}

function handleJob(req, res, id, sub) {
  const job = jobs.get(id);
  if (!job) return send(res, 404, { ok: false, code: 'no-job', error: 'That transcription is not here any more.' });
  if (req.method === 'DELETE') { endJob(job); return send(res, 200, { ok: true }); }
  if (sub === 'audio') {
    if (!job.audioPath) return send(res, 404, { ok: false, error: 'no audio kept for this job' });
    let size;
    try { size = fs.statSync(job.audioPath).size; } catch (e) { return send(res, 404, { ok: false, error: 'gone' }); }
    res.writeHead(200, {
      'Content-Type': job.audioType, 'Content-Length': size,
      'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'
    });
    return fs.createReadStream(job.audioPath).pipe(res);
  }
  return send(res, 200, jobView(job));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    if (/^\/(transcribe|pdf-vector)/.test(req.url || '') && !fromLocalPage(req)) { res.writeHead(403); return res.end(); }
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-PPP-Filename, X-PPP-Mode'
    });
    return res.end();
  }

  if (req.url === '/health') {
    const coach = await coachStatus();
    await toolsReady;
    const tr = transcriberStatus();
    return send(res, 200, {
      ok: true, service: 'ppp-local', version: 4,
      audiveris: !!AUDIVERIS, audiverisPath: AUDIVERIS || null,
      pdfToMusic: !!PDFTOMUSIC,
      coach: !!coach,
      coachProvider: coach ? coach.name : null,
      coachModel: coach ? coach.model : null,
      transcriber: tr.ok, youtube: tr.youtube, transcriberMissing: tr.missing,
      amt: tr.amt || null, amtEngines: tr.engines || [],
      transkun: !!tr.transkun, kong: !!tr.kong, aria: !!tr.aria,
      beatThis: !!tr.beatThis, pm2s: !!tr.pm2s,
      limits: Object.assign({}, LIMITS, {
        audioBytes: TRANSCRIBE.maxUploadBytes, audioSeconds: TRANSCRIBE.maxSeconds
      })
    });
  }

  if (req.method === 'POST' && req.url === '/coach') return handleCoach(req, res);

  if (req.method === 'POST' && req.url === '/pdf-vector') {
    if (!fromLocalPage(req))
      return send(res, 403, { ok: false, code: 'forbidden', error: 'Vector PDF conversion is only offered to PPP pages on this machine.' });
    if (!PDFTOMUSIC)
      return send(res, 503, { ok: false, code: 'engine-missing', error: 'PDFtoMusic Pro is not installed.' });
    let bytes;
    try { bytes = await readBody(req, LIMITS.maxTotalBytes); }
    catch (e) { return send(res, 413, { ok: false, code: 'too-large', error: e.message }); }
    if (!bytes.length || bytes.subarray(0, 5).toString('ascii') !== '%PDF-')
      return send(res, 400, { ok: false, code: 'bad-pdf', error: 'That upload is not a PDF.' });
    const converted = await convertVectorPdf(bytes);
    return send(res, converted.ok ? 200 : 422, converted);
  }

  if (req.method === 'POST' && req.url === '/transcribe') return handleTranscribe(req, res);
  const jm = /^\/transcribe\/([0-9a-f]{24})(?:\/(audio))?$/.exec(req.url || '');
  if (jm && (req.method === 'GET' || req.method === 'DELETE')) return handleJob(req, res, jm[1], jm[2]);

  if (req.method !== 'POST' || req.url !== '/omr') return send(res, 404, { ok: false, error: 'not found' });

  if (!AUDIVERIS) {
    return send(res, 503, {
      ok: false, code: 'engine-missing',
      error: 'The OMR engine is not installed. PPP looked for Audiveris and did not find it.'
    });
  }

  let payload;
  try {
    payload = JSON.parse((await readBody(req, LIMITS.maxTotalBytes)).toString('utf8'));
  } catch (e) {
    return send(res, 400, { ok: false, code: 'bad-request', error: e.message });
  }

  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  if (!pages.length) return send(res, 400, { ok: false, code: 'no-pages', error: 'No page images were sent.' });
  if (pages.length > LIMITS.maxPages)
    return send(res, 413, { ok: false, code: 'too-many-pages', error: 'At most ' + LIMITS.maxPages + ' pages.' });

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-omr-'));
  const results = [];
  const t0 = Date.now();
  try {
    for (let i = 0; i < pages.length; i++) {
      const b64 = String(pages[i] || '').replace(/^data:[^,]+,/, '');
      const bytes = Buffer.from(b64, 'base64');
      if (!bytes.length) { results.push({ index: i, ok: false, error: 'Page ' + (i + 1) + ' was empty.' }); continue; }
      if (bytes.length > LIMITS.maxPageBytes) {
        results.push({ index: i, ok: false, error: 'Page ' + (i + 1) + ' exceeds the size limit.' });
        continue;
      }
      /* Only ever written as an image, never executed, inside a private temp dir. */
      const pageDir = path.join(work, 'p' + (i + 1));
      fs.mkdirSync(pageDir);
      const img = path.join(pageDir, 'page-' + (i + 1) + '.png');
      fs.writeFileSync(img, bytes);
      const r = await recognisePage(img, pageDir);
      results.push(Object.assign({ index: i }, r));
    }
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
  }

  const good = results.filter(r => r.ok);
  send(res, good.length ? 200 : 422, {
    ok: !!good.length,
    code: good.length ? null : 'recognition-failed',
    error: good.length ? null : (results[0] && results[0].error) || 'Nothing could be recognised.',
    engine: 'Audiveris',
    ms: Date.now() - t0,
    pages: results.map(r => ({ index: r.index, ok: !!r.ok, error: r.error || null, ms: r.ms || 0 })),
    /* one MusicXML document per recognised page, merged by the client */
    musicxml: results.map(r => (r.ok ? r.musicxml : null))
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('PPP OMR service on http://127.0.0.1:' + PORT);
  console.log(PDFTOMUSIC ? '  Vector PDF: PDFtoMusic Pro (' + PDFTOMUSIC + ')'
    : '  Vector PDF: optional PDFtoMusic Pro not found');
  console.log(AUDIVERIS ? '  Audiveris: ' + AUDIVERIS : '  Audiveris: NOT FOUND — /omr will report engine-missing');
  toolsReady.then(() => {
    const tr = transcriberStatus();
    console.log(tr.ok
      ? '  Transcription: on (' + (tr.amt || 'kong') + ')' + (tr.youtube ? ', YouTube links too' : ' (no yt-dlp, so files only)')
        + (tr.beatThis ? ', Beat This' : '') + (tr.pm2s ? ', PM2S' : '')
      : '  Transcription: off — missing ' + tr.missing.join(', '));
  });
  coachStatus().then(c => {
    console.log(c
      ? '  Coach: on — ' + c.name + ' (' + c.model + ')'
      : '  Coach: off — ' + coachOffReason());
    /* names only, never values */
    if (DOTENV.length) console.log('  .env: ' + DOTENV.join(', '));
  });
});
