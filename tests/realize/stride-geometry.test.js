/* G9 post-H-8 re-look - the stride geometry of the 'pop' and 'waltz' patterns (realize/patterns.js, realize/theory.js foldAbove).

   The first blind review (H-8) flagged "awkward hand position" on 9 of 16 G9 arrangements: "the distance between the low notes,
   an octave or a tenth, is too far". Measured (docs/GOALS/G09 section 12, "G9 left-hand jumps (post H-8 re-look)"): the bass of
   `pop` and `waltz` sat an octave under the register midpoint while the chord was voice-led around it, so every bass-to-chord and
   chord-to-bass step was an octave or more. The fix voices the chord just above its bass. These tests pin: the voicing bound, the
   floor honoured by the pattern itself, the jump rate on the flagged pieces, and that nothing else changed (source untouched,
   pitch classes, onsets, other patterns, determinism, idempotence). `stride: 'wide'` is the old geometry, kept to measure against. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const SGG = require(path.join(REPO, 'songgraph/index.js'));
const ARR = require(path.join(REPO, 'arrangement/index.js'));
const REALIZE = require(path.join(REPO, 'realize/index.js'));
const PAT = require(path.join(REPO, 'realize/patterns.js'));
const TH = require(path.join(REPO, 'realize/theory.js'));
const PLA = require(path.join(REPO, 'playability/index.js'));
const SER = require(path.join(REPO, 'scoregraph/serialize.js'));
const U = require(path.join(REPO, 'songgraph/util.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const M = require(path.join(REPO, 'critics/metrics.js'));
const LHJ = require(path.join(REPO, 'critics/left-hand-jump.js'));
const RF = require(path.join(REPO, 'critics/register-floor.js'));
const H = require(path.join(REPO, 'tests/engrave/helpers.js'));

/* ---------------------------------------------------------------- foldAbove */
test('foldAbove: every chord tone at its single instance in (bass, bass + 12], ascending, pitch classes kept', () => {
  const quals = Object.keys(TH.CHORD_INTERVALS);
  for (let bass = 36; bass < 60; bass++) {
    for (let root = 0; root < 12; root++) {
      quals.forEach(q => {
        const pcs = TH.targetPcs(root, q, 3);
        const ch = TH.foldAbove(bass, pcs);
        assert.equal(ch.length, new Set(pcs).size, 'one note per distinct pitch class');
        ch.forEach((m, i) => {
          assert.ok(m > bass && m <= bass + 12, 'in (bass, bass+12]: ' + m + ' over ' + bass);
          if (i) assert.ok(m > ch[i - 1], 'ascending');
        });
        assert.deepEqual(new Set(ch.map(m => m % 12)), new Set(pcs), 'pitch classes kept');
        assert.ok(ch[ch.length - 1] - ch[0] <= 11);
        if (pcs.indexOf(bass % 12) >= 0) assert.equal(ch[ch.length - 1], bass + 12, 'the bass\'s own pitch class sits exactly an octave up');
      });
    }
  }
});

test('foldAbove: a triad over its root or fifth has its lowest tone 3..9 above the bass and its span within a sixth', () => {
  ['maj', 'min', 'dim', 'aug'].forEach(q => {
    const pcs = TH.targetPcs(0, q, 3); /* root, third, fifth */
    [0, 7].forEach(bassPc => {
      if (q === 'dim' && bassPc === 7) return; /* a diminished fifth is not 7 semitones */
      if (q === 'aug' && bassPc === 7) return;
      for (let bass = 36; bass < 48; bass++) {
        if (bass % 12 !== bassPc) continue;
        const ch = TH.foldAbove(bass, pcs);
        assert.ok(ch[0] - bass >= 3 && ch[0] - bass <= 9, q + ' over ' + bass + ': ' + ch.join());
        assert.ok(ch[ch.length - 1] - ch[0] <= 9);
      }
    });
  });
});

