#!/usr/bin/env node
/* ============================================================================
   Build the Shared Scores seed library.

   One piece per genre, so the Shared Scores tab is never empty and every
   genre chip has something behind it. Four are public-domain works from the
   catalog; three are short pieces written for PPP (CC0) — jazz, a screen
   theme and a game tune — because no public-domain score of those genres
   belongs in a catalog this small.

   Each piece is written as MusicXML, then read by PPP's own parser in the
   real page, so what is stored is exactly the shape a shared song has: a
   Score JSON plus the two-bar preview the card draws.

     node catalog/build-shared-seeds.js        (needs `npm run serve`)

   Writes catalog/shared-seeds.json. Composed pieces are CC0; the rest keep
   their own license, recorded here and in index.json.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { preparePage } = require('../tests/boot');

const APP = process.env.PPP_URL || 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'shared-seeds.json');

/* ---------------- MusicXML, small and exact ----------------
   divisions: 4 per quarter note, so a 16th is 1. */
const DIV = 4;
const STEPS = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
function pitchXml(p) {
  if (p === 'r' || p == null) return null;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(p);
  if (!m) throw new Error('bad pitch ' + p);
  const alt = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return { step: m[1], alter: alt, octave: +m[3] };
}
function noteXml(p, dur, beams) {
  const head = pitchXml(p);
  const body = head
    ? '<pitch><step>' + head.step + '</step>' + (head.alter ? '<alter>' + head.alter + '</alter>' : '')
      + '<octave>' + head.octave + '</octave></pitch>'
    : '<rest/>';
  const type = dur >= 16 ? 'whole' : dur >= 8 ? 'half' : dur >= 4 ? 'quarter' : dur >= 2 ? 'eighth' : '16th';
  let beam = '';
  if (beams) beam = '<beam number="1">' + beams + '</beam>';
  return '<note>' + body + '<duration>' + dur + '</duration><type>' + type + '</type>' + beam + '</note>';
}
/* measures: [{ t: [pitch|null, dur, beam?], b: [...] }] */
function musicxml(opt) {
  const divisions = DIV;
  const clefs = opt.clefs || { t: 'G2', b: 'F4' };
  const measures = opt.measures.map((M, i) => {
    const part = (list, staff) => (list || []).map(x => {
      const p = Array.isArray(x) ? x[0] : x;
      const dur = Array.isArray(x) ? x[1] : 4;
      const beam = Array.isArray(x) ? x[2] : null;
      return noteXml(p, dur, beam).replace('<note>', '<note><staff>' + (staff + 1) + '</staff>');
    }).join('');
    return '<measure number="' + (i + 1) + '">'
      + (i === 0
        ? '<attributes><divisions>' + divisions + '</divisions>'
          + '<key><fifths>' + (opt.fifths || 0) + '</fifths></key>'
          + '<time><beats>' + (opt.beats || 4) + '</beats><beat-type>' + (opt.beatType || 4) + '</beat-type></time>'
          + '<staves>2</staves>'
          + '<clef number="1"><sign>' + clefs.t[0] + '</sign><line>' + clefs.t[1] + '</line></clef>'
          + '<clef number="2"><sign>' + clefs.b[0] + '</sign><line>' + clefs.b[1] + '</line></clef>'
          + '</attributes>'
        : '')
      + part(M.t, 0) + '<backup><duration>' + (DIV * (opt.beats || 4)) + '</duration></backup>' + part(M.b, 1)
      + '</measure>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n'
    + '<score-partwise version="3.1"><work><work-title>' + opt.title + '</work-title></work>'
    + '<identification><creator type="composer">' + opt.composer + '</creator>'
    + '<encoding><software>PPP catalog builder</software></encoding></identification>'
    + '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
    + '<part id="P1">' + measures + '</part></score-partwise>';
}

/* ---------------- the pieces written for PPP ---------------- */
/* A 12-bar blues in F, swung eighths written straight. */
const JAZZ = musicxml({
  title: 'Midtown Blues', composer: 'PPP Studio', fifths: -1, measures: [
    { t: [['r', 2], ['C5', 2], ['Eb5', 2], ['C5', 2], ['A4', 2], ['F4', 2]],
      b: [['F2', 4], ['A2', 2], ['C3', 2], ['F2', 4], ['C3', 4]] },
    { t: [['Bb4', 4], ['D5', 2], ['F5', 2], ['D5', 4], ['Bb4', 4]],
      b: [['Bb2', 4], ['D3', 2], ['F3', 2], ['Bb2', 4], ['F3', 4]] },
    { t: [['C5', 2], ['Eb5', 2], ['C5', 4], ['A4', 4], ['F4', 4]],
      b: [['F2', 4], ['A2', 2], ['C3', 2], ['F2', 4], ['A2', 4]] },
    { t: [['F4', 2], ['A4', 2], ['C5', 2], ['Eb5', 2], ['F5', 8]],
      b: [['F2', 4], ['C3', 4], ['F2', 4], ['C3', 4]] },
    { t: [['D5', 2], ['F5', 2], ['D5', 4], ['Bb4', 4], ['D5', 4]],
      b: [['Bb2', 4], ['F3', 4], ['Bb2', 4], ['D3', 4]] },
    { t: [['Bb4', 4], ['C5', 4], ['D5', 4], ['F5', 4]],
      b: [['Bb2', 4], ['D3', 2], ['F3', 2], ['Bb2', 4], ['F3', 4]] },
    { t: [['C5', 2], ['A4', 2], ['F4', 2], ['A4', 2], ['C5', 4], ['A4', 4]],
      b: [['F2', 4], ['A2', 4], ['F2', 4], ['C3', 4]] },
    { t: [['D5', 2], ['F#4', 2], ['A4', 2], ['C5', 2], ['D5', 8]],
      b: [['D2', 4], ['F#2', 4], ['A2', 4], ['C3', 4]] },
    { t: [['D5', 4], ['Bb4', 4], ['G4', 4], ['Bb4', 4]],
      b: [['G2', 4], ['Bb2', 4], ['D3', 4], ['F3', 4]] },
    { t: [['C5', 4], ['E4', 4], ['G4', 4], ['Bb4', 4]],
      b: [['C3', 4], ['E3', 4], ['G3', 4], ['Bb3', 4]] },
    { t: [['A4', 2], ['C5', 2], ['F5', 4], ['D5', 2], ['C5', 2], ['A4', 2], ['F4', 2]],
      b: [['F2', 4], ['A2', 4], ['D3', 4], ['F3', 4]] },
    { t: [['G4', 2], ['Bb4', 2], ['C5', 4], ['F5', 8]],
      b: [['G2', 4], ['C3', 4], ['F2', 8]] }
  ]
});

/* A screen theme in A minor: an arpeggio under a singing line. */
const OST = musicxml({
  title: 'First Light Theme', composer: 'PPP Studio', fifths: 0, measures: [
    { t: [['A4', 6], ['B4', 2], ['C5', 8]], b: [['A2', 4], ['E3', 4], ['A3', 4], ['E3', 4]] },
    { t: [['E5', 4], ['D5', 4], ['C5', 6], ['B4', 2]], b: [['F2', 4], ['C3', 4], ['F3', 4], ['C3', 4]] },
    { t: [['A4', 4], ['C5', 4], ['E5', 6], ['D5', 2]], b: [['G2', 4], ['D3', 4], ['G3', 4], ['B3', 4]] },
    { t: [['C5', 8], ['B4', 4], ['A4', 4]], b: [['E2', 4], ['B2', 4], ['E3', 4], ['G#3', 4]] },
    { t: [['A4', 6], ['B4', 2], ['C5', 8]], b: [['A2', 4], ['E3', 4], ['A3', 4], ['E3', 4]] },
    { t: [['E5', 4], ['F5', 4], ['E5', 6], ['C5', 2]], b: [['F2', 4], ['C3', 4], ['F3', 4], ['A3', 4]] },
    { t: [['D5', 4], ['C5', 4], ['B4', 6], ['A4', 2]], b: [['D2', 4], ['A2', 4], ['D3', 4], ['F3', 4]] },
    { t: [['E4', 4], ['G#4', 4], ['B4', 8]], b: [['E2', 4], ['B2', 4], ['E3', 4], ['G#3', 4]] },
    { t: [['C6', 6], ['B5', 2], ['A5', 8]], b: [['A2', 4], ['E3', 4], ['A3', 4], ['E3', 4]] },
    { t: [['G5', 4], ['E5', 4], ['D5', 6], ['C5', 2]], b: [['F2', 4], ['C3', 4], ['F3', 4], ['A3', 4]] },
    { t: [['B4', 4], ['C5', 4], ['D5', 6], ['E5', 2]], b: [['G2', 4], ['D3', 4], ['G3', 4], ['B3', 4]] },
    { t: [['A5', 8], ['E5', 4], ['A4', 4]], b: [['A2', 8], ['E3', 8]] }
  ]
});

/* A game tune in C: bouncy eighths below, arpeggios above, one flourish. */
const GAME = musicxml({
  title: 'Pixel Meadow', composer: 'PPP Studio', fifths: 0, measures: [
    { t: [['C5', 2, 'begin'], ['E5', 2, 'end'], ['G5', 4], ['E5', 2, 'begin'], ['C5', 2, 'end'], ['E5', 4]],
      b: [['C2', 2, 'begin'], ['G2', 2, 'end'], ['C2', 2, 'begin'], ['G2', 2, 'end'], ['C2', 2, 'begin'], ['G2', 2, 'end'], ['C2', 2, 'begin'], ['G2', 2, 'end']] },
    { t: [['D5', 2, 'begin'], ['F5', 2, 'end'], ['A5', 4], ['G5', 2, 'begin'], ['E5', 2, 'end'], ['C5', 4]],
      b: [['G2', 2, 'begin'], ['D3', 2, 'end'], ['G2', 2, 'begin'], ['D3', 2, 'end'], ['G2', 2, 'begin'], ['D3', 2, 'end'], ['G2', 2, 'begin'], ['D3', 2, 'end']] },
    { t: [['E5', 2, 'begin'], ['G5', 2, 'end'], ['C6', 4], ['B5', 2, 'begin'], ['G5', 2, 'end'], ['E5', 4]],
      b: [['A2', 2, 'begin'], ['E3', 2, 'end'], ['A2', 2, 'begin'], ['E3', 2, 'end'], ['F2', 2, 'begin'], ['C3', 2, 'end'], ['F2', 2, 'begin'], ['C3', 2, 'end']] },
    { t: [['F5', 2, 'begin'], ['A5', 2, 'end'], ['C6', 4], ['B5', 4], ['G5', 4]],
      b: [['G2', 2, 'begin'], ['D3', 2, 'end'], ['G2', 2, 'begin'], ['B2', 2, 'end'], ['C2', 4], ['G2', 4]] },
    { t: [['C5', 2, 'begin'], ['E5', 2, 'end'], ['G5', 4], ['E5', 2, 'begin'], ['C5', 2, 'end'], ['E5', 4]],
      b: [['C2', 2, 'begin'], ['G2', 2, 'end'], ['C2', 2, 'begin'], ['G2', 2, 'end'], ['C2', 2, 'begin'], ['G2', 2, 'end'], ['C2', 2, 'begin'], ['G2', 2, 'end']] },
    { t: [['A4', 2, 'begin'], ['C5', 2, 'end'], ['E5', 4], ['D5', 4], ['F5', 4]],
      b: [['F2', 2, 'begin'], ['C3', 2, 'end'], ['F2', 2, 'begin'], ['C3', 2, 'end'], ['D2', 2, 'begin'], ['A2', 2, 'end'], ['D2', 2, 'begin'], ['A2', 2, 'end']] },
    { t: [['B4', 2, 'begin'], ['D5', 2, 'end'], ['G5', 4], ['F5', 2, 'begin'], ['D5', 2, 'end'], ['B4', 4]],
      b: [['G2', 2, 'begin'], ['D3', 2, 'end'], ['G2', 2, 'begin'], ['D3', 2, 'end'], ['G2', 4], ['B2', 4]] },
    { t: [['C5', 2, 'begin'], ['E5', 2, 'end'], ['G5', 2, 'begin'], ['C6', 2, 'end'], ['E5', 4], ['G4', 4]],
      b: [['C2', 4], ['G2', 4], ['C2', 4], ['G2', 4]] },
    { t: [['C5', 2, 'begin'], ['E5', 2, 'end'], ['G5', 4], ['E5', 2, 'begin'], ['C5', 2, 'end'], ['E5', 4]],
      b: [['C2', 2, 'begin'], ['G2', 2, 'end'], ['C2', 2, 'begin'], ['G2', 2, 'end'], ['C2', 2, 'begin'], ['G2', 2, 'end'], ['C2', 2, 'begin'], ['G2', 2, 'end']] },
    { t: [['F5', 2, 'begin'], ['A5', 2, 'end'], ['C6', 4], ['A5', 2, 'begin'], ['F5', 2, 'end'], ['A5', 4]],
      b: [['F2', 2, 'begin'], ['C3', 2, 'end'], ['F2', 2, 'begin'], ['C3', 2, 'end'], ['F2', 2, 'begin'], ['C3', 2, 'end'], ['F2', 2, 'begin'], ['C3', 2, 'end']] },
    { t: [['G5', 2, 'begin'], ['B5', 2, 'end'], ['D6', 4], ['B5', 2, 'begin'], ['G5', 2, 'end'], ['D5', 4]],
      b: [['G2', 2, 'begin'], ['D3', 2, 'end'], ['G2', 2, 'begin'], ['D3', 2, 'end'], ['G2', 2, 'begin'], ['D3', 2, 'end'], ['G2', 2, 'begin'], ['D3', 2, 'end']] },
    { t: [['A5', 2, 'begin'], ['F5', 2, 'end'], ['D5', 4], ['C5', 2, 'begin'], ['A4', 2, 'end'], ['F4', 4]],
      b: [['D2', 2, 'begin'], ['A2', 2, 'end'], ['D2', 2, 'begin'], ['A2', 2, 'end'], ['F2', 2, 'begin'], ['C3', 2, 'end'], ['F2', 2, 'begin'], ['C3', 2, 'end']] },
    { t: [['E5', 2, 'begin'], ['G5', 2, 'end'], ['C6', 4], ['G5', 4], ['E5', 4]],
      b: [['C2', 4], ['G2', 4], ['C2', 4], ['G2', 4]] },
    { t: [['C6', 1], ['B5', 1], ['A5', 1], ['G5', 1], ['F5', 1], ['E5', 1], ['D5', 1], ['C5', 1],
        ['D5', 1], ['E5', 1], ['F5', 1], ['G5', 1], ['A5', 1], ['B5', 1], ['C6', 1], ['r', 1]],
      b: [['C2', 4], ['G2', 4], ['C2', 4], ['G2', 4]] },
    { t: [['G5', 2, 'begin'], ['E5', 2, 'end'], ['C5', 4], ['E5', 2, 'begin'], ['G5', 2, 'end'], ['C6', 4]],
      b: [['C2', 2, 'begin'], ['G2', 2, 'end'], ['C2', 2, 'begin'], ['G2', 2, 'end'], ['C2', 4], ['G2', 4]] },
    { t: [['C6', 16]], b: [['C2', 8], ['G2', 8]] }
  ]
});

/* A slow ambient piece in C: seventh chords under a sparse line. */
const NEWAGE = musicxml({
  title: 'Rain on Glass', composer: 'PPP Studio', fifths: 0, measures: [
    { t: [['B4', 4], ['E5', 4], ['G5', 8]], b: [['C3', 2], ['G3', 2], ['E4', 2], ['G3', 2], ['C3', 2], ['G3', 2], ['E4', 2], ['G3', 2]] },
    { t: [['A4', 4], ['C5', 4], ['E5', 8]], b: [['A2', 2], ['E3', 2], ['C4', 2], ['E3', 2], ['A2', 2], ['E3', 2], ['C4', 2], ['E3', 2]] },
    { t: [['A4', 4], ['C5', 4], ['F5', 8]], b: [['F2', 2], ['C3', 2], ['A3', 2], ['C3', 2], ['F2', 2], ['C3', 2], ['A3', 2], ['C3', 2]] },
    { t: [['G4', 4], ['B4', 4], ['D5', 8]], b: [['G2', 2], ['D3', 2], ['B3', 2], ['D3', 2], ['G2', 2], ['D3', 2], ['B3', 2], ['D3', 2]] },
    { t: [['E5', 4], ['G5', 4], ['B5', 8]], b: [['C3', 2], ['G3', 2], ['E4', 2], ['G3', 2], ['C3', 2], ['G3', 2], ['E4', 2], ['G3', 2]] },
    { t: [['C5', 4], ['E5', 4], ['A5', 8]], b: [['A2', 2], ['E3', 2], ['C4', 2], ['E3', 2], ['A2', 2], ['E3', 2], ['C4', 2], ['E3', 2]] },
    { t: [['A4', 4], ['D5', 4], ['F5', 8]], b: [['F2', 2], ['C3', 2], ['A3', 2], ['C3', 2], ['F2', 2], ['C3', 2], ['A3', 2], ['C3', 2]] },
    { t: [['G4', 4], ['D5', 4], ['B4', 8]], b: [['G2', 2], ['D3', 2], ['B3', 2], ['D3', 2], ['G2', 2], ['D3', 2], ['B3', 2], ['F3', 2]] },
    { t: [['B4', 2], ['C6', 6], ['G5', 8]], b: [['C3', 2], ['G3', 2], ['E4', 2], ['G3', 2], ['C3', 2], ['G3', 2], ['E4', 2], ['G3', 2]] },
    { t: [['A5', 4], ['E5', 4], ['C5', 8]], b: [['A2', 2], ['E3', 2], ['C4', 2], ['E3', 2], ['A2', 2], ['E3', 2], ['C4', 2], ['E3', 2]] },
    { t: [['F5', 4], ['C5', 4], ['A4', 8]], b: [['F2', 2], ['C3', 2], ['A3', 2], ['C3', 2], ['F2', 2], ['C3', 2], ['A3', 2], ['C3', 2]] },
    { t: [['G4', 4], ['E5', 4], ['C5', 8]], b: [['C3', 2], ['G3', 2], ['E4', 2], ['G3', 2], ['C3', 8]] }
  ]
});

/* ---------------- the seed list ---------------- */
const KINDS = 'seed';
const SEEDS = [
  { id: 'pppseedclassic', genre: 'Classical', songKey: 'seed:classical',
    title: 'Gymnopédie No. 1', composer: 'Erik Satie', license: 'CC0',
    file: path.join(ROOT, 'catalog', 'gymnopedie-1.musicxml') },
  { id: 'pppseedpop', genre: 'Pop', songKey: 'seed:pop',
    title: 'Happy Birthday', composer: 'Traditional', license: 'CC0',
    file: path.join(ROOT, 'catalog', 'happy-birthday.musicxml') },
  { id: 'pppseedjazz', genre: 'Jazz', songKey: 'seed:jazz',
    title: 'Midtown Blues', composer: 'PPP Studio', license: 'CC0 (written for PPP)',
    xml: JAZZ },
  { id: 'pppseedhymn', genre: 'Hymn', songKey: 'seed:hymn',
    title: 'Amazing Grace', composer: 'Traditional', license: 'Public domain',
    file: path.join(ROOT, 'catalog', 'hymns', 'amazing-grace.musicxml') },
  { id: 'pppseednewage', genre: 'New Age', songKey: 'seed:newage',
    title: 'Rain on Glass', composer: 'PPP Studio', license: 'CC0 (written for PPP)',
    xml: NEWAGE },
  { id: 'pppseedost', genre: 'OST', songKey: 'seed:ost',
    title: 'First Light Theme', composer: 'PPP Studio', license: 'CC0 (written for PPP)',
    xml: OST },
  { id: 'pppseedgame', genre: 'Game', songKey: 'seed:game',
    title: 'Pixel Meadow', composer: 'PPP Studio', license: 'CC0 (written for PPP)',
    xml: GAME }
];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);
  page.on('pageerror', e => { throw new Error('page error: ' + e.message); });
  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => window.PPP && window.PPP.Import, { timeout: 25000 });

  const out = [];
  for (const seed of SEEDS) {
    const xml = seed.xml || fs.readFileSync(seed.file, 'utf8');
    const built = await page.evaluate(src => {
      const score = PPP.parseMusicXML(src, 'seed');
      const preview = (function openingBars(full, n) {
        const ms = full.measures.slice(0, n).map(m => Object.assign({}, m));
        const keep = {};
        ms.forEach(m => { keep[m.number] = true; });
        const mine = list => (list || []).filter(x => keep[x.m]).map(x => Object.assign({}, x));
        return Object.assign({}, full, {
          measures: ms, notes: mine(full.notes), chords: mine(full.chords), pedals: mine(full.pedals),
          ottavas: [], marks: mine(full.marks),
          sections: [{ id: 's1', from: ms[0].number, to: ms[ms.length - 1].number }], _byNumber: undefined
        });
      })(score, 2);
      delete preview.source; delete preview.seeds;
      const report = PPP.Import.validate(score, { pageCount: 0 });
      return { score: score, preview: preview,
        measures: score.measures.length,
        notes: score.notes.filter(n => !n.rest).length,
        issues: report.issues.map(i => (i.measure || '-') + ' ' + i.kind),
        level: report.level, conf: report.confidence };
    }, xml);
    /* a pickup bar is legitimate notation; anything else must be clean */
    const real = built.issues.filter(x => !/^1 underfull$/.test(x));
    console.log(seed.genre.padEnd(10) + ' ' + seed.title.padEnd(24) + ' measures ' + built.measures
      + '  notes ' + built.notes + '  ' + built.level + ' ' + Math.round(built.conf * 100) + '%'
      + (built.issues.length ? '  (' + built.issues.join(' | ') + ')' : ''));
    if (real.length) throw new Error(seed.id + ' does not validate: ' + real.join(', '));
    built.score.id = seed.songKey;
    built.score.title = seed.title;
    built.score.composer = seed.composer;
    out.push({
      id: seed.id, genre: seed.genre, songKey: seed.songKey, title: seed.title,
      composer: seed.composer, kind: KINDS, measures: built.measures,
      license: seed.license, preview: built.preview, score: built.score
    });
  }
  await browser.close();

  const doc = {
    license: 'Seeded scores are public domain, CC0, or written for PPP.',
    owner: { name: 'PPP Library', email: 'library@ppp.local' },
    seeds: out
  };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1));
  console.log('\nwrote ' + path.relative(ROOT, OUT) + ' — ' + out.length + ' seeds, '
    + Math.round(fs.statSync(OUT).size / 1024) + ' KB');
})().catch(e => { console.error(e); process.exit(1); });
