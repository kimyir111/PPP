/* G13-7b (U5, docs/GOALS/G13_PRODUCTIZATION.md G13-D11): the anonymous counters the page's browsers send, and how the server holds them. Counting ONLY: nothing here changes what a
   request is answered, and nothing is stored.

   The page (head script, PPP_COUNTS) sends one small POST to /api/stats when a visit is hidden or closed:

     {"v":1,"b":"fab0ba3","loc":"ko","mob":1,"pv":1,"fcp":1,"rdy":2,"err":{"type":1,"other":2},"rej":1,"eng":{"PLAN_THREW":1},"prc":{"NOT_READY":3},"lz":1}

   Every key is optional except v. The server takes ONLY what is in the whitelists below and drops the rest: an unknown key, a value of another kind, a code it has no name for (counted
   as `other`), a number that is not a whole number of at most CAP (a bigger one is CAP: one runaway page is one visit, not a flood). There is no field that holds text from the visit: no
   message, no stack, no address, no title, no id. `b` (the build the page was made by) is compared with the server's own and counted as stale when it differs, and is never kept.

   What is aggregated, all in memory, for the window until the hourly `stats:` line (server-stats.js prints `"client": {...}` in it when anything arrived, and starts again from zero):
     beacons          POSTs accepted             visits       beacons that carry the first one of a page (pv)       stale     beacons from a page of another build
     mobile/desktop   of the visits              locale       ko ja zh en                                              withErrors  beacons with an error or a rejection
     fcp, ready       buckets of the visits: lt2 (< 2 s) lt4 (< 4 s) lt8 (< 8 s) ge8 (>= 8 s) none (not reached when the page was left)
     errors           uncaught errors by class: type reference range syntax load (a script or stylesheet of THIS site that did not load) thirdparty (one of another site's: Google
                      Fonts, a CDN, a blocker at work) other
     rejections       unhandled promise rejections           lazyFailed      lazy groups that did not load
     engrave          the engraver's fallbacks by code       practice        the practice plan's fallbacks (stayed on the legacy plan) by reason
   The keys are fixed, so the memory is fixed (about sixty numbers). The line holds numbers only.

   Not here: the rate limit and the address it is keyed by (server.js: a keyed hash that is made new at every start, kept for ten minutes); the route. */
'use strict';

const CAP = 50;
const MAX_BODY = 1024;
const LOCALES = ['ko', 'ja', 'zh', 'en'];
const BUCKETS = ['lt2', 'lt4', 'lt8', 'ge8', 'none'];
const ERROR_CLASSES = ['type', 'reference', 'range', 'syntax', 'load', 'thirdparty', 'other'];
/* engrave/page.js fail() codes and practice's practiceGraphBuild reasons; anything else is counted as `other` */
const ENGRAVE_CODES = ['SOURCE_THREW', 'SOURCE_NONE', 'SOURCE_DISAGREES', 'LINK_FAILED', 'PLAN_THREW', 'LAYOUT_THREW', 'SYNC_THREW'];
const PRACTICE_CODES = ['NOT_LOADED', 'NO_ENGRAVER', 'EMPTY', 'RESOLVE_ERROR', 'NO_GRAPH', 'LINK_FAILED', 'MEASURES', 'IDENTITY', 'ABS_MISMATCH', 'BUILD_ERROR', 'NOT_READY'];
const MAX_KEYS = 32;      /* an object of a beacon is read for at most this many keys */

const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
/* a whole number from 0 to CAP (a bigger one is CAP), or null */
function count(v) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null;
  return Math.min(v, CAP);
}
/* a counted map: only the names in `names`, the rest together as `other` (itself capped) */
function counted(raw, names, withOther) {
  if (!isPlain(raw)) return null;
  const out = {};
  let other = 0, seen = 0, any = false;
  for (const k of Object.keys(raw)) {
    if (++seen > MAX_KEYS) break;
    const n = count(raw[k]);
    if (n === null || n === 0) continue;
    if (names.indexOf(k) >= 0) { out[k] = n; any = true; }
    else if (withOther) { other = Math.min(CAP, other + n); any = true; }
  }
  if (other) out.other = Math.min(CAP, (out.other || 0) + other);
  return any ? out : null;
}