test('foldAbove: idempotent, deterministic, duplicates collapse, empty in empty out', () => {
  const pcs = [4, 7, 0];
  const a = TH.foldAbove(43, pcs);
  assert.deepEqual(a, TH.foldAbove(43, pcs));
  assert.deepEqual(TH.foldAbove(43, a.map(m => m % 12)), a, 'folding the result again changes nothing');
  assert.deepEqual(TH.foldAbove(43, [0, 0, 7]), TH.foldAbove(43, [0, 7]), 'a repeated pitch class is one note');
  assert.deepEqual(TH.foldAbove(43, []), []);
});

/* ---------------------------------------------------------------- the patterns, on a synthetic progression */
const q = (n, d) => R.make(n, d);
function windowsOf(chords, offsetBars) {
  return chords.map(([root, quality], i) => ({ w0: q(i + 4 * (offsetBars || 0), 4), w1: q(i + 1 + 4 * (offsetBars || 0), 4), root: root, quality: quality, m: 'm' + (offsetBars || 0) }));
}
const PROG = [[0, 'maj'], [5, 'maj'], [7, 'dom7'], [0, 'maj']]; /* C F G7 C, one measure of four beats */
function runBars(name, opts, bars) {
  let prev = null; const events = [];
  for (let b = 0; b < (bars || 6); b++) {
    const r = PAT.run(name, windowsOf(PROG, b), prev, opts);
    prev = r.prevMidis; r.events.forEach(e => events.push(e));
  }
  return events;
}
const OPTS = { anchor: 54, count: 3, maxSpan: 14, floor: 40 };

/* the bound: a chord is within an octave of its measure's bass, and one step (bass to chord) is at most a major sixth */
function strideBounds(events) {
  const out = { chords: 0, topOverBass: [], steps: [] };
  let bass = null, bassAt = null;
  events.forEach(e => {
    if (e.midis.length === 1) { bass = e.midis[0]; return; }
    out.chords++;
    out.steps.push(Math.abs(e.midis[0] - bass));
    out.topOverBass.push(e.midis[e.midis.length - 1] - bass);
  });
  return out;
}

test("pop and waltz ('close'): every chord tone within (its root bass, root bass + 12] and the bass-to-chord step at most a major sixth", () => {
  const CLOSE = Object.assign({}, OPTS, { stride: 'close' });
  ['pop', 'waltz'].forEach(name => {
    const events = runBars(name, CLOSE);
    assert.ok(events.filter(e => e.midis.length > 1).length >= 6, name + ': fixture has chords');
    for (let bar = 0; bar < 6; bar++) {
      const measure = PAT.run(name, windowsOf(PROG, bar), null, CLOSE).events; /* a fresh state: the close geometry does not depend on the previous chord */
      /* the root bass a window's chord is voiced over: pop, its own window's root; waltz, the measure's first window's root */
      const rootBassOf = i => TH.nearestWithPc(PROG[name === 'pop' ? i : 0][0], OPTS.anchor - 12, { lo: OPTS.floor });
      const chordWindows = name === 'pop' ? [1, 3] : [1, 2, 3];
      const chords = measure.filter(e => e.midis.length > 1);
      assert.equal(chords.length, chordWindows.length, name);
      chords.forEach((c, k) => {
        const rb = rootBassOf(chordWindows[k]);
        c.midis.forEach(m => assert.ok(m > rb && m <= rb + 12, name + ' bar ' + bar + ': ' + m + ' over root bass ' + rb));
      });
    }
    let bass = null;
    events.forEach(e => {
      if (e.midis.length === 1) { bass = e.midis[0]; return; }
      assert.ok(Math.abs(e.midis[0] - bass) <= 9, name + ': bass ' + bass + ' to chord ' + e.midis.join());
    });
  });
});

test('pop and waltz (wide, the old geometry) break that bound: the test discriminates', () => {
  ['pop', 'waltz'].forEach(name => {
    const wide = runBars(name, Object.assign({}, OPTS, { stride: 'wide', floor: null }));
    const b = strideBounds(wide);
    assert.ok(Math.max.apply(null, b.topOverBass) > 12 || Math.max.apply(null, b.steps) > 9, name + ': the old geometry put the chord more than an octave over the bass');
  });
});

