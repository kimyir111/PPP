/* "Right-hand run rests" (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md section 12): the teacher's latest copy (2eac172) of their YouTube transcription shows the left-hand problem in the RIGHT hand, bar 11:
   `dotted eighth, 16th rest, 16th, 16th rest, 16th, 16th` - 16th rests wedged between the notes of a run. scoregraph/gaps.js fillRunRests is now ONE rule for both hands:
     - a lone plain 16th rest, a note of the same voice ending where it starts and a note of the voice starting where it ends -> the rest is removed and the note before it is lengthened by that 16th
       when the lengthened value is a plain written value (undotted or single-dotted): 16th -> eighth, eighth -> dotted eighth, dotted eighth -> quarter; a quarter (5/16) or a dotted quarter (7/16) keeps its rest
     - the note stays drawn as what it lasts (written value = exact length), never past the next onset or the barline; a tied / tuplet / grace / other-voice note, an eighth or longer rest, a bar end with no
       note after it are left alone
     - idempotent, a fixed point with closeSmallGaps / mergeRests / the tuplet pass; gated like the other passes (a recording only); the bars of an exact-bars recording still add up */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests/scoregraph/g3-helpers.js'));
const R = require(path.join(REPO, 'scoregraph/rational.js'));
const S = require(path.join(REPO, 'scoregraph/schema.js'));
const V = require(path.join(REPO, 'scoregraph/validate.js'));
const GAPS = require(path.join(REPO, 'scoregraph/gaps.js'));
const RT = require(path.join(REPO, 'scoregraph/rec-tuplet.js'));
const A = require(path.join(REPO, 'audio-score.js'));

const mIndex = g => new Map(g.timeline.measures.map((m, i) => [m.id, i + 1]));
const rhStaff = g => g.parts[0].staves.find(s => s.limb !== 'LH').id;
const lhStaff = g => g.parts[0].staves.find(s => s.limb === 'LH').id;
const errors = g => V.validate(g).issues.filter(i => /^E-/.test(i.code));
const fill = g => GAPS.fillRunRests(g);
/* the events of a hand as 'bar@beat:value=length' text (beat in quarters from the bar's start; a rest is 'r' + value) */
function hand(g, staff) {
  const mi = mIndex(g);
  return g.parts[0].events.filter(e => e.staff === staff && !e.grace && (e.kind === 'note' || e.kind === 'rest'))
    .sort((a, b) => mi.get(a.m) - mi.get(b.m) || R.cmp(R.parse(a.at), R.parse(b.at)))
    .map(e => mi.get(e.m) + '@' + R.toNumber(R.parse(e.at)) * 4 + ':' + (e.kind === 'rest' ? 'r' : '') + e.display.type + (e.display.dots ? '.' : '') + '=' + e.dur);
}
const rhOf = g => hand(g, rhStaff(g));
const lhOf = g => hand(g, lhStaff(g));
const rests = g => g.parts[0].events.filter(e => e.kind === 'rest').length;
const onsets = g => g.parts[0].events.filter(e => e.kind === 'note').map(e => [mIndex(g).get(e.m), e.at, e.staff, e.voice, e.heads.map(h => h.pitch.step + h.pitch.oct).join('+')].join('|')).sort();

/* a 4/4 bar from tokens, completed with 16th notes up to the barline (units: 32nds) */
const UNITS = { '32': 1, '16': 2, '16.': 3, '8': 4, '8.': 6, q: 8, 'q.': 12, h: 16, 'h.': 24 };
const PITCH = ['C5', 'E5', 'G5', 'E5', 'D5', 'F5', 'A5', 'F5'];
function bar(...tokens) {
  let u = 0, k = 0;
  const out = tokens.map(t => {
    if (t === 'n') t = PITCH[k++ % 8] + ':16';
    else if (t === 'r') t = 'r:16';
    u += UNITS[t.split(':')[1].replace(/=.*$/, '').replace(/~$/, '')];
    return t;
  });
  while (u < 32) { if (32 - u === 1) { out.push('B5:32'); u += 1; } else { out.push(PITCH[k++ % 8] + ':16'); u += 2; } }
  assert.equal(u, 32, 'the bar is full: ' + tokens.join(' '));
  return out.join(' ');
}
const rh = line => mk({ rh: line, lh: 'C3:w' });

