/* G11a-1: the plan IS the old player's. practice/plan.js with legacyCompat (the default) against the app's own PianoScore.build and followGates,
   read out of Piano Coach App.dc.html (helpers.appPlayer), on every file of the corpus the practice screen can open: the visits, the strikes
   (time, release, pitch, velocity, hand, bar), the controller events, the beats, the tempo map, the pedal spans, the follow gates - whole piece and
   loop windows, each hand - compared to the last bit of the float; and the helpers of PianoScore that read a plan (msAt, qAt, soundAtWritten,
   writtenAtSound, sostSpans) answer alike on either plan, so nothing downstream has to change.

   The fixes (jumps, graces, follow repeats, follow ties) are then held to what they are for: a file changes under one only if it has what it repairs,
   and everything it does not repair is still the old plan's (the cause-coded allow-list of docs/GOALS/G11 §6.2, in Node, over the corpus).

   The corpus is the G4 one: every catalogue file the provenance record calls eligible, not a G0 hold-out reference and not quarantined, the
   project's own fixtures, and this directory's (a hold-out or quarantined file never reaches this list, so no message can name one). Opening the
   catalogue is what costs (an import is 15 ms), so the gate takes every sixth catalogue file and every file that has what a fix is about (a jump, a
   grace note, a 6/4 meter, a tie that leads nowhere, a rolled chord - the SPECIAL list, found by the full run); PPP_PRACTICE_FULL=1 takes them all
   (the full run is what the PR record quotes). The whole-page version of this comparison (the real scheduler, the matcher, 12 files on both
   switches) is the G11a-2 harness. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');
const { corpusFiles } = require('../engrave/helpers.js');

const { PLAN } = H;
const app = H.appPlayer();

const FULL = !!process.env.PPP_PRACTICE_FULL;
const SPECIAL = new Set([
  /* a D.C. or a D.S. that turns */ 'catalog/method/burgmuller25/006.mxl', 'catalog/method/czerny599/048.mxl', 'catalog/method/sonatina/012.mxl', 'catalog/method/sonatina/015.mxl', 'catalog/method/sonatina/017.mxl',
  /* grace notes */ 'catalog/method/burgmuller25/003.mxl', 'catalog/method/czerny849/007.mxl', 'catalog/method/czerny849/017.mxl', 'catalog/method/sonatina/002.mxl', 'catalog/method/sonatina/006.mxl',
  'catalog/method/sonatina/007.mxl', 'catalog/method/sonatina/008.mxl', 'catalog/method/sonatina/013.mxl', 'catalog/method/sonatina/014.mxl', 'catalog/method/sonatina/016.mxl',
  'catalog/method/sonatina/024.mxl', 'catalog/method/sonatina/025.mxl', 'catalog/method/sonatina/026.mxl', 'catalog/method/sonatina/027.mxl', 'catalog/method/sonatina/028.mxl',
  /* a 6/4 meter */ 'catalog/hymns/all-creatures.musicxml', 'catalog/hymns/nearer-my-god.musicxml', 'catalog/hymns/rock-of-ages.musicxml', 'catalog/hymns/stricken-smitten.musicxml', 'catalog/hymns/under-his-wings.musicxml',
  /* a tie that leads nowhere (and a unison tie) */ 'catalog/hymns/midnight-clear.musicxml', 'catalog/method/burgmuller25/021.mxl', 'catalog/method/sonatina/010.mxl'
]);
function corpus() {
  const own = [].concat(H.filesIn('tests/engrave/fixtures/e', /\.musicxml$/), H.filesIn('tests/practice/fixtures', /\.musicxml$/));
  const all = [...new Set(corpusFiles().concat(own))].sort();
  const catalogue = all.filter(rel => rel.startsWith('catalog/'));
  return FULL ? all : all.filter(rel => !rel.startsWith('catalog/') || SPECIAL.has(rel) || catalogue.indexOf(rel) % 6 === 0);
}

/* the loops: the whole piece, one window of four bars from a seed, and where the loop rules are subtle one more: the window that starts on
   the first ending, or else the one that ends on the first backward repeat */
