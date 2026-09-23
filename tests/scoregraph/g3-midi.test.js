'use strict';
/* G3 on the MIDI path (docs/GOALS/G03 A40). A .mid opens through PPPAudioScore.fromMidi, which writes its notation with
   toMusicXml; with G3 on (opts.professional 'on', the default only after the G3 flip) the notation is G3's. What G2-D3
   promised must still hold: the notation says it was inferred in all three places a consumer reads (the graph's
   provenance, the app's Score, the report a person sees, which the app builds from the same inferredNotation), and
   G3 never touches what was played (the performance layer) or the bar and beat times the app syncs with. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, SG, FIX } = require('./helpers.js');
const A = require(path.join(REPO, 'audio-score.js'));

/* A40 names M13, M14 and M10, but with fewer than four notes they do not open at all (audio-score.js's floor, G2 R4):
   the three fixtures that open are the ones G3 can run on; the named three are checked to fail the same way on and off */
const FILES = ['m27-twenty-notes', 'm18-multi-channel', 'm19-channel-10-drums'];
const NAMED = ['m13-tempo-map', 'm14-meter-changes', 'm10-format0'];

test('A40: a MIDI file with G3 on: G3 ran, the notation says it is inferred three ways, the performance is untouched', () => {
  FILES.forEach(name => {
    const bytes = fs.readFileSync(path.join(FIX, 'midi', name + '.mid'));
    const off = A.fromMidi(bytes, { scoreId: 'g3-midi', professional: 'off' });
    const on = A.fromMidi(bytes, { scoreId: 'g3-midi', professional: 'on' });
    /* G3 ran, and its report travels with the result */
    assert.ok(on.proReport && Array.isArray(on.proReport.passes) && on.proReport.passes.length, name + ': a G3 report');
    assert.equal(on.proReport.fallback, false, name + ': ' + JSON.stringify((on.proReport.issues || []).slice(0, 2)));
    assert.equal(off.proReport, undefined, name + ': no G3 report with G3 off');
    /* inferred: the graph's provenance, the app's Score, and the report (the app reads inferredNotation for it) */
    assert.equal(on.graph.provenance.default.op, 'inferred', name);
    assert.equal(on.graph.provenance.sources[0].kind, 'midi-file', name + ': the first source is still the file');
    assert.equal(SG.legacy.inferredNotation(on.graph), true, name);
    assert.equal(SG.legacy.toScore(on.graph).sgFrom.inferred, true, name);
    /* what was played, and the times the app syncs the recording with, are G3's to keep */
    assert.equal(JSON.stringify(on.graph.performances), JSON.stringify(off.graph.performances), name + ': performance layer');
    assert.deepEqual(on.stats.barStarts, off.stats.barStarts, name + ': bar times');
    assert.deepEqual(on.stats.beats, off.stats.beats, name + ': beat times');
    assert.equal(SG.validate(on.graph).issues.filter(i => i.severity === 'ERROR').length, 0, name);
  });
});

test('A40: the fixtures A40 names are under the four-note floor, with G3 on as off (G2 R4)', () => {
  NAMED.forEach(name => {
    const bytes = fs.readFileSync(path.join(FIX, 'midi', name + '.mid'));
    const code = professional => { try { A.fromMidi(bytes, { scoreId: 'g3-midi', professional: professional }); return 'opened'; } catch (e) { return e.code; } };
    assert.equal(code('on'), code('off'), name);
    assert.equal(code('on'), 'no-notes', name);
  });
});
