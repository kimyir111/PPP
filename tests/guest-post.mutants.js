/* G13 no login: mutation checks of guest posting. A copy of the server's modules is made, ONE rule is broken in it, and tests/guest-post.test.js is run against the copy
   (PPP_SRC_DIR): a mutant that survives is a limit or a rule that nothing tests. The repository's own files are never touched.

     node tests/guest-post.mutants.js            run them all (the unmutated copy first: it has to pass)
     node tests/guest-post.mutants.js L1 O2      only these
     node tests/guest-post.mutants.js --list     what each one breaks

   Exit code 0 when every mutant is killed (and the unmutated copy passes). The Postgres twin (tests/guest-post-pg.test.js) has its own two, at the end of this table,
   run when PPP_TEST_PG_URL is set (and NODE_PATH reaches `pg`). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
/* what server.js needs to start (and what the test reads): a copy without them does not run */
const FILES = ['server.js', 'share-guest.js', 'home-jobs.js', 'home-jobs-store.js', 'home-result.js', 'home-omr.js', 'body-reader.js', 'static-allow.js', 'static-assets.js',
  'signup-limit.js', 'server-stats.js', 'catalog/shared-seeds.json', 'tools/shares-admin/list.js', 'package.json'];

const TEST = 'guest-post.test.js', PG = 'guest-post-pg.test.js';
/* id, file, what the mutant breaks, [from, to] or [[from, to], ...] (each replaced once), the test that must fail */
const M = [
  ['L1', 'share-guest.js', 'a browser may post 500 times a day, not 5', ['POST_PER_KEY_PER_DAY: 5,', 'POST_PER_KEY_PER_DAY: 500,'], TEST],
  ['L2', 'share-guest.js', 'an address may post 1000 times a day, not 10', ['POST_PER_IP_PER_DAY: 10,', 'POST_PER_IP_PER_DAY: 1000,'], TEST],
  ['L3', 'share-guest.js', 'the site takes 6000 posts a day, not 60', ['POST_GLOBAL_PER_DAY: 60,', 'POST_GLOBAL_PER_DAY: 6000,'], TEST],
  ['L4', 'share-guest.js', 'a browser holds 1000 posts at once, not 10', ['PER_GUEST_LISTED: 10,', 'PER_GUEST_LISTED: 1000,'], TEST],
  ['L5', 'share-guest.js', 'an address holds 2000 posts at once, not 20', ['PER_ADDR_LISTED: 20,', 'PER_ADDR_LISTED: 2000,'], TEST],
  ['L6', 'share-guest.js', 'the site holds 30000 posts, not 300', ['TOTAL_LISTED: 300,', 'TOTAL_LISTED: 30000,'], TEST],
  ['L7', 'share-guest.js', 'the posts may hold 2.4 GB, not 24 MB', ['TOTAL_LISTED_BYTES: 24 * 1024 * 1024,', 'TOTAL_LISTED_BYTES: 2400 * 1024 * 1024,'], TEST],
  ['L8', 'share-guest.js', 'a post ends in 30 days like a link, not 90', ['TTL_LISTED_MS: 90 * 24 * 60 * 60 * 1000,', 'TTL_LISTED_MS: 30 * 24 * 60 * 60 * 1000,'], TEST],
  ['L9', 'share-guest.js', 'a body may be 100 MB, not 1 MB', ['MAX_BYTES: 1024 * 1024,', 'MAX_BYTES: 100 * 1024 * 1024,'], TEST],
  ['L10', 'share-guest.js', 'a re-sent post is held to the counts of a new post (or: a new one is not held to them)', ["const wasListed = !!(prev && prev.listed);\n    if (!wasListed) {", "const wasListed = false;\n    if (!wasListed) {"], TEST],
  ['L11', 'share-guest.js', 'a post that would pass the bytes of all posts is accepted', ['if (listing.totalListedBytes - (wasListed ? (prev.bytes || 0) : 0) + newBytes > GUEST.TOTAL_LISTED_BYTES) return', 'if (false) return'], TEST],
  ['L12', 'share-guest.js', 'a full list evicts nothing, but a full list is no longer refused (the 301st is accepted)', ["if (listing.totalListed >= GUEST.TOTAL_LISTED) return { status: 503, code: 'busy', error: BUSY };", ''], TEST],
  ['N1', 'share-guest.js', 'a guest may call itself "PPP Library" (or a contact)', ["if (/^ppp(?![a-z0-9])/i.test(s) || /https?:|www\\.|@|\\.(?:com|net|org|io|kr|jp|cn|co)(?![a-z0-9])/i.test(s)) return GUEST.OWNER_NAME;", ''], TEST],
  ['N2', 'share-guest.js', 'a name may be any length', ['NAME_MAX: 24', 'NAME_MAX: 2400'], TEST],
  ['N3', 'share-guest.js', 'control and bidi-override characters are kept in a name', ["replace(/[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]/g, ' ')", "replace(/[\\u0000-\\u0008]/g, ' ')"], TEST],
  ['O1', 'server.js', 'a guest key that does not own a row may change it (PATCH, DELETE)', ['guestShare.sameOwner(guestId, row.ownerId);\n  if (!userOwns && !guestOwns)', 'true;\n  if (!userOwns && !guestOwns)'], TEST],
  ['O2', 'server.js', 'anyone may change a guest\'s row', ["if (!userOwns && !guestOwns) return jsonError(res, 403, 'Only the person who shared it can change that.');", ''], TEST],
  ['O3', 'server.js', 'the guest key is also read from the URL', ["const guestId = guestShare.guestOwnerId(typeof guestHeader === 'string' ? guestHeader : '');", "const guestId = guestShare.guestOwnerId(typeof guestHeader === 'string' ? guestHeader : String(url.searchParams.get('guest') || ''));"], TEST],
  ['O4', 'server.js', 'the list card carries the owner id', ["if (guestShare.isGuestOwner(row.ownerId)) card.guest = true;", "if (guestShare.isGuestOwner(row.ownerId)) { card.guest = true; card.ownerId = row.ownerId; }"], TEST],
  ['O5', 'server.js', '"mine" ignores the guest key', ["ownerIds: mine ? [user && user.id, guestId].filter(Boolean) : null,", "ownerIds: mine ? [user && user.id].filter(Boolean) : null,"], TEST],
  ['Y1', 'server.js', 'a guest may post a YouTube-derived score to the list (POST)', ["if (body.listed === true && youtubeDerivedShare(body.score, body.youtubeDerived)) {\n      return refuse(", "if (!guest && body.listed === true && youtubeDerivedShare(body.score, body.youtubeDerived)) {\n      return refuse("], TEST],
  ['Y2', 'server.js', 'a YouTube-derived link may be put into the list afterwards (PATCH)', ["if (body.listed === true && !row.listed && youtubeDerivedShare(row.score, false)) {", "if (false) {"], TEST],
  ['R1', 'server.js', 'a post takes no place of the browser\'s day', ["const why = takeGuestPost(ip, guestId);\n        if (why) return { refuse: why };\n        postTaken = true;", "const why = null;\n        if (why) return { refuse: why };\n        postTaken = true;"], TEST],
  ['R2', 'server.js', 'putting a link into the list takes no place of the day', ["const why = takeGuestPost(ip, guestId);\n        if (why) return jsonError(res, why.status, why.error, { code: why.code });\n        took = true;", "const why = null;\n        if (why) return jsonError(res, why.status, why.error, { code: why.code });\n        took = true;"], TEST],
  ['R3', 'server.js', 'a refused post keeps the places of the day it took', ["guestLimits.ip.release(ip); guestLimits.all.release('all'); releasePost();\n        guestLimits.fails.take(ip);", "guestLimits.ip.release(ip); guestLimits.all.release('all');\n        guestLimits.fails.take(ip);"], TEST],
  ['S1', 'server.js', 'the file store lists a guest row past its end date', ["const rows = loadShares().filter(r => !guestShare.expired(r, nowMs) && (owners ? owners.indexOf(r.ownerId) > -1 : r.listed));", "const rows = loadShares().filter(r => (owners ? owners.indexOf(r.ownerId) > -1 : r.listed));"], TEST],
  ['S2', 'server.js', 'a taken-down post keeps its address tag', ["      } else row.addrTag = null;\n      rows = rows.filter(r => r.id !== id);", "      }\n      rows = rows.filter(r => r.id !== id);"], TEST],
  ['S3', 'server.js', 'a link put into the list skips the caps of a new post', ["const refuse = guestShare.decide(prev, held.mine, held.usage, prev.bytes || 0, guestListing(guests, ownerId, row.addrTag));", "const refuse = null;"], TEST],
  ['S4', 'server.js', 'a post is not tagged with its address in the file store (the per-address cap counts nothing)', ["r.addrTag = listed ? guestAddrTagOf(ip) : null; }", "r.addrTag = null; }"], TEST],
  ['S5', 'server.js', 'the post caps are not asked when a post is made (POST)', ["const refuse = guestShare.decide(prev, held.mine, held.usage, row.bytes, row.listed ? guestListing(guests, ownerId, row.addrTag) : null);", "const refuse = guestShare.decide(prev, held.mine, held.usage, row.bytes, null);"], TEST],
  ['K1', 'server.js', 'the owner\'s switch does nothing', ["if (process.env.PPP_GUEST_POSTS === '0') return {", "if (false) return {"], TEST],
  /* the Postgres twin */
  ['P1', 'server.js', 'Postgres: guests do not take turns when they post (no advisory lock in guestUpsert)', ["await c.query('SELECT pg_advisory_xact_lock($1)', [GUEST_LOCK_KEY]);\n        await c.query('DELETE FROM ppp_shares WHERE expires_at IS NOT NULL AND expires_at <= $1', [new Date(nowMs).toISOString()]);\n        const prev = (await c.query('SELECT ' + SHARE_COLS + ' FROM ppp_shares WHERE owner_id = $1 AND song_key = $2', [ownerId, songKey])).rows[0] || null;\n        const row = build(prev);", "await c.query('DELETE FROM ppp_shares WHERE expires_at IS NOT NULL AND expires_at <= $1', [new Date(nowMs).toISOString()]);\n        const prev = (await c.query('SELECT ' + SHARE_COLS + ' FROM ppp_shares WHERE owner_id = $1 AND song_key = $2', [ownerId, songKey])).rows[0] || null;\n        const row = build(prev);"], PG],
  ['P2', 'server.js', 'Postgres: the public list shows a row past its end date', ["      where.push('(expires_at IS NULL OR expires_at > now())');\n", ''], PG],
  ['P3', 'server.js', 'Postgres: the address tag is not written', ["row.createdAt, row.updatedAt, row.expiresAt || null, row.bytes || 0, row.addrTag || null];", "row.createdAt, row.updatedAt, row.expiresAt || null, row.bytes || 0, null];"], PG]
];

