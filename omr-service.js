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

   Also hosts the AI coach (/coach), so the Anthropic key stays server-side.

   OMR needs no dependencies; the coach needs @anthropic-ai/sdk and zod, and is
   simply off without them. Binds to 127.0.0.1 only.
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

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
  '  "Your left hand is at 56% in measures 21-24" is useful; "keep it up" is not.'
].join('\n');

const COACH_USER = ctx => 'Plan the next practice session from these measurements.\n\n' +
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (req.url === '/health') {
    const coach = await coachStatus();
    return send(res, 200, {
      ok: true, service: 'ppp-local', version: 3,
      audiveris: !!AUDIVERIS, audiverisPath: AUDIVERIS || null,
      coach: !!coach,
      coachProvider: coach ? coach.name : null,
      coachModel: coach ? coach.model : null,
      limits: LIMITS
    });
  }

  if (req.method === 'POST' && req.url === '/coach') return handleCoach(req, res);

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
  console.log(AUDIVERIS ? '  Audiveris: ' + AUDIVERIS : '  Audiveris: NOT FOUND — /omr will report engine-missing');
  coachStatus().then(c => {
    console.log(c
      ? '  Coach: on — ' + c.name + ' (' + c.model + ')'
      : '  Coach: off — ' + coachOffReason());
    /* names only, never values */
    if (DOTENV.length) console.log('  .env: ' + DOTENV.join(', '));
  });
});