/* What the server takes from a parsed body: { ok: true, doc } or { ok: false, why }. `doc` has only whitelisted keys of the right kind. */
function sanitize(raw) {
  if (!isPlain(raw)) return { ok: false, why: 'not-an-object' };
  if (raw.v !== 1) return { ok: false, why: 'version' };
  const doc = { v: 1 };
  if (typeof raw.b === 'string' && /^[0-9a-f]{7,12}$/.test(raw.b)) doc.b = raw.b;
  if (typeof raw.loc === 'string' && LOCALES.indexOf(raw.loc) >= 0) doc.loc = raw.loc;
  if (raw.mob === 0 || raw.mob === 1) doc.mob = raw.mob;
  if (raw.pv === 1) {
    doc.pv = 1;
    if (Number.isInteger(raw.fcp) && raw.fcp >= 0 && raw.fcp < BUCKETS.length) doc.fcp = raw.fcp;
    if (Number.isInteger(raw.rdy) && raw.rdy >= 0 && raw.rdy < BUCKETS.length) doc.rdy = raw.rdy;
  }
  const err = counted(raw.err, ERROR_CLASSES, true);
  if (err) doc.err = err;
  const rej = count(raw.rej);
  if (rej) doc.rej = rej;
  const eng = counted(raw.eng, ENGRAVE_CODES, true);
  if (eng) doc.eng = eng;
  const prc = counted(raw.prc, PRACTICE_CODES, true);
  if (prc) doc.prc = prc;
  const lz = count(raw.lz);
  if (lz) doc.lz = lz;
  return { ok: true, doc: doc };
}

function zero(names) { const o = {}; names.forEach(k => { o[k] = 0; }); return o; }

function fresh() {
  return {
    beacons: 0, visits: 0, stale: 0, mobile: 0, desktop: 0, withErrors: 0,
    locale: zero(LOCALES), fcp: zero(BUCKETS), ready: zero(BUCKETS),
    errors: zero(ERROR_CLASSES), rejections: 0, lazyFailed: 0,
    engrave: zero(ENGRAVE_CODES.concat('other')), practice: zero(PRACTICE_CODES.concat('other'))
  };
}

/* add one sanitized doc; `stale` = the page is of another build than the server's */
function add(agg, doc, stale) {
  agg.beacons++;
  if (stale) agg.stale++;
  if (doc.pv === 1) {
    agg.visits++;
    if (doc.mob === 1) agg.mobile++; else if (doc.mob === 0) agg.desktop++;
    if (doc.loc) agg.locale[doc.loc]++;
    if (doc.fcp !== undefined) agg.fcp[BUCKETS[doc.fcp]]++;
    if (doc.rdy !== undefined) agg.ready[BUCKETS[doc.rdy]]++;
  }
  let failing = false;
  if (doc.err) { Object.keys(doc.err).forEach(k => { agg.errors[k] += doc.err[k]; }); failing = true; }
  if (doc.rej) { agg.rejections += doc.rej; failing = true; }
  if (failing) agg.withErrors++;
  if (doc.eng) Object.keys(doc.eng).forEach(k => { agg.engrave[k] += doc.eng[k]; });
  if (doc.prc) Object.keys(doc.prc).forEach(k => { agg.practice[k] += doc.prc[k]; });
  if (doc.lz) agg.lazyFailed += doc.lz;
}

/* the part of the hourly line: numbers only; the fallbacks by code are listed only where there is one */
function snapshot(agg) {
  const nonzero = o => { const r = {}; Object.keys(o).forEach(k => { if (o[k]) r[k] = o[k]; }); return r; };
  return {
    beacons: agg.beacons, visits: agg.visits, stale: agg.stale, mobile: agg.mobile, desktop: agg.desktop, withErrors: agg.withErrors,
    locale: Object.assign({}, agg.locale), fcp: Object.assign({}, agg.fcp), ready: Object.assign({}, agg.ready),
    errors: Object.assign({}, agg.errors), rejections: agg.rejections, lazyFailed: agg.lazyFailed,
    engrave: nonzero(agg.engrave), practice: nonzero(agg.practice)
  };
}

module.exports = { CAP, MAX_BODY, LOCALES, BUCKETS, ERROR_CLASSES, ENGRAVE_CODES, PRACTICE_CODES, sanitize, fresh, add, snapshot };
