/* G10b-1 / G10b-2: mutation checks of the home-PC queue (with PC links, no account) and worker. A copy of the modules is made, ONE rule is broken in it, and the tests that should
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
/* (catalog/shared-seeds.json: the server.js copy is run for real by the Postgres test, and its seed library is read from beside it) */
const PAGE = 'Piano Coach App.dc.html';
const FILES = [PAGE, 'home-jobs.js', 'home-result.js', 'home-jobs-store.js', 'server.js', 'share-guest.js', 'tools/home-worker/worker.js', 'review/h10/helper-heard.js', 'catalog/shared-seeds.json'];
const JOBS = 'jobs.test.js', WORKER = 'worker.test.js', PG = 'jobs-pg.test.js', LINKS = 'links.test.js', SERVER = 'server.test.js', PAIRW = 'pair.test.js', PAIRPAGE = 'pairing.test.js';

/* id, file, what the mutant breaks, [from, to] (strings, replaced once), the test that must fail */
const M = [
  ['A1', 'home-jobs.js', 'the browser routes stop checking whose job it is', ["if (!job || job.ownerId !== link.id) throw httpError(404, 'That conversion is not there.', 'not-found');", "if (!job) throw httpError(404, 'That conversion is not there.', 'not-found');"], JOBS],
  ['A2', 'home-jobs.js', 'a worker token can finish (or beat for) any account\'s job', ["if (!job || job.ownerId !== rec.ownerId) throw httpError(404, 'That job is not there.', 'not-found');", "if (!job) throw httpError(404, 'That job is not there.', 'not-found');"], JOBS],
  ['A3', 'home-jobs.js', 'a claim hands out any account\'s queued job', ["if (j.ownerId === ownerId && j.status === 'queued' && !j.writing", "if (j.status === 'queued' && !j.writing"], JOBS],
  ['A4', 'home-jobs.js', 'the token compare ignores the secret', ['const got = sha256(t.token);\n    const same = want.length === got.length && crypto.timingSafeEqual(want, got);', 'const got = sha256(t.token);\n    const same = want.length === got.length;'], JOBS],
  ['A5', 'home-jobs.js', 'every poll writes last-seen to the database (an idle poll hits the DB)', ['if (cold) await persistSeen(rec);\n\n    let job', 'await persistSeen(rec);\n\n    let job'], JOBS],
  ['A6', 'home-jobs.js', 'the queue is read from the database on every request, not once per boot', ['if (loaded) return false;', 'if (false) return false;'], JOBS],
  ['A7', 'home-jobs.js', 'a posted result is not validated', ['const v = R.validateResult(body);', 'const v = { ok: true, result: body, bytes: 1 };'], JOBS],
  ['A8', 'home-jobs.js', 'the cross-site check is gone', ['function requireSameSite(req) {\n    if (!sameSite(req))', 'function requireSameSite(req) {\n    if (false)'], JOBS],
  ['A9', 'home-jobs.js', 'wrong secrets (tokens and codes) are never rate limited', ["if (!limiters.badTokens.take(ip)) return httpError(429,", "if (false) return httpError(429,"], JOBS],
  ['A10', 'home-jobs.js', 'the cap of 5 waiting jobs is gone', ['>= L.PENDING_PER_USER', '>= 999'], JOBS],
  ['A11', 'home-jobs.js', 'the wait is always the idle one (a finished or queued job does not speed the worker up)', ['function nextPollS(ownerId, t) { return isActive(ownerId, t) ? C.activePollS : C.idlePollS; }', 'function nextPollS(ownerId, t) { return C.idlePollS; }'], JOBS],
  ['A12', 'home-jobs.js', 'an idle poll long-polls', ['if (!job && !once && isActive(rec.ownerId, t0) && C.longPollMs > 0)', 'if (!job && !once && C.longPollMs > 0)'], JOBS],
  ['A13', 'home-jobs.js', 'a claimed job is never given back (no lease)', ["if (j.status === 'claimed' && t - Math.max(j.claimedAt, j.beatAt) > L.LEASE_MS) {", 'if (false) {'], JOBS],
  ['A14', 'home-jobs.js', 'the token itself (not its hash) is stored', ['{ id: rec.id, hash: k.hash, label: rec.label }); }', '{ id: rec.id, hash: k.token, label: rec.label }); }'], JOBS],
  ['A15', 'home-jobs.js', 'a job given back is handed out again at once', ['job.notBefore = t + (C.retryDelayMs != null ? C.retryDelayMs : L.RETRY_DELAY_MS) * job.attempts;', 'job.notBefore = 0;'], JOBS],
  ['A16', 'home-jobs.js', 'finished jobs are kept 300 days, not 3', ['DONE_TTL_MS: 3 * DAY,', 'DONE_TTL_MS: 300 * DAY,'], JOBS],
  ['A17', 'home-jobs.js', 'CORS is opened', ["Object.assign({ 'Cache-Control': 'no-store' }, headers));\n\n  /* ====", "Object.assign({ 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }, headers));\n\n  /* ===="], JOBS],
  ['A18', 'home-jobs.js', 'the same link asked twice is two jobs', ['const dup = mine.find(j => pending(j) && j.url === parsed.url);', 'const dup = null;'], JOBS],
  ['A19', 'home-jobs.js', 'a revoked link\'s token keeps working (both guards: the token is not dropped from memory, and a token is no longer asked what its link says)', [['    ownTokens.forEach(k => tokens.delete(k.id));\n', ''], ['if (!link || link.revokedAt || link.writing) throw badToken(req);', 'if (!link) throw badToken(req);']], LINKS],
  ['A20', 'home-jobs.js', 'a result is taken for a job that is already done or cancelled (all three guards: the state list, the re-check after the body, the WHERE of the store)', [
    ["const { rec, link, job } = await workerJob(req, id, ['claimed', 'queued']);\n    const body = await readJson(req, L.RESULT_BODY", "const { rec, link, job } = await workerJob(req, id, ['claimed', 'queued', 'done', 'cancelled', 'failed']);\n    const body = await readJson(req, L.RESULT_BODY"],
    ["if (job.status !== 'claimed' && job.status !== 'queued') throw httpError(409, job.status === 'cancelled' ? 'That job was cancelled.' : 'That job is not waiting for this any more.', job.status === 'cancelled' ? 'cancelled' : 'not-open', { status: job.status });\n    const t = now();\n    const was = { status: job.status, finishedAt", "const t = now();\n    const was = { status: job.status, finishedAt"],
    ['home-jobs-store.js', "if (!j || (j.status !== 'claimed' && j.status !== 'queued')) return false;\n      Object.assign(j, { status: status, finishedAt: t,", "if (!j) return false;\n      Object.assign(j, { status: status, finishedAt: t,"]], JOBS],
  ['A21', 'home-jobs.js', 'a result body may be any size', ['RESULT_BODY: R.LIMITS.RESULT_MAX_BYTES + 1024 * 1024,', 'RESULT_BODY: 100 * 1024 * 1024,'], JOBS],
  ['A22', 'home-jobs.js', 'enqueueing is not rate limited', ['if (!limiters.enqueue.take(link.id)) throw', 'if (false) throw'], JOBS],
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
  ['N10', 'home-jobs.js', 'a new job does not ask for room among the account\'s own rows and notes (no eviction at enqueue)', ['try { await evict(link.id, C.resultReserveBytes, 1, job); } catch (e) { giveUp(e); }', ''], JOBS],
  ['N11', 'tools/home-worker/worker.js', 'old scratch folders are never swept', ['if (st.isDirectory() && Date.now() - st.mtimeMs > (maxAgeMs == null ? 2 * 3600 * 1000 : maxAgeMs)) {', 'if (false) {'], WORKER],
  ['N12', 'tools/home-worker/worker.js', 'a video id may be 6 characters or more (in the worker)', ['[A-Za-z0-9_-]{11}$/;', '[A-Za-z0-9_-]{6,}$/;'], WORKER],
  ['N13', 'tools/home-worker/worker.js', 'ffmpeg may open any protocol (no -protocol_whitelist)', [["'-y', '-protocol_whitelist', 'file,pipe', '-i', input,", "'-y', '-i', input,"], ["'-y', '-protocol_whitelist', 'file,pipe', '-i', master,", "'-y', '-i', master,"]], WORKER],
  ['N14', 'tools/home-worker/worker.js', 'escape sequences and bidi characters reach the log', ['return hidden !== f ? hidden : redact(clean(raw));', 'return hidden !== f ? hidden : redact(raw);'], WORKER],
  ['N15', 'home-jobs-store.js', 'Postgres: the migration takes no advisory lock (two instances can race)', ["await c.query('SELECT pg_advisory_xact_lock($1)', [MIGRATE_LOCK_KEY]);", ''], PG],
  ['R7', 'home-result.js', 'a result\'s notes are stored in the order they arrive', ['notes.sort((a, b) => a.on - b.on || a.midi - b.midi || a.off - b.off);', ''], JOBS],
  ['R11', 'home-jobs.js', 'a link\'s last use is written to the database on every page request (no 6-hour throttle)', ['if (!link || link.revokedAt || t - link.persistedAt < L.LINK_TOUCH_MS) return;', 'if (!link || link.revokedAt) return;'], JOBS],
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
  ['N26', 'tools/home-worker/worker.js', 'the log hides the token BEFORE it strips escape sequences (a split token is not joined first)', ['return hidden !== f ? hidden : redact(clean(raw));', 'return hidden !== f ? hidden : clean(redact(raw));'], WORKER],
  ['N27', 'tools/home-worker/worker.js', 'the same origin is compared as text (startsWith), not as parsed', ['if (u.origin !== origin0) return fail(', 'if (!u.href.startsWith(origin0)) return fail('], WORKER],
  ['N28', 'home-jobs.js', 'a refused request gives its hourly slots back TWICE', ['const release = () => { limiters.enqueue.release(link.id); limiters.enqueueIp.release(ip); };', 'const release = () => { limiters.enqueue.release(link.id); limiters.enqueueIp.release(ip); limiters.enqueue.release(link.id); limiters.enqueueIp.release(ip); };'], JOBS],
  ['N29', 'home-jobs.js', 'making tokens is not limited per address', ['if (!limiters.tokensIp.take(ip)) {', 'if (false) {'], JOBS],
  ['N30', 'home-jobs.js', 'a job that could not be written keeps its hourly slots', ['const giveUp = e => { jobs.delete(job.id); job.settle(false); release(); throw e; };', 'const giveUp = e => { jobs.delete(job.id); job.settle(false); throw e; };'], JOBS],
  ['N31', 'server.js', 'the boot SQL runs through a plain query, not the locked migration', ['await homeJobsStore.migrate(getPool(), `', 'await q(`'], JOBS],
  ['N32', 'home-jobs-store.js', 'Postgres: the boot SQL is left out of the locked migration', ['if (preSql) await c.query(preSql);', ''], PG],
  /* the follow-up of PR 178 (the third review's minors: the queue is optional at the boot, the caps are atomic, the test gaps) */
  ['N33', 'home-jobs.js', 'eviction may take a queued or claimed job (the review\'s MB)', ['const old = mine.filter(j => !pending(j) && !j.writing);', 'const old = mine.filter(j => !j.writing);'], JOBS],
  ['N34', 'tools/home-worker/worker.js', 'the 8 MB cut also applies to the audio download (the review\'s MD)', ['const maxBytes = (o.maxMB || 120) * 1024 * 1024;', 'const maxBytes = Math.min((o.maxMB || 120) * 1024 * 1024, 8 * 1024 * 1024);'], WORKER],
  ['N35', 'tools/home-worker/worker.js', 'the log looks at the token only in the text cleaned of whole escape sequences (an ESC that swallows a letter of the token hides nothing)', ['return hidden !== f ? hidden : redact(clean(raw));', 'return redact(clean(raw));'], WORKER],
  ['N36', 'tools/home-worker/worker.js', 'the zero-width space, non-joiner and joiner are kept in a log line', ['\\u180e\\u200b-\\u200f\\u2028', '\\u180e\\u200e\\u200f\\u2028'], WORKER],
  ['N37', 'tools/home-worker/worker.js', 'the word joiner and the byte order mark are kept in a log line', ['\\u2060-\\u2064\\u2066-\\u2069\\ufeff]', '\\u2064\\u2066-\\u2069]'], WORKER],
  ['N38', 'home-jobs.js', 'the slot of a new job is taken only after room has been cleared (the old order: two requests pass the same caps while the database is awaited)', [
    ['    jobs.set(job.id, job);\n    const giveUp = e =>', '    const giveUp = e =>'],
    ['try { await evict(link.id, C.resultReserveBytes, 1, job); } catch (e) { giveUp(e); }\n', 'try { await evict(link.id, C.resultReserveBytes, 1, job); } catch (e) { giveUp(e); }\n    jobs.set(job.id, job);\n']], JOBS],
  ['N39', 'home-jobs.js', 'the same link asked at the same moment is told "it exists" without waiting for the first request\'s write (a job that may never be kept)', ['if (dup.writing && dup.settled && !(await dup.settled))', 'if (false)'], JOBS],
  ['N40', 'home-jobs.js', 'a job that could not be written leaves its reserved slot in the queue', ['const giveUp = e => { jobs.delete(job.id); job.settle(false);', 'const giveUp = e => { job.settle(false);'], JOBS],
  ['N41', 'home-jobs-store.js', 'file store: deleteJobs ignores the owner', ['ids.indexOf(j.id) >= 0 && j.ownerId === ownerId && j.status', 'ids.indexOf(j.id) >= 0 && j.status'], JOBS],
  ['N42', 'home-jobs-store.js', 'file store: deleteJobs removes a queued or claimed row', ["j.ownerId === ownerId && j.status !== 'queued' && j.status !== 'claimed'", 'j.ownerId === ownerId'], JOBS],
  ['N43', 'home-jobs-store.js', 'Postgres: deleteJobs ignores the owner', ["AND owner_id = $2 AND status NOT IN ('queued', 'claimed')\", [ids, ownerId]", "AND $2::text IS NOT NULL AND status NOT IN ('queued', 'claimed')\", [ids, ownerId]"], PG],
  ['N44', 'home-jobs-store.js', 'Postgres: deleteJobs removes a queued or claimed row', ["AND owner_id = $2 AND status NOT IN ('queued', 'claimed')\", [ids, ownerId]", 'AND owner_id = $2", [ids, ownerId]'], PG],
  ['N45', 'home-jobs.js', 'a queue that is switched off still answers (disable() does nothing)', ['if (disabledWhy) return deps.send(', 'if (false) return deps.send('], JOBS],
  ['N46', 'home-jobs-store.js', 'Postgres: a failure making the queue\'s tables is fatal again (the migration throws it)', ['queue = { queue: false, error: queueError };', 'throw queueError;'], PG],
  ['N47', 'home-jobs-store.js', 'Postgres: the queue\'s tables are made outside a savepoint', ["await c.query('SAVEPOINT home_queue_tables');", ''], PG],
  ['N48', 'server.js', 'the server does not switch the queue off when its tables could not be made', ['jobsService.disable(why);', ''], PG],
  ['N49', 'home-jobs.js', 'a job asking for room is counted among the rows it clears room for (one row too many cleared)', ['const mine = ownJobs(ownerId).filter(j => j !== except);', 'const mine = ownJobs(ownerId);'], JOBS],
  /* G10b-2: the PC link (no account) */
  ['L1', 'home-jobs.js', 'a client code is taken for a link without comparing the full hash (a record found by the id alone: only the id\'s 22 hex are the secret)', ['const same = want.length === got.length && crypto.timingSafeEqual(want, got);\n    return same && rec && !rec.revokedAt', 'const same = true;\n    return same && rec && !rec.revokedAt'], LINKS],
  ['L2', 'home-jobs.js', 'the client code is stored in the clear, not as its hash', ["hash: made.hash.toString('hex'), createdAt: t, ipTag: tag", "hash: made.code, createdAt: t, ipTag: tag"], LINKS],
  ['L3', 'home-jobs.js', 'header trust: X-PPP-PC is taken from a request that came from another site (the browser routes do not check the Origin)', ['  async function requireLink(req) {\n    requireSameSite(req);', '  async function requireLink(req) {'], JOBS],
  ['L4', 'home-jobs.js', 'header trust: a link can be made from a page of another site (no Origin check on POST /api/pc-links)', ['  async function createLink(req, res) {\n    requireSameSite(req);', '  async function createLink(req, res) {'], JOBS],
  ['L5', 'home-jobs.js', 'making links is not limited per address (neither the hour nor the day)', ['if (hour < L.LINKS_PER_IP_PER_HOUR && day < L.LINKS_PER_IP_PER_DAY) return 0;', 'return 0;'], LINKS],
  ['L6', 'home-jobs.js', 'the day limit on making links is gone (only 5 an hour)', ['if (hour < L.LINKS_PER_IP_PER_HOUR && day < L.LINKS_PER_IP_PER_DAY) return 0;', 'if (hour < L.LINKS_PER_IP_PER_HOUR) return 0;'], LINKS],
  ['L7', 'home-jobs.js', 'an IPv6 address is not folded to its /48 (a network has billions of addresses)', ["return g[0] + ':' + g[1] + ':' + g[2] + '::/48';", "return s;"], JOBS],
  ['L8', 'home-jobs.js', 'the site holds any number of links (no cap)', ['if (live >= L.MAX_LINKS && !(victim = evictableLink(t))) throw', 'if (false) throw'], LINKS],
  ['L9', 'home-jobs.js', 'the cap counts revoked links too (removing a link gives no place back)', ['links.forEach(l => { if (!l.revokedAt) live++; });', 'links.forEach(l => { live++; });'], LINKS],
  ['L10', 'home-jobs.js', 'a revoked link does not count for the per-address limits (making and removing links gets round them)', ['      if (l.ipTag !== tag) return;\n      if (t - l.createdAt < HOUR)', '      if (l.ipTag !== tag || l.revokedAt) return;\n      if (t - l.createdAt < HOUR)'], LINKS],
  ['L11', 'home-jobs.js', 'a link whose PC never connected is never purged for that (only the 60 days)', ['if (!heard && t - used > L.LINK_NEVER_CONNECTED_TTL_MS) {', 'if (false) {'], LINKS],
  ['L12', 'home-jobs.js', 'a link nobody uses for 60 days is never purged', ['if (t - Math.max(used, heard) > L.LINK_UNUSED_TTL_MS) return true;', 'if (false) return true;'], LINKS],
  ['L13', 'home-jobs.js', 'a never-connected link is purged even when it holds a job', ['for (const j of jobs.values()) if (j.ownerId === l.id) return false; return true; }', 'return true; }'], LINKS],
  ['L14', 'home-jobs.js', 'a revoked link is purged at once, not kept two days', ['return t - l.revokedAt > L.LINK_REVOKED_KEEP_MS;', 'return true;'], LINKS],
  ['L15', 'home-jobs.js', 'a purged link leaves its token in memory', ['tokens.forEach((k, id) => { if (gone.has(k.ownerId)) tokens.delete(id); });', ''], LINKS],
  ['L16', 'home-jobs.js', 'a new token does not replace the old one (both work)', ['old.forEach(x => tokens.delete(x.id));\n    tokens.set(rec.id, rec);', 'tokens.set(rec.id, rec);'], LINKS],
  ['L17', 'home-jobs.js', 'a new token forgets that the PC has been heard of (the page loses its button)', ['lastSeenAt: inherit.lastSeenAt, pollS: inherit.pollS }', 'lastSeenAt: 0, pollS: 0 }'], LINKS],
  ['L18', 'home-jobs.js', 'removing a link leaves its conversions in memory', ['    ownJobsList.forEach(j => jobs.delete(j.id));\n', ''], LINKS],
  ['L19', 'home-jobs.js', 'removing a link leaves its code working', ['    link.revokedAt = t;\n    ownTokens.forEach', '    ownTokens.forEach'], LINKS],
  ['L20', 'home-jobs.js', 'the notes one creating address may keep are not bounded', ['if (link.ipTag && addressBytes(link.ipTag) + v.bytes > C.perAddressResultBytes) throw', 'if (false) throw'], LINKS],
  ['L21', 'home-jobs.js', 'a token or a job of an account (PR 178) is taken for a PC link\'s (the owner is not asked to be a live link)', [
    ['      if (!live(j.ownerId)) return;\n      jobs.set', '      jobs.set'], ['      if (k.revokedAt || !live(k.ownerId)) return;', '      if (k.revokedAt) return;'], ['if (!link || link.revokedAt || link.writing) throw badToken(req);', 'if (false) throw badToken(req);'],
    ['    return { rec: rec, link: link, cold: cold };', '    return { rec: rec, link: link || { ipTag: \'\' }, cold: cold };']], LINKS],
  ['L22', 'home-jobs.js', 'a valid code is refused while wrong codes from its address are being counted', ['    await ensureLoaded();\n    const link = verifyCode(raw);', "    if (!limiters.badTokens.peek(deps.clientIp(req) || 'unknown')) throw badSecret(req, 'code');\n    await ensureLoaded();\n    const link = verifyCode(raw);"], LINKS],
  ['L23', 'home-jobs.js', 'the queue reads another header than X-PPP-PC (the guest key\'s)', ["const PC_HEADER = 'x-ppp-pc';", "const PC_HEADER = 'x-ppp-guest';"], LINKS],
  ['L24', 'home-jobs.js', 'the hash of a client code is not domain-separated (a guest key or any 64-hex secret hashes the same)', ["const codeHash = code => sha256('ppp-pc-link-v1:' + code);", "const codeHash = code => sha256(code);"], JOBS],
  ['L25', 'home-jobs.js', 'the creating address is stored as it is (not a keyed hash)', ["const tagOf = ip => crypto.createHmac('sha256', ipKey).update(addrKey(ip)).digest('hex').slice(0, 16);", "const tagOf = ip => addrKey(ip);"], LINKS],
  ['L26', 'home-jobs.js', 'POST /api/pc-links reads no body (no size, JSON or depth limit)', ['    await readJson(req, L.SMALL_BODY);\n    await ensureLoaded();\n    const t = now();\n    await purgeIfDue(t);', '    await ensureLoaded();\n    const t = now();\n    await purgeIfDue(t);'], LINKS],
  ['L27', 'home-jobs.js', 'the slot of a new link is taken only after the database was written (twelve requests at the same moment pass the limits together)', [
    ['    links.set(link.id, link); tokens.set(rec.id, rec);\n    try { await store.createLink(', '    try { await store.createLink('],
    ['    link.writing = false;\n    /* the database lets go of the old link only now', '    links.set(link.id, link); tokens.set(rec.id, rec); link.writing = false;\n    /* the database lets go of the old link only now']], LINKS],
  ['L28', 'home-jobs.js', 'a page request writes the link\'s last use only at the first request, never again (the keeping time would purge a link in use)', ['    link.lastUsedAt = t;\n    await persistLink(link, t);', '    await persistLink(link, t);'], LINKS],
  ['L29', 'home-jobs.js', 'a revoked link\'s code still works for reading (neither verifyCode nor currentLink, which asks again after a wait, looks at the revoked mark)', [['return same && rec && !rec.revokedAt && !rec.writing ? rec : null;', 'return same && rec && !rec.writing ? rec : null;'], ['return cur && !cur.revokedAt && cur.hash.equals(link.hash) ? cur : null;', 'return cur && cur.hash.equals(link.hash) ? cur : null;']], LINKS],
  ['L30', 'home-jobs-store.js', 'file store: revoking a link leaves its conversions in the file', ['      d.jobs = d.jobs.filter(j => !own(j));\n      d.tokens = d.tokens.filter(k => !own(k));\n      const l = d.links.find(x => x.id === id && !x.revokedAt);', '      d.tokens = d.tokens.filter(k => !own(k));\n      const l = d.links.find(x => x.id === id && !x.revokedAt);'], LINKS],
  ['L31', 'server.js', 'the hash of the creating address is not keyed by the server\'s secret (a fresh random key at every start: the per-address limits forget at a restart)', ['clientIp: guestShare.clientIp, ipSecret: SECRET, logError: logStoreError,', 'clientIp: guestShare.clientIp, logError: logStoreError,'], PG],
  ['L32', 'home-jobs.js', 'a link removed while a conversion is being written for it keeps the row that was just written (and the page is told 201)', ["    if (!currentLink(link)) { const gone = links.get(link.id); try { await store.revokeLink(link.id, (gone && gone.revokedAt) || now()); } catch (e) { logError(e); } giveUp(httpError(401, 'That PC link is not valid.', 'bad-code')); }\n", ''], LINKS],
  ['L33', 'home-jobs.js', 'a failed write of a link\'s last use is tried again by every request while the database is down', ['link.persistedAt = Math.max(was, t - L.LINK_TOUCH_MS + 60 * 1000);', 'link.persistedAt = was;'], JOBS],
  ['L34', 'home-jobs.js', 'the rows of the links of one address are not bounded (a few addresses could fill the site\'s rows with cancelled conversions)', ["if (link.ipTag && addressRows(link.ipTag) > L.ROWS_PER_ADDRESS) giveUp(", "if (false) giveUp("], LINKS],
  ['L35', 'home-jobs.js', 'a PC that waited for work (long-poll) is handed the next job even if its token was replaced or its link removed meanwhile', ["      if (!alive(rec)) throw httpError(401, 'That token is not valid.', 'bad-token');\n      job = nextQueued(rec.ownerId);", "      job = nextQueued(rec.ownerId);"], LINKS],
  ['L36', 'home-jobs.js', 'a result is taken from a token that was replaced (or a link removed) while its body was read and room cleared', ["    if (!alive(rec)) throw httpError(401, 'That token is not valid.', 'bad-token');\n    if (job.status !== 'claimed' && job.status !== 'queued')", "    if (job.status !== 'claimed' && job.status !== 'queued')"], LINKS],
  ['L37', 'home-jobs.js', 'a link that ran out in the purge its own request triggered still gets its conversion written', ["    const cur = currentLink(link);\n    if (!cur) { release(); throw httpError(401, 'That PC link is not valid.', 'bad-code'); }\n    link = cur;\n", ""], LINKS],
  ['L38', 'home-jobs.js', 'a link that is being made is lost when the queue is read again', ["    making.forEach(l => { if (!links.has(l.id)) links.set(l.id, l); });\n    makingTokens.forEach(k => { if (!tokens.has(k.id)) tokens.set(k.id, k); });\n", ""], LINKS],
  ['L39', 'home-jobs.js', 'a failed replacement of the token puts back the old token even when a second replacement has happened since', ["const undoRotation = () => { if (tokens.get(rec.id) === rec) { tokens.delete(rec.id); old.forEach(x => tokens.set(x.id, x)); } };", "const undoRotation = () => { tokens.delete(rec.id); old.forEach(x => tokens.set(x.id, x)); };"], LINKS],
  ['L40', 'home-jobs.js', 'the new token of a replacement does not let go a PC that is waiting with the old one', ["    wake(link.id);\n    reply(res, 201, { workerToken: k.token,", "    reply(res, 201, { workerToken: k.token,"], LINKS],
  ['L41', 'home-jobs.js', 'the hourly enqueue and new-token limits use the raw address (an IPv6 network has billions)', ["const ip = addrKey(deps.clientIp(req) || 'unknown');\n    /* the two hourly budgets are taken now", "const ip = deps.clientIp(req) || 'unknown';\n    /* the two hourly budgets are taken now"], LINKS],
  /* the fixes of the independent security review of PR 181 */
  ['L42', 'home-jobs.js', 'an IPv6 address is folded to its /56 only (one /48 can then send 256 "addresses" and make 500 links in an hour)', ["return g[0] + ':' + g[1] + ':' + g[2] + '::/48';", "return g[0] + ':' + g[1] + ':' + g[2] + ':' + g[3].slice(0, 2) + '00::/56';"], LINKS],
  ['L43', 'home-jobs.js', 'the wrong-secret limiter is keyed by the whole address string (an IPv6 network has a budget per address, not per network)', ["    const ip = addrKey(deps.clientIp(req) || 'unknown');\n    if (!limiters.badTokens.take(ip))", "    const ip = deps.clientIp(req) || 'unknown';\n    if (!limiters.badTokens.take(ip))"], LINKS],
  ['L44', 'home-jobs.js', 'at the cap of live links the site is 503 even when a link nobody would miss could make room (the review: cheap links lock it out until day 14)', ["if (live >= L.MAX_LINKS && !(victim = evictableLink(t))) throw", "if (live >= L.MAX_LINKS) throw"], LINKS],
  ['L45', 'home-jobs.js', 'a link whose PC connected can be given up to make room', ["if (l.revokedAt || l.writing || owners.has(l.id) || Math.max(l.lastWorkerAt || 0, seen.get(l.id) || 0)) return;", "if (l.revokedAt || l.writing || owners.has(l.id)) return;"], LINKS],
  ['L46', 'home-jobs.js', 'a link that holds a conversion can be given up to make room', ["if (l.revokedAt || l.writing || owners.has(l.id) || Math.max(", "if (l.revokedAt || l.writing || Math.max("], LINKS],
  ['L47', 'home-jobs.js', 'a link used a minute ago can be given up to make room (a person who has just made one is still setting up their PC)', ["      if (t - used < L.LINK_EVICT_MIN_IDLE_MS) return;\n", ""], LINKS],
  ['L48', 'home-jobs.js', 'the link used most recently is given up first, not the one unused the longest', ["if (!best || used < bestAt) { best = l; bestAt = used; }", "if (!best || used > bestAt) { best = l; bestAt = used; }"], LINKS],
  ['L49', 'home-jobs.js', 'the link made first is given up first, whatever the page has used since', ["const used = Math.max(l.createdAt, l.lastUsedAt);\n      if (t - used < L.LINK_EVICT_MIN_IDLE_MS)", "const used = l.createdAt;\n      if (t - used < L.LINK_EVICT_MIN_IDLE_MS)"], LINKS],
  ['L50', 'home-jobs.js', 'there is no limit on the links the whole site makes in an hour (25 cheap addresses make 125)', ["if (siteWait) throw", "if (false) throw"], LINKS],
  ['L51', 'home-jobs.js', 'a removed link does not count for the site\'s hour (making and removing is a way round it)', ["links.forEach(l => { if (t - l.createdAt < HOUR) { n++;", "links.forEach(l => { if (!l.revokedAt && t - l.createdAt < HOUR) { n++;"], LINKS],
  ['L52', 'home-jobs.js', 'a new link that could not be written still costs the old link that was to make room', ["      if (victim) { links.set(victim.id, victim); victimTokens.forEach(x => tokens.set(x.id, x)); }\n", ""], LINKS],
  ['L53', 'home-jobs.js', 'the rows of the link that made room stay in the database (a boot reads them back, and the cap is over again)', ["try { await store.deleteLinks([victim.id]); } catch (e) { logError(e); } ", ""], LINKS],
  ['L54', 'home-jobs.js', 'the link that makes room leaves memory only after the database was written (requests at the same moment all pick the same one)', ["    if (victim) forgetLinks([victim.id]);\n    links.set(link.id, link); tokens.set(rec.id, rec);", "    links.set(link.id, link); tokens.set(rec.id, rec);"], LINKS],
  ['L55', 'home-jobs.js', 'a link given up comes back in memory when the queue is read again meanwhile (it is not forgotten a second time)', [" catch (e) { logError(e); } forgetLinks([victim.id]); }", " catch (e) { logError(e); } }"], LINKS],
  ['L56', 'home-jobs.js', 'opening a finished conversion is not limited per link (a loop reads 0.9 MB from the database each time)', ["if (!limiters.reads.take(link.id)) throw", "if (false) throw"], LINKS],
  ['L57', 'home-jobs.js', 'opening a finished conversion is not limited per address (each free link has a budget of its own)', ["if (!limiters.readsIp.take(ip)) {", "if (false) {"], LINKS],
  ['L58', 'home-jobs.js', 'a read refused for its address keeps the link\'s own slot', ["{ limiters.reads.release(link.id); throw httpError(429, 'Too many conversions were opened", "{ throw httpError(429, 'Too many conversions were opened"], LINKS],
  ['L59', 'home-jobs.js', 'the notes are read from the database BEFORE the budget is taken (a refused read still costs the database its egress)', [
    ["if (!limiters.reads.take(link.id)) throw httpError(429, 'Too many conversions were opened just now. Try again later.', 'too-many', { retryAfter: 600 });", ""],
    ["const result = await store.getResult(job.id, link.id);", "const result = await store.getResult(job.id, link.id);\n      if (!limiters.reads.take(link.id)) throw httpError(429, 'x', 'too-many', { retryAfter: 600 });"]], LINKS],
  ['L60', 'home-jobs.js', 'the per-address read limit uses the raw address (an IPv6 network has billions)', ["const ip = addrKey(deps.clientIp(req) || 'unknown');\n      if (!limiters.reads.take(link.id))", "const ip = deps.clientIp(req) || 'unknown';\n      if (!limiters.reads.take(link.id))"], LINKS],
  ['L61', 'home-jobs.js', 'the read limits run on the real clock, not the service\'s (nothing frees them under a test clock, and a clock that is injected is not obeyed)', ["reads: guestShare.slidingWindow(L.RESULT_READS_PER_HOUR, HOUR, now),", "reads: guestShare.slidingWindow(L.RESULT_READS_PER_HOUR, HOUR),"], LINKS],
  ['L62', 'home-jobs.js', 'a conversion asked for while the queue is read again is told its link is not valid (the link is compared to the one in the queue by identity, and the read made every record a new object)', ["    const cur = currentLink(link);\n    if (!cur) { release(); throw httpError(401, 'That PC link is not valid.', 'bad-code'); }\n    link = cur;\n", "    if (links.get(link.id) !== link || link.revokedAt) { release(); throw httpError(401, 'That PC link is not valid.', 'bad-code'); }\n"], LINKS],
  ['L63', 'home-jobs.js', 'a request that waited for the write of the link\'s last use goes on with the record it found before (a link removed after a re-read is removed on an object nobody looks at)', ["    const cur = currentLink(link);\n    if (!cur) throw httpError(401, 'That PC link is not valid.', 'bad-code');\n    if (cur.lastUsedAt < t) cur.lastUsedAt = t;\n    return cur;", "    return link;"], LINKS],
  ['L64', 'home-jobs.js', 'a link removed after a re-read, while a conversion is being written for it, is not noticed (the record of before is asked, not the one in the queue)', ["    if (!currentLink(link)) { const gone", "    if (link.revokedAt) { const gone"], LINKS],
  ['L65', 'home-jobs.js', 'a link that was purged or removed while a conversion was being written for it is not noticed afterwards (the row stays in the database)', ["    if (!currentLink(link)) { const gone", "    if (false) { const gone"], LINKS],
  ['L66', 'home-jobs.js', 'a link whose PC never connected is purged 14 days after it was MADE, whatever the page has done with it since (a person who uses the page every day before the PC is set up loses it)', ["if (!heard && t - used > L.LINK_NEVER_CONNECTED_TTL_MS) {", "if (!heard && t - l.createdAt > L.LINK_NEVER_CONNECTED_TTL_MS) {"], LINKS],
  ['L67', 'home-jobs.js', 'the page\'s use of a link is written to the database at every request (no 6-hour throttle) - the keeping time counted from the last use must not cost a write per request', ["if (!link || link.revokedAt || t - link.persistedAt < L.LINK_TOUCH_MS) return;", "if (!link || link.revokedAt) return;"], LINKS],
  ['C4', 'home-jobs-store.js', 'Postgres: a new worker token is made for a link that is not live (or that does not exist)', [" + ' WHERE EXISTS (SELECT 1 FROM ppp_pc_links WHERE id = $2 AND revoked_at IS NULL)',", " + '',"], PG],
  ['C5', 'home-jobs-store.js', 'Postgres: removing a link deletes the jobs of every link (the owner is not in the WHERE)', ["\"WITH j AS (DELETE FROM ppp_transcribe_jobs WHERE owner_id = $1 AND left(owner_id, 3) = 'pc_'),\"\n        + \" k AS (DELETE FROM ppp_worker_tokens WHERE owner_id = $1 AND left(owner_id, 3) = 'pc_')\"\n        + ' UPDATE ppp_pc_links SET revoked_at = $2", "\"WITH j AS (DELETE FROM ppp_transcribe_jobs WHERE $1::text IS NOT NULL AND left(owner_id, 3) = 'pc_'),\"\n        + \" k AS (DELETE FROM ppp_worker_tokens WHERE owner_id = $1 AND left(owner_id, 3) = 'pc_')\"\n        + ' UPDATE ppp_pc_links SET revoked_at = $2"], PG],
  ['C6', 'home-jobs-store.js', 'Postgres: deleting links also deletes rows whose owner is not a PC link (an account\'s rows of PR 178)', ["\"WITH j AS (DELETE FROM ppp_transcribe_jobs WHERE owner_id = ANY($1::text[]) AND left(owner_id, 3) = 'pc_'),\"", "\"WITH j AS (DELETE FROM ppp_transcribe_jobs WHERE owner_id = ANY($1::text[])),\""], PG],
  ['C7', 'home-jobs-store.js', 'the migration drops the foreign key of the jobs table only (not the token table\'s)', ["FOREACH t IN ARRAY ARRAY['ppp_transcribe_jobs', 'ppp_worker_tokens'] LOOP", "FOREACH t IN ARRAY ARRAY['ppp_transcribe_jobs'] LOOP"], PG],
  ['C8', 'home-jobs-store.js', 'the migration drops every foreign key of the two tables, not only the one on owner_id', ["AND a.attname = 'owner_id' LOOP", "LOOP"], PG],
  ['C9', 'home-jobs-store.js', 'a fresh database is made WITH the foreign key to ppp_users (the new code keeps the account dependency)', ["    id TEXT PRIMARY KEY,\n    owner_id TEXT NOT NULL,\n    kind TEXT NOT NULL DEFAULT 'youtube',", "    id TEXT PRIMARY KEY,\n    owner_id TEXT NOT NULL REFERENCES ppp_users(id) ON DELETE CASCADE,\n    kind TEXT NOT NULL DEFAULT 'youtube',"], PG],
  ['C10', 'home-jobs-store.js', 'Postgres: touching a link writes to a revoked one too', ["UPDATE ppp_pc_links SET last_used_at = $2, last_worker_at = $3 WHERE id = $1 AND revoked_at IS NULL", "UPDATE ppp_pc_links SET last_used_at = $2, last_worker_at = $3 WHERE id = $1"], PG],
  ['C11', 'home-jobs-store.js', 'Postgres: the boot read leaves revoked links out (they would not count for the per-address limits after a restart)', ["'SELECT ' + LINK_COLS + ' FROM ppp_pc_links;'", "'SELECT ' + LINK_COLS + ' FROM ppp_pc_links WHERE revoked_at IS NULL;'"], PG],
  ['C12', 'home-jobs-store.js', 'Postgres: a link and its first token are made in two statements (a link can exist without its token)', ["'WITH l AS (INSERT INTO ppp_pc_links (id, client_hash, created_at, last_used_at, created_ip_hash) VALUES ($1, $2, $3, $3, $4))'\n        + ' INSERT INTO ppp_worker_tokens (id, owner_id, token_hash, label, created_at, poll_s) VALUES ($5, $1, $6, $7, $3, 0)',", "'INSERT INTO ppp_worker_tokens (id, owner_id, token_hash, label, created_at, poll_s) VALUES ($5, $1, $6, $7, $3, 0); INSERT INTO ppp_pc_links (id, client_hash, created_at, last_used_at, created_ip_hash) VALUES ($1, $2, $3, $3, $4)',"], PG],
  /* G10b-3: the pairing link. P* break the page (tests/home-worker/pairing.test.js, served from the copy of "Piano Coach App.dc.html"), Q* the worker's --pair (pair.test.js) */
  ['P1', PAGE, 'the fragment is taken off the address bar only when the page has loaded, not before its first script and request', ["try { history.replaceState(history.state, '', location.href.replace(/#.*$/, '')); } catch (e) { /* the address stays as it is; the pairing goes on */ }", "window.addEventListener('load', function () { try { history.replaceState(history.state, '', location.href.replace(/#.*$/, '')); } catch (e) { /* later */ } });"], PAIRPAGE],
  ['P2', PAGE, 'the fragment is never taken off the address bar', ["try { history.replaceState(history.state, '', location.href.replace(/#.*$/, '')); } catch (e) { /* the address stays as it is; the pairing goes on */ }", ''], PAIRPAGE],
  ['P3', PAGE, 'the fragment is "removed" with location.hash = \'\' (a history entry, and a # left in the address)', ["try { history.replaceState(history.state, '', location.href.replace(/#.*$/, '')); } catch (e) { /* the address stays as it is; the pairing goes on */ }", "try { location.hash = ''; } catch (e) { /* x */ }"], PAIRPAGE],
  ['P4', PAGE, 'the query string is lost when the fragment goes', ["location.href.replace(/#.*$/, '')); } catch (e) { /* the address stays", "location.pathname); } catch (e) { /* the address stays"], PAIRPAGE],
  ['P5', PAGE, 'anything after "#pc=" is taken for a code (the 64-hex shape is not checked)', ["pending = /^[0-9a-f]{64}$/.test(c) ? { code: c } : { bad: true };", "pending = c ? { code: c } : { bad: true };"], PAIRPAGE],
  ['P6', PAGE, 'any fragment is taken, not only "#pc="', ["if (h.slice(0, 4) !== '#pc=') return;", "if (!h) return;"], PAIRPAGE],
  ['P7', PAGE, 'capitals, spaces and dashes in the link are not forgiven', ["c = c.replace(/[\\s-]+/g, '').toLowerCase();\n    try { history", "try { history"], PAIRPAGE],
  ['P8', PAGE, 'a %20 in the link is not decoded', ["try { c = decodeURIComponent(c); } catch (e) { /* as it is */ }", ""], PAIRPAGE],
  ['P9', PAGE, 'a link typed into the address bar of an open tab (hashchange) is not looked at', ["window.addEventListener('hashchange', look);", ""], PAIRPAGE],
  ['P10', PAGE, 'the code is not checked with the site before it is kept (the check is skipped)', ["try { await this.homeApi('/api/worker/status', { code: code }); }", "try { await Promise.resolve(); }"], PAIRPAGE],
  ['P11', PAGE, 'the code is kept BEFORE the site has said it is a link', ["const seq = this._pairSeq = (this._pairSeq || 0) + 1;", "const seq = this._pairSeq = (this._pairSeq || 0) + 1; PcLink.set(code);"], PAIRPAGE],
  ['P12', PAGE, 'the code is written to the console', ["const code = p.code, old = PcLink.get();", "const code = p.code, old = PcLink.get(); console.log('pairing with ' + code);"], PAIRPAGE],
  ['P13', PAGE, 'the code is put in the URL of the check (a query string)', ["try { await this.homeApi('/api/worker/status', { code: code }); }", "try { await this.homeApi('/api/worker/status?pc=' + code, { code: code }); }"], PAIRPAGE],
  ['P14', PAGE, 'a device that is switched to another link is not told that the old one was replaced', ["this.pairNote(old && old !== code ? tx(", "this.pairNote(false ? tx("], PAIRPAGE],
  ['P15', PAGE, 'a browser that cannot keep the connection is not noticed before the site is asked (the code is sent although there is nothing to keep it in)', ["if (!PcLink.supported()) return this.pairNote(", "if (false) return this.pairNote("], PAIRPAGE],
  ['P16', PAGE, 'a fragment that is "#pc=" followed by something that is not a code is dropped with no word', ["if (!p.code) return this.pairNote(", "if (!p.code) return void ("], PAIRPAGE],
  ['P17', PAGE, 'the link the card copies is not the pairing link', ["+ '/#pc=' + c : ''; }", "+ '/#code=' + c : ''; }"], PAIRPAGE],
  ['P18', PAGE, 'a clipboard that refuses is not followed by the select-and-copy fallback', ["try { navigator.clipboard.writeText(text).then(done, byHand); } catch (e) { byHand(); }", "try { navigator.clipboard.writeText(text).then(done, () => {}); } catch (e) { /* nothing */ }"], PAIRPAGE],
  ['P19', PAGE, 'the link is always shown on the card (a secret on the screen)', ["homePairManual: !!(linked && S.homePairManual)", "homePairManual: !!linked"], PAIRPAGE],
  ['P20', PAGE, '"More" is open from the start (the card shows every button again)', ["homeMoreOpen: !!S.homeMore", "homeMoreOpen: true"], PAIRPAGE],
  ['P21', PAGE, 'a whole pairing link pasted into the paste form is not understood', ["const i = t.indexOf('#pc='); if (i >= 0) { t = t.slice(i + 4);", "const i = -1; if (i >= 0) { t = t.slice(i + 4);"], PAIRPAGE],
  ['P22', PAGE, 'the sign-in gate stands in the way of a pairing link', ["|| !!(window.PPP_PAIR && window.PPP_PAIR.has()); } catch", "; } catch"], PAIRPAGE],
  ['P23', PAGE, 'the same link again says "replaced" (a new link and the old one are not told apart)', ["this.pairNote(old && old !== code ? tx(", "this.pairNote(old ? tx("], PAIRPAGE],
  ['P24', PAGE, 'a site that cannot be reached is reported as "the code does not match"', ["return this.pairNote(e.status === 401 ? tx(", "return this.pairNote(true ? tx("], PAIRPAGE],
  ['Q1', 'tools/home-worker/worker.js', 'the log shows the client code (a bare code in a line)', ["if (cfg && cfg.clientCode) t = t.split(cfg.clientCode).join('***');", ''], PAIRW],
  ['Q2', 'tools/home-worker/worker.js', 'the log shows a pairing link it was not told about', [".replace(/#pc=[0-9a-fA-F]{64}/g, '#pc=***')", ''], PAIRW],
  ['Q3', 'tools/home-worker/worker.js', 'the link goes to the clipboard tool on its command line, not on its standard input', ["await runPiped(spawnFn, tools.copy[0], tools.copy[1], link);", "await runPiped(spawnFn, tools.copy[0], tools.copy[1].concat([link]), null);"], PAIRW],
  ['Q4', 'tools/home-worker/worker.js', 'the tools are started through a shell', ["shell: false,", "shell: true,"], PAIRW],
  ['Q5', 'tools/home-worker/worker.js', 'the link is printed on the console without --show', ["\n  if (deps.show) out(link);\n  if (copied.ok && opened.ok)", "\n  out(link);\n  if (copied.ok && opened.ok)"], PAIRW],
  ['Q6', 'tools/home-worker/worker.js', 'the success line carries the link (and the log\'s two guards are gone)', [["if (cfg && cfg.clientCode) t = t.split(cfg.clientCode).join('***');", ''], [".replace(/#pc=[0-9a-fA-F]{64}/g, '#pc=***')", ''], ["The link for your phone is copied: paste it in a message to yourself and open it on the phone.'); return 0; }", "The link for your phone is copied: ' + link); return 0; }"]], PAIRW],
  ['Q7', 'tools/home-worker/worker.js', 'a pc-code.txt that holds something that is not a code is taken as the code', ["return code ? { code: code, from: file } : { code: '', problem: 'bad-file', file: file };", "return { code: code || text.trim(), from: file };"], PAIRW],
  ['Q8', 'tools/home-worker/worker.js', 'the link is not checked before it is given to a program (a site address with shell characters reaches the tools)', ["if (!/^https?:\\/\\/[A-Za-z0-9.\\-_:[\\]]+(\\/[A-Za-z0-9._~\\-/]*)?\\/#pc=[0-9a-f]{64}$/.test(link)) {", "if (false) {"], PAIRW],
  ['Q9', 'tools/home-worker/worker.js', 'the site address of the settings is not checked by --pair', ["const bad = siteProblems(cfg);\n  if (bad.length) { bad.forEach(", "const bad = [];\n  if (bad.length) { bad.forEach("], PAIRW],
  ['Q10', 'tools/home-worker/worker.js', 'the browser gets the handler and the link joined in ONE string', ["opened = await runPiped(spawnFn, tools.open[0], tools.open[1].concat([link]), null);", "opened = await runPiped(spawnFn, tools.open[0], [tools.open[1].concat([link]).join(' ')], null);"], PAIRW],
  ['Q11', 'tools/home-worker/worker.js', 'pc-code.txt is looked for in the current folder, not next to the settings', ["path.join(cfg._file ? path.dirname(cfg._file) :", "path.join(cfg._file ? process.cwd() :"], PAIRW],
  ['Q12', 'tools/home-worker/worker.js', 'a failed copy is reported as a success', ["if (copied.ok && opened.ok) {", "if (true) {"], PAIRW],
  ['Q13', 'tools/home-worker/worker.js', 'a clientCode of the settings is kept as it was written (a pairing link is not cut down to the code)', ["cfg.clientCode = codeFrom(cfg.clientCode);", "cfg.clientCode = String(cfg.clientCode || '').trim();"], PAIRW],
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
function run(dir, test, pgUrl) {
  return new Promise(resolve => {
    const env = Object.assign({}, process.env, { HOME_MODULES_DIR: dir, HOME_FAIL_FAST: '1' });
    /* the Postgres test of a mutant gets a database of its own (they run side by side), and no container log (the container's log is shared by all of them) */
    if (pgUrl) { env.PPP_TEST_PG_URL = pgUrl; delete env.PPP_TEST_PG_CONTAINER; }
    const child = spawn(process.execPath, [path.join(REPO, 'tests', 'home-worker', test)], { cwd: REPO, env: env });
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
    const wantPage = M.some(m => (!only.length || only.indexOf(m[0]) >= 0) && m[4] === PAIRPAGE);
    const tests = [JOBS, LINKS, SERVER, WORKER, PAIRW].concat(wantPage ? [PAIRPAGE] : []).concat(runPg ? [PG] : []);
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
      const r = await run(dir, m[4], m[4] === PG ? (m.pgUrl || process.env.PPP_TEST_PG_URL) : null);
      results.push({ id: m[0], what: m[2], test: m[4], status: r.code !== 0 ? 'killed' : 'SURVIVED', by: r.code !== 0 ? firstFail(r.out) : '' });
    };
    /* the Postgres ones share a database: one at a time; the others in fours */
    const par = todo.filter(m => m[4] !== PG && m[4] !== PAIRPAGE), seq = todo.filter(m => m[4] === PG), pages = todo.filter(m => m[4] === PAIRPAGE);
    for (let i = 0; i < par.length; i += 4) await Promise.all(par.slice(i, i + 4).map(work));
    /* the page's ones are browser runs (a Chrome and a server each): two at a time */
    for (let i = 0; i < pages.length; i += 2) await Promise.all(pages.slice(i, i + 2).map(work));
    /* the Postgres ones: three at a time, each on its own database (the test drops and makes tables, so they cannot share one) */
    if (seq.length) {
      const { Pool } = require('pg');
      const base = new Pool({ connectionString: process.env.PPP_TEST_PG_URL, max: 2 });
      base.on('error', () => {});
      const dbUrl = n => process.env.PPP_TEST_PG_URL.replace(/\/[^/?]*(\?|$)/, '/' + n + '$1');
      const lanes = [0, 1, 2];
      for (const i of lanes) { await base.query('DROP DATABASE IF EXISTS ppp_mut' + i + ' WITH (FORCE)'); await base.query('CREATE DATABASE ppp_mut' + i); }
      try {
        const queue = seq.slice();
        await Promise.all(lanes.map(async i => { for (let m = queue.shift(); m; m = queue.shift()) { m.pgUrl = dbUrl('ppp_mut' + i); await work(m); } }));
      } finally {
        for (const i of lanes) { try { await base.query('DROP DATABASE IF EXISTS ppp_mut' + i + ' WITH (FORCE)'); } catch (e) { /* the container is thrown away */ } }
        await base.end();
      }
    }
    results.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    console.log('');
    results.forEach(r => console.log((r.status === 'killed' ? '  killed   ' : '  ' + r.status.padEnd(9)) + ' ' + r.id.padEnd(4) + ' ' + r.what + (r.by ? '\n              by: ' + r.by : '')));
    if (skipped.length) console.log('\n  not run (no PPP_TEST_PG_URL): ' + skipped.join(' '));
    const bad = results.filter(r => r.status !== 'killed');
    console.log('\n' + (results.length - bad.length) + ' of ' + results.length + ' mutants killed' + (bad.length ? '; ' + bad.length + ' NOT: ' + bad.map(b => b.id).join(' ') : ''));
    process.exitCode = bad.length ? 1 : 0;
  } finally { try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { /* temp */ } }
})();
