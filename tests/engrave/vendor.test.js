/* G4a: VexFlow 4.2.3, pinned and served by PPP itself (docs/GOALS/G04 §8.5, §20, A29).

   The exact published bytes, a hash that holds on every checkout, the licences that must travel with it, and the
   property G04 §7.3 rests on: its geometry needs no DOM and is the same every run. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REPO } = require('./helpers.js');

const V = path.join(REPO, 'vendor');
const SHA256 = '86855aa3f6e2202738d90807a1aa78c039d4264789e016a851c120a1bb8bbb73';
const SRI = 'sha384-HcSKHU8C+2rx18IlCMSlVWuygC4W9XRY8ebpaoE3Tg1iJO0g64QCxO2vO5HXIokW';

test('the vendored file is VexFlow 4.2.3 byte for byte, and the README says which bytes', () => {
  const buf = fs.readFileSync(path.join(V, 'vexflow-4.2.3.js'));
  assert.equal(buf.length, 992166);
  assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), SHA256);
  assert.equal('sha384-' + crypto.createHash('sha384').update(buf).digest('base64'), SRI);
  assert.equal(buf.indexOf(13), -1, 'no carriage return: no line-ending conversion touched it');
  assert.match(buf.slice(0, 200).toString('latin1'), /VexFlow 4\.2\.3 {3}2023-08-16T07:06:43\.824Z {3}62087494cafd5bf226201aab96c90a747c05a52c/);
  const readme = fs.readFileSync(path.join(V, 'README.md'), 'utf8');
  assert.ok(readme.includes(SHA256) && readme.includes(SRI), 'README carries the hashes');
  assert.match(fs.readFileSync(path.join(V, '.gitattributes'), 'utf8'), /^\* -text$/m, 'git keeps the bytes as they are');
});

test('the licences travel with it: VexFlow (MIT), and every font whose outlines the build carries', () => {
  assert.match(fs.readFileSync(path.join(V, 'LICENSE-vexflow.txt'), 'utf8'), /Copyright \(c\) 2010 Mohit Muthanna Cheppudira[\s\S]*Permission is hereby granted, free of charge/);
  const ofl = { Bravura: 'LICENSE-bravura-OFL.txt', Petaluma: 'LICENSE-petaluma-OFL.txt', Leland: 'LICENSE-leland-OFL.txt' };
  Object.keys(ofl).forEach(font => assert.match(fs.readFileSync(path.join(V, ofl[font]), 'utf8'),
    new RegExp('Reserved Font Name "' + font + '"[\\s\\S]*SIL OPEN FONT LICENSE Version 1\\.1'), font));
  /* every font table in the build is a music font with a notice (or Gonville, unrestricted; Custom, VexFlow's own)
     or a text-metrics table with no outlines */
  const vex = fs.readFileSync(path.join(V, 'vexflow-4.2.3.js'), 'latin1');
  const fams = [...vex.matchAll(/fontFamily:"([A-Za-z]+)",resolution:/g)].map(m => m[1]).sort();
  assert.deepEqual(fams, ['Arial', 'Bravura', 'GonvilleSmufl', 'Leland', 'Petaluma', 'PetalumaScript', 'serif']);
  ['Arial', 'serif', 'PetalumaScript'].forEach(f => {
    const i = vex.indexOf('fontFamily:"' + f + '"'), j = vex.lastIndexOf('glyphs:{', i);
    assert.doesNotMatch(vex.slice(j, i), /[{,]o:"/, f + ' carries metrics, no outlines');
  });
  const readme = fs.readFileSync(path.join(V, 'README.md'), 'utf8');
  ['Bravura', 'Petaluma', 'Leland', 'Gonville', 'Custom'].forEach(f => assert.ok(readme.indexOf('| ' + f) >= 0, f + ' has its row in vendor/README.md'));
});

test('it runs without a DOM, draws with Bravura first, and its geometry is the same every run (G04 §7.3)', () => {
  const VF = (() => { const m = require(path.join(V, 'vexflow-4.2.3.js')); return m.Flow || m; })();
  assert.equal(VF.BUILD.VERSION, '4.2.3');
  assert.deepEqual(VF.getMusicFont().slice(0, 1), ['Bravura']);
  ['Beam', 'Tuplet', 'StaveTie', 'Curve', 'GraceNoteGroup', 'Articulation', 'Ornament', 'TextDynamics', 'StaveHairpin',
    'PedalMarking', 'FretHandFinger', 'TextBracket', 'MultiMeasureRest', 'ClefNote', 'Parenthesis', 'Tremolo'].forEach(k =>
    assert.equal(typeof VF[k], 'function', k));
  const run = () => {
    const st = new VF.Stave(10, 0, 300);
    const notes = ['c/5', 'd/5', 'e/5', 'f/5', 'g/5', 'a/5', 'b/5', 'c/6'].map(k => new VF.StaveNote({ keys: [k], duration: '8' }));
    notes[1].addModifier(new VF.Accidental('#'), 0);
    notes.forEach(n => n.setStave(st));
    const voice = new VF.Voice({ num_beats: 4, beat_value: 4 }).addTickables(notes);
    const beams = VF.Beam.generateBeams(notes);
    new VF.Formatter().joinVoices([voice]).formatToStave([voice], st);
    beams.forEach(b => b.postFormat());
    return JSON.stringify({ x: notes.map(n => n.getAbsoluteX()), y: notes.map(n => n.getYs()), stem: notes.map(n => n.getStemExtents()),
      box: (b => [b.getX(), b.getY(), b.getW(), b.getH()])(notes[1].getBoundingBox()), slope: beams.map(b => b.slope) });
  };
  const a = run();
  assert.equal(run(), a);
  assert.ok(JSON.parse(a).x.every((x, i, xs) => i === 0 || x > xs[i - 1]), 'and the notes run left to right');
});
