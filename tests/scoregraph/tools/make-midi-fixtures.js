#!/usr/bin/env node
/* Build the MIDI micro fixtures (docs/GOALS/G02 §10.3, M1-M25).

     node tests/scoregraph/tools/make-midi-fixtures.js

   Every fixture is written here rather than found, so each one says exactly what it is for and carries
   no licence question (G0 corpus policy: generated_internally). The bytes are committed so the tests do
   not depend on this file running; re-run it and commit the diff when a fixture changes.

   The writer below is deliberately not scoregraph/midi-file.js: a fixture made by the code under test
   could not catch that code misreading its own output. */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'fixtures', 'midi');

/* ------------------------------------------------------------------ writing */
const vlq = n => {
  const parts = [n & 0x7f];
  n >>>= 7;
  while (n) { parts.push((n & 0x7f) | 0x80); n >>>= 7; }
  return parts.reverse();
};
const be16 = n => [(n >> 8) & 0xff, n & 0xff];
const be32 = n => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = s => Array.from(s, c => c.charCodeAt(0) & 0xff);

/* An event list is [absoluteTick, [bytes]]; the track writer turns it into deltas. */
function track(events, opts) {
  opts = opts || {};
  const sorted = events.slice().sort((a, b) => a[0] - b[0]);
  const body = [];
  let last = 0;
  sorted.forEach(([tick, bytes]) => { body.push(...vlq(tick - last)); body.push(...bytes); last = tick; });
  if (!opts.noEnd) { body.push(...vlq(opts.endDelta || 0), 0xff, 0x2f, 0x00); }
  return [...ascii('MTrk'), ...be32(body.length), ...body];
}
function file(format, division, tracks) {
  return Uint8Array.from([...ascii('MThd'), ...be32(6), ...be16(format), ...be16(tracks.length), ...be16(division),
    ...[].concat(...tracks)]);
}

const noteOn = (ch, n, v) => [0x90 | (ch - 1), n, v];
const noteOff = (ch, n, v) => [0x80 | (ch - 1), n, v === undefined ? 0 : v];
const cc = (ch, n, v) => [0xb0 | (ch - 1), n, v];
const program = (ch, p) => [0xc0 | (ch - 1), p];
const tempo = upq => [0xff, 0x51, 0x03, (upq >> 16) & 0xff, (upq >> 8) & 0xff, upq & 0xff];
const meter = (num, denPow, clocks, n32) => [0xff, 0x58, 0x04, num, denPow, clocks === undefined ? 24 : clocks, n32 === undefined ? 8 : n32];
const keySig = (sf, mi) => [0xff, 0x59, 0x02, sf & 0xff, mi];
const trackName = s => [0xff, 0x03, ...vlq(s.length), ...ascii(s)];

const Q = 480;                                  /* the ticks a quarter gets in most fixtures */
const F = {};

/* M1-M5: what a note is */
F['m01-single-note'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)], [0, noteOn(1, 60, 80)], [Q, noteOff(1, 60)]])]);
F['m02-chord-3'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)],
  [0, noteOn(1, 60, 80)], [0, noteOn(1, 64, 70)], [0, noteOn(1, 67, 90)],
  [Q, noteOff(1, 60)], [Q, noteOff(1, 64)], [Q, noteOff(1, 67)]])]);
F['m03-overlap-same-pitch'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)],
  [0, noteOn(1, 60, 80)], [Q / 2, noteOn(1, 60, 100)], [Q, noteOff(1, 60)], [Q * 2, noteOff(1, 60)]])]);
F['m04-note-on-velocity-0'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)],
  [0, noteOn(1, 60, 80)], [Q, noteOn(1, 60, 0)]])]);
F['m05-unpaired-note-on'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)],
  [0, noteOn(1, 60, 80)], [0, noteOn(1, 64, 80)], [Q, noteOff(1, 64)], [Q * 4, meter(4, 2)]])]);

/* M6-M9: the pedals and the controllers that are not pedals */
F['m06-sustain-pedal'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)],
  [0, cc(1, 64, 127)], [0, noteOn(1, 60, 80)], [Q, noteOff(1, 60)], [Q * 2, cc(1, 64, 0)]])]);