function ranges(g) {
  const n = g.timeline.measures.length;
  const rnd = H.lcg(n * 7919 + 13);
  const out = [[0, n - 1]];
  const a = Math.floor(rnd() * n);
  out.push([a, Math.min(n - 1, a + 3)]);
  const en = (g.timeline.endings || [])[0];
  const rep = g.timeline.measures.findIndex(m => m.barline && m.barline.right && m.barline.right.repeat === 'backward');
  if (en) { const i = g.timeline.measures.findIndex(m => m.id === en.from); out.push([i, Math.min(n - 1, i + 3)]); }
  else if (rep >= 0) out.push([Math.max(0, rep - 3), rep]);
  return out;
}

/* what the matcher reads of a strike besides its time: which notes of a position are a rolled chord (PerformanceEngine.begin) */
function rolledOf(score, from, to) {
  const rolled = {};
  app.Score.notesIn(score, from, to).forEach(n => { if (n.arp) rolled[n.m + '|' + n.b + '|' + (n.staff || 1)] = true; });
  return s => !!rolled[s.note.m + '|' + s.note.b + '|' + (s.note.staff || 1)];
}

test('PARITY: legacyCompat is the old player\'s plan, the old follow gates, and the old plan\'s helpers read it alike - on the whole corpus', async (t) => {
  const files = corpus();
  const bad = [];
  const count = { files: 0, plans: 0, strikes: 0, gates: 0, notes: 0 };
  for (const rel of files) {
    const g = await H.graphOfFile(rel);
    if (!g) continue;
    count.files++;
    const score = app.scoreOf(g);
    const numbers = score.measures.map(m => m.number);
    const scale = [0.5, 1];
    for (const [i0, i1] of ranges(g)) {
      const whole = i0 === 0 && i1 === g.timeline.measures.length - 1;
      const old = app.PianoScore.build(score, numbers[i0], numbers[i1]);
      const nu = PLAN.build(g, { range: { from: i0, to: i1 }, defaultQpm: score.tempo });
      count.plans++;
      count.strikes += old.strikes.length;
      const d = H.firstDiff(H.canon(old), H.canon(nu));
      if (d) { bad.push(rel + ' [' + i0 + '..' + i1 + '] plan ' + d); continue; }
      /* the rolled-chord flag and the helpers of PianoScore on both plans */
      const rolled = rolledOf(score, numbers[i0], numbers[i1]);
      if (old.strikes.some((s, k) => rolled(s) !== nu.strikes[k].arp)) { bad.push(rel + ' [' + i0 + '..' + i1 + '] rolled chords'); continue; }
      for (const sc of whole ? scale : []) {
        const probes = [0, 0.3, 1.7, old.soundLengthQ / 2, old.soundLengthQ];
        if (probes.some(q => app.PianoScore.msAt(old, q, sc) !== app.PianoScore.msAt(nu, q, sc)) ||
            probes.some(q => app.PianoScore.qAt(old, app.PianoScore.msAt(old, q, sc), sc) !== app.PianoScore.qAt(nu, app.PianoScore.msAt(nu, q, sc), sc)) ||
            probes.some(q => app.PianoScore.writtenAtSound(old, q) !== app.PianoScore.writtenAtSound(nu, q) || app.PianoScore.soundAtWritten(old, q) !== app.PianoScore.soundAtWritten(nu, q))) {
          bad.push(rel + ' [' + i0 + '..' + i1 + '] msAt/qAt/soundAtWritten');
        }
      }
      if (whole && JSON.stringify(app.PianoScore.sostSpans(old)) !== JSON.stringify(app.PianoScore.sostSpans(nu))) bad.push(rel + ' sostSpans');
      for (const hands of whole ? ['both', 'right', 'left'] : ['both']) {
        const og = H.gatesCanon(app.gates(score, numbers[i0], numbers[i1], hands));
        const ng = H.gatesCanon(PLAN.followGates(nu, hands));
        count.gates += og.length;
        if (JSON.stringify(og) !== JSON.stringify(ng)) {
          const k = og.findIndex((x, i) => JSON.stringify(x) !== JSON.stringify(ng[i]));
          bad.push(rel + ' [' + i0 + '..' + i1 + '] gates ' + hands + ': ' + (og.length !== ng.length ? og.length + ' against ' + ng.length : 'gate ' + k));
        }
      }
    }
    count.notes += score.notes.filter(n => !n.rest).length;
  }
  t.diagnostic(count.files + ' files, ' + count.plans + ' plans (' + count.strikes + ' strikes), ' + count.gates + ' gates, ' + count.notes + ' notes compared');
  assert.deepEqual(bad.slice(0, 8), [], bad.length + ' differences');
  assert.ok(count.files >= (FULL ? 380 : 120), count.files + ' files opened');
  assert.ok(count.strikes > (FULL ? 120000 : 30000), count.strikes + ' strikes');
});

