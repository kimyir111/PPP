/* G4a: a graph for a Score that has none (docs/GOALS/G04 §8.2, A48).

   legacy.fromScore is compatibility, not an importer: it states what the Score states. The claim is that the
   projection of its graph is the same Score - checked with the G2 comparator (legacy.compare, through agree) and,
   because that comparator is deliberately soft (six places, sorted keys, one .order and it stops), again with a
   strict one written here: every field, every number to 1e-9. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG, E, corpusGraphs, goldenGraphs, g3aGraphs, storedScores, scoreOf, withPositions } = require('./helpers.js');

const L = SG.legacy;

/* What may not come back, and the one code each says it with. A percussion note has no pitch the Score can hold. */
const ALLOW = { 'tests/scoregraph/fixtures/xml/unpitched.musicxml': 'percussion-or-unpitched' };

/* the strict comparison: the same measures in order, the same notes as a multiset, the same lists */
const r9 = v => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v);
function strict(a, b) {
  const pick = (o, fs) => fs.map(f => [f, o[f] === undefined || o[f] === null || o[f] === false ? null : r9(o[f])]);
  const A = L.comparable(a), B = L.comparable(b);
  const out = [];
  const m = x => JSON.stringify(x.measures.map(y => [pick(y, L.MEASURE_SCALARS), L.MEASURE_OBJECTS.map(f => JSON.stringify(y[f] === undefined ? null : y[f]))]));
  if (m(A) !== m(B)) out.push('measures');
  const notes = x => x.notes.map(n => JSON.stringify(pick(n, L.NOTE_SCALARS).concat([['tm', n.tm ? [n.tm.a, n.tm.n] : null]]))).sort();
  const na = notes(A), nb = notes(B);
  if (na.join('\n') !== nb.join('\n')) {
    const i = na.findIndex((x, k) => x !== nb[k]);
    out.push('notes: ' + na[i] + ' vs ' + nb[i]);
  }
  L.SCORE_LISTS.forEach(k => {
    /* an 8va's `number` pairs its ends while a file is read and means nothing after (compare() skips it too) */
    const s = l => JSON.stringify((l || []).map(x => Object.keys(x).sort().filter(f => f !== 'number').map(f => [f, r9(x[f])])));
    const la = (A[k] || []).slice(), lb = (B[k] || []).slice();
    if (k === 'dynamics') { la.sort((x, y) => x.m - y.m || x.b - y.b); lb.sort((x, y) => x.m - y.m || x.b - y.b); }
    if (s(la) !== s(lb)) out.push(k);
  });
  if (A.staves !== B.staves) out.push('staves');
  return out;
}

function roundTrip(name, score) {
  const fr = L.fromScore(score);
  assert.ok(fr.ok, name + ': fromScore builds a valid graph');
  const back = withPositions(L.toScore(fr.graph, { name: 'back' }));
  const ag = L.agree(score, fr.graph);
  return { fr, ag, strict: strict(score, back) };
}

test('A48: every corpus Score comes back from its rebuilt graph as the same music', async () => {
  const graphs = await corpusGraphs();
  assert.ok(graphs.length >= 340, graphs.length + ' corpus graphs (eligible, no G0 hold-out)');
  const failures = [];
  graphs.forEach(([rel, g]) => {
    const s = scoreOf(g, rel);
    const { fr, ag, strict: st } = roundTrip(rel, s);
    if (ALLOW[rel]) {
      assert.ok(fr.unsupported.some(u => u.code === ALLOW[rel]), rel + ' says what it could not rebuild: ' + ALLOW[rel]);
      return;
    }
    if (!ag.ok || st.length) failures.push(rel + ' ' + JSON.stringify(ag.diffs[0] || st[0]));
  });
  assert.deepEqual(failures, [], 'the round trip changes no music');
});

test('A48: the Scores the app holds today come back the same - recording, parsed, imported, stored, the demo', () => {
  const fx = storedScores();
  assert.ok(fx.length >= 12, fx.length + ' captured Scores (tests/engrave/tools/capture-legacy-scores.js)');
  fx.forEach(([f, x]) => {
    const { fr, ag, strict: st } = roundTrip(f, x.score);
    assert.ok(ag.ok, f + ' agrees: ' + JSON.stringify(ag.diffs[0]));
    assert.deepEqual(st, [], f + ' is the same field for field');
    assert.deepEqual(fr.unsupported, [], f + ' needed nothing the graph cannot hold');
  });
});