F['m07-half-pedal'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)],
  [0, cc(1, 64, 100)], [0, noteOn(1, 60, 80)], [Q, noteOff(1, 60)], [Q * 2, cc(1, 64, 0)]])]);
F['m08-sostenuto-and-soft'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)],
  [0, cc(1, 66, 127)], [0, cc(1, 67, 127)], [0, noteOn(1, 60, 80)], [Q, noteOff(1, 60)],
  [Q * 2, cc(1, 66, 0)], [Q * 2, cc(1, 67, 0)]])]);
F['m09-expression-cc11'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)],
  [0, cc(1, 11, 100)], [0, noteOn(1, 60, 80)], [Q / 2, cc(1, 11, 60)], [Q, cc(1, 11, 20)], [Q, noteOff(1, 60)]])]);

/* M10-M12: the three formats */
F['m10-format0'] = F['m01-single-note'];
F['m11-format1-tempo-track'] = file(1, Q, [
  /* the tempo map lives in track 0 and applies to track 1: what midi_notes.py gets wrong (§7.1) */
  track([[0, trackName('conductor')], [0, tempo(500000)], [0, meter(4, 2)], [Q * 4, tempo(250000)]]),
  track([[0, trackName('piano')], [0, noteOn(1, 60, 80)], [Q, noteOff(1, 60)],
    [Q * 4, noteOn(1, 62, 80)], [Q * 5, noteOff(1, 62)],
    [Q * 8, noteOn(1, 64, 80)], [Q * 9, noteOff(1, 64)]])]);
F['m12-format2'] = file(2, Q, [
  track([[0, tempo(500000)], [0, meter(4, 2)], [0, noteOn(1, 60, 80)], [Q, noteOff(1, 60)]]),
  track([[0, tempo(400000)], [0, noteOn(1, 67, 80)], [Q, noteOff(1, 67)]])]);

/* M13-M17: time */
F['m13-tempo-map'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)],
  [0, noteOn(1, 60, 80)], [Q, noteOff(1, 60)],
  [Q * 2, tempo(300000)], [Q * 2, noteOn(1, 62, 80)], [Q * 3, noteOff(1, 62)],
  [Q * 4, tempo(1000000)], [Q * 4, noteOn(1, 64, 80)], [Q * 5, noteOff(1, 64)]])]);
F['m14-meter-changes'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)],
  [0, noteOn(1, 60, 80)], [Q, noteOff(1, 60)],
  [Q * 4, meter(3, 2)], [Q * 4, noteOn(1, 62, 80)], [Q * 5, noteOff(1, 62)],
  [Q * 7, meter(6, 3)], [Q * 7, noteOn(1, 64, 80)], [Q * 8, noteOff(1, 64)]])]);
F['m15-key-signature'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)], [0, keySig(-3, 1)],
  [0, noteOn(1, 60, 80)], [Q, noteOff(1, 60)], [Q * 4, keySig(2, 0)]])]);
['96', '480', '960'].forEach(p => {
  const t = Number(p);
  F['m16-ppq-' + p] = file(0, t, [track([[0, tempo(500000)], [0, meter(4, 2)], [0, noteOn(1, 60, 80)], [t, noteOff(1, 60)]])]);
});
/* 25 frames a second, 40 subframes: one tick is exactly a millisecond */
F['m17-smpte-division'] = file(0, ((256 - 25) << 8) | 40, [track([[0, meter(4, 2)],
  [0, noteOn(1, 60, 80)], [1000, noteOff(1, 60)]])]);

/* M18-M20: who is playing */
F['m18-multi-channel'] = file(1, Q, [
  track([[0, tempo(500000)], [0, meter(4, 2)]]),
  track([[0, trackName('four hands')],
    [0, noteOn(1, 60, 80)], [0, noteOn(2, 64, 70)], [0, noteOn(3, 67, 60)], [0, noteOn(4, 72, 50)],
    [Q, noteOff(1, 60)], [Q, noteOff(2, 64)], [Q, noteOff(3, 67)], [Q, noteOff(4, 72)]])]);
