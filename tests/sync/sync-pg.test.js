/* G13-S0: the song-library store on a real Postgres, in the style of tests/home-worker/jobs-pg.test.js:

     - the migration (additive, idempotent, under an advisory lock, in a savepoint: a failure leaves everything else as it was),
     - the TWIN: the file store and the Postgres store are given the same long random sequence of calls and must answer every one the same, and hold the same rows at the end;
       and the whole service is driven twice (a file store, a Postgres store) with one script and must answer every request the same,
     - the statements: a poll that finds nothing runs none (counted in the process and, with a container, in the database's own log), a write is one,
     - the real server.js: PR -> main -> PR boots on production-shaped data, with PPP_SYNC unset (nothing differs from main) and set (two tables more), rolling back, twelve at once,
       the feature optional at the boot.

   Needs a THROWAWAY Postgres and the `pg` package (NODE_PATH may point at a tree that has it):

     docker run -d --name ppp-sync-pg-test -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=ppp -p 127.0.0.1:55433:5432 postgres:17 -c log_statement=all
     PPP_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55433/ppp PPP_TEST_PG_CONTAINER=ppp-sync-pg-test NODE_PATH=D:/PPP/node_modules node tests/sync/sync-pg.test.js
     docker rm -f ppp-sync-pg-test

   It DROPS the ppp_* tables first, so it refuses any database that is not on localhost. Without PPP_TEST_PG_URL it says so and exits 0. */
'use strict';
const L = require('./lib');
const { ok, heading, req, sleep } = L;
const path = L.path, fs = L.fs;
const { spawn, spawnSync } = require('child_process');
const { freePort } = require('../serve-free');

const URL_ = process.env.PPP_TEST_PG_URL;
if (!URL_) { console.log('  - PPP_TEST_PG_URL is not set: no throwaway Postgres to test against. Skipping.'); process.exit(0); }
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(URL_)) { console.error('Refusing: this test drops tables, and only runs against localhost.'); process.exit(2); }
const { Pool } = require('pg');
const SS = L.mod('sync-store.js');
const Store = L.mod('home-jobs-store.js');
const Sync = L.mod('sync.js');
const ROW = SS.ROW_OVERHEAD;
const BASE_REV = process.env.SYNC_BASE_REV || '610d97e';

/* the server under test: the repository's server.js, or - for the mutation runner (HOME_MODULES_DIR) - the copy with one rule broken. Its log is kept. */
async function startServer(env, o) {
  o = o || {};
  const port = await freePort();
  const child = spawn(process.execPath, [o.script || path.join(L.MODS, 'server.js')], {
    cwd: o.cwd || L.REPO, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: o.url || URL_, SESSION_SECRET: 'sync-pg-secret' }, env || {})
  });
  let exited = false;
  const logs = [];
  child.stdout.on('data', d => logs.push(String(d)));
  child.stderr.on('data', d => logs.push(String(d)));
  child.on('exit', () => { exited = true; });
  const t0 = Date.now();
  for (;;) {
    if (exited) throw new Error('server.js exited early: ' + logs.join('').slice(-300));
    try { if ((await req(port, 'GET', '/health')).status === 200) break; } catch (e) { /* not up */ }
    if (Date.now() - t0 > 40000) { child.kill(); throw new Error('server.js did not come up'); }
    await sleep(150);
  }
  await sleep(900);
  return { port: port, log: () => logs.join(''), close: () => new Promise(res => { if (exited) return res(); child.on('exit', () => res()); child.kill(); }) };
}

/* the production database as it is today: users, progress and shares, none of this feature's tables */
const PRODUCTION_SQL = `
      CREATE TABLE ppp_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE ppp_progress (user_id TEXT PRIMARY KEY REFERENCES ppp_users(id) ON DELETE CASCADE, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE ppp_shares (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES ppp_users(id) ON DELETE CASCADE, owner_name TEXT NOT NULL, song_key TEXT NOT NULL,
        title TEXT NOT NULL, composer TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', measures INTEGER NOT NULL DEFAULT 0, listed BOOLEAN NOT NULL DEFAULT false,
        preview JSONB, score JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      INSERT INTO ppp_users (id, email, display_name, password_hash) VALUES ('old-user', 'old@example.com', 'Old', 'x');
      INSERT INTO ppp_progress (user_id, payload) VALUES ('old-user', '{"a":1}');
      INSERT INTO ppp_shares (id, owner_id, owner_name, song_key, title, score) VALUES ('oldshare01', 'old-user', 'Old', 'k', 'Old song', '{"measures":[{}],"notes":[]}');`;

/* a small seeded random generator (mulberry32), so a failing sequence can be run again */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next: next, int: n => Math.floor(next() * n), pick: arr => arr[Math.floor(next() * arr.length)], bytes: n => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = Math.floor(next() * 256); return b; } };
}
const hexOf = r => Buffer.from(r).toString('hex');
const normBody = x => (x.body ? hexOf(x.body) : null);
const strip = (o, drop) => JSON.stringify(o, (k, v) => (drop.indexOf(k) >= 0 ? undefined : (v && v.type === 'Buffer' && Array.isArray(v.data) ? Buffer.from(v.data).toString('hex') : v)));

