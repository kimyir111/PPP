'use strict';
/* toMusicXml writes its MusicXML from a ScoreGraph (G01 §15.3, Step 7): the graph of every G0 golden input,
   its performance layer, the warnings it must carry, the way back (opts.legacyWriter) and the browser path
   (A40, A41, A42, A43). The G0 benchmark checks the MusicXML itself (golden, core, ab, mutation-check). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { REPO, SG, json, codes } = require('./helpers.js');

const A = require(path.join(REPO, 'audio-score.js'));
const INPUTS = path.join(REPO, 'tests', 'bench', 'golden', 'inputs');
const GOLDEN = path.join(__dirname, 'golden');
const KEYS = fs.readdirSync(INPUTS).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
const input = key => json(path.join(INPUTS, key + '.json'));
const cache = new Map();
function run(key) {
  if (!cache.has(key)) { const d = input(key); cache.set(key, A.toMusicXml(d.input, d.opts || {})); }
  return cache.get(key);
}
const compound = stats => stats.beatType >= 8 && stats.beatsPerBar % 3 === 0;

/* seconds to µs by G01 §6.10, written here from the rule (exact decimal value, round half up) */
function micros(x) {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(x));
  const frac = m[2] || '';
  let n = BigInt(m[1] + frac) * 1000000n, d = 10n ** BigInt(frac.length);
  const e = m[3] ? Number(m[3]) : 0;
  if (e > 0) n *= 10n ** BigInt(e); else if (e < 0) d *= 10n ** BigInt(-e);
  return Number((2n * n + d) / (2n * d));
}
/* audio-score.js's clean(), from G00 §1.2: what counts as a heard note */
function cleaned(notes) {
  return (notes || []).filter(n => n && isFinite(n.on) && isFinite(n.off) && n.midi >= 21 && n.midi <= 108)
    .filter(n => (n.vel == null ? 64 : n.vel) >= 8)
    .map(n => ({ on: Math.max(0, +n.on), off: Math.max(+n.on + 0.03, +n.off), midi: n.midi | 0, vel: n.vel == null ? 64 : +n.vel }));
}
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOf = p => 12 * (p.oct + 1) + PC[p.step] + (p.alter || 0);

test('the 17 golden inputs give graphs with no error, byte for byte the committed ones (A40)', () => {
  assert.equal(KEYS.length, 17);
  KEYS.forEach(key => {
    const r = run(key);
    assert.ok(r.graph, key + ': a graph');
    assert.deepEqual(r.graphIssues.filter(i => i.severity === 'ERROR'), [], key);
    assert.equal(SG.validate(r.graph).ok, true, key);
    assert.equal(SG.serialize(r.graph), fs.readFileSync(path.join(GOLDEN, key + '.sg.json'), 'utf8'), key + ': the graph changed; ' +
      'if that is meant, run node tests/scoregraph/tools/make-golden.js and commit the diff');
    const want = json(path.join(GOLDEN, key + '.issues.json'));
    assert.deepEqual(codes(r.graphIssues, 'WARNING'), want.warnings, key + ' warnings');
    assert.deepEqual(codes(r.graphIssues, 'INFO'), want.infos, key + ' infos');
  });
});

