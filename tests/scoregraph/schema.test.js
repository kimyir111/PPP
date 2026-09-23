'use strict';
/* The schema as data (G01 §5, A4). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SG } = require('./helpers.js');
const S = SG.schema;

/* §5.14, written out again here: the table the code must match */
const EXPECTED = [
  ['Measure', 'm', 'timeline.measures'], ['MeterEvent', 'mt', 'timeline.meters'], ['KeyEvent', 'ky', 'timeline.keys'],
  ['TempoEvent', 'tp', 'timeline.tempos'], ['Ending', 'en', 'timeline.endings'], ['Jump', 'j', 'timeline.jumps'],
  ['Part', 'p', 'parts'], ['Staff', 'st', 'part.staves'], ['Voice', 'v', 'part.voices'], ['Clef', 'c', 'part.clefs'],
  ['Event', 'e', 'part.events'], ['Head', 'h', 'event.heads'], ['Direction', 'd', 'part.directions'],
  ['Spanner', 's', 'part.spanners'], ['Section', 'sc', 'structure.sections'], ['Phrase', 'ph', 'structure.phrases'],
  ['Performance', 'pf', 'performances'], ['PerfNote', 'pn', 'performance.notes'], ['PerfPedal', 'pp', 'performance.pedals'],
  ['Source', 'sr', 'provenance.sources'], ['Flag', 'fl', 'provenance.flags']
];

test('ENTITY_KINDS is the 21 entities of §5.14 with their prefixes and owners (A4)', () => {
  assert.deepEqual(SG.ENTITY_KINDS.map(k => [k.name, k.prefix, k.owner]), EXPECTED);
  assert.equal(new Set(SG.ENTITY_KINDS.map(k => k.prefix)).size, 21);
});

test('every prefix fits the ID pattern and the ID helpers read it back', () => {
  EXPECTED.forEach(([, prefix]) => {
    const id = prefix + 42;
    assert.match(id, S.ID_RE);
    assert.equal(S.idPrefix(id), prefix);
    assert.equal(S.idNumber(id), 42);
  });
  assert.equal(S.idNumber('e0'), null);
  assert.equal(S.idPrefix('abc1'), null);
});

test('every field of every shape has a known type, and every shape a field has is defined', () => {
  const KNOWN = new Set(['str', 'int', 'bool', 'num3', 'rat', 'enum', 'id', 'ref', 'arr', 'obj', 'json', 'ext', 'asp', 'conf']);
  const check = (t, where) => {
    assert.ok(KNOWN.has(t.t), where + ': ' + t.t);
    if (t.t === 'arr') check(t.of, where + '[]');
    if (t.t === 'obj') assert.ok(S.SHAPES[t.shape], where + ' -> ' + t.shape);
  };
  Object.keys(S.SHAPES).forEach(name => S.SHAPES[name].forEach(fd => { if (fd.type) check(fd.type, name + '.' + fd.name); }));
  Object.values(S.SPANNER_ENDS).forEach(t => check(t, 'spanner end'));
});

test('each spanner type has the §5.10 field order, and the first fields are id and type', () => {
  Object.keys(S.SPANNER_ORDER).forEach(type => {
    const names = S.fieldsOf('Spanner', { type: type }).map(f => f.name);
    assert.deepEqual(names.slice(0, 2), ['id', 'type']);
    assert.deepEqual(names.slice(2, -2), S.SPANNER_ORDER[type]);
    assert.deepEqual(names.slice(-2), ['prov', 'ext']);
  });
});

test('the instrument vocabulary names a known family for every kind', () => {
  Object.entries(S.INSTRUMENT_KINDS).forEach(([k, fam]) => assert.ok(S.FAMILIES.includes(fam), k));
  assert.equal(S.INSTRUMENT_KINDS.piano, 'keyboard');
  assert.equal(S.INSTRUMENT_KINDS.drumset, 'percussion');
});

test('note values are exact (whole = 1)', () => {
  const v = (t, d) => SG.rational.format(S.noteValue(t, d));
  assert.equal(v('quarter'), '1/4');
  assert.equal(v('quarter', 1), '3/8');
  assert.equal(v('half', 2), '7/8');
  assert.equal(v('breve'), '2');
  assert.equal(v('1024th'), '1/1024');
});
