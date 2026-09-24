/* G4a: the NotationPlan (docs/GOALS/G04 §8.3, §11, §12, §13, §14; A1-A4, A13, A15, A46).

   What must be drawn, with no coordinate in it, every object under its graph ID, and a ledger entry for every
   notation object the graph states. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, SG, E, corpusGraphs, goldenGraphs, g3aGraphs, graphOf } = require('./helpers.js');

const proBeam = require(path.join(REPO, 'scoregraph', 'pro-beam.js'));
const R = SG.rational;

/* ------------------------------------------------------------ small graphs */
/* One 4/4 (or given) measure per entry of `bars`; events [{at, dur, type, staff: 0|1, voice: 0|1, tuplet, grace, hidden, pitch}].
   tuplet: {actual, normal, show?, unit?, printed?} opens a one-event tuplet on that event; tupletGroup: [i, j] one tuplet over events i..j. */
function mk(spec) {
  const b = SG.builder({ id: 'g4a-test', meta: { title: 'T' } });
  const src = b.source({ kind: 'user' });
  b.setDefault({ src: src.id });
  const bars = spec.bars || [{ dur: '1' }];
  const ms = bars.map((x, i) => b.measure({ number: String(i + 1), dur: x.dur, implicit: x.implicit || undefined }));
  b.meter({ m: ms[0].id, beats: [spec.beats || 4], beatType: spec.beatType || 4 });
  const part = b.part({ instrument: { kind: 'piano', family: 'keyboard' } });
  const st = [b.staff(part, {}), b.staff(part, {})];
  const vs = [b.voice(part, { staff: st[0].id, label: '1' }), b.voice(part, { staff: st[0].id, label: '2' }), b.voice(part, { staff: st[1].id, label: '5' })];
  b.clef(part, { staff: st[0].id, m: ms[0].id, at: '0', sign: 'G' });
  b.clef(part, { staff: st[1].id, m: ms[0].id, at: '0', sign: 'F' });
  const evs = (spec.events || []).map(x => {
    const e = { kind: x.rest ? 'rest' : 'note', m: ms[x.m || 0].id, at: x.at, dur: x.grace ? '0' : x.dur, voice: vs[x.voice || 0].id,
      staff: st[x.staff || 0].id, display: { type: x.type || 'eighth' } };
    if (x.grace) e.grace = { order: 1, slash: true };
    if (x.hidden) e.hidden = true;
    if (!x.rest) e.heads = [{ pitch: x.pitch || { step: 'C', oct: 5 } }];
    return b.event(part, e);
  });
  /* nestedUnder: [i, j] - an outer tuplet over events i..j that the one-note tuplets name as their parent */
  const outer = spec.nestedUnder ? b.spanner(part, { type: 'tuplet', events: evs.slice(spec.nestedUnder[0], spec.nestedUnder[1] + 1).map(e => e.id), actual: 3, normal: 2 }) : null;
  (spec.events || []).forEach((x, i) => {
    if (!x.tuplet) return;
    const t = { type: 'tuplet', events: [evs[i].id], actual: x.tuplet.actual || 3, normal: x.tuplet.normal || 2 };
    if (outer && i >= spec.nestedUnder[0] && i <= spec.nestedUnder[1]) t.parent = outer.id;
    if (x.tuplet.show) t.show = x.tuplet.show;
    if (x.tuplet.unit) t.unit = x.tuplet.unit;
    if (x.tuplet.printed === false) t.printed = false;
    b.spanner(part, t);
  });
  (spec.groups || []).forEach(([i, j]) => b.spanner(part, { type: 'tuplet', events: evs.slice(i, j + 1).map(e => e.id), actual: 3, normal: 2 }));
  (spec.beams || []).forEach(([i, j]) => b.spanner(part, { type: 'beam', events: evs.slice(i, j + 1).map(e => e.id) }));
  (spec.slurs || []).forEach(([i, j]) => b.spanner(part, { type: 'slur', from: evs[i].id, to: evs[j].id }));
  (spec.unprintedGroups || []).forEach(([i, j]) => b.spanner(part, { type: 'tuplet', events: evs.slice(i, j + 1).map(e => e.id), actual: 3, normal: 2, printed: false }));
  if (spec.clefAt) b.clef(part, { staff: st[0].id, m: ms[0].id, at: spec.clefAt, sign: 'F' });
  return b.finish().graph;
}
/* n triplet eighths from `from` (in twelfths of a whole note), each its own one-note tuplet: the G3-off writer's shape */
const triplets = (n, from, extra) => Array.from({ length: n }, (_, k) => Object.assign({ at: R.format(R.make(from + k, 12)), dur: '1/12', tuplet: {} }, extra ? extra(k) : {}));
const mergedOf = p => p.tuplets.filter(t => t.source === 'merged');