test('PARITY: the same through the Score the old way - a graph made back from a Score (fromScore) plays the same plan', async () => {
  /* the page reads a song that has no stored graph through legacy.fromScore (a "projected" graph, with new ids): the plan must not care */
  let checked = 0, skipped = 0;
  for (const rel of H.filesIn('tests/scoregraph/fixtures/xml', /\.musicxml$/).concat(H.filesIn('tests/practice/fixtures', /\.musicxml$/))) {
    const g = await H.graphOfFile(rel);
    if (!g) continue;
    const score = app.scoreOf(g);
    const back = H.L.fromScore(JSON.parse(JSON.stringify(score)));
    /* what a Score cannot carry (an unpitched note) is named by fromScore and is G4's list (A48 KNOWN_LOSS), not this test's */
    if (!back.ok || (back.unsupported || []).length) { skipped++; continue; }
    const n = score.measures.length;
    const a = PLAN.build(g, { defaultQpm: score.tempo }), b = PLAN.build(back.graph, { defaultQpm: score.tempo });
    assert.equal(H.firstDiff(H.canon(a), H.canon(b)), '', rel + ': the plan of the graph and of the graph made from its Score');
    assert.ok(n > 0);
    checked++;
  }
  assert.ok(checked >= 30 && skipped <= 6, checked + ' files, ' + skipped + ' with a loss fromScore names');
});

test('PARITY: each fix changes only what it repairs - D.C./D.S., grace notes, follow repeats, follow ties - across the corpus', async (t) => {
  const files = corpus();
  const seen = { jumps: 0, graces: 0, repeats: 0, ties: 0, files: 0 };
  for (const rel of files) {
    const g = await H.graphOfFile(rel);
    if (!g) continue;
    seen.files++;
    const score = app.scoreOf(g);
    const base = PLAN.build(g, { defaultQpm: score.tempo });
    const baseCanon = H.canon(base);

    /* JUMP: a plan changes iff the file has a D.C. or a resolvable D.S.; the first leg stays the old order */
    const jumps = g.timeline.jumps || [];
    const hasSegno = jumps.some(j => j.kind === 'segno');
    const turns = jumps.some(j => j.kind === 'dacapo' || (j.kind === 'dalsegno' && hasSegno));
    const withJumps = PLAN.build(g, { defaultQpm: score.tempo, jumps: 'once' });
    const jumped = H.firstDiff(baseCanon, H.canon(withJumps)) !== '';
    assert.equal(jumped, turns, rel + ': a plan changes under jumps iff the file has a sign that turns');
    if (turns) {
      seen.jumps++;
      const first = withJumps.visits.filter(v => !v.leg);
      assert.deepEqual(first.map(v => v.index), base.visits.slice(0, first.length).map(v => v.index), rel);
      assert.ok(withJumps.visits.some(v => v.leg), rel);
    }

    /* GRACE: a plan changes iff the file has a grace note; the other notes are the old ones (bar, pitch, hand, velocity, place on the page) */
    const graceEvents = g.parts.reduce((n, p) => n + p.events.filter(e => e.grace && e.kind !== 'rest').length, 0);
    const withGraces = PLAN.build(g, { defaultQpm: score.tempo, graces: 'play' });
    assert.equal(H.firstDiff(baseCanon, H.canon(withGraces)) !== '', graceEvents > 0, rel + ': a plan changes under graces iff the file has grace notes');
    if (graceEvents) {
      seen.graces++;
      const key = s => [base.visits.indexOf(s.visit) >= 0 ? s.visit.index : -1, s.midi, s.hand, s.m, s.abs, s.vel].join('|');
      const keyNew = s => [s.visit.index, s.midi, s.hand, s.m, s.abs, s.vel].join('|');
      assert.deepEqual(withGraces.strikes.filter(s => !s.grace).map(keyNew).sort(), base.strikes.map(key).sort(), rel + ': the notes that are not graces');
      assert.ok(withGraces.strikes.some(s => s.grace) && withGraces.strikes.every(s => !s.grace || s.q >= 0), rel);
    }

    /* FOLLOW_REPEAT: the gates change iff the play order is not one pass through the written range */
    const contiguous = base.visits.every((v, k) => !k || Math.abs(base.visits[k - 1].startQ + base.visits[k - 1].lenQ - v.startQ) < 1e-9);
    const oldGates = H.gatesCanon(PLAN.followGates(base, 'both')), newGates = H.gatesCanon(PLAN.followGates(base, 'both', { repeats: true }));
    if (contiguous) assert.deepEqual(newGates, oldGates, rel + ': with no repeat the gates are the old ones');
    else { seen.repeats++; assert.ok(newGates.length > oldGates.length, rel + ': a repeated passage is asked again'); }

    /* FOLLOW_TIE: the gates change iff a tied-to note that nothing carries into is asked */
    const dangling = base.written.filter(n => !n.rest && n.midi != null && n.tieStop && !base.cont.has(n.head) && n.hand !== 'x').length;
    const tieGates = H.gatesCanon(PLAN.followGates(base, 'both', { ties: true }));
    assert.equal(JSON.stringify(tieGates) !== JSON.stringify(oldGates), dangling > 0, rel + ': the gates change under ties iff a tie leads nowhere');
    if (dangling) seen.ties++;
    const askedMore = tieGates.reduce((n, x) => n + x[4].length, 0) - oldGates.reduce((n, x) => n + x[4].length, 0);
    assert.equal(askedMore, dangling, rel + ': exactly the dangling tied-to notes are added');
  }
  t.diagnostic('of ' + seen.files + ' files: JUMP changes ' + seen.jumps + ', GRACE ' + seen.graces + ', FOLLOW_REPEAT ' + seen.repeats + ', FOLLOW_TIE ' + seen.ties);
  assert.ok(seen.jumps >= 5 && seen.graces >= 5 && seen.repeats >= (FULL ? 100 : 20) && seen.ties >= 2, JSON.stringify(seen));
});