F['m19-channel-10-drums'] = file(1, Q, [
  track([[0, tempo(500000)], [0, meter(4, 2)]]),
  track([[0, trackName('drums')],
    [0, noteOn(10, 36, 100)], [0, noteOn(10, 42, 80)], [Q / 8, noteOff(10, 36)], [Q / 8, noteOff(10, 42)],
    [Q, noteOn(10, 38, 110)], [Q + Q / 8, noteOff(10, 38)],
    [Q * 2, noteOn(10, 36, 100)], [Q * 2 + Q / 8, noteOff(10, 36)]])]);
F['m20-program-change'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)], [0, program(1, 0)],
  [0, noteOn(1, 60, 80)], [Q, noteOff(1, 60)], [Q * 2, program(1, 48)]])]);

/* M21-M25: what a reader has to survive */
F['m21-running-status'] = (() => {
  /* four notes written with one 0x90 status byte, releases as note-on velocity 0 */
  const body = [];
  body.push(...vlq(0), ...tempo(500000));
  body.push(...vlq(0), ...meter(4, 2));
  body.push(...vlq(0), 0x90, 60, 80);
  body.push(...vlq(Q), 60, 0);
  body.push(...vlq(0), 64, 80);
  body.push(...vlq(Q), 64, 0);
  body.push(...vlq(0), 0xff, 0x2f, 0x00);
  return Uint8Array.from([...ascii('MThd'), ...be32(6), ...be16(0), ...be16(1), ...be16(Q),
    ...ascii('MTrk'), ...be32(body.length), ...body]);
})();
F['m22-sysex-and-unknown-meta'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)],
  [0, [0xf0, 5, 0x7e, 0x7f, 0x09, 0x01, 0xf7]],
  [0, [0xff, 0x60, 0x02, 0xde, 0xad]],
  [0, noteOn(1, 60, 80)], [Q, noteOff(1, 60)]])]);
F['m23-track-names'] = file(1, Q, [
  track([[0, trackName('Conductor')], [0, tempo(500000)], [0, meter(4, 2)]]),
  track([[0, trackName('Right Hand')], [0, noteOn(1, 72, 80)], [Q, noteOff(1, 72)]]),
  track([[0, trackName('Left Hand')], [0, noteOn(2, 48, 60)], [Q, noteOff(2, 48)]])]);
F['m24-offset-start'] = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)],
  [Q * 6, noteOn(1, 60, 80)], [Q * 7, noteOff(1, 60)]])]);
F['m26-no-meter-no-tempo'] = file(0, Q, [track([[0, noteOn(1, 60, 80)], [Q, noteOff(1, 60)],
  [Q * 2, noteOn(1, 62, 80)], [Q * 3, noteOff(1, 62)]])]);
F['m25-truncated-track'] = (() => {
  const good = file(0, Q, [track([[0, tempo(500000)], [0, meter(4, 2)], [0, noteOn(1, 60, 80)], [Q, noteOff(1, 60)]])]);
  return good.subarray(0, good.length - 6);      /* the last events are cut off mid-track */
})();

const names = Object.keys(F).sort();
if (process.argv.includes('--check')) {
  /* the committed bytes are what this file produces, and CI says so rather than trusting it */
  const wrong = [];
  names.forEach(n => {
    const at = path.join(OUT, n + '.mid');
    if (!fs.existsSync(at)) { wrong.push(n + ': missing'); return; }
    if (!Buffer.from(F[n]).equals(fs.readFileSync(at))) wrong.push(n + ': differs');
  });
  fs.readdirSync(OUT).filter(f => f.endsWith('.mid') && names.indexOf(f.slice(0, -4)) < 0)
    .forEach(f => wrong.push(f + ': not made by this file'));
  if (wrong.length) {
    process.stderr.write('the committed MIDI fixtures are not what this file writes:\n  ' + wrong.join('\n  ') +
      '\nrun node tests/scoregraph/tools/make-midi-fixtures.js and commit the diff\n');
    process.exit(1);
  }
  process.stdout.write(names.length + ' MIDI fixtures are byte for byte what this file writes\n');
} else {
  fs.mkdirSync(OUT, { recursive: true });
  names.forEach(n => fs.writeFileSync(path.join(OUT, n + '.mid'), Buffer.from(F[n])));
  process.stdout.write(names.length + ' MIDI fixtures written to ' + path.relative(process.cwd(), OUT) + '\n');
}