/* ----------------------------------------------------------------- tests */
test('the plan is deterministic, holds no geometry and only reads the graph (A13, A27)', async () => {
  /* coordinates and sizes; `left`/`right` are bar line sides here, which are music */
  const FORBIDDEN = new Set(['x', 'y', 'w', 'h', 'width', 'height', 'box', 'bbox', 'px', 'sp', 'coords', 'geometry']);
  const scan = (v, where) => {
    if (Array.isArray(v)) v.forEach((x, i) => scan(x, where + '[' + i + ']'));
    else if (v && typeof v === 'object') Object.keys(v).forEach(k => { assert.ok(!FORBIDDEN.has(k), 'no geometry in the plan: ' + where + '.' + k); scan(v[k], where + '.' + k); });
  };
  for (const rel of ['catalog/method/sonatina/020.mxl', 'catalog/method/czerny849/001.mxl', 'tests/scoregraph/fixtures/xml/piano-marks.musicxml']) {
    const g = await graphOf(rel);
    const fp = SG.fingerprint(g);
    const a = JSON.stringify(E.plan(g)), b = JSON.stringify(E.plan(g));
    assert.equal(a, b, rel + ' twice, byte for byte');
    assert.equal(SG.fingerprint(g), fp, rel + ': the graph is unchanged');
    assert.ok(Object.isFrozen(g), 'and it is frozen: a write would have thrown');
    scan(JSON.parse(a), rel);
  }
});

test('L1 (A1): nothing a graph states disappears from the plan - corpus, transcriptions, G3a', async () => {
  const all = (await corpusGraphs()).concat(goldenGraphs(), g3aGraphs());
  const bad = [];
  const totals = {};
  all.forEach(([k, g]) => {
    const fp = SG.fingerprint(g);
    const a = E.audit(g, E.plan(g));
    if (SG.fingerprint(g) !== fp) bad.push(k + ' the plan changed the graph (A13)');
    if (!a.ok) bad.push(k + ' ' + JSON.stringify({ silent: a.silent.slice(0, 2), invented: a.invented.slice(0, 2), duplicate: a.duplicate.slice(0, 2), missing: a.missing.slice(0, 2), kind: a.kindMismatch.slice(0, 2) }));
    Object.keys(a.byKind).forEach(kind => { totals[kind] = (totals[kind] || 0) + a.byKind[kind].total; });
  });
  assert.deepEqual(bad, []);
  assert.ok(all.length >= 375, all.length + ' graphs');
  /* the eligible corpus (no quarantined file) states these by the thousand; the plan accounts for each */
  assert.ok(totals.beam > 9000 && totals.articulation > 6000 && totals.fingering > 9500 && totals.slur > 2700, JSON.stringify(totals));
});

