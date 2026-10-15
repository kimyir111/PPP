/* G13-S0 (docs/GOALS/G13_PRODUCTIZATION.md section 7, "as built" in 7.9): where the song libraries of "use my songs on other devices" are kept (the rules are in sync.js).

   Two stores with the same methods: a Postgres one (production; `query(sql, params)` is the pool's) and a file one (a local server and the tests: data/sync.json).
   The service keeps the LIBRARIES (a few hundred bytes each, at most 2,000) in memory with their counters and the highest revision, and calls the store only to make
   a change durable, to read what was there once after a boot (loadAll), and to read items; the bodies are never in memory. An idle poll calls none of them.

   A library is a row named by a one-way hash of a secret code the person's devices keep (ppp_sync_libs.id = 'lib_' + 22 hex of sha256('ppp-lib-v1:' + code); the hash
   itself is client_hash; recovery_hash is the hash of a second code, shown once, that can only give the library a new code). An item is one song (key 'song:<id>') or the cross-song progress (key 'state'): a gzip JSON body (BYTEA, never JSONB: 3-10x the bytes, and Neon's
   egress counts them), the revision the library had when it was written (one counter per library), a tombstone (deleted_at, body NULL) for a deletion.

   Every change is ONE statement that names the library in its WHERE and re-checks the revision it was based on, so a library can only change its own rows, an item can
   only be written over the revision the writer saw, and a revision never goes backwards, whatever the caller got wrong (and whatever a second instance did: the service is
   written for ONE instance, as the PC queue is, but no row is ever lost to a stale decision). Every statement is parameterized.

   Counters. bytes is the library's ACCOUNTED size: every row (live or tombstone) counts ROW_OVERHEAD plus, when live, its body; items is the live rows, tombs the tombstones
   (rows = items + tombs). They are changed in the same statement as the rows, so they cannot differ from them for one instance. Times are milliseconds since the epoch here,
   TIMESTAMPTZ in the database. A library is
     { id, hash (sha256 of 'ppp-lib-v1:' + code, hex), createdAt, lastUsedAt, ipTag (a KEYED hash of the creating address, never the address), revokedAt, rotatedFrom,
       bytes, items, tombs, maxRev, purgedThrough (the highest revision of a tombstone that was purged: a device whose last-seen revision is below it may have missed a deletion),
       recoveryHash }
   and an item's metadata { key, rev, deleted, deletedAt, hash, bytes, device, updatedAt }. */
'use strict';
const fs = require('fs');
const path = require('path');

/* what a row costs besides its body, in the library's accounting: a few hundred bytes of row, index and TOAST pointer, so that 300,000 one-byte items cannot dodge a byte cap */
const ROW_OVERHEAD = 256;
/* the advisory lock of this migration (727001 is the guest-link creates', 727002 the queue's) */
const SYNC_LOCK_KEY = 727003;

/* Additive and idempotent: CREATE ... IF NOT EXISTS only (no ALTER, DROP, DELETE or UPDATE), no foreign key to ppp_users (a library is not an account) and none between
   the two tables (a library is deleted with its items by ONE statement, and an item no library names cannot be read: the boot read counts them and the purge deletes them).
   The code before this boots on a database that has them and never touches them. They are made only when the server runs with PPP_SYNC=1 (server.js), inside a transaction
   under an advisory lock and a savepoint: a failure there switches the feature off and leaves everything else as it was (migrate below). */
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS ppp_sync_libs (
    id TEXT PRIMARY KEY,
    client_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_ip_tag TEXT NOT NULL DEFAULT '',
    revoked_at TIMESTAMPTZ,
    rotated_from TEXT,
    bytes BIGINT NOT NULL DEFAULT 0,
    items INTEGER NOT NULL DEFAULT 0,
    tombs INTEGER NOT NULL DEFAULT 0,
    max_rev BIGINT NOT NULL DEFAULT 0,
    purged_through BIGINT NOT NULL DEFAULT 0,
    recovery_hash TEXT
  );
  CREATE INDEX IF NOT EXISTS ppp_sync_libs_created ON ppp_sync_libs (created_at);
  CREATE TABLE IF NOT EXISTS ppp_sync_items (
    lib_id TEXT NOT NULL,
    key TEXT NOT NULL,
    rev BIGINT NOT NULL,
    deleted_at TIMESTAMPTZ,
    content_hash TEXT,
    device TEXT NOT NULL DEFAULT '',
    bytes INTEGER NOT NULL DEFAULT 0,
    body BYTEA,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lib_id, key)
  );
  CREATE INDEX IF NOT EXISTS ppp_sync_items_rev ON ppp_sync_items (lib_id, rev);
  CREATE INDEX IF NOT EXISTS ppp_sync_items_tomb ON ppp_sync_items (deleted_at) WHERE deleted_at IS NOT NULL;
