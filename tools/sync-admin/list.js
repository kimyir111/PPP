#!/usr/bin/env node
/* G13-S0: the song libraries of a database, by size - READ ONLY.

     node tools/sync-admin/list.js [--url postgres://...] [--allow-remote] [--json]

   One row per library: its id (a one-way hash of its code: not a secret), size (accounted bytes: what the cap counts), live items and tombstones, the revision, when it was made and
   last used, whether it was deleted or given a new code, and the keyed tag of the address it was made from (a hash that cannot be turned back into an address; libraries with the same
   tag were made from the same address). Then the totals and, per address tag, what that address holds against the cap of 48 MB.

   It reads no item, no key, no body and no hash of a code. It writes nothing. It refuses a database that is not on this machine unless --allow-remote is given. */
'use strict';
const A = require('./lib');

async function main() {
  const { flags } = A.parseArgs(process.argv.slice(2));
  let conn;
  try { conn = A.connection(flags, process.env); } catch (e) { console.error(e.message); return e.exit || 2; }
  const pool = A.pool(conn);
  try {
    const libs = (await pool.query(
      'SELECT id, created_ip_tag AS address, created_at, last_used_at, revoked_at, rotated_from IS NOT NULL AS from_rotation, bytes::bigint AS bytes, items, tombs, max_rev::bigint AS max_rev, purged_through::bigint AS purged_through,'
      + ' recovery_hash IS NOT NULL AS has_recovery FROM ppp_sync_libs ORDER BY bytes DESC, created_at')).rows;
    const live = libs.filter(l => !l.revoked_at);
    const total = live.reduce((o, l) => ({ bytes: o.bytes + Number(l.bytes), items: o.items + l.items, tombs: o.tombs + l.tombs }), { bytes: 0, items: 0, tombs: 0 });
    const byAddress = {};
    live.forEach(l => { const a = byAddress[l.address] = byAddress[l.address] || { libs: 0, bytes: 0 }; a.libs++; a.bytes += Number(l.bytes); });
    if (flags.json === true) {
      console.log(JSON.stringify({
        libraries: libs.map(l => ({ id: l.id, address: l.address, createdAt: l.created_at, lastUsedAt: l.last_used_at, revokedAt: l.revoked_at, fromRotation: l.from_rotation, bytes: Number(l.bytes), items: l.items, tombs: l.tombs,
          maxRev: Number(l.max_rev), purgedThrough: Number(l.purged_through), hasRecovery: l.has_recovery })),
        totals: Object.assign({ libraries: live.length }, total), byAddress: byAddress
      }, null, 2));
      return 0;
    }
    console.log('database: ' + conn.host + (conn.remote ? ' (remote)' : ' (this machine)'));
    console.log('id                          MB      items tombs  rev    made                 last used            address          state');
    libs.forEach(l => {
      console.log(l.id.padEnd(27) + ' ' + A.mb(l.bytes).padStart(6) + ' ' + String(l.items).padStart(6) + ' ' + String(l.tombs).padStart(5) + ' ' + String(l.max_rev).padStart(5) + '  ' + A.iso(l.created_at) + '  '
        + A.iso(l.last_used_at) + '  ' + String(l.address || '-').padEnd(16) + ' ' + (l.revoked_at ? 'revoked ' + A.iso(l.revoked_at) : l.from_rotation ? 'new code' : 'live'));
    });
    console.log('');
    console.log('live libraries: ' + live.length + ', ' + A.mb(total.bytes) + ' MB, ' + total.items + ' items, ' + total.tombs + ' tombstones');
    const top = Object.keys(byAddress).sort((a, b) => byAddress[b].bytes - byAddress[a].bytes).slice(0, 10);
    if (top.length) {
      console.log('by address tag (the cap is 48 MB each):');
      top.forEach(a => console.log('  ' + String(a || '-').padEnd(16) + ' ' + String(byAddress[a].libs).padStart(3) + ' libraries ' + A.mb(byAddress[a].bytes).padStart(7) + ' MB'));
    }
    return 0;
  } catch (e) {
    console.error('could not read the libraries: ' + String(e && e.message).split('\n')[0].replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://...'));
    return 1;
  } finally { await pool.end().catch(() => {}); }
}

main().then(code => { process.exitCode = code; });
