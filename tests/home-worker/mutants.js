/* G10b-1: mutation checks of the home-PC queue and worker. A copy of the modules is made, ONE rule is broken in it, and the tests that should
   notice are run against the copy (HOME_MODULES_DIR): a mutant that survives is a rule nothing tests. The repository's own files are never touched.

     node tests/home-worker/mutants.js            run them all (the Postgres ones too when PPP_TEST_PG_URL is set, with NODE_PATH for `pg`)
     node tests/home-worker/mutants.js A4 W2      only these

   Exit code 0 when every mutant is killed (and the unmutated copy passes). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const FILES = ['home-jobs.js', 'home-result.js', 'home-jobs-store.js', 'server.js', 'share-guest.js', 'tools/home-worker/worker.js', 'review/h10/helper-heard.js'];
const JOBS = 'jobs.test.js', WORKER = 'worker.test.js', PG = 'jobs-pg.test.js';

/* id, file, what the mutant breaks, [from, to] (strings, replaced once), the test that must fail */
const M = [
  ['A1', 'home-jobs.js', 'the browser routes stop checking whose job it is', ["if (!job || job.ownerId !== user.id) throw httpError(404, 'That conversion is not there.', 'not-found');", "if (!job) throw httpError(404, 'That conversion is not there.', 'not-found');"], JOBS],
  ['A2', 'home-jobs.js', 'a worker token can finish (or beat for) any account\'s job', ["if (!job || job.ownerId !== rec.ownerId) throw httpError(404, 'That job is not there.', 'not-found');", "if (!job) throw httpError(404, 'That job is not there.', 'not-found');"], JOBS],
  ['A3', 'home-jobs.js', 'a claim hands out any account\'s queued job', ["if (j.ownerId === ownerId && j.status === 'queued' && !j.writing", "if (j.status === 'queued' && !j.writing"], JOBS],
  ['A4', 'home-jobs.js', 'the token compare ignores the secret', ['const same = want.length === got.length && crypto.timingSafeEqual(want, got);', 'const same = want.length === got.length;'], JOBS],
  ['A5', 'home-jobs.js', 'every poll writes last-seen to the database (an idle poll hits the DB)', ['if (cold) await persistSeen(rec);\n\n    let job', 'await persistSeen(rec);\n\n    let job'], JOBS],
  ['A6', 'home-jobs.js', 'the queue is read from the database on every request, not once per boot', ['if (loaded) return false;', 'if (false) return false;'], JOBS],
  ['A7', 'home-jobs.js', 'a posted result is not validated', ['const v = R.validateResult(body);', 'const v = { ok: true, result: body, bytes: 1 };'], JOBS],
  ['A8', 'home-jobs.js', 'the cross-site check is gone', ['function requireSameSite(req) {\n    if (!sameSite(req))', 'function requireSameSite(req) {\n    if (false)'], JOBS],
  ['A9', 'home-jobs.js', 'wrong tokens are never rate limited', ["if (!limiters.badTokens.take(ip)) return httpError(429, 'Too many wrong tokens from here. Try again later.', 'too-many', { retryAfter: 600 });", "if (false) return httpError(429, 'x', 'too-many', { retryAfter: 600 });"], JOBS],
  ['A10', 'home-jobs.js', 'the cap of 5 waiting jobs is gone', ['>= L.PENDING_PER_USER', '>= 999'], JOBS],
  ['A11', 'home-jobs.js', 'the wait is always the idle one (a finished or queued job does not speed the worker up)', ['function nextPollS(ownerId, t) { return isActive(ownerId, t) ? C.activePollS : C.idlePollS; }', 'function nextPollS(ownerId, t) { return C.idlePollS; }'], JOBS],
  ['A12', 'home-jobs.js', 'an idle poll long-polls', ['if (!job && !once && isActive(rec.ownerId, t0) && C.longPollMs > 0)', 'if (!job && !once && C.longPollMs > 0)'], JOBS],
  ['A13', 'home-jobs.js', 'a claimed job is never given back (no lease)', ["if (j.status === 'claimed' && t - Math.max(j.claimedAt, j.beatAt) > L.LEASE_MS) {", 'if (false) {'], JOBS],
  ['A14', 'home-jobs.js', 'the token itself (not its hash) is stored', ['hash: k.hash, label: rec.label', 'hash: k.token, label: rec.label'], JOBS],
  ['A15', 'home-jobs.js', 'a job given back is handed out again at once', ['job.notBefore = t + (C.retryDelayMs != null ? C.retryDelayMs : L.RETRY_DELAY_MS) * job.attempts;', 'job.notBefore = 0;'], JOBS],
  ['A16', 'home-jobs.js', 'finished jobs are kept 300 days, not 3', ['DONE_TTL_MS: 3 * DAY,', 'DONE_TTL_MS: 300 * DAY,'], JOBS],
  ['A17', 'home-jobs.js', 'CORS is opened', ["Object.assign({ 'Cache-Control': 'no-store' }, headers));\n\n  /* ====", "Object.assign({ 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }, headers));\n\n  /* ===="], JOBS],
  ['A18', 'home-jobs.js', 'the same link asked twice is two jobs', ['const dup = mine.find(j => pending(j) && j.url === parsed.url);', 'const dup = null;'], JOBS],
  ['A19', 'home-jobs.js', 'a revoked token keeps working until the next boot', ['    tokens.delete(id);\n    try {\n      if (!(await store.revokeToken', '    try {\n      if (!(await store.revokeToken'], JOBS],
  ['A20', 'home-jobs.js', 'a result is taken for a job that is already done or cancelled (all three guards: the state list, the re-check after the body, the WHERE of the store)', [
    ["const { rec, job } = await workerJob(req, id, ['claimed', 'queued']);\n    const body = await readJson(req, L.RESULT_BODY", "const { rec, job } = await workerJob(req, id, ['claimed', 'queued', 'done', 'cancelled', 'failed']);\n    const body = await readJson(req, L.RESULT_BODY"],
    ["if (job.status !== 'claimed' && job.status !== 'queued') throw httpError(409, job.status === 'cancelled' ? 'That job was cancelled.' : 'That job is not waiting for this any more.', job.status === 'cancelled' ? 'cancelled' : 'not-open', { status: job.status });\n    const t = now();\n    const was = { status: job.status, finishedAt", "const t = now();\n    const was = { status: job.status, finishedAt"],
    ['home-jobs-store.js', "if (!j || (j.status !== 'claimed' && j.status !== 'queued')) return false;\n      Object.assign(j, { status: status, finishedAt: t,", "if (!j) return false;\n      Object.assign(j, { status: status, finishedAt: t,"]], JOBS],
  ['A21', 'home-jobs.js', 'a result body may be any size', ['RESULT_BODY: R.LIMITS.RESULT_MAX_BYTES + 1024 * 1024,', 'RESULT_BODY: 100 * 1024 * 1024,'], JOBS],
  ['A22', 'home-jobs.js', 'enqueueing is not rate limited', ['if (!limiters.enqueue.take(user.id)) throw', 'if (false) throw'], JOBS],
  ['A23', 'home-jobs.js', 'a revoked/never-seen token is not "not alive"', ["const alive = seen > 0 && t - seen <= Math.max(2 * pollS, 120) * 1000 + 30000;", "const alive = seen > 0;"], JOBS],
  ['B1', 'home-result.js', 'a note may be any pitch', ['if (!isInt(n.midi) || n.midi < 21 || n.midi > 108)', 'if (!isInt(n.midi))'], JOBS],
  ['B2', 'home-result.js', 'a note may be past 15 minutes (both of its guards: the note, and the duration)', [["if (n.off > ceiling) return bad(", "if (false) return bad("], ["if (duration > ceiling) return bad(", "if (false) return bad("]], JOBS],
  ['B3', 'home-result.js', 'any number of notes', ['if (list.length > L.MAX_NOTES)', 'if (false)'], JOBS],
  ['B4', 'home-result.js', 'markup and bidi/line-separator characters are kept in a title or an error line', ["replace(/[\\u0000-\\u001f\\u007f<>\\u061c\\u200e\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]/g, ' ')", "replace(/[\\u0000-\\u001f\\u007f]/g, ' ')"], JOBS],
  ['B5', 'home-result.js', 'a note keeps whatever else the worker wrote on it', ['notes[i] = { on: on, off: off, midi: n.midi, vel: vel };', 'notes[i] = Object.assign({}, n, { on: on, off: off, vel: vel });'], JOBS],
  ['B6', 'home-result.js', 'the stored size is not capped', ['if (bytes > L.RESULT_MAX_BYTES)', 'if (false)'], JOBS],
  ['B7', 'home-result.js', 'the unknown keys of a result (pedals, beats) are kept', ["const result = { v: 1, notes: notes, duration: duration, engine: engine, model: model, device: device, ensemble: ensemble };", "const result = Object.assign({}, body, { v: 1, notes: notes, duration: duration, engine: engine, model: model, device: device, ensemble: ensemble });"], JOBS],
  ['C1', 'home-jobs-store.js', 'Postgres: a claim ignores the owner', ["WHERE id = $1 AND owner_id = $2 AND status = 'queued'\",\n        [id, ownerId, workerId", "WHERE id = $1 AND $2::text IS NOT NULL AND status = 'queued'\",\n        [id, ownerId, workerId"], PG],
  ['C2', 'home-jobs-store.js', 'Postgres: a finished job can be finished again', ["WHERE id = $1 AND owner_id = $2 AND status IN ('claimed', 'queued')\",\n        [id, ownerId, status", "WHERE id = $1 AND owner_id = $2\",\n        [id, ownerId, status"], PG],
  ['C3', 'home-jobs-store.js', 'Postgres: the notes of any account\'s job can be read', ["WHERE id = $1 AND owner_id = $2 AND status = 'done'\", [id, ownerId]", "WHERE id = $1 AND $2::text IS NOT NULL AND status = 'done'\", [id, ownerId]"], PG],
  ['W1', 'tools/home-worker/worker.js', 'the log shows the token', ['const redact = s => {\n    let t = String(s);', 'const redact = s => {\n    return String(s);\n    let t = String(s);'], WORKER],
  ['W2', 'tools/home-worker/worker.js', 'a rejected token is not fatal', ["if (r.status === 401) throw Object.assign(new Error('token'), { fatalToken: true });\n    if (r.status === 200 && r.body) return", "if (r.status === 200 && r.body) return"], WORKER],
  ['W3', 'tools/home-worker/worker.js', 'notes past 15 minutes are sent', ['const notes = h.notes.filter(n => n.on < cut).map(', 'const notes = h.notes.map('], WORKER],
  ['W4', 'tools/home-worker/worker.js', 'a cancel on the site does not stop the models', ["{ ctl.cancelled = true; killTree(ctl.child); }", "{ ctl.cancelled = true; }"], WORKER],
  ['W5', 'tools/home-worker/worker.js', 'the scratch folder is left behind', ['if (!cfg.keepScratch) {', 'if (false) {'], WORKER],
  ['W6', 'tools/home-worker/worker.js', 'the token may be sent over plain http to another host', ['&& !cfg.allowInsecure) out.push(', '&& false) out.push('], WORKER],
  ['W7', 'tools/home-worker/worker.js', 'a setting can shorten the site\'s idle wait', ['if (cfg.idlePollSeconds > w) w = cfg.idlePollSeconds;', 'w = cfg.idlePollSeconds || w;'], WORKER],
  ['W8', 'tools/home-worker/worker.js', 'the worker runs whatever link the site sends (not only a YouTube video)', ["if (!job || typeof job.id !== 'string' || !YT_RE.test(String(job.url || ''))) {", "if (!job || typeof job.id !== 'string') {"], WORKER],
  /* the review of PR 178 (G10b-1 review fixes) */
  ['N1', 'tools/home-worker/worker.js', 'the loop waits a fixed time after an answer that is not a 200 (no growth)', ['const w = Math.min(base * Math.pow(2, Math.min(count - 1, 30)), cap);', 'const w = base;'], WORKER],
  ['N2', 'tools/home-worker/worker.js', 'a site that answers 404/405/410 (the queue is gone) is asked as often as any failure', ['if (status === 404 || status === 405 || status === 410 || status === 501) return Math.min(DAY_S, Math.max(3600, idleKnown));', 'if (false) return 0;'], WORKER],
  ['N3', 'home-jobs.js', 'the idle wait may be set below 900 s', ['else if (n < LIMITS.IDLE_POLL_FLOOR_S) {', 'else if (false) {'], JOBS],
  ['N4', 'home-jobs.js', 'the default idle wait is 20 minutes again', ['IDLE_POLL_DEFAULT_S: 3600,', 'IDLE_POLL_DEFAULT_S: 1200,'], JOBS],
  ['N5', 'tools/home-worker/worker.js', 'a redirect to another origin is followed', ['if (u.origin !== origin0) return fail(', 'if (false) return fail('], WORKER],
  ['N6', 'home-jobs.js', 'a valid token is refused while wrong tokens from its address are being counted', ['if (!t) throw badToken(req);', "if (!t || !limiters.badTokens.peek(deps.clientIp(req) || 'unknown')) throw badToken(req);"], JOBS],
  ['N7', 'home-jobs.js', 'a refused body keeps its slot of the hourly enqueue budget', ['} catch (e) { release(); throw e; }\n    const t = now();\n    await sweep(t);', '} catch (e) { throw e; }\n    const t = now();\n    await sweep(t);'], JOBS],
  ['N8', 'home-jobs.js', 'the hourly enqueue limit is not per address', ['if (!limiters.enqueueIp.take(ip)) {', 'if (false) {'], JOBS],
  ['N9', 'home-jobs.js', 'a result that would pass the account\'s share is not given room (the oldest finished conversion is not cleared)', ['await evict(rec.ownerId, v.bytes, 0);', ''], JOBS],
  ['N10', 'home-jobs.js', 'a new job does not ask for room among the account\'s own rows and notes (no eviction at enqueue)', ['try { await evict(user.id, C.resultReserveBytes, 1); } catch (e) { release(); throw e; }', ''], JOBS],
  ['N11', 'tools/home-worker/worker.js', 'old scratch folders are never swept', ['if (st.isDirectory() && Date.now() - st.mtimeMs > (maxAgeMs == null ? 2 * 3600 * 1000 : maxAgeMs)) {', 'if (false) {'], WORKER],
  ['N12', 'tools/home-worker/worker.js', 'a video id may be 6 characters or more (in the worker)', ['[A-Za-z0-9_-]{11}$/;', '[A-Za-z0-9_-]{6,}$/;'], WORKER],
  ['N13', 'tools/home-worker/worker.js', 'ffmpeg may open any protocol (no -protocol_whitelist)', [["'-y', '-protocol_whitelist', 'file,pipe', '-i', input,", "'-y', '-i', input,"], ["'-y', '-protocol_whitelist', 'file,pipe', '-i', master,", "'-y', '-i', master,"]], WORKER],
  ['N14', 'tools/home-worker/worker.js', 'escape sequences and bidi characters reach the log', ["const log = m => out('[' + clock() + '] ' + redact(clean(m)));", "const log = m => out('[' + clock() + '] ' + redact(m));"], WORKER],
  ['N15', 'home-jobs-store.js', 'Postgres: the migration takes no advisory lock (two instances can race)', ["await c.query('SELECT pg_advisory_xact_lock($1)', [MIGRATE_LOCK_KEY]);", ''], PG],
  ['R7', 'home-result.js', 'a result\'s notes are stored in the order they arrive', ['notes.sort((a, b) => a.on - b.on || a.midi - b.midi || a.off - b.off);', ''], JOBS],
  ['R11', 'home-jobs.js', 'the account is read from the database on every browser request', ['until: t + L.USER_CACHE_MS', 'until: t'], JOBS],
  ['R12', 'home-jobs.js', 'a timer reads the queue from the database every 10 minutes', ['const stats = { loads: 0 };', 'const stats = { loads: 0 };\n  setInterval(() => { store.loadAll().catch(() => {}); }, 600000).unref();'], JOBS],
  ['R14', 'home-jobs.js', 'a heartbeat writes the last-seen time to the database', ['job.beatAt = t;\n    const pct =', 'job.beatAt = t; await persistSeen(rec);\n    const pct ='], JOBS],
  ['R17', 'tools/home-worker/worker.js', 'the worker runs any https link the site sends', ['const YT_RE = /^https:\\/\\/www\\.youtube\\.com\\/watch\\?v=[A-Za-z0-9_-]{11}$/;', 'const YT_RE = /^https:\\/\\/.*$/;'], WORKER],
  ['R18', 'tools/home-worker/worker.js', 'the downloaded audio is not size capped (neither by its announced length nor while it streams)', [["if (n > maxBytes && !over) {", "if (false) {"], ["if (+res.headers['content-length'] > maxBytes) {", "if (false) {"]], WORKER],
  ['R19', 'tools/home-worker/worker.js', 'a bearer header goes to the audio endpoint', ["'Accept': 'audio/*,*/*' } }, res => {", "'Accept': 'audio/*,*/*', 'Authorization': 'Bearer leak' } }, res => {"], WORKER],
  ['R20', 'tools/home-worker/worker.js', 'the link is handed to yt-dlp without -- before it', ["'-o', path.join(dir, 'source.%(ext)s'), '--', job.url]", "'-o', path.join(dir, 'source.%(ext)s'), job.url]"], WORKER],
  /* the delta review of d1f83a8 (G10b-1 final round) */
  ['N16', 'home-jobs.js', 'a check (/api/worker/ping) makes the PC look alive for hours', ['if (rec.lastSeenAt === 0) { touch(rec, t, 0); await persistSeen(rec); }', 'touch(rec, t, C.idlePollS);'], JOBS],
  ['N17', 'home-jobs.js', 'a waiting or converting conversion can be removed (no cancel first)', ['if (pending(job) || job.writing) throw httpError(409,', 'if (false) throw httpError(409,'], JOBS],
  ['N18', 'home-jobs.js', 'for room among the rows a done conversion goes before a failed one', ['.sort((a, b) => ((a.status === \'done\') - (b.status === \'done\')) || byAge(a, b))', '.sort(byAge)'], JOBS],
  ['N19', 'home-jobs.js', 'for room among the notes the NEWEST finished conversion goes first', ["old.filter(j => j.status === 'done').sort(byAge).forEach(j => {", "old.filter(j => j.status === 'done').sort((a, b) => byAge(b, a)).forEach(j => {"], JOBS],
  ['N20', 'home-jobs.js', 'DELETE /api/jobs/:id does not exist', ["if (m === 'DELETE') return deleteJob(req, res, g[1]);", ''], JOBS],
  ['N21', 'tools/home-worker/worker.js', 'a Retry-After or nextPollSeconds of 99999999 or 1e10 is not cut to a day (the timer fires at once)', ['return Number.isFinite(n) && n >= 0 ? Math.min(n, DAY_S) : dflt;', 'return Number.isFinite(n) && n >= 0 ? n : dflt;'], WORKER],
  ['N22', 'tools/home-worker/worker.js', 'the sleep itself accepts any number (a day at most, an hour for NaN)', ['ms = Number.isFinite(ms) && ms >= 0 ? Math.min(ms, DAY_S * 1000) : 3600 * 1000;', 'ms = ms;'], WORKER],
  ['N23', 'tools/home-worker/worker.js', 'failureWait trusts its count (NaN, 2000)', ['count = Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1;', 'count = count;'], WORKER],
  ['N24', 'tools/home-worker/worker.js', 'an answer of the site is read to the end whatever its size', ['if (n > 8 * 1024 * 1024) {', 'if (false) {'], WORKER],
  ['N25', 'tools/home-worker/worker.js', 'a refused audio answer is only resumed (an endless body is read for ever), not dropped', ["const drop = () => { res.on('error', () => {}); req.destroy(); };", 'const drop = () => { res.resume(); };'], WORKER],
  ['N26', 'tools/home-worker/worker.js', 'the log hides the token BEFORE it strips escape sequences (a split token is not joined first)', ["const log = m => out('[' + clock() + '] ' + redact(clean(m)));", "const log = m => out('[' + clock() + '] ' + clean(redact(m)));"], WORKER],
  ['N27', 'tools/home-worker/worker.js', 'the same origin is compared as text (startsWith), not as parsed', ['if (u.origin !== origin0) return fail(', 'if (!u.href.startsWith(origin0)) return fail('], WORKER],
  ['N28', 'home-jobs.js', 'a refused request gives its hourly slots back TWICE', ['const release = () => { limiters.enqueue.release(user.id); limiters.enqueueIp.release(ip); };', 'const release = () => { limiters.enqueue.release(user.id); limiters.enqueueIp.release(ip); limiters.enqueue.release(user.id); limiters.enqueueIp.release(ip); };'], JOBS],
  ['N29', 'home-jobs.js', 'making tokens is not limited per address', ['if (!limiters.tokensIp.take(ip)) {', 'if (false) {'], JOBS],
  ['N30', 'home-jobs.js', 'a job that could not be written keeps its slots', ['try { await store.insertJob(job); } catch (e) { jobs.delete(job.id); release(); throw e; }', 'try { await store.insertJob(job); } catch (e) { jobs.delete(job.id); throw e; }'], JOBS],
  ['N31', 'server.js', 'the boot SQL runs through a plain query, not the locked migration', ['await homeJobsStore.migrate(getPool(), `', 'await q(`'], JOBS],
  ['N32', 'home-jobs-store.js', 'Postgres: the boot SQL is left out of the locked migration', ['if (preSql) await c.query(preSql);', ''], PG]
];

