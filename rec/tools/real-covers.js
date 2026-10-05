#!/usr/bin/env node
/* ============================================================================
   PPP rec/ (G10a-1b) - the private real-cover tier of the time skeleton (docs/GOALS/G10_AUDIO_TO_SCORE.md section 28)

     node rec/tools/real-covers.js --heard DIR [--truth FILE] [--json OUT] [--repeat K]

   Reads every `<id>.json` of DIR that holds heard notes in the shape of the app's PPP.app._heard ({notes: [{on, off, midi, vel}],
   duration, engine, ...}: what review/h10/collect.js writes), converts each one the way the page does (review/lib/appcode.js
   convertHeard: Import.finishHeard's own options read out of the page, classic and v2, and the page's plausibility step), and
   prints per piece: the classic and the v2 metre, tempo and bars, the v2 skeleton's metre posterior, its swing and its bar
   phase, and the verdict against the TRUTH file. The truth is a person's statement, never the notes: {"format":
   "ppp-real-truth/1", "items": {"<id>": {"metre": "4/4", "source": "who said so, when"}}}; a piece without an item is reported
   as unconfirmed. Default truth file: DIR/truth.json (optional).

   REAL USER MATERIAL STAYS PRIVATE (G10-D15): the heard notes, their titles and links never enter the repository. This tool
   refuses a DIR, a truth file or an output inside this repository, prints ids only (no title, no link) and writes nothing
   unless --json is given (outside the repository).

   --repeat K   each piece is also converted played K times in a row (its notes copied, each copy one heard span later): a
                reading should not depend on how often a piece repeats (section 28; the length cause).

   Exit: 0 when every confirmed piece is read in its confirmed metre by v2, 1 when one is not, 2 on an error.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

function insideRepo(p) {
  const rel = path.relative(REPO, path.resolve(p));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function heardFiles(dir) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => {
    let j = null;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return null; }
    return j && Array.isArray(j.notes) && j.notes.length ? { id: f.replace(/\.json$/, ''), heard: j } : null;
  }).filter(Boolean);
}

/* the heard notes played k times in a row, each copy one span (first onset to last release) later */
function repeatedHeard(heard, k) {
  if (!(k > 1)) return heard;
  let first = Infinity, last = -Infinity;
  heard.notes.forEach(n => { first = Math.min(first, n.on); last = Math.max(last, n.off); });
  const span = last - first + 0.5, notes = [];
  for (let j = 0; j < k; j++) heard.notes.forEach(n => notes.push(Object.assign({}, n, { on: n.on + j * span, off: n.off + j * span })));
  return Object.assign({}, heard, { notes: notes, duration: (heard.duration || last) + (k - 1) * span });
}

function describe(built) {
  if (!built || !built.stats) return null;
  const st = built.stats;
  const out = { metre: st.beatsPerBar + '/' + st.beatType, tempo: Math.round(st.tempo * 10) / 10, bars: st.bars };
  const sk = built.recReport;
  if (sk) {
    out.posterior = sk.metrePosterior ? sk.metrePosterior[sk.metre.key] : null;
    out.conf = sk.conf;
    out.swing = sk.report && sk.report.chosen ? sk.report.chosen.swing || 0 : 0;
    out.model = sk.model ? sk.model.name + '@' + sk.model.version : null;
  }
  return out;
}

function main() {
  const dir = opt('--heard');
  if (!dir) { console.error('usage: node rec/tools/real-covers.js --heard DIR [--truth FILE] [--json OUT] [--repeat K]'); return 2; }
  const truthPath = opt('--truth') || path.join(dir, 'truth.json');
  const jsonOut = opt('--json');
  const repeat = +(opt('--repeat') || 1);
  for (const [what, p] of [['--heard', dir], ['--truth', truthPath], ['--json', jsonOut]]) {
    if (p && insideRepo(p)) { console.error('PRIVATE_IN_REPO: ' + what + ' must be outside the repository (real user material stays private, G10-D15)'); return 2; }
  }
  const APP = require(path.join(REPO, 'review', 'lib', 'appcode.js'));
  const truth = fs.existsSync(truthPath) ? JSON.parse(fs.readFileSync(truthPath, 'utf8')).items || {} : {};
  const pieces = heardFiles(dir);
  if (!pieces.length) { console.error('no heard notes in ' + dir); return 2; }
  const rows = [];
  let confirmed = 0, v2Right = 0, classicRight = 0;
  pieces.forEach(({ id, heard }) => {
    const h = repeatedHeard(heard, repeat);
    const classic = describe(APP.convertHeard(h, id, false).built);
    const v2run = APP.convertHeard(h, id, true);
    const v2 = describe(v2run.built);
    if (v2) { v2.pipeline = v2run.v2 ? 'v2' : 'classic'; v2.rejected = v2run.rejected; }
    const want = truth[id] && truth[id].metre;
    const row = { id: id, notes: heard.notes.length, seconds: Math.round(h.duration || 0), repeat: repeat, classic: classic, v2: v2, truth: want || null };
    if (want) {
      confirmed++;
      row.v2Ok = !!(v2 && v2.pipeline === 'v2' && v2.metre === want);
      row.classicOk = !!(classic && classic.metre === want);
      v2Right += row.v2Ok; classicRight += row.classicOk;
    }
    rows.push(row);
    const c = classic ? classic.metre + ' at ' + classic.tempo + ', ' + classic.bars + ' bars' : 'none';
    const v = v2 ? v2.metre + ' at ' + v2.tempo + ', ' + v2.bars + ' bars' + (v2.swing ? ', swung ' + v2.swing : '') +
      (v2.posterior != null ? ', posterior ' + v2.posterior : '') + (v2.pipeline !== 'v2' ? ' (the page kept the classic result' + (v2.rejected ? ': implausible v2' : '') + ')' : '') : 'none';
    console.log(id.padEnd(6) + ' ' + String(heard.notes.length).padStart(5) + ' notes ' + String(row.seconds).padStart(4) + ' s | classic ' + c + ' | v2 ' + v +
      ' | truth ' + (want ? want + ' -> v2 ' + (row.v2Ok ? 'ok' : 'WRONG') + ', classic ' + (row.classicOk ? 'ok' : 'WRONG') : 'unconfirmed'));
  });
  console.log('confirmed ' + confirmed + ': v2 right ' + v2Right + ', classic right ' + classicRight + (repeat > 1 ? ' (each piece played ' + repeat + ' times)' : ''));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ format: 'ppp-real-covers/1', repeat: repeat, rows: rows }, null, 1) + '\n');
  return v2Right === confirmed ? 0 : 1;
}

if (require.main === module) {
  let code = 2;
  try { code = main(); } catch (e) { console.error(e && e.stack || e); code = 2; }
  process.exit(code);
}
module.exports = { repeatedHeard, insideRepo, describe };
