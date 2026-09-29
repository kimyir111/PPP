#!/usr/bin/env node
/* ============================================================================
   G9c - decode a reviewer's ratings with the key.

     node review/decode.js --key <key.json> --ratings <ratings.json> [--out summary.json]

   Joins the ratings file the reviewer's page exported (X / Y labels) with the key the builder wrote elsewhere (which of X and Y
   was G9 and which was the legacy engine, per item), and reports per arm. It refuses to join a key and a ratings file that
   are not the same packet (packet id) or the same mode.

   What it computes (and what it does not claim):
     - preference: item counts (G9, the legacy arm, neither, unrated; ties counted, not dropped) and, for the test, PIECE-level
       counts: two items of one piece are not independent, so items are grouped by piece and each piece counts once - it prefers
       G9 if G9 won more of its items than the legacy arm, the legacy arm if the reverse, and is a tie otherwise. G9's share of the
       decisive PIECES gets a 95% Wilson interval and an exact two-sided sign test against 50%. There is no item-level p-value.
     - H-8 issue tags and notes, per arm.
     - H-9 pass rate per arm (Wilson interval over pieces: a piece passes an arm only if every item of it that was rated passes)
       and the paired table with an exact McNemar p on the discordant pieces; item counts are reported beside them.
     - the same preference and pass numbers SPLIT by strata the key records: whether G9 is fuller than the legacy arm (note-count
       ratio at least 1.1 / within 0.9-1.1 / at most 0.9), and which arm missed the requested level by more. Descriptive only, no
       p-values: the strata are small and the arm is often guessable from density (see the caveats), so preference is confounded.
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
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
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
    return { id: r.id, file: k.file, targetLevel: k.targetLevel, tier: k.tier, preference: pref, g9: arms.g9, legacy: arms.legacy, xIs: k.X, strata: k.strata || null };
  });
  Object.keys(key.items).forEach(id => { if (!seen.has(id)) rows.push({ id: id, file: key.items[id].file, targetLevel: key.items[id].targetLevel, tier: key.items[id].tier, preference: null, g9: {}, legacy: {}, xIs: key.items[id].X, strata: key.items[id].strata || null, missing: true }); });
  rows.sort((a, b) => a.id < b.id ? -1 : 1);

  const out = { packetId: key.packetId, mode: key.mode, items: rows.length };
  const pieces = new Map();
  rows.forEach(r => { if (!pieces.has(r.file)) pieces.set(r.file, []); pieces.get(r.file).push(r); });
  out.pieces = pieces.size;
  const pref = list => {
    const c = f => list.filter(f).length;
    const g9 = c(r => r.preference === 'g9'), leg = c(r => r.preference === 'legacy'), same = c(r => r.preference === 'same');
    return { g9: g9, legacy: leg, noDifference: same, unrated: list.length - g9 - leg - same };
  };
  const passOf = (list, arm) => { const p = list.filter(r => r[arm].pass === true).length, f = list.filter(r => r[arm].pass === false).length; return { pass: p, fail: f, unrated: list.length - p - f }; };

  /* items (descriptive counts) and pieces (the unit of the test) */
  out.preference = Object.assign({ items: rows.length }, pref(rows));
  const piecePref = [...pieces.values()].map(list => {
    const p = pref(list);
    return p.g9 > p.legacy ? 'g9' : p.legacy > p.g9 ? 'legacy' : (p.g9 + p.legacy + p.noDifference) ? 'tie' : 'unrated';
  });
  const pg = piecePref.filter(x => x === 'g9').length, pl = piecePref.filter(x => x === 'legacy').length, pdec = pg + pl;
  out.preference.pieces = { n: pieces.size, g9: pg, legacy: pl, tie: piecePref.filter(x => x === 'tie').length, unrated: piecePref.filter(x => x === 'unrated').length,
    decisive: pdec, g9ShareOfDecisive: pdec ? r3(pg / pdec) : null, wilson95: (w => w && w.map(r3))(wilson(pg, pdec)), signTestP: r3(signTestP(pg, pdec)),
    unit: 'a piece counts once: G9 if it won more of its items than the legacy arm, legacy if fewer, else a tie; the test is over decisive pieces' };
  out.clusteringNote = pieces.size < rows.length ? rows.length + ' items cover ' + pieces.size + ' pieces; the significance test is per piece, item counts are descriptive' : 'one item per piece';

  const tags = arm => { const t = {}; rows.forEach(r => (r[arm].issues || []).forEach(i => { t[i] = (t[i] || 0) + 1; })); return t; };
  const notes = arm => rows.filter(r => r[arm].text && String(r[arm].text).trim()).map(r => ({ id: r.id, file: r.file, text: String(r[arm].text).trim() }));
  out.issues = { g9: tags('g9'), legacy: tags('legacy') };
  out.notes = { g9: notes('g9'), legacy: notes('legacy') };

  /* pass/fail: item counts, and piece-level rates (a piece passes an arm only if every rated item of it passes) */
  const verdict = (list, arm) => { const rated = list.filter(r => r[arm].pass === true || r[arm].pass === false); return rated.length ? rated.every(r => r[arm].pass === true) : null; };
  const passArm = arm => {
    const v = [...pieces.values()].map(l => verdict(l, arm)).filter(x => x !== null);
    const p = v.filter(Boolean).length;
    return { items: passOf(rows, arm), pieces: { pass: p, fail: v.length - p, rate: v.length ? r3(p / v.length) : null, wilson95: (w => w && w.map(r3))(wilson(p, v.length)) } };
  };
  out.pass = { g9: passArm('g9'), legacy: passArm('legacy') };
  const pv = [...pieces.values()].map(l => [verdict(l, 'g9'), verdict(l, 'legacy')]).filter(x => x[0] !== null && x[1] !== null);
  const bp = pv.filter(x => x[0] && x[1]).length, go = pv.filter(x => x[0] && !x[1]).length, lo = pv.filter(x => !x[0] && x[1]).length, bf = pv.filter(x => !x[0] && !x[1]).length;
  out.paired = { unit: 'pieces', bothPass: bp, onlyG9Passes: go, onlyLegacyPasses: lo, bothFail: bf, n: pv.length, mcnemarExactP: r3(signTestP(go, go + lo)) };

  /* strata recorded in the key: descriptive splits, no p-values */
  const strata = {};
  const split = (name, labels) => {
    strata[name] = {};
    labels.forEach(([label, test]) => {
      const list = rows.filter(r => r.strata && test(r.strata));
      if (!list.length) return;
      strata[name][label] = { items: list.length, pieces: new Set(list.map(r => r.file)).size, preference: pref(list), pass: { g9: passOf(list, 'g9'), legacy: passOf(list, 'legacy') } };
    });
  };
  split('byDensity', [['g9 fuller (note ratio >= 1.1)', q => q.fuller === 'g9'], ['similar (0.9 to 1.1)', q => q.fuller === 'similar'], ['legacy fuller (ratio <= 0.9)', q => q.fuller === 'legacy']]);
  split('byLevelMiss', [['G9 missed the requested level by more', q => q.missedMore === 'g9'], ['about equal', q => q.missedMore === 'similar'], ['legacy missed by more', q => q.missedMore === 'legacy']]);
  out.strata = strata;
  const st = rows.filter(r => r.strata);
  out.confounds = st.length ? {
    itemsG9Fuller: st.filter(q => q.strata.fuller === 'g9').length, itemsLegacyFuller: st.filter(q => q.strata.fuller === 'legacy').length, itemsSimilarDensity: st.filter(q => q.strata.fuller === 'similar').length,
    itemsLegacyMissedLevelMore: st.filter(q => q.strata.missedMore === 'legacy').length, itemsG9MissedLevelMore: st.filter(q => q.strata.missedMore === 'g9').length,
    meanAbsLevelMiss: { g9: r3(mean(st.map(q => q.strata.levelMiss.g9))), legacy: r3(mean(st.map(q => q.strata.levelMiss.legacy))) },
    leftHandShareOfG9ExtraNotes: (() => {
      const dn = st.reduce((a, q) => a + q.strata.drawnNotes.g9 - q.strata.drawnNotes.legacy, 0), dl = st.reduce((a, q) => a + q.strata.leftHandNotes.g9 - q.strata.leftHandNotes.legacy, 0);
      return dn > 0 ? r3(dl / dn) : null;
    })()
  } : null;
  out.byItem = rows.map(r => ({ id: r.id, file: r.file, targetLevel: r.targetLevel, tier: r.tier, xIs: r.xIs, preference: r.preference,
    g9: { pass: r.g9.pass === undefined ? null : r.g9.pass, issues: r.g9.issues || [] }, legacy: { pass: r.legacy.pass === undefined ? null : r.legacy.pass, issues: r.legacy.issues || [] }, missing: !!r.missing }));
  out.reviewer = ratings.reviewer || null;
  out.caveats = [
    'Confounded with density: G9 is usually fuller (mostly left hand) than ScoreArranger, so the arm is often guessable from the score; a preference for the fuller arrangement is not independent of that guess. Read the byDensity split before the overall number.',
    'Confounded with level: the two arms miss the requested level by different amounts (see confounds.meanAbsLevelMiss), so "too easy/too hard" and preference mix arm with level miss. Read the byLevelMiss split.',
    'Items of one piece are not independent: the test is over pieces. One reviewer (or few) and about 16 units: the interval is the honest uncertainty, and a share is not a population estimate.',
    'Only pieces the G7b planner can reach were reviewed, at hand profile large, against the legacy ScoreArranger only; pieces from the tuning sample (tier 2) favour G9. This can support "this reviewer prefers G9\'s notes to ScoreArranger\'s on those pieces", not "G9 is generally better".',
    'The sound is a plain synthesised piano of the same notes (a tied note is one sound, a pitch doubled in both hands at one onset sounds once): it says nothing about touch, pedalling, fingering or small hands.'
  ];
  return out;
}