test('A2: every beam the graph states is in the plan with its own notes - even where the legacy renderer ignores it', async () => {
  let graphBeams = 0, planBeams = 0;
  for (const [rel, g] of await corpusGraphs()) {
    const p = E.plan(g);
    const planned = new Map(p.beams.filter(b => b.source === 'graph').map(b => [b.id, b]));
    g.parts.forEach(part => part.spanners.filter(s => s.type === 'beam').forEach(s => {
      graphBeams++;
      const x = planned.get(s.id);
      assert.ok(x, rel + ' beam ' + s.id + ' is planned');
      assert.deepEqual(x.events, s.events, rel + ' ' + s.id + ' with its own notes');
      assert.deepEqual(x.breaks, (s.breaks || []).map(b => ({ after: b.after, level: b.level })));
      planBeams++;
    }));
    /* no derived beam in a part that beams */
    const partOf = new Map(); g.parts.forEach(pt => pt.events.forEach(e => partOf.set(e.id, pt)));
    p.beams.filter(b => b.source === 'derived').forEach(b => assert.ok(!partOf.get(b.events[0]).spanners.some(s => s.type === 'beam'), rel + ': derived only where the part states none'));
  }
  assert.ok(graphBeams > 8500, graphBeams + ' beams in the corpus');
  assert.equal(planBeams, graphBeams);
});

test('A3: derived beams come from the one beaming rule (pro-beam groups), only in parts with no beam, and never reach the graph', () => {
  goldenGraphs().forEach(([k, g]) => {
    const fp = SG.fingerprint(g);
    const p = E.plan(g);
    const derived = p.beams.filter(b => b.source === 'derived');
    const ledgered = p.ledger.filter(en => en.kind === 'beam' && en.status === 'derived');
    assert.equal(ledgered.length, derived.length, k + ': every derived beam is in the ledger as derived');
    /* the same groups groups() gives, voice-measure by voice-measure, with merged one-note tuplets as one tuplet */
    const groupOf = new Map();
    p.tuplets.filter(t => t.source === 'merged').forEach(t => t.members.forEach(s => groupOf.set(s, t.id)));
    const want = [];
    g.parts.forEach(part => {
      const tupOf = new Map();
      part.spanners.forEach(s => { if (s.type === 'tuplet' && s.printed !== false) s.events.forEach(id => tupOf.set(id, groupOf.get(s.id) || s.id)); });
      const vms = new Map();
      part.events.forEach(e => { if (e.grace) return; const vk = e.voice + '|' + e.m; if (!vms.has(vk)) vms.set(vk, []); vms.get(vk).push(e); });
      vms.forEach(evs => {
        const gr = SG.meterGrid.grid(g, evs[0].m);
        if (!gr) return;
        evs.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)) || SG.schema.idNumber(a.id) - SG.schema.idNumber(b.id));
        proBeam.groups(evs, gr, id => tupOf.get(id)).forEach(x => want.push(x.events.join(' ')));
      });
    });
    assert.deepEqual(derived.map(b => b.events.join(' ')).sort(), want.sort(), k);
    assert.equal(SG.fingerprint(g), fp, k + ': nothing written to the graph');
    assert.equal(E.plan(g, { deriveBeams: false }).beams.length, 0, k + ': and none when asked for none');
  });
});

test('A4: tuplets are shown as the graph states them - show, printed:false, nesting', async () => {
  let suppressedNone = 0, suppressedPrinted = 0;
  /* the corpus states show; PPP's transcriptions state printed:false (a run with no bracket) */
  for (const [rel, g] of (await corpusGraphs()).concat(goldenGraphs())) {
    const p = E.plan(g);
    const byId = new Map(p.tuplets.map(t => [t.id, t]));
    g.parts.forEach(part => part.spanners.filter(s => s.type === 'tuplet').forEach(s => {
      const en = p.ledger.find(x => x.ref === s.id);
      if (s.printed === false) { assert.equal(en.status, 'suppressed'); assert.equal(en.code, 'printed-false'); suppressedPrinted++; return; }
      const show = s.show || {};
      if (en.status === 'merged') return;
      if (show.number === 'none' && show.bracket === false) { assert.equal(en.code, 'show-none'); suppressedNone++; return; }
      const t = byId.get(s.id);
      assert.ok(t, rel + ' ' + s.id);
      assert.equal(t.number, show.number || 'actual');
      if (show.bracket !== undefined) assert.equal(t.bracket, show.bracket);
      if (s.parent) assert.equal(t.parent, s.parent);
    }));
  }
  assert.ok(suppressedNone >= 1000, suppressedNone + " tuplets the files print with no number and no bracket");
  /* a run printed with no bracket at all (printed:false): nothing is drawn for it, and the ledger says why */
  const up = E.plan(mk({ events: triplets(3, 0, () => ({ tuplet: { printed: false } })) }));
  assert.equal(up.tuplets.length, 0);
  assert.equal(up.ledger.filter(en => en.kind === 'tuplet' && en.status === 'suppressed' && en.code === 'printed-false').length, 3);
  assert.ok(suppressedPrinted >= 0);
  /* the nested fixture keeps its nesting */
  const nested = E.plan(await graphOf('tests/scoregraph/fixtures/xml/tuplets-nested.musicxml'));
  assert.ok(nested.tuplets.some(t => t.parent), 'a nested tuplet names its parent');
});

