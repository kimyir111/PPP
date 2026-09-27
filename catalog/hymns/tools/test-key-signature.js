// Regression test for the MX-2 ordering bug: a tie crossing a bar boundary into a pitch that
// differs from the key signature's default used to only update the alter of the note it forced -
// the bar-carry pass ran before the tie pass, so it never saw that forced value, and a later,
// non-explicit note of the same pitch letter+octave in a *different* voice on the same staff would
// wrongly fall back to the key-signature default instead of inheriting the tied-in pitch.
'use strict';
const assert = require('assert');
const { toMusicXml } = require('../abc-to-musicxml.js');

const abc = [
  'X:1',
  'T:test',
  'K:G',
  'M:4/4',
  'L:1/4',
  '[V:S1] F F F F | F F F F |',
  // S2: a flat F tied from bar 1 into bar 2 (G major's default for F is sharp, so this is a real
  // override, not a no-op)
  '[V:S2] _F,4- | F,4 |',
  // S2V2: shares staff 2 with S2. Bar 2's plain, non-explicit F must inherit the tied-in flat, not
  // fall back to the key signature's sharp default.
  '[V:S2V2] z z z z | z z F, z |'
].join('\n');

const xml = toMusicXml(abc, {});
const bar2 = xml.split('<measure').slice(1).map(s => '<measure' + s)[1];
const notes = bar2.match(/<note>[\s\S]*?<\/note>/g).filter(n => /<staff>2<\/staff>/.test(n) && !/<rest\/>/.test(n));
assert.strictEqual(notes.length, 2, 'expected 2 staff-2 notes in bar 2');

const alterOf = n => {
  const m = /<alter>(-?\d+)<\/alter>/.exec(n);
  return m ? Number(m[1]) : 0;
};
notes.forEach(n => assert.strictEqual(alterOf(n), -1, 'expected alter -1 (flat), got: ' + n));

console.log('OK: tie-crossing-bar-boundary correctly propagates to a same-bar, same-staff, different-voice note');