(async () => {
  const pool = new Pool({ connectionString: URL_, max: 6 });
  pool.on('error', () => { /* an idle connection the container's port proxy reset: the pool replaces it */ });
  const q = (sql, params) => pool.query(sql, params);
  const one = async (sql, params) => (await q(sql, params)).rows;
  const same = (a, b) => { try { require('assert').deepStrictEqual(a, b); return true; } catch (e) { return false; } };
  /* a view left in the way by an earlier, failed run would make a DROP TABLE fail (it is not a table) */
  const dropViews = () => q(`DO $$ DECLARE v text; BEGIN
      FOR v IN SELECT relname FROM pg_class WHERE relkind = 'v' AND relnamespace = 'public'::regnamespace AND relname IN ('ppp_sync_items', 'ppp_sync_libs', 'ppp_worker_tokens') LOOP
        EXECUTE format('DROP VIEW %I', v);
      END LOOP;
    END $$`);
  const dropSync = async () => { await dropViews(); await q('DROP TABLE IF EXISTS ppp_sync_items, ppp_sync_libs CASCADE'); };
  const dropAll = async () => {
    await dropViews();
    await q('DROP TABLE IF EXISTS ppp_sync_items, ppp_sync_libs, ppp_omr_pages, ppp_worker_tokens, ppp_transcribe_jobs, ppp_pc_links, ppp_shares, ppp_progress, ppp_users CASCADE');
  };
  let srv = null;
  const dbs = [];
  let oldDir = null;
  try {
    await dropAll();

    heading('the migration: additive, idempotent, under a lock, optional');
    {
      await q(PRODUCTION_SQL);
      const counts = async () => (await one(`SELECT (SELECT count(*) FROM ppp_users)::int u, (SELECT count(*) FROM ppp_progress)::int p, (SELECT count(*) FROM ppp_shares)::int s`))[0];
      const before = await counts();
      const m1 = await SS.migrate(pool), m2 = await SS.migrate(pool);
      ok('migrate on the production-shaped database, twice: ok both times, no row of theirs touched', m1.ok === true && m2.ok === true && same(await counts(), before));
      const cols = async t => (await one(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [t])).map(r => r.column_name).join();
      ok('ppp_sync_libs has the designed columns (the hash of the code, the keyed tag of the address - never a code or an address)', (await cols('ppp_sync_libs')) === 'id,client_hash,created_at,last_used_at,created_ip_tag,revoked_at,rotated_from,bytes,items,tombs,max_rev', await cols('ppp_sync_libs'));
      ok('ppp_sync_items has the designed columns (the body is BYTEA)', (await cols('ppp_sync_items')) === 'lib_id,key,rev,deleted_at,content_hash,device,bytes,body,updated_at'
        && (await one(`SELECT data_type FROM information_schema.columns WHERE table_name = 'ppp_sync_items' AND column_name = 'body'`))[0].data_type === 'bytea');
      const idx = (await one(`SELECT indexname FROM pg_indexes WHERE tablename IN ('ppp_sync_libs', 'ppp_sync_items') ORDER BY 1`)).map(r => r.indexname).join();
      ok('the indexes: the two primary keys, the library\'s creation time, (lib_id, rev) for `changes`, and the tombstones', idx === 'ppp_sync_items_pkey,ppp_sync_items_rev,ppp_sync_items_tomb,ppp_sync_libs_created,ppp_sync_libs_pkey', idx);
      ok('no foreign key anywhere (a library is not an account; a library and its items are deleted by one statement)', (await one(`SELECT count(*)::int n FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text LIKE 'ppp_sync%'`))[0].n === 0);
      const sql = SS.SCHEMA_SQL;
      ok('the SQL is CREATE ... IF NOT EXISTS only: no DROP, ALTER, DELETE, TRUNCATE, UPDATE, no column removed, none renamed, no reference to ppp_users', !/\b(DROP|ALTER|DELETE|TRUNCATE|UPDATE|RENAME)\b/i.test(sql) && /IF NOT EXISTS/.test(sql) && !/ppp_users/.test(sql));
      const src = fs.readFileSync(path.join(L.MODS, 'sync-store.js'), 'utf8');
      ok('the lock is a transaction-level advisory lock taken before the DDL, in a savepoint', /pg_advisory_xact_lock/.test(src) && SS.SYNC_LOCK_KEY === 727003 && /SAVEPOINT sync_tables/.test(src));
      /* twelve at once from nothing */
      await dropSync();
      const pool12 = new Pool({ connectionString: URL_, max: 12 });
      pool12.on('error', () => {});
      const raced = await Promise.all(Array.from({ length: 12 }, () => SS.migrate(pool12).then(r => (r && r.ok ? 'ok' : 'off'), e => 'threw ' + e.code)));
      await pool12.end();
      ok('twelve instances migrating at the same moment take turns under the lock: all ok, the tables are there once', raced.every(x => x === 'ok') && (await one(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name IN ('ppp_sync_libs', 'ppp_sync_items')`))[0].n === 2, raced.join());
      /* a view in the place of the items table: the migration says "off", undoes its part (also the libs table made before it), and the rest is as it was */
      await dropSync();
      await q('CREATE VIEW ppp_sync_items AS SELECT 1 AS lib_id');
      const bad = await SS.migrate(pool);
      ok('something else named ppp_sync_items: migrate does not throw, it says { ok: false } with the error, and undoes its own part (no ppp_sync_libs left half made)', bad.ok === false && !!bad.error && bad.error.code === '42809'
        && (await one(`SELECT count(*)::int n FROM pg_class WHERE relname = 'ppp_sync_libs'`))[0].n === 0 && same(await counts(), before), JSON.stringify(bad.error && bad.error.code));
      await q('DROP VIEW ppp_sync_items');
      const okAgain = await SS.migrate(pool);
      ok('and with the thing out of the way the next migrate makes both (a restart tries again)', okAgain.ok === true);
      /* a lost connection is thrown (nothing was committed) */
      const dead = await SS.migrate({ connect: async () => { throw Object.assign(new Error('gone'), { code: 'ECONNRESET' }); } }).then(() => 'resolved', e => e.code);
      ok('a connection that cannot be had is thrown, as the boot\'s own', dead === 'ECONNRESET');
    }

    heading('the twin: one random sequence of calls, a file store and a Postgres store, the same answers');
    {
      const stF = SS.fileSyncStore(L.tmpDir('ppp-sync-twin-'), { memory: true });
      const stP = SS.pgSyncStore(q);
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        await dropSync(); await SS.migrate(pool);
        const f = SS.fileSyncStore(L.tmpDir('ppp-sync-twin-'), { memory: true });
        const p = SS.pgSyncStore(q);
        const R = rng(seed * 7919);
        let t = Date.parse('2026-10-15T12:00:00Z');
        const libIds = ['lib_' + 'a'.repeat(22), 'lib_' + 'b'.repeat(22), 'lib_' + 'c'.repeat(22)];
        for (const id of libIds) {
          const l = { id: id, hash: id.slice(4).repeat(3).slice(0, 64).padEnd(64, '0'), createdAt: t, ipTag: 'tag' + id[4] };
          await f.createLib(l, 100); await p.createLib(l, 100);
        }
        const live = libIds.slice();
        const keys = ['song:a', 'song:b', 'song:c', 'song:d', 'song:e', 'song:f', 'state'];
        const known = {};                              /* lib -> key -> last revision the oracle named */
        const mismatches = [];
        const check = (what, a, b, i) => { const sa = strip(a, []), sb = strip(b, []); if (sa !== sb && mismatches.length < 5) mismatches.push('#' + i + ' ' + what + '\n   file: ' + sa.slice(0, 400) + '\n   pg:   ' + sb.slice(0, 400)); };
        let applied = 0, conflicts = 0, refused = 0, deleted = 0, restored = 0;
        const STEPS = 260;
        for (let i = 0; i < STEPS; i++) {
          t += 1000 + R.int(500);
          const lib = R.pick(live);
          known[lib] = known[lib] || {};
          const r = R.next();
          if (r < 0.50) {
            const n = 1 + R.int(4);
            const picked = [];
            while (picked.length < n) { const k = R.pick(keys); if (picked.indexOf(k) < 0) picked.push(k); }
            const items = picked.map(k => {
              const kr = known[lib][k] || 0;
              const base = R.pick([0, kr, kr, kr, Math.max(0, kr - 1), kr + 3]);
              const len = R.pick([20, 20, 100, 400, 1500]);
              return { key: k, base: base, hash: R.bytes(8).toString('hex'), bytes: len, body: R.bytes(len), device: R.pick(['', 'a1b2c3d4e5f60718', 'ffffffffffffffff']) };
            });
            const o = { growthMax: R.pick([1e12, 1e12, 1e12, 0, 300, 2500]), rowsRoom: R.pick([1e6, 1e6, 1e6, 0, 1, 3]) };
            const a = await f.putItems(lib, items, t, o), b = await p.putItems(lib, items, t, o);
            check('putItems', a, b, i);
            if (a.ok) { applied += a.applied.length; conflicts += a.conflicts.length; a.applied.forEach(x => { known[lib][x.key] = x.rev; }); a.conflicts.forEach(c => { known[lib][c.key] = c.rev; }); } else refused++;
          } else if (r < 0.65) {
            const k = R.pick(keys);
            const kr = known[lib][k] || 0;
            const base = R.pick([kr, kr, Math.max(0, kr - 1), kr + 2]);
            const dev = R.pick(['', 'a1b2c3d4e5f60718']);
            const a = await f.deleteItem(lib, k, base, dev, t), b = await p.deleteItem(lib, k, base, dev, t);
            check('deleteItem ' + k, a, b, i);
            if (a.ok && a.state === 'deleted') { known[lib][k] = a.rev; deleted++; }
          } else if (r < 0.78) {
            const n = 1 + R.int(5), ks = [];
            while (ks.length < n) { const k = R.pick(keys); if (ks.indexOf(k) < 0) ks.push(k); }
            const cap = R.pick([1e9, 1e9, 0, 300, 1200]);
            const a = await f.getItems(lib, ks, cap), b = await p.getItems(lib, ks, cap);
            check('getItems', a.map(x => Object.assign({}, x, { body: normBody(x) })), b.map(x => Object.assign({}, x, { body: normBody(x) })), i);
          } else if (r < 0.90) {
            const since = R.int(40), limit = 1 + R.int(30);
            const a = await f.changes(lib, since, limit), b = await p.changes(lib, since, limit);
            check('changes', a, b, i);
          } else if (r < 0.93 && live.length > 1) {
            const nid = 'lib_' + R.bytes(11).toString('hex');
            const nl = { id: nid, hash: R.bytes(32).toString('hex') };
            const a = await f.rotateLib(lib, nl, t), b = await p.rotateLib(lib, nl, t);
            check('rotateLib', a, b, i);
            if (a) { live[live.indexOf(lib)] = nid; known[nid] = known[lib]; }
          } else if (r < 0.95 && live.length > 1) {
            const a = await f.deleteLib(lib, t), b = await p.deleteLib(lib, t);
            check('deleteLib', a, b, i);
            if (a) live.splice(live.indexOf(lib), 1);
          } else {
            const cut = R.pick([null, t - 5000, t - 60000, t + 1e6]);
            const a = await f.purge([], cut), b = await p.purge([], cut);
            const norm = x => Object.assign({}, x, { updated: x.updated.slice().sort((m, n) => (m.id < n.id ? -1 : 1)) });
            check('purge', norm(a), norm(b), i);
          }
          if (i % 40 === 39) {
            const la = await f.loadAll(), lb = await p.loadAll();
            const nl = o => ({ libs: o.libs.slice().sort((x, y) => (x.id < y.id ? -1 : 1)), tombs: o.tombs, orphanItems: o.orphanItems });
            check('loadAll', nl(la), nl(lb), i);
          }
        }
        /* the final state: every library, every row, every body */
        const dump = async st => {
          const out = {};
          const all = await st.loadAll();
          for (const l of all.libs.slice().sort((x, y) => (x.id < y.id ? -1 : 1))) {
            const rows = await st.changes(l.id, 0, 100000);
            const full = await st.getItems(l.id, rows.map(r => r.key), 1e12);
            out[l.id] = { lib: l, rows: rows, bodies: full.map(x => normBody(x)) };
          }
          return out;
        };
        const da = await dump(f), db = await dump(p);
        const final = strip(da, []) === strip(db, []);
        const firstDiff = () => {
          for (const id of Object.keys(da)) {
            if (!db[id]) return 'library ' + id + ' is missing on Postgres';
            for (const part of ['lib', 'rows', 'bodies']) if (strip(da[id][part], []) !== strip(db[id][part], [])) return id + '.' + part + '\n   file: ' + strip(da[id][part], []).slice(0, 500) + '\n   pg:   ' + strip(db[id][part], []).slice(0, 500);
          }
          return Object.keys(db).filter(id => !da[id]).join();
        };
        const inv = (await one(`SELECT l.id, l.bytes::bigint AS bytes, l.items, l.tombs, l.max_rev::bigint AS max_rev,
          (SELECT count(*) FROM ppp_sync_items i WHERE i.lib_id = l.id AND i.deleted_at IS NULL)::int AS live,
          (SELECT count(*) FROM ppp_sync_items i WHERE i.lib_id = l.id AND i.deleted_at IS NOT NULL)::int AS dead,
          (SELECT COALESCE(sum(CASE WHEN i.deleted_at IS NULL THEN i.bytes + ${ROW} ELSE ${ROW} END), 0) FROM ppp_sync_items i WHERE i.lib_id = l.id)::bigint AS acc,
          (SELECT COALESCE(max(i.rev), 0) FROM ppp_sync_items i WHERE i.lib_id = l.id)::bigint AS top
          FROM ppp_sync_libs l WHERE l.revoked_at IS NULL`));
        const invOk = inv.every(x => x.items === x.live && x.tombs === x.dead && Number(x.bytes) === Number(x.acc) && Number(x.max_rev) >= Number(x.top));
        ok('seed ' + seed + ': ' + STEPS + ' calls (' + applied + ' items written, ' + conflicts + ' conflicts, ' + refused + ' batches refused by a guard, ' + deleted + ' deletions): every answer of the two stores is the same, and so is the end state of every library', mismatches.length === 0 && final, mismatches.join('\n') + (final ? '' : firstDiff()));
        ok('seed ' + seed + ': and on Postgres the counters of every live library equal what its rows hold (live, tombstones, accounted bytes, revision)', invOk, JSON.stringify(inv.filter(x => !(x.items === x.live && x.tombs === x.dead && Number(x.bytes) === Number(x.acc))).slice(0, 2)));
      }
    }

    heading('the store\'s own guards on Postgres (a library in every WHERE; a revision never goes backwards)');
    {
      await dropSync(); await SS.migrate(pool);
      const st = SS.pgSyncStore(q);
      const t = Date.parse('2026-10-15T12:00:00Z');
      const A = 'lib_' + '1'.repeat(22), B = 'lib_' + '2'.repeat(22);
      await st.createLib({ id: A, hash: 'a'.repeat(64), createdAt: t, ipTag: 'ta' }, 10);
      await st.createLib({ id: B, hash: 'b'.repeat(64), createdAt: t, ipTag: 'tb' }, 10);
      const it = (key, base, n) => ({ key: key, base: base, hash: 'h' + n, bytes: 30, body: Buffer.alloc(30, n), device: '' });
      const open = { growthMax: 1e12, rowsRoom: 1e6 };
      await st.putItems(A, [it('song:x', 0, 1)], t, open);
      await st.putItems(B, [it('song:x', 0, 2), it('song:y', 0, 3)], t, open);
      const rowsA = (await one(`SELECT key, rev::int, encode(body, 'hex') AS body FROM ppp_sync_items WHERE lib_id = $1`, [A]));
      ok('the same key in two libraries: two rows, each with its own body and its own revision counter', rowsA.length === 1 && rowsA[0].body === '01'.repeat(30) && (await one(`SELECT rev::int FROM ppp_sync_items WHERE lib_id = $1 AND key = 'song:y'`, [B]))[0].rev === 2);
      const d = await st.deleteItem(A, 'song:y', 5, '', t);
      ok('a delete in library A of a name only B has: missing, and B\'s row is whole', d.ok && d.state === 'missing' && (await one(`SELECT count(*)::int n FROM ppp_sync_items WHERE lib_id = $1 AND deleted_at IS NULL`, [B]))[0].n === 2);
      const g = await st.getItems(A, ['song:y', 'song:x'], 1e9);
      ok('a read of library A for B\'s name finds nothing', g.length === 1 && g[0].key === 'song:x');
      ok('a write to a library that does not exist is { ok: false, reason: gone } and writes no row', (await st.putItems('lib_' + '9'.repeat(22), [it('song:z', 0, 4)], t, open)).reason === 'gone' && (await one(`SELECT count(*)::int n FROM ppp_sync_items WHERE lib_id = 'lib_' || repeat('9', 22)`))[0].n === 0);
      await st.deleteLib(B, t);
      ok('a write to a deleted library is refused too (gone), and deleting it took its rows', (await st.putItems(B, [it('song:z', 0, 4)], t, open)).reason === 'gone' && (await one(`SELECT count(*)::int n FROM ppp_sync_items WHERE lib_id = $1`, [B]))[0].n === 0);
      ok('deleting a library a second time is false (nothing is deleted twice)', (await st.deleteLib(B, t)) === false);
      ok('createLib refuses past the cap in the statement (maxLive 2: A is live, a third is refused)', (await st.createLib({ id: 'lib_' + '3'.repeat(22), hash: 'c'.repeat(64), createdAt: t, ipTag: '' }, 2)) === true && (await st.createLib({ id: 'lib_' + '4'.repeat(22), hash: 'd'.repeat(64), createdAt: t, ipTag: '' }, 2)) === false);
      ok('a duplicate library id is refused by the primary key', await st.createLib({ id: A, hash: 'e'.repeat(64), createdAt: t, ipTag: '' }, 100).then(() => false, e => e.code === '23505'));
      /* a stale base never overwrites: the statement re-checks the revision (here: ask for a write with a base that the row has passed, directly) */
      const cur = (await one(`SELECT rev::int FROM ppp_sync_items WHERE lib_id = $1 AND key = 'song:x'`, [A]))[0].rev;
      await st.putItems(A, [it('song:x', cur, 5)], t, open);
      const stale = await st.putItems(A, [it('song:x', cur, 6)], t, open);
      ok('a write over a revision the row has passed is a conflict, and the body is the newer one\'s', stale.ok && stale.applied.length === 0 && stale.conflicts.length === 1 && (await one(`SELECT encode(body, 'hex') AS b FROM ppp_sync_items WHERE lib_id = $1 AND key = 'song:x'`, [A]))[0].b === '05'.repeat(30));
      /* a hostile key and hash are data */
      const hostile = "song:x'); DROP TABLE ppp_sync_items; --";
      await st.putItems(A, [{ key: hostile, base: 0, hash: "h'); DROP TABLE ppp_sync_libs; --", bytes: 4, body: Buffer.from('abcd'), device: "d'" }], t, open);
      ok('a key and a hash with quotes and a DROP in them are stored as text; nothing is dropped', (await one(`SELECT count(*)::int n FROM ppp_sync_items WHERE key = $1`, [hostile]))[0].n === 1 && (await one(`SELECT count(*)::int n FROM ppp_sync_libs`))[0].n >= 2);
      /* every byte value survives bytea */
      const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      await st.putItems(A, [{ key: 'song:bytes', base: 0, hash: 'hh', bytes: 256, body: all, device: '' }], t, open);
      const back = await st.getItems(A, ['song:bytes'], 1e9);
      ok('all 256 byte values (a gzip body) come back unchanged from bytea', back[0].body.equals(all));
      const big = require('crypto').randomBytes(1000 * 1000);
      await st.putItems(A, [{ key: 'song:big', base: 0, hash: 'hh', bytes: big.length, body: big, device: '' }], t, open);
      ok('and a megabyte', (await st.getItems(A, ['song:big'], 1e9))[0].body.equals(big));
      const capped = await st.getItems(A, ['song:bytes', 'song:big', 'song:x'], 1000);
      ok('getItems with a cap: bodies up to the cap in the order asked, the rest come back deferred with no body (not read out of the row)', capped.find(x => x.key === 'song:bytes').body.length === 256 && capped.find(x => x.key === 'song:big').deferred === true && capped.find(x => x.key === 'song:big').body === null && capped.find(x => x.key === 'song:x').deferred === true);
      await q(`UPDATE ppp_sync_libs SET revoked_at = now() WHERE id = $1`, [A]);
      await st.touchLib(A, t + 99999);
      ok('touchLib does not touch a revoked library', Number((await one(`SELECT extract(epoch from last_used_at)::bigint * 1000 AS t FROM ppp_sync_libs WHERE id = $1`, [A]))[0].t) === t);
      /* the purge's one statement */
      await dropSync(); await SS.migrate(pool);
      const st2 = SS.pgSyncStore(q);
      for (const [id, n] of [[A, 'a'], [B, 'b']]) await st2.createLib({ id: id, hash: n.repeat(64), createdAt: t, ipTag: '' }, 10);
      await st2.putItems(A, [it('song:p', 0, 1), it('song:q', 0, 2)], t, open);
      await st2.putItems(B, [it('song:p', 0, 3)], t, open);
      await st2.deleteItem(A, 'song:p', 1, '', t);
      await st2.deleteItem(B, 'song:p', 3, '', t + 60000);
      const pr = await st2.purge([], t + 30000);
      ok('purge of tombstones before a time: A\'s (made at t) goes, B\'s (made a minute later) stays; the counters of A follow, and the next oldest tombstone of each is named', pr.tombs === 1 && pr.updated.length === 1 && pr.updated[0].id === A && pr.updated[0].tombs === 0
        && (await one(`SELECT tombs, bytes::int FROM ppp_sync_libs WHERE id = $1`, [A]))[0].tombs === 0 && (await one(`SELECT tombs FROM ppp_sync_libs WHERE id = $1`, [B]))[0].tombs === 1);
      const pr2 = await st2.purge([A], null);
      ok('purge of a library: its row and all its items go in the same statement; the other library is whole', pr2.libs === 1 && pr2.items === 1 && (await one(`SELECT count(*)::int n FROM ppp_sync_items WHERE lib_id = $1`, [A]))[0].n === 0 && (await one(`SELECT count(*)::int n FROM ppp_sync_items WHERE lib_id = $1`, [B]))[0].n === 1);
      await q(`INSERT INTO ppp_sync_items (lib_id, key, rev, bytes, body) VALUES ('lib_ghost', 'song:g', 1, 1, 'x')`);
      const la = await st2.loadAll();
      ok('rows no library names are counted by the boot read, and deleteOrphans removes them (and only them)', la.orphanItems === 1 && (await st2.deleteOrphans()) === 1 && (await one(`SELECT count(*)::int n FROM ppp_sync_items`))[0].n === 1);
    }

    heading('the service on Postgres: one script, two stores, the same answers');
    {
      const script = async S => {
        const out = [];
        const rec = async (label, p) => { const r = await p; out.push(label + ' ' + r.status + ' ' + (r.text || '').replace(/[0-9a-f]{64}/g, '<code>').replace(/lib_[0-9a-f]{22}/g, '<id>').replace(/"tag":"[0-9a-f]{6}"/g, '"tag":"<t>"')); return r; };
        await S.make('a', { ip: '192.0.2.1' }); await S.make('b', { ip: '192.0.2.2' });
        const A = S.as('a'), B = S.as('b');
        await rec('empty', A.changes(0));
        await rec('put', A.putItems([L.item('song:one'), L.item('song:two', L.songBody(9)), L.item('state', { v: 1, xp: 3 })]));
        await rec('conflict', A.putItems([L.item('song:one', L.songBody(10), 0), L.item('song:three', L.songBody(7), 0)]));
        await rec('changes0', A.changes(0));
        await rec('changes2', A.changes(2));
        await rec('items', A.items(['song:two', 'song:one', 'song:nope', 'state']));
        await rec('b-items', B.items(['song:one']));
        await rec('del-stale', A.delItem('song:one', 0));
        await rec('del', A.delItem('song:one', 1));
        await rec('del-again', A.delItem('song:one', 1));
        await rec('del-missing', A.delItem('song:zzz', 0));
        await rec('put-over-tomb', A.putItems([L.item('song:one', L.songBody(11), 1)]));
        await rec('restore', A.putItems([L.item('song:one', L.songBody(11), 5)]));
        await rec('big-batch', A.putItems(Array.from({ length: 25 }, (_, i) => L.item('song:m' + i, L.songBody(5 + (i % 4)), 0))));
        await rec('changes-page', A.changes(6));
        const rot = await A.post('/api/libs/me/rotate', {});
        out.push('rotate ' + rot.status);
        S.clock.t += 3600 * 1000;
        const neu = rot.body.code;
        const N = { get: (p, o) => L.req(S.port, 'GET', p, Object.assign({ headers: { 'X-PPP-Lib': neu } }, o)) };
        await rec('old-code', A.changes(0));
        await rec('new-code', N.get('/api/sync/changes?since=0'));
        await rec('b-put', B.putItems([L.item('song:b1'), L.item('song:b2')]));
        await rec('b-del-lib', B.del('/api/libs/me'));
        await rec('b-after', B.changes(0));
        S.advance(40 * 24 * 3600 * 1000);
        await S.svc._state.purge(S.clock.t);
        await rec('after-40-days', N.get('/api/sync/changes?since=0'));
        return out;
      };
      await dropSync(); await SS.migrate(pool);
      const SF = await L.startSync({ memory: true });
      let fileOut;
      try { fileOut = await script(SF); } finally { await SF.close(); }
      await dropSync(); await SS.migrate(pool);
      const SP = await L.startSync({ store: SS.pgSyncStore(q) });
      let pgOut;
      try { pgOut = await script(SP); } finally { await SP.close(); }
      const diffs = fileOut.map((x, i) => (x === pgOut[i] ? null : '#' + i + '\n   file: ' + x.slice(0, 300) + '\n   pg:   ' + String(pgOut[i]).slice(0, 300))).filter(Boolean);
      ok('the same script of ' + fileOut.length + ' requests (writes, conflicts, deletions, tombstones, a batch of 25, a new code, a deleted library, 40 days and the purge) answers the same, byte for byte, over a file store and over Postgres', fileOut.length === pgOut.length && diffs.length === 0, diffs.slice(0, 2).join('\n'));
    }

    heading('statements: a poll that finds nothing runs none, a write is one (counted, and in the database\'s own log)');
    {
      await dropSync(); await SS.migrate(pool);
      const cq = L.countingQuery(pool);
      const S = await L.startSync({ store: SS.pgSyncStore(cq.query) });
      try {
        await S.make('a');
        const A = S.as('a');
        await A.putItems([L.item('song:one'), L.item('state', { v: 1 })]);
        S.svc._state.forgetAll();
        cq.reset();
        let r = await A.changes(2);
        ok('the first request after a boot is ONE round trip (the libraries, the oldest tombstones, the orphans) - and no touch: the library was used a moment ago', r.status === 200 && cq.n === 1 && /client_hash/.test(cq.seen[0]), cq.n + ' ' + JSON.stringify(cq.seen));
        cq.reset();
        S.advance(10 * 60 * 1000);
        for (let i = 0; i < 100; i++) await A.changes(2);
        for (let i = 0; i < 30; i++) await A.changes(9);
        ok('then 100 polls that find nothing and 30 from a device that is ahead run ZERO statements on Postgres', cq.n === 0, cq.n + ' ' + JSON.stringify(cq.seen));
        cq.reset();
        await A.putItems([L.item('song:two')]);
        ok('a write is one statement', cq.n === 1, cq.n + ' ' + JSON.stringify(cq.seen));
        cq.reset();
        r = await A.changes(2);
        ok('a poll that finds something is one statement (the indexed changes)', r.body.items.length === 1 && cq.n === 1);
        cq.reset();
        await A.items(['song:two']);
        ok('reading is one statement', cq.n === 1);
        cq.reset();
        await A.delItem('song:two', 3);
        ok('a deletion is one statement', cq.n === 1);
        cq.reset();
        const rr = await A.post('/api/libs/me/rotate', {});
        ok('a new code is one statement', rr.status === 201 && cq.n === 1, cq.n + ' ' + JSON.stringify(cq.seen));
        cq.reset();
        const dl = await L.req(S.port, 'DELETE', '/api/libs/me', { headers: { 'X-PPP-Lib': rr.body.code } });
        ok('deleting a library is one statement', dl.status === 200 && cq.n === 1);
        cq.reset();
        await S.make('c', { ip: '192.0.2.99' });
        ok('making a library is one statement', cq.n === 1);
        S.advance(200 * 24 * 3600 * 1000);
        cq.reset();
        await S.svc._state.purge(S.clock.t);
        ok('the purge of what ran out is one statement; and a second purge with nothing to purge runs none', cq.n === 1 && await (async () => { cq.reset(); await S.svc._state.purge(S.clock.t + 1000); return cq.n === 0; })(), cq.n + ' ' + JSON.stringify(cq.seen));
      } finally { await S.close(); }
      const container = process.env.PPP_TEST_PG_CONTAINER;
      if (container) {
        await dropSync(); await SS.migrate(pool);
        const S2 = await L.startSync({ store: SS.pgSyncStore((s, p) => pool.query(s, p)) });
        try {
          await S2.make('a');
          await S2.as('a').putItems([L.item('song:one')]);
          S2.svc._state.forgetAll();
          await S2.as('a').changes(1);
          await sleep(400);
          const mark = new Date().toISOString();
          await sleep(1100);
          for (let i = 0; i < 100; i++) await S2.as('a').changes(1);
          await sleep(600);
          const text = (() => { const r = spawnSync('docker', ['logs', '--since', mark, container], { encoding: 'utf8' }); return (r.stdout || '') + (r.stderr || ''); })();
          const mine = text.split('\n').filter(l => /ppp_sync_/.test(l) && /statement:|execute/.test(l));
          ok('100 idle polls: ZERO statements on the feature\'s tables in the database\'s own log', mine.length === 0, mine.length + ' ' + mine.slice(0, 3).join(' | '));
          ok('(the log is on: it shows the statement this test makes next)', await (async () => { const m2 = new Date().toISOString(); await sleep(1100); await q('SELECT count(*) FROM ppp_sync_libs'); await sleep(500); const t2 = (() => { const r = spawnSync('docker', ['logs', '--since', m2, container], { encoding: 'utf8' }); return (r.stdout || '') + (r.stderr || ''); })(); return /statement:.*ppp_sync_libs/.test(t2); })());
        } finally { await S2.close(); }
      } else console.log('  - PPP_TEST_PG_CONTAINER is not set: the database-log count is skipped (the in-process count above ran).');
    }

    heading('server.js: the flag, the boot on production-shaped data, PR -> main -> PR, rollback');
    {
      /* the code of main (the base of this branch) is exported from git into a folder of its own and run for real against the databases this tree has migrated */
      oldDir = (() => {
        const dir = L.tmpDir('ppp-sync-old-');
        const files = ['server.js', 'home-jobs.js', 'home-jobs-store.js', 'home-result.js', 'home-omr.js', 'body-reader.js', 'share-guest.js', 'static-allow.js', 'static-assets.js', 'signup-limit.js', 'server-stats.js', 'catalog/shared-seeds.json'];
        for (const f of files) {
          const r = spawnSync('git', ['show', BASE_REV + ':' + f], { cwd: L.REPO, maxBuffer: 256 * 1024 * 1024 });
          if (r.status !== 0) { L.rmDir(dir); return null; }
          fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
          fs.writeFileSync(path.join(dir, f), r.stdout);
        }
        return dir;
      })();
      if (!oldDir) console.log('  - ' + BASE_REV + ' is not in this clone\'s history: the main -> PR -> main boot checks are skipped');
      const mkDb = async name0 => { const name = name0 + '_' + process.pid;   /* (a name of its own per process: the mutation runner runs several of these at once) */
        await q('DROP DATABASE IF EXISTS ' + name + ' WITH (FORCE)'); await q('CREATE DATABASE ' + name); dbs.push(name); const url = URL_.replace(/\/[^/?]*(\?|$)/, '/' + name + '$1'); const pl = new Pool({ connectionString: url, max: 4 }); pl.on('error', () => {}); return { name: name, url: url, pool: pl, q: (sql, params) => pl.query(sql, params), one: async (sql, params) => (await pl.query(sql, params)).rows }; };
      const snapshot = async db => {
        const cols = (await db.one(`SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS v FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)).map(r => r.v);
        const cons = (await db.one(`SELECT conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) AS v FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1`)).map(r => r.v);
        const idx = (await db.one(`SELECT indexdef AS v FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`)).map(r => r.v);
        const names = (await db.one(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`)).map(r => r.table_name);
        const rows = {};
        for (const t of names) rows[t] = (await db.one('SELECT * FROM ' + t + ' ORDER BY 1')).map(r => JSON.stringify(r));
        return { cols: cols, cons: cons, idx: idx, names: names, rows: rows };
      };
      const diff = (a, b) => ({ removed: a.filter(x => b.indexOf(x) < 0), added: b.filter(x => a.indexOf(x) < 0) });
      const j = x => JSON.stringify(x);
      const bootPR = (db, env) => startServer(env, { url: db.url });
      const bootOld = (db, env) => startServer(env, { script: path.join(oldDir, 'server.js'), cwd: oldDir, url: db.url });
      const SYNC_COLS = ['ppp_sync_libs.id text NO ', 'ppp_sync_libs.client_hash text NO ', 'ppp_sync_libs.created_at timestamp with time zone NO now()', 'ppp_sync_libs.last_used_at timestamp with time zone NO now()',
        "ppp_sync_libs.created_ip_tag text NO ''::text", 'ppp_sync_libs.revoked_at timestamp with time zone YES ', 'ppp_sync_libs.rotated_from text YES ', 'ppp_sync_libs.bytes bigint NO 0', 'ppp_sync_libs.items integer NO 0',
        'ppp_sync_libs.tombs integer NO 0', 'ppp_sync_libs.max_rev bigint NO 0', 'ppp_sync_items.lib_id text NO ', 'ppp_sync_items.key text NO ', 'ppp_sync_items.rev bigint NO ', 'ppp_sync_items.deleted_at timestamp with time zone YES ',
        'ppp_sync_items.content_hash text YES ', "ppp_sync_items.device text NO ''::text", 'ppp_sync_items.bytes integer NO 0', 'ppp_sync_items.body bytea YES ', 'ppp_sync_items.updated_at timestamp with time zone NO now()'];

      /* with the flag unset the PR boots exactly as main does: no table, no route, no line */
      const flag = await mkDb('ppp_sync_flag');
      await flag.q(PRODUCTION_SQL);
      const noFlag = await bootPR(flag, { PPP_SYNC: '' });
      let s1;
      try {
        const a = await req(noFlag.port, 'POST', '/api/libs', { body: {}, ip: '198.51.100.7' });
        const b = await req(noFlag.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': '0'.repeat(64) } });
        const c = await req(noFlag.port, 'DELETE', '/api/libs/me', { headers: { 'X-PPP-Lib': '0'.repeat(64) } });
        const d = await req(noFlag.port, 'GET', '/api/nothing-at-all');
        ok('PPP_SYNC unset: every sync route is a 404 like any unknown path (the same status and body as one that never existed)', a.status === 404 && b.status === 404 && c.status === 404 && d.status === 404 && a.text === d.text && b.text === d.text, [a.status, b.status, c.status, d.status].join());
        ok('... and the boot says nothing about it (no "Song sync" line)', !/Song sync/.test(noFlag.log()));
        s1 = await snapshot(flag);
        ok('... and made no table of it', !s1.names.some(n => /ppp_sync/.test(n)), s1.names.join());
      } finally { await noFlag.close(); }
      if (oldDir) {
        /* main on the same database (it has the same queue tables), then the PR without the flag: nothing differs */
        const oldBoot = await bootOld(flag);
        const sOld = await snapshot(flag);
        await oldBoot.close();
        const prBoot = await bootPR(flag, {});
        const sPr = await snapshot(flag);
        await prBoot.close();
        const dd = diff(sOld.cols, sPr.cols), dk = diff(sOld.cons, sPr.cons), di = diff(sOld.idx, sPr.idx);
        ok('main -> PR (flag unset): the schema is identical (columns, constraints, indexes) and so is every row', dd.added.length + dd.removed.length + dk.added.length + dk.removed.length + di.added.length + di.removed.length === 0 && j(sOld.rows) === j(sPr.rows) && j(sOld.names) === j(sPr.names), j({ dd: dd, dk: dk }).slice(0, 300));

        /* the PR with the flag: two tables more, nothing else changed */
        const on = await bootPR(flag, { PPP_SYNC: '1' });
        let code, lib;
        try {
          const mk = await req(on.port, 'POST', '/api/libs', { body: {}, ip: '198.51.100.8' });
          code = mk.body && mk.body.code;
          const put = await req(on.port, 'PUT', '/api/sync/items', { headers: { 'X-PPP-Lib': code }, body: { device: 'a1b2c3d4e5f60718', items: [L.item('song:one'), L.item('state', { v: 1 })] } });
          ok('PPP_SYNC=1: a library is made (no sign-in), an item is written through the real server on the real database', mk.status === 201 && put.status === 200 && put.body.applied.length === 2, mk.status + ' ' + put.status + ' ' + put.text.slice(0, 120));
          ok('the boot says the feature is on, in one line', /Song sync: on/.test(on.log()) && !/Song sync: OFF/.test(on.log()));
        } finally { await on.close(); }
        const sOn = await snapshot(flag);
        const d1 = diff(sPr.cols, sOn.cols), k1 = diff(sPr.cons, sOn.cons), i1 = diff(sPr.idx, sOn.idx);
        ok('PR with PPP_SYNC=1 on the database main left: the schema differs only by the two new tables (' + SYNC_COLS.length + ' columns, their two primary keys, three indexes) - nothing removed or changed',
          d1.removed.length === 0 && j(d1.added.slice().sort()) === j(SYNC_COLS.slice().sort()) && k1.removed.length === 0 && k1.added.length === 2 && i1.removed.length === 0 && i1.added.length === 5, j({ d1: d1.added.filter(x => SYNC_COLS.indexOf(x) < 0), k1: k1, i1: i1.added.length }).slice(0, 400));
        const sameRows = Object.keys(sPr.rows).every(t => j(sPr.rows[t]) === j(sOn.rows[t]));
        ok('... and every row of every old table is as it was', sameRows);

        /* ROLLBACK: main boots on the database the PR migrated and used */
        const rb = await bootOld(flag);
        let work = {};
        try {
          const su = await req(rb.port, 'POST', '/api/auth/signup', { body: { email: 'rollback-sync@example.com', password: 'longenough1', displayName: 'Rollback' } });
          const lk = await req(rb.port, 'POST', '/api/pc-links', { body: {}, ip: '198.51.100.9' });
          work = { health: (await req(rb.port, 'GET', '/health')).status, su: su.status, shares: (await req(rb.port, 'GET', '/api/shares')).status, link: lk.status, sync: (await req(rb.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': code } })).status };
        } finally { await rb.close(); }
        const sRb = await snapshot(flag);
        const d2 = diff(sOn.cols, sRb.cols), k2 = diff(sOn.cons, sRb.cons), i2 = diff(sOn.idx, sRb.idx);
        ok('ROLLBACK: main boots on the migrated database (health, sign-up, shares, a PC link), the sync routes are 404 there, and it changed no table, column, constraint or index of what the PR made',
          work.health === 200 && work.su === 201 && work.shares === 200 && work.link === 201 && work.sync === 404 && d2.added.length + d2.removed.length + k2.added.length + k2.removed.length + i2.added.length + i2.removed.length === 0, j(work));
        ok('... and it did not touch a row of the sync tables', j(sRb.rows.ppp_sync_libs) === j(sOn.rows.ppp_sync_libs) && j(sRb.rows.ppp_sync_items) === j(sOn.rows.ppp_sync_items));

        /* ROLL FORWARD: the PR with the flag again; the library made before is whole, a second boot changes nothing */
        const fw = await bootPR(flag, { PPP_SYNC: '1' });
        let got;
        try {
          got = await req(fw.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': code } });
        } finally { await fw.close(); }
        const sFw = await snapshot(flag);
        const d3 = diff(sRb.cols, sFw.cols), k3 = diff(sRb.cons, sFw.cons), i3 = diff(sRb.idx, sFw.idx);
        ok('ROLL FORWARD: the PR boots again; the library made before the rollback is there with its items and revisions; the schema is unchanged', got.status === 200 && got.body.items.length === 2 && got.body.maxRev === 2
          && d3.added.length + d3.removed.length + k3.added.length + k3.removed.length + i3.added.length + i3.removed.length === 0, got.status + ' ' + got.text.slice(0, 120));
        ok('... and the sync rows are as they were (nothing was rewritten at the boot)', j(sFw.rows.ppp_sync_items.map(r => JSON.parse(r).rev)) === j(sOn.rows.ppp_sync_items.map(r => JSON.parse(r).rev)));

        /* the flag off again on a database that has the tables: the routes are 404, the data stays */
        const off = await bootPR(flag, {});
        let offAns;
        try { offAns = await req(off.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': code } }); } finally { await off.close(); }
        const sOff = await snapshot(flag);
        ok('the flag unset again on that database: the routes are 404 and the data is untouched (switching it off is not a deletion)', offAns.status === 404 && j(sOff.rows.ppp_sync_items) === j(sFw.rows.ppp_sync_items) && j(sOff.rows.ppp_sync_libs) === j(sFw.rows.ppp_sync_libs));
      }

      /* from an EMPTY database: a first boot with the flag; the same schema as a boot of main plus the PR's two */
      const empty = await mkDb('ppp_sync_empty');
      const e1 = await bootPR(empty, { PPP_SYNC: '1' });
      let sE;
      try { await req(e1.port, 'POST', '/api/libs', { body: {}, ip: '198.51.100.10' }); sE = await snapshot(empty); } finally { await e1.close(); }
      ok('a first boot on an empty database with the flag makes the two tables with the queue\'s', sE.names.indexOf('ppp_sync_libs') >= 0 && sE.names.indexOf('ppp_sync_items') >= 0 && sE.names.indexOf('ppp_pc_links') >= 0);
      const e2 = await bootPR(empty, { PPP_SYNC: '1' });
      let sE2;
      try { sE2 = await snapshot(empty); } finally { await e2.close(); }
      ok('a second boot changes nothing (schema and every row)', j(sE.cols) === j(sE2.cols) && j(sE.cons) === j(sE2.cons) && j(sE.idx) === j(sE2.idx) && j(sE.rows) === j(sE2.rows));

      /* twelve real processes at once */
      const race = await mkDb('ppp_sync_race');
      const boots = await Promise.all(Array.from({ length: 12 }, () => startServer({ PPP_SYNC: '1' }, { url: race.url }).then(s => s, err => ({ error: String(err && err.message) }))));
      const upN = boots.filter(b => !b.error).length;
      const tn = (await race.one(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ppp_sync_libs', 'ppp_sync_items')`))[0].n;
      ok('twelve real server.js processes booting together on an empty database with the flag: all twelve come up, and the two tables are there once', upN === 12 && tn === 2, upN + ' up; ' + boots.filter(b => b.error).map(b => b.error).slice(0, 2).join(' | '));
      const anyOff = boots.filter(b => !b.error).some(b => /Song sync: OFF/.test(b.log()));
      ok('... and none of them switched the feature off', !anyOff);
      await Promise.all(boots.filter(b => !b.error).map(b => b.close()));

      /* the feature is optional at the boot: a thing in the way of its tables switches it off, the site and the queue stay */
      const opt = await mkDb('ppp_sync_optional');
      await opt.q(PRODUCTION_SQL);
      await opt.q('CREATE VIEW ppp_sync_items AS SELECT 1 AS lib_id');
      const ob = await bootPR(opt, { PPP_SYNC: '1' });
      try {
        const out = ob.log();
        const lines = out.split('\n').filter(l => /Song sync: OFF/.test(l));
        ok('with something else in the way of ppp_sync_items the server STARTS and says once, in one line, that sync is off and why (the database error code)', (await req(ob.port, 'GET', '/health')).status === 200 && lines.length === 1 && /42809/.test(lines[0]) && /everything else is running/i.test(lines[0]), lines.join(' | ').slice(0, 200));
        ok('the line shows no secret (no connection string, no password, no environment)', out.indexOf(URL_) < 0 && !/postgres(ql)?:\/\//i.test(out) && out.indexOf(':pw@') < 0 && !/SESSION_SECRET|sync-pg-secret/.test(out));
        const a = await req(ob.port, 'POST', '/api/libs', { body: {}, ip: '198.51.100.11' });
        const b = await req(ob.port, 'GET', '/api/sync/changes?since=0', { headers: { 'X-PPP-Lib': '0'.repeat(64) } });
        ok('its routes answer 503 store with disabled:true', a.status === 503 && a.body.code === 'store' && a.body.disabled === true && b.status === 503 && b.body.disabled === true, a.status + ' ' + b.status);
        const su = await req(ob.port, 'POST', '/api/auth/signup', { body: { email: 'optional-sync@example.com', password: 'longenough1', displayName: 'Optional' } });
        const lk = await req(ob.port, 'POST', '/api/pc-links', { body: {}, ip: '198.51.100.12' });
        ok('the rest of the site works: sign-up, shares, and the PC queue (a link)', su.status === 201 && (await req(ob.port, 'GET', '/api/shares')).status === 200 && lk.status === 201);
      } finally { await ob.close(); }
    }
  } finally {
    if (srv) await srv.close();
    for (const n of dbs) { try { await q('DROP DATABASE IF EXISTS ' + n + ' WITH (FORCE)'); } catch (e) { /* the container is thrown away anyway */ } }
    if (oldDir) L.rmDir(oldDir);
    try { await dropViews(); } catch (e) { /* the database is gone */ }
    await pool.end();
  }
})().then(() => L.finish('the song-library store on Postgres'), e => { console.error(e); process.exit(1); });
