#!/usr/bin/env node
/* ============================================================================
   G9c - decode a reviewer's ratings with the key.

     node review/decode.js --key <key.json> --ratings <ratings.json> [--out summary.json]

   Joins the ratings file the reviewer's page exported (X / Y labels) with the key the builder wrote elsewhere (which of X and Y
   was G9 and which was the legacy engine, per item), and reports per arm. It refuses to join a key and a ratings file that
   are not the same packet (packet id) or the same mode.

   What it computes (and what it does not claim):
     - preference: how many items preferred G9, the legacy arm, or neither; among decisive items, G9's share with a 95% Wilson
       interval and an exact two-sided sign-test p against 50%. Ties ("no difference") are counted, not dropped silently.
     - H-8 issue tags and notes, per arm.
     - H-9 pass rate per arm (Wilson interval) and the paired table (both pass / only G9 / only legacy / neither) with an exact
       McNemar p on the discordant items.
   There is no pass threshold here: the H-9 bar for the flip is a decision for the user, not a constant in this script. With
   about 16 items and one reviewer, intervals are wide - read them before reading a percentage.
   ========================================================================== */
'use strict';
const fs = require('fs');

function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
/* exact two-sided binomial test against 0.5 (also McNemar's exact test on discordant pairs) */
function signTestP(k, n) {
  if (!n) return null;
  const m = Math.min(k, n - k);
  let sum = 0;
  for (let i = 0; i <= m; i++) sum += choose(n, i);
  return Math.min(1, 2 * sum / Math.pow(2, n));
}
function choose(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }
const r3 = v => v == null ? null : Math.round(v * 1000) / 1000;

function decode(key, ratings) {
  if (!key || key.format !== 'ppp-review-key/1') throw new Error('not a review key file');
  if (!ratings || ratings.format !== 'ppp-review-ratings/1') throw new Error('not a ratings file exported by the review page');
  if (key.packetId !== ratings.packetId) throw new Error('the key is for packet ' + key.packetId + ' but the ratings are for packet ' + ratings.packetId);
  if (key.mode !== ratings.mode) throw new Error('mode mismatch: key ' + key.mode + ', ratings ' + ratings.mode);
  const seen = new Set();
  const rows = ratings.ratings.map(r => {
    const k = key.items[r.id];
    if (!k) throw new Error('rating for an item the key does not have: ' + r.id);
    if (seen.has(r.id)) throw new Error('item rated twice: ' + r.id);
    seen.add(r.id);
    const arms = { [k.X]: r.X || {}, [k.Y]: r.Y || {} };
    const pref = r.preference === 'X' ? k.X : r.preference === 'Y' ? k.Y : r.preference === 'same' ? 'same' : null;
    return { id: r.id, file: k.file, targetLevel: k.targetLevel, tier: k.tier, preference: pref, g9: arms.g9, legacy: arms.legacy, xIs: k.X };
  });
  Object.keys(key.items).forEach(id => { if (!seen.has(id)) rows.push({ id: id, file: key.items[id].file, targetLevel: key.items[id].targetLevel, tier: key.items[id].tier, preference: null, g9: {}, legacy: {}, xIs: key.items[id].X, missing: true }); });
  rows.sort((a, b) => a.id < b.id ? -1 : 1);

  const out = { packetId: key.packetId, mode: key.mode, items: rows.length };
  const count = f => rows.filter(f).length;
  const g9Wins = count(r => r.preference === 'g9'), legacyWins = count(r => r.preference === 'legacy'), same = count(r => r.preference === 'same');
  const decisive = g9Wins + legacyWins;
  out.preference = { g9: g9Wins, legacy: legacyWins, noDifference: same, unrated: rows.length - g9Wins - legacyWins - same, decisive: decisive,
    g9ShareOfDecisive: decisive ? r3(g9Wins / decisive) : null, wilson95: (w => w && w.map(r3))(wilson(g9Wins, decisive)), signTestP: r3(signTestP(g9Wins, decisive)) };

  const tags = arm => { const t = {}; rows.forEach(r => (r[arm].issues || []).forEach(i => { t[i] = (t[i] || 0) + 1; })); return t; };
  const notes = arm => rows.filter(r => r[arm].text && String(r[arm].text).trim()).map(r => ({ id: r.id, file: r.file, text: String(r[arm].text).trim() }));
  out.issues = { g9: tags('g9'), legacy: tags('legacy') };
  out.notes = { g9: notes('g9'), legacy: notes('legacy') };

  const pass = arm => { const p = count(r => r[arm].pass === true), f = count(r => r[arm].pass === false); return { pass: p, fail: f, unrated: rows.length - p - f, rate: p + f ? r3(p / (p + f)) : null, wilson95: (w => w && w.map(r3))(wilson(p, p + f)) }; };
  out.pass = { g9: pass('g9'), legacy: pass('legacy') };
  const both = rows.filter(r => r.g9.pass !== null && r.g9.pass !== undefined && r.legacy.pass !== null && r.legacy.pass !== undefined);
  const bp = both.filter(r => r.g9.pass && r.legacy.pass).length, go = both.filter(r => r.g9.pass && !r.legacy.pass).length,
    lo = both.filter(r => !r.g9.pass && r.legacy.pass).length, bf = both.filter(r => !r.g9.pass && !r.legacy.pass).length;
  out.paired = { bothPass: bp, onlyG9Passes: go, onlyLegacyPasses: lo, bothFail: bf, n: both.length, mcnemarExactP: r3(signTestP(go, go + lo)) };
  out.byItem = rows.map(r => ({ id: r.id, file: r.file, targetLevel: r.targetLevel, tier: r.tier, xIs: r.xIs, preference: r.preference,
    g9: { pass: r.g9.pass === undefined ? null : r.g9.pass, issues: r.g9.issues || [] }, legacy: { pass: r.legacy.pass === undefined ? null : r.legacy.pass, issues: r.legacy.issues || [] }, missing: !!r.missing }));
  out.reviewer = ratings.reviewer || null;
  out.caveats = [
    'One reviewer (or few): the interval above is the honest uncertainty; a preference share is not a population estimate.',
    'Blinding hides which arrangement is which, not the music: a fuller texture can look like G9 to a reader. The ratings do not say WHY one was preferred.',
    'Only pieces the G7b planner can reach were reviewed, at hand profile large, against the legacy ScoreArranger only; pieces from the tuning sample (tier 2) favour G9.',
    'The sound is a plain synthesised piano of the same notes: it says nothing about touch, pedalling or phrasing.'
  ];
  return out;
}

