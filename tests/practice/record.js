/* G11a-0: the LEGACY RECORDER. What today's practice engines do with every catalogue piece, written down as a committed baseline
   (tests/practice/baselines/legacy.json), so that anything that changes the legacy player, matcher or follow gates - an edit of the app file, or
   the graph plan that is to stand beside it (G11a-1/2) - is seen at once, with the file and the part that moved.

   For each of the catalogue's 325 MusicXML files and the 69 committed fixtures (tests/engrave/fixtures/e: pedal changes, 8va, graces, jumps,
   arpeggios; tests/scoregraph/fixtures/xml, some of which the reader refuses, which is recorded too), read through the app's own door
   (PPP.scoreFromXml), the recorder canonicalises (canon.js) and hashes:
     plan     PianoScore.build over the whole piece: visits, strikes (q, upQ, midi, vel, hand, measure), pedal CCs, beats, tempo map
     win      the same for up to 20 seeded four-bar loop windows (the ones ending on a backward repeat and starting in a volta first)
     begin    PerformanceEngine.begin's expected list (midi, hand, measure, tMs, arpeggio) for the whole piece and every window x 3 hands x tempo 1, 0.5
     match    the matcher's verdicts: six scripted performances (perfect, +80 ms, a wrong key every 7th note, 10 % missed, chords rolled over 60 ms,
              an arpeggio 300 ms late) on the whole piece (3 hands x tempo 1 and 0.5) and on every window (both hands, tempo 1) - every result
              object, per measure and hand, and every note's own verdict and signed timing
     gates    follow mode's gates for the whole piece and every window x 3 hands (the app's own followGates)
   A digest is two 32-bit hashes of the canonical JSON; the baseline holds digests and counts, not the dumps (a dump of the catalogue is some 60 MB).
   The licence-quarantined scores (tests/bench/corpus/provenance.json, 15 of the catalogue) are measured but only their totals and one digest of
   the lot are written.

     node tests/practice/record.js check                  compare with the baseline; exit 1 on any difference
     node tests/practice/record.js check --quick          only the baseline's `quick` files (small, one or more of every notation feature)
     node tests/practice/record.js record                 rewrite tests/practice/baselines/legacy.json (do this when the catalogue or the legacy player
                                                          is CHANGED ON PURPOSE; the diff of the file is the review)
     node tests/practice/record.js dump catalog/hymns/for-all-the-saints.musicxml [--from 5 --to 8 --hands right --tempo 0.5 --stream late80]
                                                          print the canonical plan, expected list, result and gates of one piece (to see what a digest hides)
   Options: --url URL (a page already served, e.g. the mutation proxy; default: this tree on a free port), --only SUBSTR, --windows N. */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const Canon = require('./canon');

const BASELINE = path.join(__dirname, 'baselines', 'legacy.json');
const DEFAULTS = { windows: 20, beginWindows: 20, matchWindows: 20 };
const FEATURES = ['repeat', 'volta', 'pedalChange', 'otherPedal', 'pedal', 'tempoChange', 'arpeggio', 'tie', 'ottava', 'compound', 'pickup', 'wedge', 'dynamics', 'cue'];
const PERF_PIECE = 'catalog/method/sonatina/020.mxl';
const BATCH = 12;

