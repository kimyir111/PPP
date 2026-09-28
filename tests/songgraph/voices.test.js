/* songgraph/voices.js unit tests: the top-voice/bottom-voice statistics behind melody/bass
   identification, and voiceRolesOf's role labels. The real accuracy numbers (hymn soprano/bass
   ground truth) are in hymn-corpus.test.js. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { V, mk } = require('./helpers.js');

test('melodyBassOf: a clear top-voice tune over a clear bottom-voice bass is identified with high confidence', () => {
  const g = mk({ time: [4, 4], rh: 'C6:q D6:q E6:q F6:q | G6:h E6:h', lh: 'C3:q G2:q C3:q G2:q | C3:h G2:h' });
  const [{ melodyVoice, bassVoice, melodyConf, bassConf, voices }] = V.melodyBassOf(g).parts;
  const rhVoice = voices.find(v => v.avgMidi > 70);
  const lhVoice = voices.find(v => v.avgMidi < 55);
  assert.equal(melodyVoice, rhVoice.voice);
  assert.equal(bassVoice, lhVoice.voice);
  assert.ok(melodyConf > 0.8, 'melody confidence should be high for an unambiguous case: ' + melodyConf);
  assert.ok(bassConf > 0.8, 'bass confidence should be high for an unambiguous case: ' + bassConf);
});

test('melodyBassOf: crossed voices (RH dips below LH partway through) lowers confidence, does not crash', () => {
  const g = mk({ time: [4, 4], rh: 'C6:q D6:q C3:q D3:q | C6:q D6:q C3:q D3:q', lh: 'G3:q F3:q G5:q F5:q | G3:q F3:q G5:q F5:q' });
  const [{ melodyConf }] = V.melodyBassOf(g).parts;
  assert.ok(melodyConf < 0.6, 'frequent voice-crossing should read as genuinely ambiguous: ' + melodyConf);
});

test('voiceRolesOf: a single-voice part is melody (the whole voice is, trivially, both top and bottom)', () => {
  const g = mk({ time: [4, 4], rh: 'C5:q D5:q E5:q F5:q' });
  const [{ roles }] = V.voiceRolesOf(g).parts;
  assert.equal(roles.length, 1);
  assert.equal(roles[0].role, 'melody');
});

test('voiceRolesOf: a 4-voice SATB-shaped part gives melody, bass, and two inner voices', () => {
  const g = mk({
    time: [4, 4],
    rh: 'C6:q D6:q E6:q F6:q | G6:h E6:h', rh2: 'A5:q A5:q A5:q A5:q | G5:h G5:h',
    lh: 'E4:q E4:q E4:q E4:q | E4:h E4:h', lh2: 'C3:q C3:q C3:q C3:q | C3:h C3:h'
  });
  const [{ roles }] = V.voiceRolesOf(g).parts;
  assert.equal(roles.length, 4);
  const byRole = {};
  roles.forEach(r => { byRole[r.role] = (byRole[r.role] || 0) + 1; });
  assert.equal(byRole.melody, 1);
  assert.equal(byRole.bass, 1);
  assert.equal(byRole.inner, 2);
});
