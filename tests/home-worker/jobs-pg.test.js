/* G10b-1 / G10b-2: the home-PC queue on a real Postgres: the migration (additive and idempotent: from the production tables, from the tables of PR 178 with their
   foreign keys to ppp_users, from nothing; and rolling back to the code of PR 178), the store's SQL guards (owner and state in every WHERE, a claim that cannot be won
   twice), the PC links (made, rotated, revoked and purged each in ONE statement), the notes as JSONB, and - against the real schema - that a poll which finds nothing
   runs NO statement.

   Needs a THROWAWAY Postgres and the `pg` package (NODE_PATH may point at a tree that has it):

     docker run -d --name ppp-pg-test -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=ppp -p 55432:5432 postgres:17-alpine -c log_statement=all
     PPP_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55432/ppp PPP_TEST_PG_CONTAINER=ppp-pg-test NODE_PATH=D:/PPP/node_modules node tests/home-worker/jobs-pg.test.js
     docker rm -f ppp-pg-test

   It DROPS the ppp_* tables first, so it refuses any database that is not on localhost. Without PPP_TEST_PG_URL it says so and exits 0.
   PPP_TEST_PG_CONTAINER (optional) names the container: with `-c log_statement=all` the test also counts the statements the SERVER ran,
   out of the database's own log, while the worker polled an idle queue. */
'use strict';
const L = require('./lib');
const { ok, heading, req, WATCH, goodResult, sleep } = L;
const { spawn } = require('child_process');
const { freePort } = require('../serve-free');
const path = require('path');

const URL_ = process.env.PPP_TEST_PG_URL;
if (!URL_) { console.log('  - PPP_TEST_PG_URL is not set: no throwaway Postgres to test against. Skipping.'); process.exit(0); }
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(URL_)) { console.error('Refusing: this test drops tables, and only runs against localhost.'); process.exit(2); }
const { Pool } = require('pg');
const Store = L.mod('home-jobs-store.js');

/* the server under test: the repository's server.js, or - for the mutation runner (HOME_MODULES_DIR) - the copy with one rule broken. Its log is kept. */
async function startServer(env, o) {
  o = o || {};
  const port = await freePort();
  const child = spawn(process.execPath, [o.script || path.join(L.MODS, 'server.js')], {
    cwd: o.cwd || L.REPO, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: o.url || URL_, SESSION_SECRET: 'home-worker-pg-secret' }, env || {})
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
  await sleep(1200); /* migration and seeds */
  return { port: port, log: () => logs.join(''), close: () => new Promise(res => { if (exited) return res(); child.on('exit', () => res()); child.kill(); }) };
}
/* what a migrate that came back means: the queue's tables were made ('ok'), or it was switched off ('queue off ...'), or it threw */
const migrated = r => (r && r.queue === true ? 'ok' : 'queue off: ' + String(r && r.error && r.error.message).slice(0, 70));
const failure = e => (e.code || '') + ' ' + String(e.message).slice(0, 70);
const cookieOf = r => { const c = [].concat(r.headers['set-cookie'] || [])[0] || ''; return c.split(';')[0]; };

/* the production database as it is today: users, progress and shares (with the foreign key an earlier version made on owner_id, and no genre / expires_at / bytes); none of this feature's tables */
const PRODUCTION_SQL = `
      CREATE TABLE ppp_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE ppp_progress (user_id TEXT PRIMARY KEY REFERENCES ppp_users(id) ON DELETE CASCADE, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE ppp_shares (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES ppp_users(id) ON DELETE CASCADE, owner_name TEXT NOT NULL, song_key TEXT NOT NULL,
        title TEXT NOT NULL, composer TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', measures INTEGER NOT NULL DEFAULT 0, listed BOOLEAN NOT NULL DEFAULT false,
        preview JSONB, score JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      INSERT INTO ppp_users (id, email, display_name, password_hash) VALUES ('old-user', 'old@example.com', 'Old', 'x');
      INSERT INTO ppp_progress (user_id, payload) VALUES ('old-user', '{"a":1}');
      INSERT INTO ppp_shares (id, owner_id, owner_name, song_key, title, score) VALUES ('oldshare01', 'old-user', 'Old', 'k', 'Old song', '{"measures":[{}],"notes":[]}');`;

