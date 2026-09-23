'use strict';
/* MusicXML import and export (G01 Appendix A, A3, A19-A26, A35). The G0 correctness fixtures
   (tests/bench/corpus/correctness, expected meaning written by hand from the MusicXML specification) say which
   key presses a file means; the tests compare the graph's own reading with them. The round trip judged by the
   app's reader (L1) and the notation inventory (L1+) is tests/bench/unit/test_scoregraph_roundtrip.py. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO, SG, FIX, read, json, sidecar, xml, corpus, importXml, codes, pitchName } = require('./helpers.js');
const R = SG.rational, P = SG.pitch;

const correctness = id => {
  const all = json(path.join(REPO, 'tests', 'bench', 'corpus', 'correctness', 'expected.json')).fixtures;
  const f = all.find(x => x.id.startsWith(id));
  return { expect: f.expect, text: corpus(path.join('tests', 'bench', 'corpus', 'correctness', f.file)) };
};
/* the graph's key presses: every head that no complete tie continues, held through its chain of complete ties */
function presses(g) {
  const out = [];
  g.parts.forEach(part => {
    const ties = part.spanners.filter(s => s.type === 'tie' && s.from && s.to);
    const next = new Map(ties.map(t => [t.from, t.to]));
    const continued = new Set(ties.map(t => t.to));
    const headAt = new Map();
    part.events.forEach(e => (e.heads || []).forEach(h => headAt.set(h.id, { e: e, h: h })));
    part.events.forEach(e => {
      if (e.grace || e.kind !== 'note') return;
      e.heads.forEach(h => {
        if (continued.has(h.id)) return;
        let dur = R.parse(e.dur), cur = h.id;
        while (next.has(cur)) { cur = next.get(cur); dur = R.add(dur, R.parse(headAt.get(cur).e.dur)); }
        const staffNo = part.staves.findIndex(s => s.id === (h.staff || e.staff)) + 1;
        out.push({ midi: P.midi(h.pitch), step: h.pitch.step, alter: h.pitch.alter || 0,
          onset_q: R.format(R.mul(SG.time.scorePos(g, e), R.make(4))), dur_q: R.format(R.mul(dur, R.make(4))), staff: staffNo });
      });
    });
  });
  const key = x => [x.onset_q.padStart(8), x.staff, x.midi].join('|');
  return out.sort((a, b) => (key(a) < key(b) ? -1 : 1));
}
const sortSounding = list => list.slice().sort((a, b) => {
  const ka = [String(a.onset_q).padStart(8), a.staff, a.midi].join('|'), kb = [String(b.onset_q).padStart(8), b.staff, b.midi].join('|');
  return ka < kb ? -1 : 1;
});

test('nested tuplets: every duration is the sidecar\'s exact rational and every tuplet fills its nominal length (A3)', () => {
  const g = importXml(xml('tuplets-nested')).graph;
  const exp = sidecar('xml', 'tuplets-nested.musicxml');
  const part = g.parts[0];
  assert.deepEqual(part.events.map(e => e.dur), exp.durations);
  const tuplets = part.spanners.filter(s => s.type === 'tuplet');
  assert.equal(tuplets.length, exp.tuplets.length);
  const byId = new Map(part.events.map(e => [e.id, e]));
  exp.tuplets.forEach((t, i) => {
    const s = tuplets[i];
    assert.deepEqual([s.actual, s.normal, s.events.length, !!s.parent], [t.actual, t.normal, t.members, !!t.nested]);
    const sum = s.events.reduce((a, id) => R.add(a, R.parse(byId.get(id).dur)), R.ZERO);
    assert.equal(R.format(sum), t.sum);
  });
  assert.deepEqual(codes(SG.validate(g).issues, 'WARNING'), exp.warnings);
});