function mutate(file, text, pairs) {
  const crlf = text.indexOf('\r\n') >= 0;
  let t = text.replace(/\r\n/g, '\n');
  pairs.forEach(([a, b]) => {
    const i = t.indexOf(a);
    if (i < 0) throw new Error('the pattern is not in ' + file + ': ' + a.slice(0, 70));
    if (t.indexOf(a, i + 1) >= 0) throw new Error('the pattern is not unique in ' + file + ': ' + a.slice(0, 70));
    t = t.slice(0, i) + b + t.slice(i + a.length);
  });
  return crlf ? t.replace(/\n/g, '\r\n') : t;
}

function copyTo(dir) {
  FILES.forEach(f => {
    const to = path.join(dir, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(REPO, f), to);
  });
}

function run(test, srcDir) {
  const r = spawnSync(process.execPath, [path.join(REPO, 'tests', test)], {
    cwd: REPO, env: Object.assign({}, process.env, { PPP_SRC_DIR: srcDir }), encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024
  });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) { M.forEach(m => console.log(m[0].padEnd(4) + m[1].padEnd(16) + m[2])); return 0; }
  const want = args.filter(a => !a.startsWith('--'));
  const pg = !!process.env.PPP_TEST_PG_URL;
  const chosen = M.filter(m => (!want.length || want.indexOf(m[0]) > -1) && (m[4] !== PG || pg));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-guest-post-mut-'));
  let bad = 0;
  try {
    const clean = path.join(root, 'clean');
    copyTo(clean);
    const base = run(TEST, clean);
    console.log((base.code === 0 ? 'ok    ' : 'FAIL  ') + 'the unmutated copy passes ' + TEST);
    if (base.code !== 0) { console.log(base.out.split('\n').filter(l => /✗/.test(l)).slice(0, 5).join('\n')); return 1; }
    for (const m of chosen) {
      const dir = path.join(root, m[0]);
      copyTo(dir);
      const file = path.join(dir, m[1]);
      const pairs = Array.isArray(m[3][0]) ? m[3] : [m[3]];
      fs.writeFileSync(file, mutate(m[1], fs.readFileSync(file, 'utf8'), pairs));
      const r = run(m[4], dir);
      const killed = r.code !== 0;
      if (!killed) bad++;
      const first = r.out.split('\n').find(l => /✗/.test(l)) || '';
      console.log((killed ? 'killed ' : 'SURVIVED ') + m[0].padEnd(4) + m[2] + (killed ? '   <- ' + first.trim().slice(0, 110) : ''));
    }
  } finally { try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* temp */ } }
  console.log(bad ? '\n' + bad + ' mutant(s) survived' : '\nevery mutant was killed');
  return bad ? 1 : 0;
}

process.exit(main());