/* ---- in the page: one piece -> its record. Self-contained: it is serialised into the browser. ---- */
async function recordInPage(items, opts) {
  const C = window.PPPPracticeCanon, PPP = window.PPP, Score = PPP.Score, PS = PPP.PianoScore;
  const proto = Object.getPrototypeOf(PPP.app);
  const gatesOf = (score, from, to, hands) => {
    const fake = { state: { score: score, hands: hands, screen: 'practice', loop: true, loopFrom: from, loopTo: to, practiceMode: 'practice' },
      range: proto.range, handOk: proto.handOk, _gatesKey: null, _gates: null };
    return proto.followGates.call(fake);
  };
  const out = [];
  for (const item of items) {
    const file = item.file;
    const rec = { file: file };
    try {
      let xml = item.text;
      if (xml == null) {
        const res = await fetch('/' + file);
        xml = /\.mxl$/.test(file) ? await PPP.readMxl(await res.arrayBuffer()) : await res.text();
      }
      const score = PPP.scoreFromXml(xml, file.split('/').pop());
      const first = Score.first(score), last = Score.last(score), base = score.tempo || 84;
      const wins = C.windows(score, opts.windows, C.cyrb64(file)[1]);

      const whole = PS.build(score, first, last);
      rec.n = score.notes.filter(n => !n.rest).length;
      rec.m = score.measures.length;
      rec.v = whole.visits.length;
      rec.s = whole.strikes.length;
      rec.c = whole.ccs.length;
      rec.bt = whole.beats.length;
      rec.w = wins.length;
      rec.p = C.digest(JSON.stringify(C.planOf(whole)));
      rec.pw = C.digest(wins.map(w => C.digest(JSON.stringify(C.planOf(PS.build(score, w.from, w.to))))).join(','));

      const ranges = [{ from: first, to: last }].concat(wins.slice(0, opts.beginWindows));
      const begins = [];
      ranges.forEach(r => ['both', 'right', 'left'].forEach(h => [1, 0.5].forEach(sc => {
        const eng = new PPP.PerformanceEngine(score);
        eng.begin({ from: r.from, to: r.to, hands: h, tempo: base * sc, startedAt: 0 });
        begins.push(JSON.stringify(C.expectedOf(eng.expected)));
      })));
      rec.b = C.digest(begins.join('|'));

      const verdicts = [];
      const run = (r, hands, sc, kind) => {
        const eng = new PPP.PerformanceEngine(score);
        eng.begin({ from: r.from, to: r.to, hands: hands, tempo: base * sc, startedAt: 0 });
        const result = C.replay(eng, C.streamEvents(eng.expected, kind));
        verdicts.push(JSON.stringify(C.outcomeOf(eng, result)));
        return result;
      };
      const all = { from: first, to: last };
      rec.mt = C.STREAMS.map(k => run(all, 'both', 1, k).counts.matched);
      rec.e = new PPP.PerformanceEngine(score).begin({ from: first, to: last, hands: 'both', tempo: base, startedAt: 0 }).expected.length;
      ['both', 'right', 'left'].forEach(h => [1, 0.5].forEach(sc => { if (h === 'both' && sc === 1) return; C.STREAMS.forEach(k => run(all, h, sc, k)); }));
      wins.slice(0, opts.matchWindows).forEach(w => C.STREAMS.forEach(k => run(w, 'both', 1, k)));
      rec.r = C.digest(verdicts.join('|'));

      const gates = [];
      ranges.forEach(r => ['both', 'right', 'left'].forEach(h => gates.push(JSON.stringify(C.gatesOf(gatesOf(score, r.from, r.to, h))))));
      rec.g = C.digest(gates.join('|'));
      rec.ng = gatesOf(score, first, last, 'both').length;
      rec.f = Object.keys(C.featuresOf(score)).sort().join(',');
    } catch (e) {
      rec.error = String(e && (e.code || e.message) || e).slice(0, 120);
    }
    out.push(rec);
  }
  return out;
}

async function recordAll(page, items, opts, onBatch) {
  const out = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const part = await page.evaluate(recordInPage, items.slice(i, i + BATCH).map(c => ({ file: c.path, text: c.text })), opts);
    part.forEach(r => out.push(r));
    if (onBatch) onBatch(out.length, items.length);
  }
  return out;
}

/* ---- the baseline ---- */
const SUMS = ['n', 'm', 'v', 's', 'c', 'bt', 'w', 'e', 'ng'];
const KEEP = ['n', 'm', 'v', 's', 'c', 'bt', 'w', 'e', 'ng', 'p', 'pw', 'b', 'r', 'g', 'mt', 'f'];
function totalsOf(recs) {
  const ok = recs.filter(r => !r.error);
  const t = { files: recs.length, refused: recs.length - ok.length };
  SUMS.forEach(k => { t[k] = ok.reduce((a, r) => a + (r[k] || 0), 0); });
  t.matched = Canon.STREAMS.map((k, i) => ok.reduce((a, r) => a + ((r.mt || [])[i] || 0), 0));
  return t;
}
/* one digest of the licence-quarantined lot (their paths are not part of it) */
const lotDigest = recs => Canon.digest(recs.map(r => [r.p, r.pw, r.b, r.r, r.g].join(':')).join('|'));