test('concert pitch is stored, written pitch and MIDI derived: C03, C04 and a transposing clarinet and bass (A19)', () => {
  ['C03', 'C04'].forEach(id => {
    const c = correctness(id);
    assert.deepEqual(presses(importXml(c.text).graph), sortSounding(c.expect.sounding), id);
  });
  const g = importXml(xml('transposing')).graph;
  const exp = sidecar('xml', 'transposing.musicxml');
  const got = [];
  g.parts.forEach((part, pi) => part.events.forEach(e => e.heads.forEach(h => got.push({
    part: pi, concert: pitchName(h.pitch), written: pitchName(P.written(h.pitch, part.instrument.transpose)), midi: P.midi(h.pitch) }))));
  assert.deepEqual(got, exp.heads);
  assert.equal(g.timeline.keys.length, 1);
  assert.equal(g.timeline.keys[0].fifths, exp.concertKey);
  assert.deepEqual(g.parts.map(p => P.writtenFifths(g.timeline.keys[0].fifths, p.instrument.transpose)), exp.writtenKeys);
  /* the export writes the written pitch and the <transpose> back */
  const out = SG.musicxml.export(g).xml;
  assert.match(out, /<transpose><diatonic>-1<\/diatonic><chromatic>-2<\/chromatic><\/transpose>/);
  assert.match(out, /<transpose><diatonic>0<\/diatonic><chromatic>0<\/chromatic><octave-change>-1<\/octave-change><\/transpose>/);
  assert.match(out, /<step>F<\/step><alter>1<\/alter><octave>5<\/octave>/);
  assert.deepEqual(presses(importXml(out).graph), presses(g));
});

test('an ottava moves only the display: concert pitch = <pitch>, shift +1 for 8va and -1 for 8vb, display octave = oct - shift (A20)', () => {
  [['C10', 1], ['C11', -1]].forEach(([id, shift]) => {
    const c = correctness(id);
    const g = importXml(c.text).graph;
    assert.deepEqual(presses(g), sortSounding(c.expect.sounding), id);
    const ott = g.parts[0].spanners.filter(s => s.type === 'ottava');
    assert.equal(ott.length, 1, id);
    assert.equal(ott[0].shift, shift, id);
    const inside = g.parts[0].events.filter(e => {
      const w = SG.time.scorePos(g, e);
      return R.ge(w, SG.time.scorePos(g, ott[0].from)) && R.lt(w, SG.time.scorePos(g, ott[0].to));
    });
    assert.ok(inside.length > 0);
    inside.forEach(e => e.heads.forEach(h => assert.equal(P.displayOctave(h.pitch, ott[0].shift), h.pitch.oct - shift)));
    const out = SG.musicxml.export(g).xml;
    assert.equal((out.match(/<octave-shift type="(up|down)"/g) || []).length, 1);
    assert.match(out, new RegExp('<octave-shift type="' + (shift > 0 ? 'down' : 'up') + '" size="8"'));
  });
});

