#!/usr/bin/env node
/* G13 no login: a small READ-ONLY look at the posts that guests have put into the public Shared Scores, so the owner can see growth.
   LOCAL USE, by a person: nothing runs it by itself, and the Lead runs it against production only with the owner's word.

     node tools/shares-admin/list.js --data-dir <dir>                 a local data directory (the file store: shares.json)
     DATABASE_URL=postgres://... node tools/shares-admin/list.js      a Postgres (a throwaway one, or the owner's: see --allow-remote)

   Options:  --all           every guest row (links too), not only the posts
             --json          the same as JSON, for a script
             --allow-remote  needed when the database is not on this machine (so an environment variable left in a shell cannot point it at the live site by accident)
             --db-url <url>  instead of DATABASE_URL (it is never printed)

   What it prints, for each row: the share id, the KEY TAG (the first 8 hex of the one-way name of the browser key: not the key, which the server never has),
   the ADDRESS TAG (the first 8 hex of the keyed hash of the address the post came from: not the address), created, updated, when it ends, bytes and bars.
   Then the totals against the caps (share-guest.js GUEST) and the busiest key tags and address tags.
   It prints NO title, composer, score or name: it says how much, from whom (as tags) and since when, not what. To look at a post, open it in the page.
   It changes nothing: a Postgres is read inside a READ ONLY transaction, the file is only read. */
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('../../share-guest').GUEST;

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : ''; };

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node tools/shares-admin/list.js --data-dir <dir>   |   DATABASE_URL=... node tools/shares-admin/list.js [--allow-remote] [--all] [--json]');
  process.exit(2);
}

/* a row of the file store or of ppp_shares, reduced to what may be shown */
function shown(r) {
  const iso = v => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
  const owner = String(r.ownerId || r.owner_id || '');
  return {
    id: r.id,
    keyTag: owner.replace(/^g_/, '').slice(0, 8),
    addrTag: (r.addrTag || r.addr_tag || '').slice(0, 8) || null,
    listed: !!r.listed,
    created: iso(r.createdAt || r.created_at),
    updated: iso(r.updatedAt || r.updated_at),
    expires: iso(r.expiresAt || r.expires_at),
    bytes: Number(r.bytes) || 0,
    bars: Number(r.measures) || 0
  };
}

async function fromFile(dir) {
  const file = path.join(path.resolve(dir), 'shares.json');
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { usage('cannot read ' + file + ': ' + e.message); }
  return (doc.shares || []).filter(r => /^g_[0-9a-f]{24}$/.test(String(r.ownerId || ''))).map(shown);
}

async function fromPostgres(url, allowRemote) {
  let host = '';
  try { host = new URL(url).hostname; } catch (e) { usage('that is not a database URL'); }
  const local = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(host);
  if (!local && !allowRemote) usage('refusing: the database is not on this machine (' + host.replace(/^[^.]+/, '***') + '). Pass --allow-remote only with the owner\'s word.');
  const { Client } = require('pg');
  const c = new Client({ connectionString: url, ssl: /render\.com|neon\.tech|sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    /* the columns named are the whole list: nothing of the score, preview or title is read */
    const r = await c.query("SELECT id, owner_id, listed, created_at, updated_at, expires_at, bytes, measures, addr_tag FROM ppp_shares WHERE owner_id LIKE 'g\\_%' ORDER BY created_at DESC");
    await c.query('ROLLBACK');
    return r.rows.map(shown);
  } finally { await c.end(); }
}

function tally(rows, key) {
  const m = new Map();
  rows.forEach(r => { if (r[key]) m.set(r[key], (m.get(r[key]) || 0) + 1); });
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10);
}

async function main() {
  const dir = opt('--data-dir');
  const url = opt('--db-url') || process.env.DATABASE_URL || '';
  if (!dir && !url) usage('no data directory and no DATABASE_URL');
  const everything = dir ? await fromFile(dir) : await fromPostgres(url, flag('--allow-remote'));
  const live = everything.filter(r => !(r.expires && Date.parse(r.expires) <= Date.now()));
  const posts = live.filter(r => r.listed);
  const rows = flag('--all') ? live : posts;
  const sum = list => list.reduce((n, r) => n + r.bytes, 0);
  const report = {
    readOnly: true, at: new Date().toISOString(),
    caps: { posts: G.TOTAL_LISTED, postBytes: G.TOTAL_LISTED_BYTES, perKey: G.PER_GUEST_LISTED, perAddress: G.PER_ADDR_LISTED, rows: G.TOTAL_SHARES, rowBytes: G.TOTAL_BYTES },
    guestRows: live.length, guestBytes: sum(live), posts: posts.length, postBytes: sum(posts),
    topKeys: tally(posts, 'keyTag'), topAddresses: tally(posts, 'addrTag'),
    rows: rows
  };
  if (flag('--json')) { console.log(JSON.stringify(report, null, 2)); return; }
  const mb = n => (n / 1048576).toFixed(1) + ' MB';
  console.log('shares-admin (read-only) ' + report.at);
  console.log('posts in the public list from guests: ' + report.posts + ' of ' + G.TOTAL_LISTED + ' allowed, ' + mb(report.postBytes) + ' of ' + mb(G.TOTAL_LISTED_BYTES));
  console.log('all guest rows (links and posts):     ' + report.guestRows + ' of ' + G.TOTAL_SHARES + ' allowed, ' + mb(report.guestBytes) + ' of ' + mb(G.TOTAL_BYTES));
  console.log('busiest key tags:     ' + (report.topKeys.map(x => x[0] + ' x' + x[1]).join(', ') || '-'));
  console.log('busiest address tags: ' + (report.topAddresses.map(x => x[0] + ' x' + x[1]).join(', ') || '-'));
  console.log('');
  console.log('id            key tag   addr tag  ' + (flag('--all') ? 'listed  ' : '') + 'created                   ends                      bytes   bars');
  rows.forEach(r => console.log([
    String(r.id).padEnd(13), r.keyTag.padEnd(9), String(r.addrTag || '-').padEnd(9), flag('--all') ? (r.listed ? 'yes     ' : 'no      ') : '',
    String(r.created || '').slice(0, 25).padEnd(25), String(r.expires || '').slice(0, 25).padEnd(25), String(r.bytes).padStart(7), String(r.bars).padStart(5)
  ].join(' ')));
}

main().catch(e => { console.error('shares-admin failed: ' + String(e && e.message || e).replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://...')); process.exit(1); });