function assemble(recs, corp, opts) {
  const by = new Map(corp.map(c => [c.path, c]));
  const open = recs.filter(r => !by.get(r.file).quarantined), shut = recs.filter(r => by.get(r.file).quarantined);
  const files = {};
  open.forEach(r => {
    if (r.error) { files[r.file] = { x: r.error }; return; }
    const o = {};
    KEEP.forEach(k => { if (r[k] !== undefined) o[k] = r[k]; });
    files[r.file] = o;
  });
  const sets = {};
  ['catalog', 'engrave-e', 'scoregraph-xml'].forEach(set => { sets[set] = totalsOf(open.filter(r => by.get(r.file).set === set)); });
  const quarantined = totalsOf(shut);
  quarantined.digest = lotDigest(shut);
  return {
    schema: 1,
    about: 'G11a-0 legacy recorder (tests/practice/record.js): digests of the legacy player, matcher and follow gates over the catalogue and the committed fixtures. Rewritten by `node tests/practice/record.js record`; read the diff.',
    options: { windows: opts.windows, beginWindows: opts.beginWindows, matchWindows: opts.matchWindows, streams: Canon.STREAMS },
    sets: sets,
    quarantined: quarantined,
    quick: pickQuick(open),
    files: files
  };
}

/* a small set: every notation feature in the smallest file that has it, and the piece the perf probe uses */
function pickQuick(open) {
  const chosen = new Set();
  const good = open.filter(r => !r.error);
  const feat = r => (r.f ? r.f.split(',') : []);
  FEATURES.forEach(f => {
    const have = good.filter(r => feat(r).indexOf(f) >= 0);
    if (!have.length || have.some(r => chosen.has(r.file))) return;
    have.sort((a, b) => a.s - b.s || (a.file < b.file ? -1 : 1));
    chosen.add(have[0].file);
  });
  if (good.some(r => r.file === PERF_PIECE)) chosen.add(PERF_PIECE);
  return [...chosen].sort();
}

function compare(base, recs, corp) {
  const by = new Map(corp.map(c => [c.path, c]));
  const diffs = [];
  const KINDS = { p: 'plan', pw: 'windows', b: 'begin', r: 'matcher', g: 'gates' };
  recs.forEach(r => {
    if (by.get(r.file).quarantined) return;
    const b = base.files[r.file];
    if (!b) { diffs.push(r.file + ': not in the baseline (a new file: run `node tests/practice/record.js record`)'); return; }
    if (b.x || r.error) {
      if (b.x !== r.error) diffs.push(r.file + ': ' + (b.x ? 'was refused (' + b.x + ')' : 'was read') + ', now ' + (r.error ? 'refused (' + r.error + ')' : 'read'));
      return;
    }
    const parts = [];
    Object.keys(KINDS).forEach(k => { if (b[k] !== r[k]) parts.push(KINDS[k]); });
    ['s', 'v', 'c', 'bt', 'w', 'ng'].forEach(k => { if (b[k] !== r[k]) parts.push(k + ' ' + b[k] + ' -> ' + r[k]); });
    if (parts.length) diffs.push(r.file + ': ' + parts.join(', '));
  });
  if (recs.length === corp.length) {                  // the whole corpus: also what is missing, and the quarantined lot
    const have = new Set(recs.map(r => r.file));
    Object.keys(base.files).forEach(f => { if (!have.has(f)) diffs.push(f + ': in the baseline but not in the catalogue (run `record`)'); });
    const shut = recs.filter(r => by.get(r.file).quarantined);
    const qs = totalsOf(shut);
    qs.digest = lotDigest(shut);
    if (JSON.stringify(qs) !== JSON.stringify(base.quarantined)) diffs.push('the licence-quarantined files, together: ' + JSON.stringify(base.quarantined) + ' -> ' + JSON.stringify(qs));
  }
  return diffs;
}

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i < 0 ? dflt : process.argv[i + 1];
}
const flag = name => process.argv.indexOf(name) >= 0;

async function withPage(url, fn) {
  let srv = null;
  if (!url) { srv = await L.serve(); url = srv.url; }
  const app = await L.openApp(url);
  try { return await fn(app.page, url); }
  finally { await app.close(); if (srv) await srv.close(); }
}

function writeBaseline(b) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  /* one line per file: a diff of the baseline reads file by file */
  const head = JSON.stringify(Object.assign({}, b, { files: undefined }), null, 1).replace(/\n}$/, '');
  const body = Object.keys(b.files).map(f => ' ' + JSON.stringify(f) + ': ' + JSON.stringify(b.files[f])).join(',\n');
  fs.writeFileSync(BASELINE, head + ',\n"files": {\n' + body + '\n}\n}\n');
}