test('pop and waltz (close): the pattern itself keeps every generated note at or above the floor; floor null is allowed to go lower', () => {
  [40, 43].forEach(floor => ['pop', 'waltz'].forEach(name => {
    [30, 42, 54, 66].forEach(anchor => {
      const events = runBars(name, { anchor: anchor, count: 3, maxSpan: 14, floor: floor });
      events.forEach(e => e.midis.forEach(m => assert.ok(m >= floor, name + ' anchor ' + anchor + ' floor ' + floor + ': ' + m)));
    });
  }));
  const free = runBars('pop', { anchor: 30, count: 3, maxSpan: 14, floor: null });
  assert.ok(Math.min.apply(null, free.map(e => Math.min.apply(null, e.midis))) < 40, 'without a floor the bass follows the register midpoint down');
});

test('pop and waltz: same onsets, durations and pitch classes as the old geometry; only the octaves differ', () => {
  ['pop', 'waltz'].forEach(name => {
    const a = runBars(name, Object.assign({}, OPTS, { floor: null })), b = runBars(name, Object.assign({}, OPTS, { stride: 'wide', floor: null }));
    assert.equal(a.length, b.length);
    a.forEach((e, i) => {
      assert.equal(R.format(e.at), R.format(b[i].at));
      assert.equal(R.format(e.dur), R.format(b[i].dur));
      assert.deepEqual(new Set(e.midis.map(m => m % 12)), new Set(b[i].midis.map(m => m % 12)), name + ' event ' + i);
    });
  });
});

test('the patterns are deterministic, and the other patterns are untouched by the stride option', () => {
  ['pop', 'waltz', 'block', 'broken', 'ballad'].forEach(name => {
    assert.deepEqual(runBars(name, OPTS), runBars(name, OPTS), name);
  });
  ['block', 'broken', 'ballad'].forEach(name => {
    assert.deepEqual(runBars(name, OPTS), runBars(name, Object.assign({}, OPTS, { stride: 'wide' })), name + ': stride does not touch it');
  });
});

/* ---------------------------------------------------------------- the realizer, on the pieces H-8 flagged */
const PIECES = [
  ['catalog/hymns/nearer-my-god.musicxml', 2.4, 'pop'],
  ['catalog/method/beyer/038.mxl', 2.58, 'waltz'],
  ['catalog/method/sonatina/025.mxl', 3.4, 'waltz'],
  ['catalog/hymns/what-child-is-this.musicxml', 3.46, 'waltz'],
  ['catalog/method/burgmuller25/006.mxl', 3.76, 'pop'],
  ['catalog/method/beyer/020.mxl', 2.55, 'waltz']
];
async function fixture(file, level) {
  const g = await H.graphOf(file), sg = SGG.analyze(g);
  const p = ARR.planner.plan(g, sg, { targetLevel: level, handProfile: 'large', sections: 'all' });
  assert.ok(p.ok, file + ': fixture assumption, a plan must be reachable');
  return { g, sg, plan: p.plan, source: M.graphNoteList(g) };
}
function attacks(g) {
  const m = new Map();
  U.noteWindows(g).forEach(n => { const k = n.voiceId + '@' + R.format(n.w0); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(n.pc); });
  return Array.from(m.entries()).map(([k, s]) => k.split('@')[1] + ':' + Array.from(s).sort((a, b) => a - b).join(',')).sort();
}