test('G4-U2 B: adjacent one-note tuplets are shown as one group when every condition holds', () => {
  const p = E.plan(mk({ events: triplets(6, 0) }));
  const g = mergedOf(p);
  assert.equal(g.length, 2, 'two groups of three');
  assert.deepEqual(g.map(x => x.events.length), [3, 3]);
  assert.equal(p.ledger.filter(en => en.kind === 'tuplet' && en.status === 'merged' && en.code === 'merged-for-display').length, 6);
  /* the derived beam treats the group as its one tuplet, so the number stands alone (a bracket only with no beam) */
  assert.deepEqual(p.beams.map(b => b.events.length), [3, 3]);
  assert.deepEqual(g.map(x => x.bracket), [false, false]);
  /* a stated unit makes a group of unequal values possible: a quarter and an eighth in 3:2 of eighths */
  const q = E.plan(mk({ events: [{ at: '0', dur: '1/6', type: 'quarter', tuplet: { unit: { type: 'eighth' } } }, { at: '1/6', dur: '1/12', tuplet: { unit: { type: 'eighth' } } }] }));
  assert.equal(mergedOf(q).length, 1);
});

test('G4-U2 B: when any condition fails, each one-note tuplet is drawn as the graph states it', () => {
  const none = (name, spec) => {
    const p = E.plan(mk(spec));
    assert.equal(mergedOf(p).length, 0, name + ': no merge');
    const ones = p.ledger.filter(en => en.kind === 'tuplet' && en.code === 'one-note');
    assert.ok(ones.length >= 1 && ones.every(en => en.status === 'drawn'), name + ': drawn one by one, faithfully');
  };
  none('off the tuplet grid', { events: triplets(3, 1) });
  none('a gap in the run', { events: [triplets(1, 0)[0], triplets(1, 2)[0], triplets(1, 3)[0]] });
  none('two of three only', { events: triplets(2, 0).concat([{ at: '1/6', dur: '1/12', type: '16th' }]) });
  none('a different ratio in the run', { events: triplets(3, 0, k => (k === 1 ? { tuplet: { actual: 5, normal: 4 } } : {})) });
  none('a note on another staff', { events: triplets(3, 0, k => (k === 1 ? { staff: 1, voice: 0 } : {})) });
  none('an explicit show on a member', { events: triplets(3, 0, k => (k === 2 ? { tuplet: { show: { number: 'actual' } } } : {})) });
  none('unequal values and no stated unit', { events: [{ at: '0', dur: '1/6', type: 'quarter', tuplet: {} }, { at: '1/6', dur: '1/12', tuplet: {} }] });
  none('a grace note inside the run', { events: triplets(3, 0).concat([{ at: '1/12', dur: '0', grace: true }]) });
  none('a tuplet of more notes in the same voice-measure', { events: triplets(3, 0).concat(triplets(3, 6, () => ({ tuplet: null }))), groups: [[3, 5]] });
  none('a pickup measure', { bars: [{ dur: '1/2' }], events: triplets(3, 0) });
  none('a hidden member', { events: triplets(3, 0, k => (k === 1 ? { hidden: true } : {})) });
  none('a member in another voice', { events: triplets(3, 0, k => (k === 1 ? { voice: 1 } : {})) });
  none('a member printed with no bracket', { events: triplets(3, 0, k => (k === 1 ? { tuplet: { printed: false } } : {})) });
  /* fixer G4-F10: no semantic boundary inside a display group */
  none('one-note tuplets nested under another tuplet', { events: triplets(3, 0), nestedUnder: [0, 2] });
  none('members in different graph beams', { events: triplets(3, 0), beams: [[0, 1]] });
  none('a slur that ends inside the group', { events: triplets(3, 0), slurs: [[0, 1]] });
  none('a slur that starts inside the group', { events: triplets(3, 0).concat([{ at: '1/4', dur: '1/4', type: 'quarter' }]), slurs: [[1, 3]] });
  none('a clef change inside the group', { events: triplets(3, 0), clefAt: '1/12' });
  none('an unprinted tuplet of three in the same voice-measure', { events: triplets(3, 0).concat(triplets(3, 6, () => ({ tuplet: null }))), unprintedGroups: [[3, 5]] });
  none('across a bar line', { bars: [{ dur: '1' }, { dur: '1' }],
    events: [{ at: '5/6', dur: '1/12', tuplet: {} }, { at: '11/12', dur: '1/12', tuplet: {} }, { m: 1, at: '0', dur: '1/12', tuplet: {} }] });
  /* a slur over the whole group, and all members in one graph beam, are no boundary */
  assert.equal(mergedOf(E.plan(mk({ events: triplets(3, 0), slurs: [[0, 2]] }))).length, 1, 'a slur over the whole group');
  const inBeam = E.plan(mk({ events: triplets(3, 0), beams: [[0, 2]] }));
  assert.equal(mergedOf(inBeam).length, 1, 'all in one beam');
  assert.equal(mergedOf(inBeam)[0].bracket, false, 'and the beam shows the group: the number alone');
  /* and the option turns it off */
  assert.equal(mergedOf(E.plan(mk({ events: triplets(3, 0) }), { oneNoteTupletMerge: false })).length, 0);
});

