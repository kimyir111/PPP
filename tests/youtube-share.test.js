'use strict';
/* G13-3 (U9): a score made from a YouTube link is not posted to the PUBLIC Shared Scores; its link can still be sent. Node only, on this tree's server.js with the
   file store (the answer does not depend on the store: the rule reads what arrives and what was stored).

   What the server reads: the page's flag `youtubeDerived: true` and the mark `youtubeDerived` inside the score's `source` (which a copy carries to whoever adds
   it). It does NOT read a `source.kind` of 'youtube' or a card `kind` of 'youtube': a hymn or a catalogue score with a performance to watch has them and is
   not made from that audio (the page, which knows the notation was transcribed, sets the mark). It is a POLICY guard, not a security boundary: the server only
   knows what the client says (the last test says so out loud). Shares already posted are not touched.

   PPP_NOTICES_ROOT points the suite at a copy of the tree (tests/notices/mutants.js breaks server.js there and this suite must go red). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ROOT } = require('./notices/lib.js');

const REASON = 'A score made from a YouTube link cannot be posted to Shared Scores. You can still send its link.';
const GUEST_KEY = 'g'.repeat(40);

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
async function boot(dir) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', DATABASE_URL: '', PPP_DATA_DIR: dir, SESSION_SECRET: 'youtube-share-test' })
  });
  let out = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the server did not start: ' + out)), 30000);
    const seen = d => { out += d; if (/listening on/.test(out)) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', seen); child.stderr.on('data', seen);
    child.on('exit', code => { clearTimeout(timer); reject(new Error('the server exited (' + code + '): ' + out)); });
  });
  return { port, close: () => new Promise(r => { child.once('exit', r); child.kill(); }) };
}
function req(port, method, p, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const body = o.body == null ? null : Buffer.from(JSON.stringify(o.body));
    const headers = {};
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = body.length; }
    if (o.cookie) headers['Cookie'] = o.cookie;
    if (o.guest) headers['X-PPP-Guest'] = o.guest;
    const r = http.request({ host: '127.0.0.1', port: port, method: method, path: p, headers: headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { json = null; }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });
    r.on('error', reject);
    r.end(body);
  });
}
/* the page as the server sends it for /?share=<id>: the head's meta tags are the link's preview */
function html(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: port, path: p }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}
const score = source => ({
  title: 'Practice', composer: '', tempo: 90, staves: 2,
  measures: [{ number: 1 }, { number: 2 }],
  notes: [{ midi: 60, start: 0, dur: 1, m: 1 }, { midi: 64, start: 1, dur: 1, m: 1 }],
  source: source
});
let seq = 0;
const share = (o, extra) => Object.assign({ songKey: 'song-' + (++seq), title: 'Song ' + seq, score: score({ kind: 'musicxml' }), preview: null }, o || {}, extra || {});

async function account(port) {
  const r = await req(port, 'POST', '/api/auth/signup', { body: { email: 'yt' + Date.now() + '-' + (++seq) + '@example.com', password: 'practice-ok', displayName: 'Teacher' } });
  assert.equal(r.status, 201);
  const cookie = String(r.headers['set-cookie'] || '').split(';')[0];
  assert.ok(cookie, 'a session cookie');
  return { cookie, id: r.body.id };
}
const rm = d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* stays */ } };