test('realize: the left-hand jump rate of pop and waltz falls from the flagged range to near zero on the pieces the reviewer flagged', async () => {
  let wideJ = 0, wideS = 0, closeJ = 0, closeS = 0;
  for (const [file, level, pattern] of PIECES) {
    const f = await fixture(file, level);
    const wide = REALIZE.realize(f.g, f.sg, f.plan, { pattern, stride: 'wide', melodyClash: false });
    const close = REALIZE.realize(f.g, f.sg, f.plan, { pattern, melodyClash: false }); /* the geometry is measured without the melody clash guard (which can move a stride bass tone) */
    assert.ok(wide.ok && close.ok, file);
    const w = LHJ.leftHandJump(wide.graph), c = LHJ.leftHandJump(close.graph);
    assert.ok(c.rate < w.rate, file + ': ' + c.rate + ' vs ' + w.rate);
    assert.ok(c.rate <= 0.11, file + ': close rate ' + c.rate + ' stays well under the flagged 18%');
    wideJ += w.jumps; wideS += w.steps; closeJ += c.jumps; closeS += c.steps;
  }
  assert.ok(wideJ / wideS >= 0.15, 'fixture assumption: the old geometry is in the flagged range (' + (wideJ / wideS) + ')');
  assert.ok(closeJ / closeS <= 0.06, 'pooled rate ' + (closeJ / closeS));
});

test('realize: the stride fix keeps the melody, adds no hard violation, and keeps every onset and pitch class', async () => {
  for (const [file, level, pattern] of PIECES.slice(0, 4)) {
    const f = await fixture(file, level);
    const wide = REALIZE.realize(f.g, f.sg, f.plan, { pattern, stride: 'wide' }), close = REALIZE.realize(f.g, f.sg, f.plan, { pattern });
    assert.equal(M.melodyPreservation(M.originalMelodyNotes(f.g, f.plan), M.graphNoteList(close.graph)), 1, file + ': source melody untouched');
    assert.equal(PLA.analyzeGraph(close.graph, { profile: 'large' }).totals.hard, 0, file + ': no G5 hard violation');
    assert.deepEqual(attacks(close.graph), attacks(wide.graph), file + ': same attacks, same pitch classes');
    assert.equal(RF.registerFloor(close.graph, { sourceNotes: f.source }).below, 0, file + ': nothing generated below the floor');
    assert.equal(close.report.floor.eventsDegraded, 0);
    assert.equal(close.report.floor.notesRaised, 0, file + ': the pattern placed its own bass above the floor');
  }
});

test('realize: the register floor still applies to the close geometry (a floor of G2 puts nothing generated below 43)', async () => {
  const f = await fixture('catalog/method/sonatina/025.mxl', 3.4);
  ['pop', 'waltz'].forEach(pattern => {
    const r = REALIZE.realize(f.g, f.sg, f.plan, { pattern, registerFloor: 43 });
    assert.equal(RF.registerFloor(r.graph, { sourceNotes: f.source, floor: 43 }).below, 0, pattern);
    assert.equal(M.melodyPreservation(M.originalMelodyNotes(f.g, f.plan), M.graphNoteList(r.graph)), 1);
  });
});

test('realize: the other patterns are byte-identical whichever stride geometry is asked for', async () => {
  const f = await fixture('catalog/hymns/nearer-my-god.musicxml', 2.4);
  ['block', 'broken', 'ballad', 'hymn'].forEach(pattern => {
    const a = REALIZE.realize(f.g, f.sg, f.plan, { pattern }), b = REALIZE.realize(f.g, f.sg, f.plan, { pattern, stride: 'wide' });
    assert.equal(SER.fingerprint(a.graph), SER.fingerprint(b.graph), pattern);
  });
});

test('realize: deterministic and idempotent (the same inputs give the same graph, byte for byte, call after call)', async () => {
  const f = await fixture('catalog/method/beyer/038.mxl', 2.58);
  ['pop', 'waltz', 'auto'].forEach(pattern => {
    const a = REALIZE.realize(f.g, f.sg, f.plan, { pattern }), b = REALIZE.realize(f.g, f.sg, f.plan, { pattern });
    assert.equal(SER.fingerprint(a.graph), SER.fingerprint(b.graph), pattern);
    assert.deepEqual(a.report, b.report);
  });
});

/* ---------------------------------------------------------------- the default ('open') geometry, and every hand profile */
const SPANS = { small: 10, medium: 12, large: 14 };
const QUALS = Object.keys(TH.CHORD_INTERVALS);
const spanOf = midis => Math.max.apply(null, midis) - Math.min.apply(null, midis);