test('the same input gives the same graph and file twice, and in another process (A40)', () => {
  const d = input('G11');
  const a = A.toMusicXml(d.input, d.opts), b = A.toMusicXml(d.input, d.opts);
  assert.equal(SG.serialize(a.graph), SG.serialize(b.graph));
  assert.equal(a.xml, b.xml);
  const child = execFileSync(process.execPath, ['-e', `
    const A = require(${JSON.stringify(path.join(REPO, 'audio-score.js'))});
    const d = JSON.parse(require('fs').readFileSync(${JSON.stringify(path.join(INPUTS, 'G11.json'))}, 'utf8'));
    process.stdout.write(A.toMusicXml(d.input, d.opts).xml);`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.equal(child, a.xml);
});

test('the graph names audio-score.js as its one source, inferred by default, with no per-entity provenance (A28)', () => {
  KEYS.forEach(key => {
    const g = run(key).graph;
    assert.equal(g.provenance.sources.length, 1, key);
    const src = g.provenance.sources[0];
    assert.equal(src.kind, 'audio-score', key);
    assert.equal(src.tool, 'audio-score.js', key);
    assert.deepEqual(g.provenance.default, { src: src.id, op: 'inferred' }, key);
    assert.ok(!/"prov":/.test(SG.serialize(g)), key + ': an entity carries its own prov');
    const head = g.parts[0].events.find(e => e.heads).heads[0];
    assert.equal(SG.prov.provOf(g, head.id).op, 'inferred', key);
  });
});

test('the performance layer holds what was heard (A41)', () => {
  let checked = 0;
  KEYS.forEach(key => {
    const d = input(key), r = run(key), g = r.graph;
    if (!d.input.notes) return;                       /* a grid input (G14) has no heard notes */
    checked++;
    const pf = g.performances.find(p => p.kind === 'source');
    assert.ok(pf, key);
    /* (a) one PerfNote per note after clean: its µs, velocity and pitch */
    const want = cleaned(d.input.notes).map(n => [micros(n.on), micros(n.off), Math.max(1, Math.min(127, Math.round(n.vel))), n.midi].join(' ')).sort();
    const got = (pf.notes || []).map(n => [n.on, n.off, n.vel, n.midi].join(' ')).sort();
    assert.deepEqual(got, want, key + ' (a)');
    /* (b) every head a tie does not continue is linked; (c) a link's pitch is the head's */
    const heads = new Map();
    g.parts[0].events.forEach(e => (e.heads || []).forEach(h => heads.set(h.id, h)));
    const tieTo = new Set(g.parts[0].spanners.filter(s => s.type === 'tie' && s.to).map(s => s.to));
    const linked = new Set();
    pf.notes.forEach(n => {
      if (!n.link) return;
      linked.add(n.link);
      assert.equal(midiOf(heads.get(n.link).pitch), n.midi, key + ' (c) ' + n.id);
    });
    heads.forEach((h, id) => { if (!tieTo.has(id)) assert.ok(linked.has(id), key + ' (b) ' + id + ' has no heard note'); });
    /* (d) a bar anchor at every bar line the recording has (stats.barStarts, to the millisecond), none before it */
    const ms = g.timeline.measures, idx = new Map(ms.map((m, i) => [m.id, i]));
    const anchors = (pf.anchors || []).filter(a => a.kind === 'bar');
    const at = anchors.map(a => idx.get(a.m) + (a.at === '0' ? 0 : 1));
    assert.deepEqual(at, at.slice().sort((x, y) => x - y), key + ' (d) in bar order');
    r.stats.barStarts.forEach((sec, i) => {
      const k = at.indexOf(i);
      if (sec > 0.001) {
        assert.ok(k >= 0, key + ' (d) bar line ' + i + ' has no anchor');
        assert.ok(Math.abs(anchors[k].us - sec * 1e6) <= 500, key + ' (d) bar line ' + i + ': ' + anchors[k].us + ' vs ' + sec);
      } else if (sec < -0.001) assert.equal(k, -1, key + ' (d) bar line ' + i + ' is before the recording');
    });
    assert.equal(anchors.length, r.stats.barStarts.filter(s => s >= 0).length, key + ' (d) count');
  });
  assert.equal(checked, 16);
});

test('the graph carries the writer\'s known issues as warnings (A42)', () => {
  KEYS.forEach(key => {
    const r = run(key), w = codes(r.graphIssues, 'WARNING');
    /* issue 1: a compound tempo prints dotted quarter = the quarter tempo */
    assert.equal(!!w['W-TEMPO-MARK-MISMATCH'], compound(r.stats), key);
    if (w['W-TEMPO-MARK-MISMATCH']) assert.equal(w['W-TEMPO-MARK-MISMATCH'], 1, key);
  });
  /* issue 19 (a rest inside a triplet printed with its plain value): the count against the MusicXML is
     tests/bench/unit/test_scoregraph_vertical.py, which reads the files itself */
});

test('opts.legacyWriter is the way back: the G0 writer, the same stats, no graph (G01 §15.3)', () => {
  const d = input('G03');
  const sg = run('G03'), legacy = A.toMusicXml(d.input, Object.assign({}, d.opts, { legacyWriter: true }));
  assert.deepEqual(legacy.stats, sg.stats);
  assert.equal(legacy.graph, undefined);
  assert.equal(legacy.graphIssues, undefined);
  assert.match(legacy.xml, /^<\?xml[^\n]*\n<score-partwise version="3.1">/);
  assert.match(sg.xml, /<score-partwise version="4.0">/);
  /* the way back does not need the library: it never loads it */
  const loaded = execFileSync(process.execPath, ['-e', `
    const A = require(${JSON.stringify(path.join(REPO, 'audio-score.js'))});
    const d = JSON.parse(require('fs').readFileSync(${JSON.stringify(path.join(INPUTS, 'G03.json'))}, 'utf8'));
    A.toMusicXml(d.input, Object.assign({}, d.opts, { legacyWriter: true }));
    process.stdout.write(String(Object.keys(require.cache).some(f => f.includes('scoregraph'))));`], { encoding: 'utf8' });
  assert.equal(loaded, 'false');
});

test('in the browser, audio-score.js uses the PPPScoreGraph the scripts before it left (A43)', () => {
  const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8');
  const srcs = [...html.matchAll(/<script src="\.\/((?:scoregraph\/[\w-]+|audio-score)\.js)\?v=[^"]*"><\/script>/g)].map(m => m[1]);
  const i = srcs.indexOf('audio-score.js');
  assert.ok(i > 0, 'the app loads audio-score.js after the scoregraph scripts');
  const order = srcs.slice(0, i);
  assert.deepEqual(order.slice().sort(), fs.readdirSync(path.join(REPO, 'scoregraph')).filter(f => f.endsWith('.js')).map(f => 'scoregraph/' + f).sort());
  assert.equal(order[order.length - 1], 'scoregraph/index.js');
  const ctx = vm.createContext({});
  srcs.slice(0, i + 1).forEach(f => vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }));
  const d = input('G02');
  ctx.job = JSON.stringify(d);
  const xml = vm.runInContext('(() => { const d = JSON.parse(job); return PPPAudioScore.toMusicXml(d.input, d.opts).xml; })()', ctx);
  assert.equal(xml, run('G02').xml);
  /* a cached old library is refused, not used (G01 §19 R10) */
  const old = vm.createContext({});
  srcs.slice(0, i).forEach(f => vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), old, { filename: f }));
  vm.runInContext('PPPScoreGraph = Object.assign({}, PPPScoreGraph, { version: "0.9.0" })', old);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'audio-score.js'), 'utf8'), old, { filename: 'audio-score.js' });
  old.job = ctx.job;
  assert.throws(() => vm.runInContext('(() => { const d = JSON.parse(job); return PPPAudioScore.toMusicXml(d.input, d.opts); })()', old), /reload the page/);
});

test('the app HTML differs from the G1 base commit only by the added script tags (A43)', () => {
  const diff = execFileSync('git', ['diff', '--no-color', '-U0', 'aff7080', '--', 'Piano Coach App.dc.html'], { cwd: REPO, encoding: 'utf8' });
  const changed = diff.split('\n').filter(l => /^[-+]/.test(l) && !/^(---|\+\+\+) /.test(l)).map(l => l.replace(/\r$/, ''));
  assert.ok(changed.length > 0);
  changed.forEach(l => assert.match(l, /^\+<script src="\.\/scoregraph\/[\w-]+\.js\?v=\d+"><\/script>$/));
});