async function main() {
  const cmd = process.argv[2];
  const opts = Object.assign({}, DEFAULTS, arg('--windows') ? { windows: +arg('--windows') } : {});
  const corp = L.corpus();
  if (cmd === 'record' || cmd === 'check') {
    let list = corp;
    const only = arg('--only');
    let base = null;
    if (cmd === 'check') {
      base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
      Object.assign(opts, { windows: base.options.windows, beginWindows: base.options.beginWindows, matchWindows: base.options.matchWindows });
      if (flag('--quick')) list = corp.filter(c => base.quick.indexOf(c.path) >= 0);
    } else if (only) throw new Error('--only is for check: a baseline of some files would be wrong');
    if (only) list = list.filter(c => c.path.indexOf(only) >= 0);
    if (!list.length) throw new Error('no file selected');
    const t0 = Date.now();
    const recs = await withPage(arg('--url'), page => recordAll(page, list, opts, (done, all) => {
      if (done === all || done % 120 < BATCH) process.stdout.write('  ' + done + '/' + all + ' files, ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s\n');
    }));
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (cmd === 'record') {
      const by = new Map(corp.map(c => [c.path, c]));
      const bad = recs.filter(r => r.error && by.get(r.file).set === 'catalog');
      if (bad.length) { bad.forEach(r => console.log('  ' + r.file + ': ' + r.error)); throw new Error(bad.length + ' catalogue files could not be read; nothing written'); }
      const b = assemble(recs, corp, opts);
      writeBaseline(b);
      console.log('recorded ' + recs.length + ' files in ' + secs + ' s -> ' + path.relative(L.ROOT, BASELINE));
      Object.keys(b.sets).forEach(k => console.log('  ' + k + ': ' + JSON.stringify(b.sets[k])));
      console.log('  quarantined (aggregate only): ' + JSON.stringify(b.quarantined));
      console.log('  quick: ' + b.quick.length + ' files');
      return;
    }
    const diffs = compare(base, recs, corp);
    const t = totalsOf(recs);
    console.log('legacy recorder: ' + recs.length + ' files in ' + secs + ' s' + (flag('--quick') ? ' (quick set)' : '') + ', ' + t.s + ' strikes, ' + t.e + ' expected notes, ' + t.refused + ' refused');
    if (diffs.length) {
      console.log(diffs.length + ' DIFFERENCE(S) from tests/practice/baselines/legacy.json:');
      diffs.slice(0, 40).forEach(d => console.log('  ' + d));
      if (diffs.length > 40) console.log('  ... and ' + (diffs.length - 40) + ' more');
      process.exit(1);
    }
    console.log('every digest equals the baseline');
    return;
  }
  if (cmd === 'dump') {
    const file = process.argv[3];
    const item = corp.find(c => c.path === file);
    if (!item) throw new Error('not a catalogue or fixture path: ' + file);
    const out = await withPage(arg('--url'), page => page.evaluate(async (item, o) => {
      const C = window.PPPPracticeCanon, PPP = window.PPP, Score = PPP.Score;
      let xml = item.text;
      if (xml == null) {
        const res = await fetch('/' + item.path);
        xml = /\.mxl$/.test(item.path) ? await PPP.readMxl(await res.arrayBuffer()) : await res.text();
      }
      const score = PPP.scoreFromXml(xml, item.path.split('/').pop());
      const from = o.from != null ? o.from : Score.first(score), to = o.to != null ? o.to : Score.last(score);
      const base = score.tempo || 84;
      const eng = new PPP.PerformanceEngine(score);
      eng.begin({ from: from, to: to, hands: o.hands, tempo: base * o.tempo, startedAt: 0 });
      const proto = Object.getPrototypeOf(PPP.app);
      const fake = { state: { score: score, hands: o.hands, screen: 'practice', loop: true, loopFrom: from, loopTo: to, practiceMode: 'practice' }, range: proto.range, handOk: proto.handOk };
      return {
        file: item.path, from, to, hands: o.hands, tempo: o.tempo, plan: C.planOf(PPP.PianoScore.build(score, from, to)), expected: C.expectedOf(eng.expected),
        outcome: (() => { const res = C.replay(eng, C.streamEvents(eng.expected, o.stream)); return C.outcomeOf(eng, res); })(), gates: C.gatesOf(proto.followGates.call(fake))
      };
    }, { path: item.path, text: item.text }, { from: arg('--from') != null ? +arg('--from') : null, to: arg('--to') != null ? +arg('--to') : null, hands: arg('--hands', 'both'), tempo: +arg('--tempo', 1), stream: arg('--stream', 'perfect') }));
    console.log(JSON.stringify(out));
    return;
  }
  console.log('usage: node tests/practice/record.js check [--quick] | record | dump <catalogue or fixture path> [--from N --to N --hands both --tempo 1 --stream perfect]');
  process.exit(2);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
module.exports = { recordAll, recordInPage, compare, BASELINE, DEFAULTS, withPage };