function report(o) {
  const L = [];
  const pc = v => v == null ? 'n/a' : (100 * v).toFixed(0) + '%';
  const ci = w => w ? '[' + pc(w[0]) + ', ' + pc(w[1]) + ']' : 'n/a';
  L.push('Packet ' + o.packetId + ' (' + o.mode.toUpperCase() + '), ' + o.items + ' items' + (o.reviewer ? ', reviewer role: ' + o.reviewer : ''));
  const p = o.preference;
  L.push('Preference: G9 ' + p.g9 + ', legacy ' + p.legacy + ', no difference ' + p.noDifference + ', unrated ' + p.unrated +
    (p.decisive ? '; G9 share of decisive ' + pc(p.g9ShareOfDecisive) + ' 95% CI ' + ci(p.wilson95) + ', sign test p=' + p.signTestP : ''));
  ['g9', 'legacy'].forEach(a => {
    const x = o.pass[a];
    if (x.pass + x.fail) L.push('Pass/fail ' + a + ': ' + x.pass + ' pass, ' + x.fail + ' fail, ' + x.unrated + ' unrated; pass rate ' + pc(x.rate) + ' 95% CI ' + ci(x.wilson95));
    const t = Object.keys(o.issues[a]);
    if (t.length) L.push('Issues ' + a + ': ' + t.map(k => k + ' x' + o.issues[a][k]).join(', '));
  });
  if (o.paired.n) L.push('Paired pass/fail: both pass ' + o.paired.bothPass + ', only G9 ' + o.paired.onlyG9Passes + ', only legacy ' + o.paired.onlyLegacyPasses + ', both fail ' + o.paired.bothFail + ' (McNemar exact p=' + o.paired.mcnemarExactP + ')');
  L.push('Caveats:'); o.caveats.forEach(c => L.push('  - ' + c));
  return L.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  if (!opt('--key') || !opt('--ratings')) { console.log('usage: node review/decode.js --key <key.json> --ratings <ratings.json> [--out summary.json]'); process.exit(2); }
  const o = decode(JSON.parse(fs.readFileSync(opt('--key'), 'utf8')), JSON.parse(fs.readFileSync(opt('--ratings'), 'utf8')));
  console.log(report(o));
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(o, null, 1) + '\n');
}

if (require.main === module) { try { main(); } catch (e) { console.error(e.message || e); process.exit(1); } }
module.exports = { decode, report, wilson, signTestP };