test('voices and staves: C12, four voices, a grand staff and cross-staff notation keep their voices, staves and heads (A21)', () => {
  const c = correctness('C12');
  const g12 = importXml(c.text).graph;
  assert.deepEqual(presses(g12), sortSounding(c.expect.sounding));
  const four = importXml(xml('voices-4')).graph;
  assert.deepEqual(four.parts[0].voices.map(v => ({ label: v.label, staff: four.parts[0].staves.findIndex(s => s.id === v.staff) + 1 })),
    sidecar('xml', 'voices-4.musicxml').voices);
  const grand = importXml(xml('grand-staff')).graph;
  assert.equal(grand.parts[0].events.filter(e => e.heads && e.heads.length > 1).length, sidecar('xml', 'grand-staff.musicxml').chords);
  const cross = importXml(xml('cross-staff')).graph;
  const part = cross.parts[0];
  const sn = id => part.staves.findIndex(s => s.id === id) + 1;
  const label = id => part.voices.find(v => v.id === id).label;
  const got = part.events.map(e => ({ voice: label(e.voice), at: e.at, staff: sn(e.staff),
    heads: e.heads.map(h => Object.assign({ pitch: pitchName(h.pitch) }, h.staff ? { staff: sn(h.staff) } : {}, { limb: P.limbOf(part, e, h) }).valueOf()) }))
    .map(e => Object.assign(e, { heads: e.heads.map(h => (h.staff === undefined ? { pitch: h.pitch, limb: h.limb } : { pitch: h.pitch, staff: h.staff, limb: h.limb })) }));
  const exp = sidecar('xml', 'cross-staff.musicxml').events.map(e => Object.assign({}, e, { heads: e.heads.map(h => {
    const x = { pitch: h.pitch }; if (h.staff !== undefined && h.staff !== e.staff) x.staff = h.staff; x.limb = h.limb; return x; }) }));
  assert.deepEqual(got, exp);
  [g12, four, grand, cross].forEach(g => {
    const errs = codes(SG.validate(g).issues, 'ERROR');
    assert.equal(errs['E-VOICE-OVERLAP'], undefined);
    assert.equal(errs['E-VOICE-STAFF'], undefined);
  });
  const arp = part.spanners.find(s => s.type === 'arpeggio');
  assert.deepEqual([arp.heads.length, arp.dir], [sidecar('xml', 'cross-staff.musicxml').arpeggio.heads, 'up']);
});

test('ties: complete ties join, open ones stay open, <tied> alone is not a sounding tie (C01, C02, C13, ties-slurs, A22)', () => {
  ['C01', 'C02', 'C13'].forEach(id => {
    const c = correctness(id);
    assert.deepEqual(presses(importXml(c.text).graph), sortSounding(c.expect.sounding), id);
  });
  /* C13: no <tie> of the file finds its partner (a note or a rest comes between), so each is an open tie */
  const c13text = correctness('C13').text.replace(/<!--[\s\S]*?-->/g, '');
  const c13 = importXml(c13text).graph;
  const open13 = c13.parts[0].spanners.filter(s => s.type === 'tie' && (!s.from || !s.to));
  assert.equal(open13.filter(s => s.from).length, (c13text.match(/<tie type="start"\/>/g) || []).length);
  assert.equal(open13.filter(s => s.to).length, (c13text.match(/<tie type="stop"\/>/g) || []).length);
  assert.equal(c13.parts[0].spanners.filter(s => s.type === 'tie' && s.from && s.to).length, 0);
  const g = importXml(xml('ties-slurs')).graph;
  const exp = sidecar('xml', 'ties-slurs.musicxml');
  const ties = g.parts[0].spanners.filter(s => s.type === 'tie');
  assert.deepEqual({ complete: ties.filter(s => s.from && s.to).length, openStart: ties.filter(s => s.from && !s.to).length, openStop: ties.filter(s => !s.from && s.to).length }, exp.ties);
  assert.equal(g.parts[0].spanners.filter(s => s.type === 'slur').length, exp.slurs);
  assert.deepEqual(codes(SG.validate(g).issues, 'WARNING'), exp.warnings);
  /* the export writes every <tie> start and stop back, and <tied> with them */
  const out = SG.musicxml.export(g).xml;
  const count = (s, re) => (s.match(re) || []).length;
  const src = xml('ties-slurs');
  ['<tie type="start"/>', '<tie type="stop"/>'].forEach(t => assert.equal(count(out, new RegExp(t, 'g')), count(src, new RegExp(t, 'g')), t));
  assert.equal(count(out, /<slur type="start"/g), count(src, /<slur type="start"/g));
  assert.equal(count(out, /<slur type="stop"/g), count(src, /<slur type="stop"/g));
});

