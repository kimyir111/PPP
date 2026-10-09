/* G10b-1 / G10b-2: the home-PC transcription queue (home-jobs.js, home-jobs-store.js, home-result.js), driven over real HTTP with a counting
   store (the file store, so no Postgres is needed; tests/home-worker/jobs-pg.test.js runs the same store and the migration on Postgres).
   NO ACCOUNT: the "users" of these tests are PC links, made as a browser makes them (POST /api/pc-links); tests/home-worker/links.test.js is about the links themselves.

   What it pins:
     - the result a worker may post: every bound of home-result.js, and that everything else is stripped
     - who may do what: the browser routes need a PC link's client code (a guest key is not one) and this site as origin; a worker token can
       only claim and complete the jobs of its own link; somebody else's job is "not there"; a rotated token is dead at once
     - the secrets: shown once, only a hash is kept (the file store is searched for them)
     - the queue: the caps (5 waiting, rows per link), duplicates, rate limits, the lease, the attempts, the 3 days
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

/* the worker token the link was made with (a link has one live token, shown once when the link was made) */
async function mkToken(S, user) {
  if (!S.token(user)) throw new Error('no link ' + user);
  return S.token(user);
}
async function enqueue(S, user, id, extra) {
  return S.as(user).post('/api/jobs', Object.assign({ url: WATCH(id || 'aaaaaaaaaaa'), title: 'A piece' }, extra));
}

/* one conversion, as the page and the PC do it: asked for, claimed, finished */
async function convert(S, user, token, id, result) {
  const q = await enqueue(S, user, id);
  if (q.status !== 201) return { q: q, g: null, r: null };
  const g = (await S.worker(token).post('/api/worker/claim', { once: true })).body.job;
  const r = await S.worker(token).post('/api/worker/jobs/' + g.id + '/result', result || goodResult(40));
  return { q: q, g: g, r: r };
}
async function failed(S, user, token, id) {
  const q = await enqueue(S, user, id);
  const g = (await S.worker(token).post('/api/worker/claim', { once: true })).body.job;
  await S.worker(token).post('/api/worker/jobs/' + g.id + '/fail', { error: 'no' });
  return { q: q, g: g };
}
const storedOf = (S, owner) => Array.from(S.svc._state.jobs.values()).filter(j => j.ownerId === S.linkId(owner) && j.status === 'done').reduce((n, j) => n + j.bytes, 0);
const idsOf = async (S, user) => (await S.as(user).get('/api/jobs')).body.jobs.map(j => j.id);
/* a result of 20,000 notes: about 0.9 MB, the biggest a long, dense piece makes */
const bigResult = () => ({ notes: Array.from({ length: 20000 }, (_, i) => ({ on: Math.round(i * 40) / 1000, off: Math.round(i * 40 + 30) / 1000, midi: 60 + (i % 12), vel: 64 })), duration: 800, engine: 'ensemble', device: 'cuda' });

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
  const dirty = Object.assign({}, good, { pedals: [{ on: 1, off: 2 }], uncertainNotes: [{ on: 1, off: 2, midi: 60 }], __proto__x: 1, evil: '<script>' });
  dirty.notes = good.notes.map(n => Object.assign({}, n, { confidence: 1, support: 2, models: ['x'], extra: 'y' }));
  const vd = R.validateResult(dirty);
  ok('pedals, uncertain notes, per-note extras and unknown keys are stripped', vd.ok && Object.keys(vd.result).sort().join() === 'device,duration,engine,ensemble,model,notes,v'
    && vd.result.notes.every(n => Object.keys(n).length === 4), vd.ok ? Object.keys(vd.result).join() : vd.error);
  /* G10a-1d: the helper's beats and downbeats are kept, strictly bounded */
  const withBeats = Object.assign({}, good, { beats: [0.5, 1, 1.5000004, 2], downbeats: [0.5, 2] });
  const vbt = R.validateResult(withBeats);
  ok('beats and downbeats are kept (rounded to 0.1 ms)', vbt.ok && JSON.stringify(vbt.result.beats) === '[0.5,1,1.5,2]' && JSON.stringify(vbt.result.downbeats) === '[0.5,2]', vbt.ok ? JSON.stringify(vbt.result.beats) : vbt.error);
  /* never a failed result because of beats: malformed ones are left out and the notes kept (beatsLeftOut) */
  const badBeats = (name, extra) => { const r = R.validateResult(Object.assign({}, good, extra)); ok(name.replace('are refused', 'are left out, the notes kept'), r.ok && !('beats' in r.result) && !('downbeats' in r.result) && r.result.beatsLeftOut === 'malformed' && r.result.notes.length === good.notes.length, r.ok ? JSON.stringify(r.result.beatsLeftOut) : r.code); };
  badBeats('beats that do not rise are refused', { beats: [1, 2, 2, 3] });
  badBeats('a beat that is not a number is refused', { beats: [1, '2', 3] });
  badBeats('a beat that is not finite is refused', { beats: [1, 2, Infinity] });
  badBeats('a negative beat is refused', { beats: [-1, 2, 3] });
  badBeats('a beat past the end of the piece (+ 1 s) is refused', { beats: [1, 2, good.notes[good.notes.length - 1].off + 30] });
  badBeats('beats that are not a list are refused', { beats: { a: 1 } });
  badBeats('more than 20,000 beats are refused', { beats: Array.from({ length: 20001 }, (x, i) => i * 0.01) });
  badBeats('downbeats without beats are refused', { downbeats: [1, 2] });
  badBeats('downbeats that do not rise are refused', { beats: [1, 2, 3, 4], downbeats: [3, 1] });
  {
    /* beats that would take a result past its size cap are left out first (a small cap makes the notes alone fit, notes and beats not) */
    const many = Array.from({ length: 20000 }, (x, i) => Math.round(i * 0.004 * 1e4) / 1e4).filter(t => t <= good.duration);
    const plain = R.validateResult(good), cap = plain.bytes + 200;
    const r = R.validateResult(Object.assign({}, good, { beats: many, downbeats: many.filter((t, i) => i % 4 === 0) }), { RESULT_MAX_BYTES: cap });
    ok('beats that would pass the size cap are left out, the notes kept', r.ok && !('beats' in r.result) && r.result.beatsLeftOut === 'size', r.ok ? r.result.beatsLeftOut : r.code);
  }
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
  const k = J.newLink();
  ok('a client code is 64 lowercase hex (256 bits); the link id is pc_ + 22 hex of the hash of the code, domain-separated; two links differ', /^[0-9a-f]{64}$/.test(k.code) && /^pc_[0-9a-f]{22}$/.test(k.id) && k.hash.length === 32
    && k.id === 'pc_' + L.crypto.createHash('sha256').update('ppp-pc-link-v1:' + k.code).digest('hex').slice(0, 22) && J.newLink().code !== k.code, k.code.length + ' ' + k.id);
  ok('the id never contains the code, and the hash is not the plain sha256 of it (so a guest-link key can never be a code)', k.id.indexOf(k.code.slice(0, 22)) < 0 && k.hash.toString('hex') !== L.crypto.createHash('sha256').update(k.code).digest('hex'));
  ok('CODE_RE takes exactly 64 lowercase hex: not 63, 65, upper case, a dash, a space, a newline, base64url of 43', J.CODE_RE.test(k.code) && !J.CODE_RE.test(k.code.slice(1)) && !J.CODE_RE.test(k.code + '0') && !J.CODE_RE.test(k.code.toUpperCase().replace(/^([0-9A-F])/, 'G'))
    && !J.CODE_RE.test(k.code.slice(0, 10) + '-' + k.code.slice(11)) && !J.CODE_RE.test(k.code + '\n') && !J.CODE_RE.test(' ' + k.code) && !J.CODE_RE.test(L.crypto.randomBytes(32).toString('base64url')) && !J.CODE_RE.test(k.code.toUpperCase()));
  ok('an IPv6 address counts as its /48 (every /56 and /64 of it is the same address), an IPv4-mapped one as the IPv4, an IPv4 as itself', J.addrKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd') === J.addrKey('2001:DB8:1:2::1') && J.addrKey('2001:db8:1:2::1') === J.addrKey('2001:db8:1:3::1') && J.addrKey('2001:db8:1:2::1') === J.addrKey('2001:db8:1:102::1') && J.addrKey('2001:db8:1:2::1') === J.addrKey('2001:db8:1:ffff::9') && J.addrKey('2001:db8:1:2::1') !== J.addrKey('2001:db8:2:2::1') && J.addrKey('2001:db8:1:2::1') !== J.addrKey('2001:db9:1:2::1') && J.addrKey('2001:db8:1:2::1') !== J.addrKey('2001:db8::1')
    && J.addrKey('::ffff:1.2.3.4') === '1.2.3.4' && J.addrKey('1.2.3.4') === '1.2.3.4' && J.addrKey('fe80::1%eth0') === J.addrKey('fe80:0:0:0::7'), J.addrKey('2001:db8:1:2::1'));
}