`;

/* the tables of this feature are made by their own transaction, under their own advisory lock and a savepoint: two instances booting together take turns (a CREATE TABLE IF NOT
   EXISTS from two sessions can fail on pg_type's unique index), and a failure (a name taken by something else, a role that may not create tables) undoes only this part and is
   told to the caller, which switches the feature off: { ok: true } or { ok: false, error }. A connection that is lost is still thrown. */
async function migrate(pool) {
  const c = await pool.connect();
  let broken = false;
  const onError = () => { broken = true; };
  c.on('error', onError);
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock($1)', [SYNC_LOCK_KEY]);
    let out = { ok: true };
    await c.query('SAVEPOINT sync_tables');
    try {
      await c.query(SCHEMA_SQL);
      await c.query('RELEASE SAVEPOINT sync_tables');
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT sync_tables');
      out = { ok: false, error: e };
    }
    await c.query('COMMIT');
    return out;
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (e2) { broken = true; }
    throw err;
  } finally {
    c.removeListener('error', onError);
    c.release(broken || undefined);
  }
}

const ms = v => (v == null ? 0 : (v instanceof Date ? v.getTime() : Date.parse(v)) || 0);
const at = t => new Date(t);
const num = v => (v == null ? 0 : Number(v));

const LIB_COLS = 'id, client_hash, created_at, last_used_at, created_ip_tag, revoked_at, rotated_from, bytes, items, tombs, max_rev, purged_through, recovery_hash';
const META_COLS = 'key, rev, deleted_at, content_hash, bytes, device, updated_at';

function libOfRow(r) {
  return {
    id: r.id, hash: r.client_hash, createdAt: ms(r.created_at), lastUsedAt: ms(r.last_used_at), ipTag: r.created_ip_tag || '', revokedAt: ms(r.revoked_at),
    rotatedFrom: r.rotated_from || '', bytes: num(r.bytes), items: r.items | 0, tombs: r.tombs | 0, maxRev: num(r.max_rev), purgedThrough: num(r.purged_through), recoveryHash: r.recovery_hash || ''
  };
}
function metaOfRow(r) {
  return { key: r.key, rev: num(r.rev), deleted: r.deleted_at != null, deletedAt: ms(r.deleted_at), hash: r.content_hash || r.hash || '', bytes: r.bytes | 0, device: r.device || '', updatedAt: ms(r.updated_at) };
}
/* the library's counters out of a row of the statements below (its bytes column is lbytes there: bytes is the item's) */
const countersOf = r => ({ maxRev: num(r.max_rev), bytes: num(r.lbytes), items: r.items | 0, tombs: r.tombs | 0 });

/* ---------------- Postgres ---------------- */
function pgSyncStore(query) {
  const rowsOf = r => (r && r.rows) || [];
  const R = ROW_OVERHEAD;
  return {
    kind: 'pg',
    /* the one read of a boot, one round trip: every library (a few hundred rows at most), the oldest tombstone of each library that has one, and how many item rows no
       library names (none, unless a table was changed by hand: the service deletes them at its first purge) */
    async loadAll() {
      const r = await query(
        'SELECT ' + LIB_COLS + ' FROM ppp_sync_libs;'
        + ' SELECT lib_id, min(deleted_at) AS oldest FROM ppp_sync_items WHERE deleted_at IS NOT NULL GROUP BY lib_id;'
        + ' SELECT count(*)::int AS n FROM ppp_sync_items i WHERE NOT EXISTS (SELECT 1 FROM ppp_sync_libs l WHERE l.id = i.lib_id);');
      const parts = Array.isArray(r) ? r : [r];
      const tombs = {};
      rowsOf(parts[1]).forEach(x => { tombs[x.lib_id] = ms(x.oldest); });
      const orphan = rowsOf(parts[2])[0];
      return { libs: rowsOf(parts[0]).map(libOfRow), tombs: tombs, orphanItems: orphan ? (orphan.n | 0) : 0 };
    },
    /* a new library: ONE statement, refused (false) when the site already holds `maxLive` live ones - the guard of the cap, in the statement, so two writers cannot pass it together */
    async createLib(l, maxLive) {
      const r = await query(
        'INSERT INTO ppp_sync_libs (id, client_hash, created_at, last_used_at, created_ip_tag, recovery_hash)'
        + ' SELECT $1::text, $2::text, $3::timestamptz, $3::timestamptz, $4::text, $6::text'
        + ' WHERE (SELECT count(*) FROM ppp_sync_libs WHERE revoked_at IS NULL) < $5::int',
        [l.id, l.hash, at(l.createdAt), l.ipTag || '', maxLive == null ? 1000000 : maxLive, l.recoveryHash || null]);
      return (r.rowCount || 0) === 1;
    },
    /* the library gets a new code: the old row is kept (revoked) so the old code can be told "rotated", the new row takes its items, counters, revision and birth (so
       rotating is not making a library), in ONE statement. false when the old one is not live. */
    async rotateLib(oldId, nl, t) {
      /* (the old row keeps its counters: they are not read for a revoked library, and `old` returns them as the locked row had them) */
      const r = await query(
        'WITH old AS (UPDATE ppp_sync_libs SET revoked_at = $3 WHERE id = $1 AND revoked_at IS NULL RETURNING created_at, created_ip_tag, bytes, items, tombs, max_rev, purged_through, recovery_hash),'
        + ' nl AS (INSERT INTO ppp_sync_libs (id, client_hash, created_at, last_used_at, created_ip_tag, rotated_from, bytes, items, tombs, max_rev, purged_through, recovery_hash)'
        + '   SELECT $2::text, $4::text, old.created_at, $3::timestamptz, old.created_ip_tag, $1::text, old.bytes, old.items, old.tombs, old.max_rev, old.purged_through,'
        + '     COALESCE($5::text, old.recovery_hash) FROM old RETURNING id),'
        + ' mv AS (UPDATE ppp_sync_items SET lib_id = $2 WHERE lib_id = $1 AND EXISTS (SELECT 1 FROM nl) RETURNING 1)'
        + ' SELECT (SELECT count(*) FROM nl)::int AS made, (SELECT count(*) FROM mv)::int AS moved',
        [oldId, nl.id, at(t), nl.hash, nl.recoveryHash || null]);
      return !!rowsOf(r)[0] && rowsOf(r)[0].made === 1;
    },
    /* the library is deleted with everything in it: the row is marked revoked (kept two days, for the per-address limits) and its items are gone, ONE statement */
    async deleteLib(id, t) {
      const r = await query(
        'WITH i AS (DELETE FROM ppp_sync_items WHERE lib_id = $1 AND EXISTS (SELECT 1 FROM ppp_sync_libs WHERE id = $1 AND revoked_at IS NULL) RETURNING 1)'
        + ' UPDATE ppp_sync_libs SET revoked_at = $2, bytes = 0, items = 0, tombs = 0 WHERE id = $1 AND revoked_at IS NULL',
        [id, at(t)]);
      return (r.rowCount || 0) === 1;
    },
    /* a library is used: written at most once a day per library by the service, never by an idle poll */
    async touchLib(id, t) {
      await query('UPDATE ppp_sync_libs SET last_used_at = $2 WHERE id = $1 AND revoked_at IS NULL', [id, at(t)]);
    },
    /* the purge, ONE statement: libraries that ran out (with their items), and tombstones older than `tombBefore` of the others (their counters follow). Returns what was
       removed and, for each library whose tombstones went, its new counters and its next oldest tombstone. `libIds` may be empty, `tombBefore` null (no tombstone sweep). */
    async purge(libIds, tombBefore) {
      const ids = libIds || [];
      const r = await query(
        'WITH dl AS (DELETE FROM ppp_sync_libs WHERE id = ANY($1::text[]) RETURNING id),'
        + ' di AS (DELETE FROM ppp_sync_items WHERE lib_id = ANY($1::text[]) RETURNING 1),'
        + ' dt AS (DELETE FROM ppp_sync_items WHERE $2::timestamptz IS NOT NULL AND deleted_at IS NOT NULL AND deleted_at < $2::timestamptz AND lib_id <> ALL($1::text[]) RETURNING lib_id, rev),'
        + ' cnt AS (SELECT lib_id, count(*)::int AS n, max(rev) AS top FROM dt GROUP BY lib_id),'
        + ' up AS (UPDATE ppp_sync_libs l SET tombs = l.tombs - cnt.n, bytes = l.bytes - cnt.n * ' + R + ', purged_through = GREATEST(l.purged_through, cnt.top) FROM cnt WHERE l.id = cnt.lib_id RETURNING l.id, l.tombs, l.bytes, l.purged_through)'
        + " SELECT 'c' AS k, NULL::text AS id, (SELECT count(*) FROM dl)::bigint AS a, (SELECT count(*) FROM di)::bigint AS b, (SELECT count(*) FROM dt)::bigint AS c, NULL::timestamptz AS oldest"
        + " UNION ALL SELECT 'u', up.id, up.tombs, up.bytes, up.purged_through, (SELECT min(i.deleted_at) FROM ppp_sync_items i WHERE i.lib_id = up.id AND i.deleted_at IS NOT NULL AND i.deleted_at >= $2::timestamptz) FROM up",
        [ids, tombBefore == null ? null : at(tombBefore)]);
      const out = { libs: 0, items: 0, tombs: 0, updated: [] };
      rowsOf(r).forEach(x => {
        if (x.k === 'c') { out.libs = num(x.a); out.items = num(x.b); out.tombs = num(x.c); }
        else out.updated.push({ id: x.id, tombs: num(x.a), bytes: num(x.b), purgedThrough: num(x.c), oldestTomb: ms(x.oldest) });
      });
      return out;
    },
    /* item rows that no library names */
    async deleteOrphans() {
      const r = await query('DELETE FROM ppp_sync_items i WHERE NOT EXISTS (SELECT 1 FROM ppp_sync_libs l WHERE l.id = i.lib_id)');
      return r.rowCount || 0;
    },
    /* the counters of one library as the database has them now (ONE statement; the service asks when a device claims to be ahead of the library, so that a restored database or a
       second process is not told "reset" from a cache): { found, live, maxRev, bytes, items, tombs, purgedThrough } */
    async libState(id) {
      const r = await query('SELECT max_rev, bytes, items, tombs, purged_through, revoked_at FROM ppp_sync_libs WHERE id = $1', [id]);
      const x = rowsOf(r)[0];
      if (!x) return { found: false, live: false };
      return { found: true, live: x.revoked_at == null, maxRev: num(x.max_rev), bytes: num(x.bytes), items: x.items | 0, tombs: x.tombs | 0, purgedThrough: num(x.purged_through) };
    },
    /* the metadata of the items written after `since`, oldest first (one more than `limit` is asked for by the caller to know there is more) */
    async changes(libId, since, limit) {
      const r = await query('SELECT ' + META_COLS + ' FROM ppp_sync_items WHERE lib_id = $1 AND rev > $2 ORDER BY rev LIMIT $3', [libId, since, limit]);
      return rowsOf(r).map(metaOfRow);
    },
    /* the named items of the library with their bodies, in the order asked for, while the bodies' total stays within capBytes (the rest come back with body null and
       deferred true: the caller asks again); a tombstone has no body. A key the library does not have is not in the answer. */
    async getItems(libId, keys, capBytes) {
      const r = await query(
        'SELECT ' + META_COLS + ', CASE WHEN deleted_at IS NULL AND sum(bytes) OVER (ORDER BY array_position($2::text[], key)) <= $3 THEN body END AS body'
        + ' FROM ppp_sync_items WHERE lib_id = $1 AND key = ANY($2::text[]) ORDER BY array_position($2::text[], key)',
        [libId, keys, capBytes]);
      return rowsOf(r).map(x => Object.assign(metaOfRow(x), { body: x.body || null, deferred: x.deleted_at == null && !x.body }));
    },
    /* A batch of items written in ONE statement (see the header). items: [{ key, base, hash, bytes, body (Buffer), device }], keys distinct. An item whose current revision is
       above its base is not written and comes back as a conflict with the server's metadata; the others are written with consecutive new revisions. The whole batch is refused
       (applied: nothing) when it would grow the library by more than growthMax accounted bytes, or add more than rowsRoom rows, or the library is not live.
       An item whose base is above 0 for a key that is not there at all (its tombstone was purged: the device was away longer than the tombstones are kept) is not written as a new
       item: its key is in `gone` (a conflict of its own kind), and the device must say again, with base 0, that it means to bring the song back.
       Returns { ok: false, reason: 'gone' } or { ok: false, reason: 'quota', growth, newRows } (what the batch would have added) or { ok: true, maxRev, bytes, items, tombs, applied: [{ key, rev }], conflicts: [meta], gone: [key], lost: [key] } (lost: a key the
       statement decided to write and then found changed by another writer meanwhile - only with two instances). */
    async putItems(libId, items, t, o) {
      const params = [libId, at(t), o.growthMax, o.rowsRoom];
      const rows = items.map((it, i) => {
        const b = params.length + 1;
        params.push(it.key, it.base, it.hash || '', it.bytes | 0, it.body, it.device || '');
        return '($' + b + '::text, $' + (b + 1) + '::bigint, $' + (b + 2) + '::text, $' + (b + 3) + '::int, $' + (b + 4) + '::bytea, $' + (b + 5) + '::text, ' + (i + 1) + ')';
      });
      const sql =
        'WITH v (key, base, hash, nbytes, body, device, ord) AS (VALUES ' + rows.join(', ') + '),'
        + ' cur AS (SELECT i.key, i.rev, i.bytes, (i.deleted_at IS NULL) AS live FROM ppp_sync_items i WHERE i.lib_id = $1 AND i.key IN (SELECT key FROM v)),'
        + ' ok AS (SELECT v.*, c.key IS NOT NULL AS existed, COALESCE(c.live, false) AS was_live, COALESCE(c.bytes, 0) AS old_bytes, (row_number() OVER (ORDER BY v.ord))::int AS n'
        + '   FROM v LEFT JOIN cur c ON c.key = v.key WHERE (c.key IS NULL AND v.base = 0) OR (c.key IS NOT NULL AND c.rev <= v.base)),'
        + ' tot AS (SELECT count(*)::int AS cnt,'
        + '   COALESCE(sum(nbytes + ' + R + ' - CASE WHEN was_live THEN old_bytes + ' + R + ' WHEN existed THEN ' + R + ' ELSE 0 END), 0)::bigint AS d_bytes,'
        + '   (count(*) FILTER (WHERE NOT was_live))::int AS d_items,'
        + '   (- count(*) FILTER (WHERE existed AND NOT was_live))::int AS d_tombs,'
        + '   (count(*) FILTER (WHERE NOT existed))::int AS new_rows FROM ok),'
        + ' upd AS (UPDATE ppp_sync_libs l SET max_rev = l.max_rev + tot.cnt, bytes = l.bytes + tot.d_bytes, items = l.items + tot.d_items, tombs = l.tombs + tot.d_tombs, last_used_at = $2'
        + '   FROM tot WHERE l.id = $1 AND l.revoked_at IS NULL AND tot.cnt > 0 AND tot.d_bytes <= $3 AND tot.new_rows <= $4'
        + '   RETURNING l.max_rev, l.bytes, l.items, l.tombs),'
        + ' ins AS (INSERT INTO ppp_sync_items AS t (lib_id, key, rev, deleted_at, content_hash, device, bytes, body, updated_at)'
        + '   SELECT $1::text, ok.key, upd.max_rev - tot.cnt + ok.n, NULL, ok.hash, ok.device, ok.nbytes, ok.body, $2::timestamptz FROM ok, upd, tot'
        + '   ON CONFLICT (lib_id, key) DO UPDATE SET rev = EXCLUDED.rev, deleted_at = NULL, content_hash = EXCLUDED.content_hash, device = EXCLUDED.device, bytes = EXCLUDED.bytes,'
        + '     body = EXCLUDED.body, updated_at = EXCLUDED.updated_at'
        + '     WHERE t.rev < EXCLUDED.rev AND t.rev <= (SELECT v.base FROM v WHERE v.key = t.key)'
        + '   RETURNING t.key, t.rev)'
        + " SELECT 'a' AS k, ins.key, ins.rev, NULL::timestamptz AS deleted_at, NULL::text AS hash, NULL::int AS bytes, NULL::text AS device, NULL::timestamptz AS updated_at,"
        + '   NULL::bigint AS max_rev, NULL::bigint AS lbytes, NULL::int AS items, NULL::int AS tombs, NULL::boolean AS live, NULL::int AS cnt, NULL::bigint AS dbytes, NULL::int AS newrows FROM ins'
        + " UNION ALL SELECT 'c', i.key, i.rev, i.deleted_at, i.content_hash, i.bytes, i.device, i.updated_at, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL"
        + '   FROM ppp_sync_items i WHERE i.lib_id = $1 AND i.key IN (SELECT key FROM v) AND i.key NOT IN (SELECT key FROM ok)'
        + " UNION ALL SELECT 'x', v.key, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL FROM v WHERE v.base > 0 AND v.key NOT IN (SELECT key FROM cur)"
        + " UNION ALL SELECT 'm', NULL, NULL, NULL, NULL, NULL, NULL, NULL, upd.max_rev, upd.bytes, upd.items, upd.tombs, NULL, NULL, NULL, NULL FROM upd"
        + " UNION ALL SELECT 'g', NULL, NULL, NULL, NULL, NULL, NULL, NULL, l.max_rev, l.bytes, l.items, l.tombs, (l.id IS NOT NULL AND l.revoked_at IS NULL), (SELECT cnt FROM tot), (SELECT d_bytes FROM tot), (SELECT new_rows FROM tot)"
        + '   FROM (SELECT 1) one LEFT JOIN ppp_sync_libs l ON l.id = $1';
      const rs = rowsOf(await query(sql, params));
      const applied = [], conflicts = [], gone = [];
      let m = null, g = null;
      rs.forEach(x => {
        if (x.k === 'a') applied.push({ key: x.key, rev: num(x.rev) });
        else if (x.k === 'c') conflicts.push(metaOfRow(x));
        else if (x.k === 'x') gone.push(x.key);
        else if (x.k === 'm') m = x;
        else if (x.k === 'g') g = x;
      });
      /* (a statement does not promise an order: the answer is in the order the batch was given in, which is the order of the revisions) */
      const pos = new Map(items.map((it, i) => [it.key, i]));
      applied.sort((a, b) => a.rev - b.rev);
      conflicts.sort((a, b) => pos.get(a.key) - pos.get(b.key));
      gone.sort((a, b) => pos.get(a) - pos.get(b));
      if (!g || !g.live) return { ok: false, reason: 'gone' };
      if (!m) {
        /* nothing was written: every item conflicted (a normal answer), or the guards of the statement said no */
        if (g.cnt > 0) return { ok: false, reason: 'quota', growth: num(g.dbytes), newRows: g.newrows | 0 };
        return Object.assign({ ok: true, applied: [], conflicts: conflicts, gone: gone, lost: [] }, countersOf(g));
      }
      const got = new Set(applied.map(a => a.key)), conf = new Set(conflicts.map(c => c.key)), goneSet = new Set(gone);
      const lost = items.filter(it => !got.has(it.key) && !conf.has(it.key) && !goneSet.has(it.key)).map(it => it.key);
      return Object.assign({ ok: true, applied: applied, conflicts: conflicts, gone: gone, lost: lost }, countersOf(m));
    },
    /* A tombstone for one item, in ONE statement, over the revision the deleter saw (base). Returns { ok: false, reason: 'gone' } or
       { ok: true, state: 'deleted' | 'already' | 'conflict' | 'missing', rev, meta?, maxRev, bytes, items, tombs }:
       'already' - it was a tombstone (idempotent: a retried delete is not an error), 'conflict' - it was changed after base (meta: what it is now), 'missing' - no such item. */
    async deleteItem(libId, key, base, device, t) {
      const sql =
        'WITH cur AS (SELECT rev, bytes, deleted_at, content_hash, device, updated_at FROM ppp_sync_items WHERE lib_id = $1 AND key = $2),'
        + ' ok AS (SELECT * FROM cur WHERE deleted_at IS NULL AND rev <= $3::bigint),'
        + ' upd AS (UPDATE ppp_sync_libs l SET max_rev = l.max_rev + 1, bytes = l.bytes - ok.bytes, items = l.items - 1, tombs = l.tombs + 1, last_used_at = $4'
        + '   FROM ok WHERE l.id = $1 AND l.revoked_at IS NULL RETURNING l.max_rev, l.bytes, l.items, l.tombs),'
        + ' del AS (UPDATE ppp_sync_items i SET rev = upd.max_rev, deleted_at = $4, content_hash = NULL, body = NULL, bytes = 0, device = $5, updated_at = $4'
        + '   FROM upd WHERE i.lib_id = $1 AND i.key = $2 AND i.deleted_at IS NULL AND i.rev <= $3::bigint RETURNING i.rev)'
        + " SELECT 'd' AS k, del.rev, NULL::timestamptz AS deleted_at, NULL::text AS hash, NULL::int AS bytes, NULL::text AS device, NULL::timestamptz AS updated_at,"
        + '   NULL::bigint AS max_rev, NULL::bigint AS lbytes, NULL::int AS items, NULL::int AS tombs, NULL::boolean AS live FROM del'
        + " UNION ALL SELECT 'c', cur.rev, cur.deleted_at, cur.content_hash, cur.bytes, cur.device, cur.updated_at, NULL, NULL, NULL, NULL, NULL FROM cur"
        + " UNION ALL SELECT 'm', NULL, NULL, NULL, NULL, NULL, NULL, upd.max_rev, upd.bytes, upd.items, upd.tombs, NULL FROM upd"
        + " UNION ALL SELECT 'g', NULL, NULL, NULL, NULL, NULL, NULL, l.max_rev, l.bytes, l.items, l.tombs, (l.id IS NOT NULL AND l.revoked_at IS NULL) FROM (SELECT 1) one LEFT JOIN ppp_sync_libs l ON l.id = $1";
      const rs = rowsOf(await query(sql, [libId, key, base, at(t), device || '']));
      let d = null, c = null, m = null, g = null;
      rs.forEach(x => { if (x.k === 'd') d = x; else if (x.k === 'c') c = x; else if (x.k === 'm') m = x; else if (x.k === 'g') g = x; });
      if (!g || !g.live) return { ok: false, reason: 'gone' };
      if (d && m) return Object.assign({ ok: true, state: 'deleted', rev: num(d.rev) }, countersOf(m));
      if (!c) return Object.assign({ ok: true, state: 'missing' }, countersOf(g));
      const meta = metaOfRow(Object.assign({ key: key }, c));
      if (c.deleted_at != null) return Object.assign({ ok: true, state: 'already', rev: meta.rev, meta: meta }, countersOf(g));
      return Object.assign({ ok: true, state: 'conflict', rev: meta.rev, meta: meta }, countersOf(g));
    }
  };
}

/* ---------------- a file (local server, tests) ---------------- */
/* opts.memory (tests only): keep the data in memory instead of data/sync.json, so a test that makes thousands of libraries is not a test of the disk */
function fileSyncStore(dir, opts) {
  const file = path.join(dir, 'sync.json');
  let mem = null;
  const memory = !!(opts && opts.memory);
  function load() {
    if (memory) return mem || (mem = { libs: [], items: {} });
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { libs: Array.isArray(d.libs) ? d.libs : [], items: d.items && typeof d.items === 'object' ? d.items : {} };
    } catch (e) { return { libs: [], items: {} }; }
  }
  function save(d) {
    if (memory) { mem = d; return; }
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d));
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, file); return; } catch (e) {
        /* Windows: a scanner or another process can hold the file for a moment */
        if (i >= 8 || !/^(EPERM|EBUSY|EACCES)$/.test(String(e && e.code))) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5 + i * 10);
      }
    }
  }
  const live = (d, id) => d.libs.find(l => l.id === id && !l.revokedAt) || null;
  const itemsOf = (d, id) => d.items[id] || (d.items[id] = {});
  const meta = (key, it) => ({ key: key, rev: it.rev, deleted: !!it.deletedAt, deletedAt: it.deletedAt || 0, hash: it.hash || '', bytes: it.bytes | 0, device: it.device || '', updatedAt: it.updatedAt || 0 });
  const counters = l => ({ maxRev: l.maxRev, bytes: l.bytes, items: l.items, tombs: l.tombs });
  const libOut = l => ({ id: l.id, hash: l.hash, createdAt: l.createdAt, lastUsedAt: l.lastUsedAt, ipTag: l.ipTag || '', revokedAt: l.revokedAt || 0, rotatedFrom: l.rotatedFrom || '',
    bytes: l.bytes | 0, items: l.items | 0, tombs: l.tombs | 0, maxRev: l.maxRev | 0, purgedThrough: l.purgedThrough | 0, recoveryHash: l.recoveryHash || '' });
  const R = ROW_OVERHEAD;
  return {
    kind: 'file',
    async loadAll() {
      const d = load();
      const tombs = {};
      let orphan = 0;
      const known = new Set(d.libs.map(l => l.id));
      Object.keys(d.items).forEach(id => {
        const its = d.items[id];
        if (!known.has(id)) { orphan += Object.keys(its).length; return; }
        Object.keys(its).forEach(k => { const t = its[k].deletedAt; if (t && (!tombs[id] || t < tombs[id])) tombs[id] = t; });
      });
      return { libs: d.libs.map(libOut), tombs: tombs, orphanItems: orphan };
    },
    async createLib(l, maxLive) {
      const d = load();
      if (maxLive != null && d.libs.filter(x => !x.revokedAt).length >= maxLive) return false;
      d.libs.push({ id: l.id, hash: l.hash, createdAt: l.createdAt, lastUsedAt: l.createdAt, ipTag: l.ipTag || '', revokedAt: 0, rotatedFrom: '', bytes: 0, items: 0, tombs: 0, maxRev: 0,
        purgedThrough: 0, recoveryHash: l.recoveryHash || '' });
      save(d);
      return true;
    },
    async rotateLib(oldId, nl, t) {
      const d = load(), o = live(d, oldId);
      if (!o) return false;
      d.libs.push({ id: nl.id, hash: nl.hash, createdAt: o.createdAt, lastUsedAt: t, ipTag: o.ipTag, revokedAt: 0, rotatedFrom: oldId, bytes: o.bytes, items: o.items, tombs: o.tombs, maxRev: o.maxRev,
        purgedThrough: o.purgedThrough | 0, recoveryHash: nl.recoveryHash || o.recoveryHash || '' });
      o.revokedAt = t;
      if (d.items[oldId]) { d.items[nl.id] = d.items[oldId]; delete d.items[oldId]; }
      save(d);
      return true;
    },
    async deleteLib(id, t) {
      const d = load(), l = live(d, id);
      if (!l) return false;
      delete d.items[id];
      Object.assign(l, { revokedAt: t, bytes: 0, items: 0, tombs: 0 });
      save(d);
      return true;
    },
    async touchLib(id, t) {
      const d = load(), l = live(d, id);
      if (!l) return;
      l.lastUsedAt = t;
      save(d);
    },
    async purge(libIds, tombBefore) {
      const d = load();
      const ids = new Set(libIds || []);
      const out = { libs: 0, items: 0, tombs: 0, updated: [] };
      d.libs = d.libs.filter(l => { if (!ids.has(l.id)) return true; out.libs++; out.items += Object.keys(d.items[l.id] || {}).length; delete d.items[l.id]; return false; });
      if (tombBefore != null) {
        d.libs.forEach(l => {
          const its = d.items[l.id] || {};
          let n = 0, oldest = 0, top = 0;
          Object.keys(its).forEach(k => {
            const t = its[k].deletedAt;
            if (!t) return;
            if (t < tombBefore) { if (its[k].rev > top) top = its[k].rev; delete its[k]; n++; } else if (!oldest || t < oldest) oldest = t;
          });
          if (n) {
            l.tombs -= n; l.bytes -= n * R; l.purgedThrough = Math.max(l.purgedThrough | 0, top); out.tombs += n;
            out.updated.push({ id: l.id, tombs: l.tombs, bytes: l.bytes, purgedThrough: l.purgedThrough, oldestTomb: oldest });
          }
        });
      }
      if (out.libs || out.tombs) save(d);
      return out;
    },
    async deleteOrphans() {
      const d = load(), known = new Set(d.libs.map(l => l.id));
      let n = 0;
      Object.keys(d.items).forEach(id => { if (!known.has(id)) { n += Object.keys(d.items[id]).length; delete d.items[id]; } });
      if (n) save(d);
      return n;
    },
    async libState(id) {
      const l = load().libs.find(x => x.id === id);
      if (!l) return { found: false, live: false };
      return { found: true, live: !l.revokedAt, maxRev: l.maxRev | 0, bytes: l.bytes | 0, items: l.items | 0, tombs: l.tombs | 0, purgedThrough: l.purgedThrough | 0 };
    },
    async changes(libId, since, limit) {
      const its = load().items[libId] || {};
      return Object.keys(its).filter(k => its[k].rev > since).map(k => meta(k, its[k])).sort((a, b) => a.rev - b.rev).slice(0, limit);
    },
    async getItems(libId, keys, capBytes) {
      const its = load().items[libId] || {};
      const out = [];
      let sum = 0;
      keys.forEach(k => {
        const it = its[k];
        if (!it) return;
        sum += it.bytes | 0;
        const m = meta(k, it);
        if (it.deletedAt) return out.push(Object.assign(m, { body: null, deferred: false }));
        if (sum <= capBytes) out.push(Object.assign(m, { body: Buffer.from(it.body, 'base64'), deferred: false }));
        else out.push(Object.assign(m, { body: null, deferred: true }));
      });
      return out;
    },
    async putItems(libId, items, t, o) {
      const d = load(), l = live(d, libId);
      if (!l) return { ok: false, reason: 'gone' };
      const its = itemsOf(d, libId);
      const applied = [], conflicts = [], gone = [], plan = [];
      let dBytes = 0, dItems = 0, dTombs = 0, newRows = 0;
      items.forEach(it => {
        const cur = its[it.key];
        if (!cur && it.base > 0) return gone.push(it.key);
        if (cur && cur.rev > it.base) return conflicts.push(meta(it.key, cur));
        const wasLive = !!cur && !cur.deletedAt;
        dBytes += it.bytes + R - (wasLive ? cur.bytes + R : cur ? R : 0);
        if (!wasLive) dItems++;
        if (cur && !wasLive) dTombs--;
        if (!cur) newRows++;
        plan.push(it);
      });
      if (!plan.length) return Object.assign({ ok: true, applied: [], conflicts: conflicts, gone: gone, lost: [] }, counters(l));
      if (dBytes > o.growthMax || newRows > o.rowsRoom) return { ok: false, reason: 'quota', growth: dBytes, newRows: newRows };
      plan.forEach((it, i) => {
        const rev = l.maxRev + 1 + i;
        its[it.key] = { rev: rev, deletedAt: 0, hash: it.hash || '', device: it.device || '', bytes: it.bytes, body: it.body.toString('base64'), updatedAt: t };
        applied.push({ key: it.key, rev: rev });
      });
      l.maxRev += plan.length; l.bytes += dBytes; l.items += dItems; l.tombs += dTombs; l.lastUsedAt = t;
      save(d);
      return Object.assign({ ok: true, applied: applied, conflicts: conflicts, gone: gone, lost: [] }, counters(l));
    },
    async deleteItem(libId, key, base, device, t) {
      const d = load(), l = live(d, libId);
      if (!l) return { ok: false, reason: 'gone' };
      const cur = (d.items[libId] || {})[key];
      if (!cur) return Object.assign({ ok: true, state: 'missing' }, counters(l));
      if (cur.deletedAt) return Object.assign({ ok: true, state: 'already', rev: cur.rev, meta: meta(key, cur) }, counters(l));
      if (cur.rev > base) return Object.assign({ ok: true, state: 'conflict', rev: cur.rev, meta: meta(key, cur) }, counters(l));
      const rev = l.maxRev + 1;
      l.bytes -= cur.bytes; l.items -= 1; l.tombs += 1; l.maxRev = rev; l.lastUsedAt = t;
      Object.assign(cur, { rev: rev, deletedAt: t, hash: '', body: null, bytes: 0, device: device || '', updatedAt: t });
      save(d);
      return Object.assign({ ok: true, state: 'deleted', rev: rev }, counters(l));
    }
  };
}

module.exports = { SCHEMA_SQL, SYNC_LOCK_KEY, ROW_OVERHEAD, migrate, pgSyncStore, fileSyncStore, libOfRow, metaOfRow };