test('grace notes (C07) come in with duration 0, their order and slash, and survive the round trip (A23)', () => {
  const c = correctness('C07');
  const g = importXml(c.text).graph;
  assert.deepEqual(presses(g), sortSounding(c.expect.sounding));
  const graces = g.parts[0].events.filter(e => e.grace);
  assert.ok(graces.length >= 3);
  graces.forEach(e => { assert.equal(e.dur, '0'); assert.ok(e.grace.order >= 1); });
  assert.ok(graces.some(e => e.grace.slash));
  assert.ok(graces.some(e => e.grace.order === 2));
  const back = importXml(SG.musicxml.export(g, { software: g.provenance.sources[0].tool }).xml).graph;
  const core = x => { const d = JSON.parse(SG.serialize(x)); d.provenance.sources.forEach(s => delete s.input); return d; };
  assert.deepEqual(core(back), core(g));
});

test('piano: limbs from staff, voice and head; pedal, fingerings and a two-staff arpeggio survive the round trip (A24)', () => {
  const grand = importXml(xml('grand-staff')).graph;
  const part = grand.parts[0];
  part.events.forEach(e => e.heads.forEach(h => assert.equal(P.limbOf(part, e, h), sidecar('xml', 'grand-staff.musicxml').limbs[String(part.staves.findIndex(s => s.id === (h.staff || e.staff)) + 1)])));
  const cross = SG.parse(read(path.join(FIX, 'valid', 'cross-staff.sg.json')));
  const cp = cross.parts[0];
  const e2 = cp.events.find(e => e.voice === cp.voices[2].id);            /* voice with limb LH on the treble staff */
  assert.equal(P.limbOf(cp, e2, e2.heads[0]), 'LH');
  const withHead = cp.events.find(e => e.heads.some(h => h.limb === 'LH' && !h.staff));
  assert.equal(P.limbOf(cp, withHead, withHead.heads[0]), 'LH');     /* head limb over the RH staff */
  const g = importXml(xml('piano-marks')).graph;
  const exp = sidecar('xml', 'piano-marks.musicxml');
  const ms = g.timeline.measures.map(m => m.id);
  const ped = g.parts[0].spanners.find(s => s.type === 'pedal');
  assert.deepEqual([ms.indexOf(ped.from.m), ped.from.at], exp.pedal.from);
  assert.deepEqual(ped.changes.map(c => [ms.indexOf(c.m), c.at]), exp.pedal.changes);
  assert.deepEqual([ms.indexOf(ped.to.m), ped.to.at], exp.pedal.to);
  assert.equal(ped.mark.line, exp.pedal.line);
  const fing = [];
  g.parts[0].events.forEach(e => e.heads.forEach(h => { if (h.fingering) fing.push(h.fingering.map(f => f.f + (f.subst ? ' (subst)' : ''))); }));
  assert.deepEqual(fing, exp.fingerings);
  assert.equal(g.parts[0].spanners.find(s => s.type === 'arpeggio').heads.length, exp.arpeggio.heads);
  const back = importXml(SG.musicxml.export(g).xml).graph;
  const core = x => { const d = JSON.parse(SG.serialize(x)); d.provenance.sources.forEach(s => delete s.input); return d; };
  assert.deepEqual(core(back), core(g));
});

test('a piano part and a drum part share one timeline and validate: kit of 8, two voices, four limbs, a two-head hit, a flam, a render (A25)', () => {
  const text = read(path.join(FIX, 'valid', 'drums-with-piano.sg.json'));
  const g = SG.parse(text);
  const r = SG.validate(g);
  assert.equal(r.ok, true);
  assert.equal(SG.serialize(g), text);
  const drums = g.parts.find(p => p.instrument.kind === 'drumset');
  assert.equal(drums.instrument.kit.items.length, 8);
  assert.deepEqual(drums.instrument.kit.items.map(i => i.key).sort(),
    ['crash', 'hh-closed', 'hh-open', 'hh-pedal', 'kick', 'ride', 'snare', 'tom-hi']);
  assert.equal(drums.voices.length, 2);
  const limbs = new Set();
  drums.events.forEach(e => (e.heads || []).forEach(h => limbs.add(P.limbOf(drums, e, h))));
  assert.deepEqual(Array.from(limbs).sort(), ['LF', 'LH', 'RF', 'RH']);
  assert.ok(drums.events.some(e => e.kind === 'perc' && e.heads.length === 2));
  assert.ok(drums.events.some(e => (e.heads || []).some(h => h.stroke === 'flam')));
  assert.ok(g.performances.some(p => p.kind === 'render' && p.notes.every(n => n.inst && n.part === drums.id)));
  assert.equal(g.timeline.measures.length, 4);
});