function report(o) {
  const L = [];
  const pc = v => v == null ? 'n/a' : (100 * v).toFixed(0) + '%';
  const ci = w => w ? '[' + pc(w[0]) + ', ' + pc(w[1]) + ']' : 'n/a';
  L.push('Packet ' + o.packetId + ' (' + o.mode.toUpperCase() + '), ' + o.items + ' items over ' + o.pieces + ' pieces' + (o.reviewer ? ', reviewer role: ' + o.reviewer : ''));
  const p = o.preference, q = p.pieces;
  L.push('Preference, items: G9 ' + p.g9 + ', legacy ' + p.legacy + ', no difference ' + p.noDifference + ', unrated ' + p.unrated + ' (counts only)');
  L.push('Preference, pieces (the unit of the test): G9 ' + q.g9 + ', legacy ' + q.legacy + ', tie ' + q.tie + ', unrated ' + q.unrated +
    (q.decisive ? '; G9 share of decisive pieces ' + pc(q.g9ShareOfDecisive) + ' 95% CI ' + ci(q.wilson95) + ', sign test p=' + q.signTestP : ''));
  ['g9', 'legacy'].forEach(a => {
    const x = o.pass[a];
    if (x.items.pass + x.items.fail) L.push('Pass/fail ' + a + ': items ' + x.items.pass + ' pass / ' + x.items.fail + ' fail / ' + x.items.unrated + ' unrated; pieces pass rate ' + pc(x.pieces.rate) + ' 95% CI ' + ci(x.pieces.wilson95));
    const t = Object.keys(o.issues[a]);
    if (t.length) L.push('Issues ' + a + ': ' + t.map(k => k + ' x' + o.issues[a][k]).join(', '));
  });
  if (o.paired.n) L.push('Paired pass/fail over pieces: both pass ' + o.paired.bothPass + ', only G9 ' + o.paired.onlyG9Passes + ', only legacy ' + o.paired.onlyLegacyPasses + ', both fail ' + o.paired.bothFail + ' (McNemar exact p=' + o.paired.mcnemarExactP + ')');
  Object.keys(o.strata).forEach(name => {
    L.push('Split ' + name + ' (descriptive, no p-values):');
    Object.keys(o.strata[name]).forEach(label => {
      const s = o.strata[name][label], pr = s.preference;
      L.push('  ' + label + ': ' + s.items + ' items / ' + s.pieces + ' pieces; preferred G9 ' + pr.g9 + ', legacy ' + pr.legacy + ', same ' + pr.noDifference + ', unrated ' + pr.unrated +
        '; G9 pass ' + s.pass.g9.pass + '/fail ' + s.pass.g9.fail + ', legacy pass ' + s.pass.legacy.pass + '/fail ' + s.pass.legacy.fail);
    });
  });
  if (o.confounds) L.push('Confounds: G9 fuller in ' + o.confounds.itemsG9Fuller + ' items, legacy fuller in ' + o.confounds.itemsLegacyFuller + ', similar in ' + o.confounds.itemsSimilarDensity +
    '; mean absolute level miss G9 ' + o.confounds.meanAbsLevelMiss.g9 + ' vs legacy ' + o.confounds.meanAbsLevelMiss.legacy + '; left-hand notes G9 has beyond legacy = ' + pc(o.confounds.leftHandShareOfG9ExtraNotes) + ' of G9\'s extra notes (over 100% means G9 has fewer right-hand notes)');
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
