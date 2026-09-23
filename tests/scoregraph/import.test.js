'use strict';
/* One door in: format, container, encoding and the ImportReport (docs/GOALS/G02 §5, §11, A9, A12, A13, A18). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { REPO, SG, FIX, read, xml } = require('./helpers.js');

const XML = path.join(FIX, 'xml');
const MIDI = path.join(FIX, 'midi');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
/* Two graphs are the same score when they differ only in which file they came from, which is what
   sg-roundtrip's L2 means by a fixed point ("provenance.sources[].input aside"). */
const sameScore = g => SG.serialize(g).replace(/,"input":\{[^}]*\}/g, '');

/* a .mxl built here, so the test owns what is inside it */
function mxl(entries, opts) {
  opts = opts || {};
  const locals = [], central = [];
  let at = 0;
  const le16 = n => [n & 0xff, (n >> 8) & 0xff];
  const le32 = n => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  entries.forEach(([name, text, store]) => {
    const raw = Buffer.from(text, 'utf8');
    const data = store ? raw : zlib.deflateRawSync(raw);
    const nb = Buffer.from(name, 'utf8');
    const head = [0x50, 0x4b, 0x03, 0x04, ...le16(20), ...le16(0), ...le16(store ? 0 : 8), ...le16(0), ...le16(0),
      ...le32(0), ...le32(data.length), ...le32(raw.length), ...le16(nb.length), ...le16(0)];
    locals.push(Buffer.concat([Buffer.from(head), nb, data]));
    central.push(Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02, ...le16(20), ...le16(20), ...le16(0),
      ...le16(store ? 0 : 8), ...le16(0), ...le16(0), ...le32(0), ...le32(data.length), ...le32(raw.length),
      ...le16(nb.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(at)]), nb]));
    at += head.length + nb.length + data.length;
  });
  const body = Buffer.concat(locals);
  const dir = Buffer.concat(central);
  const eocd = Buffer.from([0x50, 0x4b, 0x05, 0x06, ...le16(0), ...le16(0), ...le16(entries.length),
    ...le16(entries.length), ...le32(dir.length), ...le32(body.length), ...le16(0)]);
  void opts;
  return Buffer.concat([body, dir, eocd]);
}
const container = full => '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>' +
  '<rootfile full-path="' + full + '" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>';

test('what a file is comes from its bytes, and its name only when the bytes do not say (A18)', () => {
  assert.equal(SG.sniff(fs.readFileSync(path.join(MIDI, 'm01-single-note.mid'))), 'midi');
  assert.equal(SG.sniff(Buffer.from('<?xml version="1.0"?><score-partwise/>')), 'musicxml');
  assert.equal(SG.sniff(mxl([['x.xml', '<a/>']])), 'mxl');
  assert.equal(SG.sniff(Buffer.from('﻿<score-partwise/>', 'utf8')), 'musicxml');
  assert.equal(SG.sniff(Buffer.from('nothing at all')), null);
  assert.equal(SG.sniff(Buffer.from('nothing at all'), 'thing.mid'), 'midi', 'the name is the last resort');
});

test('a MusicXML file gives a graph and a report that names the format and encoding (A12)', async () => {
  const b = fs.readFileSync(path.join(REPO, 'catalog', 'fur-elise.musicxml'));
  const r = await SG.importFile(b, { name: 'fur-elise.musicxml', sha256: sha(b), scoreId: 'a' });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.report.format, 'musicxml');
  assert.equal(r.report.source.encoding, 'utf-8');
  assert.equal(r.report.source.bytes, b.length);
  assert.equal(r.report.source.sha256, sha(b));
  assert.ok(r.report.counts.heads > 0 && r.report.counts.measures > 0);
  assert.equal(r.report.lossless, true, 'nothing of this file is dropped');
  assert.ok(r.report.timing.parseMs >= 0);
});

test('an .mxl is opened by what container.xml points at, not by the first XML inside (A18)', async () => {
  const score = read(path.join(XML, 'grand-staff.musicxml'));
  const decoy = '<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P9">' +
    '<part-name>Decoy</part-name></score-part></part-list><part id="P9"><measure number="1">' +
    '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>' +
    '<clef><sign>G</sign><line>2</line></clef></attributes>' +
    '<note><rest/><duration>4</duration></note></measure></part></score-partwise>';
  /* the decoy comes first in the archive; the container names the real one */
  const b = mxl([['aaa-decoy.xml', decoy], ['META-INF/container.xml', container('score.xml')], ['score.xml', score]]);
  const r = await SG.importFile(b, { name: 'x.mxl', scoreId: 'a' });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.report.source.container.rootfile, 'score.xml');
  assert.equal(r.report.source.container.chosenBy, 'container.xml');
  const direct = SG.musicxml.import(score, { scoreId: 'a', container: 'mxl' });
  assert.equal(sameScore(r.graph), sameScore(direct.graph), 'and it gives the same graph as the text would');
});

test('an .mxl with no container falls back to the first XML, and says which it chose', async () => {
  const b = mxl([['score.xml', read(path.join(XML, 'grand-staff.musicxml'))]]);
  const r = await SG.importFile(b, { name: 'x.mxl', scoreId: 'a' });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.report.source.container.chosenBy, 'the first XML entry');
});

test('a stored (uncompressed) entry reads the same as a deflated one (A18)', async () => {
  const score = read(path.join(XML, 'grand-staff.musicxml'));
  const a = await SG.importFile(mxl([['score.xml', score]]), { name: 'a.mxl', scoreId: 'a' });
  const b = await SG.importFile(mxl([['score.xml', score, true]]), { name: 'b.mxl', scoreId: 'a' });
  assert.equal(a.ok && b.ok, true);
  assert.equal(sameScore(a.graph), sameScore(b.graph));
});