test('the teacher\'s bar 11 in the right hand: dotted eighth + 16th rest -> quarter; 16th + 16th rest -> eighth; the rests vanish', () => {
  /* dotted eighth (3), rest (1), 16th (1), rest (1), 16th (1), 16th (1), then a half note: 16 sixteenths */
  const g = rh('C5:8. r:16 D5:16 r:16 E5:16 F5:16 G5:h');
  assert.deepEqual(rhOf(g), ['1@0:eighth.=3/16', '1@0.75:r16th=1/16', '1@1:16th=1/16', '1@1.25:r16th=1/16', '1@1.5:16th=1/16', '1@1.75:16th=1/16', '1@2:half=1/2'].map(s => s.replace(/@([0-9.]+):/, (m, b) => '@' + b + ':')));
  const r = fill(g);
  assert.equal(r.changed, true);
  assert.deepEqual(r.stats, { fills: 2, notesLengthened: 2, restsRemoved: 2, skipped: 0 });
  assert.deepEqual(rhOf(r.graph), ['1@0:quarter=1/4', '1@1:eighth=1/8', '1@1.5:16th=1/16', '1@1.75:16th=1/16', '1@2:half=1/2']);
  assert.equal(rests(r.graph), 0);
  assert.deepEqual(onsets(r.graph), onsets(g), 'onsets and pitches never change');
  assert.equal(errors(r.graph).length, 0);
  assert.equal(fill(r.graph).graph, r.graph, 'idempotent');
  assert.equal(GAPS.tidyRests(g).fill.fills, 2);
  assert.ok(r.graph.provenance.sources.some(s => s.tool === 'ppp.run-rests'));
  r.graph.parts[0].events.filter(e => e.kind === 'note' && e.dur !== g.parts[0].events.find(x => x.id === e.id).dur).forEach(e => {
    const v = S.noteValue(e.display.type, e.display.dots);
    assert.ok(R.eq(v, R.parse(e.dur)), 'a lengthened note is drawn as what it lasts');
  });
});

test('the lengthened value: 16th -> eighth, eighth -> dotted eighth, dotted eighth -> quarter, 32nd -> dotted 16th; a quarter (5/16), a dotted quarter (7/16) and a half (9/16) keep the rest', () => {
  const cases = [
    ['16th + rest -> eighth', bar('C5:16', 'r'), '1@0:eighth=1/8'],
    ['eighth + rest -> dotted eighth', bar('C5:8', 'r'), '1@0:eighth.=3/16'],
    ['dotted eighth + rest -> quarter', bar('C5:8.', 'r'), '1@0:quarter=1/4'],
    ['32nd + rest -> dotted 16th', bar('C5:32', 'C5:32', 'r', 'n', 'n', 'n'), '1@0.125:16th.=3/32']
  ];
  cases.forEach(c => {
    const g = rh(c[1]);
    const r = fill(g);
    assert.equal(r.changed, true, c[0]);
    assert.ok(rhOf(r.graph).includes(c[2]), c[0] + ': ' + rhOf(r.graph).join(' '));
    assert.equal(rests(r.graph), 0, c[0]);
    assert.equal(errors(r.graph).length, 0, c[0]);
    assert.deepEqual(onsets(r.graph), onsets(g), c[0]);
  });
  ['quarter', 'quarter dotted', 'half'].forEach((name, i) => {
    const tok = ['q', 'q.', 'h'][i];
    const g = rh(bar('C5:' + tok, 'r', 'n', 'n'));
    const r = fill(g);
    assert.equal(r.changed, false, name + ' + a 16th rest has no plain value');
    assert.equal(r.graph, g);
  });
  /* an eighth or longer rest is musical: never touched, whatever the note before it */
  ['8', '8.', 'q'].forEach(t => {
    const g = rh(bar('C5:16', 'D5:16', 'r:' + t, 'n', 'n'));
    assert.equal(fill(g).changed, false, 'a rest of ' + t);
  });
});