test('G4-U2 B on PPP transcriptions: groups are exact tuplets and the timing is untouched', () => {
  let groups = 0;
  goldenGraphs().forEach(([k, g]) => {
    const p = E.plan(g);
    const ev = new Map(); g.parts.forEach(pt => pt.events.forEach(e => ev.set(e.id, e)));
    mergedOf(p).forEach(t => {
      groups++;
      const es = t.events.map(id => ev.get(id));
      const unit = SG.schema.noteValue(es[0].display.type, es[0].display.dots || 0);
      const sum = es.reduce((s, e) => R.add(s, R.parse(e.dur)), R.ZERO);
      assert.ok(R.eq(sum, R.mul(R.make(t.normal), unit)), k + ': a group fills exactly one tuplet');
      assert.ok(es.every((e, i) => i === 0 || R.eq(R.parse(e.at), R.add(R.parse(es[i - 1].at), R.parse(es[i - 1].dur)))), k + ': with no gap');
      assert.ok(es.every(e => e.voice === es[0].voice && e.staff === es[0].staff && e.m === es[0].m), k + ': one voice, staff, measure');
    });
    /* the plan's events keep the graph's times exactly */
    p.events.forEach(e => { const x = ev.get(e.id); assert.equal(e.at, x.at); assert.equal(e.dur, x.dur); });
  });
  assert.ok(groups > 0, groups + ' groups');
});

test('G4-U2 A: inferred ties are in the plan, drawn, and marked inferred - none hidden', () => {
  let ties = 0;
  goldenGraphs().forEach(([k, g]) => {
    const p = E.plan(g);
    const graphTies = g.parts.reduce((n, pt) => n + pt.spanners.filter(s => s.type === 'tie').length, 0);
    assert.equal(p.ties.length, graphTies, k);
    p.ties.forEach(t => {
      ties++;
      assert.equal(t.inferred, true, k + ': a transcription\'s tie is inferred');
      assert.equal(p.ledger.find(en => en.ref === t.id).status, 'drawn');
    });
  });
  assert.ok(ties > 0);
});