test('percussion comes in as perc events with the kit the file names, and goes back out (A7, G02 §17)', () => {
  const r = importXml(xml('unpitched'));
  const part = r.graph.parts[0];
  assert.equal(part.instrument.family, 'percussion');
  assert.equal(part.staves[0].kind, 'percussion');
  assert.deepEqual(part.instrument.kit.items,
    [{ key: 'bass-drum', name: 'Bass Drum', pos: { step: 'F', oct: 4 } }]);
  assert.deepEqual(part.events.map(e => e.kind), ['perc']);
  assert.deepEqual(part.events[0].heads.map(h => [h.inst, h.pos.step + h.pos.oct]), [['bass-drum', 'F4']]);
  assert.deepEqual(r.report.dropped, {}, 'nothing of a drum part is dropped');
  assert.equal(SG.validate(r.graph).ok, true);
  /* and back: the kit piece becomes a <score-instrument> the note points at again */
  const x = SG.musicxml.export(r.graph);
  assert.equal(x.ok, true, x.message);
  assert.match(x.xml, /<unpitched><display-step>F<\/display-step><display-octave>4<\/display-octave><\/unpitched>/);
  assert.match(x.xml, /<instrument id="P1-I1"\/>/);
  const back = importXml(x.xml);
  assert.deepEqual(back.graph.parts[0].instrument.kit.items, part.instrument.kit.items);
  assert.deepEqual(back.graph.parts[0].events.map(e => e.kind), ['perc']);
  /* a piano and a drum part in one graph write and read back the same way */
  const both = SG.parse(read(path.join(FIX, 'valid', 'drums-with-piano.sg.json')));
  const bx = SG.musicxml.export(both);
  assert.equal(bx.ok, true, bx.message);
  const bback = importXml(bx.xml);
  assert.deepEqual(bback.graph.parts.map(p => p.instrument.family), both.parts.map(p => p.instrument.family));
});

test('a file that is not score-partwise XML is refused as a value, never as an exception', () => {
  assert.deepEqual([SG.musicxml.import('<score-timewise/>').code, SG.musicxml.import('<nope').code], ['IMPORT-TIMEWISE', 'IMPORT-BAD-XML']);
});

test('the import report names every element it does not map: figured-bass, print, credit, defaults (A35)', () => {
  const r = importXml(xml('dropped'));
  ['figured-bass', 'print', 'credit', 'defaults'].forEach(n => assert.ok(r.report.dropped[n] >= 1, n));
  /* an element it reads is never reported */
  const clean = importXml(xml('grand-staff'));
  assert.deepEqual(clean.report.dropped, {});
});

test('the XML reader refuses what a MusicXML file must not have: entities, unclosed tags, text outside the root (R8)', () => {
  const X = SG.xml;
  assert.throws(() => X.parse('<!DOCTYPE a [<!ENTITY x "boom">]><a>&x;</a>'), e => e.code === 'bad-xml');
  assert.throws(() => X.parse('<a><b></a>'), e => e.code === 'bad-xml');
  assert.throws(() => X.parse('<a/>junk'), e => e.code === 'bad-xml');
  assert.equal(X.parse('<a x="1 &amp; 2">&#233;&#x41;<![CDATA[<b>]]></a>').root.text, 'éA<b>');
  assert.equal(X.parse('<a x="1 &amp; 2"/>').root.attrs.x, '1 & 2');
});
