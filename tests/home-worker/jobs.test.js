/* G10b-1: the home-PC transcription queue (home-jobs.js, home-jobs-store.js, home-result.js), driven over real HTTP with a counting
   store (the file store, so no Postgres is needed; tests/home-worker/jobs-pg.test.js runs the same store and the migration on Postgres).

   What it pins:
     - the result a worker may post: every bound of home-result.js, and that everything else is stripped
     - who may do what: the browser routes need an account (a guest key is not one) and this site as origin; a worker token can
       only claim and complete the jobs of its own account; somebody else's job is "not there"; a revoked token is dead at once
     - the tokens: shown once, only a hash is kept (the file store is searched for the secret), listed without it
     - the queue: the caps (5 waiting, 5 tokens, rows per account), duplicates, rate limits, the lease, the attempts, the 3 days
     - the waits: nextPollSeconds idle (3600 by default, never under 900) and active (15), the long-poll that only waits when a job is in sight, and that it
       gives up a disconnected request
     - THE FREE-TIER RULE: after one read per boot, polls that find nothing run NO store call at all (counted)
     - a store that fails: "try again", nothing leaks, the queue is as it was

   Run: node tests/home-worker/jobs.test.js */
'use strict';
const L = require('./lib');
const { ok, heading, sleep, req, WATCH, goodResult, notes } = L;
const R = L.mod('home-result.js');
const J = L.mod('home-jobs.js');

const URL1 = WATCH('vgnliVjJUOo');

/* a token made through the API, as a person would: returns the secret string */
async function mkToken(S, user, label) {
  const r = await S.as(user).post('/api/worker/tokens', { label: label || 'My PC' });
  if (r.status !== 201) throw new Error('token create ' + r.status + ' ' + r.text);
  return r.body.token;
}
async function enqueue(S, user, id, extra) {
  return S.as(user).post('/api/jobs', Object.assign({ url: WATCH(id || 'aaaaaaaaaaa'), title: 'A piece' }, extra));
}

async function resultRules() {
  heading('the result a worker may post (home-result.js)');
  const good = goodResult(40);
  const v = R.validateResult(good);
  ok('a well-formed result is accepted', v.ok && v.result.notes.length === 40 && v.result.v === 1, JSON.stringify(v).slice(0, 120));
  ok('notes come back sorted by onset, pitch', v.ok && v.result.notes.every((n, i, a) => !i || a[i - 1].on <= n.on));
  const shuffled = JSON.parse(JSON.stringify(good)); shuffled.notes.reverse();
  shuffled.notes.push({ on: 1.5, off: 1.8, midi: 30, vel: 50 }, { on: 1.5, off: 1.7, midi: 90, vel: 50 });
  const vs = R.validateResult(shuffled);
  ok('a result whose notes arrive in any order is stored in order: by onset, then pitch (so the page, which reads them in order, can)', vs.ok && vs.result.notes.every((n, i, a) => !i || a[i - 1].on < n.on || (a[i - 1].on === n.on && a[i - 1].midi <= n.midi)) && vs.result.notes[0].on === 0, vs.ok ? JSON.stringify(vs.result.notes.slice(0, 3)) : vs.error);
  ok('the result keeps only on, off, midi, vel per note', v.ok && v.result.notes.every(n => Object.keys(n).sort().join() === 'midi,off,on,vel'));
  const dirty = Object.assign({}, good, { pedals: [{ on: 1, off: 2 }], beats: [1, 2, 3], downbeats: [1], uncertainNotes: [{ on: 1, off: 2, midi: 60 }], __proto__x: 1, evil: '<script>' });
  dirty.notes = good.notes.map(n => Object.assign({}, n, { confidence: 1, support: 2, models: ['x'], extra: 'y' }));
  const vd = R.validateResult(dirty);
  ok('pedals, beats, uncertain notes, per-note extras and unknown keys are stripped', vd.ok && Object.keys(vd.result).sort().join() === 'device,duration,engine,ensemble,model,notes,v'
    && vd.result.notes.every(n => Object.keys(n).length === 4), vd.ok ? Object.keys(vd.result).join() : vd.error);
  const bad = (name, mut, code) => {
    const b = JSON.parse(JSON.stringify(good)); mut(b);
    const r = R.validateResult(b);
    ok(name, !r.ok && (!code || r.code === code), r.ok ? 'accepted' : r.code + ': ' + r.error);
  };
  bad('not an object', b => { b.notes = 'x'; }, 'bad-result');
  bad('fewer than 4 notes', b => { b.notes = b.notes.slice(0, 3); }, 'too-few-notes');
  bad('more than 20000 notes', b => { b.notes = Array.from({ length: 20001 }, (_, i) => ({ on: i * 0.01, off: i * 0.01 + 0.005, midi: 60, vel: 64 })); }, 'too-many-notes');
  bad('a midi below 21', b => { b.notes[3].midi = 20; }, 'bad-note');
  bad('a midi above 108', b => { b.notes[3].midi = 109; }, 'bad-note');
  bad('a fractional midi', b => { b.notes[3].midi = 60.5; }, 'bad-note');
  bad('a string midi', b => { b.notes[3].midi = '60'; }, 'bad-note');
  bad('NaN onset', b => { b.notes[3].on = NaN; b.notes[3] = Object.assign(b.notes[3], { on: 'x' }); }, 'bad-note');
  bad('a negative onset', b => { b.notes[3].on = -0.1; }, 'bad-note');
  bad('an offset before the onset', b => { b.notes[3].off = b.notes[3].on - 0.1; }, 'bad-note');
  bad('an offset equal to the onset', b => { b.notes[3].off = b.notes[3].on; }, 'bad-note');
  bad('a note past 15 minutes', b => { b.notes[3].on = 905; b.notes[3].off = 906; }, 'too-long');
  bad('a duration over 15 minutes', b => { b.duration = 1000; }, 'bad-duration');
  bad('a zero duration', b => { b.duration = 0; }, 'bad-duration');
  bad('a note that is null', b => { b.notes[3] = null; }, 'bad-note');
  bad('a note that is an array', b => { b.notes[3] = [1, 2, 3, 4]; }, 'bad-note');
  bad('a velocity that is not a number', b => { b.notes[3].vel = 'loud'; }, 'bad-note');
  bad('an engine name with markup', b => { b.engine = '<img src=x>'; }, 'bad-meta');
  bad('a device with a path in it', b => { b.device = '../../etc'; }, 'bad-meta');
  bad('an ensemble agreement over 1', b => { b.ensemble.agreement = 2; }, 'bad-meta');
  bad('a negative uncertain count', b => { b.ensemble.uncertain = -1; }, 'bad-meta');
  bad('seven models', b => { b.ensemble.models = ['a', 'b', 'c', 'd', 'e', 'f', 'g']; }, 'bad-meta');
  bad('a model name that is an object', b => { b.ensemble.models = [{}]; }, 'bad-meta');
  const clamp = JSON.parse(JSON.stringify(good)); clamp.notes[0].vel = 500; clamp.notes[1].vel = 0.2;
  const vc = R.validateResult(clamp);
  ok('a velocity is clamped to 1..127, not trusted', vc.ok && vc.result.notes.every(n => n.vel >= 1 && n.vel <= 127));
  const big = { notes: Array.from({ length: 20000 }, (_, i) => ({ on: i * 0.04, off: i * 0.04 + 0.03, midi: 60 + (i % 12), vel: 64 })), duration: 800 };
  const vb = R.validateResult(big);
  ok('20000 notes (the most) fit in 2 MB', vb.ok && vb.bytes < 2 * 1024 * 1024, vb.ok ? vb.bytes + ' bytes' : vb.error);
  const small = R.validateResult(good, { RESULT_MAX_BYTES: 500 });
  ok('a stored result over the byte cap is refused', !small.ok && small.code === 'too-large', small.code);
  ok('a duration is raised to the last note off when it is shorter', R.validateResult(Object.assign({}, good, { duration: 1 })).result.duration >= 58.9);
  const noMeta = R.validateResult({ notes: good.notes });
  ok('engine, model, device and ensemble are optional', noMeta.ok && noMeta.result.engine === 'ensemble' && noMeta.result.ensemble === null && noMeta.result.model === null);
  ok('a text of control characters and tags is cleaned', R.cleanText('a\u0000b<c>\n d', 50) === 'a b c d');
  ok('and of the characters that reorder or split text: bidi overrides and isolates, marks, line and paragraph separators', ['\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069', '\u200e', '\u200f', '\u061c', '\u2028', '\u2029'].every(c => R.cleanText('ab' + c + 'cd', 20) === 'ab cd'), JSON.stringify(R.cleanText('gpj\u202etxt.exe', 20)));
}