test('A48: PPP transcriptions (G3 off) and the same through G3a come back the same', () => {
  goldenGraphs().concat(g3aGraphs()).forEach(([k, g]) => {
    const { ag, strict: st } = roundTrip(k, scoreOf(g, k));
    assert.ok(ag.ok, k + ': ' + JSON.stringify(ag.diffs[0]));
    assert.deepEqual(st, [], k);
  });
});

test('fromScore is deterministic: one Score, one graph, byte for byte - also after the Score is saved and read back', () => {
  storedScores().forEach(([f, x]) => {
    const a = SG.serialize(L.fromScore(x.score).graph);
    const b = SG.serialize(L.fromScore(JSON.parse(JSON.stringify(x.score))).graph);
    assert.equal(a, b, f);
  });
});

test('fromScore states what the Score states and names what it could not keep, never inventing', async () => {
  const { graphOf } = require('./helpers.js');
  /* provenance: made from the legacy Score, imported from it - existing schema values only (G04 §8.6) */
  const g0 = L.fromScore(storedScores()[0][1].score).graph;
  assert.equal(g0.provenance.sources[0].kind, 'legacy-score');
  assert.equal(g0.provenance.default.op, 'imported');

  /* percussion: the Score has no pitch for it; the note is reported and not made up */
  const perc = scoreOf(await graphOf('tests/scoregraph/fixtures/xml/unpitched.musicxml'), 'perc');
  const fp = L.fromScore(perc);
  assert.ok(fp.unsupported.some(u => u.code === 'percussion-or-unpitched'));
  assert.equal(fp.graph.parts.reduce((n, p) => n + p.events.filter(e => e.kind === 'perc').length, 0), 0, 'no invented percussion');

  /* a transposing part: the written pitch is on the Score, the interval is not - reported */
  const tr = scoreOf(await graphOf('tests/scoregraph/fixtures/xml/transposing.musicxml'), 'tr');
  assert.ok(L.fromScore(tr).unsupported.some(u => u.code === 'transposition'));

  /* beams: the Score has none, so the rebuilt graph has none (the plan derives them, plan.test.js) */
  const burg = await graphOf('catalog/method/burgmuller25/021.mxl');
  const fb = L.fromScore(scoreOf(burg, 'b'));
  assert.equal(fb.graph.parts.reduce((n, p) => n + p.spanners.filter(s => s.type === 'beam').length, 0), 0);
  assert.ok(burg.parts.reduce((n, p) => n + p.spanners.filter(s => s.type === 'beam').length, 0) > 0, 'though the file had them');
});

/* ---------------------------------------------------------------- fixer P5 */
test('P5: fromScore keeps what the Score states apart from what it had to infer', async () => {
  const fx = Object.fromEntries(storedScores().map(([f, x]) => [f, x.score]));
  /* a transcription: its notation was worked out by PPP, and the rebuilt graph says so throughout */
  const rec = L.fromScore(fx['recording-G02.score.json']).graph;
  assert.equal(rec.provenance.default.op, 'inferred');
  assert.equal(L.inferredNotation(rec), true);
  assert.equal(L.toScore(rec).sgFrom.inferred, true, 'and the Score made from it tells the app the same');
  /* a transcription with ties (the golden G16), through its Score: the rebuilt ties are the inferred ties G4-U2 A draws */
  const g16 = new Map(goldenGraphs()).get('golden/G16.sg.json');
  const plan = E.plan(L.fromScore(scoreOf(g16, 'G16')).graph);
  assert.ok(plan.ties.length > 0 && plan.ties.every(t => t.inferred), plan.ties.length + ' ties, all inferred');
  /* a file: stated, so imported - but what fromScore paired or grouped by rule is inferred on the object */
  const file = L.fromScore(fx['graph-fur-elise.score.json']).graph;
  assert.equal(file.provenance.default.op, 'imported');
  assert.equal(L.inferredNotation(file), false);
  file.parts.forEach(p => assert.equal(p.prov && p.prov.op, 'inferred', 'the parts are read back from the hands'));
  /* a file with slurs (none of the captured app Scores has one) */
  const burg = L.fromScore(scoreOf(await require('./helpers.js').graphOf('catalog/method/burgmuller25/015.mxl'), 'b15')).graph;
  assert.equal(burg.provenance.default.op, 'imported');
  const slurs = burg.parts.flatMap(p => p.spanners.filter(s => s.type === 'slur'));
  assert.ok(slurs.length > 0 && slurs.every(s => s.prov && s.prov.op === 'inferred'), slurs.length + ' slurs, paired by the legacy renderer\'s rule (start to next stop)');
  assert.ok(E.plan(burg).slurs.every(s => s.inferred));
  /* a run of time-modified notes with no tuplet mark (E04's fourth triplet) is grouped by the importer's rule */
  const e04 = L.fromScore(scoreOf(await require('./helpers.js').graphOf('tests/engrave/fixtures/e/E04-tuplet-show.musicxml'), 'e04')).graph;
  const unprinted = e04.parts.flatMap(p => p.spanners.filter(s => s.type === 'tuplet' && s.printed === false));
  assert.ok(unprinted.length > 0 && unprinted.every(s => s.prov && s.prov.op === 'inferred'), unprinted.length + ' unprinted tuplet runs grouped by rule');
  assert.ok(e04.parts.flatMap(p => p.spanners.filter(s => s.type === 'tuplet' && s.printed !== false)).every(s => !s.prov), 'the printed ones are stated');
  /* a tie the flags leave no choice about is stated; the caller's own answer about the notation wins */
  assert.ok(file.parts.flatMap(p => p.spanners.filter(s => s.type === 'tie')).every(s => !s.prov));
  assert.equal(L.fromScore(fx['graph-fur-elise.score.json'], { inferred: true }).graph.provenance.default.op, 'inferred');
  assert.equal(L.fromScore(fx['recording-G02.score.json'], { inferred: false }).graph.provenance.default.op, 'imported');
  /* none of this changes the music: the rebuilt graphs still agree */
  assert.ok(L.agree(fx['recording-G02.score.json'], rec).ok && L.agree(fx['graph-fur-elise.score.json'], file).ok);
});

