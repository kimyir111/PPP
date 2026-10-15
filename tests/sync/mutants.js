/* G13-S0: mutation checks of the song-library sync server. A copy of the modules is made, ONE rule is broken in it, and the test that should notice is run against the copy
   (HOME_MODULES_DIR): a mutant that survives is a rule nothing tests. The repository's own files are never touched.

     node tests/sync/mutants.js             run them all (the Postgres ones too when PPP_TEST_PG_URL is set, with NODE_PATH for `pg`)
     node tests/sync/mutants.js S1 Q4       only these
     node tests/sync/mutants.js --check     only look that every pattern is found exactly once in its file
     node tests/sync/mutants.js --list      the table

   Three run at a time, each in a port range of its own (PPP_PORT_RANGE: the whole band is MUT_PORT_RANGE, default 10601-10649) and, for Postgres, a database of its own.
   Exit code 0 when every mutant is killed (and the unmutated copy passes). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const FILES = ['Piano Coach App.dc.html', 'sync.js', 'sync-store.js', 'home-jobs.js', 'home-jobs-store.js', 'home-result.js', 'home-omr.js', 'body-reader.js', 'share-guest.js', 'server.js', 'server-stats.js',
  'static-allow.js', 'static-assets.js', 'signup-limit.js', 'catalog/shared-seeds.json', 'tools/sync-admin/lib.js', 'tools/sync-admin/list.js', 'tools/sync-admin/delete.js'];
const UNIT = 'sync.test.js', ABUSE = 'sync-abuse.test.js', PG = 'sync-pg.test.js', SERVER = 'server.test.js';

/* id, file, what the mutant breaks, the pattern(s), the test that must fail. A pattern is [from, to] (replaced once; it must occur exactly once), or a list of those, each of which may
   start with the name of another file: ['sync-store.js', from, to]. */