async function tokenRules() {
  heading('tokens');
  const t = J.newToken();
  ok('a token is ppw_ + 12 + _ + 43 characters', /^ppw_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(t.token) && t.hash.length === 64, t.token.length + '');
  ok('parseToken reads a bearer header and rejects the rest', J.parseToken('Bearer ' + t.token).id === t.token.slice(4, 16)
    && !J.parseToken('Basic ' + t.token) && !J.parseToken('Bearer ' + t.token + 'x') && !J.parseToken('Bearer ppw_short') && !J.parseToken('') && !J.parseToken(undefined) && !J.parseToken('Bearer a b'));
  ok('two tokens differ', J.newToken().token !== t.token);
}

async function main() {
  await resultRules();
  await tokenRules();

  const S = await L.startService();
  try {
    heading('who may ask');
    const anon = (m, p, b) => req(S.port, m, p, { body: b });
    ok('no session: every browser route is 401', (await Promise.all([anon('GET', '/api/jobs'), anon('POST', '/api/jobs', { url: URL1 }), anon('GET', '/api/jobs/abcdefgh1234'), anon('POST', '/api/jobs/abcdefgh1234/cancel', {}),
      anon('GET', '/api/worker/status'), anon('GET', '/api/worker/tokens'), anon('POST', '/api/worker/tokens', {}), anon('DELETE', '/api/worker/tokens/abcdefghijkl')])).every(r => r.status === 401));
    ok('a guest key is not an account', (await req(S.port, 'POST', '/api/jobs', { body: { url: URL1 }, headers: { 'X-PPP-Guest': 'g'.repeat(40) } })).status === 401);
    ok('a session for a user that does not exist is 401', (await req(S.port, 'GET', '/api/jobs', { user: 'nobody' })).status === 401);
    const xs = await req(S.port, 'POST', '/api/jobs', { user: 'u1', body: { url: URL1 }, headers: { Origin: 'https://evil.example' } });
    ok('a cross-site POST is refused (403) even with the cookie', xs.status === 403 && xs.body.code === 'cross-site', xs.status + '');
    ok('and so are cross-site cancel, token create and revoke', (await Promise.all([
      req(S.port, 'POST', '/api/jobs/abcdefgh1234/cancel', { user: 'u1', body: {}, headers: { Origin: 'null' } }),
      req(S.port, 'POST', '/api/worker/tokens', { user: 'u1', body: {}, headers: { Origin: 'http://127.0.0.1:1' } }),
      req(S.port, 'DELETE', '/api/worker/tokens/abcdefghijkl', { user: 'u1', headers: { Origin: 'https://evil.example' } })])).every(r => r.status === 403));
    const same = await req(S.port, 'POST', '/api/jobs', { user: 'u1', body: { url: URL1 }, headers: { Origin: 'http://127.0.0.1:' + S.port } });
    ok('a POST from this site (same Origin) is fine', same.status === 201, same.status + ' ' + same.text.slice(0, 80));
    await S.as('u1').post('/api/jobs/' + same.body.job.id + '/cancel');
    const opt = await req(S.port, 'OPTIONS', '/api/jobs', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    ok('CORS is closed: no Access-Control header on an answer, none on a preflight', !Object.keys(same.headers).some(h => /^access-control/i.test(h)) && !Object.keys(opt.headers).some(h => /^access-control/i.test(h)) && opt.status >= 400, opt.status + '');
    ok('every answer is no-store and nosniff', same.headers['cache-control'] === 'no-store' && same.headers['x-content-type-options'] === 'nosniff');

    heading('enqueue: what is a job');
    const e1 = await S.as('u1').post('/api/jobs', { url: 'https://youtu.be/vgnliVjJUOo?t=5', title: '  Hello \t <b>World</b>  ' });
    ok('a youtu.be link is accepted and made canonical (watch?v=)', e1.status === 201 && e1.body.job.url === URL1 && e1.body.job.status === 'queued', JSON.stringify(e1.body).slice(0, 160));
    ok('the title is one clean line', e1.body.job.title === 'Hello b World /b', e1.body.job.title);
    const badUrls = ['', 'https://example.com/watch?v=vgnliVjJUOo', 'https://youtube.com.evil.example/watch?v=vgnliVjJUOo', 'javascript:alert(1)', 'file:///etc/passwd', 'https://www.youtube.com/playlist?list=PLx', 'https://www.youtube.com/watch?v=a', 'not a url', 'https://www.youtube.com/watch?v=vgnliVjJUOo\nHost: x'];
    const badRes = [];
    for (const u of badUrls) badRes.push((await S.as('u1').post('/api/jobs', { url: u })).status);
    ok('anything that is not one YouTube video is 422 (the same rule as /api/youtube-audio)', badRes.every(s => s === 422), badRes.join());
    const yt = L.youtubeParser();
    const good11 = ['https://www.youtube.com/watch?v=abcdefghijk', 'https://youtu.be/ab-_Efgh1jK', 'https://m.youtube.com/watch?v=-bcdefghij_', 'https://www.youtube.com/shorts/abcdefghijk', 'https://www.youtube.com/live/abcdefghijk/', 'https://www.youtube.com/embed/abcdefghijk?x=1', 'https://music.youtube.com/watch?v=abcdefghijk&list=PLxxxxxxxxx'];
    const not11 = ['https://www.youtube.com/watch?v=abcdef', 'https://www.youtube.com/watch?v=abcdefghij', 'https://www.youtube.com/watch?v=abcdefghijkl', 'https://youtu.be/abcdef', 'https://youtu.be/abcdefghijkl', 'https://www.youtube.com/shorts/abcdefghijkl', 'https://www.youtube.com/embed/abcdefghijkmore', 'https://www.youtube.com/watch?v=abcdefghi%2Fk', 'https://www.youtube.com/watch?v=abcdefghi.k', 'https://www.youtube.com/watch?v=' + 'a'.repeat(64)];
    ok('a video id is exactly 11 of [A-Za-z0-9_-]: the usual links are accepted (watch, youtu.be, shorts, live, embed, music.)', good11.every(u => { const r = yt(u); return r && /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(r.url); }), good11.filter(u => !yt(u)).join(' '));
    ok('and 6, 10, 12 and 64 characters, a slash or a dot inside, or characters after the id of an embed are not', not11.every(u => yt(u) === null), not11.filter(u => yt(u)).join(' '));
    ok('a body that is not JSON, an array, or a number is refused', (await req(S.port, 'POST', '/api/jobs', { user: 'u1', body: '{nope' })).status === 400
      && (await req(S.port, 'POST', '/api/jobs', { user: 'u1', body: '[1]' })).status === 422 && (await req(S.port, 'POST', '/api/jobs', { user: 'u1', body: '5' })).status === 422);
    ok('a body of 100 KB is 413', (await req(S.port, 'POST', '/api/jobs', { user: 'u1', body: { url: URL1, pad: 'x'.repeat(100 * 1024) } })).status === 413);
    ok('a NUL in the body is refused', (await req(S.port, 'POST', '/api/jobs', { user: 'u1', body: '{"url":"' + URL1 + '","title":"a\\u0000b"}' })).status === 422);
    const dup = await S.as('u1').post('/api/jobs', { url: URL1 });
    ok('the same video asked for again while it waits is the same job (200, existing)', dup.status === 200 && dup.body.existing === true && dup.body.job.id === e1.body.job.id);
    ok('a job lists with its status, no notes and no owner', (() => { const j = e1.body.job; return !('result' in j) && !('ownerId' in j) && !('workerId' in j) && j.attempts === 0; })());

    heading('ownership');
    const list2 = await S.as('u2').get('/api/jobs');
    ok('another account sees none of it', list2.status === 200 && list2.body.jobs.length === 0);
    ok('and cannot read, cancel or find it: 404, not 403', (await S.as('u2').get('/api/jobs/' + e1.body.job.id)).status === 404 && (await S.as('u2').post('/api/jobs/' + e1.body.job.id + '/cancel')).status === 404);
    const tok1 = await mkToken(S, 'u1'), tok2 = await mkToken(S, 'u2');
    const c2 = await S.worker(tok2).post('/api/worker/claim', {});
    ok("u2's token claims nothing of u1's", c2.status === 200 && c2.body.job === null, JSON.stringify(c2.body));
    const f2 = await S.worker(tok2).post('/api/worker/jobs/' + e1.body.job.id + '/result', goodResult(40));
    const f3 = await S.worker(tok2).post('/api/worker/jobs/' + e1.body.job.id + '/fail', { error: 'x' });
    const f4 = await S.worker(tok2).post('/api/worker/jobs/' + e1.body.job.id + '/heartbeat', { pct: 0.5 });
    ok("u2's token cannot post a result, a failure or a heartbeat for u1's job: 404", f2.status === 404 && f3.status === 404 && f4.status === 404, [f2.status, f3.status, f4.status].join());
    ok('the job is untouched', (await S.as('u1').get('/api/jobs/' + e1.body.job.id)).body.job.status === 'queued');
    const c1 = await S.worker(tok1).post('/api/worker/claim', {});
    ok("u1's token claims it", c1.status === 200 && c1.body.job && c1.body.job.id === e1.body.job.id && c1.body.job.url === URL1 && c1.body.job.attempt === 1, JSON.stringify(c1.body));
    ok('a claim answer carries only what the worker needs', Object.keys(c1.body.job).sort().join() === 'attempt,id,maxAttempts,title,url');
    const stolen = await S.worker(tok2).post('/api/worker/jobs/' + e1.body.job.id + '/result', goodResult(40));
    ok("a claimed job still cannot be finished by another account's token", stolen.status === 404);
    ok('the owner sees it claimed', (await S.as('u1').get('/api/jobs')).body.jobs.find(j => j.id === e1.body.job.id).status === 'claimed');

    heading('tokens: shown once, stored as a hash');
    const mk = await S.as('u1').post('/api/worker/tokens', { label: ' <b>Studio</b> PC ' });
    ok('creating a token shows it once, with its id and label', mk.status === 201 && /^ppw_/.test(mk.body.token) && mk.body.label === 'b Studio /b PC' && mk.body.id === mk.body.token.slice(4, 16), JSON.stringify(mk.body).slice(0, 100));
    const lt = await S.as('u1').get('/api/worker/tokens');
    ok('the list never has the secret', lt.status === 200 && lt.body.tokens.length === 2 && !/ppw_/.test(lt.text) && lt.body.tokens.every(k => !('token' in k) && !('hash' in k)));
    ok('u2 lists only its own', (await S.as('u2').get('/api/worker/tokens')).body.tokens.length === 1);
    const disk = L.fs.readFileSync(L.path.join(S.dir, 'jobs.json'), 'utf8');
    ok('the store holds the sha256 of the token and never the token (or its secret half)', disk.indexOf(mk.body.token) < 0 && disk.indexOf(mk.body.token.slice(17)) < 0
      && disk.indexOf(L.crypto.createHash('sha256').update(mk.body.token).digest('hex')) > 0);
    ok('a token works', (await S.worker(mk.body.token).get('/api/worker/ping')).status === 200);
    ok('the secret half of another token with this id is not enough', (await S.worker(mk.body.token.slice(0, 17) + tok1.slice(17)).get('/api/worker/ping')).status === 401);
    ok('a one-character change is 401', (await S.worker(mk.body.token.slice(0, -1) + (mk.body.token.slice(-1) === 'A' ? 'B' : 'A')).get('/api/worker/ping')).status === 401);
    ok('a token that never existed is 401, with the same answer', (await S.worker('ppw_' + 'A'.repeat(12) + '_' + 'B'.repeat(43)).get('/api/worker/ping')).status === 401);
    ok('no header, a cookie instead, the wrong scheme: 401', (await req(S.port, 'GET', '/api/worker/ping', {})).status === 401
      && (await req(S.port, 'GET', '/api/worker/ping', { user: 'u1' })).status === 401 && (await req(S.port, 'GET', '/api/worker/ping', { headers: { Authorization: 'Token ' + mk.body.token } })).status === 401);
    ok('the answer to a bad token says nothing about why', (await S.worker('nonsense').get('/api/worker/ping')).text === JSON.stringify({ error: 'That token is not valid.', code: 'bad-token' }));
    const rv = await S.as('u2').del('/api/worker/tokens/' + mk.body.id);
    ok("u2 cannot revoke u1's token", rv.status === 404 && (await S.worker(mk.body.token).get('/api/worker/ping')).status === 200);
    const rv1 = await S.as('u1').del('/api/worker/tokens/' + mk.body.id);
    ok('revoking kills it at once', rv1.status === 200 && (await S.worker(mk.body.token).get('/api/worker/ping')).status === 401 && (await S.as('u1').get('/api/worker/tokens')).body.tokens.length === 1);
    ok('a worker token cannot use a browser route', (await req(S.port, 'GET', '/api/jobs', { token: tok1 })).status === 401 && (await req(S.port, 'POST', '/api/worker/tokens', { token: tok1, body: {} })).status === 401);
    const many = [];
    for (let i = 0; i < 5; i++) many.push((await S.as('u2').post('/api/worker/tokens', {})).status);
    ok('five tokens per account, then 429', many.join() === '201,201,201,201,429', many.join());

    heading('the answers to a worker: how long to wait');
    ok('with a job claimed, a poll is told to come back in 15 s', (await S.worker(tok1).post('/api/worker/claim', { once: true })).body.nextPollSeconds === 15);
    const res = await S.worker(tok1).post('/api/worker/jobs/' + e1.body.job.id + '/result', goodResult(40));
    ok('the result is accepted (200) and the job is done', res.status === 200 && res.body.ok === true && (await S.as('u1').get('/api/jobs')).body.jobs.find(j => j.id === e1.body.job.id).status === 'done');
    const after = await S.worker(tok1).post('/api/worker/claim', {});
    ok('just after a job finished the wait is still 15 s', after.body.job === null && after.body.nextPollSeconds === 15, JSON.stringify(after.body));
    S.advance(4 * 60 * 1000);
    ok('4 minutes after it still is', (await S.worker(tok1).post('/api/worker/claim', {})).body.nextPollSeconds === 15);
    S.advance(61 * 1000);
    const idle = await S.worker(tok1).post('/api/worker/claim', {});
    ok('5 minutes after, the wait is the idle one: 3600 s (an hour)', idle.body.nextPollSeconds === 3600 && idle.body.job === null, JSON.stringify(idle.body));
    ok("another account's activity does not change this one's wait", (await enqueue(S, 'u2', 'bbbbbbbbbbb')).status === 201 && (await S.worker(tok1).post('/api/worker/claim', { once: true })).body.nextPollSeconds === 3600);
    const cfgOf = v => J.configFrom(v == null ? {} : { PPP_WORKER_IDLE_POLL_S: v });
    ok('the idle wait is an hour unless it is set (PPP_WORKER_IDLE_POLL_S), the busy one 15 s; no warning for the default', cfgOf().idlePollS === 3600 && cfgOf().activePollS === 15 && cfgOf().warnings.length === 0);
    ok('the floor is 900 s: 3, 60 and 899 are raised to 900, each with a warning that says so', ['3', '60', '899'].every(v => cfgOf(v).idlePollS === 900 && cfgOf(v).warnings.some(w => /below 900; using 900/.test(w))));
    ok('900 is allowed but warned about (it keeps ppp-web awake all month); 1799 too; 1800 and up say nothing', cfgOf('900').idlePollS === 900 && /awake about 100%/.test(cfgOf('900').warnings.join()) && cfgOf('1799').warnings.length === 1 && cfgOf('1800').warnings.length === 0 && cfgOf('7200').idlePollS === 7200);
    ok('too long is cut to a day; a word is the default (and warned about); the busy wait has its own bounds', cfgOf('99999').idlePollS === 86400 && cfgOf('x').idlePollS === 3600 && cfgOf('x').warnings.length === 1 && J.configFrom({ PPP_WORKER_ACTIVE_POLL_S: '1' }).activePollS === 5 && J.configFrom({ PPP_WORKER_ACTIVE_POLL_S: '9999' }).activePollS === 300);
    const SW = await L.startService({ env: { PPP_WORKER_IDLE_POLL_S: '60' } });
    try { ok('the service hands the warnings to the server to log (once, at start)', SW.warned.length >= 2 && SW.warned.some(w => /below 900/.test(w)), SW.warned.join(' | ')); } finally { await SW.close(); }

    heading('result: after it is done');
    const gj = await S.as('u1').get('/api/jobs/' + e1.body.job.id);
    ok('the owner gets the notes with the job', gj.status === 200 && gj.body.job.status === 'done' && gj.body.result.notes.length === 40 && gj.body.result.ensemble.models.join() === 'transkun,piano-transcription', JSON.stringify(gj.body.job));
    ok('the list does not carry the notes', !(await S.as('u1').get('/api/jobs')).text.includes('"notes"'));
    ok('u2 gets nothing of it', (await S.as('u2').get('/api/jobs/' + e1.body.job.id)).status === 404);
    const again = await S.worker(tok1).post('/api/worker/jobs/' + e1.body.job.id + '/result', goodResult(40));
    ok('a second result for a done job is 409 and changes nothing', again.status === 409 && again.body.code === 'not-open' && (await S.as('u1').get('/api/jobs/' + e1.body.job.id)).body.result.notes.length === 40);
    const cdone = await S.as('u1').post('/api/jobs/' + e1.body.job.id + '/cancel');
    ok('a finished job cannot be cancelled (409)', cdone.status === 409);

    heading('a result is checked');
    const q2 = (await enqueue(S, 'u1', 'ccccccccccc')).body.job;
    const c = (await S.worker(tok1).post('/api/worker/claim', {})).body.job;
    ok('claimed the second', c && c.id === q2.id);
    const post = body => S.worker(tok1).post('/api/worker/jobs/' + q2.id + '/result', body);
    ok('a midi of 200 is 422 and the job stays claimed', (await post({ notes: [{ on: 0, off: 1, midi: 200, vel: 5 }, { on: 1, off: 2, midi: 60, vel: 5 }, { on: 2, off: 3, midi: 60, vel: 5 }, { on: 3, off: 4, midi: 60, vel: 5 }] })).status === 422
      && (await S.as('u1').get('/api/jobs/' + q2.id)).body.job.status === 'claimed');
    ok('3 notes is 422', (await post({ notes: notes(3) })).status === 422);
    ok('not an object is 422', (await post([1, 2])).status === 422 && (await req(S.port, 'POST', '/api/worker/jobs/' + q2.id + '/result', { token: tok1, body: '{bad' })).status === 400);
    ok('a result of 3 MB is 413', (await post({ notes: goodResult(40).notes, pad: 'x'.repeat(3 * 1024 * 1024) })).status === 413);
    ok('a result of 12 MB (past the drain) is cut off without the server dying', await (async () => { try { const r = await post({ notes: goodResult(40).notes, pad: 'x'.repeat(12 * 1024 * 1024) }); return r.status === 413; } catch (e) { return /ECONNRESET|EPIPE|socket hang up/.test(e.message); } })());
    ok('the job is still claimed after all that, and a good result still works', (await S.as('u1').get('/api/jobs/' + q2.id)).body.job.status === 'claimed' && (await post(goodResult(60))).status === 200);
    const stored = await S.inner.getResult(q2.id, 'u1');
    ok('what is stored is the stripped result', stored && Object.keys(stored).sort().join() === 'device,duration,engine,ensemble,model,notes,v');

    heading('fail, retry, attempts');
    const q3 = (await enqueue(S, 'u1', 'ddddddddddd')).body.job;
    let cl = (await S.worker(tok1).post('/api/worker/claim', {})).body.job;
    const fl = await S.worker(tok1).post('/api/worker/jobs/' + q3.id + '/fail', { error: 'download <failed>\n at /secret/path.js:1', retry: true });
    ok('a failure with retry puts it back in the queue (attempt 1 of 3)', fl.status === 200 && fl.body.requeued === true && (await S.as('u1').get('/api/jobs')).body.jobs.find(j => j.id === q3.id).status === 'queued');
    ok('a job given back is not handed out again at once (a failed download needs a little time): the next poll finds nothing', (await S.worker(tok1).post('/api/worker/claim', { once: true })).body.job === null);
    S.advance(2 * 60 * 1000 + 1000);
    cl = (await S.worker(tok1).post('/api/worker/claim', {})).body.job;
    ok('after two minutes it is claimed again with attempt 2', cl && cl.id === q3.id && cl.attempt === 2);
    await S.worker(tok1).post('/api/worker/jobs/' + q3.id + '/fail', { error: 'again', retry: true });
    ok('the second time it waits longer (4 minutes)', (S.advance(2 * 60 * 1000 + 1000), (await S.worker(tok1).post('/api/worker/claim', { once: true })).body.job === null));
    S.advance(2 * 60 * 1000);
    cl = (await S.worker(tok1).post('/api/worker/claim', {})).body.job;
    ok('and then attempt 3', cl && cl.attempt === 3);
    const f3b = await S.worker(tok1).post('/api/worker/jobs/' + q3.id + '/fail', { error: 'the third time', retry: true });
    const j3 = (await S.as('u1').get('/api/jobs')).body.jobs.find(j => j.id === q3.id);
    ok('after the third attempt a retry is not allowed: failed, with the worker\'s short message', f3b.body.requeued !== true && j3.status === 'failed' && j3.error === 'the third time', JSON.stringify(j3));
    const q4 = (await enqueue(S, 'u1', 'eeeeeeeeeee')).body.job;
    await S.worker(tok1).post('/api/worker/claim', {});
    await S.worker(tok1).post('/api/worker/jobs/' + q4.id + '/fail', { error: 'download <failed>\n at /secret/path.js:1' });
    const j4 = (await S.as('u1').get('/api/jobs')).body.jobs.find(j => j.id === q4.id);
    ok('a failure without retry is final; its text is one clean line', j4.status === 'failed' && j4.error === 'download failed at /secret/path.js:1', j4.error);
    ok('a failed job has no result to open', (await S.as('u1').get('/api/jobs/' + q4.id)).body.result === undefined);

    heading('heartbeat and cancel');
    const q5 = (await enqueue(S, 'u1', 'fffffffffff')).body.job;
    await S.worker(tok1).post('/api/worker/claim', {});
    ok('a heartbeat says how far it is, and the owner sees it', (await S.worker(tok1).post('/api/worker/jobs/' + q5.id + '/heartbeat', { stage: 'transcribe', pct: 0.4 })).status === 200
      && JSON.stringify((await S.as('u1').get('/api/jobs')).body.jobs.find(j => j.id === q5.id).progress) === JSON.stringify({ stage: 'transcribe', pct: 0.4 }));
    ok('a stage with odd characters is "working"', (await S.worker(tok1).post('/api/worker/jobs/' + q5.id + '/heartbeat', { stage: '<x>', pct: 5 })).status === 200
      && (await S.as('u1').get('/api/jobs')).body.jobs.find(j => j.id === q5.id).progress.stage === 'working');
    S.store.reset();
    for (let i = 0; i < 30; i++) await S.worker(tok1).post('/api/worker/jobs/' + q5.id + '/heartbeat', { stage: 'transcribe', pct: i / 30 });
    ok('30 heartbeats run ZERO store calls (progress and the lease live in memory; the database knows the claim, the result and nothing in between)', S.store.total() === 0, JSON.stringify(S.store.calls));
    const cn = await S.as('u1').post('/api/jobs/' + q5.id + '/cancel');
    ok('the owner cancels a claimed job', cn.status === 200 && cn.body.job.status === 'cancelled');
    const hb = await S.worker(tok1).post('/api/worker/jobs/' + q5.id + '/heartbeat', { pct: 0.5 });
    ok('the next heartbeat tells the worker so', hb.status === 200 && hb.body.cancelled === true);
    const rc = await S.worker(tok1).post('/api/worker/jobs/' + q5.id + '/result', goodResult(40));
    ok('a result for a cancelled job is 409 (cancelled) and not stored', rc.status === 409 && rc.body.code === 'cancelled' && (await S.as('u1').get('/api/jobs/' + q5.id)).body.job.status === 'cancelled');
    ok('cancelling twice is fine', (await S.as('u1').post('/api/jobs/' + q5.id + '/cancel')).status === 200);

    heading('the lease: 30 minutes, 3 attempts');
    const q6 = (await enqueue(S, 'u1', 'ggggggggggg')).body.job;
    await S.worker(tok1).post('/api/worker/claim', {});
    S.advance(29 * 60 * 1000);
    await S.worker(tok1).post('/api/worker/jobs/' + q6.id + '/heartbeat', { pct: 0.1 });
    S.advance(29 * 60 * 1000);
    await S.svc._state.sweep(S.clock.t);
    ok('a heartbeat keeps the lease: 58 minutes after the claim it is still claimed', jobStatus(S, q6.id) === 'claimed');
    S.advance(2 * 60 * 1000);
    await S.svc._state.sweep(S.clock.t);
    ok('31 minutes without a sign: back in the queue', jobStatus(S, q6.id) === 'queued');
    let guard = 0;
    while (jobStatus(S, q6.id) !== 'failed' && guard++ < 6) {
      const got = (await S.worker(tok1).post('/api/worker/claim', { once: true })).body.job;
      if (!got) break;
      S.advance(31 * 60 * 1000);
      await S.svc._state.sweep(S.clock.t);
    }
    ok('after the third lease that ran out it is failed, and says so', jobStatus(S, q6.id) === 'failed' && /did not finish/.test(jobOf(S, q6.id).error), jobStatus(S, q6.id) + ' ' + jobOf(S, q6.id).error);
    const late = await S.worker(tok1).post('/api/worker/jobs/' + q6.id + '/result', goodResult(40));
    ok('a result for a failed job is 409', late.status === 409);
    const q7 = (await enqueue(S, 'u1', 'hhhhhhhhhhh')).body.job;
    await S.worker(tok1).post('/api/worker/claim', {});
    S.advance(31 * 60 * 1000);
    await S.svc._state.sweep(S.clock.t);
    ok('a job whose lease ran out (back to queued) still takes the late result of the first worker', jobStatus(S, q7.id) === 'queued'
      && (await S.worker(tok1).post('/api/worker/jobs/' + q7.id + '/result', goodResult(40))).status === 200 && jobStatus(S, q7.id) === 'done');

    heading('the queue is bounded');
    const S2 = await L.startService({ users: ['p1', 'p2'] });
    try {
      const out = [];
      for (let i = 0; i < 7; i++) out.push((await S2.as('p1').post('/api/jobs', { url: WATCH('pppppppppp' + i) })).status);
      ok('5 waiting at most: the 6th and 7th are 429 (queue-full)', out.join() === '201,201,201,201,201,429,429', out.join());
      ok('the 429 says what to do', (await S2.as('p1').post('/api/jobs', { url: WATCH('pppppppppp9') })).body.code === 'queue-full');
      const first = (await S2.as('p1').get('/api/jobs')).body.jobs.slice(-1)[0];
      await S2.as('p1').post('/api/jobs/' + first.id + '/cancel');
      ok('cancelling one makes room', (await S2.as('p1').post('/api/jobs', { url: WATCH('pppppppppp9') })).status === 201);
      ok("one account's full queue does not block another", (await S2.as('p2').post('/api/jobs', { url: WATCH('pppppppppp0') })).status === 201);
      /* rows: the cap of 30 rows per account drops the oldest finished ones */
      const tk = await mkToken(S2, 'p2');
      for (let i = 0; i < 34; i++) {
        const j = (await S2.as('p2').post('/api/jobs', { url: WATCH('rowsrowsr' + String(i).padStart(2, '0')) })).body.job;
        const got = (await S2.worker(tk).post('/api/worker/claim', { once: true })).body.job;
        if (got) await S2.worker(tk).post('/api/worker/jobs/' + got.id + '/result', goodResult(10));
        void j;
        S2.advance(1000);
      }
      const rows = (await S2.as('p2').get('/api/jobs')).body.jobs;
      ok('an account keeps at most 30 rows: the oldest finished ones went', rows.length <= 30 && rows.length >= 28, rows.length + '');
      ok('and the store agrees (rows deleted, not just hidden)', (await S2.inner.loadAll()).jobs.filter(j => j.ownerId === 'p2').length <= 30);
    } finally { await S2.close(); }

    heading('rates');
    const S3 = await L.startService({ users: ['r1'] });
    try {
      const tk = await mkToken(S3, 'r1');
      const bad = [];
      for (let i = 0; i < 24; i++) bad.push((await S3.worker('ppw_' + 'A'.repeat(12) + '_' + String(i).padStart(43, 'B')).get('/api/worker/ping', { ip: '9.9.9.9' })).status);
      ok('20 wrong tokens from one address, then 429 (with Retry-After)', bad.slice(0, 20).every(s => s === 401) && bad.slice(20).every(s => s === 429), bad.join());
      const rr = await S3.worker('ppw_' + 'A'.repeat(12) + '_' + 'C'.repeat(43)).get('/api/worker/ping', { ip: '9.9.9.9' });
      ok('and it says when to come back', rr.status === 429 && Number(rr.headers['retry-after']) > 0);
      ok('another address is not affected', (await S3.worker(tk).get('/api/worker/ping', { ip: '8.8.8.8' })).status === 200);
      ok('a VALID token from that same address still works (the wrong tokens of others must not lock a working worker out), claim and result too', (await S3.worker(tk).get('/api/worker/ping', { ip: '9.9.9.9' })).status === 200 && (await S3.worker(tk).post('/api/worker/claim', { once: true }, { ip: '9.9.9.9' })).status === 200);
      ok('and a token that is not shaped like one counts as a failure too (and is 429 once the budget is gone)', (await S3.worker('nonsense').get('/api/worker/ping', { ip: '9.9.9.9' })).status === 429 && (await S3.worker('nonsense').get('/api/worker/ping', { ip: '7.7.7.7' })).status === 401);
      ok('a valid token never spends the budget: 30 pings from a fresh address leave its wrong-token budget whole', await (async () => {
        for (let i = 0; i < 30; i++) await S3.worker(tk).get('/api/worker/ping', { ip: '6.6.6.6' });
        const bad = [];
        for (let i = 0; i < 21; i++) bad.push((await S3.worker('ppw_' + 'A'.repeat(12) + '_' + String(i).padStart(43, 'D')).get('/api/worker/ping', { ip: '6.6.6.6' })).status);
        return bad.slice(0, 20).every(x => x === 401) && bad[20] === 429;
      })());
      let made = 0, refused = null;
      for (let i = 0; i < 34; i++) {
        const r = await S3.as('r1').post('/api/jobs', { url: WATCH('qqqqqqqq' + String(i).padStart(3, '0')) });
        if (r.status === 201) { made++; await S3.as('r1').post('/api/jobs/' + r.body.job.id + '/cancel'); } else if (!refused) refused = r;
      }
      ok('30 enqueues an hour per account, then 429 (too-many, with Retry-After); each refused one is free', made === 30 && !!refused && refused.status === 429 && refused.body.code === 'too-many' && Number(refused.headers['retry-after']) > 0, made + ' ' + (refused && refused.status));
      /* a request that makes nothing is free: refused bodies, links that are not YouTube, duplicates, a full queue */
      const SR = await L.startService({ users: ['f1', 'f2', 'f3'] });
      try {
        const junk = [];
        for (let i = 0; i < 45; i++) junk.push((await req(SR.port, 'POST', '/api/jobs', { user: 'f1', body: i % 3 === 0 ? '{bad' : i % 3 === 1 ? { url: 'https://example.com/x' } : { url: WATCH('freefreefre'), pad: 'x'.repeat(8000) } })).status);
        ok('45 refused requests (bad JSON, not YouTube, too big) used none of the 30 hourly enqueues: a good one still works', junk.every(x => x === 400 || x === 422 || x === 413) && (await enqueue(SR, 'f1', 'goodgoodgoo')).status === 201, junk.slice(0, 6).join());
        const tokJunk = [];
        for (let i = 0; i < 12; i++) tokJunk.push((await req(SR.port, 'POST', '/api/worker/tokens', { user: 'f2', body: '{bad' })).status);
        ok('and 12 refused token requests used none of the 10 hourly token makes', tokJunk.every(x => x === 400) && (await SR.as('f2').post('/api/worker/tokens', {})).status === 201);
        const dups = [];
        for (let i = 0; i < 40; i++) dups.push((await enqueue(SR, 'f1', 'goodgoodgoo')).status);
        ok('the same link asked 40 more times (it is already waiting) costs nothing either', dups.every(x => x === 200) && (await SR.as('f1').post('/api/jobs', { url: WATCH('goodgoodgo2') })).status === 201);
      } finally { await SR.close(); }
      /* the busiest address cannot use up everybody's hour: the limit is per address (60) and per account (30), not one bucket for the site */
      const SA = await L.startService({ users: ['a1', 'a2', 'a3'] });
      try {
        let madeA = 0, firstRefusal = null;
        for (let i = 0; i < 70; i++) {
          const who = ['a1', 'a2', 'a3'][i % 3];
          const r = await req(SA.port, 'POST', '/api/jobs', { user: who, ip: '10.1.1.1', body: { url: WATCH('addraddr' + String(i).padStart(3, '0')) } });
          if (r.status === 201) { madeA++; await SA.as(who).post('/api/jobs/' + r.body.job.id + '/cancel'); } else if (!firstRefusal) firstRefusal = r;
        }
        ok('one address: 60 enqueues an hour (over three accounts), then 429', madeA === 60 && !!firstRefusal && firstRefusal.status === 429 && firstRefusal.body.code === 'too-many', madeA + ' ' + (firstRefusal && firstRefusal.status));
        ok('another address is not touched by it (its person can still ask)', (await req(SA.port, 'POST', '/api/jobs', { user: 'a1', ip: '10.2.2.2', body: { url: WATCH('otheraddr01') } })).status === 201);
        const tokA = [];
        for (let i = 0; i < 6; i++) tokA.push((await req(SA.port, 'POST', '/api/worker/tokens', { user: ['a1', 'a2', 'a3'][i % 3], ip: '10.3.3.3', body: {} })).status);
        ok('tokens: 20 an hour per address too (a2 and a3 made 2 each here; the account cap is 10)', tokA.every(x => x === 201));
      } finally { await SA.close(); }
      const lim = J.LIMITS;
      ok('the limits are the ones the design states', lim.PENDING_PER_USER === 5 && lim.ROWS_PER_USER === 30 && lim.TOKENS_PER_USER === 5 && lim.MAX_ATTEMPTS === 3 && lim.LEASE_MS === 30 * 60 * 1000
        && lim.DONE_TTL_MS === 3 * 86400000 && lim.OTHER_TTL_MS === 86400000 && R.LIMITS.RESULT_MAX_BYTES === 2 * 1024 * 1024 && R.LIMITS.MAX_NOTES === 20000 && R.LIMITS.MAX_SECONDS === 900);
    } finally { await S3.close(); }

    heading('keeping time: purge and expiry');
    const S4 = await L.startService({ users: ['k1'] });
    try {
      const tk = await mkToken(S4, 'k1');
      const mkDone = async id => { const j = (await S4.as('k1').post('/api/jobs', { url: WATCH(id) })).body.job; const g = (await S4.worker(tk).post('/api/worker/claim', { once: true })).body.job; await S4.worker(tk).post('/api/worker/jobs/' + g.id + '/result', goodResult(10)); return j; };
      const mkFailed = async id => { const j = (await S4.as('k1').post('/api/jobs', { url: WATCH(id) })).body.job; const g = (await S4.worker(tk).post('/api/worker/claim', { once: true })).body.job; await S4.worker(tk).post('/api/worker/jobs/' + g.id + '/fail', { error: 'x' }); return j; };
      const dn = await mkDone('purgepurg01'), fl = await mkFailed('purgepurg02');
      S4.advance(25 * 3600 * 1000);
      await S4.svc._state.purge(S4.clock.t);
      let ids = (await S4.as('k1').get('/api/jobs')).body.jobs.map(j => j.id);
      ok('a failed job is purged after a day, a done one is kept (3 days)', ids.indexOf(fl.id) < 0 && ids.indexOf(dn.id) >= 0, ids.length + '');
      ok('and the database row is gone too', (await S4.inner.loadAll()).jobs.every(j => j.id !== fl.id));
      S4.advance(49 * 3600 * 1000);
      await S4.svc._state.purge(S4.clock.t);
      ids = (await S4.as('k1').get('/api/jobs')).body.jobs.map(j => j.id);
      ok('a done job is purged after three days', ids.indexOf(dn.id) < 0 && (await S4.inner.getResult(dn.id, 'k1')) === null);
      const qq = (await S4.as('k1').post('/api/jobs', { url: WATCH('purgepurg03') })).body.job;
      S4.advance(3 * 86400000 + 1000);
      await S4.svc._state.sweep(S4.clock.t);
      ok('a job nobody claimed in three days expires', jobStatus(S4, qq.id) === 'expired' && /No PC/.test(jobOf(S4, qq.id).error), jobStatus(S4, qq.id));
      const before = S4.store.calls.purge || 0;
      await S4.svc._state.purge(S4.clock.t + 1000);
      ok('with nothing left to purge, no DELETE is run', (S4.store.calls.purge || 0) === before, before + ' -> ' + S4.store.calls.purge);
    } finally { await S4.close(); }

    heading('the free database is small: one cap on all the notes kept');
    for (const cap of [1900, 1856]) {
      const SC = await L.startService({ users: ['c1', 'c2'], config: { totalResultBytes: cap } });
      try {
        const tc = await mkToken(SC, 'c1');
        const j1 = (await enqueue(SC, 'c1', 'capcapcap01')).body.job;
        await SC.worker(tc).post('/api/worker/claim', { once: true });
        const r1 = await SC.worker(tc).post('/api/worker/jobs/' + j1.id + '/result', goodResult(40));
        ok('cap ' + cap + ': the first result (1856 bytes) is kept', r1.status === 200);
        const j2 = await enqueue(SC, 'c1', 'capcapcap02');
        if (cap === 1856) {
          ok('cap ' + cap + ': once the notes kept reach it, a new job is refused (503 busy), and the refusal is not counted against the person', j2.status === 503 && j2.body.code === 'busy');
        } else {
          await SC.worker(tc).post('/api/worker/claim', { once: true });
          const r2 = await SC.worker(tc).post('/api/worker/jobs/' + j2.body.job.id + '/result', goodResult(40));
          ok('cap ' + cap + ': a result that would pass it is refused (503 busy) and the job stays claimed', j2.status === 201 && r2.status === 503 && r2.body.code === 'busy' && jobStatus(SC, j2.body.job.id) === 'claimed', r2.status + ' ' + r2.text);
          await SC.advance(4 * 86400000); await SC.svc._state.purge(SC.clock.t);
          ok('cap ' + cap + ': after the keeping time frees room it is taken', (await SC.worker(tc).post('/api/worker/jobs/' + j2.body.job.id + '/result', goodResult(40))).status === 200);
        }
      } finally { await SC.close(); }
    }

    heading('one account cannot use up the room: a share of the stored notes for each');
    {
      /* (a) the share is reached exactly: the next JOB is refused; (b) the share would be passed by a result: the RESULT is refused */
      for (const [cap, where] of [[3712, 'enqueue'], [3000, 'result']]) {
        const SU = await L.startService({ users: ['hog', 'teacher'], config: { perUserResultBytes: cap, totalResultBytes: 1e9 } });
        try {
          const th = await mkToken(SU, 'hog'), tt = await mkToken(SU, 'teacher');
          let hogDone = 0, refused = null;
          for (let i = 0; i < 5 && !refused; i++) {
            const q = await enqueue(SU, 'hog', 'hoghoghog0' + i);
            if (q.status !== 201) { refused = { at: 'enqueue', status: q.status, code: q.body.code }; break; }
            const g = (await SU.worker(th).post('/api/worker/claim', { once: true })).body.job;
            const r = await SU.worker(th).post('/api/worker/jobs/' + g.id + '/result', goodResult(40));
            if (r.status === 200) hogDone++; else refused = { at: 'result', status: r.status, code: r.body.code };
          }
          ok('cap ' + cap + ': an account that holds its share is refused with "quota" - at ' + where + ' (not "busy": the site as a whole is not full)', refused && refused.at === where && refused.code === 'quota' && hogDone === (where === 'enqueue' ? 2 : 1), JSON.stringify([hogDone, refused]));
          const q2 = await enqueue(SU, 'teacher', 'teacherteac');
          const g2 = (await SU.worker(tt).post('/api/worker/claim', { once: true })).body.job;
          const r2 = await SU.worker(tt).post('/api/worker/jobs/' + g2.id + '/result', goodResult(40));
          ok('cap ' + cap + ': another account (the teacher) is not affected at all: it queues and stores as usual', q2.status === 201 && r2.status === 200);
          await SU.advance(4 * 86400000); await SU.svc._state.purge(SU.clock.t);
          ok('cap ' + cap + ': and the hog has room again when its old results are cleared (3 days)', (await enqueue(SU, 'hog', 'hoghoghog9x')).status === 201);
        } finally { await SU.close(); }
      }
    }

    heading('the account is looked up once, then remembered (the page polls often)');
    {
      const SL = await L.startService({ users: ['m1'] });
      try {
        for (let i = 0; i < 25; i++) { await SL.as('m1').get('/api/jobs'); await SL.as('m1').get('/api/worker/status'); }
        ok('50 page requests by one account read the account once', SL.lookups.findUser === 1, SL.lookups.findUser + '');
        SL.advance(11 * 60 * 1000);
        await SL.as('m1').get('/api/jobs'); await SL.as('m1').get('/api/jobs');
        ok('and again, once, after the 10 minutes it is remembered for', SL.lookups.findUser === 2, SL.lookups.findUser + '');
      } finally { await SL.close(); }
    }

    heading('no timer reads the queue or the database (an idle server has to stay idle)');
    {
      const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
      const files = ['home-jobs.js', 'home-jobs-store.js', 'home-result.js'].map(f => [f, strip(L.fs.readFileSync(L.path.join(L.MODS, f), 'utf8'))]);
      const timers = files.map(([f, src]) => [f, (src.match(/\b(setInterval|setImmediate|setTimeout)\s*\(/g) || []), (src.match(/\.unref\s*\(/g) || []).length]);
      ok('home-result.js and home-jobs-store.js start no timer at all, and home-jobs.js none but the long-poll\'s own wait', timers.every(([f, t]) => f === 'home-jobs.js' ? t.length === 1 && t[0].indexOf('setTimeout') === 0 : t.length === 0) && timers.every(t => t[2] === 0), JSON.stringify(timers));
      const jobsSrc = files[0][1];
      const w = jobsSrc.indexOf('function waitForJob');
      const end = jobsSrc.indexOf('async function claim');
      ok('that one setTimeout is inside waitForJob (it resolves a promise; it reads nothing)', jobsSrc.indexOf('setTimeout(') > w && jobsSrc.indexOf('setTimeout(') < end && !/store\./.test(jobsSrc.slice(w, end)));
    }

    heading('THE FREE-TIER RULE: an idle poll runs no SQL');
    const S5 = await L.startService({ users: ['z1'], config: { longPollMs: 600 } });
    try {
      const tk = await mkToken(S5, 'z1');
      const mine = (await S5.as('z1').get('/api/jobs')).body.worker;
      ok('the owner sees a token that has not connected yet: has one, never seen, not alive', mine.hasToken && !mine.everSeen && !mine.alive && mine.idlePollSeconds === 3600);
      /* a boot: the memory is gone, the store is what is left */
      S5.svc._state.forgetAll();
      S5.store.reset();
      const t0 = Date.now();
      const p1 = await S5.worker(tk).post('/api/worker/claim', { waitSeconds: 3600 });
      const c1c = Object.assign({}, S5.store.calls);
      ok('the first poll after a boot reads the store once (loadAll) and writes the token\'s last-seen once (touchSeen), nothing else', c1c.loadAll === 1 && c1c.touchSeen === 1 && S5.store.total() === 2, JSON.stringify(c1c));
      ok('and it answers: no job, wait 3600', p1.status === 200 && p1.body.job === null && p1.body.nextPollSeconds === 3600);
      S5.store.reset();
      const times = [];
      for (let i = 0; i < 60; i++) {
        S5.advance(60 * 60 * 1000);
        const a = Date.now();
        const r = await S5.worker(tk).post('/api/worker/claim', { waitSeconds: 3600 });
        times.push(Date.now() - a);
        if (r.status !== 200 || r.body.job !== null) { ok('idle poll ' + i + ' answered 200, no job', false, r.status + ' ' + r.text); break; }
      }
      ok('60 idle polls (an hour apart, 60 hours) ran ZERO store calls', S5.store.total() === 0, JSON.stringify(S5.store.calls));
      ok('and none of them waited (an idle poll returns at once)', Math.max.apply(null, times) < 300, 'slowest ' + Math.max.apply(null, times) + ' ms');
      S5.store.reset();
      for (let i = 0; i < 20; i++) await S5.worker(tk).get('/api/worker/ping');
      for (let i = 0; i < 20; i++) { await S5.as('z1').get('/api/jobs'); await S5.as('z1').get('/api/worker/status'); await S5.as('z1').get('/api/worker/tokens'); }
      ok('pings and the page\'s own status polls run none either (the account is remembered)', S5.store.total() === 0, JSON.stringify(S5.store.calls));
      ok('the owner sees the worker alive (seen in memory, twice its wait)', (await S5.as('z1').get('/api/worker/status')).body.worker.alive === true);
      S5.advance(3 * 3600 * 1000);
      ok('and gone when it has not been heard of for more than twice its wait', (await S5.as('z1').get('/api/worker/status')).body.worker.alive === false);
      const cold = Date.now() - t0;
      void cold;

      /* a boot with a job waiting: the poll that boots finds it */
      const jb = (await S5.as('z1').post('/api/jobs', { url: WATCH('freetier001') })).body.job;
      S5.svc._state.forgetAll(); S5.store.reset();
      const pj = await S5.worker(tk).post('/api/worker/claim', {});
      ok('after a boot the first poll finds the job that was queued before it', pj.body.job && pj.body.job.id === jb.id, JSON.stringify(pj.body));
      ok('claiming writes the row, and the token\'s last-seen with it', S5.store.calls.claimJob === 1 && S5.store.calls.loadAll === 1, JSON.stringify(S5.store.calls));
      /* a boot with a job claimed before it */
      S5.svc._state.forgetAll(); S5.store.reset();
      const hb2 = await S5.worker(tk).post('/api/worker/jobs/' + jb.id + '/heartbeat', { pct: 0.3 });
      ok('a heartbeat after a boot still finds its claimed job (it was written when it was claimed)', hb2.status === 200 && hb2.body.cancelled !== true);
      const rs = await S5.worker(tk).post('/api/worker/jobs/' + jb.id + '/result', goodResult(30));
      ok('and so does the result', rs.status === 200 && (await S5.as('z1').get('/api/jobs/' + jb.id)).body.result.notes.length === 30);
    } finally { await S5.close(); }

    heading('long-poll: only with something in sight, and never for a hung-up client');
    const S6 = await L.startService({ users: ['w1'], config: { longPollMs: 400 } });
    try {
      const tk = await mkToken(S6, 'w1');
      const j1 = (await S6.as('w1').post('/api/jobs', { url: WATCH('longpoll001') })).body.job;
      const g1 = (await S6.worker(tk).post('/api/worker/claim', {})).body.job;
      ok('claimed the first', g1 && g1.id === j1.id);
      /* something is in sight (a claimed job): a poll waits, and a job that arrives meanwhile is handed over at once */
      const t1 = Date.now();
      const waiting = S6.worker(tk).post('/api/worker/claim', {});
      await sleep(120);
      const j2 = (await S6.as('w1').post('/api/jobs', { url: WATCH('longpoll002') })).body.job;
      const got = await waiting;
      ok('a poll with a claimed job in sight waits; a job that arrives is handed over at once (not after the full wait)', got.body.job && got.body.job.id === j2.id && Date.now() - t1 < 380, (Date.now() - t1) + ' ms');
      const t2 = Date.now();
      const none = await S6.worker(tk).post('/api/worker/claim', {});
      const waited = Date.now() - t2;
      ok('with nothing arriving it returns after the wait (about 400 ms here, 25 s in production), job null, still 15 s', none.body.job === null && waited >= 350 && waited < 900 && none.body.nextPollSeconds === 15, waited + ' ms');
      const t3 = Date.now();
      const once = await S6.worker(tk).post('/api/worker/claim', { once: true });
      ok('--once never waits', once.body.job === null && Date.now() - t3 < 300, (Date.now() - t3) + ' ms');
      /* a client that hangs up while waiting does not take the job that arrives later */
      const gone = S6.worker(tk).post('/api/worker/claim', {}, { abortAfter: 100 }).catch(() => 'aborted');
      await sleep(160);
      const j3 = (await S6.as('w1').post('/api/jobs', { url: WATCH('longpoll003') })).body.job;
      await gone; await sleep(80);
      ok('a worker that hung up while waiting does not take the job that arrives (it stays queued)', jobStatus(S6, j3.id) === 'queued', jobStatus(S6, j3.id));
    } finally { await S6.close(); }

    heading('a store that fails');
    const S7 = await L.startService({ users: ['s1'] });
    try {
      const tk = await mkToken(S7, 's1');
      const jb = (await S7.as('s1').post('/api/jobs', { url: WATCH('storefail01') })).body.job;
      S7.store.fail.on = true; S7.store.fail.only = 'claimJob';
      const c = await S7.worker(tk).post('/api/worker/claim', { once: true });
      ok('a claim whose write fails is 503 (try again), with nothing of the error in it', c.status === 503 && c.body.code === 'store' && !/store is down|Error|\.js/.test(c.text), c.text);
      S7.store.fail.on = false;
      ok('and the job is still queued, claimable (memory was put back)', jobStatus(S7, jb.id) === 'queued' && (await S7.worker(tk).post('/api/worker/claim', { once: true })).body.job.id === jb.id);
      S7.store.fail.on = true; S7.store.fail.only = 'finishJob';
      const r = await S7.worker(tk).post('/api/worker/jobs/' + jb.id + '/result', goodResult(20));
      ok('a result whose write fails is 503 and the job is still claimed', r.status === 503 && jobStatus(S7, jb.id) === 'claimed');
      S7.store.fail.on = false;
      ok('the worker can post it again', (await S7.worker(tk).post('/api/worker/jobs/' + jb.id + '/result', goodResult(20))).status === 200);
      S7.store.fail.on = true; S7.store.fail.only = 'insertJob';
      const e = await S7.as('s1').post('/api/jobs', { url: WATCH('storefail02') });
      S7.store.fail.on = false;
      ok('an enqueue whose write fails is 503, and leaves no ghost in the list or the cap', e.status === 503 && (await S7.as('s1').get('/api/jobs')).body.jobs.length === 1);
      S7.store.fail.on = true; S7.store.fail.only = 'insertToken';
      const tf = await S7.as('s1').post('/api/worker/tokens', {});
      S7.store.fail.on = false;
      ok('a token whose write fails is 503 and is not listed', tf.status === 503 && (await S7.as('s1').get('/api/worker/tokens')).body.tokens.length === 1);
      S7.store.fail.on = true; S7.store.fail.only = 'loadAll';
      S7.svc._state.forgetAll();
      const lf = await S7.worker(tk).post('/api/worker/claim', {});
      ok('a boot read that fails is 503 and is tried again by the next request', lf.status === 503);
      S7.store.fail.on = false;
      ok('which then works', (await S7.worker(tk).post('/api/worker/claim', {})).status === 200);
      ok('the failures were logged (one line each), not shown', S7.logged.length >= 3 && S7.logged.every(l => typeof l === 'string'));
    } finally { await S7.close(); }

    heading('a restart keeps the queue');
    const dir = L.tmpDir();
    const { fileJobStore } = L.mod('home-jobs-store.js');
    const A = await L.startService({ users: ['b1'], store: fileJobStore(dir) });
    let tkA, jobA;
    try {
      tkA = await mkToken(A, 'b1');
      jobA = (await A.as('b1').post('/api/jobs', { url: WATCH('restart0001'), title: 'Kept' })).body.job;
      await A.worker(tkA).post('/api/worker/claim', {});
    } finally { await A.close(); }
    const B = await L.startService({ users: ['b1'], store: fileJobStore(dir) });
    try {
      const lj = (await B.as('b1').get('/api/jobs')).body;
      ok('a new process reads the queue back: the claimed job, its title, the token', lj.jobs.length === 1 && lj.jobs[0].id === jobA.id && lj.jobs[0].status === 'claimed' && lj.jobs[0].title === 'Kept' && lj.worker.hasToken && lj.worker.everSeen);
      ok('the token still works, and the claimed job takes its result', (await B.worker(tkA).post('/api/worker/jobs/' + jobA.id + '/result', goodResult(12))).status === 200);
    } finally { await B.close(); L.rmDir(dir); }
  } finally { await S.close(); }
}

function jobOf(S, id) { return S.svc._state.jobs.get(id); }
function jobStatus(S, id) { const j = jobOf(S, id); return j ? j.status : 'gone'; }

main().then(() => L.finish('the home-PC queue'), e => { console.error(e); process.exit(1); });