/* G10d song mode: a job may ask for 'song' (kind 'youtube-song'); its result's notes say their layer */
async function songMode() {
  heading('song mode (G10d): the kind of a job, and the layers of its result');
  const good = goodResult(40);
  const layered = Object.assign({}, good, { mode: 'song', song: { separation: 'htdemucs_6s', melody: 999 } });
  layered.notes = good.notes.map((n, i) => Object.assign({}, n, { track: 1 + (i % 3) }));
  const v = R.validateResult(layered);
  ok('a song result keeps each note\'s layer (1 melody, 2 bass, 3 accompaniment) and says mode "song"', v.ok && v.result.mode === 'song' && v.result.notes.every(n => n.track === 1 || n.track === 2 || n.track === 3), v.ok ? '' : v.error);
  ok('its layer counts are counted from the notes, not taken from the worker', v.ok && v.result.song.melody + v.result.song.bass + v.result.song.accomp === 40 && v.result.song.melody !== 999 && v.result.song.separation === 'htdemucs_6s');
  const noLayer = JSON.parse(JSON.stringify(layered)); delete noLayer.notes[5].track;
  ok('a song note without a layer is refused', !R.validateResult(noLayer).ok && R.validateResult(noLayer).code === 'bad-note');
  const badLayer = JSON.parse(JSON.stringify(layered)); badLayer.notes[5].track = 4;
  ok('a layer that is not 1, 2 or 3 is refused', !R.validateResult(badLayer).ok);
  ok('an unknown mode is refused', !R.validateResult(Object.assign({}, good, { mode: 'band' })).ok);
  ok('a separation name that is not a plain name is refused', !R.validateResult(Object.assign({}, layered, { song: { separation: '<b>x</b>' } })).ok);
  const tracked = R.validateResult(Object.assign({}, layered, { song: { separation: 'htdemucs_6s', melodyFrom: 'guitar', melodyTracker: 'basic-pitch' } }));
  ok('a song result keeps which method followed the tune (shown on the review so a person can see what ran)', tracked.ok && tracked.result.song.melodyTracker === 'basic-pitch' && tracked.result.song.melodyFrom === 'guitar');
  ok('a result from an older worker has no method: it is null, not refused', v.ok && v.result.song.melodyTracker === null);
  ok('a method that is not one of the two is refused', !R.validateResult(Object.assign({}, layered, { song: { separation: 'htdemucs_6s', melodyTracker: '<b>x</b>' } })).ok);
  const piano = R.validateResult(Object.assign({}, good, { notes: good.notes.map(n => Object.assign({}, n, { track: 1 })) }));
  ok('a piano result (no mode) keeps no layer: on, off, midi, vel only, and no song summary', piano.ok && piano.result.notes.every(n => n.track === undefined) && piano.result.mode === undefined && piano.result.song === undefined);

  const S = await L.startService({ users: ['s1'] });
  try {
    const tk = await mkToken(S, 's1');
    const q = await enqueue(S, 's1', 'song0000001', { mode: 'song' });
    ok('a job asked for in song mode is kind "youtube-song"', q.status === 201 && q.body.job.kind === 'youtube-song', q.status + ' ' + JSON.stringify(q.body).slice(0, 120));
    const qp = await enqueue(S, 's1', 'song0000001');
    ok('the same link asked for as a piano recording is another job (kind "youtube")', qp.status === 201 && qp.body.job.kind === 'youtube' && qp.body.job.id !== q.body.job.id);
    const qd = await enqueue(S, 's1', 'song0000001', { mode: 'song' });
    ok('the same link in the same mode again is the waiting job, not a new one', qd.status === 200 && qd.body.existing === true && qd.body.job.id === q.body.job.id);
    const qb = await enqueue(S, 's1', 'song0000002', { mode: 'karaoke' });
    ok('an unknown mode is refused (422 bad-mode) and costs nothing', qb.status === 422 && qb.body.code === 'bad-mode');
    ok('mode "piano" is the plain kind', (await enqueue(S, 's1', 'song0000003', { mode: 'piano' })).body.job.kind === 'youtube');
    const old = (await S.worker(tk).post('/api/worker/claim', { once: true })).body.job;
    ok('a worker from before song mode (its claim does not say song: true) is not handed the song job: it gets the piano job behind it', old && old.id === qp.body.job.id && old.kind === 'youtube', JSON.stringify(old));
    ok('the list says the worker of the PC cannot do song mode (songMode false), so the page can say why the song job waits', (await S.as('s1').get('/api/jobs')).body.worker.songMode === false);
    const g = (await S.worker(tk).post('/api/worker/claim', { once: true, song: true })).body.job;
    ok('a worker that says song: true is handed it, and told its kind', g && g.id === q.body.job.id && g.kind === 'youtube-song', JSON.stringify(g));
    ok('and the list then says the PC can (songMode true)', (await S.as('s1').get('/api/jobs')).body.worker.songMode === true);
    const r = await S.worker(tk).post('/api/worker/jobs/' + g.id + '/result', layered);
    ok('the song result is taken', r.status === 200, r.status + ' ' + JSON.stringify(r.body));
    const got = (await S.as('s1').get('/api/jobs/' + g.id)).body;
    ok('and the page reads it back with its layers', got.result && got.result.mode === 'song' && got.result.notes.every(n => [1, 2, 3].indexOf(n.track) >= 0) && got.job.kind === 'youtube-song');
  } finally { await S.close(); }
}