const M = [
  /* ---- who is asking ---- */
  ['S1', 'sync.js', 'a request with no code is let through to the code check (no 401 before everything)', ["if (raw === undefined) throw httpError(401, 'No library code was sent.', 'no-lib');", ''], UNIT],
  ['S2', 'sync.js', 'the code is compared by its id only (the full hash is not compared)', ['const same = want.length === got.length && crypto.timingSafeEqual(want, got);\n    if (!same || !rec || rec.writing) throw badCode(req);', 'const same = want.length === got.length;\n    if (!same || !rec || rec.writing) throw badCode(req);'], UNIT],
  ['S3', 'sync.js', 'the origin check is gone', ['function requireSameSite(req) {\n    if (!sameSite(req))', 'function requireSameSite(req) {\n    if (false)'], UNIT],
  ['S4', 'sync.js', 'the origin is not looked at on the routes that need a code (only when making a library)', ['async function requireLib(req) {\n    requireSameSite(req);', 'async function requireLib(req) {'], UNIT],
  ['S5', 'sync.js', 'a library can be made from a page of another site', ['async function createLib(req, res) {\n    requireSameSite(req);', 'async function createLib(req, res) {'], UNIT],
  ['S6', 'sync.js', 'wrong codes are never limited', ["if (!limiters.badCodes.take(addressOf(req))) return httpError(429, 'Too many wrong codes from here. Try again later.', 'too-many', { retryAfter: 600 });\n    return httpError(401, 'That library code", "if (false) return httpError(429, 'Too many wrong codes from here. Try again later.', 'too-many', { retryAfter: 600 });\n    return httpError(401, 'That library code"], UNIT],
  ['S7', 'sync.js', 'a valid code is refused while wrong codes from its address are being counted', ['await ensureLoaded();\n    const got = codeHash(raw);', "await ensureLoaded();\n    if (!limiters.badCodes.peek(addressOf(req))) throw httpError(429, 'x', 'too-many');\n    const got = codeHash(raw);"], UNIT],
  ['S8', 'sync.js', 'the hash of the code has no domain prefix', ["const codeHash = code => sha256('ppp-lib-v1:' + code);", "const codeHash = code => sha256(code);"], UNIT],
  ['S9', 'sync.js', 'the code itself (not its hash) is stored', ["hash: made.hash.toString('hex'), createdAt: t, ipTag: tag }, C.maxLibs)", "hash: made.code, createdAt: t, ipTag: tag }, C.maxLibs)"], UNIT],
  ['S10', 'sync.js', 'the old code of a rotated library is counted as a wrong code', ["if (rotatedTo.has(rec.id)) throw httpError(401, 'This library has a new code. Enter the new one.', 'rotated');\n      throw httpError(401, 'This library was deleted.', 'deleted');", "throw badCode(req);"], UNIT],
  ['S11', 'sync.js', 'the code of a deleted library is told it is a wrong one', ["throw httpError(401, 'This library was deleted.', 'deleted');\n    }\n    const t = now();", "throw badCode(req);\n    }\n    const t = now();"], UNIT],
  ['S12', 'sync.js', 'CORS is opened', ["const reply = (res, status, body, headers) => deps.send(res, status, body, Object.assign({ 'Cache-Control': 'no-store' }, headers));", "const reply = (res, status, body, headers) => deps.send(res, status, body, Object.assign({ 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }, headers));"], UNIT],
  ['S13', 'sync.js', 'a request that announces a body on a GET or a DELETE is read on', ["if (announcesBody(req)) throw httpError(400,", "if (false) throw httpError(400,"], UNIT],
  ['S15', 'sync.js', 'a refusal of a request that announced a body leaves the connection open (the body is read to be thrown away)', ["(announcesBody(req) && (h.status === 401 || h.status === 403 || h.status === 429 || h.status === 503))", "false"], UNIT],
  ['S14', 'home-jobs.js', 'an IPv6 address is not folded to its /48 (a network has billions of addresses)', ["return g[0] + ':' + g[1] + ':' + g[2] + '::/48';", 'return s;'], UNIT],
  /* ---- libraries ---- */
  ['L1', 'sync.js', 'libraries are not limited per address (neither the hour nor the day)', ['if (hour < L.LIBS_PER_IP_PER_HOUR && day < L.LIBS_PER_IP_PER_DAY) return 0;', 'return 0;'], UNIT],
  ['L2', 'sync.js', 'the day limit on making libraries is gone', ['if (hour < L.LIBS_PER_IP_PER_HOUR && day < L.LIBS_PER_IP_PER_DAY) return 0;', 'if (hour < L.LIBS_PER_IP_PER_HOUR) return 0;'], UNIT],
  ['L3', 'sync.js', 'the site\'s limit of libraries an hour is gone', ['if (n < L.LIBS_PER_HOUR) return 0;', 'return 0;'], UNIT],
  ['L4', 'sync.js', 'the cap of live libraries is gone (both guards: memory and the statement)', [
    ['if (live >= C.maxLibs) throw httpError(503,', 'if (false) throw httpError(503,'],
    ['createdAt: t, ipTag: tag }, C.maxLibs));', 'createdAt: t, ipTag: tag }, null));']], UNIT],
  ['L5', 'sync.js', 'a deleted library does not count for the per-address limits (making and deleting gets round them)', ['if (l.ipTag !== tag || l.rotatedFrom) return;', 'if (l.ipTag !== tag || l.rotatedFrom || l.revokedAt) return;'], UNIT],
  ['L6', 'sync.js', 'changing a code counts as making a library', ['if (l.ipTag !== tag || l.rotatedFrom) return;', 'if (l.ipTag !== tag) return;'], UNIT],
  ['L7', 'sync.js', 'the place of a library being made is taken only after the store answered (twelve at once all pass the limit)', [
    ["    libs.set(lib.id, lib);        /* the place is taken before anything is awaited: requests at the same moment count it */\n", ''],
    ["if (!ok) { libs.delete(lib.id); throw httpError(503, 'The site holds", "libs.set(lib.id, lib); if (!ok) { libs.delete(lib.id); throw httpError(503, 'The site holds"]], UNIT],
  /* ---- items ---- */
  ['I1', 'sync-store.js', 'file store: a write over a newer revision is made (no conflict)', ['if (cur && cur.rev > it.base) return conflicts.push(meta(it.key, cur));', 'if (false) return conflicts.push(meta(it.key, cur));'], UNIT],
  ['I2', 'sync-store.js', 'Postgres: a write over a newer revision is made (both guards)', [
    ['WHERE (c.key IS NULL AND v.base = 0) OR (c.key IS NOT NULL AND c.rev <= v.base)),', 'WHERE true),'],
    ['WHERE t.rev < EXCLUDED.rev AND t.rev <= (SELECT v.base FROM v WHERE v.key = t.key)', 'WHERE t.rev < EXCLUDED.rev']], PG],
  ['I3', 'sync-store.js', 'file store: a delete over a newer revision is made', ['if (cur.rev > base) return Object.assign({ ok: true, state: \'conflict\'', 'if (false) return Object.assign({ ok: true, state: \'conflict\''], UNIT],
  ['I4', 'sync-store.js', 'Postgres: a delete over a newer revision is made (both guards)', [
    ["ok AS (SELECT * FROM cur WHERE deleted_at IS NULL AND rev <= $3::bigint),", "ok AS (SELECT * FROM cur WHERE deleted_at IS NULL),"],
    ["AND i.deleted_at IS NULL AND i.rev <= $3::bigint RETURNING i.rev)", "AND i.deleted_at IS NULL RETURNING i.rev)"]], PG],
  ['I5', 'sync-store.js', 'file store: the items of a batch get the same revision', ['const rev = l.maxRev + 1 + i;', 'const rev = l.maxRev + 1;'], UNIT],
  ['I6', 'sync-store.js', 'Postgres: the library\'s rows are not looked up by library (a conflict with another library\'s row)', ['FROM ppp_sync_items i WHERE i.lib_id = $1 AND i.key IN (SELECT key FROM v)),', 'FROM ppp_sync_items i WHERE i.key IN (SELECT key FROM v)),'], PG],
  ['I7', 'sync-store.js', 'Postgres: changes are read for any library', ['FROM ppp_sync_items WHERE lib_id = $1 AND rev > $2 ORDER BY rev LIMIT $3', 'FROM ppp_sync_items WHERE ($1::text IS NOT NULL) AND rev > $2 ORDER BY rev LIMIT $3'], PG],
  ['I8', 'sync-store.js', 'Postgres: items are read for any library', ['FROM ppp_sync_items WHERE lib_id = $1 AND key = ANY($2::text[]) ORDER BY array_position($2::text[], key)', 'FROM ppp_sync_items WHERE ($1::text IS NOT NULL) AND key = ANY($2::text[]) ORDER BY array_position($2::text[], key)'], PG],
  ['I9', 'sync-store.js', 'Postgres: a delete looks the item up in any library', ['WITH cur AS (SELECT rev, bytes, deleted_at, content_hash, device, updated_at FROM ppp_sync_items WHERE lib_id = $1 AND key = $2),', 'WITH cur AS (SELECT rev, bytes, deleted_at, content_hash, device, updated_at FROM ppp_sync_items WHERE key = $2),'], PG],
  ['I10', 'sync-store.js', 'file store: reading items ignores the library', ['const its = load().items[libId] || {};\n      const out = [];', 'const its = Object.assign({}, ...Object.values(load().items));\n      const out = [];'], UNIT],
  ['I11', 'sync-store.js', 'Postgres: a library can be written to after it was deleted (the statement does not look at it)', ['WHERE l.id = $1 AND l.revoked_at IS NULL AND tot.cnt > 0 AND tot.d_bytes <= $3 AND tot.new_rows <= $4', 'WHERE l.id = $1 AND tot.cnt > 0 AND tot.d_bytes <= $3 AND tot.new_rows <= $4'], PG],
  ['I12', 'sync-store.js', 'Postgres: deleting a library leaves its items', ['WITH i AS (DELETE FROM ppp_sync_items WHERE lib_id = $1 AND EXISTS', 'WITH i AS (DELETE FROM ppp_sync_items WHERE lib_id = $1 AND false AND EXISTS'], PG],
  ['I13', 'sync-store.js', 'Postgres: a new code leaves the items under the old library', ['mv AS (UPDATE ppp_sync_items SET lib_id = $2 WHERE lib_id = $1 AND EXISTS (SELECT 1 FROM nl) RETURNING 1)', 'mv AS (UPDATE ppp_sync_items SET lib_id = $2 WHERE lib_id = $1 AND false RETURNING 1)'], PG],
  ['I14', 'sync-store.js', 'Postgres: the cap of live libraries is not in the statement', ["WHERE (SELECT count(*) FROM ppp_sync_libs WHERE revoked_at IS NULL) < $5::int'", "WHERE (SELECT count(*) FROM ppp_sync_libs WHERE revoked_at IS NULL) < $5::int + 1000000'"], PG],
  ['I15', 'sync.js', 'the items of a page of changes are never marked as having more', ['const more = rows.length > L.CHANGES_PAGE;', 'const more = false;'], UNIT],
  ['I16', 'sync-store.js', 'file store: a tombstone keeps the body\'s bytes in the library\'s count', ['l.bytes -= cur.bytes; l.items -= 1; l.tombs += 1; l.maxRev = rev;', 'l.items -= 1; l.tombs += 1; l.maxRev = rev;'], UNIT],
  /* ---- what a library may hold ---- */
  ['Q1', 'sync.js', 'the cap of a library\'s bytes is gone', ['const growthMax = Math.max(0, Math.min(libRoom, addrRoom, siteRoom));', 'const growthMax = Math.max(0, Math.min(addrRoom, siteRoom));'], UNIT],
  ['Q2', 'sync.js', 'the cap of an address\'s bytes is gone', ['const growthMax = Math.max(0, Math.min(libRoom, addrRoom, siteRoom));', 'const growthMax = Math.max(0, Math.min(libRoom, siteRoom));'], UNIT],
  ['Q3', 'sync.js', 'the cap of the site\'s bytes is gone', ['const growthMax = Math.max(0, Math.min(libRoom, addrRoom, siteRoom));', 'const growthMax = Math.max(0, Math.min(libRoom, addrRoom));'], UNIT],
  ['Q4', 'sync-store.js', 'file store: the guards on growth and rows are gone', ['if (dBytes > o.growthMax || newRows > o.rowsRoom) return', 'if (false) return'], UNIT],
  ['Q5', 'sync-store.js', 'Postgres: the guards on growth and rows are gone', ['AND tot.d_bytes <= $3 AND tot.new_rows <= $4', 'AND ($3::bigint IS NULL OR true) AND ($4::int IS NULL OR true)'], PG],
  ['Q6', 'sync.js', 'a library\'s rows are not capped', ['const rowsRoom = Math.min(C.libRows - lib.items - lib.tombs, C.siteRows - siteRows());', 'const rowsRoom = Math.min(1e9, C.siteRows - siteRows());'], UNIT],
  ['Q7', 'sync.js', 'the site\'s rows are not capped', ['const rowsRoom = Math.min(C.libRows - lib.items - lib.tombs, C.siteRows - siteRows());', 'const rowsRoom = Math.min(C.libRows - lib.items - lib.tombs, 1e9);'], UNIT],
  ['Q8', 'sync.js', 'a tombstone is not a row (the library\'s rows are its live items)', ['const rowsRoom = Math.min(C.libRows - lib.items - lib.tombs, C.siteRows - siteRows());', 'const rowsRoom = Math.min(C.libRows - lib.items, C.siteRows - siteRows());'], UNIT],
  ['Q9', 'sync-store.js', 'a row costs nothing but its body', ['const ROW_OVERHEAD = 256;', 'const ROW_OVERHEAD = 0;'], UNIT],
  ['Q10', 'sync-store.js', 'file store: a replacement counts as all of its size (not the growth)', ['dBytes += it.bytes + R - (wasLive ? cur.bytes + R : cur ? R : 0);', 'dBytes += it.bytes + R;'], UNIT],
  ['Q11', 'sync.js', 'a batch of more than 25 items is taken', ["if (list.length > L.KEYS_PER_BATCH) throw httpError(422, 'At most '", "if (false) throw httpError(422, 'At most '"], UNIT],
  ['Q12', 'sync.js', 'the same name twice in a batch is taken', ["if (seen.has(it.key)) throw httpError(422, 'An item is named twice.', 'dup-key');", ''], UNIT],
  /* ---- rates ---- */
  ['R1', 'sync.js', 'items written an hour are not limited', ["if (!takeN(limiters.writes, lib.key, items.length)) throw httpError(429,", "if (false) throw httpError(429,"], UNIT],
  ['R2', 'sync.js', 'an item that conflicts keeps its place in the hour', ['giveBack(items.length - applied);', ''], UNIT],
  ['R3', 'sync.js', 'deletions are not limited', ['if (!limiters.deletes.take(lib.key)) {', 'if (false) {'], UNIT],
  ['R4', 'sync.js', 'requests that write (a PUT) are not limited', ["spam) */\n    if (!limiters.writeReq.take(lib.key)) throw httpError(429,", "spam) */\n    if (false) throw httpError(429,"], UNIT],
  ['R4b', 'sync.js', 'requests that write (a DELETE) are not limited', ["throw httpError(422, 'The device name is not usable.', 'bad-device');\n    const ip = addressOf(req);\n    if (!limiters.writeReq.take(lib.key)) throw httpError(429,", "throw httpError(422, 'The device name is not usable.', 'bad-device');\n    const ip = addressOf(req);\n    if (false) throw httpError(429,"], UNIT],
  ['R5', 'sync.js', 'changes that ask the database are not limited', ['if (!limiters.changesSql.take(lib.key)) throw httpError(429,', 'if (false) throw httpError(429,'], UNIT],
  ['R6', 'sync.js', 'a poll that finds nothing asks the store', ['if (since >= rev0) { giveSql(); return reply(', 'if (since > rev0) { giveSql(); return reply('], UNIT],
  ['R7', 'sync.js', 'items read an hour are not limited', ['if (!takeN(limiters.readItems, lib.key, keys.length)) throw httpError(429,', 'if (false) throw httpError(429,'], UNIT],
  ['R8', 'sync.js', 'changing the code is not limited', ['if (!limiters.rotates.take(lib.key)) throw httpError(429,', 'if (false) throw httpError(429,'], UNIT],
  ['R9', 'sync.js', 'the limits of a library are held under its id: a new code is a fresh library with fresh limits', ['const nl = { id: made.id, key: cur.key,', 'const nl = { id: made.id, key: made.id,'], UNIT],
  ['R10', 'sync.js', 'the database is told a library was used on every request', ['if (lib.revokedAt || t - lib.persistedAt < L.TOUCH_MS) return;', 'if (lib.revokedAt) return;'], UNIT],
  ['R11', 'sync.js', 'the database is never told a library was used', ['if (lib.revokedAt || t - lib.persistedAt < L.TOUCH_MS) return;', 'return;'], UNIT],
  ['R12', 'sync.js', 'a failed write does not make the memory be read again', ['const staleAfterFailure = () => { loaded = false; };', 'const staleAfterFailure = () => { };'], UNIT],
  /* ---- the budgets: bytes in and out, held three ways ---- */
  ['B1', 'sync.js', 'what is written is not counted against the budget', ["budgetAdd('in', t, lib, wrote);", ''], UNIT],
  ['B2', 'sync.js', 'a library\'s and an address\'s shares are never filled (only the site\'s budget)', ["    ownerKeys(lib).forEach(k => { const w = ownerWindows(kind, k); out.push(w.hour, w.day); });\n", ''], UNIT],
  ['B3', 'sync.js', 'the address\'s share is not held (only the library\'s)', ["const ownerKeys = lib => (lib.ipTag ? ['l:' + lib.key, 'a:' + lib.ipTag] : ['l:' + lib.key]);", "const ownerKeys = lib => ['l:' + lib.key];"], UNIT],
  ['B4', 'sync.js', 'a library with no address tag has no share at all', ["const ownerKeys = lib => (lib.ipTag ? ['l:' + lib.key, 'a:' + lib.ipTag] : ['l:' + lib.key]);", "const ownerKeys = lib => (lib.ipTag ? ['l:' + lib.key, 'a:' + lib.ipTag] : []);"], UNIT],
  ['B5', 'sync.js', 'the day window is not looked at', [
    ["if (Math.min(b.hour.left(t), b.day.left(t)) < bytes) return 'site';", "if (b.hour.left(t) < bytes) return 'site';"],
    ["if (Math.min(w.hour.left(t), w.day.left(t)) < bytes) return 'share';", "if (w.hour.left(t) < bytes) return 'share';"]], UNIT],
  ['B6', 'sync.js', 'what the site sends is not limited', ["const why = budgetWhy('out', t0, lib, 1);\n    if (why) { giveN(limiters.readItems, lib.key, keys.length); throw budgetError(why, 'out', t0, lib, 1); }", ''], UNIT],
  ['B7', 'sync.js', 'what the site sends is not counted (the reservation is given back whole)', ["settle(bytes);", 'settle(0);'], UNIT],
  ['B8', 'sync.js', 'a library may use the whole of the site\'s budget (no quarter)', ['share: LIMITS.BUDGET_SHARE,', 'share: 1,'], UNIT],
  ['B9', 'sync.js', 'a refused read keeps its items in the hour', ["if (why) { giveN(limiters.readItems, lib.key, keys.length); throw", "if (why) { throw"], UNIT],
  /* ---- the body, its shape and the unpacking ---- */
  ['P1', 'sync.js', 'the shape of a body is not counted as it arrives', ['shape: shape || SHAPES.small, totalMs:', 'shape: undefined, totalMs:'], ABUSE],
  ['P2', 'sync.js', 'a batch may have any number of containers', ['containers: LIMITS.KEYS_PER_BATCH + 8, depth: 4 })', 'containers: 1e9, depth: 4 })'], ABUSE],
  ['P3', 'sync.js', 'the structure of an unpacked item is not counted', ["if (g.push(plain) === 'shape') return bad(", "if (false) return bad("], UNIT],
  ['P4', 'sync.js', 'the unpacking has no cap', ['zlib.gunzip(buf, { maxOutputLength: max }', 'zlib.gunzip(buf, {}'], UNIT],
  ['P5', 'sync.js', 'the items of a request may unpack to any total', ['Math.max(1, Math.min(L.ITEM_INFLATED_MAX, L.REQUEST_INFLATED_MAX - inflated))', 'L.ITEM_INFLATED_MAX'], UNIT],
  ['P6', 'sync.js', 'an item\'s gzip has no size cap', [
    ["if (it.body.length > B64_ITEM_MAX) throw httpError(413,", "if (false) throw httpError(413,"],
    ["if (gz.length > L.ITEM_GZIP_MAX) throw httpError(413,", "if (false) throw httpError(413,"]], UNIT],
  ['P7', 'sync.js', 'a request\'s gzip has no total cap', ["if (gzBytes > L.REQUEST_GZIP_MAX) throw httpError(413,", "if (false) throw httpError(413,"], UNIT],
  ['P8', 'sync.js', 'a song needs no score', ["if (!validScore(v.score)) return bad(", "if (false) return bad("], UNIT],
  ['P9', 'sync.js', 'a song may have any field', ["if (unknown.length) return bad(", "if (false) return bad("], UNIT],
  ['P10', 'sync.js', 'text and nesting of an item are not looked at', ["if (guestShare.inspect(v, ITEM_DEPTH)) return bad(", "if (false) return bad("], UNIT],
  ['P11', 'sync.js', 'the state item may have any number of fields', ["if (Object.keys(v).length > STATE_KEYS_MAX) return bad(", "if (false) return bad("], UNIT],
  ['P12', 'sync.js', 'any text is the name of an item', ['const KEY_RE = /^(?:state|song:[A-Za-z0-9_.:-]{1,64})$/;', 'const KEY_RE = /^.{1,200}$/;'], UNIT],
  ['P13', 'sync.js', 'the revision a write is based on is not checked for its shape', ["if (typeof it.baseRev !== 'number' || !Number.isInteger(it.baseRev) || it.baseRev < 0 || it.baseRev > 1e15) throw", "if (false) throw"], UNIT],
  ['P14', 'sync.js', 'a body that is announced far over the cap is read first', ["if (Number.isFinite(declared) && declared > cap) throw httpError(413, 'That is larger than this accepts.', 'too-large', { close: true });", ''], UNIT],
  ['P15', 'sync.js', 'the deadlines of a body are not passed to the reader', ['totalMs: C.bodyTotalMs, idleMs: C.bodyIdleMs }', 'totalMs: 3600000, idleMs: 3600000 }'], ABUSE],
  ['P16', 'sync.js', 'no place is kept per library for a body being received', ["if ((slots.by.get(kl) | 0) > 0) throw httpError(429, 'A change from this library", "if (false) throw httpError(429, 'A change from this library"], ABUSE],
  ['P17', 'sync.js', 'no place is kept per address', ["if ((slots.by.get(ka) | 0) > 0) throw httpError(503, 'Another change", "if (false) throw httpError(503, 'Another change"], ABUSE],
  ['P18', 'sync.js', 'no ceiling of places for the site', ["if (slots.site >= C.putsAtOnce) throw httpError(503,", "if (false) throw httpError(503,"], ABUSE],
  ['P19', 'sync.js', 'a place is not given back', ['given = true; slots.site--; slots.by.delete(kl); slots.by.delete(ka);', 'given = true; slots.by.delete(kl); slots.by.delete(ka);'], ABUSE],
  ['P20', 'sync.js', 'items are unpacked any number at a time', ['if (processing >= C.processAtOnce) await new Promise(r => processWaiters.push(r)); else {', 'if (false) await new Promise(r => processWaiters.push(r)); else {'], ABUSE],
  ['P21', 'sync.js', 'answers with bodies are made any number at a time', ["if (readsNow >= C.readsAtOnce) throw httpError(503,", "if (false) throw httpError(503,"], ABUSE],
  ['P22', 'sync.js', 'an answer a reader does not take is held for ever', ['timer = setTimeout(() => { free(); try { res.destroy(); } catch (e) { /* gone */ } }, C.readHoldMs);', ''], ABUSE],
  ['P23', 'sync.js', 'an answer has no cap on its bodies', ["store.getItems(lib.id, keys, L.READ_BODY_CAP)", "store.getItems(lib.id, keys, 1e12)"], UNIT],
  ['P25', 'body-reader.js', 'the chunks of a body are held as they arrive (a body sent a byte at a time costs 350 bytes of Buffer a byte)', ["tail.push(c); tailBytes += c.length;\n      if (tail.length >= TAIL_CHUNKS || tailBytes >= TAIL_BYTES) flush();", "chunks.push(c);"], ABUSE],
  ['P24', 'sync.js', 'a body that is refused by the code is read before it', ['const lib = await requireLib(req);\n    const ip = addressOf(req);\n    /* the work this request costs', 'const body0 = await readJson(req, L.PUT_BODY, L.PUT_DRAIN, SHAPES.put);\n    const lib = await requireLib(req);\n    const ip = addressOf(req);\n    /* the work this request costs'], UNIT],
  /* ---- the keeping times ---- */
  ['K1', 'sync.js', 'a library is kept 300 days', ['KEEP_MS: 180 * DAY,', 'KEEP_MS: 300 * DAY,'], UNIT],
  ['K2', 'sync.js', 'a use does not renew the keeping time', ['const t = now();\n    rec.lastUsedAt = t;\n    await persistUse(rec, t);\n    const cur = libs.get(rec.id);', 'const t = now();\n    await persistUse(rec, t);\n    const cur = libs.get(rec.id);'], UNIT],
  ['K3', 'sync.js', 'an empty library is kept as long as any other', ['return l.items + l.tombs === 0 && t - used > L.EMPTY_KEEP_MS;', 'return false;'], UNIT],
  ['K4', 'sync.js', 'tombstones are kept for ever', ["else if (!l.revokedAt && l.oldestTomb && t - l.oldestTomb > L.TOMBSTONE_KEEP_MS) tombDue = true;", ''], UNIT],
  ['K5', 'sync.js', 'a deleted library\'s row is kept for ever', ['if (l.revokedAt) return t - l.revokedAt > L.REVOKED_KEEP_MS;', 'if (l.revokedAt) return false;'], UNIT],
  ['K6', 'sync.js', 'a deleted library\'s row is purged at once', ['if (l.revokedAt) return t - l.revokedAt > L.REVOKED_KEEP_MS;', 'if (l.revokedAt) return true;'], UNIT],
  ['K7', 'sync-store.js', 'file store: purging tombstones leaves the library\'s counters', ['l.tombs -= n; l.bytes -= n * R; l.purgedThrough', 'l.purgedThrough'], UNIT],
  ['K8', 'sync-store.js', 'Postgres: purging tombstones leaves the library\'s counters', ["SET tombs = l.tombs - cnt.n, bytes = l.bytes - cnt.n * ' + R + ', purged_through", "SET tombs = l.tombs, bytes = l.bytes, purged_through"], PG],
  ['K9', 'sync-store.js', 'file store: a purged library leaves its items', ['out.libs++; out.items += Object.keys(d.items[l.id] || {}).length; delete d.items[l.id]; return false;', 'out.libs++; out.items += Object.keys(d.items[l.id] || {}).length; return false;'], UNIT],
  ['K10', 'sync.js', 'the purge looks only every minute... never at a write', ['if (!force && t - lastPurge < L.PURGE_EVERY_MS) return;', 'if (!force) return;'], UNIT],
  ['K11', 'sync.js', 'item rows no library names are never deleted', ["if (orphansDue && typeof store.deleteOrphans === 'function') {", "if (false) {"], UNIT],
  /* ---- the migration and the boot ---- */
  ['M1', 'sync-store.js', 'the migration takes no advisory lock', ["await c.query('SELECT pg_advisory_xact_lock($1)', [SYNC_LOCK_KEY]);", ''], PG],
  ['M2', 'sync-store.js', 'the migration is not in a savepoint', ["await c.query('SAVEPOINT sync_tables');", ''], PG],
  ['M3', 'sync-store.js', 'a failure making the tables is fatal', ['out = { ok: false, error: e };', 'throw e;'], PG],
  ['M4', 'server.js', 'the server does not switch the feature off when its tables could not be made', ['syncService.disable(why1);', ''], PG],
  ['M5', 'sync-store.js', 'the migration drops the table before making it', ['CREATE TABLE IF NOT EXISTS ppp_sync_libs (', 'DROP TABLE IF EXISTS ppp_sync_libs; CREATE TABLE IF NOT EXISTS ppp_sync_libs ('], PG],
  ['M6', 'server.js', 'the routes are mounted whatever PPP_SYNC says', ["const SYNC_ON = process.env.PPP_SYNC === '1';", "const SYNC_ON = true;"], SERVER],
  ['M8', 'sync.js', 'the warning at 80 % is not given', ["if (bytes >= C.totalBytes * L.WARN_AT) out.warn =", "if (false) out.warn ="], UNIT],
  /* ---- the review's fixes: the position a device is given, the budgets of reads and polls, a device that was away, the recovery code, a hung store ---- */
  ['N1', 'sync.js', 'the position of a page is the revision the library has AFTER the rows were fetched (a write in between is skipped over)', ['const top = Math.max(rev0, last);', 'const top = Math.max(lib.maxRev, last);'], UNIT],
  ['N2', 'sync.js', 'a device that says it is ahead is told "reset" from the cache, without asking the library\'s own row', ['if (st && st.found && st.live) {', 'if (false) {'], UNIT],
  ['N3', 'sync.js', 'a device that was away is never told tooOld', ['if (since < lib.purgedThrough) {', 'if (false) {'], UNIT],
  ['N4', 'sync.js', 'the rows of a page of changes are not counted against the budgets', ["budgetAdd('out', now(), lib, size);", ''], UNIT],
  ['N5', 'sync.js', 'the budgets are not looked at before a page of changes is fetched', ["if (why) { giveSql(); throw budgetError(why, 'out', t0, lib, 1); }", ''], UNIT],
  ['B10', 'sync.js', 'the bytes of a read are counted after it was served (six at once all pass the look at the budget)', [
    ["    budgetAdd('out', t0, lib, worst);\n", ''],
    ['const settle = actual => { if (worst > actual) windowsOf(\'out\', lib).forEach(w => w.sub(t0, worst - actual, now())); };', "const settle = actual => budgetAdd('out', now(), lib, actual);"]], UNIT],
  ['B11', 'sync.js', 'what a read may weigh is reserved as one byte (the reservation does not hold the worst case)', ['const worst = Math.max(1, Math.min(L.READ_BODY_CAP, lib.bytes, keys.length * L.ITEM_GZIP_MAX));', 'const worst = 1;'], UNIT],
  ['B12', 'sync.js', 'a read whose store call failed keeps what it reserved', ['try { rows = await guarded(store.getItems(lib.id, keys, L.READ_BODY_CAP)); } catch (e) { settle(0); throw e; }', 'try { rows = await guarded(store.getItems(lib.id, keys, L.READ_BODY_CAP)); } catch (e) { throw e; }'], UNIT],
  ['G1', 'sync.js', 'a key that is `gone` is not told to the device (the write looks as if it had no conflict)', ['.concat((r.gone || []).map(k => ({ key: k, rev: 0, deleted: false, hash: \'\', bytes: 0, device: \'\', updatedAt: null, gone: true })))', ''], UNIT],
  ['G2', 'sync-store.js', 'file store: a revision of a key that is not there is written as a new item', ['if (!cur && it.base > 0) return gone.push(it.key);', ''], UNIT],
  ['G3', 'sync-store.js', 'Postgres: a revision of a key that is not there is written as a new item', ['WHERE (c.key IS NULL AND v.base = 0) OR (c.key IS NOT NULL AND c.rev <= v.base)),', 'WHERE c.key IS NULL OR c.rev <= v.base),'], PG],
  ['G4', 'sync-store.js', 'Postgres: a key that is gone is not reported', ['FROM v WHERE v.base > 0 AND v.key NOT IN (SELECT key FROM cur)"', 'FROM v WHERE false AND v.key NOT IN (SELECT key FROM cur)"'], PG],
  ['K12', 'sync-store.js', 'file store: the revision of a purged tombstone is not kept', ['l.purgedThrough = Math.max(l.purgedThrough | 0, top);', ''], UNIT],
  ['K13', 'sync-store.js', 'Postgres: the revision of a purged tombstone is not kept', ['purged_through = GREATEST(l.purged_through, cnt.top)', 'purged_through = l.purged_through'], PG],
  ['K14', 'sync-store.js', 'Postgres: a new code does not carry the purged revision over', ['old.max_rev, old.purged_through,', 'old.max_rev, 0,'], PG],
  ['K15', 'sync-store.js', 'Postgres: a new code made by a change of code (no new recovery code) loses the library\'s recovery code', ['COALESCE($5::text, old.recovery_hash)', '$5::text'], PG],
  ['C1', 'sync.js', 'the recovery code is compared by the start of its hash only', ['const same = want.length === got.length && crypto.timingSafeEqual(want, got);\n    if (!same || !rec || rec.revokedAt || rec.writing) throw badRecovery(req);', 'const same = want.length === got.length;\n    if (!same || !rec || rec.revokedAt || rec.writing) throw badRecovery(req);'], UNIT],
  ['C2', 'sync.js', 'wrong recovery codes are never limited', ["if (!limiters.badCodes.take(addressOf(req))) return httpError(429, 'Too many wrong codes from here. Try again later.', 'too-many', { retryAfter: 600 });\n    return httpError(401, 'That recovery code", "if (false) return httpError(429, 'Too many wrong codes from here. Try again later.', 'too-many', { retryAfter: 600 });\n    return httpError(401, 'That recovery code"], UNIT],
  ['C3', 'sync.js', 'the recovery code can be used from a page of another site', ['async function recover(req, res) {\n    requireSameSite(req);', 'async function recover(req, res) {'], UNIT],
  ['C4', 'sync.js', 'the recovery code is not used up (the same one can be used again)', ['return rotateWithBody(req, res, rec, true);', 'return rotateWithBody(req, res, rec, false);'], UNIT],
  ['C5', 'sync.js', 'the recovery code itself (not its hash) is stored', ['recoveryHash: made.recoveryHash.toString(\'hex\'), hash:', 'recoveryHash: made.recovery, hash:'], UNIT],
  ['C6', 'sync.js', 'the recovery code of a deleted library still works', [
    ['if (!same || !rec || rec.revokedAt || rec.writing) throw badRecovery(req);', 'if (!same || !rec || rec.writing) throw badRecovery(req);'],
    ['if (cur.recoveryHash && recoveryIndex.get(recoveryKeyOf(cur.recoveryHash)) === cur.id) recoveryIndex.delete(recoveryKeyOf(cur.recoveryHash));', '']], UNIT],
  ['C7', 'sync.js', 'the recovery code has the hash domain of a library code', ["const recoveryHashOf = code => sha256('ppp-lib-recovery-v1:' + code);", "const recoveryHashOf = code => sha256('ppp-lib-v1:' + code);"], UNIT],
  ['C8', 'sync.js', 'recoveries from one address are not limited (only per library)', ['if (!limiters.rotatesIp.take(ip)) {', 'if (false) {'], UNIT],
  ['T1', 'sync.js', 'the one writer waits for a store call for ever', ['try { return await guarded(fn()); }', 'try { return await fn(); }'], UNIT],
  ['T2', 'sync.js', 'a read waits for the store for ever', ['try { rows = await guarded(store.getItems(', 'try { rows = await (store.getItems('], UNIT],
  ['T3', 'sync.js', 'a poll waits for the store for ever', ['const rows = await guarded(store.changes(lib.id, since, L.CHANGES_PAGE + 1));', 'const rows = await store.changes(lib.id, since, L.CHANGES_PAGE + 1);'], UNIT],
  ['T4', 'server.js', 'a query of the song store has no time-out (a hung statement keeps its connection)', ['return getPool().query({ text: sql, values: params, query_timeout: SYNC_QUERY_MS });', 'return getPool().query({ text: sql, values: params });'], PG],
  ['O1', 'tools/sync-admin/lib.js', 'the operator\'s tools touch a database that is not on this machine without --allow-remote', ["if (remote && flags['allow-remote'] !== true) {", 'if (false) {'], UNIT],
  ['O2', 'tools/sync-admin/delete.js', 'delete.js deletes without --confirm', ['if (flags.confirm !== true) {', 'if (false) {'], PG]
];