test('UTF-16 with a byte order mark is read as text, not as bytes (A18)', async () => {
  const score = read(path.join(XML, 'grand-staff.musicxml'));
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(score, 'utf16le')]);
  const r = await SG.importFile(le, { name: 'u.musicxml', scoreId: 'a' });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.report.source.encoding, 'utf-16le');
  const plain = await SG.importFile(Buffer.from(score, 'utf8'), { name: 'p.musicxml', scoreId: 'a' });
  assert.equal(sameScore(r.graph), sameScore(plain.graph), 'the same score either way');
});

test('a MIDI file comes through the same door, with its own source facts (A12)', async () => {
  const b = fs.readFileSync(path.join(MIDI, 'm11-format1-tempo-track.mid'));
  const r = await SG.importFile(b, { name: 'x.mid', sha256: sha(b), scoreId: 'a' });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.report.format, 'midi');
  assert.deepEqual(r.report.source.midi, { format: 1, division: { kind: 'ppq', ppq: 480 }, tracks: 2 });
  assert.equal(r.report.counts.perfNotes, 3);
  assert.equal(r.report.counts.events, 0, 'the skeleton holds no note of its own');
  assert.ok(r.report.inferred.length > 0, 'and the report says what was made up');
  assert.ok(r.report.issues.some(i => i.code === 'W-MIDI-SKELETON'));
});

test('the report says what was dropped, what was kept in ext, and what is lossless (A12, A13)', async () => {
  /* a file whose every element the importer maps */
  const clean = await SG.importFile(Buffer.from(read(path.join(XML, 'grand-staff.musicxml'))), { name: 'c.musicxml', scoreId: 'a' });
  assert.deepEqual(clean.report.dropped, {});
  assert.equal(clean.report.lossless, true);

  /* and one where it does not */
  const dropped = await SG.importFile(Buffer.from(xml('dropped')), { name: 'd.musicxml', scoreId: 'a' });
  assert.equal(dropped.report.lossless, false);
  ['figured-bass', 'print', 'credit', 'defaults'].forEach(n => assert.ok(dropped.report.dropped[n] >= 1, n));

  /* ext is reported by namespace, not hidden */
  const micro = await SG.importFile(Buffer.from(read(path.join(XML, 'microtone-quarter-sharp.musicxml'))), { name: 'm.musicxml', scoreId: 'a' });
  assert.deepEqual(micro.report.preserved, [{ ns: 'musicxml.microtone', count: 2 }]);
  assert.equal(micro.report.lossless, true, 'kept in ext is not lost');
  assert.ok(micro.report.issues.some(i => i.code === 'W-IMPORT-MICROTONE'));
});

test('the validator\'s own output reaches the report (A12)', async () => {
  const r = await SG.importFile(Buffer.from(read(path.join(XML, 'wedge-unpaired.musicxml'))), { name: 'w.musicxml', scoreId: 'a' });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.report.validation));
  assert.equal(r.report.validation.filter(i => i.severity === 'ERROR').length, 0);
  assert.ok(r.report.issues.some(i => i.code === 'W-IMPORT-UNPAIRED'), 'and so does the importer\'s');
});

test('a file it cannot read comes back as a value, with a report, never as an exception (A37)', async () => {
  const cases = [
    [Buffer.alloc(0), 'IMPORT-EMPTY'],
    [Buffer.from('hello, this is not a score'), 'IMPORT-UNKNOWN-FORMAT'],
    [Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), 'IMPORT-BAD-ARCHIVE'],
    [Buffer.from('<?xml version="1.0"?><nope>'), 'IMPORT-BAD-XML'],
    [Buffer.from('<?xml version="1.0"?><score-timewise/>'), 'IMPORT-TIMEWISE'],
    [Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0]), 'MIDI-NOT-A-FILE']
  ];
  for (const [bytes, code] of cases) {
    const r = await SG.importFile(bytes, { name: 'x', scoreId: 'a' });
    assert.equal(r.ok, false, code);
    assert.equal(r.code, code);
    assert.ok(r.report, code + ': a report comes back even so');
    assert.ok(typeof r.message === 'string' && r.message.length);
  }
});

test('an archive that claims to inflate to more than 64 MB is refused before it does', async () => {
  const big = 'x'.repeat(1024);
  /* the directory is what states the size; a lie there is caught before any inflating */
  const b = mxl([['score.xml', big]]);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  const at = dv.getUint32(eocd + 16, true);
  dv.setUint32(at + 24, 200 * 1024 * 1024, true);            /* the uncompressed size */
  const r = await SG.importFile(Buffer.from(b), { name: 'bomb.mxl', scoreId: 'a' });
  assert.deepEqual([r.ok, r.code], [false, 'IMPORT-ARCHIVE-TOO-BIG']);
});

test('the same file gives the same graph through the door as through the importer (A9)', async () => {
  const names = fs.readdirSync(XML).filter(f => f.endsWith('.musicxml')).sort();
  assert.ok(names.length >= 20);
  for (const n of names) {
    const text = read(path.join(XML, n));
    const direct = SG.musicxml.import(text, { scoreId: 'a' });
    const through = await SG.importFile(Buffer.from(text, 'utf8'), { name: n, scoreId: 'a' });
    assert.equal(through.ok, direct.ok, n);
    if (direct.ok) assert.equal(sameScore(through.graph), sameScore(direct.graph), n);
  }
});