test('pop and waltz: at every hand profile, every chord event fits the profile span (a synthetic sweep over all roots, qualities, anchors, geometries)', () => {
  let chords = 0;
  Object.keys(SPANS).forEach(profile => ['pop', 'waltz'].forEach(name => ['open', 'close'].forEach(stride => {
    QUALS.forEach(quality => {
      for (let root = 0; root < 12; root++) [30, 42, 48, 54, 66].forEach(anchor => {
        const windows = [0, 1, 2, 3].map(i => ({ w0: q(i, 4), w1: q(i + 1, 4), root: (root + 5 * i) % 12, quality: quality, m: 'm0' }));
        const r = PAT.run(name, windows, null, { anchor: anchor, count: 3, maxSpan: SPANS[profile], floor: 40, stride: stride });
        r.events.forEach(e => {
          if (e.midis.length > 1) { chords++; assert.ok(spanOf(e.midis) <= SPANS[profile], profile + ' ' + name + ' ' + stride + ' ' + quality + ' root ' + root + ' anchor ' + anchor + ': span ' + spanOf(e.midis)); }
          assert.ok(e.midis.every(m => m >= 40), 'floor kept');
        });
      });
    });
  })));
  assert.ok(chords > 5000);
});

test('pop and waltz: fitting the span keeps every pitch class and never puts a chord tone far under its bass', () => {
  ['pop', 'waltz'].forEach(name => ['small', 'medium'].forEach(profile => QUALS.forEach(quality => {
    for (let root = 0; root < 12; root++) {
      const windows = [0, 1, 2, 3].map(i => ({ w0: q(i, 4), w1: q(i + 1, 4), root: (root + 7 * i) % 12, quality: quality, m: 'm0' }));
      const r = PAT.run(name, windows, null, { anchor: 54, count: 3, maxSpan: SPANS[profile], floor: 40 });
      let bass = null;
      r.events.forEach(e => {
        if (e.midis.length === 1) { bass = e.midis[0]; return; }
        assert.ok(Math.min.apply(null, e.midis) > bass - 5, name + ': a chord tone far under the bass');
      });
      const wide = PAT.run(name, windows, null, { anchor: 54, count: 3, maxSpan: SPANS[profile], floor: null, stride: 'wide' });
      r.events.forEach((e, i) => assert.deepEqual(new Set(e.midis.map(m => m % 12)), new Set(wide.events[i].midis.map(m => m % 12)), name + ' ' + quality + ' event ' + i));
    }
  })));
});

test("the default ('open') geometry keeps a chord over a low bass out of the low-register cluster zone; 'close' does not", () => {
  const lowClusters = stride => {
    let n = 0;
    ['pop', 'waltz'].forEach(name => QUALS.slice(0, 4).forEach(quality => {
      for (let root = 0; root < 12; root++) [40, 42, 44, 46].forEach(anchor => {
        const windows = [0, 1, 2, 3].map(i => ({ w0: q(i, 4), w1: q(i + 1, 4), root: (root + 5 * i) % 12, quality: quality, m: 'm0' }));
        /* the root bass a chord is voiced over: pop, its own window's root; waltz, the measure's bass note */
        const ev = PAT.run(name, windows, null, { anchor: anchor + 12, count: 3, maxSpan: 14, floor: 40, stride: stride }).events;
        let chordNo = 0, lastBass = null;
        ev.forEach(e => {
          if (e.midis.length === 1) { lastBass = lastBass == null || name === 'pop' ? e.midis[0] : lastBass; return; }
          const bass = name === 'pop' ? TH.nearestWithPc(windows[2 * chordNo + 1].root, anchor, { lo: 40 }) : lastBass;
          chordNo++;
          const low = Math.min.apply(null, e.midis);
          if (bass >= 42 && bass < TH.CLUSTER_BELOW) {
            if (stride === 'open') {
              assert.ok(low >= TH.CLUSTER_BELOW, 'open: chord tones at or above C3 over bass ' + bass + ': ' + e.midis);
              assert.ok(low - bass >= 5, 'open: not within a third of the bass');
              assert.ok(low - bass <= 12, 'no octave leap to the chord: ' + bass + ' ' + e.midis);
            }
            if (Math.abs(low - bass) <= 4) n++;
          }
        });
      });
    }));
    return n;
  };
  assert.equal(lowClusters('open'), 0);
  assert.ok(lowClusters('close') > 20, 'fixture assumption: the close geometry has chords within a third of a low bass');
});

