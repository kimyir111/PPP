#!/usr/bin/env node
/* Hymn-SATB ground truth evaluation for G07's harmony and melody/bass passes (design doc §4, §6).

   Ground truth (real, not invented, per §4): the four written SATB voices of catalog/hymns/*.musicxml,
   identified by their original MusicXML <voice> number, preserved on import as Voice.label ('1'
   soprano, '2' alto, '5' tenor, '6' bass — confirmed against the raw XML, not assumed; a Finale
   convention, not 1/2/3/4).

   Harmony: at each beat window (songgraph/util.js beatGrid), the chord fit from exactly the four
   SATB voices' pitches sounding at the window's start (a "vertical slice" ground truth) vs.
   songgraph/harmony.js's own duration-weighted whole-window fit over the same notes (root+quality
   both correct, and root-only, are reported separately).

   Melody/bass: songgraph/voices.js's per-voice role classification vs. voice label '1' (melody) and
   '6' (bass).

     node songgraph/tools/hymn-eval.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const U = require(path.join(REPO, 'songgraph', 'util.js'));
const H = require(path.join(REPO, 'songgraph', 'harmony.js'));
const V = require(path.join(REPO, 'songgraph', 'voices.js'));
const { hymnFiles, satbVoices, pcAt, midiAt } = require('./hymn-ground-truth.js');

async function main() {
  const files = hymnFiles();
  let harmonyTotal = 0, harmonyRootQual = 0, harmonyRootOnly = 0;
  let satbFiles = 0, meterMissing = 0;
  let melodyTotal = 0, melodyCorrect = 0, bassTotal = 0, bassCorrect = 0;
  let mbFiles = 0;
  const perFile = [];

  for (const f of files) {
    const bytes = fs.readFileSync(path.join(REPO, 'catalog', 'hymns', f));
    const r = await SG.importFile(new Uint8Array(bytes), { name: f, scoreId: 'x' });
    if (!r.ok) { console.log('IMPORT-FAIL', f, r.code); continue; }
    const g = r.graph;
    if (g.parts.length !== 1) continue;
    const part = g.parts[0];
    const sv = satbVoices(part);
    const notes = U.noteWindows(g);

    /* --- melody/bass ground truth: needs voice 1 and/or voice 6 present */
    if (sv.s || sv.b) {
      mbFiles++;
      const roles = V.melodyBassOf(g);
      const pr = roles.parts.find(x => x.part === part.id);
      if (pr) {
        if (sv.s) {
          melodyTotal++;
          const top = pr.voices.slice().sort((a, b) => b.melody - a.melody)[0];
          if (top && top.voice === sv.s) melodyCorrect++;
        }
        if (sv.b) {
          bassTotal++;
          const bot = pr.voices.slice().sort((a, b) => b.bass - a.bass)[0];
          if (bot && bot.voice === sv.b) bassCorrect++;
        }
      }
    }

    /* --- harmony ground truth: needs all four SATB voices present */
    if (!(sv.s && sv.a && sv.t && sv.b)) continue;
    satbFiles++;
    let grid;
    try { grid = U.beatGrid(g); } catch (e) { meterMissing++; continue; }
    const detected = H.harmonyOf(g);
    let fileTotal = 0, fileCorrect = 0;
    grid.forEach((w, i) => {
      const pcs = [sv.s, sv.a, sv.t, sv.b].map(v => pcAt(notes, v, w.w0)).filter(x => x !== undefined);
      if (pcs.length < 3) return; /* a rest in 2+ voices: not a usable vertical slice */
      const hist = new Array(12).fill(0);
      pcs.forEach(pc => { hist[pc] += 1; });
      const bassPc = midiAt(notes, sv.b, w.w0) !== undefined ? pcAt(notes, sv.b, w.w0) : undefined;
      const truth = H.fitChord(hist, bassPc);
      if (!truth) return;
      const got = detected[i];
      harmonyTotal++; fileTotal++;
      if (got && got.root === truth.root && got.quality === truth.quality) { harmonyRootQual++; fileCorrect++; }
      if (got && got.root === truth.root) harmonyRootOnly++;
    });
    if (fileTotal) perFile.push({ f, acc: fileCorrect / fileTotal, n: fileTotal });
  }

  console.log('=== Harmony (hymn SATB vertical-slice ground truth) ===');
  console.log('files with full SATB (1,2,5,6):', satbFiles, '(meter-missing skipped:', meterMissing, ')');
  console.log('beats compared:', harmonyTotal);
  console.log('root+quality agreement:', (100 * harmonyRootQual / harmonyTotal).toFixed(1) + '%');
  console.log('root-only agreement:', (100 * harmonyRootOnly / harmonyTotal).toFixed(1) + '%');
  perFile.sort((a, b) => a.acc - b.acc);
  console.log('worst 5 files:', perFile.slice(0, 5).map(x => x.f + ' ' + (100 * x.acc).toFixed(0) + '% (n=' + x.n + ')'));
  console.log('best 5 files:', perFile.slice(-5).map(x => x.f + ' ' + (100 * x.acc).toFixed(0) + '% (n=' + x.n + ')'));

  console.log('\n=== Melody/bass identification (hymn soprano/bass ground truth) ===');
  console.log('files with voice 1 and/or 6:', mbFiles);
  console.log('melody (voice 1) correct:', melodyCorrect + '/' + melodyTotal, '(' + (100 * melodyCorrect / melodyTotal).toFixed(1) + '%)');
  console.log('bass (voice 6) correct:', bassCorrect + '/' + bassTotal, '(' + (100 * bassCorrect / bassTotal).toFixed(1) + '%)');
}

main().catch(e => { console.error(e); process.exit(1); });
