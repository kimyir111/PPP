/* G13-S0: what the operator's tools for the song libraries share (tools/sync-admin/list.js, delete.js). Not part of the site: nothing here is loaded by the server.

   A library is not content: the tools never read an item, a key, a body or a hash - only the counts and times the libraries table keeps, and the keyed tag of the address a library
   was made from. They connect to the database named by --url or DATABASE_URL, and REFUSE one that is not on this machine unless --allow-remote is given: the production
   database is a decision, not a default. The password of the URL is never printed. */
'use strict';

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/i;

/* argv -> { flags: { name: true | value }, rest: [positional] } for `--name`, `--name value` and `--name=value` */
function parseArgs(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.slice(0, 2) !== '--') { rest.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const name = a.slice(2);
    if (name === 'confirm' || name === 'allow-remote' || name === 'json') { flags[name] = true; continue; }
    flags[name] = argv[i + 1] !== undefined && argv[i + 1].slice(0, 2) !== '--' ? argv[++i] : true;
  }
  return { flags: flags, rest: rest };
}

/* the host of a postgres URL, or null when it is not one */
function hostOf(url) {
  try { const u = new URL(String(url)); if (!/^postgres(ql)?:$/.test(u.protocol)) return null; return u.hostname || 'localhost'; } catch (e) { return null; }
}

/* { url, host, remote } or throws an Error with .exit (2) and a sentence for the person */
function connection(flags, env) {
  const url = typeof flags.url === 'string' ? flags.url : env.DATABASE_URL;
  if (!url) throw Object.assign(new Error('Name the database with --url postgres://... or DATABASE_URL.'), { exit: 2 });
  const host = hostOf(url);
  if (!host) throw Object.assign(new Error('That is not a postgres:// URL.'), { exit: 2 });
  const remote = !LOCAL_HOST.test(host);
  if (remote && flags['allow-remote'] !== true) {
    throw Object.assign(new Error('The database is at ' + host + ', not on this machine. This tool will not touch it without --allow-remote.'), { exit: 2 });
  }
  return { url: url, host: host, remote: remote };
}

/* the pg Pool of a connection (pg is the repository's own dependency); ssl for a remote host the way server.js asks for it */
function pool(conn) {
  const { Pool } = require('pg');
  return new Pool({ connectionString: conn.url, max: 1, ssl: conn.remote ? { rejectUnauthorized: false } : undefined });
}

const LIB_ID = /^lib_[0-9a-f]{22}$/;
const iso = v => (v ? new Date(v).toISOString().slice(0, 19) + 'Z' : '-');
const mb = n => (Number(n) / 1048576).toFixed(2);

module.exports = { parseArgs, hostOf, connection, pool, LIB_ID, iso, mb, LOCAL_HOST };