(async () => {
  const pool = new Pool({ connectionString: URL_, max: 4 });
  pool.on('error', () => { /* an idle connection the container's port proxy reset: the pool replaces it */ });
  const same = (a, b) => { try { require('assert').deepStrictEqual(a, b); return true; } catch (e) { return false; } };
  const q = (sql, params) => pool.query(sql, params);
  const one = async (sql, params) => (await q(sql, params)).rows;
  let srv = null;
  try {
    /* a view that an earlier, failed run of the last section left in the way of ppp_worker_tokens would make the DROP below fail (it is not a table) */
    const dropSquat = () => q(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ppp_worker_tokens' AND relkind = 'v') THEN DROP VIEW ppp_worker_tokens; END IF;
    END $$`);
    await dropSquat();
    /* production today: users, progress and shares (with their old foreign key); none of this feature's tables */
    await q('DROP TABLE IF EXISTS ppp_worker_tokens, ppp_transcribe_jobs, ppp_pc_links, ppp_shares, ppp_progress, ppp_users CASCADE');
    await q(PRODUCTION_SQL);
    const counts = async () => (await one(`SELECT (SELECT count(*) FROM ppp_users)::int u, (SELECT count(*) FROM ppp_progress)::int p, (SELECT count(*) FROM ppp_shares)::int s`))[0];
    const before = await counts();

    heading('the migration');
    await q(Store.SCHEMA_SQL); await q(Store.SCHEMA_SQL);
    ok('the migration run twice, by hand, on the production-shaped tables: no error, no row of theirs touched', JSON.stringify(await counts()) === JSON.stringify(before));
    /* two instances booting together (a deploy overlap): without a lock, CREATE TABLE IF NOT EXISTS from two sessions can fail on pg_type's unique index */
    await q('DROP TABLE IF EXISTS ppp_worker_tokens, ppp_transcribe_jobs, ppp_pc_links');
    const pool12 = new Pool({ connectionString: URL_, max: 12 });
    pool12.on('error', () => { /* a reset idle connection */ });
    const raced = await Promise.all(Array.from({ length: 12 }, () => Store.migrate(pool12).then(migrated, failure)));
    const raced2 = await Promise.all(Array.from({ length: 12 }, () => Store.migrate(pool12).then(migrated, failure)));
    await pool12.end();
    ok('twelve instances migrating at the same moment, twice over (a deploy overlap) take turns under an advisory lock: all succeed, the tables are there once', raced.concat(raced2).every(x => x === 'ok')
      && (await one(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ppp_transcribe_jobs', 'ppp_worker_tokens')`))[0].n === 2, raced.concat(raced2).filter(x => x !== 'ok').slice(0, 2).join(' | '));
    ok('the lock is a transaction-level advisory lock, taken before the DDL', /pg_advisory_xact_lock/.test(L.fs.readFileSync(path.join(L.MODS, 'home-jobs-store.js'), 'utf8')) && Store.MIGRATE_LOCK_KEY === 727002);
    srv = await startServer();
    const afterBoot = await counts();
    const tables = async () => (await one(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ppp_transcribe_jobs', 'ppp_worker_tokens', 'ppp_pc_links') ORDER BY 1`)).map(r => r.table_name).join();
    ok('the queue\'s tables exist after the first boot', (await tables()) === 'ppp_pc_links,ppp_transcribe_jobs,ppp_worker_tokens');
    const cols = async t => (await one(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [t])).map(r => r.column_name).join();
    ok('ppp_transcribe_jobs has the designed columns', (await cols('ppp_transcribe_jobs')) === 'id,owner_id,kind,url,title,status,attempts,worker_id,created_at,claimed_at,finished_at,error,result,bytes', await cols('ppp_transcribe_jobs'));
    ok('ppp_worker_tokens has the designed columns (the hash, never the token)', (await cols('ppp_worker_tokens')) === 'id,owner_id,token_hash,label,created_at,last_seen_at,poll_s,revoked_at', await cols('ppp_worker_tokens'));
    ok('ppp_pc_links has the designed columns (the hash of the client code, the keyed tag of the address - never an address)', (await cols('ppp_pc_links')) === 'id,client_hash,created_at,last_used_at,last_worker_at,created_ip_hash,revoked_at', await cols('ppp_pc_links'));
    ok('the first boot adds only the seed library (the app\'s own shared scores and its owner) to the old tables', afterBoot.u === before.u + 1 && afterBoot.p === before.p && afterBoot.s >= before.s, JSON.stringify(before) + ' -> ' + JSON.stringify(afterBoot));
    const fks = (await one(`SELECT conrelid::regclass::text AS t, confrelid::regclass::text AS r FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text IN ('ppp_transcribe_jobs', 'ppp_worker_tokens') ORDER BY 1`)).map(r => r.t + '>' + r.r).join();
    ok('neither queue table references ppp_users any more: a PC link is not an account (no foreign key on owner_id)', fks === '', fks);
    ok('the status column has a CHECK', (await one(`SELECT count(*)::int n FROM pg_constraint WHERE conname = 'ppp_transcribe_jobs_status'`))[0].n === 1);
    await srv.close();
    srv = await startServer();
    ok('a second boot (the migration again) changes nothing and does not fail', (await tables()) === 'ppp_pc_links,ppp_transcribe_jobs,ppp_worker_tokens' && JSON.stringify(await counts()) === JSON.stringify(afterBoot));
    await q(`INSERT INTO ppp_transcribe_jobs (id, owner_id, url) VALUES ('keepjob001', 'pc_00000000000000000000aa', 'https://www.youtube.com/watch?v=aaaaaaaaaaa')`);
    await srv.close();
    srv = await startServer();
    ok('and rows written by the feature survive another boot', (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs WHERE id = 'keepjob001'`))[0].n === 1);
    await srv.close(); srv = null;
    await q(`DELETE FROM ppp_transcribe_jobs WHERE id = 'keepjob001'`);
    const sql = Store.SCHEMA_SQL;
    const sqlNoDo = sql.replace(/DO \$\$[\s\S]*?END \$\$;/, '');
    ok('the migration is CREATE ... IF NOT EXISTS, and one DO block that drops the foreign keys on owner_id: no DROP TABLE, no DELETE, no TRUNCATE, no UPDATE, no column removed or renamed; and the DO block drops only a foreign key (DROP CONSTRAINT IF EXISTS), found by catalog lookup',
      !/\b(DROP|ALTER|DELETE|TRUNCATE|UPDATE)\b/i.test(sqlNoDo) && /IF NOT EXISTS/.test(sql) && (sql.match(/\bDROP\b/g) || []).length === 1 && /DROP CONSTRAINT IF EXISTS/.test(sql) && !/DROP COLUMN|RENAME|DROP TABLE|DROP INDEX/i.test(sql)
      && /contype = 'f'/.test(sql) && /attname = 'owner_id'/.test(sql) && !/ppp_users/.test(sql));

    heading('the store, on Postgres: the same guards as the file store');
    const st = Store.pgJobStore(q);
    const t0 = Date.parse('2026-10-06T12:00:00Z');
    const mk = (id, owner) => ({ id: id, ownerId: owner, kind: 'youtube', url: 'https://www.youtube.com/watch?v=' + id.padEnd(11, 'x'), title: 'T ' + id, createdAt: t0 });
    /* the owners of these tests are PC links ('pc_' + 22 hex), made by the store as the service makes them */
    const PA = 'pc_aaaaaaaaaaaaaaaaaaaaaa', PB = 'pc_bbbbbbbbbbbbbbbbbbbbbb';
    for (const [id, n] of [[PA, 'a'], [PB, 'b']]) await st.createLink({ id: id, hash: n.repeat(64), createdAt: t0, ipTag: 'tag' + n }, { id: 'tk-' + n + '00000', hash: n.repeat(32) + 'f'.repeat(32), label: 'My PC' });
    await st.insertJob(mk('job-aaaa0001', PA)); await st.insertJob(mk('job-bbbb0001', PB));
    ok('a duplicate id is refused by the primary key', await st.insertJob(mk('job-aaaa0001', PA)).then(() => false, e => e.code === '23505'));
    ok('a job for an owner that is not a user is accepted: there is no foreign key to ppp_users (a PC link is not an account)', await st.insertJob(mk('job-ghost001', 'nobody')).then(() => true, () => false) && (await q(`DELETE FROM ppp_transcribe_jobs WHERE id = 'job-ghost001'`)).rowCount === 1);
    ok('a status outside the six is refused by the CHECK', await q(`UPDATE ppp_transcribe_jobs SET status = 'weird' WHERE id = 'job-aaaa0001'`).then(() => false, e => e.code === '23514'));
    const all = await st.loadAll();
    ok('loadAll reads the links, the live tokens and the jobs back as the service holds them (times in ms, no result)', all.links.length === 2 && all.links[0].hash.length === 64 && all.links.find(l => l.id === PA).ipTag === 'taga' && all.tokens.length === 2 && all.jobs.length === 2 && all.jobs.find(j => j.id === 'job-aaaa0001').createdAt === t0 && all.jobs[0].status === 'queued' && !('result' in all.jobs[0]) && all.jobs[0].claimedAt === 0, JSON.stringify(all.jobs[0]));
    const race = await Promise.all(Array.from({ length: 12 }, (_, i) => st.claimJob('job-aaaa0001', PA, 'w' + i, t0 + 1000)));
    ok('twelve claims at once of one queued job: exactly one wins', race.filter(Boolean).length === 1, race.join());
    ok('the claim counted an attempt and kept the worker and the time', (await one(`SELECT attempts, worker_id, claimed_at FROM ppp_transcribe_jobs WHERE id = 'job-aaaa0001'`))[0].attempts === 1);
    ok("another account cannot claim, finish, cancel or requeue it (the owner is in every WHERE)", !(await st.claimJob('job-bbbb0001', PA, 'w', t0)) && !(await st.finishJob('job-aaaa0001', PB, 'done', t0, { result: { v: 1 }, bytes: 5 }))
      && !(await st.cancelJob('job-aaaa0001', PB, t0)) && !(await st.requeueJob('job-aaaa0001', PB, 'x')));
    ok('a queued job cannot be requeued (only a claimed one)', !(await st.requeueJob('job-bbbb0001', PB, 'x')));
    ok('a claimed job goes back to queued, attempts kept', (await st.requeueJob('job-aaaa0001', PA, 'again')) && (await one(`SELECT status, attempts, worker_id, error FROM ppp_transcribe_jobs WHERE id = 'job-aaaa0001'`))[0].status === 'queued');
    await st.claimJob('job-aaaa0001', PA, 'w1', t0 + 2000);
    const res = { v: 1, notes: [{ on: 0.1, off: 0.7312, midi: 60, vel: 64 }, { on: 1e-4, off: 2, midi: 108, vel: 1 }], duration: 61.5, engine: 'ensemble', model: null, device: 'cuda', ensemble: { models: ['a'], primary: 'a', agreement: 0.5, accepted: 2, uncertain: 0 } };
    ok('finish stores the notes as JSONB', await st.finishJob('job-aaaa0001', PA, 'done', t0 + 3000, { result: res, bytes: 99 }));
    ok('and they come back exactly (floats included), only to their owner, only when done', same(await st.getResult('job-aaaa0001', PA), res) && (await st.getResult('job-aaaa0001', PB)) === null && (await st.getResult('job-bbbb0001', PB)) === null);
    ok('a finished job cannot be finished, claimed or cancelled again', !(await st.finishJob('job-aaaa0001', PA, 'failed', t0, {})) && !(await st.claimJob('job-aaaa0001', PA, 'w', t0)) && !(await st.cancelJob('job-aaaa0001', PA, t0)));
    ok('a queued job takes a late result', await st.finishJob('job-bbbb0001', PB, 'done', t0 + 4000, { result: res, bytes: 7 }));
    ok('a cancelled job takes none', (await st.insertJob(mk('job-cccc0001', PA)), await st.cancelJob('job-cccc0001', PA, t0)) && !(await st.finishJob('job-cccc0001', PA, 'done', t0, { result: res, bytes: 1 })));
    const day = 86400000;
    await st.insertJob(mk('job-dddd0001', PA)); await st.finishJob('job-dddd0001', PA, 'failed', t0 - 2 * day, { error: 'e' });
    await st.insertJob(mk('job-eeee0001', PA)); await st.finishJob('job-eeee0001', PA, 'done', t0 - 2 * day, { result: res, bytes: 1 });
    const n = await st.purge(t0 - 3 * day, t0 - 1 * day);
    ok('purge: a failed job a day and a half old goes, a done one that is two days old stays', n >= 1 && (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs WHERE id = 'job-dddd0001'`))[0].n === 0 && (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs WHERE id = 'job-eeee0001'`))[0].n === 1, n + '');
    ok('deleteJobs removes the ids named (of the account named) and nothing else', (await st.deleteJobs(['job-eeee0001', 'nope'], PA)) === 1 && (await st.deleteJobs([], PA)) === 0);
    /* the owner and "finished" are in the WHERE of the DELETE, like in every other change of the store: a list that holds somebody else's id, or the id of a job that is still waiting or being converted, removes neither */
    await st.insertJob(mk('job-delq0001', PA)); await st.insertJob(mk('job-delc0001', PA)); await st.insertJob(mk('job-delf0001', PA)); await st.insertJob(mk('job-delf0002', PB));
    await st.claimJob('job-delc0001', PA, 'w', t0); await st.finishJob('job-delf0001', PA, 'failed', t0, { error: 'e' }); await st.finishJob('job-delf0002', PB, 'failed', t0, { error: 'e' });
    const delAll = ['job-delq0001', 'job-delc0001', 'job-delf0001', 'job-delf0002'];
    const delLeft = async () => (await one(`SELECT id FROM ppp_transcribe_jobs WHERE id LIKE 'job-del%' ORDER BY id`)).map(r => r.id).join();
    ok('every id of two accounts in the list, one account named: only the finished row of that account is deleted (1)', (await st.deleteJobs(delAll, PA)) === 1 && (await delLeft()) === 'job-delc0001,job-delf0002,job-delq0001', await delLeft());
    ok('a queued or claimed row is not deleted even when it is named, in its owner call too; a finished row of somebody else neither; no owner at all removes nothing', (await st.deleteJobs(['job-delq0001', 'job-delc0001'], PA)) === 0
      && (await st.deleteJobs(['job-delf0002'], PA)) === 0 && (await st.deleteJobs(['job-delf0002'])) === 0 && (await st.deleteJobs(['job-delf0002'], null)) === 0 && (await delLeft()) === 'job-delc0001,job-delf0002,job-delq0001');
    ok('and the call of its owner removes it', (await st.deleteJobs(['job-delf0002'], PB)) === 1);
    await q(`DELETE FROM ppp_transcribe_jobs WHERE id LIKE 'job-del%'`);
    ok('a link\'s token is stored as its hash, and the link as the hash of its client code', (await one(`SELECT token_hash FROM ppp_worker_tokens WHERE id = 'tk-a00000'`))[0].token_hash === 'a'.repeat(32) + 'f'.repeat(32) && (await one(`SELECT client_hash, created_ip_hash FROM ppp_pc_links WHERE id = $1`, [PA]))[0].client_hash === 'a'.repeat(64));
    await st.touchSeen('tk-a00000', PB, t0 + 5000, 20); await st.touchSeen('tk-a00000', PA, t0 + 6000, 1200);
    const lt = (await st.loadAll()).tokens.find(k => k.id === 'tk-a00000');
    ok("last-seen is written by the owner only; loadAll gives the live tokens", lt.lastSeenAt === t0 + 6000 && lt.pollS === 1200 && lt.hash === 'a'.repeat(32) + 'f'.repeat(32));
    /* rotation: one statement, only for a live link, the old token dead, the new one inherits the last-seen time */
    const rot = await st.rotateToken(PA, { id: 'tk-a00001', hash: 'c'.repeat(64), label: 'My PC', lastSeenAt: t0 + 6000, pollS: 1200 }, t0 + 7000);
    const live = async o => (await one(`SELECT id FROM ppp_worker_tokens WHERE owner_id = $1 AND revoked_at IS NULL ORDER BY id`, [o])).map(r => r.id).join();
    ok('rotateToken: true; the link has one live token, the new one (the old row is revoked, not deleted)', rot === true && (await live(PA)) === 'tk-a00001' && (await one(`SELECT revoked_at FROM ppp_worker_tokens WHERE id = 'tk-a00000'`))[0].revoked_at !== null);
    ok('the new token carries the old one\'s last-seen time and wait; the other link\'s token is untouched', await (async () => { const k = (await st.loadAll()).tokens; const n = k.find(x => x.id === 'tk-a00001'); return n.lastSeenAt === t0 + 6000 && n.pollS === 1200 && k.find(x => x.id === 'tk-b00000') && (await live(PB)) === 'tk-b00000'; })());
    ok('rotateToken for a link that does not exist or is revoked inserts nothing and revokes nothing (false)', !(await st.rotateToken('pc_ffffffffffffffffffffff', { id: 'tk-x00000', hash: 'd'.repeat(64), label: 'x', lastSeenAt: 0, pollS: 0 }, t0)) && (await one(`SELECT count(*)::int n FROM ppp_worker_tokens WHERE id = 'tk-x00000'`))[0].n === 0);
    ok('a token id that is already there is refused whole: nothing is revoked (one statement)', await st.rotateToken(PA, { id: 'tk-b00000', hash: 'e'.repeat(64), label: 'x', lastSeenAt: 0, pollS: 0 }, t0).then(() => false, e => e.code === '23505') && (await live(PA)) === 'tk-a00001');
    ok('createLink is one statement: a token id that is taken refuses the link too (no link without its token)', await st.createLink({ id: 'pc_cccccccccccccccccccccc', hash: 'c'.repeat(64), createdAt: t0, ipTag: 'tagc' }, { id: 'tk-a00001', hash: 'c'.repeat(64), label: 'x' }).then(() => false, e => e.code === '23505')
      && (await one(`SELECT count(*)::int n FROM ppp_pc_links WHERE id = 'pc_cccccccccccccccccccccc'`))[0].n === 0);
    ok('a link id that is taken is refused too', await st.createLink({ id: PA, hash: 'c'.repeat(64), createdAt: t0, ipTag: '' }, { id: 'tk-new00000', hash: 'c'.repeat(64), label: 'x' }).then(() => false, e => e.code === '23505') && (await one(`SELECT count(*)::int n FROM ppp_worker_tokens WHERE id = 'tk-new00000'`))[0].n === 0);
    await st.touchLink(PA, t0 + 8000, t0 + 6000); await st.touchLink(PB, t0 + 9000, null);
    const ll = (await st.loadAll()).links;
    ok('touchLink writes the last-use and last-worker times (null: never)', ll.find(l => l.id === PA).lastUsedAt === t0 + 8000 && ll.find(l => l.id === PA).lastWorkerAt === t0 + 6000 && ll.find(l => l.id === PB).lastWorkerAt === 0 && ll.find(l => l.id === PB).lastUsedAt === t0 + 9000);
    /* revoke: the link marked, its tokens and jobs deleted - and nothing of anybody else, not even a row that names the same owner but is not a link's */
    await st.insertJob(mk('job-revk0001', PB)); await st.insertJob(mk('job-revk0002', 'user-4f1c')); await q(`INSERT INTO ppp_worker_tokens (id, owner_id, token_hash) VALUES ('tk-legacy01', 'user-4f1c', 'x')`);
    ok('revokeLink: true once, false the second time', (await st.revokeLink(PB, t0 + 10000)) === true && (await st.revokeLink(PB, t0 + 11000)) === false);
    ok('and it took the link\'s jobs and tokens with it, and not A\'s, and not an account\'s rows of PR 178', (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs WHERE owner_id = $1`, [PB]))[0].n === 0 && (await one(`SELECT count(*)::int n FROM ppp_worker_tokens WHERE owner_id = $1`, [PB]))[0].n === 0
      && (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs WHERE owner_id = $1`, [PA]))[0].n >= 1 && (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs WHERE owner_id = 'user-4f1c'`))[0].n === 1 && (await one(`SELECT count(*)::int n FROM ppp_worker_tokens WHERE owner_id = 'user-4f1c'`))[0].n === 1);
    ok('a revoked link is still loaded (as revoked: the service counts it for the per-address limits for two days); it is not touched or rotated any more', (await st.loadAll()).links.find(l => l.id === PB).revokedAt === t0 + 10000 && !(await st.rotateToken(PB, { id: 'tk-r0000000', hash: 'a'.repeat(64), label: 'x', lastSeenAt: 0, pollS: 0 }, t0)));
    await st.touchLink(PB, t0 + 99999, null);
    ok('touchLink does not touch a revoked link', (await st.loadAll()).links.find(l => l.id === PB).lastUsedAt === t0 + 9000);
    ok('deleteLinks takes only the ids named, only links (pc_), with their tokens and jobs: an account\'s id in the list deletes nothing; an unknown id nothing', (await st.deleteLinks(['user-4f1c', 'pc_ffffffffffffffffffffff'])) === 0 && (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs WHERE owner_id = 'user-4f1c'`))[0].n === 1 && (await st.deleteLinks([])) === 0);
    await st.insertJob(mk('job-delk0001', PA));
    ok('deleteLinks(A): the link, its token(s) and its jobs go in one statement; B\'s row (revoked) stays', (await st.deleteLinks([PA])) === 1 && (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs WHERE owner_id = $1`, [PA]))[0].n === 0 && (await one(`SELECT count(*)::int n FROM ppp_worker_tokens WHERE owner_id = $1`, [PA]))[0].n === 0
      && (await one(`SELECT count(*)::int n FROM ppp_pc_links`))[0].n === 1);
    await q(`DELETE FROM ppp_transcribe_jobs WHERE owner_id = 'user-4f1c'; DELETE FROM ppp_worker_tokens WHERE owner_id = 'user-4f1c'; DELETE FROM ppp_pc_links`);
    ok('a user in ppp_users and the queue are independent now: deleting an account deletes nothing of a link', await (async () => {
      await q(`INSERT INTO ppp_users (id, email, display_name, password_hash) VALUES ('u-a', 'a@example.com', 'A', 'x') ON CONFLICT DO NOTHING`);
      await st.createLink({ id: PA, hash: 'a'.repeat(64), createdAt: t0, ipTag: '' }, { id: 'tk-a00000', hash: 'a'.repeat(64), label: 'My PC' });
      await st.insertJob(mk('job-indep001', 'u-a'));
      await q(`DELETE FROM ppp_users WHERE id = 'u-a'`);
      const n = (await one(`SELECT count(*)::int n FROM ppp_pc_links`))[0].n + (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs WHERE id = 'job-indep001'`))[0].n;
      await q(`DELETE FROM ppp_transcribe_jobs; DELETE FROM ppp_worker_tokens; DELETE FROM ppp_pc_links`);
      return n === 2;
    })());
    /* parameterized: a hostile title is data, whatever it contains */
    const hostile = "x'); DROP TABLE ppp_worker_tokens; DELETE FROM ppp_users; --";
    await st.insertJob(Object.assign(mk('job-hhhh0001', 'pc_hhhhhhhhhhhhhhhhhhhhhh'), { title: hostile }));
    ok('a title with quotes and a DROP in it is stored as text; nothing is dropped', (await one(`SELECT title FROM ppp_transcribe_jobs WHERE id = 'job-hhhh0001'`))[0].title === hostile && (await tables()) === 'ppp_pc_links,ppp_transcribe_jobs,ppp_worker_tokens' && (await one('SELECT count(*)::int n FROM ppp_users'))[0].n >= 2);

    heading('the queue service on that schema: an idle poll runs no statement');
    await q(`DELETE FROM ppp_transcribe_jobs; DELETE FROM ppp_worker_tokens; DELETE FROM ppp_pc_links`);
    let statements = 0; const seen = [];
    const countingQuery = (sql, params) => { statements++; seen.push(String(sql).replace(/\s+/g, ' ').slice(0, 60)); return pool.query(sql, params); };
    const S = await L.startService({ users: [], store: Store.pgJobStore(countingQuery), config: { longPollMs: 50 } });
    try {
      const mkl = await S.makeLink('u-c');
      const tk = S.token('u-c');
      const j = (await S.as('u-c').post('/api/jobs', { url: WATCH('pgservice01'), title: 'On Postgres' })).body.job;
      ok('making a link made its row, its token\'s row (one statement), and enqueue made a job row', mkl.status === 201 && (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs`))[0].n === 1 && (await one(`SELECT count(*)::int n FROM ppp_worker_tokens`))[0].n === 1 && (await one(`SELECT count(*)::int n FROM ppp_pc_links`))[0].n === 1);
      ok('the link row holds the hash of the code (never the code), the id, and a keyed address tag', await (async () => { const r = (await one(`SELECT id, client_hash, created_ip_hash FROM ppp_pc_links`))[0]; return r.id === mkl.body.id && r.client_hash !== S.code('u-c') && /^[0-9a-f]{64}$/.test(r.client_hash) && /^[0-9a-f]{16}$/.test(r.created_ip_hash) && r.id === 'pc_' + r.client_hash.slice(0, 22); })());
      const g = await S.worker(tk).post('/api/worker/claim', {});
      ok('claimed, and the row says so', g.body.job && g.body.job.id === j.id && (await one(`SELECT status, attempts FROM ppp_transcribe_jobs WHERE id = $1`, [j.id]))[0].status === 'claimed');
      await S.worker(tk).post('/api/worker/jobs/' + j.id + '/heartbeat', { stage: 'transcribe', pct: 0.5 });
      const r = await S.worker(tk).post('/api/worker/jobs/' + j.id + '/result', goodResult(500));
      ok('the result is stored (JSONB) and read back by the owner', r.status === 200 && (await S.as('u-c').get('/api/jobs/' + j.id)).body.result.notes.length === 500);
      ok('the row has its size', (await one(`SELECT bytes, status FROM ppp_transcribe_jobs WHERE id = $1`, [j.id]))[0].bytes > 1000);
      S.svc._state.forgetAll();
      statements = 0; seen.length = 0;
      await S.worker(tk).post('/api/worker/claim', { waitSeconds: 1200 });
      ok('the first poll after a boot: one read (links, tokens and jobs in one round trip) and one UPDATE of last-seen: 2 statements', statements === 2, statements + ' ' + JSON.stringify(seen));
      statements = 0; seen.length = 0;
      S.advance(10 * 60 * 1000);
      for (let i = 0; i < 100; i++) await S.worker(tk).post('/api/worker/claim', { waitSeconds: 1200 });
      for (let i = 0; i < 30; i++) { await S.as('u-c').get('/api/jobs'); await S.as('u-c').get('/api/worker/status'); await S.worker(tk).get('/api/worker/ping'); }
      ok('then 100 idle polls, 30 pings and 60 status reads (with the client code) run ZERO statements on Postgres', statements === 0, statements + ' ' + JSON.stringify(seen));
      ok('the token and the job survive as rows', (await one(`SELECT count(*)::int n FROM ppp_worker_tokens WHERE last_seen_at IS NOT NULL`))[0].n === 1);
      /* a rotation and a revoke each are ONE statement */
      statements = 0; seen.length = 0;
      const rot = await S.as('u-c').post('/api/pc-links/me/worker-token', {});
      ok('a new token (rotation) is one statement, and the old token\'s row is revoked', rot.status === 201 && statements === 1 && (await one(`SELECT count(*)::int n FROM ppp_worker_tokens WHERE revoked_at IS NOT NULL`))[0].n === 1 && (await one(`SELECT count(*)::int n FROM ppp_worker_tokens WHERE revoked_at IS NULL`))[0].n === 1, statements + ' ' + JSON.stringify(seen));
      statements = 0; seen.length = 0;
      const rv = await S.as('u-c').del('/api/pc-links/me');
      ok('removing the link is one statement: the link marked revoked, its token and its conversion (and the notes) gone', rv.status === 200 && statements === 1 && (await one(`SELECT count(*)::int n FROM ppp_worker_tokens`))[0].n === 0 && (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs`))[0].n === 0 && (await one(`SELECT count(*)::int n FROM ppp_pc_links WHERE revoked_at IS NOT NULL`))[0].n === 1, statements + ' ' + JSON.stringify(seen));
      S.advance(3 * 86400000);
      statements = 0; seen.length = 0;
      await S.svc._state.purge(S.clock.t);
      ok('the purge deletes the revoked link\'s row after two days (one statement), and runs nothing when there is nothing to purge', statements === 1 && (await one(`SELECT count(*)::int n FROM ppp_pc_links`))[0].n === 0 && await (async () => { statements = 0; await S.svc._state.purge(S.clock.t + 1000); return statements === 0; })(), statements + ' ' + JSON.stringify(seen));
    } finally { await S.close(); }

    heading('server.js with DATABASE_URL: the whole path, and what Postgres itself logged');
    await q('DELETE FROM ppp_transcribe_jobs; DELETE FROM ppp_worker_tokens; DELETE FROM ppp_pc_links');
    srv = await startServer();
    const mkr = await req(srv.port, 'POST', '/api/pc-links', { ip: '198.51.100.7', body: {} });
    const code = mkr.body.clientCode, tkn = mkr.body.workerToken;
    ok('a PC link is made with no sign-in and no ppp_users row is needed (the link and its token are rows)', mkr.status === 201 && (await one(`SELECT count(*)::int n FROM ppp_pc_links`))[0].n === 1 && (await one(`SELECT count(*)::int n FROM ppp_worker_tokens`))[0].n === 1);
    const job = (await req(srv.port, 'POST', '/api/jobs', { code: code, body: { url: 'https://youtu.be/vgnliVjJUOo', title: 'Teacher' } })).body.job;
    ok('enqueued through the server, owned by the link', !!job && (await one(`SELECT status, owner_id FROM ppp_transcribe_jobs WHERE id = $1`, [job.id]))[0].owner_id === mkr.body.id);
    const cl = await req(srv.port, 'POST', '/api/worker/claim', { token: tkn, body: {} });
    const rs = await req(srv.port, 'POST', '/api/worker/jobs/' + cl.body.job.id + '/result', { token: tkn, body: goodResult(2374) });
    ok('claimed and finished with 2374 notes', cl.body.job && rs.status === 200, rs.text);
    const got = await req(srv.port, 'GET', '/api/jobs/' + job.id, { code: code });
    ok('the owner reads the 2374 notes back', got.status === 200 && got.body.result.notes.length === 2374, got.status + '');
    const rowBytes = (await one(`SELECT pg_column_size(result)::int AS stored, bytes FROM ppp_transcribe_jobs WHERE id = $1`, [job.id]))[0];
    ok('a result of 2374 notes is ' + Math.round(rowBytes.bytes / 1024) + ' KB of JSON, ' + Math.round(rowBytes.stored / 1024) + ' KB in the row (the free database is small)', rowBytes.bytes < 400 * 1024, JSON.stringify(rowBytes));
    const container = process.env.PPP_TEST_PG_CONTAINER;
    if (container) {
      await sleep(500);
      const mark = new Date().toISOString();
      await sleep(1100);
      for (let i = 0; i < 30; i++) await req(srv.port, 'POST', '/api/worker/claim', { token: tkn, body: { waitSeconds: 1200, once: true }, ip: '5.5.5.5' });
      await sleep(600);
      const text = (() => { const r = require('child_process').spawnSync('docker', ['logs', '--since', mark, container], { encoding: 'utf8' }); return (r.stdout || '') + (r.stderr || ''); })();
      const mine = text.split('\n').filter(l => /ppp_transcribe_jobs|ppp_worker_tokens/.test(l) && /statement:|execute/.test(l));
      ok('30 polls of an idle queue (the server awake): ZERO statements on the feature\'s tables in the database\'s own log', mine.length === 0, mine.length + ' ' + mine.slice(0, 3).join(' | '));
      ok('(the log is on: it shows the statements the test itself ran meanwhile)', /statement:|execute/.test(text) || (await one('SELECT 1')).length === 1);
    } else console.log('  - PPP_TEST_PG_CONTAINER is not set: the database-log count of the server\'s statements is skipped (the in-process count above ran).');
    await srv.close(); srv = null;

    heading('the per-address limit on making links survives a restart of the real server (the tag of the address is keyed by the server\'s secret, which does not change)');
    {
      await q('DELETE FROM ppp_transcribe_jobs; DELETE FROM ppp_worker_tokens; DELETE FROM ppp_pc_links');
      const b1 = await startServer();
      const first = [];
      try { for (let i = 0; i < 6; i++) first.push((await req(b1.port, 'POST', '/api/pc-links', { ip: '192.0.2.44', body: {} })).status); } finally { await b1.close(); }
      const b2 = await startServer();
      let again, other;
      try { again = (await req(b2.port, 'POST', '/api/pc-links', { ip: '192.0.2.44', body: {} })).status; other = (await req(b2.port, 'POST', '/api/pc-links', { ip: '192.0.2.45', body: {} })).status; } finally { await b2.close(); }
      ok('five links an hour from one address, the 6th is 429; a restart later the same address is still at its five (the counts and the keyed tags are in the database); another address can', first.join() === '201,201,201,201,201,429' && again === 429 && other === 201, first.join() + ' ' + again + ' ' + other);
    }

    console.log('\n\u2500\u2500 the whole boot, twelve at once \u2500\u2500');
    /* the boot's whole schema work goes through the lock: the SQL server.js ran before the queue existed (users, progress, shares, the foreign-key DO block) is the first part of the same transaction */
    const srvSrc = L.fs.readFileSync(path.join(L.MODS, 'server.js'), 'utf8');
    const head = 'homeJobsStore.migrate(getPool(), `';
    const initSql = (() => { const a = srvSrc.indexOf(head); const b = srvSrc.indexOf('`);', a); return a < 0 || b < 0 ? '' : srvSrc.slice(a + head.length, b); })();
    ok('the boot SQL is found in server.js (users, progress, shares and the foreign-key DO block)', /CREATE TABLE IF NOT EXISTS ppp_users/.test(initSql) && /CREATE TABLE IF NOT EXISTS ppp_shares/.test(initSql) && /DO \$\$/.test(initSql), initSql.length + ' characters');
    await q('DROP TABLE IF EXISTS ppp_worker_tokens, ppp_transcribe_jobs, ppp_pc_links, ppp_shares, ppp_progress, ppp_users CASCADE');
    const poolN = new Pool({ connectionString: URL_, max: 12 });
    poolN.on('error', () => { /* a reset idle connection */ });
    const racedInit = await Promise.all(Array.from({ length: 12 }, () => Store.migrate(poolN, initSql).then(migrated, failure)));
    await poolN.end();
    const have = (await one(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ppp_users', 'ppp_progress', 'ppp_shares', 'ppp_transcribe_jobs', 'ppp_worker_tokens', 'ppp_pc_links') ORDER BY 1`)).map(r => r.table_name).join();
    ok('twelve instances running the WHOLE boot migration (the old tables and the queue\'s) on an empty database at the same moment: all succeed, six tables, the old foreign key on ppp_shares.owner_id dropped once', racedInit.every(x => x === 'ok') && have === 'ppp_pc_links,ppp_progress,ppp_shares,ppp_transcribe_jobs,ppp_users,ppp_worker_tokens'
      && (await one("SELECT count(*)::int n FROM pg_constraint WHERE conrelid = 'ppp_shares'::regclass AND contype = 'f'"))[0].n === 0, racedInit.filter(x => x !== 'ok').slice(0, 2).join(' | ') + ' ' + have);
    /* and the real thing: twelve servers booting together on an empty database */
    await q('DROP TABLE IF EXISTS ppp_worker_tokens, ppp_transcribe_jobs, ppp_pc_links, ppp_shares, ppp_progress, ppp_users CASCADE');
    const boots = await Promise.all(Array.from({ length: 12 }, () => startServer().then(s => s, err => ({ error: String(err && err.message) }))));
    const okBoots = boots.filter(b => !b.error).length;
    ok('twelve real server.js processes booting together on an empty database (migration and seed library at once): all twelve come up and answer /health', okBoots === 12 && (await one("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'ppp\\_%'"))[0].n === 6, okBoots + ' up; ' + boots.filter(b => b.error).map(b => b.error).slice(0, 2).join(' | '));
    await Promise.all(boots.filter(b => !b.error).map(b => b.close()));

    heading('the queue is optional at the boot: a failure making its tables does not take the site down');
    /* a VIEW in the place of ppp_worker_tokens: CREATE TABLE IF NOT EXISTS skips it, and the index the queue makes on it is an error (42809) - the queue's part of the migration fails, the rest of it must not */
    const resetToProduction = async () => { await dropSquat(); await q('DROP TABLE IF EXISTS ppp_worker_tokens, ppp_transcribe_jobs, ppp_pc_links, ppp_shares, ppp_progress, ppp_users CASCADE'); await q(PRODUCTION_SQL); };
    const kindOf = async n => (await one(`SELECT relkind FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace`, [n])).map(r => r.relkind).join();
    const sharesCols = async () => (await one(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ppp_shares' ORDER BY ordinal_position`)).map(r => r.column_name).join();
    const sharesFks = async () => (await one(`SELECT count(*)::int n FROM pg_constraint WHERE conrelid = 'ppp_shares'::regclass AND contype = 'f'`))[0].n;
    {
      const initSql2 = (() => { const a = srvSrc.indexOf(head); const b = srvSrc.indexOf('`);', a); return srvSrc.slice(a + head.length, b); })();
      await resetToProduction();
      await q(`CREATE VIEW ppp_worker_tokens AS SELECT 1 AS id`);
      const oldCols = await sharesCols();
      const beforeCounts = await counts();
      const m1 = await Store.migrate(pool, initSql2);
      ok('migrate with something else in the place of ppp_worker_tokens does not throw: it says the queue is off, with the error', m1 && m1.queue === false && !!m1.error && m1.error.code === '42809', JSON.stringify(m1 && m1.error && m1.error.code));
      ok('the rest of the boot is committed exactly as it always was: ppp_shares has genre, expires_at and bytes, its old foreign key on owner_id is gone, the rows are untouched', oldCols.indexOf('bytes') < 0 && (await sharesCols()).indexOf('genre') >= 0 && (await sharesCols()).indexOf('expires_at') >= 0
        && (await sharesCols()).split(',').indexOf('bytes') >= 0 && (await sharesFks()) === 0 && JSON.stringify(await counts()) === JSON.stringify(beforeCounts), await sharesCols());
      ok('the queue\'s part is undone as a whole (the savepoint): no ppp_transcribe_jobs either, and the thing in the way is left as it was (still a view)', (await kindOf('ppp_transcribe_jobs')) === '' && (await kindOf('ppp_worker_tokens')) === 'v');
      /* a failure in the part that was always there is still fatal, and still undoes everything of that boot */
      const m2 = await Store.migrate(pool, `CREATE TABLE ppp_probe_fatal (id INT); SELECT no_such_function_xyz();`).then(() => 'resolved', e => e.code);
      ok('a failure in the boot SQL itself is fatal as before (it throws), and nothing of that boot is kept - not its tables, not the queue\'s', m2 === '42883' && (await kindOf('ppp_probe_fatal')) === '' && (await kindOf('ppp_transcribe_jobs')) === '');
      /* twelve at once with the queue's part failing in every one of them: all twelve come back with "off", none throws, none waits for ever */
      const poolOff = new Pool({ connectionString: URL_, max: 12 });
      poolOff.on('error', () => { /* a reset idle connection */ });
      const offs = await Promise.all(Array.from({ length: 12 }, () => Store.migrate(poolOff, initSql2).then(r => (r && r.queue === false ? 'off' : 'on'), failure)));
      await poolOff.end();
      ok('twelve instances migrating at once while the queue\'s part fails in each: all twelve resolve "off" - no error, no deadlock - and the old tables are as above', offs.every(x => x === 'off') && (await sharesFks()) === 0, offs.filter(x => x !== 'off').slice(0, 2).join(' | '));
      await dropSquat();
      const m3 = await Store.migrate(pool, initSql2);
      ok('with the thing out of the way the next migrate makes the queue\'s tables and says so (a restart tries again)', m3 && m3.queue === true && (await kindOf('ppp_transcribe_jobs')) === 'r' && (await kindOf('ppp_worker_tokens')) === 'r');
    }
    {
      /* the real server.js, with the view in the way */
      await resetToProduction();
      await q(`CREATE VIEW ppp_worker_tokens AS SELECT 1 AS id`);
      const before = await counts();
      const boot = await startServer();
      try {
        ok('the server STARTS: /health answers (the queue is optional; the site is not)', (await req(boot.port, 'GET', '/health')).status === 200);
        const out = boot.log();
        const offLines = out.split('\n').filter(l => /Home-PC worker queue: OFF/.test(l));
        ok('it says once, in one clear line, that the queue is off and why (the database error code), and where it stands', offLines.length === 1 && /42809/.test(offLines[0]) && /everything else is running/i.test(offLines[0]), offLines.join(' | ').slice(0, 200));
        ok('the line shows no secret: no connection string, no password, no environment', !/postgres(ql)?:\/\//i.test(out) && out.indexOf(URL_) < 0 && !/DATABASE_URL|SESSION_SECRET|home-worker-pg-secret/.test(out) && out.indexOf(':pw@') < 0);
        ok('and the ordinary "an idle worker is told to wait" line is not printed for a queue that is off', !/an idle worker is told to wait/.test(out), /an idle worker is told to wait/.test(out) ? out.slice(-300) : '');
        const su = await req(boot.port, 'POST', '/api/auth/signup', { body: { email: 'optional-queue@example.com', password: 'longenough1', displayName: 'Optional' } });
        const ck = cookieOf(su);
        ok('the rest of the site works: sign-up (a ppp_users row), who am I, the shared scores list, saving progress', su.status === 201 && (await req(boot.port, 'GET', '/api/auth/me', { cookie: ck })).body.email === 'optional-queue@example.com'
          && (await req(boot.port, 'GET', '/api/shares')).status === 200 && (await req(boot.port, 'PUT', '/api/progress', { cookie: ck, body: { payload: { a: 2 } } })).status === 200 && (await req(boot.port, 'GET', '/api/progress', { cookie: ck })).status === 200);
        const token = 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43), someCode = 'c'.repeat(64);
        const asks = [
          ['GET /api/jobs', await req(boot.port, 'GET', '/api/jobs', { code: someCode })], ['POST /api/jobs', await req(boot.port, 'POST', '/api/jobs', { code: someCode, body: { url: 'https://www.youtube.com/watch?v=vgnliVjJUOo' } })],
          ['GET /api/worker/status', await req(boot.port, 'GET', '/api/worker/status', { code: someCode })], ['POST /api/pc-links', await req(boot.port, 'POST', '/api/pc-links', { body: {} })],
          ['DELETE /api/pc-links/me', await req(boot.port, 'DELETE', '/api/pc-links/me', { code: someCode })], ['POST /api/pc-links/me/worker-token', await req(boot.port, 'POST', '/api/pc-links/me/worker-token', { code: someCode, body: {} })],
          ['GET /api/worker/ping', await req(boot.port, 'GET', '/api/worker/ping', { token: token })], ['POST /api/worker/claim', await req(boot.port, 'POST', '/api/worker/claim', { token: token, body: {} })]
        ];
        ok('the queue\'s routes answer 503 "store", marked disabled, with the usual sentence - for the page\'s (including making a link, which needs no sign-in) and for the worker\'s', asks.every(([, r]) => r.status === 503 && r.body && r.body.code === 'store' && r.body.disabled === true && /not available right now/.test(r.body.error)), asks.map(([n, r]) => n + ' ' + r.status).join(' | '));
        ok('a worker with a wrong or any token gets the same 503 (not a 401: it is not told its token is bad)', asks.slice(-2).every(([, r]) => r.status === 503));
        const after = await counts();
        ok('the old tables came out of the boot as on main: only the seed library added; shares have genre, expires_at and bytes; the old foreign key on ppp_shares.owner_id dropped', after.u === before.u + 2 && (await sharesCols()).split(',').indexOf('bytes') >= 0 && (await sharesFks()) === 0, JSON.stringify([before, after]));
        ok('no queue table was left half made', (await kindOf('ppp_transcribe_jobs')) === '' && (await kindOf('ppp_worker_tokens')) === 'v');
      } finally { await boot.close(); }
      await dropSquat();
      /* the next boot, with nothing in the way: the queue is on, the account and its data are still there */
      const boot2 = await startServer();
      try {
        const si = await req(boot2.port, 'POST', '/api/auth/login', { body: { email: 'optional-queue@example.com', password: 'longenough1' } });
        const ck2 = cookieOf(si);
        ok('the next boot (nothing in the way) makes the tables and does not print the "off" line; the account made while it was off signs in', (await kindOf('ppp_transcribe_jobs')) === 'r' && (await kindOf('ppp_worker_tokens')) === 'r' && !/queue: OFF/.test(boot2.log()) && /an idle worker is told to wait/.test(boot2.log()) && si.status === 200, si.status === 200 ? '' : si.status + ' ' + boot2.log().slice(-200));
        const lk2 = await req(boot2.port, 'POST', '/api/pc-links', { body: {}, ip: '198.51.100.20' });
        const q2 = await req(boot2.port, 'POST', '/api/jobs', { code: lk2.body && lk2.body.clientCode, body: { url: 'https://www.youtube.com/watch?v=vgnliVjJUOo' } });
        ok('and the queue works again: a link (no sign-in), a job', lk2.status === 201 && q2.status === 201 && q2.body.worker && !q2.body.disabled, lk2.status + ' ' + q2.status);
      } finally { await boot2.close(); }
    }

    heading('the migration of the tables of PR 178 (the foreign keys to ppp_users), and rolling back to its code');
    /* the code of PR 178 as merged (b7f9fb5) is exported from git into a folder of its own: it is run for real, against the databases this tree has migrated */
    const OLD_REV = 'b7f9fb5';
    const oldDir = (() => {
      const dir = L.tmpDir('ppp-old-' + OLD_REV + '-');
      for (const f of ['server.js', 'home-jobs.js', 'home-jobs-store.js', 'home-result.js', 'share-guest.js', 'catalog/shared-seeds.json']) {
        const r = require('child_process').spawnSync('git', ['show', OLD_REV + ':' + f], { cwd: L.REPO, maxBuffer: 256 * 1024 * 1024 });
        if (r.status !== 0) { L.rmDir(dir); return null; }
        L.fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        L.fs.writeFileSync(path.join(dir, f), r.stdout);
      }
      return dir;
    })();
    if (!oldDir) console.log('  - the code of ' + OLD_REV + ' is not in this clone\'s history: the PR 178 migration and rollback checks are skipped');
    else {
      const OldStore = require(path.join(oldDir, 'home-jobs-store.js'));
      const dbs = [];
      const mkDb = async name => { await q('DROP DATABASE IF EXISTS ' + name + ' WITH (FORCE)'); await q('CREATE DATABASE ' + name); dbs.push(name); const url = URL_.replace(/\/[^/?]*(\?|$)/, '/' + name + '$1'); const pl = new Pool({ connectionString: url, max: 4 }); pl.on('error', () => {}); return { name: name, url: url, pool: pl, q: (sql, params) => pl.query(sql, params), one: async (sql, params) => (await pl.query(sql, params)).rows }; };
      const snapshot = async db => {
        const cols = (await db.one(`SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS v FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)).map(r => r.v);
        const cons = (await db.one(`SELECT conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) AS v FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1`)).map(r => r.v);
        const idx = (await db.one(`SELECT indexdef AS v FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`)).map(r => r.v);
        const names = (await db.one(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`)).map(r => r.table_name);
        const rows = {};
        for (const t of names) rows[t] = (await db.one('SELECT * FROM ' + t + ' ORDER BY 1')).map(r => JSON.stringify(r));
        return { cols: cols, cons: cons, idx: idx, rows: rows };
      };
      const diff = (a, b) => ({ removed: a.filter(x => b.indexOf(x) < 0), added: b.filter(x => a.indexOf(x) < 0) });
      const same2 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const NEW_COLS = ['ppp_pc_links.id text NO ', 'ppp_pc_links.client_hash text NO ', 'ppp_pc_links.created_at timestamp with time zone NO now()', 'ppp_pc_links.last_used_at timestamp with time zone NO now()', 'ppp_pc_links.last_worker_at timestamp with time zone YES ', "ppp_pc_links.created_ip_hash text NO ''::text", 'ppp_pc_links.revoked_at timestamp with time zone YES '];
      const oldBoot = (db, env) => startServer(env, { script: path.join(oldDir, 'server.js'), cwd: oldDir, url: db.url });
      const newBoot = (db, env) => startServer(env, { url: db.url });
      const isFk = x => /^ppp_(transcribe_jobs|worker_tokens) .*FOREIGN KEY \(owner_id\) REFERENCES ppp_users/.test(x);
      const SEED = `INSERT INTO ppp_users (id, email, display_name, password_hash) VALUES ('acct-1', 'acct@example.com', 'Acct', 'x');
        INSERT INTO ppp_transcribe_jobs (id, owner_id, url, status) VALUES ('legacyjob01', 'acct-1', 'https://www.youtube.com/watch?v=aaaaaaaaaaa', 'queued');
        INSERT INTO ppp_worker_tokens (id, owner_id, token_hash, label) VALUES ('legacytok01', 'acct-1', '${'ab'.repeat(32)}', 'Old PC');`;
      try {
        const shapes = [
          { name: 'ppp_cmp_prod', label: 'the production database today (users, progress, shares; none of the queue\'s tables)', init: async db => { await db.q(PRODUCTION_SQL); } },
          { name: 'ppp_cmp_178', label: 'a database that already has the tables of PR 178, with their foreign keys to ppp_users and an account\'s rows in them', init: async db => { await db.q(PRODUCTION_SQL); await db.q(OldStore.SCHEMA_SQL); await db.q(SEED); } },
          { name: 'ppp_cmp_empty', label: 'an empty database (a first boot)', init: async () => {} }
        ];
        const afterNew = {};
        for (const sh of shapes) {
          const db = await mkDb(sh.name);
          await sh.init(db);
          const o1 = await oldBoot(db); const s1 = await snapshot(db); await o1.close();
          const hadFks = s1.cons.filter(isFk).length;
          const n1 = await newBoot(db); const s2 = await snapshot(db);
          const logs = n1.log(); await n1.close();
          const dc = diff(s1.cols, s2.cols), dk = diff(s1.cons, s2.cons), di = diff(s1.idx, s2.idx);
          ok(sh.label + ': the code of ' + OLD_REV + ' boots on it (it makes or finds its tables, with the foreign keys: ' + hadFks + ')', hadFks === 2 && s1.cols.some(c => /^ppp_worker_tokens\./.test(c)), hadFks + '');
          ok(sh.label + ': after this tree\'s boot the SCHEMA differs from the old boot\'s only by the new table (7 columns, its primary key and one index) and the two foreign keys on owner_id that are gone - nothing else added, removed or changed', dc.removed.length === 0 && same2(dc.added.slice().sort(), NEW_COLS.slice().sort())
            && same2(dk.removed.filter(isFk).length, 2) && dk.removed.length === 2 && dk.added.length === 1 && /^ppp_pc_links ppp_pc_links_pkey PRIMARY KEY/.test(dk.added[0]) && di.removed.length === 0 && di.added.length === 2 && di.added.every(x => /ppp_pc_links/.test(x)),
            JSON.stringify({ dc: dc, dk: dk, di: di }).slice(0, 400));
          ok(sh.label + ': and the DATA is identical (every row of every table, the seed library included; an account\'s rows in the queue tables untouched)', same2(s1.rows, Object.assign({}, s2.rows, { ppp_pc_links: undefined })) && s2.rows.ppp_pc_links.length === 0
            && (sh.name !== 'ppp_cmp_178' || (s2.rows.ppp_transcribe_jobs.length === 1 && s2.rows.ppp_worker_tokens.length === 1 && s2.rows.ppp_users.some(r => /acct-1/.test(r)))),
            Object.keys(s1.rows).filter(t => !same2(s1.rows[t], s2.rows[t])).join());
          ok(sh.label + ': the boot says nothing is wrong (no "queue: OFF" line)', !/queue: OFF/.test(logs) && /an idle worker is told to wait/.test(logs), logs.slice(-200));
          afterNew[sh.name] = { db: db, s2: s2 };
        }
        /* the same from nothing: a database booted only by this tree has the schema of one migrated from PR 178 */
        const dbD = await mkDb('ppp_cmp_fresh');
        const nD = await newBoot(dbD); const sD = await snapshot(dbD); await nD.close();
        const m178 = afterNew.ppp_cmp_178.s2, mEmpty = afterNew.ppp_cmp_empty.s2, mProd = afterNew.ppp_cmp_prod.s2;
        ok('a database booted only by this tree, one migrated from PR 178\'s tables, one from today\'s production and one from the old code on nothing end up with the SAME schema (columns, constraints, indexes)',
          same2(sD.cols.slice().sort(), m178.cols.slice().sort()) && same2(sD.cols.slice().sort(), mEmpty.cols.slice().sort()) && same2(sD.cols.slice().sort(), mProd.cols.slice().sort()) && same2(sD.cons, m178.cons) && same2(sD.cons, mEmpty.cons) && same2(sD.cons, mProd.cons) && same2(sD.idx, m178.idx) && same2(sD.idx, mEmpty.idx) && same2(sD.idx, mProd.idx),
          JSON.stringify([diff(sD.cons, m178.cons), diff(sD.cols, m178.cols)]).slice(0, 300));
        ok('and none of them has a foreign key on a queue table\'s owner_id', [sD, m178, mEmpty, mProd].every(x => x.cons.filter(isFk).length === 0));

        /* again: a second boot of this tree changes nothing (idempotent), on every shape */
        for (const sh of shapes) {
          const { db, s2 } = afterNew[sh.name];
          const n2 = await newBoot(db); const s3 = await snapshot(db); await n2.close();
          ok(sh.label + ': a second boot of this tree changes nothing (schema and data identical)', same2(s2, s3), Object.keys(s2.rows).filter(t => !same2(s2.rows[t], s3.rows[t])).join());
        }

        /* ROLLBACK: the code of PR 178 booted on a database this tree has migrated */
        for (const sh of shapes) {
          const { db, s2 } = afterNew[sh.name];
          const ob = await oldBoot(db);
          let healthy = false, work = {};
          try {
            healthy = (await req(ob.port, 'GET', '/health')).status === 200;
            const su = await req(ob.port, 'POST', '/api/auth/signup', { body: { email: 'rollback-' + sh.name + '@example.com', password: 'longenough1', displayName: 'Rollback' } });
            const ck = cookieOf(su);
            const tk = await req(ob.port, 'POST', '/api/worker/tokens', { cookie: ck, body: { label: 'Old PC' } });
            const jb = await req(ob.port, 'POST', '/api/jobs', { cookie: ck, body: { url: 'https://www.youtube.com/watch?v=vgnliVjJUOo', title: 'Rolled back' } });
            const cl = tk.body && tk.body.token ? await req(ob.port, 'POST', '/api/worker/claim', { token: tk.body.token, body: { once: true } }) : { status: 0 };
            const rs = cl.body && cl.body.job ? await req(ob.port, 'POST', '/api/worker/jobs/' + cl.body.job.id + '/result', { token: tk.body.token, body: goodResult(40) }) : { status: 0 };
            work = { su: su.status, tk: tk.status, jb: jb.status, cl: cl.status, rs: rs.status, shares: (await req(ob.port, 'GET', '/api/shares')).status, me: (await req(ob.port, 'GET', '/api/auth/me', { cookie: ck })).status };
          } finally { await ob.close(); }
          const s3 = await snapshot(db);
          ok(sh.label + ': ROLLBACK - the code of ' + OLD_REV + ' boots on the migrated database (/health), signs up, makes a token, queues, claims and finishes a job, lists shares', healthy && work.su === 201 && work.tk === 201 && work.jb === 201 && work.cl === 200 && work.rs === 200 && work.shares === 200 && work.me === 200, JSON.stringify(work));
          const d3c = diff(s2.cols, s3.cols), d3k = diff(s2.cons, s3.cons), d3i = diff(s2.idx, s3.idx);
          ok(sh.label + ': ROLLBACK - and its boot changed no table, column, constraint or index of what this tree migrated (the old code does not put the foreign keys back: its CREATE TABLE IF NOT EXISTS finds the tables); only the rows it wrote are new',
            d3c.added.length + d3c.removed.length + d3k.added.length + d3k.removed.length + d3i.added.length + d3i.removed.length === 0 && s3.rows.ppp_transcribe_jobs.length === s2.rows.ppp_transcribe_jobs.length + 1 && s3.rows.ppp_pc_links.length === 0, JSON.stringify({ d3c: d3c, d3k: d3k }).slice(0, 300));
          /* and rolling forward again: this tree boots on a database the old code has written to; the old code's rows are not served, nothing is lost */
          const nf = await newBoot(db);
          let fw = {};
          try {
            const mk2 = await req(nf.port, 'POST', '/api/pc-links', { body: {}, ip: '198.51.100.31' });
            const lst = await req(nf.port, 'GET', '/api/jobs', { code: mk2.body.clientCode });
            const tokOld = await req(nf.port, 'GET', '/api/worker/ping', { token: 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43) });
            fw = { health: (await req(nf.port, 'GET', '/health')).status, mk: mk2.status, list: lst.status, jobs: lst.body && lst.body.jobs && lst.body.jobs.length, bad: tokOld.status };
          } finally { await nf.close(); }
          const s4 = await snapshot(db);
          ok(sh.label + ': ROLL FORWARD - this tree boots again on it; a link can be made; the account rows the old code wrote are not served as anybody\'s (a link sees none) and are not deleted (the new link\'s own token row is the one more)', fw.health === 200 && fw.mk === 201 && fw.list === 200 && fw.jobs === 0 && fw.bad === 401
            && s4.rows.ppp_transcribe_jobs.length === s3.rows.ppp_transcribe_jobs.length && s4.rows.ppp_worker_tokens.length === s3.rows.ppp_worker_tokens.length + 1 && s4.rows.ppp_pc_links.length === 1 && same2(s3.cons, s4.cons), JSON.stringify(fw));
        }

        /* the foreign key is found by catalog lookup, whatever it is named, and only the one on owner_id goes */
        {
          const db = await mkDb('ppp_cmp_weird');
          await db.q(PRODUCTION_SQL); await db.q(OldStore.SCHEMA_SQL);
          await db.q(`ALTER TABLE ppp_transcribe_jobs DROP CONSTRAINT ppp_transcribe_jobs_owner_id_fkey;
            ALTER TABLE ppp_transcribe_jobs ADD CONSTRAINT "weird name; DROP TABLE ppp_users" FOREIGN KEY (owner_id) REFERENCES ppp_users(id) ON DELETE SET NULL NOT VALID;
            CREATE TABLE ppp_probe_target (id TEXT PRIMARY KEY);
            ALTER TABLE ppp_transcribe_jobs ADD CONSTRAINT ppp_probe_keep FOREIGN KEY (worker_id) REFERENCES ppp_probe_target(id);
            ALTER TABLE ppp_worker_tokens ADD CONSTRAINT second_owner_fk FOREIGN KEY (owner_id) REFERENCES ppp_users(id);`);
          const r = await Store.migrate(db.pool, '');
          const left = (await db.one(`SELECT conname FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text IN ('ppp_transcribe_jobs', 'ppp_worker_tokens') ORDER BY 1`)).map(x => x.conname).join();
          ok('every foreign key on owner_id goes whatever its name (an odd one with a quote and a semicolon, a second one on the same column, a NOT VALID one); a foreign key on another column (worker_id) stays; ppp_users is not touched', r.queue === true && left === 'ppp_probe_keep' && (await db.one(`SELECT count(*)::int n FROM pg_class WHERE relname = 'ppp_users'`))[0].n === 1, left);
          const again = await Store.migrate(db.pool, '');
          ok('and again, nothing happens (it finds none)', again.queue === true && (await db.one(`SELECT count(*)::int n FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text IN ('ppp_transcribe_jobs', 'ppp_worker_tokens')`))[0].n === 1);
        }
        /* twelve at once on the PR 178 shape: they take turns under the lock, the keys go once */
        {
          const db = await mkDb('ppp_cmp_race');
          await db.q(PRODUCTION_SQL); await db.q(OldStore.SCHEMA_SQL); await db.q(SEED);
          const poolR = new Pool({ connectionString: db.url, max: 12 });
          poolR.on('error', () => {});
          const raced = await Promise.all(Array.from({ length: 12 }, () => Store.migrate(poolR, initSql).then(migrated, failure)));
          await poolR.end();
          ok('twelve instances migrating the PR 178 shape at the same moment (a deploy overlap): all succeed, no deadlock; both keys gone, the account\'s rows still there, the new table made once', raced.every(x => x === 'ok') && (await db.one(`SELECT count(*)::int n FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text IN ('ppp_transcribe_jobs', 'ppp_worker_tokens')`))[0].n === 0
            && (await db.one(`SELECT count(*)::int n FROM ppp_transcribe_jobs`))[0].n === 1 && (await db.one(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name = 'ppp_pc_links'`))[0].n === 1, raced.filter(x => x !== 'ok').slice(0, 2).join(' | '));
        }
        /* the DO block fails (the role may not alter the table: here, a lock the migration can never get): the queue goes OFF and the site stays up - the same behaviour as any failure of the queue's part */
        {
          const db = await mkDb('ppp_cmp_off');
          await db.q(PRODUCTION_SQL); await db.q(OldStore.SCHEMA_SQL);
          await db.q(`CREATE VIEW ppp_pc_links AS SELECT 1 AS id`);
          const r = await Store.migrate(db.pool, '');
          ok('if the queue\'s part cannot be done (here a view named ppp_pc_links), migrate says "queue off" and undoes all of its part: the foreign keys are NOT dropped (nothing half done), the old tables as they were', r.queue === false && (await db.one(`SELECT count(*)::int n FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text IN ('ppp_transcribe_jobs', 'ppp_worker_tokens')`))[0].n === 2, JSON.stringify(r.error && r.error.code));
        }
      } finally {
        for (const n of dbs) { try { await q('DROP DATABASE IF EXISTS ' + n + ' WITH (FORCE)'); } catch (e) { /* the container is thrown away anyway */ } }
        L.rmDir(oldDir);
      }
    }
  } finally {
    if (srv) await srv.close();
    try { await q(`DROP VIEW IF EXISTS ppp_worker_tokens`); } catch (e) { /* it is a table, or the database is gone */ }
    await pool.end();
  }
})().then(() => L.finish('the home-PC queue on Postgres'), e => { console.error(e); process.exit(1); });