async function main() {
  await resultRules();
  await tokenRules();
  await songMode();

  const S = await L.startService();
  try {
    heading('who may ask');
    const anon = (m, p, b) => req(S.port, m, p, { body: b });
    const noLink = await Promise.all([anon('GET', '/api/jobs'), anon('POST', '/api/jobs', { url: URL1 }), anon('GET', '/api/jobs/abcdefgh1234'), anon('POST', '/api/jobs/abcdefgh1234/cancel', {}), anon('DELETE', '/api/jobs/abcdefgh1234'),
      anon('GET', '/api/worker/status'), anon('DELETE', '/api/pc-links/me'), anon('POST', '/api/pc-links/me/worker-token', {})]);
    ok('no X-PPP-PC header: every browser route is 401 "no-link" (nothing was guessed, so nothing is counted)', noLink.every(r => r.status === 401 && r.body.code === 'no-link' && r.body.error === 'No PC link on this device.'), noLink.map(r => r.status).join());
    ok('a guest key is not a PC link', (await req(S.port, 'POST', '/api/jobs', { body: { url: URL1 }, headers: { 'X-PPP-Guest': 'g'.repeat(40) } })).status === 401
      && (await req(S.port, 'POST', '/api/jobs', { body: { url: URL1 }, headers: { 'X-PPP-PC': 'g'.repeat(40) } })).body.code === 'bad-code');
    ok('a code that no link has (64 hex) is 401 "bad-code"; a session cookie does nothing', (await req(S.port, 'GET', '/api/jobs', { user: 'nobody' })).status === 401 && (await req(S.port, 'GET', '/api/jobs', { user: 'nobody' })).body.code === 'bad-code'
      && (await req(S.port, 'GET', '/api/jobs', { cookie: 'ppp_session=' + 'a'.repeat(40) })).body.code === 'no-link');
    ok('the answer to a wrong code says nothing about why (the same for a malformed one, an unknown one and a revoked one)', await (async () => {
      const a1 = await req(S.port, 'GET', '/api/jobs', { code: 'f'.repeat(64) }), a2 = await req(S.port, 'GET', '/api/jobs', { code: 'F'.repeat(64) }), a3 = await req(S.port, 'GET', '/api/jobs', { code: 'f'.repeat(63) });
      return a1.text === a2.text && a2.text === a3.text && a1.text === JSON.stringify({ error: 'That PC link is not valid.', code: 'bad-code' });
    })());
    const xs = await req(S.port, 'POST', '/api/jobs', { user: 'u1', body: { url: URL1 }, headers: { Origin: 'https://evil.example' } });
    ok('a cross-site POST is refused (403) even with the right code', xs.status === 403 && xs.body.code === 'cross-site', xs.status + '');
    ok('and so are cross-site cancel, rotate, revoke, remove, create and every READ (the header is only ever taken from this site\'s own page)', (await Promise.all([
      req(S.port, 'POST', '/api/jobs/abcdefgh1234/cancel', { user: 'u1', body: {}, headers: { Origin: 'null' } }),
      req(S.port, 'POST', '/api/pc-links/me/worker-token', { user: 'u1', body: {}, headers: { Origin: 'http://127.0.0.1:1' } }),
      req(S.port, 'DELETE', '/api/pc-links/me', { user: 'u1', headers: { Origin: 'https://evil.example' } }),
      req(S.port, 'DELETE', '/api/jobs/abcdefgh1234', { user: 'u1', headers: { Origin: 'https://evil.example' } }),
      req(S.port, 'POST', '/api/pc-links', { body: {}, headers: { Origin: 'https://evil.example' } }),
      req(S.port, 'GET', '/api/jobs', { user: 'u1', headers: { Origin: 'https://evil.example' } }),
      req(S.port, 'GET', '/api/worker/status', { user: 'u1', headers: { Origin: 'https://evil.example' } }),
      req(S.port, 'GET', '/api/jobs/abcdefgh1234', { user: 'u1', headers: { Origin: 'null' } })])).every(r => r.status === 403 && r.body.code === 'cross-site'));
    ok('a request from another site is refused BEFORE the code is looked at: a wrong code from there is 403, not a counted failure', (await req(S.port, 'GET', '/api/jobs', { code: 'e'.repeat(64), headers: { Origin: 'https://evil.example' } })).status === 403);
    const same = await req(S.port, 'POST', '/api/jobs', { user: 'u1', body: { url: URL1 }, headers: { Origin: 'http://127.0.0.1:' + S.port } });
    ok('a POST from this site (same Origin) is fine', same.status === 201, same.status + ' ' + same.text.slice(0, 80));
    await S.as('u1').post('/api/jobs/' + same.body.job.id + '/cancel');
    const opt = await req(S.port, 'OPTIONS', '/api/jobs', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-ppp-pc' } });
    ok('CORS is closed: no Access-Control header on an answer, none on a preflight (so no other site can ever send X-PPP-PC)', !Object.keys(same.headers).some(h => /^access-control/i.test(h)) && !Object.keys(opt.headers).some(h => /^access-control/i.test(h)) && opt.status >= 400, opt.status + '');
    ok('every answer is no-store and nosniff', same.headers['cache-control'] === 'no-store' && same.headers['x-content-type-options'] === 'nosniff');
    ok('the account routes of PR 178 are gone: tokens are 404, and a cookie or a bearer is not a PC link', (await req(S.port, 'GET', '/api/worker/tokens', { user: 'u1' })).status === 404 && (await req(S.port, 'POST', '/api/worker/tokens', { user: 'u1', body: {} })).status === 404
      && (await req(S.port, 'DELETE', '/api/worker/tokens/abcdefghijkl', { user: 'u1' })).status === 404 && (await req(S.port, 'GET', '/api/jobs', { token: S.token('u1') })).body.code === 'no-link');

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
    ok('another link sees none of it', list2.status === 200 && list2.body.jobs.length === 0);
    ok('and cannot read, cancel, remove or find it: 404, not 403', (await S.as('u2').get('/api/jobs/' + e1.body.job.id)).status === 404 && (await S.as('u2').post('/api/jobs/' + e1.body.job.id + '/cancel')).status === 404 && (await S.as('u2').del('/api/jobs/' + e1.body.job.id)).status === 404);
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
    ok('a claim answer carries only what the worker needs (G10d: and the kind, piano or song)', Object.keys(c1.body.job).sort().join() === 'attempt,id,kind,maxAttempts,title,url' && c1.body.job.kind === 'youtube');
    const stolen = await S.worker(tok2).post('/api/worker/jobs/' + e1.body.job.id + '/result', goodResult(40));
    ok("a claimed job still cannot be finished by another link's token", stolen.status === 404);
    ok('the owner sees it claimed', (await S.as('u1').get('/api/jobs')).body.jobs.find(j => j.id === e1.body.job.id).status === 'claimed');

    heading('the secrets: shown once, stored as a hash');
    const mkr = await S.makeLink('t1');
    const mk = { token: mkr.body.workerToken, code: mkr.body.clientCode, id: mkr.body.workerTokenId };
    ok('making a link shows its id, the client code and the worker token (with its id) once', mkr.status === 201 && /^pc_[0-9a-f]{22}$/.test(mkr.body.id) && /^[0-9a-f]{64}$/.test(mk.code) && /^ppw_/.test(mk.token) && mk.id === mk.token.slice(4, 16)
      && Object.keys(mkr.body).sort().join() === 'clientCode,createdAt,id,workerToken,workerTokenId' && mkr.headers['cache-control'] === 'no-store', JSON.stringify(Object.keys(mkr.body)));
    const wst = (await S.as('t1').get('/api/worker/status'));
    ok('and the status never has a secret in it', wst.status === 200 && wst.text.indexOf(mk.code) < 0 && !/ppw_/.test(wst.text) && !/clientCode|workerToken/.test((await S.as('t1').get('/api/jobs')).text));
    const disk = L.fs.readFileSync(L.path.join(S.dir, 'jobs.json'), 'utf8');
    ok('the store holds the sha256 of the token and of the code, and neither of them (nor the secret half of the token)', disk.indexOf(mk.token) < 0 && disk.indexOf(mk.token.slice(17)) < 0 && disk.indexOf(mk.code) < 0
      && disk.indexOf(L.crypto.createHash('sha256').update(mk.token).digest('hex')) > 0 && disk.indexOf(J.codeHash(mk.code).toString('hex')) > 0);
    ok('the store holds no address: only a keyed tag', !/10\.250\./.test(disk) && /"ipTag":"[0-9a-f]{16}"/.test(disk));
    ok('a token works', (await S.worker(mk.token).get('/api/worker/ping')).status === 200);
    ok('the secret half of another token with this id is not enough', (await S.worker(mk.token.slice(0, 17) + tok1.slice(17)).get('/api/worker/ping')).status === 401);
    ok('a one-character change is 401', (await S.worker(mk.token.slice(0, -1) + (mk.token.slice(-1) === 'A' ? 'B' : 'A')).get('/api/worker/ping')).status === 401);
    ok('a token that never existed is 401, with the same answer', (await S.worker('ppw_' + 'A'.repeat(12) + '_' + 'B'.repeat(43)).get('/api/worker/ping')).status === 401);
    ok('no header, a cookie instead, a client code instead, the wrong scheme: 401', (await req(S.port, 'GET', '/api/worker/ping', {})).status === 401
      && (await req(S.port, 'GET', '/api/worker/ping', { user: 'u1' })).status === 401 && (await S.worker(S.code('u1')).get('/api/worker/ping')).status === 401 && (await req(S.port, 'GET', '/api/worker/ping', { headers: { Authorization: 'Token ' + mk.token } })).status === 401);
    ok('the answer to a bad token says nothing about why', (await S.worker('nonsense').get('/api/worker/ping')).text === JSON.stringify({ error: 'That token is not valid.', code: 'bad-token' }));
    const rot2 = await S.as('u2').post('/api/pc-links/me/worker-token', {});
    ok("u2 rotating its token does not touch t1's: both work, each its own", rot2.status === 201 && (await S.worker(mk.token).get('/api/worker/ping')).status === 200 && (await S.worker(rot2.body.workerToken).get('/api/worker/ping')).status === 200 && (await S.worker(tok2).get('/api/worker/ping')).status === 401);
    S.tokens2 = { u2: rot2.body.workerToken };
    const rot1 = await S.as('t1').post('/api/pc-links/me/worker-token', {});
    ok('rotating shows the new token once (with its id); the old one is dead at once, the new one works', rot1.status === 201 && /^ppw_/.test(rot1.body.workerToken) && rot1.body.workerTokenId === rot1.body.workerToken.slice(4, 16) && rot1.headers['cache-control'] === 'no-store'
      && (await S.worker(mk.token).get('/api/worker/ping')).status === 401 && (await S.worker(rot1.body.workerToken).get('/api/worker/ping')).status === 200);
    ok('a worker token cannot use a browser route, and a client code cannot be a worker token', (await req(S.port, 'GET', '/api/jobs', { token: rot1.body.workerToken })).status === 401 && (await req(S.port, 'POST', '/api/pc-links/me/worker-token', { token: rot1.body.workerToken, body: {} })).status === 401
      && (await req(S.port, 'DELETE', '/api/pc-links/me', { token: rot1.body.workerToken })).status === 401);
    const many = [];
    for (let i = 0; i < 12; i++) many.push((await S.as('t1').post('/api/pc-links/me/worker-token', {}, { ip: '12.0.0.' + i })).status);
    ok('ten new tokens an hour per link (one was made above), then 429', many.join() === '201,201,201,201,201,201,201,201,201,429,429,429', many.join());

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
    const stored = await S.inner.getResult(q2.id, S.linkId('u1'));
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
      ok("one link's full queue does not block another", (await S2.as('p2').post('/api/jobs', { url: WATCH('pppppppppp0') })).status === 201);
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
      ok('a link keeps at most 30 rows: the oldest finished ones went', rows.length <= 30 && rows.length >= 28, rows.length + '');
      ok('and the store agrees (rows deleted, not just hidden)', (await S2.inner.loadAll()).jobs.filter(j => j.ownerId === S2.linkId('p2')).length <= 30);
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
      ok('wrong CLIENT CODES count against the same budget (a code that is not a live link, 64 hex or not), per address; a valid code is never refused for it, nor a valid token, nor is another address', await (async () => {
        const out = [];
        for (let i = 0; i < 21; i++) out.push((await req(S3.port, 'GET', '/api/jobs', { code: String(i).padStart(64, 'c'), ip: '4.4.4.4' })).status);
        return out.slice(0, 20).every(x => x === 401) && out[20] === 429 && (await req(S3.port, 'GET', '/api/jobs', { user: 'r1', ip: '4.4.4.4' })).status === 200 && (await S3.worker(tk).get('/api/worker/ping', { ip: '4.4.4.4' })).status === 200
          && (await req(S3.port, 'GET', '/api/jobs', { code: 'd'.repeat(64), ip: '4.4.4.5' })).status === 401 && (await req(S3.port, 'GET', '/api/jobs', { code: 'x', ip: '4.4.4.4' })).status === 429;
      })());
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
      ok('30 enqueues an hour per link, then 429 (too-many, with Retry-After); each refused one is free', made === 30 && !!refused && refused.status === 429 && refused.body.code === 'too-many' && Number(refused.headers['retry-after']) > 0, made + ' ' + (refused && refused.status));
      /* a request that makes nothing is free: refused bodies, links that are not YouTube, duplicates, a full queue */
      const SR = await L.startService({ users: ['f1', 'f2', 'f3'] });
      try {
        const junk = [];
        for (let i = 0; i < 45; i++) junk.push((await req(SR.port, 'POST', '/api/jobs', { user: 'f1', body: i % 3 === 0 ? '{bad' : i % 3 === 1 ? { url: 'https://example.com/x' } : { url: WATCH('freefreefre'), pad: 'x'.repeat(8000) } })).status);
        ok('45 refused requests (bad JSON, not YouTube, too big) used none of the 30 hourly enqueues: a good one still works', junk.every(x => x === 400 || x === 422 || x === 413) && (await enqueue(SR, 'f1', 'goodgoodgoo')).status === 201, junk.slice(0, 6).join());
        const tokJunk = [];
        for (let i = 0; i < 12; i++) tokJunk.push((await req(SR.port, 'POST', '/api/pc-links/me/worker-token', { user: 'f2', body: '{bad' })).status);
        ok('and 12 refused rotation requests used none of the 10 hourly new tokens', tokJunk.every(x => x === 400) && (await SR.as('f2').post('/api/pc-links/me/worker-token', {})).status === 201);
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
        for (let i = 0; i < 6; i++) tokA.push((await req(SA.port, 'POST', '/api/pc-links/me/worker-token', { user: ['a1', 'a2', 'a3'][i % 3], ip: '10.3.3.3', body: {} })).status);
        ok('new tokens: 20 an hour per address too (three links made 2 each here; the link\'s own cap is 10)', tokA.every(x => x === 201));
      } finally { await SA.close(); }
      const lim = J.LIMITS;
      ok('the limits are the ones the design states', lim.PENDING_PER_USER === 5 && lim.ROWS_PER_USER === 30 && lim.LINKS_PER_IP_PER_HOUR === 5 && lim.LINKS_PER_IP_PER_DAY === 20 && lim.MAX_LINKS === 500 && lim.LINK_UNUSED_TTL_MS === 60 * 86400000 && lim.LINK_NEVER_CONNECTED_TTL_MS === 14 * 86400000 && lim.MAX_ATTEMPTS === 3 && lim.LEASE_MS === 30 * 60 * 1000
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
      ok('a done job is purged after three days', ids.indexOf(dn.id) < 0 && (await S4.inner.getResult(dn.id, S4.linkId('k1'))) === null);
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

    heading('one link cannot use up the room - and is never locked out of it: the oldest finished conversions are cleared to make room');
    {
      const small = { perUserResultBytes: 5000, resultReserveBytes: 1000, totalResultBytes: 1e9 };
      /* (a) the share would be passed by a result: the PC's work is NOT lost, the oldest finished conversion of the account is cleared */
      const SA = await L.startService({ users: ['hog', 'teacher'], config: small });
      try {
        const th = await mkToken(SA, 'hog'), tt = await mkToken(SA, 'teacher');
        const c1 = await convert(SA, 'hog', th, 'hoghoghog01'); SA.advance(1000);
        const c2 = await convert(SA, 'hog', th, 'hoghoghog02'); SA.advance(1000);
        ok('two results of 1856 bytes are kept (3712 of the 5000)', c1.r.status === 200 && c2.r.status === 200 && storedOf(SA, 'hog') === 3712);
        const c3 = await convert(SA, 'hog', th, 'hoghoghog03');
        const ids = await idsOf(SA, 'hog');
        ok('a third: asked for (room is made only if the share would not leave 1000 bytes for it: 3712 + 1000 fits), and its result, which would pass the share (5568), is TAKEN - the oldest finished conversion is cleared for it, the PC\'s work is not refused', c3.q.status === 201 && c3.r.status === 200 && ids.indexOf(c1.q.body.job.id) < 0 && ids.indexOf(c2.q.body.job.id) >= 0 && ids.indexOf(c3.q.body.job.id) >= 0, JSON.stringify([c3.q.status, c3.r.status, c3.r.text.slice(0, 80)]));
        ok('and the share holds: 3712 bytes kept, the cleared one is gone from the database too', storedOf(SA, 'hog') === 3712 && (await SA.inner.getResult(c1.q.body.job.id, SA.linkId('hog'))) === null && (await SA.inner.getResult(c3.q.body.job.id, SA.linkId('hog'))) !== null);
        const c4 = await convert(SA, 'teacher', tt, 'teacherteac');
        ok('another account is not touched by any of it', c4.q.status === 201 && c4.r.status === 200 && (await idsOf(SA, 'teacher')).length === 1);
      } finally { await SA.close(); }
      /* (b) a new job asks for room too (its result is on its way): the oldest finished conversion goes then, not at the result */
      const SB = await L.startService({ users: ['hog'], config: { perUserResultBytes: 4000, resultReserveBytes: 1000, totalResultBytes: 1e9 } });
      try {
        const th = await mkToken(SB, 'hog');
        const c1 = await convert(SB, 'hog', th, 'hoghoghog01'); SB.advance(1000);
        const c2 = await convert(SB, 'hog', th, 'hoghoghog02'); SB.advance(1000);
        const q3 = await enqueue(SB, 'hog', 'hoghoghog03');
        const ids = await idsOf(SB, 'hog');
        ok('3712 kept + 1000 for the new job would pass the share of 4000: asking for the job clears the oldest finished conversion (not an error)', q3.status === 201 && ids.indexOf(c1.q.body.job.id) < 0 && ids.indexOf(c2.q.body.job.id) >= 0 && storedOf(SB, 'hog') === 1856, JSON.stringify([q3.status, ids.length, storedOf(SB, 'hog')]));
        const g3 = (await SB.worker(th).post('/api/worker/claim', { once: true })).body.job;
        ok('and its result is taken without clearing anything more', (await SB.worker(th).post('/api/worker/jobs/' + g3.id + '/result', goodResult(40))).status === 200 && storedOf(SB, 'hog') === 3712 && (await idsOf(SB, 'hog')).length === 2);
      } finally { await SB.close(); }
      /* (b2) the edges of the share, to the byte: results of 1856 bytes, a share of exactly two of them (3712), then one byte less */
      for (const edge of [{ cap: 3712, name: 'a share of exactly two results (3712)' }, { cap: 3711, name: 'a share one byte under two results (3711)' }]) {
        const SG = await L.startService({ users: ['edge'], config: { perUserResultBytes: edge.cap, resultReserveBytes: 0, totalResultBytes: 1e9 } });
        try {
          const th = await mkToken(SG, 'edge');
          const steps = [];
          for (let i = 0; i < 5; i++) { steps.push(await convert(SG, 'edge', th, 'edgeedge' + String(i).padStart(3, '0'))); SG.advance(1000); }
          const ids = await idsOf(SG, 'edge');
          const kept = edge.cap === 3712 ? 2 : 1;
          ok(edge.name + ': five conversions in a row, every one asked for (201) and its result TAKEN (200) - the PC\'s work is never refused for the account\'s own share', steps.every(s => s.q.status === 201 && s.r.status === 200), steps.map(s => s.q.status + '/' + (s.r && s.r.status)).join(' '));
          ok(edge.name + ': the newest ' + kept + ' are kept, the older ones are gone, the share holds', ids.length === kept && ids.indexOf(steps[4].q.body.job.id) >= 0 && storedOf(SG, 'edge') === 1856 * kept && storedOf(SG, 'edge') <= edge.cap, JSON.stringify([ids.length, storedOf(SG, 'edge')]));
        } finally { await SG.close(); }
      }
      /* (c) failed conversions hold no notes: they are not cleared to make room for notes */
      const SC = await L.startService({ users: ['hog'], config: { perUserResultBytes: 2500, resultReserveBytes: 1000, totalResultBytes: 1e9 } });
      try {
        const th = await mkToken(SC, 'hog');
        const c1 = await convert(SC, 'hog', th, 'hoghoghog01'), f2 = await failed(SC, 'hog', th, 'hoghoghog02');
        const q3 = await enqueue(SC, 'hog', 'hoghoghog03');
        const ids = await idsOf(SC, 'hog');
        ok('for room for notes only a conversion that holds notes goes: the done one, not the failed one', q3.status === 201 && ids.indexOf(c1.q.body.job.id) < 0 && ids.indexOf(f2.g.id) >= 0, JSON.stringify(ids.length));
      } finally { await SC.close(); }
      /* (d) for room among the rows, failed, cancelled and expired ones go before done ones, the oldest first */
      const was = J.LIMITS.ROWS_PER_USER;
      J.LIMITS.ROWS_PER_USER = 4;
      const SD = await L.startService({ users: ['rows'] });
      try {
        const th = await mkToken(SD, 'rows');
        const A = await convert(SD, 'rows', th, 'rowsrowsr01'); SD.advance(1000);
        const B = await failed(SD, 'rows', th, 'rowsrowsr02'); SD.advance(1000);
        const C = await convert(SD, 'rows', th, 'rowsrowsr03'); SD.advance(1000);
        const D = await failed(SD, 'rows', th, 'rowsrowsr04'); SD.advance(1000);
        const q5 = await enqueue(SD, 'rows', 'rowsrowsr05');
        const ids = await idsOf(SD, 'rows');
        ok('4 rows (done, failed, done, failed), a fifth job: the oldest FAILED one goes (not the older done one)', q5.status === 201 && ids.length === 4 && ids.indexOf(B.g.id) < 0 && ids.indexOf(A.q.body.job.id) >= 0 && ids.indexOf(C.q.body.job.id) >= 0 && ids.indexOf(D.g.id) >= 0, JSON.stringify([q5.status, ids.length]));
        await SD.as('rows').post('/api/jobs/' + q5.body.job.id + '/cancel');
        const q6 = await enqueue(SD, 'rows', 'rowsrowsr06');
        const ids2 = await idsOf(SD, 'rows');
        ok('and the next one clears the next failed or cancelled row, the done ones last', q6.status === 201 && ids2.length === 4 && ids2.indexOf(A.q.body.job.id) >= 0 && ids2.indexOf(C.q.body.job.id) >= 0 && ids2.indexOf(D.g.id) < 0, JSON.stringify([q6.status, ids2.length]));
      } finally { J.LIMITS.ROWS_PER_USER = was; await SD.close(); }
      /* (e) the story of the review: conversions of the biggest size, one after the other, none refused, none lost */
      const SE = await L.startService({ users: ['big'] });
      try {
        const th = await mkToken(SE, 'big');
        const outs = [];
        for (let i = 0; i < 11; i++) outs.push(await convert(SE, 'big', th, 'bigbigbig' + String(i).padStart(2, '0'), bigResult()));
        const cap = J.LIMITS.PER_USER_RESULT_BYTES;
        const doneRows = (await SE.as('big').get('/api/jobs')).body.jobs.filter(j => j.status === 'done').length;
        ok('11 conversions of 20,000 notes (about 0.9 MB each; the share is 8 MiB): every one asked for (201) and its result taken (200) - none refused, none lost', outs.every(o => o.q.status === 201 && o.r.status === 200), outs.map(o => o.q.status + '/' + (o.r && o.r.status)).join(' '));
        ok('the account holds at most its share (' + (storedOf(SE, 'big') / 1048576).toFixed(2) + ' of 8 MiB), the newest conversions are the ones kept (' + doneRows + ' of 11)', storedOf(SE, 'big') <= cap && doneRows >= 8 && doneRows <= 9 && (await idsOf(SE, 'big')).indexOf(outs[10].q.body.job.id) >= 0 && (await idsOf(SE, 'big')).indexOf(outs[0].q.body.job.id) < 0, doneRows + ' ' + storedOf(SE, 'big'));
      } finally { await SE.close(); }
      /* (f) a conversion that is finished can be removed by its owner (which also frees its notes); a waiting or converting one has to be cancelled first */
      const SF = await L.startService({ users: ['own', 'other'] });
      try {
        const th = await mkToken(SF, 'own');
        const done = await convert(SF, 'own', th, 'removeme001'), fl = await failed(SF, 'own', th, 'removeme002');
        const waiting = (await enqueue(SF, 'own', 'removeme003')).body.job;
        const before = storedOf(SF, 'own');
        ok('another link cannot remove it (404); nobody without a code can (401); a request from another site is refused (403)', (await SF.as('other').del('/api/jobs/' + done.q.body.job.id)).status === 404 && (await req(SF.port, 'DELETE', '/api/jobs/' + done.q.body.job.id)).status === 401
          && (await req(SF.port, 'DELETE', '/api/jobs/' + done.q.body.job.id, { user: 'own', headers: { Origin: 'https://evil.example' } })).status === 403 && (await idsOf(SF, 'own')).indexOf(done.q.body.job.id) >= 0);
        ok('a waiting conversion cannot be removed (409, "cancel it first"), a converting one neither', (await SF.as('own').del('/api/jobs/' + waiting.id)).status === 409 && (await SF.as('own').del('/api/jobs/' + waiting.id)).body.code === 'pending'
          && await (async () => { const g = (await SF.worker(th).post('/api/worker/claim', { once: true })).body.job; return g.id === waiting.id && (await SF.as('own').del('/api/jobs/' + waiting.id)).status === 409; })());
        const rd = await SF.as('own').del('/api/jobs/' + done.q.body.job.id);
        ok('a done conversion is removed (200): gone from the list, from the database, its notes out of the account\'s share; opening it is 404', rd.status === 200 && (await idsOf(SF, 'own')).indexOf(done.q.body.job.id) < 0 && (await SF.as('own').get('/api/jobs/' + done.q.body.job.id)).status === 404
          && (await SF.inner.getResult(done.q.body.job.id, SF.linkId('own'))) === null && storedOf(SF, 'own') === before - 1856 && !(await SF.inner.loadAll()).jobs.some(j => j.id === done.q.body.job.id));
        ok('a failed one too; a second removal is 404', (await SF.as('own').del('/api/jobs/' + fl.g.id)).status === 200 && (await SF.as('own').del('/api/jobs/' + fl.g.id)).status === 404);
        await SF.as('own').post('/api/jobs/' + waiting.id + '/cancel');
        ok('a cancelled one can be removed', (await SF.as('own').del('/api/jobs/' + waiting.id)).status === 200 && (await idsOf(SF, 'own')).length === 0);
      } finally { await SF.close(); }
    }

    heading('eviction takes finished conversions only: never a waiting or converting one, never another account\'s');
    {
      /* (a) at the cap of rows (4 here instead of 30): three of the account's rows wait or convert, one is done; the neighbour's finished rows are the OLDEST of all */
      const rowsWas = J.LIMITS.ROWS_PER_USER;
      J.LIMITS.ROWS_PER_USER = 4;
      const SM = await L.startService({ users: ['mb', 'nb'], config: { perUserResultBytes: 1e9, resultReserveBytes: 0, totalResultBytes: 1e9 } });
      try {
        const tm = await mkToken(SM, 'mb'), tn = await mkToken(SM, 'nb');
        const n1 = await convert(SM, 'nb', tn, 'nbdone00001'); SM.advance(1000);
        const n2 = await failed(SM, 'nb', tn, 'nbfail00001'); SM.advance(1000);
        const d1 = await convert(SM, 'mb', tm, 'mbdone00001'); SM.advance(1000);
        const w1 = (await enqueue(SM, 'mb', 'mbwait00001')).body.job; SM.advance(1000);
        const w2 = (await enqueue(SM, 'mb', 'mbwait00002')).body.job; SM.advance(1000);
        const w1claimed = (await SM.worker(tm).post('/api/worker/claim', { once: true })).body.job;
        ok('the account has one done, one converting and one waiting row (3 of its 4)', w1claimed.id === w1.id && jobStatus(SM, w1.id) === 'claimed' && jobStatus(SM, w2.id) === 'queued' && jobStatus(SM, d1.q.body.job.id) === 'done');
        const w3 = await enqueue(SM, 'mb', 'mbwait00003');
        ok('a 4th row fits the cap: nothing is cleared', w3.status === 201 && jobStatus(SM, d1.q.body.job.id) === 'done');
        const w4 = await enqueue(SM, 'mb', 'mbwait00004');
        ok('a 5th row: the one finished conversion is cleared; the converting one and both waiting ones are not', w4.status === 201 && jobStatus(SM, d1.q.body.job.id) === 'gone'
          && jobStatus(SM, w1.id) === 'claimed' && jobStatus(SM, w2.id) === 'queued' && jobStatus(SM, w3.body.job.id) === 'queued', [d1.q.body.job.id, w1.id, w2.id].map(id => jobStatus(SM, id)).join());
        const w5 = await enqueue(SM, 'mb', 'mbwait00005');
        const mineNow = () => Array.from(SM.svc._state.jobs.values()).filter(j => j.ownerId === SM.linkId('mb'));
        ok('a 6th with nothing finished left to clear is accepted past the row cap: none of the five rows that wait or convert is touched, in memory or in the store', w5.status === 201 && mineNow().length === 5
          && mineNow().every(j => j.status === 'queued' || j.status === 'claimed') && (await SM.inner.loadAll()).jobs.filter(j => j.ownerId === SM.linkId('mb')).length === 5);
        const w6 = await enqueue(SM, 'mb', 'mbwait00006');
        ok('a 7th is the cap of waiting jobs (429 queue-full) and clears nothing', w6.status === 429 && w6.body.code === 'queue-full' && mineNow().length === 5);
        ok('the neighbour\'s finished rows, older than all of this, are exactly as they were (memory, store and the notes)', jobStatus(SM, n1.q.body.job.id) === 'done' && jobStatus(SM, n2.g.id) === 'failed'
          && (await SM.inner.getResult(n1.q.body.job.id, SM.linkId('nb'))) !== null && (await SM.inner.loadAll()).jobs.filter(j => j.ownerId === SM.linkId('nb')).length === 2);
      } finally { J.LIMITS.ROWS_PER_USER = rowsWas; await SM.close(); }
      /* (b) at the notes quota: only a finished conversion that holds notes goes (oldest first) - not a failed one, not one that waits or converts, not the neighbour's */
      const SQ = await L.startService({ users: ['mb', 'nb'], config: { perUserResultBytes: 4000, resultReserveBytes: 1000, totalResultBytes: 1e9 } });
      try {
        const tm = await mkToken(SQ, 'mb'), tn = await mkToken(SQ, 'nb');
        const n1 = await convert(SQ, 'nb', tn, 'nbdone00001'); SQ.advance(1000);
        const f1 = await failed(SQ, 'mb', tm, 'mbfail00001'); SQ.advance(1000);
        const d1 = await convert(SQ, 'mb', tm, 'mbdone00001'); SQ.advance(1000);
        const d2 = await convert(SQ, 'mb', tm, 'mbdone00002'); SQ.advance(1000);
        ok('a failed row (the oldest) and two done results of 1856 bytes are kept (3712 of the 4000)', storedOf(SQ, 'mb') === 3712 && d1.r.status === 200 && d2.r.status === 200);
        const w1 = (await enqueue(SQ, 'mb', 'mbwait00001')).body.job;
        ok('a new job asks for 1000 more than 3712 holds in 4000: the OLDEST done conversion goes; the newer one, the failed row and the neighbour\'s are kept', jobStatus(SQ, d1.q.body.job.id) === 'gone'
          && jobStatus(SQ, d2.q.body.job.id) === 'done' && jobStatus(SQ, f1.g.id) === 'failed' && jobStatus(SQ, n1.q.body.job.id) === 'done' && storedOf(SQ, 'mb') === 1856, [d1.q.body.job.id, d2.q.body.job.id, f1.g.id].map(id => jobStatus(SQ, id)).join());
        const w2 = (await enqueue(SQ, 'mb', 'mbwait00002')).body.job, w3 = (await enqueue(SQ, 'mb', 'mbwait00003')).body.job;
        ok('two more jobs fit (1856 + 1000 is under the share): nothing else is cleared', jobStatus(SQ, d2.q.body.job.id) === 'done');
        const g1 = (await SQ.worker(tm).post('/api/worker/claim', { once: true })).body.job, g2 = (await SQ.worker(tm).post('/api/worker/claim', { once: true })).body.job, g3 = (await SQ.worker(tm).post('/api/worker/claim', { once: true })).body.job;
        const r1 = await SQ.worker(tm).post('/api/worker/jobs/' + g1.id + '/result', goodResult(40));
        ok('a result that fits (1856 + 1856 is under 4000): taken, nothing cleared', g1.id === w1.id && r1.status === 200 && jobStatus(SQ, d2.q.body.job.id) === 'done');
        const r2 = await SQ.worker(tm).post('/api/worker/jobs/' + g2.id + '/result', goodResult(40));
        ok('a result that would pass the share is taken too, and the oldest finished conversion is cleared for it - the third job, still converting, and the failed row are not', r2.status === 200 && jobStatus(SQ, d2.q.body.job.id) === 'gone'
          && jobStatus(SQ, g3.id) === 'claimed' && g3.id === w3.id && jobStatus(SQ, f1.g.id) === 'failed' && storedOf(SQ, 'mb') === 3712 && jobStatus(SQ, w2.id) === 'done', [d2.q.body.job.id, g3.id, f1.g.id].map(id => jobStatus(SQ, id)).join());
        ok('and still the neighbour\'s done conversion, with its notes, is exactly as it was', jobStatus(SQ, n1.q.body.job.id) === 'done' && (await SQ.inner.getResult(n1.q.body.job.id, SQ.linkId('nb'))) !== null);
      } finally { await SQ.close(); }
    }

    heading('the caps are taken before anything is awaited: requests at the same moment');
    {
      const rowsWas = J.LIMITS.ROWS_PER_USER;
      J.LIMITS.ROWS_PER_USER = 8;
      const SK = await L.startService({ users: ['racer', 'twin', 'flaky'], config: { perUserResultBytes: 1e9, resultReserveBytes: 0, totalResultBytes: 1e9 } });
      try {
        /* each account is AT its row cap with finished conversions, so every new job has to clear room first: a database call, which is where two requests used to pass the same checks */
        const filled = {};
        for (const u of ['racer', 'twin', 'flaky']) {
          const t = await mkToken(SK, u);
          filled[u] = [];
          for (let i = 0; i < 8; i++) { filled[u].push((await convert(SK, u, t, u.slice(0, 4) + 'full' + String(i).padStart(3, '0'))).q.body.job.id); SK.advance(1000); }
        }
        const realDelete = SK.store.deleteJobs;
        SK.store.deleteJobs = async function () { await sleep(40); return realDelete.apply(this, arguments); };
        const pendingOf = u => Array.from(SK.svc._state.jobs.values()).filter(j => j.ownerId === SK.linkId(u) && (j.status === 'queued' || j.status === 'claimed')).length;
        const rowsOf = u => Array.from(SK.svc._state.jobs.values()).filter(j => j.ownerId === SK.linkId(u)).length;
        const storeRows = async u => (await SK.inner.loadAll()).jobs.filter(j => j.ownerId === SK.linkId(u));
        const eight = await Promise.all(Array.from({ length: 8 }, (_, i) => enqueue(SK, 'racer', 'racerace' + String(i).padStart(3, '0'))));
        const codes = eight.map(r => r.status).sort().join();
        ok('eight different links asked for at the same moment by an account at its row cap: exactly 5 are accepted and 3 are 429 queue-full (the cap of 5 waiting jobs)', codes === '201,201,201,201,201,429,429,429' && eight.filter(r => r.status === 429).every(r => r.body.code === 'queue-full'), codes);
        ok('5 waiting in memory and in the store - not 8 - and the row cap of 8 holds in both (not 13 or 16)', pendingOf('racer') === 5 && rowsOf('racer') === 8 && (await storeRows('racer')).length === 8 && (await storeRows('racer')).filter(j => j.status === 'queued').length === 5, [pendingOf('racer'), rowsOf('racer'), (await storeRows('racer')).length].join());
        ok('and what was cleared for them is the finished conversions only, the 5 oldest: the 3 newest are what is left of the 8', Array.from(SK.svc._state.jobs.values()).filter(j => j.ownerId === SK.linkId('racer') && j.status === 'done').map(j => j.id).sort().join() === filled.racer.slice(5).sort().join());
        const three = await Promise.all([0, 1, 2].map(() => SK.as('twin').post('/api/jobs', { url: WATCH('twintwin001'), title: 'Same' })));
        const created = three.filter(r => r.status === 201), existing = three.filter(r => r.status === 200 && r.body.existing === true);
        ok('the same link asked for three times at the same moment: exactly one job is made, the other two are told it exists - the same one', created.length === 1 && existing.length === 2 && existing.every(r => r.body.job.id === created[0].body.job.id), three.map(r => r.status).join());
        ok('one waiting row for that link in memory and in the store', pendingOf('twin') === 1 && (await storeRows('twin')).filter(j => j.url === WATCH('twintwin001')).length === 1);
        /* a write that fails gives the slot back, and the requests that were told "it exists" are not left holding a job that is not there */
        SK.store.fail.only = 'insertJob'; SK.store.fail.on = true;
        const bad = await Promise.all([0, 1, 2].map(() => SK.as('flaky').post('/api/jobs', { url: WATCH('flakyflaky1') })));
        SK.store.fail.on = false; SK.store.fail.only = null;
        ok('the same link three times while the store cannot write: all three are 503 "store" (the two that waited for the first do not report a job that was never kept)', bad.every(r => r.status === 503 && r.body.code === 'store' && !r.body.job), bad.map(r => r.status).join());
        ok('and nothing is left of it: no row, no slot of the cap of waiting jobs', pendingOf('flaky') === 0 && rowsOf('flaky') <= 8 && (await storeRows('flaky')).filter(j => j.url === WATCH('flakyflaky1')).length === 0 && !Array.from(SK.svc._state.jobs.values()).some(j => j.url === WATCH('flakyflaky1')));
        ok('and the same link can be asked for again', (await SK.as('flaky').post('/api/jobs', { url: WATCH('flakyflaky1') })).status === 201);
      } finally { J.LIMITS.ROWS_PER_USER = rowsWas; await SK.close(); }
    }

    heading('the store: deleteJobs names the owner and a finished state (the file store here; tests/home-worker/jobs-pg.test.js runs the SQL)');
    {
      const dir = L.tmpDir();
      const { fileJobStore } = L.mod('home-jobs-store.js');
      const st = fileJobStore(dir);
      try {
        const mkj = (id, owner) => ({ id: id, ownerId: owner, kind: 'youtube', url: WATCH('ddddddddddd'), title: 'T', createdAt: 1 });
        for (const [id, o] of [['a-queued01', 'A'], ['a-claimed1', 'A'], ['a-failed01', 'A'], ['a-done0001', 'A'], ['b-failed01', 'B'], ['b-queued01', 'B']]) await st.insertJob(mkj(id, o));
        await st.claimJob('a-claimed1', 'A', 'w', 2);
        await st.finishJob('a-failed01', 'A', 'failed', 3, { error: 'e' });
        await st.finishJob('a-done0001', 'A', 'done', 3, { result: { v: 1 }, bytes: 5 });
        await st.finishJob('b-failed01', 'B', 'failed', 3, { error: 'e' });
        const all = ['a-queued01', 'a-claimed1', 'a-failed01', 'a-done0001', 'b-failed01', 'b-queued01', 'nothing-here'];
        ok('with every id of both accounts in the list, account A\'s call removes only A\'s finished rows (2)', (await st.deleteJobs(all, 'A')) === 2);
        const left = (await st.loadAll()).jobs.map(j => j.id).sort().join();
        ok('a queued and a claimed row of A, and both rows of B (a failed one, a queued one), are still there', left === 'a-claimed1,a-queued01,b-failed01,b-queued01', left);
        ok('no owner given: nothing is removed, whatever the ids (not even a finished row)', (await st.deleteJobs(['b-failed01'], undefined)) === 0 && (await st.deleteJobs(['b-failed01'], '')) === 0 && (await st.deleteJobs(['b-failed01'], 'A')) === 0 && (await st.deleteJobs([], 'A')) === 0 && (await st.loadAll()).jobs.length === 4);
        ok('and the owner\'s own finished row goes', (await st.deleteJobs(['b-failed01'], 'B')) === 1 && (await st.loadAll()).jobs.length === 3);
      } finally { L.rmDir(dir); }
    }

    heading('a queue that is switched off (its tables could not be made at the boot): every route says "store", and nothing is read or written');
    {
      const SO = await L.startService({ users: ['off1'] });
      try {
        const tkn = await mkToken(SO, 'off1');
        const jb = (await enqueue(SO, 'off1', 'offoffoff01')).body.job;
        ok('a queue that is on is not marked off', SO.svc.isDisabled() === false);
        SO.store.fail.on = true; SO.store.fail.only = 'loadAll'; SO.svc._state.forgetAll();
        const blip = await SO.as('off1').get('/api/jobs');
        SO.store.fail.on = false; SO.store.fail.only = null;
        ok('a passing store failure is 503 "store" WITHOUT the disabled mark (the page keeps its button and card for it)', blip.status === 503 && blip.body.code === 'store' && blip.body.disabled === undefined, blip.text);
        SO.svc.disable('test: the tables could not be created');
        SO.store.reset();
        const ask = [
          ['GET', '/api/jobs'], ['POST', '/api/jobs', { url: WATCH('offoffoff02') }], ['GET', '/api/jobs/' + jb.id], ['DELETE', '/api/jobs/' + jb.id], ['POST', '/api/jobs/' + jb.id + '/cancel'],
          ['GET', '/api/worker/status'], ['POST', '/api/pc-links', {}], ['DELETE', '/api/pc-links/me'], ['POST', '/api/pc-links/me/worker-token', {}], ['GET', '/api/worker/nothing']
        ];
        const answers = [];
        for (const [m, p, b] of ask) answers.push([m + ' ' + p.replace(jb.id, ':id'), await req(SO.port, m, p, { user: 'off1', body: b })]);
        for (const [m, p, b] of [['GET', '/api/worker/ping'], ['POST', '/api/worker/claim', {}], ['POST', '/api/worker/jobs/' + jb.id + '/result', goodResult(10)], ['POST', '/api/worker/jobs/' + jb.id + '/fail', { error: 'x' }], ['POST', '/api/worker/jobs/' + jb.id + '/heartbeat', {}]]) answers.push([m + ' ' + p.replace(jb.id, ':id'), await req(SO.port, m, p, { token: tkn, body: b })]);
        ok(answers.length + ' routes (the browser\'s and the worker\'s, and a path under /api/worker that is not one): every one answers 503 with code "store", disabled true, the usual sentence and no-store', answers.every(([, r]) => r.status === 503 && r.body.code === 'store' && r.body.disabled === true && r.body.error === 'The queue is not available right now. Try again in a minute.' && /no-store/.test(r.headers['cache-control'] || '')), answers.filter(([, r]) => r.status !== 503 || r.body.disabled !== true).map(([n, r]) => n + ' ' + r.status).join(' | '));
        ok('and not one store call was made for any of them (the tables may not be there)', SO.store.total() === 0, JSON.stringify(SO.store.calls));
        ok('a route that is not the queue\'s is still the server\'s own (here: 404 from the harness)', (await req(SO.port, 'GET', '/api/shares')).status === 404);
        ok('it says so once it is off', SO.svc.isDisabled() === true);
      } finally { await SO.close(); }
    }

    heading('every sentence the page can be shown from the queue has a Korean, Japanese and Chinese string');
    {
      /* the page shows the site's own sentence through tx(): the English text is the key of the catalog (i18n/*.json). These are the ones the browser routes answer with, the two that were English-only (a Remove of a waiting conversion, a result too big for an account) included. */
      const shown = ['No PC link on this device.', 'That PC link is not valid.', 'Too many wrong codes from here. Try again later.', 'Too many PC links were made from here just now. Try again later.', 'Too many PC links were made on this site just now. Try again later.', 'Too many conversions were opened just now. Try again later.', 'PC links are full right now. Try again later.', 'That request did not come from this site.', 'Too many conversions were asked for just now. Try again in a little while.', 'That is not a link to a YouTube video.',
        'You already have 5 conversions waiting. Wait for one to finish, or cancel one.', 'The queue is full right now. Try again later.', 'The queue is not available right now. Try again in a minute.', 'That conversion is not there.',
        'The notes of that conversion are no longer kept.', 'Cancel that conversion first, then remove it.', 'That conversion has already finished.', 'This conversion is larger than one account may keep.',
        'Too many tokens were made just now. Try again later.'];
      const src = L.fs.readFileSync(L.path.join(L.MODS, 'home-jobs.js'), 'utf8');
      ok('(the two that were English-only are still the sentences home-jobs.js sends)', src.indexOf('Cancel that conversion first, then remove it.') >= 0 && src.indexOf('This conversion is larger than one account may keep.') >= 0);
      for (const loc of ['ko-KR', 'ja-JP', 'zh-CN']) {
        const cat = JSON.parse(L.fs.readFileSync(L.path.join(L.REPO, 'i18n', loc + '.json'), 'utf8')).content;
        const missing = shown.filter(s => typeof cat[s] !== 'string' || !cat[s].trim() || cat[s] === s);
        ok(loc + ': all ' + shown.length + ' have a string of their own', missing.length === 0, missing.join(' | ').slice(0, 160));
      }
    }

    heading('a check is not a heartbeat (worker.js --check asks /api/worker/ping)');
    {
      const SP = await L.startService({ users: ['ck'] });
      try {
        const tk = await mkToken(SP, 'ck');
        const w0 = (await SP.as('ck').get('/api/worker/status')).body.worker;
        await SP.worker(tk).get('/api/worker/ping');
        const w1 = (await SP.as('ck').get('/api/worker/status')).body.worker;
        ok('the first check marks the PC as connected (so the page offers the button) and alive for a couple of minutes', !w0.everSeen && w1.everSeen && w1.alive);
        SP.advance(3 * 60 * 1000);
        ok('three minutes later it is not alive any more (a check announces no wait)', (await SP.as('ck').get('/api/worker/status')).body.worker.alive === false);
        await SP.worker(tk).get('/api/worker/ping');
        const w2 = (await SP.as('ck').get('/api/worker/status')).body.worker;
        ok('a second check changes nothing: the PC is not alive again, the last-seen time is the first one\'s', w2.alive === false && w2.lastSeenAt === w1.lastSeenAt, JSON.stringify(w2));
        await SP.worker(tk).post('/api/worker/claim', { waitSeconds: 3600 });
        const w3 = (await SP.as('ck').get('/api/worker/status')).body.worker;
        SP.advance(30 * 60 * 1000);
        await SP.worker(tk).get('/api/worker/ping');
        const w4 = (await SP.as('ck').get('/api/worker/status')).body.worker;
        ok('and a check never shortens or extends what a running worker announced (alive for two waits from its own poll, not from the check)', w3.alive && w4.lastSeenAt === w3.lastSeenAt && w4.alive, JSON.stringify([w3.lastSeenAt, w4.lastSeenAt]));
        SP.advance(2 * 3600 * 1000);
        await SP.worker(tk).get('/api/worker/ping');
        ok('two hours and a half after the worker\'s last poll it is not alive, however many checks were made since', (await SP.as('ck').get('/api/worker/status')).body.worker.alive === false);
      } finally { await SP.close(); }
    }

    heading('the hourly budgets: given back once, per address, and not lost to a store that fails');
    {
      const SH = await L.startService({ users: ['h6', 'h7'] });
      try {
        let made = 0;
        for (let i = 0; i < 25; i++) { const r = await SH.as('h6').post('/api/jobs', { url: WATCH('budgetbud' + String(i).padStart(2, '0')) }); if (r.status === 201) { made++; await SH.as('h6').post('/api/jobs/' + r.body.job.id + '/cancel'); } }
        const refused = [];
        for (let i = 0; i < 10; i++) refused.push((await SH.as('h6').post('/api/jobs', { url: 'https://example.com/' + i })).status);
        let more = 0, last = null;
        for (let i = 0; i < 12; i++) { const r = await SH.as('h6').post('/api/jobs', { url: WATCH('budgetbux' + String(i).padStart(2, '0')) }); if (r.status === 201) { more++; await SH.as('h6').post('/api/jobs/' + r.body.job.id + '/cancel'); } else { last = r; break; } }
        ok('25 enqueues, 10 refused requests (each takes a slot and gives back exactly ONE), then exactly 5 more enqueues: the 31st is 429 - a refusal never frees a slot it did not take', made === 25 && refused.every(s => s === 422) && more === 5 && last && last.status === 429 && last.body.code === 'too-many', made + ' ' + more + ' ' + (last && last.status));
        /* a store that fails to write the job gives the slot back */
        SH.store.fail.on = true; SH.store.fail.only = 'insertJob';
        const down = [];
        for (let i = 0; i < 35; i++) down.push((await SH.as('h7').post('/api/jobs', { url: WATCH('downdown' + String(i).padStart(3, '0')) })).status);
        SH.store.fail.on = false;
        let again = 0;
        for (let i = 0; i < 30; i++) { const r = await SH.as('h7').post('/api/jobs', { url: WATCH('upupupup' + String(i).padStart(3, '0')) }); if (r.status === 201) { again++; await SH.as('h7').post('/api/jobs/' + r.body.job.id + '/cancel'); } }
        ok('35 enqueues while the store cannot write (503 each) cost nothing: all 30 hourly enqueues are still there afterwards', down.every(s => s === 503) && again === 30, down.slice(0, 3).join() + ' ' + again);
      } finally { await SH.close(); }
      /* new tokens: 20 an hour per address, whoever the links are */
      const ST = await L.startService({ users: ['t1', 't2', 't3', 't4', 't5'] });
      try {
        const out = [];
        for (const u of ['t1', 't2', 't3', 't4', 't5']) for (let i = 0; i < 4; i++) out.push((await req(ST.port, 'POST', '/api/pc-links/me/worker-token', { user: u, ip: '11.0.0.1', body: {} })).status);
        const over = await req(ST.port, 'POST', '/api/pc-links/me/worker-token', { user: 't1', ip: '11.0.0.1', body: {} });
        const elsewhere = await req(ST.port, 'POST', '/api/pc-links/me/worker-token', { user: 't1', ip: '11.0.0.2', body: {} });
        ok('five links at one address: 20 new tokens an hour, the 21st is 429 (too-many) whoever asks; from another address the same link can (its own cap is 10 an hour)', out.every(s => s === 201) && over.status === 429 && over.body.code === 'too-many' && elsewhere.status === 201, out.filter(s => s !== 201).length + ' ' + over.status + ' ' + elsewhere.status);
      } finally { await ST.close(); }
    }

    heading('the schema work of a boot goes through the lock (server.js)');
    {
      const srv = L.fs.readFileSync(L.path.join(L.MODS, 'server.js'), 'utf8');
      ok('server.js runs the boot SQL and the queue\'s tables through homeJobsStore.migrate (one transaction under the advisory lock), not through a plain query', /homeJobsStore\.migrate\(getPool\(\), \`/.test(srv) && !/q\(homeJobsStore\.SCHEMA_SQL\)/.test(srv) && !/await q\(\`\s*CREATE TABLE IF NOT EXISTS ppp_users/.test(srv));
    }

    heading('a link\'s use is written to the database rarely: at most every 6 hours, and only by a page request');
    {
      const SL = await L.startService({ users: ['m1'] });
      try {
        SL.store.reset();
        for (let i = 0; i < 25; i++) { await SL.as('m1').get('/api/jobs'); await SL.as('m1').get('/api/worker/status'); }
        ok('50 page requests by one link in its first hours write nothing (the link was just made)', SL.store.total() === 0, JSON.stringify(SL.store.calls));
        SL.advance(7 * 3600 * 1000);
        for (let i = 0; i < 25; i++) { await SL.as('m1').get('/api/jobs'); await SL.as('m1').get('/api/worker/status'); }
        ok('7 hours later the first one writes its last-use time (touchLink), the other 49 write nothing', SL.store.calls.touchLink === 1 && SL.store.total() === 1, JSON.stringify(SL.store.calls));
        SL.advance(5 * 3600 * 1000);
        await SL.as('m1').get('/api/jobs');
        ok('and 5 hours after that, nothing', SL.store.calls.touchLink === 1);
        SL.advance(2 * 3600 * 1000);
        SL.store.fail.on = true; SL.store.fail.only = 'touchLink';
        const f1 = await SL.as('m1').get('/api/jobs');
        SL.store.fail.on = false;
        ok('a write of it that fails does not fail the request (it is only logged)', f1.status === 200 && SL.logged.length === 1 && SL.store.calls.touchLink === 2, JSON.stringify(SL.store.calls));
        ok('and it is not tried again by every request while the database is down: the next request, and 30 more seconds later the next, do not try; a minute later one does', (await SL.as('m1').get('/api/jobs')).status === 200 && SL.store.calls.touchLink === 2
          && (SL.advance(30 * 1000), (await SL.as('m1').get('/api/jobs')).status === 200) && SL.store.calls.touchLink === 2 && (SL.advance(31 * 1000), (await SL.as('m1').get('/api/jobs')).status === 200) && SL.store.calls.touchLink === 3, JSON.stringify(SL.store.calls));
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
      for (let i = 0; i < 20; i++) { await S5.as('z1').get('/api/jobs'); await S5.as('z1').get('/api/worker/status'); }
      ok('pings run none either, and the page\'s own status polls only the one write of the link\'s last use (60 hours had gone by since it was made)', S5.store.total() === (S5.store.calls.touchLink || 0) && (S5.store.calls.touchLink || 0) <= 1, JSON.stringify(S5.store.calls));
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
      S7.store.fail.on = true; S7.store.fail.only = 'rotateToken';
      const tf = await S7.as('s1').post('/api/pc-links/me/worker-token', {});
      S7.store.fail.on = false;
      ok('a new token whose write fails is 503, and the old token still works (nothing was shown, nothing was replaced)', tf.status === 503 && (await S7.worker(tk).get('/api/worker/ping')).status === 200 && !tf.text.includes('ppw_'));
      S7.store.fail.on = true; S7.store.fail.only = 'createLink';
      const lf0 = await S7.makeLink('never').catch(e => ({ status: Number(/ (\d{3}) /.exec(e.message)[1]), text: e.message }));
      S7.store.fail.on = false;
      ok('a link whose write fails is 503 and is not kept: nothing in memory, and the next one works', lf0.status === 503 && S7.svc._state.links.size === 1 && (await S7.makeLink('later')).status === 201);
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
    const B = await L.startService({ resume: A.creds(), store: fileJobStore(dir) });
    try {
      const lj = (await B.as('b1').get('/api/jobs')).body;
      ok('a new process reads the queue back: the link (its code still works), the claimed job, its title, the token', lj.jobs.length === 1 && lj.jobs[0].id === jobA.id && lj.jobs[0].status === 'claimed' && lj.jobs[0].title === 'Kept' && lj.worker.hasToken && lj.worker.everSeen);
      ok('the token still works, and the claimed job takes its result', (await B.worker(tkA).post('/api/worker/jobs/' + jobA.id + '/result', goodResult(12))).status === 200);
    } finally { await B.close(); L.rmDir(dir); }
  } finally { await S.close(); }
}

function jobOf(S, id) { return S.svc._state.jobs.get(id); }
function jobStatus(S, id) { const j = jobOf(S, id); return j ? j.status : 'gone'; }

main().then(() => L.finish('the home-PC queue'), e => { console.error(e); process.exit(1); });
