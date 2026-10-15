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
const PAGE_FILE = 'Piano Coach App.dc.html';
/* id, file, what the mutant breaks, [from, to] or [[from, to], ...] (each replaced once), the test that must fail */
const M = [
  ['L1', 'share-guest.js', 'a browser may post 500 times a day, not 5', ['POST_PER_KEY_PER_DAY: 5,', 'POST_PER_KEY_PER_DAY: 500,'], TEST],
  ['L2', 'share-guest.js', 'an address may post 1000 times a day, not 10', ['POST_PER_IP_PER_DAY: 10,', 'POST_PER_IP_PER_DAY: 1000,'], TEST],
  ['L4', 'share-guest.js', 'a browser holds 1000 posts at once, not 10', ['PER_GUEST_LISTED: 10,', 'PER_GUEST_LISTED: 1000,'], TEST],
  ['L5', 'share-guest.js', 'an address holds 2000 posts at once, not 20', ['PER_ADDR_LISTED: 20,', 'PER_ADDR_LISTED: 2000,'], TEST],
  ['L6', 'share-guest.js', 'the site holds 30000 posts, not 300', ['TOTAL_LISTED: 300,', 'TOTAL_LISTED: 30000,'], TEST],
  ['L7', 'share-guest.js', 'the posts may hold 2.4 GB, not 24 MB', ['TOTAL_LISTED_BYTES: 24 * 1024 * 1024,', 'TOTAL_LISTED_BYTES: 2400 * 1024 * 1024,'], TEST],
  ['L8', 'share-guest.js', 'a post ends in 30 days like a link, not 90', ['TTL_LISTED_MS: 90 * 24 * 60 * 60 * 1000,', 'TTL_LISTED_MS: 30 * 24 * 60 * 60 * 1000,'], TEST],
  ['L9', 'share-guest.js', 'a body may be 100 MB, not 1 MB', ['MAX_BYTES: 1024 * 1024,', 'MAX_BYTES: 100 * 1024 * 1024,'], TEST],
  ['L10', 'share-guest.js', 'a re-sent post is held to the counts of a new post (or: a new one is not held to them)', ["const wasListed = !!(prev && prev.listed);\n    if (!wasListed) {", "const wasListed = false;\n    if (!wasListed) {"], TEST],
  ['L11', 'share-guest.js', 'a post that would pass the bytes of all posts is accepted', ['if (listing.totalListedBytes - (wasListed ? (prev.bytes || 0) : 0) + newBytes > GUEST.TOTAL_LISTED_BYTES) return', 'if (false) return'], TEST],
  ['L12', 'share-guest.js', 'a full list evicts nothing, but a full list is no longer refused (the 301st is accepted)', ["if (listing.totalListed >= GUEST.TOTAL_LISTED) return { status: 503, code: 'busy', error: BUSY };", ''], TEST],
  ['N2', 'share-guest.js', 'a name may be any length', ['NAME_MAX: 24', 'NAME_MAX: 2400'], TEST],
  ['O1', 'server.js', 'a guest key that does not own a row may change it (PATCH, DELETE)', ['guestShare.sameOwner(guestId, row.ownerId);\n  if (!userOwns && !guestOwns)', 'true;\n  if (!userOwns && !guestOwns)'], TEST],
  ['O2', 'server.js', 'anyone may change a guest\'s row', ["if (!userOwns && !guestOwns) return jsonError(res, 403, 'Only the person who shared it can change that.');", ''], TEST],
  ['O3', 'server.js', 'the guest key is also read from the URL', ["const guestId = guestShare.guestOwnerId(typeof guestHeader === 'string' ? guestHeader : '');", "const guestId = guestShare.guestOwnerId(typeof guestHeader === 'string' ? guestHeader : String(url.searchParams.get('guest') || ''));"], TEST],
  ['O4', 'server.js', 'the list card carries the owner id', ["if (guestShare.isGuestOwner(row.ownerId)) card.guest = true;", "if (guestShare.isGuestOwner(row.ownerId)) { card.guest = true; card.ownerId = row.ownerId; }"], TEST],
  ['O5', 'server.js', '"mine" ignores the guest key', ["ownerIds: mine ? [user && user.id, guestId].filter(Boolean) : null,", "ownerIds: mine ? [user && user.id].filter(Boolean) : null,"], TEST],
  ['Y1', 'server.js', 'a guest may post a YouTube-derived score to the list (POST)', ["if (body.listed === true && youtubeDerivedShare(body.score, body.youtubeDerived)) {\n      return refuse(", "if (!guest && body.listed === true && youtubeDerivedShare(body.score, body.youtubeDerived)) {\n      return refuse("], TEST],
  ['Y2', 'server.js', 'a YouTube-derived link may be put into the list afterwards (PATCH)', ["if (body.listed === true && !row.listed && youtubeDerivedShare(row.score, false)) {", "if (false) {"], TEST],
  ['R3', 'server.js', 'a refused post keeps the places of the day it took', ["guestLimits.ip.release(ip); guestLimits.all.release('all'); releasePost();\n        guestLimits.fails.take(ip);", "guestLimits.ip.release(ip); guestLimits.all.release('all');\n        guestLimits.fails.take(ip);"], TEST],
  ['S1', 'server.js', 'the file store lists a guest row past its end date', ["const rows = loadShares().filter(r => !guestShare.expired(r, nowMs) && (owners ? owners.indexOf(r.ownerId) > -1 : r.listed));", "const rows = loadShares().filter(r => (owners ? owners.indexOf(r.ownerId) > -1 : r.listed));"], TEST],
  ['S2', 'server.js', 'a taken-down post keeps its address tag', ["      } else row.addrTag = null;\n      rows = rows.filter(r => r.id !== id);", "      }\n      rows = rows.filter(r => r.id !== id);"], TEST],
  ['S3', 'server.js', 'a link put into the list skips the caps of a new post', ["const refuse = guestShare.decide(prev, held.mine, held.usage, prev.bytes || 0, guestListing(guests, ownerId, row.addrTag));", "const refuse = null;"], TEST],
  ['S4', 'server.js', 'a post is not tagged with its address in the file store (the per-address cap counts nothing)', ["r.addrTag = listed ? guestAddrTagOf(ip) : null; }", "r.addrTag = null; }"], TEST],
  ['S5', 'server.js', 'the post caps are not asked when a post is made (POST)', ["const refuse = guestShare.decide(prev, held.mine, held.usage, row.bytes, row.listed ? guestListing(guests, ownerId, row.addrTag) : null);", "const refuse = guestShare.decide(prev, held.mine, held.usage, row.bytes, null);"], TEST],
  ['L3', 'share-guest.js', 'the site takes 15000 posts a day, not 150', ['POST_GLOBAL_PER_DAY: 150,', 'POST_GLOBAL_PER_DAY: 15000,'], TEST],
  ['N1', 'share-guest.js', 'a name passes for the site when it is not at the start ("The PPP team")', ["NOT_A_GUEST_KEYS.some(w => key.indexOf(w) > -1)", "NOT_A_GUEST_KEYS.some(w => key.indexOf(w) === 0)"], TEST],
  ['N1b', 'share-guest.js', 'look-alike letters (Cyrillic, Greek) are not folded', [".replace(/[\u0370-\u03ff\u0400-\u04ff\u0250-\u02af\u0131]/g, c => LOOKALIKE[c] || c);", ";"], TEST],
  ['N1c', 'share-guest.js', 'fullwidth and styled letters are not folded (no NFKC)', ["let t = String(s == null ? '' : s).normalize('NFKC').normalize('NFD')", "let t = String(s == null ? '' : s).normalize('NFD')"], TEST],
  ['N1d', 'share-guest.js', 'the owner\'s and the staff\'s names are not on the list (admin, support, ...)', ["'admin', 'administrator', 'moderator', 'support', 'official', 'staff', 'owner', 'system', 'operator', 'webmaster', 'helpdesk',", ""], TEST],
  ['N1e', 'share-guest.js', 'zalgo: any number of combining marks is kept', ["replace(/(\\p{M}{2})\\p{M}+/gu, '$1')", "replace(/(\\p{M}{200})\\p{M}+/gu, '$1')"], TEST],
  ['N3', 'share-guest.js', 'bidi overrides and controls are kept in text', ["const INVISIBLE = /[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff\\ufff9-\\ufffb]/g;", "const INVISIBLE = /[\\u0000-\\u0008]/g;"], TEST],
  ['T1', 'server.js', 'a title is only trimmed, not cleaned, on the way in', ["const title = guestShare.cleanText(body.title || body.score.title, 120);", "const title = clipText(body.title || body.score.title, 120);"], TEST],
  ['T2', 'server.js', 'what the list shows is not cleaned on the way out', ["id: row.id, title: T(row.title, 120), composer: T(row.composer, 160), kind: T(row.kind, 24), genre: T(row.genre || '', 32),\n    measures: row.measures, owner: T(row.ownerName, 160), mine: mine,", "id: row.id, title: row.title, composer: row.composer, kind: row.kind, genre: row.genre || '',\n    measures: row.measures, owner: row.ownerName, mine: mine,"], TEST],
  ['T3', 'server.js', 'the score\'s own title and composer are not cleaned', ["    guestShare.cleanScore(body.score);\n", ""], TEST],
  ['V1', 'server.js', 'the preview is stored as it was sent (not rebuilt on the way in)', ["const np = guestShare.normalizePreview(body.preview, 4);\n        if (!np) return refuse(422, 'That is not a score PPP can share.');", "const np = body.preview;\n        if (!np) return refuse(422, 'That is not a score PPP can share.');"], TEST],
  ['V2', 'server.js', 'the preview is handed out as it was stored (not rebuilt on the way out)', ["preview: row.preview ? guestShare.normalizePreview(row.preview, 4) : null,", "preview: row.preview || null,"], TEST],
  ['V3', 'share-guest.js', 'staves is whatever was sent', ["out.staves = Math.max(int(raw.staves, 1, 4, 1), maxStaff);", "out.staves = raw.staves;"], TEST],
  ['V4', 'share-guest.js', 'a note\'s staff is whatever was sent', ["o.staff = int(n.staff, 1, 4, 1);", "o.staff = n.staff;"], TEST],
  ['V5', 'share-guest.js', 'a preview may hold any number of notes', ["if (notes.length >= L.NOTES) break;", ""], TEST],
  ['V6', 'share-guest.js', 'a preview may hold any number of bars', ["raw.measures.slice(0, maxM).forEach(", "raw.measures.forEach("], TEST],
  ['V7', 'share-guest.js', 'a number is not bounded (1e9 passes)', ["if (typeof v === 'number') return fin(v) ? Math.min(L.NUMBER, Math.max(-L.NUMBER, v)) : null;", "if (typeof v === 'number') return fin(v) ? v : null;"], TEST],
  ['V8', 'share-guest.js', 'a preview that is not a preview is let through', ["if (!isObj(raw) || !Array.isArray(raw.measures) || !Array.isArray(raw.notes)) return null;", ""], TEST],
  ['V9', 'share-guest.js', 'nesting is not bounded', ["if (depth >= L.DEPTH) return null;", ""], TEST],
  ['V10', 'share-guest.js', 'a score\'s staves and staff numbers are not bounded', ["if (score.staves !== undefined) score.staves = staff(score.staves);", ""], TEST],
  ['A1', 'server.js', 'the hourly and posting windows count the raw address, not the /48 (POST)', ["ip = homeJobs.addrKey(who.ip || 'unknown');", "ip = who.ip || 'unknown';"], TEST],
  ['A2', 'server.js', 'putting a link into the list counts the raw address (PATCH)', ["const guestPlaceOf = req => homeJobs.addrKey(guestShare.clientAddress(req).ip || 'unknown');", "const guestPlaceOf = req => guestShare.clientAddress(req).ip || 'unknown';"], TEST],
  ['R1', 'server.js', 'a post takes no place of the browser\'s day (POST)', ["const why = takeGuestPost(ip, guestId, free);\n        if (why) return { refuse: why };\n        postTaken = !free;", "const why = null;\n        if (why) return { refuse: why };\n        postTaken = !free;"], TEST],
  ['R2', 'server.js', 'putting a link into the list takes no place of the day (PATCH)', ["const why = takeGuestPost(ip, guestId, free);\n        if (why) return jsonError(res, why.status, why.error, { code: why.code });", "const why = null;\n        if (why) return jsonError(res, why.status, why.error, { code: why.code });"], TEST],
  ['R5', 'server.js', 'a post sent again (or a link re-sent while its post stands) asks the limits as a new post', ["if (guest && listed && !wasListed) {", "if (guest && listed) {"], TEST],
  ['R6', 'server.js', 'a post put back the same day takes a new place (POST)', ["const free = guestShare.recentlyListed(prev, nowMs);\n        const why = takeGuestPost(ip, guestId, free);\n        if (why) return { refuse: why };", "const free = false;\n        const why = takeGuestPost(ip, guestId, free);\n        if (why) return { refuse: why };"], TEST],
  ['R7', 'server.js', 'a post put back the same day takes a new place (PATCH)', ["const free = guestShare.recentlyListed(row, Date.now());", "const free = false;"], TEST],
  ['R8', 'share-guest.js', 'every row counts as recently listed (a link too)', ["return Number.isFinite(t) && t - nowMs > GUEST.TTL_LISTED_MS - GUEST.DAY_MS;", "return Number.isFinite(t);"], TEST],
  ['E1', 'server.js', 'no SESSION_SECRET on Render: guest posting is on', ["if (process.env.PPP_GUEST_POSTS === '0' || GUEST_POSTS_NO_SECRET) return {", "if (process.env.PPP_GUEST_POSTS === '0') return {"], TEST],
  ['K1', 'server.js', 'the owner\'s switch does nothing', ["if (process.env.PPP_GUEST_POSTS === '0' || GUEST_POSTS_NO_SECRET) return {", "if (GUEST_POSTS_NO_SECRET) return {"], TEST],
  ['H1', 'tools/shares-admin/list.js', 'a host in the query string is not looked at (?host=)', ["['host', 'hostaddr'].forEach(k => qs.getAll(k).forEach(", "[].forEach(k => qs.getAll(k).forEach("], TEST],
  ['G1', PAGE_FILE, 'the page draws a preview as it came (thumbSafe is not used)', ["const safe = full && full.measures && full.measures.length ? this.thumbSafe(full, bars) : null;", "const safe = full && full.measures && full.measures.length ? JSON.parse(JSON.stringify(full)) : null;"], 'shared-poison-ui.test.js'],
  ['G2', PAGE_FILE, 'the page\'s copy lets a staff number through', ["      o.staff = int(n.staff, 1, 4, 1);\n      o.dots = int(n.dots, 0, 4, 0);\n      if (o.staff > maxStaff)", "      o.staff = n.staff;\n      o.dots = int(n.dots, 0, 4, 0);\n      if (o.staff > maxStaff)"], TEST],
  ['G3', PAGE_FILE, 'the page\'s copy lets the staves through', ["    out.staves = Math.max(int(raw.staves, 1, 4, 1), maxStaff);\n    out.measures = measures;", "    out.staves = raw.staves;\n    out.measures = measures;"], TEST],
  ['G4', PAGE_FILE, 'a score added from a link keeps its staves as they were sent', ["try { score = Score.finalize(this.scoreSafe(JSON.parse(JSON.stringify(row.score)))); }", "try { score = Score.finalize(JSON.parse(JSON.stringify(row.score))); }"], 'shared-poison-ui.test.js'],
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

function run(test, srcDir, pageFile, pageMutant) {
  const r = spawnSync(process.execPath, [path.join(REPO, 'tests', test)], {
    cwd: REPO, env: Object.assign({}, process.env, { PPP_SRC_DIR: srcDir }, pageFile ? { PPP_PAGE_FILE: pageFile } : {}, pageMutant ? { PPP_PAGE_MUTANT: pageMutant } : {}), encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024
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
      const pairs = Array.isArray(m[3][0]) ? m[3] : [m[3]];
      let pageFile = null;
      if (m[1] === PAGE_FILE) {
        /* a mutant of the page: a copy of it that the test reads (PPP_PAGE_FILE); the browser test serves this tree's own server, so the other page mutant is read from the repo */
        pageFile = path.join(dir, 'page-mutant.html');
        fs.writeFileSync(pageFile, mutate(m[1], fs.readFileSync(path.join(REPO, PAGE_FILE), 'utf8'), pairs));
      } else {
        const file = path.join(dir, m[1]);
        fs.writeFileSync(file, mutate(m[1], fs.readFileSync(file, 'utf8'), pairs));
      }
      const r = run(m[4], dir, pageFile, m[1] === PAGE_FILE ? JSON.stringify(pairs) : null);
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