test('PARITY: the graph rules (legacyCompat false) change only the beats of a 6/4 metre, the end of a half pedal, and a tie the old player could not find', async (t) => {
  const files = corpus();
  const causes = { beats: 0, pedal: 0, ties: 0, files: 0 };
  for (const rel of files) {
    const g = await H.graphOfFile(rel);
    if (!g) continue;
    causes.files++;
    const score = app.scoreOf(g);
    const a = PLAN.build(g, { defaultQpm: score.tempo }), b = PLAN.build(g, { defaultQpm: score.tempo, legacyCompat: false });
    const ca = H.canon(a), cb = H.canon(b);
    /* the visits, tempo map, and sounding length are never touched */
    assert.deepEqual([cb.visits, cb.tempoMap, cb.soundLengthQ, cb.pedal], [ca.visits, ca.tempoMap, ca.soundLengthQ, ca.pedal], rel + ': order and tempo');
    const beatsDiffer = JSON.stringify(ca.beats) !== JSON.stringify(cb.beats);
    /* a meter the two rules count alike is a simple one, or a compound one with an eighth for a beat; they part for 6/4 (and 9/4, 6/2: compound on a big beat), an additive meter, a written grouping */
    const countedApart = g.timeline.meters.some(m => m.beats.length > 1 || (m.groups && m.groups.length) || (m.beats[0] > 3 && m.beats[0] % 3 === 0 && m.beatType < 8));
    if (beatsDiffer) { causes.beats++; assert.ok(countedApart, rel + ': the beats differ only where the meter is counted another way'); }
    const ccsDiffer = JSON.stringify(ca.ccs) !== JSON.stringify(cb.ccs);
    if (ccsDiffer) {
      causes.pedal++;
      assert.ok(g.parts.some(p => p.spanners.some(s => s.type === 'pedal' && s.soundOnly && s.depth)), rel + ': only a half pedal');
    }
    const strikesDiffer = JSON.stringify(ca.strikes) !== JSON.stringify(cb.strikes);
    if (strikesDiffer) {
      causes.ties++;
      assert.equal(a.cont.size === b.cont.size, false, rel + ': strikes differ only where the two rules found different tie ends');
    } else assert.equal(a.cont.size, b.cont.size);
  }
  t.diagnostic(JSON.stringify(causes));
  assert.ok(causes.beats >= 1 && causes.files > (FULL ? 380 : 120), JSON.stringify(causes));
});