test('P5: the library reads a Score\'s source exactly as the app does (App inferredAudioNotation)', () => {
  const html = require('fs').readFileSync(require('path').join(require('./helpers.js').REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
  const i = html.indexOf('function inferredAudioNotation(scoreOrSource) {');
  assert.ok(i > 0, 'the app\'s function is where it was');
  const body = html.slice(i, html.indexOf('\n}\n', i) + 2);
  const appFn = new Function(body + '\nreturn inferredAudioNotation;')();
  const cases = [{}, { source: { amt: 'ensemble' } }, { source: { transcriptionVersion: 7 } }, { source: { taskMode: 'piano-arrangement' } },
    { source: { engine: 'Piano transcription + PM2S' } }, { source: { engine: 'Transkun' } }, { source: { engine: 'Piano ensemble (a + b)' } },
    { source: { engine: 'Public-domain catalog', retrieved: true, amt: 'x' } }, { source: { referenceScore: true, amt: 'x' } },
    { source: { kind: 'musicxml', engine: null } }, { source: { kind: 'midi' } }];
  cases.forEach(c => assert.equal(L.scoreNotationInferred(c), appFn(c), JSON.stringify(c)));
});

test('a tie the graph cannot join is kept as its two open ends, and reported', () => {
  /* a tie whose second note does not start where the first ends: one Tie cannot hold it (E-TIE-TIME) */
  const x = JSON.parse(JSON.stringify(storedScores().find(([f]) => f === 'parse-engraving-stress.score.json')[1].score));
  const a = x.notes.find(n => !n.rest && !n.tieStart && !n.tieStop && x.notes.some(o => o !== n && !o.rest && o.midi === n.midi && o.m === n.m && o.b > n.b + n.dur + 0.4 && !o.tieStop));
  const bnote = x.notes.find(o => o !== a && !o.rest && o.midi === a.midi && o.m === a.m && o.b > a.b + a.dur + 0.4 && !o.tieStop);
  a.tieStart = true; bnote.tieStop = true;
  const fr = L.fromScore(x);
  assert.ok(fr.ok, 'the graph is still made');
  assert.ok(fr.unsupported.some(u => u.code === 'tie-open-start') && fr.unsupported.some(u => u.code === 'tie-open-end'),
    'the tie is kept as its two open ends and reported: ' + JSON.stringify(fr.unsupported));
  const ag = L.agree(x, fr.graph);
  assert.ok(ag.ok, 'and the flags on the two notes survive: ' + JSON.stringify(ag.diffs[0]));
});

test('a Score the graph refuses in part loses only that part, and names it', () => {
  /* a hairpin that stops before it starts: the graph refuses it (E-SPAN-ORDER); the rest of the song is kept */
  const x = JSON.parse(JSON.stringify(storedScores().find(([f]) => f === 'parse-engraving-stress.score.json')[1].score));
  x.wedges = [{ m: x.measures[0].number, b: 2, type: 'crescendo' }, { m: x.measures[0].number, b: 1, type: 'stop' }];
  const fr = L.fromScore(x);
  assert.ok(fr.ok, 'the graph is still made');
  assert.ok(fr.removed.some(r => r.code === 'spanner'), 'the hairpin is taken out and named: ' + JSON.stringify(fr.removed));
  assert.ok(SG.validate(fr.graph).ok);
  const ag = L.agree(x, fr.graph);
  assert.deepEqual(ag.diffs.map(d => d.field.split('.')[0]), ['wedges'], 'and only the hairpin differs');
});

/* The final review: fromScore paired slurs first-in-first-out, which is not the pairing the app draws. The Score keeps
   only the ends; the rebuilt graph pairs them the way the legacy renderer does (a start runs to the next stop in its
   staff and voice, App 11138), marks each slur inferred, and names an end no pair reaches. */
test('slurs are paired as the app draws them: a start runs to the next stop; two starts can share a stop; a lone stop stays an open end', () => {
  const src = storedScores().find(([f]) => f === 'graph-fur-elise.score.json')[1].score;
  const s = JSON.parse(JSON.stringify(src));
  const chain = s.notes.filter(n => !n.rest && (n.staff || 1) === 1 && (n.voice || 1) === 1 && !n.chord).slice(0, 4);
  assert.equal(chain.length, 4);
  s.notes.forEach(n => { delete n.slurStart; delete n.slurStop; });
  /* A start, B start, C stop, D stop */
  chain[0].slurStart = true; chain[1].slurStart = true; chain[2].slurStop = true; chain[3].slurStop = true;
  const fr = L.fromScore(s);
  assert.ok(fr.ok);
  /* each Score note's graph event, through link() */
  const lk = L.link(s, fr.graph);
  assert.ok(lk.ok);
  const [A, B, C, D] = chain.map(n => lk.byNote[s.notes.indexOf(n)].event);
  const slurs = fr.graph.parts.flatMap(p => p.spanners.filter(x => x.type === 'slur')).map(x => [x.from || null, x.to || null]);
  assert.deepEqual(slurs.slice().sort(), [[A, C], [B, C], [null, D]].sort(), 'A-C and B-C (both to the next stop), D an open end');
  assert.ok(fr.unsupported.some(u => u.code === 'slur-open-end'));
  assert.ok(fr.graph.parts.flatMap(p => p.spanners.filter(x => x.type === 'slur')).every(x => x.prov && x.prov.op === 'inferred'));
  /* and the Score still comes back: which ends there are is what the Score states */
  const back = L.toScore(fr.graph);
  const ends = sc => sc.notes.filter(n => n.slurStart || n.slurStop).map(n => n.m + '|' + n.b + '|' + !!n.slurStart + '|' + !!n.slurStop).sort();
  assert.deepEqual(ends(back), ends(s));
});

/* A chord across the staves of a part, as the app holds it: Score.finalize sorts by position and then staff, so the
   chord's first note (chord: false) can come after the others. The rebuilt graph must still hold one event with a head
   on each staff - as the file's own graph does - not two events with a voice overlap (G04 §32.13). */
test('a chord across the staves, in the order the app keeps it, is rebuilt as the one event the file has', async () => {
  const { appFinalize, graphOf } = require('./helpers.js');
  const finalize = appFinalize();
  for (const rel of ['tests/scoregraph/fixtures/xml/cross-staff.musicxml', 'tests/engrave/fixtures/e/E26-cross-staff.musicxml']) {
    const g = await graphOf(rel);
    const cross = g.parts.flatMap(p => p.events).filter(e => (e.heads || []).some(h => h.staff !== undefined && h.staff !== e.staff));
    assert.ok(cross.length > 0, rel + ' has a chord across the staves');
    const s = finalize(L.toScore(g, { name: 'x', id: 'x' }));
    const fr = L.fromScore(s);
    assert.ok(fr.ok);
    const codes = fr.unsupported.map(u => u.code);
    assert.ok(codes.indexOf('chord-without-first-note') < 0 && codes.indexOf('voice-overlap') < 0, rel + ': ' + codes.join(','));
    const rebuilt = fr.graph.parts.flatMap(p => p.events);
    assert.equal(rebuilt.length, g.parts.flatMap(p => p.events).length, rel + ': as many events as the file');
    assert.equal(rebuilt.filter(e => (e.heads || []).some(h => h.staff !== undefined && h.staff !== e.staff)).length, cross.length,
      rel + ': the chord keeps its head on the other staff');
  }
});