/* ---------------- the runner ---------------- */
function copyTree(dst) {
  for (const f of FILES) {
    const from = path.join(REPO, f), to = path.join(dst, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}
function patch(dst, m) {
  const list = Array.isArray(m[3][0]) ? m[3] : [m[3]];
  list.forEach(p => {
    const file = p.length === 3 ? p[0] : m[1];
    const from = p.length === 3 ? p[1] : p[0], to = p.length === 3 ? p[2] : p[1];
    const fp = path.join(dst, file);
    const raw = fs.readFileSync(fp, 'utf8');
    const eol = raw.indexOf('\r\n') >= 0;
    const s = raw.replace(/\r\n/g, '\n');
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(m[0] + ': the pattern is found ' + n + ' times in ' + file + ': ' + from.slice(0, 80));
    const out = s.replace(from, () => to);
    fs.writeFileSync(fp, eol ? out.replace(/\n/g, '\r\n') : out);
  });
}
function run(test, env, timeoutMs) {
  return new Promise(resolve => {
    const c = spawn(process.execPath, [path.join(__dirname, test)], { env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => { try { c.kill(); } catch (e) { /* gone */ } }, timeoutMs || 300000);
    c.on('close', code => { clearTimeout(timer); resolve({ code: code, out: out }); });
  });
}

(async () => {
  const args = process.argv.slice(2);
  if (args.indexOf('--list') >= 0) { M.forEach(m => console.log(m[0] + '\t' + m[4] + '\t' + m[2])); return; }
  const dir0 = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-sync-mut-base-'));
  copyTree(dir0);
  const want = args.filter(a => !/^--/.test(a));
  const chosen = M.filter(m => !want.length || want.indexOf(m[0]) >= 0);
  /* every pattern is found exactly once (in a copy of its own) */
  let bad = 0;
  for (const m of M) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-sync-mut-'));
    try { copyTree(d); patch(d, m); } catch (e) { bad++; console.log('  ! ' + e.message); } finally { fs.rmSync(d, { recursive: true, force: true }); }
  }
  if (bad) { console.log(bad + ' pattern(s) do not apply: fix them first'); process.exit(2); }
  console.log(M.length + ' mutants, every pattern found once.');
  if (args.indexOf('--check') >= 0) { fs.rmSync(dir0, { recursive: true, force: true }); return; }

  const [lo, hi] = (process.env.MUT_PORT_RANGE || '10601-10649').split('-').map(Number);
  const slotsN = 3, per = Math.floor((hi - lo + 1) / slotsN);
  const range = k => (lo + k * per) + '-' + (lo + (k + 1) * per - 1);
  const pgUrl = process.env.PPP_TEST_PG_URL || '';
  let admin = null;
  const dbs = [];
  const pgFor = async k => {
    if (!pgUrl) return null;
    if (!admin) { const { Pool } = require('pg'); admin = new Pool({ connectionString: pgUrl, max: 2 }); admin.on('error', () => {}); }
    const name = 'ppp_mut_' + process.pid + '_' + k;
    if (dbs.indexOf(name) < 0) { await admin.query('DROP DATABASE IF EXISTS ' + name + ' WITH (FORCE)'); await admin.query('CREATE DATABASE ' + name); dbs.push(name); }
    return pgUrl.replace(/\/[^/?]*(\?|$)/, '/' + name + '$1');
  };
  const envFor = async (k, test, mdir) => {
    const env = { HOME_MODULES_DIR: mdir, PPP_PORT_RANGE: range(k) };
    if (test === PG) { const u = await pgFor(k); if (u) env.PPP_TEST_PG_URL = u; else env.PPP_TEST_PG_URL = ''; if (process.env.PPP_TEST_PG_CONTAINER) env.PPP_TEST_PG_CONTAINER = ''; }
    return env;
  };

  /* the unmutated copy passes (all four) */
  console.log('the unmutated copy:');
  let first = true;
  for (const t of [UNIT, ABUSE, SERVER].concat(pgUrl ? [PG] : [])) {
    const r = await run(t, await envFor(0, t, dir0));
    const lastLine = r.out.trim().split('\n').pop();
    console.log('  ' + (r.code === 0 ? 'passes ' : 'FAILS  ') + t + ' - ' + lastLine);
    if (r.code !== 0) { first = false; console.log(r.out.split('\n').filter(l => /✗/.test(l)).slice(0, 5).join('\n')); }
  }
  if (!first) { console.log('the unmutated copy does not pass: nothing to compare'); fs.rmSync(dir0, { recursive: true, force: true }); process.exit(1); }

  const results = [];
  let next = 0;
  const worker = async k => {
    for (;;) {
      const i = next++;
      if (i >= chosen.length) return;
      const m = chosen[i];
      if (m[4] === PG && !pgUrl) { results.push({ id: m[0], skipped: true }); console.log('  - ' + m[0] + ' (needs PPP_TEST_PG_URL): skipped'); continue; }
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-sync-mut-'));
      try {
        copyTree(d); patch(d, m);
        const t0 = Date.now();
        const r = await run(m[4], await envFor(k, m[4], d));
        const killed = r.code !== 0;
        const why = (r.out.split('\n').filter(l => /✗|failed|Error|exited/.test(l))[0] || '').trim().slice(0, 140);
        results.push({ id: m[0], killed: killed });
        console.log('  ' + (killed ? 'killed   ' : 'SURVIVED ') + m[0] + ' [' + m[4] + ', ' + Math.round((Date.now() - t0) / 1000) + ' s] ' + m[2] + (killed ? '  <- ' + why : ''));
      } catch (e) {
        results.push({ id: m[0], error: e.message });
        console.log('  ERROR    ' + m[0] + ' ' + e.message);
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    }
  };
  await Promise.all(Array.from({ length: slotsN }, (_, k) => worker(k)));
  fs.rmSync(dir0, { recursive: true, force: true });
  if (admin) { for (const n of dbs) { try { await admin.query('DROP DATABASE IF EXISTS ' + n + ' WITH (FORCE)'); } catch (e) { /* thrown away with the container */ } } await admin.end(); }
  const survived = results.filter(r => r.killed === false || r.error);
  const killed = results.filter(r => r.killed).length, skipped = results.filter(r => r.skipped).length;
  console.log('\n' + killed + ' of ' + (results.length - skipped) + ' mutants killed' + (skipped ? ' (' + skipped + ' skipped)' : '') + (survived.length ? '; NOT killed: ' + survived.map(r => r.id).join(' ') : '.'));
  process.exit(survived.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