test("'open' equals 'close' whenever the bass is at or above C3 (nothing changes above the cluster zone)", () => {
  const w = [0, 1, 2, 3].map(i => ({ w0: q(i, 4), w1: q(i + 1, 4), root: PROG[i][0], quality: PROG[i][1], m: 'm0' }));
  ['pop', 'waltz'].forEach(name => {
    const hi = { anchor: 66, count: 3, maxSpan: 14, floor: 40 };
    assert.deepEqual(PAT.run(name, w, null, Object.assign({ stride: 'open' }, hi)).events, PAT.run(name, w, null, Object.assign({ stride: 'close' }, hi)).events);
  });
});

/* ---------------------------------------------------------------- real files at the small and medium hand profiles */
test('realize: pop and waltz give zero G5 hard violations at the small and medium profiles on real files (the close path once lost the span fit)', async () => {
  const HN = require(path.join(REPO, 'realize/tools/harness.js'));
  const DIFF = require(path.join(REPO, 'difficulty/index.js')), WEIGHTS = require(path.join(REPO, 'difficulty/weights/g6a-v1.json'));
  const files = HN.sampleFiles(16).concat(HN.heldOutFiles(32));
  const checked = { small: 0, medium: 0 };
  for (const file of files) {
    const g = await H.graphOf(file); if (!g) continue;
    const sg = SGG.analyze(g), pos = DIFF.assess(g, WEIGHTS).level.position;
    for (const profile of ['small', 'medium']) {
      let plan = null;
      for (const l of [pos, pos + 1, pos - 1, pos + 2]) { const p = ARR.planner.plan(g, sg, { targetLevel: l, handProfile: profile, sections: 'all' }); if (p.ok) { plan = p.plan; break; } }
      if (!plan) continue;
      checked[profile]++;
      for (const pattern of ['pop', 'waltz']) {
        const r = REALIZE.realize(g, sg, plan, { pattern });
        assert.ok(r.ok, file);
        assert.equal(PLA.analyzeGraph(r.graph, { profile: profile }).totals.hard, 0, file + ' ' + pattern + ' at ' + profile);
      }
    }
  }
  assert.ok(checked.small >= 15 && checked.medium >= 20, 'fixture assumption: enough reachable files (' + JSON.stringify(checked) + ')');
});

test('realize: melody-crossing degradation still covers the default geometry (block, broken and ballad raise through the floor; pop and waltz place their own bass)', async () => {
  const f = await fixture('catalog/method/sonatina/025.mxl', 3.4);
  ['block', 'broken', 'ballad'].forEach(pattern => {
    const r = REALIZE.realize(f.g, f.sg, f.plan, { pattern, registerFloor: 84 });
    assert.ok(r.ok, pattern);
    assert.ok(r.report.floor.eventsDegraded > 0, pattern + ': some events could not be raised without crossing the melody');
    assert.equal(M.melodyPreservation(M.originalMelodyNotes(f.g, f.plan), M.graphNoteList(r.graph)), 1, pattern);
  });
  ['pop', 'waltz'].forEach(pattern => {
    const r = REALIZE.realize(f.g, f.sg, f.plan, { pattern, registerFloor: 84 });
    assert.ok(r.ok, pattern + ': still a valid graph at an absurd floor');
    assert.equal(M.melodyPreservation(M.originalMelodyNotes(f.g, f.plan), M.graphNoteList(r.graph)), 1, pattern + ': melody untouched');
    assert.equal(r.report.floor.eventsDegraded, 0, pattern + ': the pattern places its bass above the floor itself (no crossing check: only an unrealistic floor crosses)');
  });
  assert.equal(REALIZE.realize(f.g, f.sg, f.plan, { pattern: 'block' }).report.floor.eventsDegraded, 0);
});