test('an account cannot post a YouTube-derived score to the public list, however the payload says it; the refusal has a code and a reason, and stores nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-ytshare-'));
  const srv = await boot(dir);
  try {
    const a = await account(srv.port);
    const cases = {
      'the page\'s flag': share({ youtubeDerived: true }),
      'the mark a copy carries (youtubeDerived in the source)': share({ score: score({ kind: 'shared', youtubeDerived: true }) }),
      'the mark with a YouTube link beside it': share({ score: score({ kind: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ', youtubeDerived: true }) }),
      'an arrangement of one (the mark on an arrangement source)': share({ kind: 'arrangement', score: score({ kind: 'arrangement', parentSongId: 'song-x', youtubeDerived: true }) })
    };
    for (const [name, payload] of Object.entries(cases)) {
      const r = await req(srv.port, 'POST', '/api/shares', { cookie: a.cookie, body: Object.assign({}, payload, { listed: true }) });
      assert.equal(r.status, 403, name + ': ' + JSON.stringify(r.body));
      assert.equal(r.body.code, 'youtube-not-public', name);
      assert.equal(r.body.error, REASON, name);
    }
    const mine = await req(srv.port, 'GET', '/api/shares?mine=1', { cookie: a.cookie });
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.shares, [], 'a refused post made nothing, not even an unlisted row');
    const pub = await req(srv.port, 'GET', '/api/shares');
    assert.ok(!pub.body.shares.some(s => /^Song /.test(s.title)), 'and nothing is in the public list');
  } finally { await srv.close(); rm(dir); }
});

test('the same songs still get a link (listed left out or false), and an ordinary song is still posted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-ytshare-'));
  const srv = await boot(dir);
  try {
    const a = await account(srv.port);
    const yt = share({ youtubeDerived: true, kind: 'youtube', score: score({ kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', youtubeDerived: true }) });
    const link = await req(srv.port, 'POST', '/api/shares', { cookie: a.cookie, body: yt });
    assert.equal(link.status, 201);
    assert.equal(link.body.listed, false, 'sending a link never posts');
    const got = await req(srv.port, 'GET', '/api/shares/' + link.body.id);
    assert.equal(got.status, 200, 'and the link opens it');
    assert.equal(got.body.score.source.youtubeDerived, true, 'with its mark, so whoever adds it keeps it');
    const explicitFalse = await req(srv.port, 'POST', '/api/shares', { cookie: a.cookie, body: Object.assign(share({ youtubeDerived: true }), { listed: false }) });
    assert.equal(explicitFalse.status, 201);
    assert.equal(explicitFalse.body.listed, false);
    const ordinary = await req(srv.port, 'POST', '/api/shares', { cookie: a.cookie, body: Object.assign(share(), { listed: true }) });
    assert.equal(ordinary.status, 201);
    assert.equal(ordinary.body.listed, true, 'an ordinary song is posted as before');
    /* a hymn or a catalogue score that has a performance to watch is not made from that audio: its YouTube source and card kind do not block it */
    const hymn = await req(srv.port, 'POST', '/api/shares', { cookie: a.cookie, body: Object.assign(share({ kind: 'youtube', score: score({ kind: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ' }) }), { listed: true }) });
    assert.equal(hymn.status, 201, 'a score with a YouTube performance link and no mark is posted: ' + JSON.stringify(hymn.body));
    assert.equal(hymn.body.listed, true);
    /* and a source that is some other kind of origin is not mistaken for YouTube */
    for (const kind of ['audio', 'video', 'pdf', 'image', 'musicxml', 'arrangement', 'shared', 'course']) {
      const r = await req(srv.port, 'POST', '/api/shares', { cookie: a.cookie, body: Object.assign(share({ kind: kind, score: score({ kind: kind }) }), { listed: true }) });
      assert.equal(r.status, 201, kind + ': ' + JSON.stringify(r.body));
    }
  } finally { await srv.close(); rm(dir); }
});

test('posting a stored YouTube-derived share afterwards (PATCH listed:true) is refused the same way; taking down is not; an ordinary one is posted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-ytshare-'));
  const srv = await boot(dir);
  try {
    const a = await account(srv.port);
    const yt = (await req(srv.port, 'POST', '/api/shares', { cookie: a.cookie, body: share({ youtubeDerived: true, score: score({ kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', youtubeDerived: true }) }) })).body;
    const no = await req(srv.port, 'PATCH', '/api/shares/' + yt.id, { cookie: a.cookie, body: { listed: true } });
    assert.equal(no.status, 403);
    assert.equal(no.body.code, 'youtube-not-public');
    assert.equal(no.body.error, REASON);
    const still = await req(srv.port, 'GET', '/api/shares/' + yt.id);
    assert.equal(still.body.listed, false, 'still a link only');
    assert.equal((await req(srv.port, 'PATCH', '/api/shares/' + yt.id, { cookie: a.cookie, body: { listed: false } })).status, 200, 'taking down is always allowed');
    /* a stored score that only has a YouTube source (a hymn) is posted */
    const hymn = (await req(srv.port, 'POST', '/api/shares', { cookie: a.cookie, body: share({ kind: 'youtube', score: score({ kind: 'youtube', youtubeId: 'dQw4w9WgXcQ' }) }) })).body;
    assert.equal((await req(srv.port, 'PATCH', '/api/shares/' + hymn.id, { cookie: a.cookie, body: { listed: true } })).status, 200);
    const ok = (await req(srv.port, 'POST', '/api/shares', { cookie: a.cookie, body: share() })).body;
    const posted = await req(srv.port, 'PATCH', '/api/shares/' + ok.id, { cookie: a.cookie, body: { listed: true } });
    assert.equal(posted.status, 200);
    assert.equal(posted.body.listed, true);
  } finally { await srv.close(); rm(dir); }
});

test('a guest link of a YouTube-derived score is made as before (unlisted, 30 days), and opens', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-ytshare-'));
  const srv = await boot(dir);
  try {
    const r = await req(srv.port, 'POST', '/api/shares', { guest: GUEST_KEY, body: share({ youtubeDerived: true, listed: true, score: score({ kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', youtubeDerived: true }) }) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.listed, false, 'a guest link is never listed');
    assert.ok(r.body.expiresAt, 'and it has its end date');
    assert.equal((await req(srv.port, 'GET', '/api/shares/' + r.body.id)).status, 200);
    const pub = await req(srv.port, 'GET', '/api/shares');
    assert.ok(!pub.body.shares.some(s => s.id === r.body.id));
  } finally { await srv.close(); rm(dir); }
});

test('shares already posted are not touched: they stay in the list, can be taken down, a link send leaves them posted, and a PATCH that changes nothing is not refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-ytshare-'));
  const srv = await boot(dir);
  try {
    const a = await account(srv.port);
    /* a row that is posted and carries the mark (it can only come from a page that sent it, or by hand): the rule meets it as it is */
    const old = {
      id: 'legacyYT0001', ownerId: a.id, ownerName: 'Teacher', songKey: 'song-legacy', title: 'Posted long ago', composer: '', genre: '', kind: 'youtube',
      measures: 2, listed: true, preview: null, score: score({ kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', youtubeDerived: true }),
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z'
    };
    fs.writeFileSync(path.join(dir, 'shares.json'), JSON.stringify({ shares: [old] }));
    const list = await req(srv.port, 'GET', '/api/shares');
    assert.ok(list.body.shares.some(s => s.id === old.id && s.listed), 'still in the public list');
    const same = await req(srv.port, 'PATCH', '/api/shares/' + old.id, { cookie: a.cookie, body: { listed: true } });
    assert.equal(same.status, 200, 'listed:true on a share that is already listed changes nothing and is not refused');
    assert.equal(same.body.listed, true);
    const resend = await req(srv.port, 'POST', '/api/shares', { cookie: a.cookie, body: share({ songKey: 'song-legacy', title: 'Posted long ago', kind: 'youtube', youtubeDerived: true, score: score({ kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', youtubeDerived: true }) }) });
    assert.equal(resend.status, 200, 'sending its link again is allowed');
    assert.equal(resend.body.listed, true, 'and does not take it down (nor post anything new)');
    const down = await req(srv.port, 'PATCH', '/api/shares/' + old.id, { cookie: a.cookie, body: { listed: false } });
    assert.equal(down.status, 200);
    assert.equal(down.body.listed, false);
    const again = await req(srv.port, 'PATCH', '/api/shares/' + old.id, { cookie: a.cookie, body: { listed: true } });
    assert.equal(again.status, 403, 'once taken down it is a new posting, and the rule applies');
  } finally { await srv.close(); rm(dir); }
});

test('the link of a YouTube-derived score stays link-only: noindex, and no title or description of it in the preview; an ordinary share keeps its preview', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-ytshare-'));
  const srv = await boot(dir);
  try {
    const a = await account(srv.port);
    const yt = (await req(srv.port, 'POST', '/api/shares', { cookie: a.cookie, body: share({ title: 'Secret Practice Title', youtubeDerived: true, score: score({ kind: 'shared', youtubeDerived: true }) }) })).body;
    const plain = (await req(srv.port, 'POST', '/api/shares', { cookie: a.cookie, body: share({ title: 'Ordinary Practice Title' }) })).body;
    const guest = (await req(srv.port, 'POST', '/api/shares', { guest: GUEST_KEY, body: share({ title: 'Guest Secret Title', youtubeDerived: true, score: score({ kind: 'shared', youtubeDerived: true }) }) })).body;
    const guestPlain = (await req(srv.port, 'POST', '/api/shares', { guest: 'h'.repeat(40), body: share({ title: 'Guest Ordinary Title' }) })).body;
    const a1 = await html(srv.port, '/?share=' + yt.id);
    assert.equal(a1.status, 200);
    assert.match(a1.text, /<meta name="robots" content="noindex">/, 'not for a search engine');
    assert.ok(!/og:title|og:description|twitter:title|name="description"/.test(a1.text), 'no preview text');
    assert.ok(!a1.text.includes('Secret Practice Title'), 'and not the title');
    const g1 = await html(srv.port, '/?share=' + guest.id);
    assert.match(g1.text, /noindex/);
    assert.ok(!/og:title/.test(g1.text) && !g1.text.includes('Guest Secret Title'));
    const o1 = await html(srv.port, '/?share=' + plain.id);
    assert.match(o1.text, /og:title" content="Ordinary Practice Title/, 'an ordinary share keeps its preview');
    assert.ok(!/<meta name="robots" content="noindex">/.test(o1.text), 'and is not hidden from search (an account\'s share may be posted)');
    const g2 = await html(srv.port, '/?share=' + guestPlain.id);
    assert.match(g2.text, /noindex/, 'a guest link is still noindex, as before');
    assert.match(g2.text, /og:title" content="Guest Ordinary Title/, 'with the preview it had');
  } finally { await srv.close(); rm(dir); }
});

test('it is a policy guard and says so: a payload that leaves every mark out is believed (the server cannot know where a score came from, and does not guess from a YouTube link)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-ytshare-'));
  const srv = await boot(dir);
  try {
    const a = await account(srv.port);
    const r = await req(srv.port, 'POST', '/api/shares', { cookie: a.cookie, body: Object.assign(share({ score: score({ kind: 'musicxml' }) }), { listed: true }) });
    assert.equal(r.status, 201, 'nothing in it carries the mark, so it is posted: documented limit (G13 doc, G13-3)');
  } finally { await srv.close(); rm(dir); }
});