test('at the barline: the lengthened note ends on it, the next bar\'s first note is the note after; no note after keeps the rest', () => {
  const g = rh(bar('C5:q', 'C5:q', 'C5:q', 'C5:8.', 'r') + ' | ' + bar('D5:q'));
  const r = fill(g);
  assert.equal(r.changed, true);
  const last = rhOf(r.graph).filter(s => s.startsWith('1@')).pop();
  assert.equal(last, '1@3:quarter=1/4');
  assert.equal(rests(r.graph), 0);
  const bar1 = r.graph.parts[0].events.filter(e => e.kind === 'note' && e.m === r.graph.timeline.measures[0].id);
  bar1.forEach(e => assert.ok(R.le(R.add(R.parse(e.at), R.parse(e.dur)), R.parse(r.graph.timeline.measures[0].dur)), 'inside the bar'));
  const next = rh(bar('C5:q', 'C5:q', 'C5:q', 'C5:8.', 'r') + ' | ' + 'r:w');
  assert.equal(fill(next).changed, false, 'the next bar opens with a rest: no note after it');
  const last2 = rh(bar('C5:q', 'C5:q', 'C5:q', 'C5:8.', 'r'));
  assert.equal(fill(last2).changed, false, 'the last bar: no note after the rest');
});

test('not touched in the right hand: a tied note or chord, tuplet, grace or other-voice note; a note that is not drawn as what it lasts', () => {
  const head = 'C5:16 E5:16 G5:16 E5:16 C5:16 E5:16 G5:16 E5:16 C5:16 E5:16 G5:16 E5:16 ';
  assert.equal(fill(rh(head + 'D5:16 r:16 E5:16 F5:16')).changed, true, 'control');
  assert.equal(fill(rh(head + 'D5:16~ D5:16 r:16 E5:16')).changed, false, 'tied into the note before the rest');
  assert.equal(fill(rh(head + 'C5+G5:16~ C5+G5:16 r:16 E5:16')).changed, false, 'a chord tied into the chord before the rest');
  assert.equal(fill(rh('C5:16 E5:16 G5:16 E5:16 C5:16 E5:16 G5:16 E5:16 C5:8 3s[ D5:16 E5:16 r:16] F5:16 G5:16 A5:16 B5:16')).changed, false, 'a tuplet');
  const grace = mk({ rh: bar('n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'r') + ' | r:w', lh: 'C3:w | C3:w', graces: [{ staff: 0, bar: 1, at: '0', pitch: 'A4', type: 'eighth' }] });
  assert.equal(fill(grace).changed, false, 'the next bar holds only a grace note');
  /* a written value that is not what the note lasts (an importer's convention: r:8=1/12): not a plain value */
  assert.equal(fill(rh(head + 'D5:8=3/32 r:16 E5:16 G5:32')).changed, false, 'a note printed as an eighth that lasts 3/32');
  /* another voice of the hand starting inside the rest's span */
  const clash = mk({ rh: head + 'D5:16 r:16 E5:16 F5:16', rh2: 'r:q r:q r:q r:16 B4:16 r:8', lh: 'C3:w' });
  assert.equal(fill(clash).changed, false, 'a note of the other voice starts inside the span');
  const calm = mk({ rh: head + 'D5:16 r:16 E5:16 F5:16', rh2: 'r:q r:q r:q r:16 r:16 r:8', lh: 'C3:w' });
  assert.equal(fill(calm).changed, true, 'control');
});

test('a chord before the rest is lengthened as a whole (bar 11 of the teacher: the dotted eighth is a chord): every head keeps its pitch, no head is tied', () => {
  const g = rh('D5+B5:8. r:16 E5:16 r:16 F5:16 G5:16 A5:h');
  const r = fill(g);
  assert.equal(r.stats.fills, 2);
  const first = r.graph.parts[0].events.filter(e => e.kind === 'note').sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)))[0];
  assert.equal(first.heads.length, 2);
  assert.deepEqual(first.heads.map(h => h.pitch.step + h.pitch.oct).sort(), ['B5', 'D5']);
  assert.equal(first.dur, '1/4');
  assert.equal(first.display.type, 'quarter');
  assert.equal(first.display.dots, undefined);
  assert.equal(errors(r.graph).length, 0);
  assert.deepEqual(onsets(r.graph), onsets(g));
});

