/* G12-5: the home-PC queue's kind 'omr' on a real Postgres (home-jobs-store.js, home-jobs.js; docs/GOALS/G12_OMR.md section 24): the new table ppp_omr_pages (additive, idempotent, a foreign key that
   cascades), the store's SQL guards for the page images (the owner and the state are in every WHERE), the job and its pages in ONE statement, the purge with its shorter time for a score,
   the whole thing through the real server.js, that an idle poll of a worker that can read scores runs no statement (the database's own log), and that the code before G12-5 boots on the result.

   Needs a THROWAWAY Postgres and the `pg` package (the test of the queue itself, jobs-pg.test.js, is the model; this one uses its own database in the same server):

     docker run -d --name ppp-pg-test -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=ppp -p 127.0.0.1:55432:5432 postgres:17-alpine -c log_statement=all
     PPP_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55432/ppp PPP_TEST_PG_CONTAINER=ppp-pg-test NODE_PATH=D:/PPP/node_modules node tests/home-worker/omr-jobs-pg.test.js
     docker rm -f ppp-pg-test

   It makes (and drops) a database named ppp_omr_<the one named> beside it, and refuses any server that is not on localhost. Without PPP_TEST_PG_URL it says so and exits 0. */
'use strict';
const L = require('./lib');
const { ok, heading, req, sleep } = L;
const { spawn, spawnSync } = require('child_process');
const { freePort } = require('../serve-free');
const path = require('path');

const URL_ = process.env.PPP_TEST_PG_URL;
if (!URL_) { console.log('  - PPP_TEST_PG_URL is not set: no throwaway Postgres to test against. Skipping.'); process.exit(0); }
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(URL_)) { console.error('Refusing: this test drops tables, and only runs against localhost.'); process.exit(2); }
const { Pool } = require('pg');
const Store = L.mod('home-jobs-store.js');
/* a database of its own beside the one named (named after it, so that the mutation runner's lanes do not meet) */
const DB = 'ppp_omr_' + (((URL_.match(/\/([^/?]+)(\?|$)/) || [])[1] || 'ppp').replace(/[^a-z0-9_]/gi, '_'));
const DB_URL = URL_.replace(/\/[^/?]*(\?|$)/, '/' + DB + '$1');
const CONTAINER = process.env.PPP_TEST_CONTAINER || process.env.PPP_TEST_PG_CONTAINER || '';

async function startServer(url, env) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(L.MODS, 'server.js')], {
    cwd: L.REPO, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: url, SESSION_SECRET: 'omr-pg-secret' }, env || {})
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
  await sleep(1200);
  return { port: port, log: () => logs.join(''), close: () => new Promise(res => { if (exited) return res(); child.on('exit', () => res()); child.kill(); }) };
}
const mxl = n => L.scoreXml(n);