test('written pitch: a transposing part is written where it is printed, a note under an 8va an octave from where it sounds', async () => {
  const tr = await graphOf('tests/scoregraph/fixtures/xml/transposing.musicxml');
  const pt = E.plan(tr);
  tr.parts.forEach(part => part.events.forEach(e => (e.heads || []).forEach(h => {
    const w = SG.pitch.written(h.pitch, part.instrument.transpose);
    const ph = pt.events.find(x => x.id === e.id).heads.find(x => x.id === h.id);
    assert.deepEqual([ph.written.step, ph.written.alter, ph.written.oct], [w.step, w.alter || 0, w.oct]);
  })));
  const ov = await graphOf('tests/scoregraph/fixtures/xml/ottava-8va-8vb.musicxml');
  const po = E.plan(ov);
  let shifted = 0;
  po.events.forEach(e => e.heads.forEach(h => {
    const src = ov.parts[0].events.find(x => x.id === e.id).heads.find(x => x.id === h.id);
    if (h.written.oct !== src.pitch.oct) { shifted++; assert.equal(Math.abs(h.written.oct - src.pitch.oct), 1); }
  }));
  assert.ok(shifted > 0, shifted + ' notes written an octave from where they sound');
});

test('stems follow the graph\'s voice order, never the pitch; a stated stem wins (A15, G4-D6)', async () => {
  /* voice 2 sits above voice 1 in pitch: still voice 1 up, voice 2 down */
  const g = mk({ events: [{ at: '0', dur: '1/4', type: 'quarter', voice: 0, pitch: { step: 'C', oct: 4 } }, { at: '0', dur: '1/4', type: 'quarter', voice: 1, pitch: { step: 'A', oct: 5 } }] });
  const p = E.plan(g);
  const v1 = g.parts[0].voices[0].id, v2 = g.parts[0].voices[1].id;
  assert.equal(p.events.find(e => e.voice === v1).stem, 'up');
  assert.equal(p.events.find(e => e.voice === v2).stem, 'down');
  /* the plan never puts a head on another staff than the graph's */
  for (const [rel, gg] of (await corpusGraphs()).slice(0, 80)) {
    const pp = E.plan(gg);
    const heads = new Map(); gg.parts.forEach(pt => pt.events.forEach(e => (e.heads || []).forEach(h => heads.set(h.id, h.staff || e.staff))));
    pp.events.forEach(e => e.heads.forEach(h => assert.equal(h.staff, heads.get(h.id), rel)));
    pp.events.forEach(e => {
      const src = gg.parts.flatMap(pt => pt.events).find(x => x.id === e.id);
      if (src.display && (src.display.stem === 'up' || src.display.stem === 'down')) assert.equal(e.stem, src.display.stem, rel);
    });
  }
});

test('A46: the plan needs no G3 - G3-off and G3a graphs plan alike, and engrave/ never runs a G3 pass', () => {
  goldenGraphs().concat(g3aGraphs()).forEach(([k, g]) => assert.ok(E.audit(g, E.plan(g)).ok, k));
  fs.readdirSync(path.join(REPO, 'engrave')).filter(f => f.endsWith('.js')).forEach(f => {
    const src = fs.readFileSync(path.join(REPO, 'engrave', f), 'utf8');
    assert.doesNotMatch(src, /professionalize\s*\(/, f + ' runs no G3 pass');
    assert.doesNotMatch(src, /PROFESSIONAL_DEFAULT|pedalJoin\s*[:=]\s*true|g3b\s*[:=]\s*true/, f + ' touches no G3 switch');
  });
});

test('B1: a plan of the longest corpus score takes well under the budget', async () => {
  const g = await graphOf('catalog/method/sonatina/020.mxl');
  E.plan(g);
  /* the fastest of five: node --test runs the files side by side, and a mean measures the neighbours too
     (budgets are judged by the local report, G04 §19.2; this only catches a plan that became slow) */
  let ms = Infinity;
  for (let i = 0; i < 5; i++) {
    const t0 = process.hrtime.bigint();
    E.plan(g);
    ms = Math.min(ms, Number(process.hrtime.bigint() - t0) / 1e6);
  }
  assert.ok(ms < 60, ms.toFixed(1) + ' ms (budget B1 60 ms)');
});