test('both hands, one rule: a lone 16th rest goes in either hand, the other hand\'s rests of other lengths stay', () => {
  const g = mk({ rh: bar('C5:8.', 'r', 'n', 'r', 'n', 'n', 'r:8', 'n', 'n'), lh: bar('C3:8', 'r', 'n', 'n', 'r:q') });
  const r = fill(g);
  assert.equal(r.changed, true);
  const rhRests = x => x.parts[0].events.filter(e => e.kind === 'rest' && e.staff === rhStaff(x)).map(e => e.display.type + (e.display.dots ? '.' : '')).sort();
  const lhRests = x => x.parts[0].events.filter(e => e.kind === 'rest' && e.staff === lhStaff(x)).map(e => e.display.type).sort();
  assert.deepEqual(rhRests(g), ['16th', '16th', 'eighth']);
  assert.deepEqual(rhRests(r.graph), ['eighth'], 'two lone 16th rests gone, the eighth rest stays');
  assert.deepEqual(lhRests(g), ['16th', 'quarter']);
  assert.deepEqual(lhRests(r.graph), ['quarter'], 'the left hand\'s lone 16th rest gone, its quarter rest stays');
  assert.equal(errors(r.graph).length, 0);
  assert.deepEqual(onsets(r.graph), onsets(g));
  assert.equal(fill(r.graph).graph, r.graph);
});

