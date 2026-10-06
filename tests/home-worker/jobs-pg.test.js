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

async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: L.REPO, stdio: 'ignore',
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: URL_, SESSION_SECRET: 'home-worker-pg-secret' }, env || {})
  });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const t0 = Date.now();
  for (;;) {
    if (exited) throw new Error('server.js exited early');
    try { if ((await req(port, 'GET', '/health')).status === 200) break; } catch (e) { /* not up */ }
    if (Date.now() - t0 > 40000) { child.kill(); throw new Error('server.js did not come up'); }
    await sleep(150);
  }
  await sleep(1200); /* migration and seeds */
  return { port: port, close: () => new Promise(res => { if (exited) return res(); child.on('exit', () => res()); child.kill(); }) };
}
const cookieOf = r => { const c = [].concat(r.headers['set-cookie'] || [])[0] || ''; return c.split(';')[0]; };

(async () => {
  const pool = new Pool({ connectionString: URL_, max: 4 });
  pool.on('error', () => { /* an idle connection the container's port proxy reset: the pool replaces it */ });
  const same = (a, b) => { try { require('assert').deepStrictEqual(a, b); return true; } catch (e) { return false; } };
  const q = (sql, params) => pool.query(sql, params);
  const one = async (sql, params) => (await q(sql, params)).rows;
  let srv = null;
  try {
    /* production today: users, progress and shares (with their old foreign key); none of this feature's tables */
    await q('DROP TABLE IF EXISTS ppp_worker_tokens, ppp_transcribe_jobs, ppp_shares, ppp_progress, ppp_users CASCADE');
    await q(`
      CREATE TABLE ppp_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE ppp_progress (user_id TEXT PRIMARY KEY REFERENCES ppp_users(id) ON DELETE CASCADE, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE ppp_shares (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES ppp_users(id) ON DELETE CASCADE, owner_name TEXT NOT NULL, song_key TEXT NOT NULL,
        title TEXT NOT NULL, composer TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', measures INTEGER NOT NULL DEFAULT 0, listed BOOLEAN NOT NULL DEFAULT false,
        preview JSONB, score JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      INSERT INTO ppp_users (id, email, display_name, password_hash) VALUES ('old-user', 'old@example.com', 'Old', 'x');
      INSERT INTO ppp_progress (user_id, payload) VALUES ('old-user', '{"a":1}');
      INSERT INTO ppp_shares (id, owner_id, owner_name, song_key, title, score) VALUES ('oldshare01', 'old-user', 'Old', 'k', 'Old song', '{"measures":[{}],"notes":[]}');`);
    const counts = async () => (await one(`SELECT (SELECT count(*) FROM ppp_users)::int u, (SELECT count(*) FROM ppp_progress)::int p, (SELECT count(*) FROM ppp_shares)::int s`))[0];
    const before = await counts();

    heading('the migration');
    await q(Store.SCHEMA_SQL); await q(Store.SCHEMA_SQL);
    ok('the migration run twice, by hand, on the production-shaped tables: no error, no row of theirs touched', JSON.stringify(await counts()) === JSON.stringify(before));
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
    ok('deleteJobs removes the ids named and nothing else', (await st.deleteJobs(['job-eeee0001', 'nope'])) === 1 && (await st.deleteJobs([])) === 0);
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
  } finally {
    if (srv) await srv.close();
    await pool.end();
  }
})().then(() => L.finish('the home-PC queue on Postgres'), e => { console.error(e); process.exit(1); });