const only = process.argv.slice(2);
const runPg = !!process.env.PPP_TEST_PG_URL;

function copyTree(dst) {
  FILES.forEach(f => {
    const to = path.join(dst, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(REPO, f), to);
  });
}
function run(dir, test) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(REPO, 'tests', 'home-worker', test)], { cwd: REPO, env: Object.assign({}, process.env, { HOME_MODULES_DIR: dir }) });
    let out = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    const t = setTimeout(() => child.kill(), 240000);
    child.on('close', code => { clearTimeout(t); resolve({ code: code, out: out }); });
  });
}
const firstFail = out => {
  const lines = out.split(/\r?\n/);
  return (lines.find(l => /^\s+✗/.test(l)) || lines.find(l => /Error|Cannot|failed/.test(l)) || lines.filter(Boolean).slice(-1)[0] || '').trim().slice(0, 130);
};

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-mut-'));
  const results = [];
  try {
    /* the unmutated copy must pass, or a "killed" means nothing */
    const clean = path.join(base, 'clean'); copyTree(clean);
    const tests = [JOBS, WORKER].concat(runPg ? [PG] : []);
    for (const t of tests) {
      const r = await run(clean, t);
      if (r.code !== 0) { console.error('The unmutated copy fails ' + t + ':\n' + r.out.slice(-1500)); process.exit(2); }
      console.log('clean copy passes ' + t);
    }
    const todo = M.filter(m => (!only.length || only.indexOf(m[0]) >= 0) && (m[4] !== PG || runPg));
    const skipped = M.filter(m => m[4] === PG && !runPg).map(m => m[0]);
    const work = async m => {
      const dir = path.join(base, m[0]); copyTree(dir);
      /* one replacement [from, to] in the mutant's file, or several: [from, to] or [file, from, to] each */
      const pairs = Array.isArray(m[3][0]) ? m[3] : [m[3]];
      let bad = null;
      pairs.forEach(pr => {
        const file = pr.length === 3 ? pr[0] : m[1], from = pr[pr.length - 2], to = pr[pr.length - 1];
        const f = path.join(dir, file);
        const src = fs.readFileSync(f, 'utf8').split('\r\n').join('\n');
        const at = src.indexOf(from);
        if (at < 0 || src.indexOf(from, at + 1) >= 0) { bad = 'BAD MUTANT (pattern ' + (at < 0 ? 'not found' : 'not unique') + ': ' + from.slice(0, 50).split('\n').join(' ') + ')'; return; }
        fs.writeFileSync(f, src.slice(0, at) + to + src.slice(at + from.length));
      });
      if (bad) { results.push({ id: m[0], what: m[2], status: bad }); return; }
      const r = await run(dir, m[4]);
      results.push({ id: m[0], what: m[2], test: m[4], status: r.code !== 0 ? 'killed' : 'SURVIVED', by: r.code !== 0 ? firstFail(r.out) : '' });
    };
    /* the Postgres ones share a database: one at a time; the others in fours */
    const par = todo.filter(m => m[4] !== PG), seq = todo.filter(m => m[4] === PG);
    for (let i = 0; i < par.length; i += 4) await Promise.all(par.slice(i, i + 4).map(work));
    for (const m of seq) await work(m);
    results.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    console.log('');
    results.forEach(r => console.log((r.status === 'killed' ? '  killed   ' : '  ' + r.status.padEnd(9)) + ' ' + r.id.padEnd(4) + ' ' + r.what + (r.by ? '\n              by: ' + r.by : '')));
    if (skipped.length) console.log('\n  not run (no PPP_TEST_PG_URL): ' + skipped.join(' '));
    const bad = results.filter(r => r.status !== 'killed');
    console.log('\n' + (results.length - bad.length) + ' of ' + results.length + ' mutants killed' + (bad.length ? '; ' + bad.length + ' NOT: ' + bad.map(b => b.id).join(' ') : ''));
    process.exitCode = bad.length ? 1 : 0;
  } finally { try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { /* temp */ } }
})();