test('the old left-hand result: where the old rule filled (16th note, 16th rest, note), the generalised rule gives the same graph', () => {
  const g = mk({ rh: 'C5:w | C5:w | C5:w', lh: bar('C3:16', 'r', 'n', 'n', 'n', 'r', 'n') + ' | ' + bar('n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'r') + ' | ' + bar('n') });
  const r = fill(g);
  assert.equal(r.stats.fills, 3);
  lhOf(r.graph).filter(s => /=1\/8$/.test(s)).forEach(s => assert.ok(/:eighth=1\/8$/.test(s)));
  assert.equal(rests(r.graph), 0);
});

test('seeded fuzz over both hands and every length: idempotent, fixed point with the other passes and the tuplet pass, onsets and pitches kept, notes drawn as what they last, valid', () => {
  let s = 17;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const toks = () => {
    const out = []; let u = 0;
    const pick = ['16', '16', '16', '8', '8.', 'q', '32'];
    while (u < 30) {
      const code = pick[Math.floor(rnd() * pick.length)];
      const w = UNITS[code];
      if (u + w > 32) break;
      const isRest = rnd() < 0.25;
      out.push((isRest ? 'r' : PITCH[Math.floor(rnd() * 8)]) + ':' + code); u += w;
    }
    return bar(...out);
  };
  let filled = 0, bars = 0;
  for (let it = 0; it < 150; it++) {
    const g = mk({ rh: [toks(), toks(), toks()].join(' | '), lh: [toks(), toks(), toks()].join(' | ') });
    const a = fill(g);
    assert.equal(fill(a.graph).graph, a.graph, 'idempotent');
    assert.equal(errors(a.graph).length, 0, 'valid');
    assert.deepEqual(onsets(a.graph), onsets(g));
    assert.equal(rests(a.graph) + a.stats.fills, rests(g), 'every fill removes exactly one rest');
    filled += a.stats.fills;
    const t = GAPS.tidyRests(g);
    assert.equal(GAPS.tidyRests(t.graph).graph, t.graph, 'tidyRests is a fixed point');
    assert.equal(GAPS.closeSmallGaps(t.graph).graph, t.graph);
    assert.equal(GAPS.mergeRests(t.graph).graph, t.graph);
    assert.equal(fill(t.graph).graph, t.graph);
    assert.equal(RT.addTriplets(t.graph).graph, t.graph);
    assert.deepEqual(onsets(t.graph), onsets(g));
    /* the length of a note the fill lengthened is exactly its written value, and no note passes the next onset of its hand */
    const idx = new Map(g.parts[0].events.map(e => [e.id, e]));
    a.graph.parts[0].events.filter(e => e.kind === 'note').forEach(e => {
      const was = idx.get(e.id);
      if (was && was.dur !== e.dur) assert.ok(R.eq(S.noteValue(e.display.type, e.display.dots), R.parse(e.dur)), 'drawn as it lasts');
    });
    bars++;
  }
  assert.ok(filled > 100, 'the fuzz fills: ' + filled + ' in ' + bars);
});

/* ---- a recording through audio-score with exact bars: the right hand's lone 16th rests go and every bar still adds up as drawn */
function drawnBad(g) {
  const part = g.parts[0];
  const mIdx = new Map(g.timeline.measures.map((m, i) => [m.id, i]));
  const tupById = new Map(part.spanners.filter(x => x.type === 'tuplet').map(t => [t.id, t]));
  const tupsOf = new Map();
  part.spanners.filter(x => x.type === 'tuplet').forEach(t => t.events.forEach(id => { if (!tupsOf.has(id)) tupsOf.set(id, []); tupsOf.get(id).push(t); }));
  const ratio = id => { const l = tupsOf.get(id) || []; let t = l[0], r = R.ONE, n = 0; while (t && n++ < 8) { r = R.mul(r, R.make(t.normal, t.actual)); t = t.parent ? tupById.get(t.parent) : null; } return r; };
  const by = new Map();
  part.events.forEach(e => { if (e.grace || (e.kind !== 'note' && e.kind !== 'rest')) return; const k = e.staff + '|' + e.voice + '|' + e.m; if (!by.has(k)) by.set(k, []); by.get(k).push(e); });
  const bad = [];
  by.forEach((evs, k) => {
    evs.sort((a, b) => R.cmp(R.parse(a.at), R.parse(b.at)));
    let cur = R.ZERO, ok = true, sum = R.ZERO;
    evs.forEach(e => {
      const base = e.display && e.display.type ? S.noteValue(e.display.type, e.display.dots) : null;
      if (!base) { ok = false; return; }
      const d = R.mul(base, ratio(e.id));
      sum = R.add(sum, d);
      if (!R.eq(R.parse(e.at), cur) || !R.eq(R.parse(e.dur), d)) ok = false;
      cur = R.add(R.parse(e.at), R.parse(e.dur));
    });
    const len = R.parse(g.timeline.measures[mIdx.get(evs[0].m)].dur);
    if (!R.eq(cur, len) || !R.eq(sum, len)) ok = false;
    if (!ok) bad.push(k);
  });
  return bad;
}
test('recordings: a right-hand 16th figure with dropped notes, through audio-score with exact bars: no lone 16th rest between notes in either hand, every bar adds up, a MIDI source and the library default are untouched', () => {
  let sd = 5;
  const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  const heard = [];
  const bpm = 120, spb = 60 / bpm;
  for (let b = 0; b < 16; b++) {
    const t0 = b * 4 * spb;
    /* right hand: 16th notes in the first two beats (a note not heard now and then), a quarter, then a half */
    for (let k = 0; k < 8; k++) {
      if (k > 0 && k < 7 && rnd() < 0.3) continue;
      heard.push({ on: t0 + k * spb / 4, off: t0 + k * spb / 4 + spb / 4 * (rnd() < 0.5 ? 0.9 : 0.5), midi: 72 + (k % 4) * 2, vel: 80 });
    }
    heard.push({ on: t0 + 2 * spb, off: t0 + 3 * spb - 0.02, midi: 76, vel: 80 });
    heard.push({ on: t0 + 3 * spb, off: t0 + 4 * spb - 0.02, midi: 74, vel: 80 });
    /* left hand: a steady 16th arpeggio with some notes missing */
    for (let k = 0; k < 16; k++) {
      if (k > 0 && k < 15 && rnd() < 0.15) continue;
      heard.push({ on: t0 + k * spb / 4, off: t0 + k * spb / 4 + spb / 4 * 0.9, midi: [48, 52, 55, 52][k % 4], vel: 60 });
    }
  }
  const LOCK = { bpm: bpm, beatsPerBar: 4, beatType: 4, firstDownbeat: 0 };
  const make = o => A.toMusicXml({ notes: heard, pedals: [], title: 'rh-run' }, Object.assign({ title: 'rh-run', lock: LOCK, exactBars: true }, o));
  const loneRests = (g, staffOf) => {
    const ev = g.parts[0].events.filter(e => (e.kind === 'note' || e.kind === 'rest') && !e.grace && staffOf(g) === e.staff);
    return ev.filter(r => r.kind === 'rest' && r.display.type === '16th' && !r.display.dots && ev.some(n => n.kind === 'note' && n.voice === r.voice && R.eq(R.add(R.parse(n.at), R.parse(n.dur)), R.parse(r.at)) && n.m === r.m)
      && ev.some(n => n.kind === 'note' && n.voice === r.voice && (R.eq(R.parse(n.at), R.add(R.parse(r.at), R.parse(r.dur))) && n.m === r.m))).length;
  };
  const plain = make({}), closed = make({ closeGaps: true });
  assert.ok(loneRests(plain.graph, rhStaff) > 3, 'the control has lone 16th rests in the right hand: ' + loneRests(plain.graph, rhStaff));
  assert.ok(loneRests(plain.graph, lhStaff) > 3, 'and in the left hand: ' + loneRests(plain.graph, lhStaff));
  assert.equal(loneRests(closed.graph, rhStaff), 0, 'none is left in the right hand');
  assert.equal(loneRests(closed.graph, lhStaff), 0, 'none is left in the left hand');
  assert.deepEqual(drawnBad(plain.graph), [], 'the control adds up too');
  assert.deepEqual(drawnBad(closed.graph), [], 'every voice-bar still adds up as drawn after the fill');
  assert.equal(errors(closed.graph).length, 0);
  assert.equal(GAPS.tidyRests(closed.graph).graph, closed.graph, 'a fixed point');
  assert.equal(RT.addTriplets(closed.graph).graph, closed.graph);
  assert.ok(closed.graph.provenance.sources.some(x => x.tool === 'ppp.run-rests'));
  assert.deepEqual(onsets(closed.graph), onsets(GAPS.mergeRests(GAPS.closeSmallGaps(plain.graph).graph).graph), 'onsets and pitches are those of the graph without the fill');
  const def = A.toMusicXml({ notes: heard, pedals: [], title: 'rh-run' }, { title: 'rh-run', lock: LOCK });
  assert.ok(!def.graph.provenance.sources.some(x => x.tool === 'ppp.run-rests'), 'library default: no tidy');
  const midi = make({ closeGaps: true, sourceKind: 'midi-file' });
  assert.ok(!midi.graph.provenance.sources.some(x => x.tool === 'ppp.run-rests'), 'a MIDI source is not tidied');
});

test('the gate: a clean MusicXML score through the one-note pipeline is not tidied', async () => {
  const CAND = require(path.join(REPO, 'candidates/index.js'));
  const SGG = require(path.join(REPO, 'songgraph/index.js'));
  const REP = require(path.join(REPO, 'repair/index.js'));
  const H = require(path.join(REPO, 'tests/engrave/helpers.js'));
  const g = await H.graphOf('tests/fixtures/g9f-small-gaps.musicxml');
  const request = { targetLevel: 2, handProfile: 'large', sections: 'all' };
  const sg = SGG.analyze(g);
  let sel = CAND.run(g, sg, request, { singleNoteHands: true });
  if (!sel.ok) sel = CAND.run(g, sg, request, { singleNoteHands: true, relax: 2 });
  assert.ok(sel.ok);
  const out = REP.repairSelection(sel, g, sg, request, undefined);
  assert.equal(out.graph.provenance.sources.some(x => x.tool === 'ppp.run-rests'), false, 'a printed score: the pass is not run');
});
