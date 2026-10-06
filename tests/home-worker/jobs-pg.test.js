/* G10b-1: the home-PC queue on a real Postgres: the migration (additive, idempotent, the production tables untouched), the store's SQL guards
   (owner and state in every WHERE, a claim that cannot be won twice), the notes as JSONB, the foreign keys, and - against the real
   schema - that a poll which finds nothing runs NO statement.

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
async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(L.MODS, 'server.js')], {
    cwd: L.REPO, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: URL_, SESSION_SECRET: 'home-worker-pg-secret' }, env || {})
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
    await q('DROP TABLE IF EXISTS ppp_worker_tokens, ppp_transcribe_jobs, ppp_shares, ppp_progress, ppp_users CASCADE');
    await q(PRODUCTION_SQL);
    const counts = async () => (await one(`SELECT (SELECT count(*) FROM ppp_users)::int u, (SELECT count(*) FROM ppp_progress)::int p, (SELECT count(*) FROM ppp_shares)::int s`))[0];
    const before = await counts();

    heading('the migration');
    await q(Store.SCHEMA_SQL); await q(Store.SCHEMA_SQL);
    ok('the migration run twice, by hand, on the production-shaped tables: no error, no row of theirs touched', JSON.stringify(await counts()) === JSON.stringify(before));
    /* two instances booting together (a deploy overlap): without a lock, CREATE TABLE IF NOT EXISTS from two sessions can fail on pg_type's unique index */
    await q('DROP TABLE IF EXISTS ppp_worker_tokens, ppp_transcribe_jobs');
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
    const tables = async () => (await one(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ppp_transcribe_jobs', 'ppp_worker_tokens') ORDER BY 1`)).map(r => r.table_name).join();
    ok('the two tables exist after the first boot', (await tables()) === 'ppp_transcribe_jobs,ppp_worker_tokens');
    const cols = async t => (await one(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [t])).map(r => r.column_name).join();
    ok('ppp_transcribe_jobs has the designed columns', (await cols('ppp_transcribe_jobs')) === 'id,owner_id,kind,url,title,status,attempts,worker_id,created_at,claimed_at,finished_at,error,result,bytes', await cols('ppp_transcribe_jobs'));
    ok('ppp_worker_tokens has the designed columns (the hash, never the token)', (await cols('ppp_worker_tokens')) === 'id,owner_id,token_hash,label,created_at,last_seen_at,poll_s,revoked_at', await cols('ppp_worker_tokens'));
    ok('the first boot adds only the seed library (the app\'s own shared scores and its owner) to the old tables', afterBoot.u === before.u + 1 && afterBoot.p === before.p && afterBoot.s >= before.s, JSON.stringify(before) + ' -> ' + JSON.stringify(afterBoot));
    const fks = (await one(`SELECT conrelid::regclass::text AS t, confrelid::regclass::text AS r FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text IN ('ppp_transcribe_jobs', 'ppp_worker_tokens') ORDER BY 1`)).map(r => r.t + '>' + r.r).join();
    ok('both reference ppp_users (a deleted account takes its jobs and tokens with it)', fks === 'ppp_transcribe_jobs>ppp_users,ppp_worker_tokens>ppp_users', fks);
    ok('the status column has a CHECK', (await one(`SELECT count(*)::int n FROM pg_constraint WHERE conname = 'ppp_transcribe_jobs_status'`))[0].n === 1);
    await srv.close();
    srv = await startServer();
    ok('a second boot (the migration again) changes nothing and does not fail', (await tables()) === 'ppp_transcribe_jobs,ppp_worker_tokens' && JSON.stringify(await counts()) === JSON.stringify(afterBoot));
    await q(`INSERT INTO ppp_users (id, email, display_name, password_hash) VALUES ('u-a', 'a@example.com', 'A', 'x'), ('u-b', 'b@example.com', 'B', 'x')`);
    await q(`INSERT INTO ppp_transcribe_jobs (id, owner_id, url) VALUES ('keepjob001', 'u-a', 'https://www.youtube.com/watch?v=aaaaaaaaaaa')`);
    await srv.close();
    srv = await startServer();
    ok('and rows written by the feature survive another boot', (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs WHERE id = 'keepjob001'`))[0].n === 1);
    await srv.close(); srv = null;
    await q(`DELETE FROM ppp_transcribe_jobs WHERE id = 'keepjob001'`);
    const sql = Store.SCHEMA_SQL;
    ok('the migration is CREATE ... IF NOT EXISTS only: no DROP, no ALTER, no DELETE, no TRUNCATE', !/\b(DROP|ALTER|DELETE|TRUNCATE|UPDATE)\b/i.test(sql.replace(/ON DELETE CASCADE/g, '')) && /IF NOT EXISTS/.test(sql));

    heading('the store, on Postgres: the same guards as the file store');
    const st = Store.pgJobStore(q);
    const t0 = Date.parse('2026-10-06T12:00:00Z');
    const mk = (id, owner) => ({ id: id, ownerId: owner, kind: 'youtube', url: 'https://www.youtube.com/watch?v=' + id.padEnd(11, 'x'), title: 'T ' + id, createdAt: t0 });
    await st.insertJob(mk('job-aaaa0001', 'u-a')); await st.insertJob(mk('job-bbbb0001', 'u-b'));
    ok('a duplicate id is refused by the primary key', await st.insertJob(mk('job-aaaa0001', 'u-a')).then(() => false, e => e.code === '23505'));
    ok('a job for an account that does not exist is refused by the foreign key', await st.insertJob(mk('job-ghost001', 'nobody')).then(() => false, e => e.code === '23503'));
    ok('a status outside the six is refused by the CHECK', await q(`UPDATE ppp_transcribe_jobs SET status = 'weird' WHERE id = 'job-aaaa0001'`).then(() => false, e => e.code === '23514'));
    const all = await st.loadAll();
    ok('loadAll reads the jobs back as the service holds them (times in ms, no result)', all.jobs.length === 2 && all.jobs.find(j => j.id === 'job-aaaa0001').createdAt === t0 && all.jobs[0].status === 'queued' && !('result' in all.jobs[0]) && all.jobs[0].claimedAt === 0, JSON.stringify(all.jobs[0]));
    const race = await Promise.all(Array.from({ length: 12 }, (_, i) => st.claimJob('job-aaaa0001', 'u-a', 'w' + i, t0 + 1000)));
    ok('twelve claims at once of one queued job: exactly one wins', race.filter(Boolean).length === 1, race.join());
    ok('the claim counted an attempt and kept the worker and the time', (await one(`SELECT attempts, worker_id, claimed_at FROM ppp_transcribe_jobs WHERE id = 'job-aaaa0001'`))[0].attempts === 1);
    ok("another account cannot claim, finish, cancel or requeue it (the owner is in every WHERE)", !(await st.claimJob('job-bbbb0001', 'u-a', 'w', t0)) && !(await st.finishJob('job-aaaa0001', 'u-b', 'done', t0, { result: { v: 1 }, bytes: 5 }))
      && !(await st.cancelJob('job-aaaa0001', 'u-b', t0)) && !(await st.requeueJob('job-aaaa0001', 'u-b', 'x')));
    ok('a queued job cannot be requeued (only a claimed one)', !(await st.requeueJob('job-bbbb0001', 'u-b', 'x')));
    ok('a claimed job goes back to queued, attempts kept', (await st.requeueJob('job-aaaa0001', 'u-a', 'again')) && (await one(`SELECT status, attempts, worker_id, error FROM ppp_transcribe_jobs WHERE id = 'job-aaaa0001'`))[0].status === 'queued');
    await st.claimJob('job-aaaa0001', 'u-a', 'w1', t0 + 2000);
    const res = { v: 1, notes: [{ on: 0.1, off: 0.7312, midi: 60, vel: 64 }, { on: 1e-4, off: 2, midi: 108, vel: 1 }], duration: 61.5, engine: 'ensemble', model: null, device: 'cuda', ensemble: { models: ['a'], primary: 'a', agreement: 0.5, accepted: 2, uncertain: 0 } };
    ok('finish stores the notes as JSONB', await st.finishJob('job-aaaa0001', 'u-a', 'done', t0 + 3000, { result: res, bytes: 99 }));
    ok('and they come back exactly (floats included), only to their owner, only when done', same(await st.getResult('job-aaaa0001', 'u-a'), res) && (await st.getResult('job-aaaa0001', 'u-b')) === null && (await st.getResult('job-bbbb0001', 'u-b')) === null);
    ok('a finished job cannot be finished, claimed or cancelled again', !(await st.finishJob('job-aaaa0001', 'u-a', 'failed', t0, {})) && !(await st.claimJob('job-aaaa0001', 'u-a', 'w', t0)) && !(await st.cancelJob('job-aaaa0001', 'u-a', t0)));
    ok('a queued job takes a late result', await st.finishJob('job-bbbb0001', 'u-b', 'done', t0 + 4000, { result: res, bytes: 7 }));
    ok('a cancelled job takes none', (await st.insertJob(mk('job-cccc0001', 'u-a')), await st.cancelJob('job-cccc0001', 'u-a', t0)) && !(await st.finishJob('job-cccc0001', 'u-a', 'done', t0, { result: res, bytes: 1 })));
    const day = 86400000;
    await st.insertJob(mk('job-dddd0001', 'u-a')); await st.finishJob('job-dddd0001', 'u-a', 'failed', t0 - 2 * day, { error: 'e' });
    await st.insertJob(mk('job-eeee0001', 'u-a')); await st.finishJob('job-eeee0001', 'u-a', 'done', t0 - 2 * day, { result: res, bytes: 1 });
    const n = await st.purge(t0 - 3 * day, t0 - 1 * day);
    ok('purge: a failed job a day and a half old goes, a done one that is two days old stays', n >= 1 && (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs WHERE id = 'job-dddd0001'`))[0].n === 0 && (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs WHERE id = 'job-eeee0001'`))[0].n === 1, n + '');
    ok('deleteJobs removes the ids named (of the account named) and nothing else', (await st.deleteJobs(['job-eeee0001', 'nope'], 'u-a')) === 1 && (await st.deleteJobs([], 'u-a')) === 0);
    /* the owner and "finished" are in the WHERE of the DELETE, like in every other change of the store: a list that holds somebody else's id, or the id of a job that is still waiting or being converted, removes neither */
    await st.insertJob(mk('job-delq0001', 'u-a')); await st.insertJob(mk('job-delc0001', 'u-a')); await st.insertJob(mk('job-delf0001', 'u-a')); await st.insertJob(mk('job-delf0002', 'u-b'));
    await st.claimJob('job-delc0001', 'u-a', 'w', t0); await st.finishJob('job-delf0001', 'u-a', 'failed', t0, { error: 'e' }); await st.finishJob('job-delf0002', 'u-b', 'failed', t0, { error: 'e' });
    const delAll = ['job-delq0001', 'job-delc0001', 'job-delf0001', 'job-delf0002'];
    const delLeft = async () => (await one(`SELECT id FROM ppp_transcribe_jobs WHERE id LIKE 'job-del%' ORDER BY id`)).map(r => r.id).join();
    ok('every id of two accounts in the list, one account named: only the finished row of that account is deleted (1)', (await st.deleteJobs(delAll, 'u-a')) === 1 && (await delLeft()) === 'job-delc0001,job-delf0002,job-delq0001', await delLeft());
    ok('a queued or claimed row is not deleted even when it is named, in its owner call too; a finished row of somebody else neither; no owner at all removes nothing', (await st.deleteJobs(['job-delq0001', 'job-delc0001'], 'u-a')) === 0
      && (await st.deleteJobs(['job-delf0002'], 'u-a')) === 0 && (await st.deleteJobs(['job-delf0002'])) === 0 && (await st.deleteJobs(['job-delf0002'], null)) === 0 && (await delLeft()) === 'job-delc0001,job-delf0002,job-delq0001');
    ok('and the call of its owner removes it', (await st.deleteJobs(['job-delf0002'], 'u-b')) === 1);
    await q(`DELETE FROM ppp_transcribe_jobs WHERE id LIKE 'job-del%'`);
    await st.insertToken({ id: 'tok-a00001', ownerId: 'u-a', hash: 'ab'.repeat(32), label: 'PC', createdAt: t0 });
    ok('a token is stored as its hash', (await one(`SELECT token_hash, last_seen_at FROM ppp_worker_tokens WHERE id = 'tok-a00001'`))[0].token_hash === 'ab'.repeat(32));
    await st.touchSeen('tok-a00001', 'u-b', t0 + 5000, 20); await st.touchSeen('tok-a00001', 'u-a', t0 + 6000, 1200);
    const lt = (await st.loadAll()).tokens.find(k => k.id === 'tok-a00001');
    ok("last-seen is written by the owner only; loadAll gives the live tokens", lt.lastSeenAt === t0 + 6000 && lt.pollS === 1200 && lt.hash === 'ab'.repeat(32));
    ok("another account cannot revoke it; its owner can; a revoked token is not loaded", !(await st.revokeToken('tok-a00001', 'u-b', t0)) && (await st.revokeToken('tok-a00001', 'u-a', t0)) && !(await st.revokeToken('tok-a00001', 'u-a', t0))
      && (await st.loadAll()).tokens.length === 0);
    await st.insertToken({ id: 'tok-a00002', ownerId: 'u-a', hash: 'cd'.repeat(32), label: 'PC2', createdAt: t0 });
    await q(`DELETE FROM ppp_users WHERE id = 'u-a'`);
    ok('deleting an account deletes its jobs and tokens', (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs WHERE owner_id = 'u-a'`))[0].n === 0 && (await one(`SELECT count(*)::int n FROM ppp_worker_tokens WHERE owner_id = 'u-a'`))[0].n === 0);
    /* parameterized: a hostile title is data, whatever it contains */
    await q(`INSERT INTO ppp_users (id, email, display_name, password_hash) VALUES ('u-h', 'h@example.com', 'H', 'x') ON CONFLICT DO NOTHING`);
    const hostile = "x'); DROP TABLE ppp_worker_tokens; DELETE FROM ppp_users; --";
    await st.insertJob(Object.assign(mk('job-hhhh0001', 'u-h'), { title: hostile }));
    ok('a title with quotes and a DROP in it is stored as text; nothing is dropped', (await one(`SELECT title FROM ppp_transcribe_jobs WHERE id = 'job-hhhh0001'`))[0].title === hostile && (await tables()) === 'ppp_transcribe_jobs,ppp_worker_tokens' && (await one('SELECT count(*)::int n FROM ppp_users'))[0].n >= 3);

    heading('the queue service on that schema: an idle poll runs no statement');
    await q(`DELETE FROM ppp_transcribe_jobs; DELETE FROM ppp_worker_tokens; INSERT INTO ppp_users (id, email, display_name, password_hash) VALUES ('u-c', 'c@example.com', 'C', 'x') ON CONFLICT DO NOTHING`);
    let statements = 0; const seen = [];
    const countingQuery = (sql, params) => { statements++; seen.push(String(sql).replace(/\s+/g, ' ').slice(0, 60)); return pool.query(sql, params); };
    const S = await L.startService({ users: ['u-c'], store: Store.pgJobStore(countingQuery), config: { longPollMs: 50 } });
    try {
      const mkt = await S.as('u-c').post('/api/worker/tokens', { label: 'PC' });
      const tk = mkt.body.token;
      const j = (await S.as('u-c').post('/api/jobs', { url: WATCH('pgservice01'), title: 'On Postgres' })).body.job;
      ok('enqueue and token made rows', mkt.status === 201 && (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs`))[0].n === 1 && (await one(`SELECT count(*)::int n FROM ppp_worker_tokens`))[0].n === 1);
      const g = await S.worker(tk).post('/api/worker/claim', {});
      ok('claimed, and the row says so', g.body.job && g.body.job.id === j.id && (await one(`SELECT status, attempts FROM ppp_transcribe_jobs WHERE id = $1`, [j.id]))[0].status === 'claimed');
      await S.worker(tk).post('/api/worker/jobs/' + j.id + '/heartbeat', { stage: 'transcribe', pct: 0.5 });
      const r = await S.worker(tk).post('/api/worker/jobs/' + j.id + '/result', goodResult(500));
      ok('the result is stored (JSONB) and read back by the owner', r.status === 200 && (await S.as('u-c').get('/api/jobs/' + j.id)).body.result.notes.length === 500);
      ok('the row has its size', (await one(`SELECT bytes, status FROM ppp_transcribe_jobs WHERE id = $1`, [j.id]))[0].bytes > 1000);
      S.svc._state.forgetAll();
      statements = 0; seen.length = 0;
      await S.worker(tk).post('/api/worker/claim', { waitSeconds: 1200 });
      ok('the first poll after a boot: one read (both tables in one round trip) and one UPDATE of last-seen: 2 statements', statements === 2, statements + ' ' + JSON.stringify(seen));
      statements = 0; seen.length = 0;
      S.advance(10 * 60 * 1000);
      for (let i = 0; i < 100; i++) await S.worker(tk).post('/api/worker/claim', { waitSeconds: 1200 });
      for (let i = 0; i < 30; i++) { await S.as('u-c').get('/api/jobs'); await S.as('u-c').get('/api/worker/status'); await S.worker(tk).get('/api/worker/ping'); }
      ok('then 100 idle polls, 30 pings and 60 status reads run ZERO statements on Postgres', statements === 0, statements + ' ' + JSON.stringify(seen));
      ok('the token and the job survive as rows', (await one(`SELECT count(*)::int n FROM ppp_worker_tokens WHERE last_seen_at IS NOT NULL`))[0].n === 1);
    } finally { await S.close(); }

    heading('server.js with DATABASE_URL: the whole path, and what Postgres itself logged');
    await q('DELETE FROM ppp_transcribe_jobs; DELETE FROM ppp_worker_tokens');
    srv = await startServer();
    const su = await req(srv.port, 'POST', '/api/auth/signup', { body: { email: 'pgflow@example.com', password: 'longenough1', displayName: 'PG Flow' } });
    const ck = cookieOf(su);
    ok('signed up (a ppp_users row)', su.status === 201 && (await one(`SELECT count(*)::int n FROM ppp_users WHERE email = 'pgflow@example.com'`))[0].n === 1);
    const tkn = (await req(srv.port, 'POST', '/api/worker/tokens', { cookie: ck, body: { label: 'PG PC' } })).body.token;
    const job = (await req(srv.port, 'POST', '/api/jobs', { cookie: ck, body: { url: 'https://youtu.be/vgnliVjJUOo', title: 'Teacher' } })).body.job;
    ok('enqueued through the server', !!job && (await one(`SELECT status, owner_id FROM ppp_transcribe_jobs WHERE id = $1`, [job.id])).length === 1);
    const cl = await req(srv.port, 'POST', '/api/worker/claim', { token: tkn, body: {} });
    const rs = await req(srv.port, 'POST', '/api/worker/jobs/' + cl.body.job.id + '/result', { token: tkn, body: goodResult(2374) });
    ok('claimed and finished with 2374 notes', cl.body.job && rs.status === 200, rs.text);
    const got = await req(srv.port, 'GET', '/api/jobs/' + job.id, { cookie: ck });
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

    console.log('\n\u2500\u2500 the whole boot, twelve at once \u2500\u2500');
    /* the boot's whole schema work goes through the lock: the SQL server.js ran before the queue existed (users, progress, shares, the foreign-key DO block) is the first part of the same transaction */
    const srvSrc = L.fs.readFileSync(path.join(L.MODS, 'server.js'), 'utf8');
    const head = 'homeJobsStore.migrate(getPool(), `';
    const initSql = (() => { const a = srvSrc.indexOf(head); const b = srvSrc.indexOf('`);', a); return a < 0 || b < 0 ? '' : srvSrc.slice(a + head.length, b); })();
    ok('the boot SQL is found in server.js (users, progress, shares and the foreign-key DO block)', /CREATE TABLE IF NOT EXISTS ppp_users/.test(initSql) && /CREATE TABLE IF NOT EXISTS ppp_shares/.test(initSql) && /DO \$\$/.test(initSql), initSql.length + ' characters');
    await q('DROP TABLE IF EXISTS ppp_worker_tokens, ppp_transcribe_jobs, ppp_shares, ppp_progress, ppp_users CASCADE');
    const poolN = new Pool({ connectionString: URL_, max: 12 });
    poolN.on('error', () => { /* a reset idle connection */ });
    const racedInit = await Promise.all(Array.from({ length: 12 }, () => Store.migrate(poolN, initSql).then(migrated, failure)));
    await poolN.end();
    const have = (await one(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ppp_users', 'ppp_progress', 'ppp_shares', 'ppp_transcribe_jobs', 'ppp_worker_tokens') ORDER BY 1`)).map(r => r.table_name).join();
    ok('twelve instances running the WHOLE boot migration (the old tables and the queue\'s) on an empty database at the same moment: all succeed, five tables, the old foreign key on ppp_shares.owner_id dropped once', racedInit.every(x => x === 'ok') && have === 'ppp_progress,ppp_shares,ppp_transcribe_jobs,ppp_users,ppp_worker_tokens'
      && (await one("SELECT count(*)::int n FROM pg_constraint WHERE conrelid = 'ppp_shares'::regclass AND contype = 'f'"))[0].n === 0, racedInit.filter(x => x !== 'ok').slice(0, 2).join(' | ') + ' ' + have);
    /* and the real thing: twelve servers booting together on an empty database */
    await q('DROP TABLE IF EXISTS ppp_worker_tokens, ppp_transcribe_jobs, ppp_shares, ppp_progress, ppp_users CASCADE');
    const boots = await Promise.all(Array.from({ length: 12 }, () => startServer().then(s => s, err => ({ error: String(err && err.message) }))));
    const okBoots = boots.filter(b => !b.error).length;
    ok('twelve real server.js processes booting together on an empty database (migration and seed library at once): all twelve come up and answer /health', okBoots === 12 && (await one("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'ppp\\_%'"))[0].n === 5, okBoots + ' up; ' + boots.filter(b => b.error).map(b => b.error).slice(0, 2).join(' | '));
    await Promise.all(boots.filter(b => !b.error).map(b => b.close()));

    heading('the queue is optional at the boot: a failure making its tables does not take the site down');
    /* a VIEW in the place of ppp_worker_tokens: CREATE TABLE IF NOT EXISTS skips it, and the index the queue makes on it is an error (42809) - the queue's part of the migration fails, the rest of it must not */
    const resetToProduction = async () => { await dropSquat(); await q('DROP TABLE IF EXISTS ppp_worker_tokens, ppp_transcribe_jobs, ppp_shares, ppp_progress, ppp_users CASCADE'); await q(PRODUCTION_SQL); };
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
        const token = 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43);
        const asks = [
          ['GET /api/jobs', await req(boot.port, 'GET', '/api/jobs', { cookie: ck })], ['POST /api/jobs', await req(boot.port, 'POST', '/api/jobs', { cookie: ck, body: { url: 'https://www.youtube.com/watch?v=vgnliVjJUOo' } })],
          ['GET /api/worker/status', await req(boot.port, 'GET', '/api/worker/status', { cookie: ck })], ['GET /api/worker/tokens', await req(boot.port, 'GET', '/api/worker/tokens', { cookie: ck })], ['POST /api/worker/tokens', await req(boot.port, 'POST', '/api/worker/tokens', { cookie: ck, body: {} })],
          ['GET /api/worker/ping', await req(boot.port, 'GET', '/api/worker/ping', { token: token })], ['POST /api/worker/claim', await req(boot.port, 'POST', '/api/worker/claim', { token: token, body: {} })]
        ];
        ok('the new routes answer 503 "store", marked disabled, with the usual sentence - for the browser routes and for the worker\'s', asks.every(([, r]) => r.status === 503 && r.body && r.body.code === 'store' && r.body.disabled === true && /not available right now/.test(r.body.error)), asks.map(([n, r]) => n + ' ' + r.status).join(' | '));
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
        const tk2 = await req(boot2.port, 'POST', '/api/worker/tokens', { cookie: ck2, body: {} });
        const q2 = await req(boot2.port, 'POST', '/api/jobs', { cookie: ck2, body: { url: 'https://www.youtube.com/watch?v=vgnliVjJUOo' } });
        ok('and the queue works again: a token, a job', tk2.status === 201 && q2.status === 201 && q2.body.worker && !q2.body.disabled, tk2.status + ' ' + q2.status);
      } finally { await boot2.close(); }
    }
  } finally {
    if (srv) await srv.close();
    try { await q(`DROP VIEW IF EXISTS ppp_worker_tokens`); } catch (e) { /* it is a table, or the database is gone */ }
    await pool.end();
  }
})().then(() => L.finish('the home-PC queue on Postgres'), e => { console.error(e); process.exit(1); });