(async () => {
  const admin = new Pool({ connectionString: URL_, max: 2 });
  admin.on('error', () => {});
  await admin.query('DROP DATABASE IF EXISTS ' + DB + ' WITH (FORCE)');
  await admin.query('CREATE DATABASE ' + DB);
  const pool = new Pool({ connectionString: DB_URL, max: 6 });
  pool.on('error', () => {});
  const q = (sql, params) => pool.query(sql, params);
  const one = async (sql, params) => (await q(sql, params)).rows;
  let srv = null;
  try {
    heading('the migration: one new table, nothing altered');
    const PROD_SQL = `
      CREATE TABLE ppp_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE ppp_progress (user_id TEXT PRIMARY KEY REFERENCES ppp_users(id) ON DELETE CASCADE, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());`;
    await q(PROD_SQL);
    const snapshot = async () => ({
      cols: (await one(`SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable AS v FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> 'ppp_omr_pages' ORDER BY 1`)).map(r => r.v),
      cons: (await one(`SELECT conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) AS v FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text <> 'ppp_omr_pages' ORDER BY 1`)).map(r => r.v)
    });
    const m1 = await Store.migrate(pool, '');
    ok('migrate on a database that has none of the queue\'s tables makes them, and says so', m1 && m1.queue === true, JSON.stringify(m1 && m1.error && m1.error.message));
    const cols = async () => (await one(`SELECT column_name || ' ' || data_type || ' ' || is_nullable AS v FROM information_schema.columns WHERE table_name = 'ppp_omr_pages' ORDER BY ordinal_position`)).map(r => r.v).join(', ');
    ok('ppp_omr_pages has job_id, idx, bytes (bytea), created_at - and nothing that is not needed (no owner, no name, no url)', (await cols()) === 'job_id text NO, idx integer NO, bytes bytea NO, created_at timestamp with time zone NO', await cols());
    const cons = (await one(`SELECT pg_get_constraintdef(oid) AS d, contype FROM pg_constraint WHERE conrelid = 'ppp_omr_pages'::regclass ORDER BY contype`));
    ok('its primary key is (job_id, idx) and its foreign key to the job CASCADES', cons.some(c => c.contype === 'p' && /PRIMARY KEY \(job_id, idx\)/.test(c.d)) && cons.some(c => c.contype === 'f' && /FOREIGN KEY \(job_id\) REFERENCES ppp_transcribe_jobs\(id\) ON DELETE CASCADE/.test(c.d)), JSON.stringify(cons));
    ok('and it has the index on created_at that makes a name taken by something else fail in the migration, not later', (await one(`SELECT indexname FROM pg_indexes WHERE tablename = 'ppp_omr_pages'`)).some(r => r.indexname === 'ppp_omr_pages_created'));
    const before = await snapshot();
    const m2 = await Store.migrate(pool, '');
    ok('a second migrate changes nothing (columns and constraints of every other table are identical)', m2.queue === true && JSON.stringify(await snapshot()) === JSON.stringify(before) && (await cols()).length > 0);
    {
      const noDo = Store.SCHEMA_SQL.replace(/DO \$\$[\s\S]*?END \$\$;/, '');
      const inDo = (/DO \$\$[\s\S]*?END \$\$;/.exec(Store.SCHEMA_SQL) || [''])[0];
      ok('the SQL of the schema has no DROP TABLE, no DELETE, no TRUNCATE and no ALTER of an existing column (additive) - outside the one DO block', !/DROP TABLE|DELETE\s+FROM|TRUNCATE|DROP COLUMN|ALTER COLUMN|RENAME/i.test(noDo));
      ok('and the DO block has exactly one DELETE (the page rows no job names, only when the foreign key is missing) and adds one constraint (that key, named as the table makes it)',
        (inDo.match(/DELETE\s+FROM/gi) || []).length === 1 && /DELETE FROM ppp_omr_pages p WHERE NOT EXISTS \(SELECT 1 FROM ppp_transcribe_jobs j WHERE j\.id = p\.job_id\)/.test(inDo)
        && (inDo.match(/ADD CONSTRAINT/g) || []).length === 1 && /ADD CONSTRAINT ppp_omr_pages_job_id_fkey FOREIGN KEY \(job_id\) REFERENCES ppp_transcribe_jobs \(id\) ON DELETE CASCADE/.test(inDo) && !/TRUNCATE|DROP TABLE/i.test(inDo));
    }

    heading('the store: the job and its pages in one statement; the guards of every WHERE');
    const store = Store.pgJobStore((sql, p) => pool.query(sql, p));
    const own = 'pc_' + 'a'.repeat(22), other = 'pc_' + 'b'.repeat(22);
    const mkJob = (id, o) => Object.assign({ id: id, ownerId: own, kind: 'omr', url: 'omr:' + id, title: 'Czerny', createdAt: Date.now(), bytes: 0 }, o || {});
    const pagesOf = n => Array.from({ length: n }, (_, i) => L.pngBytes(1240, 1754 - i, 5000 + i));
    const pg = pagesOf(3);
    await store.insertOmrJob(mkJob('job-omr-0001', { bytes: pg.reduce((a, b) => a + b.length, 0) }), pg);
    ok('one job row and three page rows; the job\'s bytes is the images\' total', (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs WHERE id = 'job-omr-0001' AND kind = 'omr' AND bytes = $1`, [pg.reduce((a, b) => a + b.length, 0)]))[0].n === 1
      && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = 'job-omr-0001'`))[0].n === 3);
    ok('the bytes come back exactly (bytea)', (await one(`SELECT bytes FROM ppp_omr_pages WHERE job_id = 'job-omr-0001' AND idx = 1`))[0].bytes.equals(pg[1]));
    let statements = 0;
    const counting = Store.pgJobStore((sql, p) => { statements++; return pool.query(sql, p); });
    statements = 0;
    await counting.insertOmrJob(mkJob('job-omr-0002'), pagesOf(2));
    ok('queuing a score is ONE statement', statements === 1, statements + '');
    const failBefore = (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs`))[0].n;
    const failed = await store.insertOmrJob(mkJob('job-omr-0003'), [pg[0], null]).then(() => 'ok', e => 'failed');
    ok('a page that cannot be stored fails the whole statement: no job row is left without its pages', failed === 'failed' && (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs`))[0].n === failBefore && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = 'job-omr-0003'`))[0].n === 0);
    const dup = await store.insertOmrJob(mkJob('job-omr-0001'), pagesOf(1)).then(() => 'ok', e => e.code);
    ok('the same job id twice is refused (23505), the first one untouched', dup === '23505' && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = 'job-omr-0001'`))[0].n === 3);

    ok('a queued job\'s images are not handed out: getOmrPage answers null until the job is claimed', (await store.getOmrPage('job-omr-0001', own, 0)) === null);
    ok('claim it: queued -> claimed (the owner and the state are in the WHERE)', (await store.claimJob('job-omr-0001', own, 'tok-1', Date.now())) === true);
    const g = await store.getOmrPage('job-omr-0001', own, 2);
    ok('then the page of its owner comes back as the bytes it was', g && g.equals(pg[2]));
    ok('another owner gets null, a page that does not exist gets null', (await store.getOmrPage('job-omr-0001', other, 0)) === null && (await store.getOmrPage('job-omr-0001', own, 9)) === null && (await store.getOmrPage('nope', own, 0)) === null);
    ok('deleteOmrPages on a job that is being worked on deletes nothing (the images of a waiting or claimed job never go this way)', (await store.deleteOmrPages('job-omr-0001', own)) === 0 && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = 'job-omr-0001'`))[0].n === 3);
    ok('finish it: claimed -> done with its result', (await store.finishJob('job-omr-0001', own, 'done', Date.now(), { result: { v: 1, kind: 'omr', pages: [] }, bytes: 40 })) === true);
    ok('deleteOmrPages with another owner deletes nothing', (await store.deleteOmrPages('job-omr-0001', other)) === 0 && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = 'job-omr-0001'`))[0].n === 3);
    ok('with its owner it deletes the three rows (the job is done)', (await store.deleteOmrPages('job-omr-0001', own)) === 3 && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = 'job-omr-0001'`))[0].n === 0);
    ok('and a done job gives none of its pages away any more', (await store.getOmrPage('job-omr-0001', own, 0)) === null);
    ok('a second delete is 0 (nothing left)', (await store.deleteOmrPages('job-omr-0001', own)) === 0);

    heading('loadAll: how many page images each job still holds; the purge; the cascade');
    const loaded = await store.loadAll();
    const j1 = loaded.jobs.find(j => j.id === 'job-omr-0001'), j2 = loaded.jobs.find(j => j.id === 'job-omr-0002');
    ok('the boot read is ONE round trip and says 0 pages for the finished job, 2 for the waiting one', j1 && j1.pages === 0 && j2 && j2.pages === 2 && j2.kind === 'omr' && j2.url === 'omr:job-omr-0002', JSON.stringify([j1 && j1.pages, j2 && j2.pages]));
    statements = 0;
    await counting.loadAll();
    ok('(the read of the whole queue, the images counted, is one statement)', statements === 1, statements + '');
    /* the purge: a finished score is kept less long than a conversion's notes */
    const day = 24 * 3600 * 1000, now = Date.now();
    await q(`INSERT INTO ppp_transcribe_jobs (id, owner_id, kind, url, status, finished_at, bytes) VALUES
      ('done-omr-old', $1, 'omr', 'omr:x', 'done', $2, 100), ('done-yt-old', $1, 'youtube', 'https://www.youtube.com/watch?v=aaaaaaaaaaa', 'done', $2, 100),
      ('done-omr-new', $1, 'omr', 'omr:y', 'done', $3, 100)`, [own, new Date(now - 2 * day), new Date(now - 1000)]);
    const n = await store.purge(now - 3 * day, now - day, now - day);
    ok('purge(3 days, 1 day, 1 day): the score done two days ago goes, the conversion done two days ago stays (three days), the new score stays', n === 1
      && (await one(`SELECT id FROM ppp_transcribe_jobs WHERE id IN ('done-omr-old', 'done-yt-old', 'done-omr-new') ORDER BY id`)).map(r => r.id).join() === 'done-omr-new,done-yt-old');
    ok('without the third number it is the old rule (a score is then kept as long as a conversion: the old code\'s call)', (await store.purge(now - 3 * day, now - day)) === 0);
    await store.insertOmrJob(mkJob('job-omr-0004', { status: 'queued' }), pagesOf(2));
    await store.claimJob('job-omr-0004', own, 'tok-1', now);
    await store.finishJob('job-omr-0004', own, 'failed', now - 2 * day, { error: 'x' });
    await q(`INSERT INTO ppp_omr_pages (job_id, idx, bytes) VALUES ('job-omr-0004', 0, 'x'::bytea) ON CONFLICT DO NOTHING`);
    ok('(a failed job that still has a page row, as after a crash)', (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = 'job-omr-0004'`))[0].n >= 1);
    ok('deleting the job row (the purge, deleteJobs, a removed link) removes its page rows with it: the foreign key cascades', (await store.deleteJobs(['job-omr-0004'], own)) === 1 && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = 'job-omr-0004'`))[0].n === 0);
    await store.insertOmrJob(mkJob('job-omr-0005'), pagesOf(2));
    ok('revoking a link (one statement) takes the waiting score and its images', await (async () => {
      await q(`INSERT INTO ppp_pc_links (id, client_hash) VALUES ($1, $2)`, [own, 'a'.repeat(64)]);
      await store.revokeLink(own, Date.now());
      return (await one(`SELECT count(*)::int n FROM ppp_omr_pages`))[0].n === 0;
    })());
    await q(`DELETE FROM ppp_transcribe_jobs; DELETE FROM ppp_pc_links`);

    heading('the size: twelve pages of a megabyte, one statement, one read');
    {
      const big = Array.from({ length: 12 }, (_, i) => L.pngBytes(2480, 3508 - i, 1024 * 1024 - 100));
      const t0 = Date.now();
      await store.insertOmrJob(mkJob('job-omr-big1', { bytes: big.reduce((a, b) => a + b.length, 0) }), big);
      const t1 = Date.now();
      await store.claimJob('job-omr-big1', own, 'tok-1', Date.now());
      const back = await store.getOmrPage('job-omr-big1', own, 11);
      ok('12 MB of images go in as one statement (' + (t1 - t0) + ' ms) and the last page comes back whole (' + (Date.now() - t1) + ' ms)', back && back.equals(big[11]) && (await one(`SELECT sum(length(bytes))::int s FROM ppp_omr_pages WHERE job_id = 'job-omr-big1'`))[0].s === big.reduce((a, b) => a + b.length, 0));
      await q(`DELETE FROM ppp_transcribe_jobs WHERE id = 'job-omr-big1'`);
    }

    heading('the whole thing through the real server.js: a score, from the page\'s request to the PC and back');
    await q(`DROP TABLE IF EXISTS ppp_omr_pages, ppp_worker_tokens, ppp_transcribe_jobs, ppp_pc_links, ppp_progress, ppp_users CASCADE`);
    srv = await startServer(DB_URL);
    {
      const lk = await req(srv.port, 'POST', '/api/pc-links', { body: {}, ip: '198.51.100.40' });
      const code = lk.body.clientCode, tok = lk.body.workerToken;
      ok('(a link, no sign-in)', lk.status === 201);
      const noPc = await req(srv.port, 'POST', '/api/jobs/omr', { code: code, body: { pages: L.omrPages(2) } });
      ok('a score for a PC that has not connected is 409 no-pc, and no row of it is made', noPc.status === 409 && noPc.body.code === 'no-pc' && (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs`))[0].n === 0);
      await req(srv.port, 'POST', '/api/worker/claim', { token: tok, body: { once: true, omr: true } });
      const pages = L.omrPages(3, { w: 1200 });
      const sent = await req(srv.port, 'POST', '/api/jobs/omr', { code: code, body: { title: 'Czerny.pdf', pages: pages } });
      const id = sent.body.job && sent.body.job.id;
      ok('queued: 201, three page rows, the job row of kind omr', sent.status === 201 && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = $1`, [id]))[0].n === 3
        && (await one(`SELECT kind, status, bytes FROM ppp_transcribe_jobs WHERE id = $1`, [id]))[0].kind === 'omr', sent.status + ' ' + sent.text.slice(0, 120));
      const second = await req(srv.port, 'POST', '/api/jobs/omr', { code: code, body: { title: 'Czerny.pdf', pages: pages } });
      ok('the same pages again are the same job (200, existing), no second set of rows', second.status === 200 && second.body.existing === true && (await one(`SELECT count(*)::int n FROM ppp_omr_pages`))[0].n === 3);
      const c = await req(srv.port, 'POST', '/api/worker/claim', { token: tok, body: { once: true, omr: true } });
      ok('the worker claims it: 3 pages', c.body.job && c.body.job.id === id && c.body.job.pages === 3 && c.body.job.kind === 'omr');
      const p1 = await req(srv.port, 'GET', '/api/worker/jobs/' + id + '/pages/1', { token: tok });
      ok('a page is the bytes uploaded (read from the database)', p1.status === 200 && p1.headers['content-type'] === 'image/png' && Buffer.from(p1.text, 'latin1').length > 100);
      const doneRes = await req(srv.port, 'POST', '/api/worker/jobs/' + id + '/result', { token: tok, body: L.omrResult(3) });
      ok('the result is taken; the page rows are deleted in the same breath (none left), the job row holds the result', doneRes.status === 200 && (await one(`SELECT count(*)::int n FROM ppp_omr_pages`))[0].n === 0
        && (await one(`SELECT status, bytes, result->>'kind' AS kind FROM ppp_transcribe_jobs WHERE id = $1`, [id]))[0].kind === 'omr', doneRes.status + ' ' + doneRes.text);
      const got = await req(srv.port, 'GET', '/api/jobs/' + id, { code: code });
      ok('the page opens it: the pages and their movements, no DOCTYPE', got.status === 200 && got.body.result.pages.length === 3 && got.body.result.pages.every(x => x.ok && x.movements[0].indexOf('<!DOCTYPE') < 0));
      const rm = await req(srv.port, 'DELETE', '/api/jobs/' + id, { code: code });
      ok('removed by the page: the row is gone', rm.status === 200 && (await one(`SELECT count(*)::int n FROM ppp_transcribe_jobs`))[0].n === 0);
      ok('and server.js\'s log shows no image, no code and no token', (l => l.indexOf(code) < 0 && l.indexOf(tok) < 0 && !/iVBOR/.test(l))(srv.log()));

      /* the database's own log: an idle poll of a worker that can read scores runs no statement */
      if (CONTAINER) {
        const lines = () => spawnSync('docker', ['logs', CONTAINER], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
        const stmts = () => { const r = lines(); return ((r.stdout || '') + (r.stderr || '')).split('\n').filter(l => /statement:/.test(l) && /ppp_(transcribe_jobs|worker_tokens|pc_links|omr_pages)/.test(l)); };
        await req(srv.port, 'POST', '/api/worker/claim', { token: tok, body: { once: true, omr: true } });   /* warm: the cold read is behind us */
        await sleep(300);
        const a = stmts().length;
        for (let i = 0; i < 30; i++) await req(srv.port, 'POST', '/api/worker/claim', { token: tok, body: { once: true, omr: true, waitSeconds: 3600 } });
        for (let i = 0; i < 10; i++) await req(srv.port, 'GET', '/api/worker/ping', { token: tok });
        await req(srv.port, 'GET', '/api/jobs', { code: code });
        await sleep(300);
        const delta = stmts().slice(a);
        ok('30 idle polls (omr: true), 10 pings and a list: ZERO statements on the queue\'s tables in the database\'s own log', delta.length === 0, delta.map(l => l.replace(/^.*statement:\s*/, '').slice(0, 90)).join(' || '));
      } else console.log('  - PPP_TEST_PG_CONTAINER is not set: the database\'s own log is not read');
      const ex = await req(srv.port, 'POST', '/api/jobs/omr', { code: code, body: { pages: L.omrPages(1, { w: 1300 }) } });
      ok('(a new score after all that: queued)', ex.status === 201);
    }
    await srv.close();
    srv = null;

    heading('a restart: a waiting score is still there, with its images; a finished one that still holds images has them deleted by the boot');
    {
      await q(`DELETE FROM ppp_transcribe_jobs; DELETE FROM ppp_worker_tokens; DELETE FROM ppp_pc_links`);
      srv = await startServer(DB_URL);
      const lk = await req(srv.port, 'POST', '/api/pc-links', { body: {}, ip: '198.51.100.41' });
      const code = lk.body.clientCode, tok = lk.body.workerToken;
      await req(srv.port, 'POST', '/api/worker/claim', { token: tok, body: { once: true, omr: true } });
      const a = await req(srv.port, 'POST', '/api/jobs/omr', { code: code, body: { pages: L.omrPages(2, { w: 1100 }) } });
      const b = await req(srv.port, 'POST', '/api/jobs/omr', { code: code, body: { pages: L.omrPages(2, { w: 1101 }) } });
      await req(srv.port, 'POST', '/api/worker/claim', { token: tok, body: { once: true, omr: true } });
      await srv.close();
      /* a crash between "done" and the delete of the images: the job is done, its page rows are still there */
      await q(`UPDATE ppp_transcribe_jobs SET status = 'done', finished_at = now(), result = '{"v":1}'::jsonb WHERE id = $1`, [a.body.job.id]);
      ok('(a finished job that still holds two page rows)', (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = $1`, [a.body.job.id]))[0].n === 2);
      srv = await startServer(DB_URL);
      const st = await req(srv.port, 'GET', '/api/jobs', { code: code });
      await sleep(400);
      ok('after the restart the boot read finds them and deletes them; the waiting score keeps its two', st.status === 200 && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = $1`, [a.body.job.id]))[0].n === 0
        && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = $1`, [b.body.job.id]))[0].n === 2);
      const c = await req(srv.port, 'POST', '/api/worker/claim', { token: tok, body: { once: true, omr: true } });
      ok('and the PC claims the waiting one after the restart: its pages are fetched from the database', c.body.job && c.body.job.id === b.body.job.id && (await req(srv.port, 'GET', '/api/worker/jobs/' + b.body.job.id + '/pages/0', { token: tok })).status === 200);
      await srv.close();
      srv = null;
    }

    heading('a jobs table dropped by hand: the pages table survives without its key, and the next boot puts it back and removes what nothing names');
    {
      const fk = async () => (await one(`SELECT conname, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'ppp_omr_pages'::regclass AND contype = 'f'`));
      await q(`DROP TABLE ppp_transcribe_jobs CASCADE`);                 /* the doc's wrong way: CASCADE takes the key and leaves the pages table */
      ok('(the pages table is still there, without any foreign key, with its rows)', (await fk()).length === 0 && (await one(`SELECT count(*)::int n FROM ppp_omr_pages`))[0].n >= 0);
      await q(`INSERT INTO ppp_omr_pages (job_id, idx, bytes) VALUES ('ghost-job-001', 0, 'aa'::bytea), ('ghost-job-001', 1, 'bb'::bytea), ('ghost-job-002', 0, 'cc'::bytea)`);
      const m = await Store.migrate(pool, '');
      ok('migrate on it works (the jobs table is made again) and the queue is on', m && m.queue === true, JSON.stringify(m && m.error && m.error.message));
      const k = await fk();
      ok('the foreign key is back: ON DELETE CASCADE, named as the table would have named it', k.length === 1 && k[0].conname === 'ppp_omr_pages_job_id_fkey' && /FOREIGN KEY \(job_id\) REFERENCES ppp_transcribe_jobs\(id\) ON DELETE CASCADE/.test(k[0].d), JSON.stringify(k));
      ok('and the page rows that no job named were deleted first (the key could not have been made over them)', (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id LIKE 'ghost-job-%'`))[0].n === 0);
      /* the key missing again, with a real job among the orphans: the job's pages are kept, the others go */
      await store.insertOmrJob(mkJob('job-keep-0001'), pagesOf(2));
      await q(`ALTER TABLE ppp_omr_pages DROP CONSTRAINT ppp_omr_pages_job_id_fkey`);
      await q(`INSERT INTO ppp_omr_pages (job_id, idx, bytes) VALUES ('ghost-job-003', 0, 'dd'::bytea)`);
      await Store.migrate(pool, '');
      ok('with a job among them only the orphan goes: the job keeps its two pages, the key is back', (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = 'job-keep-0001'`))[0].n === 2
        && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = 'ghost-job-003'`))[0].n === 0 && (await fk()).length === 1);
      const stable = (await one(`SELECT count(*)::int n FROM ppp_omr_pages`))[0].n;
      await Store.migrate(pool, '');
      ok('and with the key there the DO block deletes nothing (a third migrate leaves every row)', (await one(`SELECT count(*)::int n FROM ppp_omr_pages`))[0].n === stable && stable === 2);

      /* the service's own sweeper: the key is gone, rows nobody names are there; the boot read counts them and the first purge deletes them */
      await q(`ALTER TABLE ppp_omr_pages DROP CONSTRAINT ppp_omr_pages_job_id_fkey`);
      await q(`INSERT INTO ppp_omr_pages (job_id, idx, bytes) VALUES ('ghost-job-004', 0, 'ee'::bytea), ('ghost-job-004', 1, 'ff'::bytea)`);
      const loaded = await store.loadAll();
      ok('loadAll says how many page rows no job names (2) in the same single statement', loaded.orphanPages === 2, JSON.stringify(loaded.orphanPages));
      statements = 0;
      await counting.loadAll();
      ok('(still one round trip for the whole boot read)', statements === 1, statements + '');
      /* a purge is one statement and takes them too (the CTE of purge), whether or not a job row is purged by it */
      statements = 0;
      const purged = await counting.purge(0, 0, 0);
      ok('a purge (one statement) that deletes no job removes the page rows no job names, and leaves the pages of a job', purged === 0 && statements === 1 && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = 'ghost-job-004'`))[0].n === 0
        && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = 'job-keep-0001'`))[0].n === 2, purged + ' ' + statements);
      await q(`INSERT INTO ppp_omr_pages (job_id, idx, bytes) VALUES ('ghost-job-004', 0, 'ee'::bytea), ('ghost-job-004', 1, 'ff'::bytea)`);
      ok('deleteOrphanPages removes exactly those and not the pages of a job', (await store.deleteOrphanPages()) === 2 && (await one(`SELECT count(*)::int n FROM ppp_omr_pages`))[0].n === 2 && (await store.loadAll()).orphanPages === 0);
      await q(`ALTER TABLE ppp_omr_pages ADD CONSTRAINT ppp_omr_pages_job_id_fkey FOREIGN KEY (job_id) REFERENCES ppp_transcribe_jobs (id) ON DELETE CASCADE`);
      await q(`DELETE FROM ppp_transcribe_jobs`);
      ok('(back to a clean database for the rest: the cascade took the job\'s pages)', (await one(`SELECT count(*)::int n FROM ppp_omr_pages`))[0].n === 0);

      /* through the real server: the key dropped, orphans planted, a boot, a request */
      await q(`ALTER TABLE ppp_omr_pages DROP CONSTRAINT ppp_omr_pages_job_id_fkey`);
      await q(`INSERT INTO ppp_omr_pages (job_id, idx, bytes) VALUES ('ghost-job-005', 0, 'gg'::bytea)`);
      srv = await startServer(DB_URL);       /* (its own migration puts the key back and deletes them: the same result by the other road) */
      await req(srv.port, 'GET', '/api/jobs', { code: '0'.repeat(64) });
      await sleep(300);
      ok('server.js\'s own boot leaves no page row that no job names (its migration did it; and the key is there)', (await one(`SELECT count(*)::int n FROM ppp_omr_pages`))[0].n === 0 && (await fk()).length === 1);
      await srv.close();
      srv = null;
    }

    heading('rolling back: the code before G12-5 boots on this database and does its own deletes');
    {
      const OLD_REV = 'adb9f3f';
      const oldDir = L.tmpDir('ppp-old-' + OLD_REV + '-');
      let have = true;
      for (const f of ['server.js', 'home-jobs.js', 'home-jobs-store.js', 'home-result.js', 'share-guest.js', 'catalog/shared-seeds.json']) {
        const r = spawnSync('git', ['show', OLD_REV + ':' + f], { cwd: L.REPO, maxBuffer: 256 * 1024 * 1024 });
        if (r.status !== 0) { have = false; break; }
        L.fs.mkdirSync(path.dirname(path.join(oldDir, f)), { recursive: true });
        L.fs.writeFileSync(path.join(oldDir, f), r.stdout);
      }
      if (!have) console.log('  - the code of ' + OLD_REV + ' is not in this clone\'s history: the rollback check is skipped');
      else {
        const OldStore = require(path.join(oldDir, 'home-jobs-store.js'));
        const old = OldStore.pgJobStore((sql, p) => pool.query(sql, p));
        await q(`DELETE FROM ppp_transcribe_jobs`);
        const j = mkJob('job-omr-roll1', { status: 'queued', bytes: 10 });
        await store.insertOmrJob(j, pagesOf(2));
        await store.claimJob('job-omr-roll1', own, 'tok-1', Date.now());
        await store.finishJob('job-omr-roll1', own, 'done', now - 2 * day, { result: { v: 1 }, bytes: 5 });
        const m = await OldStore.migrate(pool, '');
        ok('the old migrate runs on the new database and says the queue is on (it only needs its own tables)', m && m.queue === true, JSON.stringify(m && m.error && m.error.message));
        const all = await old.loadAll();
        ok('the old boot read works on the new schema and reads the score\'s row as a job (an extra column it does not name)', all.jobs.some(x => x.id === 'job-omr-roll1' && x.kind === 'omr'));
        const purged = await old.purge(now - day, now - day);
        ok('the old code\'s purge (its own SQL) deletes the finished score and the page rows go with it (the cascade)', purged >= 1 && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = 'job-omr-roll1'`))[0].n === 0);
        await store.insertOmrJob(mkJob('job-omr-roll2'), pagesOf(1));
        ok('and the old code claims a queued score (it would then fail it: "not a YouTube video") without touching the pages table', (await old.claimJob('job-omr-roll2', own, 'tok-2', Date.now())) === true && (await one(`SELECT count(*)::int n FROM ppp_omr_pages WHERE job_id = 'job-omr-roll2'`))[0].n === 1);
        ok('a manual DROP of the queue\'s tables needs ppp_omr_pages first (the doc says so): DROP TABLE ppp_transcribe_jobs alone is refused, with CASCADE it works', await (async () => {
          const alone = await q('DROP TABLE ppp_transcribe_jobs').then(() => 'dropped', e => e.code);
          const withTable = await q('DROP TABLE ppp_omr_pages, ppp_transcribe_jobs').then(() => 'dropped', e => e.code);
          return alone === '2BP01' && withTable === 'dropped';
        })());
      }
      L.rmDir(oldDir);
    }
  } finally {
    if (srv) await srv.close().catch(() => {});
    await pool.end().catch(() => {});
    try { await admin.query('DROP DATABASE IF EXISTS ' + DB + ' WITH (FORCE)'); } catch (e) { /* the container is thrown away */ }
    await admin.end().catch(() => {});
  }
  L.finish('the home-PC queue, kind omr, on Postgres');
})().catch(e => { console.error(e); process.exit(1); });
