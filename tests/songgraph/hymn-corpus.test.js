/* G07 §6 acceptance: harmony and melody/bass agreement measured against real hymn SATB ground truth
   (design doc §4's correction — not printed chord symbols, which are 100% licence-quarantined).
   These are regression floors, set a safe margin below the real baseline measured by
   songgraph/tools/hymn-eval.js (2026-09-28: 89.2% harmony root+quality, 93.1% root-only, 100.0%
   melody, 99.0% bass) — a real drop below the floor means the detector regressed, not noise. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO, H, V } = require('./helpers.js');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const { hymnFiles, satbVoices, pcAt, midiAt } = require(path.join(REPO, 'songgraph', 'tools', 'hymn-ground-truth.js'));
const U = require(path.join(REPO, 'songgraph', 'util.js'));

async function loadHymns() {
  const files = hymnFiles();
  const out = [];
  for (const f of files) {
    const bytes = fs.readFileSync(path.join(REPO, 'catalog', 'hymns', f));
    const r = await SG.importFile(new Uint8Array(bytes), { name: f, scoreId: 'x' });
    if (r.ok) out.push({ f, g: r.graph });
  }
  return out;
}

test('hymn corpus: 96/100 files carry the full 1/2/5/6 SATB voice-label convention', async () => {
  const hymns = await loadHymns();
  assert.equal(hymns.length, 100);
  let full = 0;
  hymns.forEach(({ g }) => {
    const sv = satbVoices(g.parts[0]);
    if (sv.s && sv.a && sv.t && sv.b) full++;
  });
  assert.equal(full, 96);
});

test('harmony.js vs hymn SATB: root+quality agreement holds at or above 85% (baseline 89.2%)', async () => {
  const hymns = await loadHymns();
  let total = 0, rootQual = 0, rootOnly = 0;
  hymns.forEach(({ g }) => {
    if (g.parts.length !== 1) return;
    const part = g.parts[0];
    const sv = satbVoices(part);
    if (!(sv.s && sv.a && sv.t && sv.b)) return;
    const notes = U.noteWindows(g);
    let grid;
    try { grid = U.beatGrid(g); } catch (e) { return; }
    const detected = H.harmonyOf(g);
    grid.forEach((w, i) => {
      const pcs = [sv.s, sv.a, sv.t, sv.b].map(v => pcAt(notes, v, w.w0)).filter(x => x !== undefined);
      if (pcs.length < 3) return;
      const hist = new Array(12).fill(0);
      pcs.forEach(pc => { hist[pc] += 1; });
      const bassPc = pcAt(notes, sv.b, w.w0);
      const truth = H.fitChord(hist, bassPc);
      if (!truth) return;
      const got = detected[i];
      total++;
      if (got && got.root === truth.root && got.quality === truth.quality) rootQual++;
      if (got && got.root === truth.root) rootOnly++;
    });
  });
  assert.ok(total > 5000, 'expected thousands of comparable beats, got ' + total);
  const rq = rootQual / total, ro = rootOnly / total;
  assert.ok(rq >= 0.85, 'root+quality agreement ' + (100 * rq).toFixed(1) + '% fell below the 85% floor');
  assert.ok(ro >= 0.90, 'root-only agreement ' + (100 * ro).toFixed(1) + '% fell below the 90% floor');
});

test('voices.js vs hymn soprano/bass: melody >=95%, bass >=90% (baseline 100.0%/99.0%)', async () => {
  const hymns = await loadHymns();
  let melodyTotal = 0, melodyCorrect = 0, bassTotal = 0, bassCorrect = 0;
  hymns.forEach(({ g }) => {
    if (g.parts.length !== 1) return;
    const part = g.parts[0];
    const sv = satbVoices(part);
    if (!sv.s && !sv.b) return;
    const roles = V.melodyBassOf(g);
    const pr = roles.parts.find(x => x.part === part.id);
    if (!pr) return;
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
  });
  assert.ok(melodyTotal >= 90 && bassTotal >= 90);
  assert.ok(melodyCorrect / melodyTotal >= 0.95, 'melody accuracy fell below 95%');
  assert.ok(bassCorrect / bassTotal >= 0.90, 'bass accuracy fell below 90%');
});

test('no ground truth is invented for the non-hymn corpus: no <lyric>/melody-tagging convention exists', () => {
  /* Confirms the design doc's §5 instruction was followed rather than assumed: checked once, directly,
     that no melody-identifying convention exists outside catalog/hymns in the corpus roots G07 reads
     (tests/scoregraph/tools/g3-corpus.js's ROOTS). Two unrelated tests/engrave/ fixtures do carry
     <lyric> but tests/engrave/ is not one of those corpus roots and they are not evaluated here. */
  const { corpusFiles } = require(path.join(REPO, 'tests', 'scoregraph', 'tools', 'g3-corpus.js'));
  const files = corpusFiles().filter(p => !p.startsWith('catalog/hymns/'));
  let anyLyric = false;
  files.forEach(p => {
    const text = fs.readFileSync(path.join(REPO, p), 'latin1');
    if (text.indexOf('<lyric') >= 0) anyLyric = true;
  });
  assert.equal(anyLyric, false, 'a melody ground-truth signal exists outside hymns after all - update voices.js\'s header and the design doc');
});
