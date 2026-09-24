'use strict';
/* G3's mutations the transcription benchmark cannot see (docs/GOALS/G03 §20.5 (7), (8); A37).

   `run.py mutation-check` plants six G3 defects in the passes and requires the benchmark to call each a REGRESSION
   (tests/bench/pppbench/mutation.py, G3_MUTATIONS). Two of §20.5's cannot be seen that way: (7) a critic that misses
   a one-tick onset move hands back a pass's damage only when a pass does damage, which no pass does on purpose, and
   A7 is the test that plants it; (8) the benchmark transcribes audio, so it has no imported slur to lose. Both are
   planted here in a copy of scoregraph/ (loaded fresh, the real library untouched), and the check that must notice
   is run against the mutant: A7b's planted onset for (7), a forced imported score's slur for (8) (A30). The control
   shows the same checks pass on the real library.

   (7) is planted as a critic that reads positions only to the beat. A one-tick move, as §20.5 words it, cannot show
   whether the fingerprint works: it always leaves a length no value prints, and the validation behind the critic
   catches that whatever the fingerprint says (asserted below). A7b's onset a 16th late prints cleanly, so only the
   fingerprint can see it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPO, SG } = require('./helpers.js');
const { mk } = require('./g3-helpers.js');

const SRC = path.join(REPO, 'scoregraph');
const roots = [];
function mutant(file, find, replace) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-g3-mutant-'));
  roots.push(dir);
  fs.readdirSync(SRC).filter(f => f.endsWith('.js')).forEach(f => fs.copyFileSync(path.join(SRC, f), path.join(dir, f)));
  const at = path.join(dir, file);
  /* read as lines and joined with \n: a Windows checkout has \r\n (see mutation.test.js) */
  const before = fs.readFileSync(at, 'utf8').split('\r\n').join('\n');
  const count = before.split(find).length - 1;
  assert.equal(count, 1, file + ': the anchor ' + JSON.stringify(find.slice(0, 60)) + ' matches ' + count + ' times, not once');
  fs.writeFileSync(at, before.replace(find, replace));
  return require(path.join(dir, 'index.js'));
}
test.after(() => roots.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { void e; } }));

/* A fake pass that may change pieces and rests only and moves D5's onset: 'tick' as A7's first case (C5 lengthened
   one tick), '16th' as A7b's (D5 a 16th late, the gap a rest) */
function onsetPlanted(kind) {
  const g = mk({ rh: 'C5:q D5:q E5:q F5:q | G5:h r:h', lh: 'C3:w | C3:w', perf: true });
  const pass = {
    name: 'plant-onset-' + kind, may: ['pieces', 'rests'],
    run(graph) {
      const doc = JSON.parse(SG.serialize(graph));
      const p = doc.parts[0], evs = p.events.filter(e => e.kind === 'note');
      const c = evs.find(e => e.heads[0].pitch.step === 'C'), d = evs.find(e => e.heads[0].pitch.step === 'D');
      if (kind === 'tick') { c.dur = '25/96'; d.at = '25/96'; d.dur = '23/96'; }
      else {
        d.at = '5/16'; d.dur = '3/16'; d.display = { type: 'eighth', dots: 1 };
        p.events.push({ id: 'e' + doc.nextId++, kind: 'rest', m: d.m, at: '1/4', dur: '1/16', voice: d.voice, staff: d.staff, display: { type: '16th' } });
      }
      doc.rev += 1;
      return { graph: SG.seal(doc).graph, idMap: {}, changes: [] };
    }
  };
  return { g: g, pass: pass };
}
/* A7's check: does strict mode throw the critic's error? */
const criticCatches = (lib, kind) => {
  const { g, pass } = onsetPlanted(kind);
  try { lib.professionalize(g, { strict: true, passList: [pass] }); return false; } catch (e) { return e.code === 'E-G3-CRITIC'; }
};

/* An imported score, forced (§14): tied pieces R-repr merges under a slur from the first note to the last piece */
function slurred() {
  const doc = JSON.parse(SG.serialize(mk({ rh: 'C5:8~ C5:8 D5:q E5:8~ E5:8 F5:q', op: 'imported' })));
  const p = doc.parts[0];
  const n = p.events.filter(e => e.kind === 'note');
  p.spanners.push({ id: 's' + doc.nextId++, type: 'slur', from: n[0].id, to: n[4].id });
  return SG.seal(doc).graph;
}
/* A30's check: the forced run merges the pieces and the slur still runs from C5 to where E5 ends */
const slurKept = lib => {
  const g = slurred();
  let out;
  try { out = lib.professionalize(g, { mode: 'force', strict: true }).graph; } catch (e) { return false; }
  const s = out.parts[0].spanners.find(x => x.type === 'slur');
  const ev = id => out.parts[0].events.find(e => e.id === id);
  return !!s && s.from !== undefined && s.to !== undefined && ev(s.from).at === '0' && ev(s.to).at === '1/2' &&
    out.parts[0].events.filter(e => e.kind === 'note').length === 4;
};

test('control: on the real library A7 catches the planted onset and A30 keeps the imported slur', () => {
  assert.equal(criticCatches(SG, 'tick'), true);
  assert.equal(criticCatches(SG, '16th'), true);
  assert.equal(slurKept(SG), true);
});

test('G3-CRITIC-ONSET-BLIND (§20.5 (7)): a critic that reads positions to the beat misses a moved onset, and A7b fails', () => {
  const lib = mutant('pro-critic.js',
    'let v = textCache.get(k); if (v === undefined) { v = R.format(r); textCache.set(k, v); } return v; };',
    'let v = textCache.get(k); if (v === undefined) { v = R.format(R.make(Math.round(r.n * 4 / r.d), 4)); textCache.set(k, v); } return v; };');
  assert.equal(criticCatches(lib, '16th'), false, 'the blind critic lets the moved onset through: A7b would fail');
  /* the one-tick move is still stopped, by the validation (an unprintable length), not by the blind fingerprint */
  assert.equal(criticCatches(lib, 'tick'), true);
});

test('G3-SLUR-ANCHOR-DROP (§20.5 (8)): a retime that loses the end of a slur it touches is not a rewrite A30 accepts', () => {
  const lib = mutant('ops.js',
    '            if (sp.to !== undefined && oldInfo.has(sp.to)) sp.to = endEvent(sp.to);',
    '            if (sp.to !== undefined && oldInfo.has(sp.to)) delete sp.to;');
  assert.equal(slurKept(lib), false, 'the imported slur lost its end: A30 would fail');
  /* and outside strict mode the critic still hands the measure back as it came (the anchor is a marks component) */
  const r = lib.professionalize(slurred(), { mode: 'force' });
  assert.ok(r.report.issues.some(i => i.code === 'N-G3-ROLLBACK'), 'the loss is rolled back and reported');
});
