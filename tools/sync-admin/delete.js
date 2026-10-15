#!/usr/bin/env node
/* G13-S0: delete ONE song library by its id - it removes a person's songs from the server, so it does nothing without --confirm.

     node tools/sync-admin/delete.js --id lib_<22 hex> [--url postgres://...] [--allow-remote] [--confirm]

   Without --confirm it says what it would delete (the counts) and exits 3. With it, one statement removes the library's items and its row. The id comes from list.js. The server
   holds the libraries in memory and reads them once per boot: restart it afterwards (its next write to that library is refused as not valid meanwhile). The device copy of every
   person's songs and their backup file are not touched. It refuses a database that is not on this machine unless --allow-remote is given.

   Exit: 0 deleted, 2 refused (usage, a remote database), 3 needs --confirm, 1 the database failed. */
'use strict';
const A = require('./lib');

async function main() {
  const { flags } = A.parseArgs(process.argv.slice(2));
  if (typeof flags.id !== 'string' || !A.LIB_ID.test(flags.id)) { console.error('Name the library with --id lib_<22 hex> (list.js shows them).'); return 2; }
  let conn;
  try { conn = A.connection(flags, process.env); } catch (e) { console.error(e.message); return e.exit || 2; }
  const pool = A.pool(conn);
  try {
    const found = (await pool.query('SELECT l.id, l.bytes::bigint AS bytes, l.items, l.tombs, l.last_used_at, l.revoked_at, (SELECT count(*) FROM ppp_sync_items i WHERE i.lib_id = l.id)::int AS rows FROM ppp_sync_libs l WHERE l.id = $1', [flags.id])).rows[0];
    if (!found) { console.error('No library ' + flags.id + ' in ' + conn.host + '.'); return 2; }
    const what = flags.id + ': ' + A.mb(found.bytes) + ' MB, ' + found.items + ' items, ' + found.tombs + ' tombstones, ' + found.rows + ' rows, last used ' + A.iso(found.last_used_at) + (found.revoked_at ? ', revoked' : '');
    if (flags.confirm !== true) {
      console.log('Would delete ' + what + ' in ' + conn.host + '.');
      console.log('Nothing was changed. Run again with --confirm to delete it.');
      return 3;
    }
    const r = await pool.query('WITH i AS (DELETE FROM ppp_sync_items WHERE lib_id = $1 RETURNING 1) DELETE FROM ppp_sync_libs WHERE id = $1', [flags.id]);
    console.log('Deleted ' + what + ' (' + (r.rowCount || 0) + ' library row). Restart the server so that it reads the libraries again.');
    return 0;
  } catch (e) {
    console.error('could not delete: ' + String(e && e.message).split('\n')[0].replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://...'));
    return 1;
  } finally { await pool.end().catch(() => {}); }
}

main().then(code => { process.exitCode = code; });
