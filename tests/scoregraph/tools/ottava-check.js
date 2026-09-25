#!/usr/bin/env node
/* MX-1 page check: drawn = played = judged under an octave line, in the real page (docs/CURRENT_STATE.md issue 3, D-1).

     PORT=8841 NODE_ENV=production node server.js          (this worktree)
     node tests/scoregraph/tools/ottava-check.js --base http://127.0.0.1:8841

   For every committed MusicXML/MXL file with an octave line (tests/scoregraph/tools/ottava-audit.js ottavaFiles):
     sound    through both of the app's doors - the import (PPP.Import.load, graph -> toScore -> finalize) and its own
              reader (PPP.parseMusicXML: OMR, catalogue match) - every note's sounding MIDI, and every strike the player
              schedules (PianoScore), is the graph's concert pitch;
     print    every note's writtenMidi is that pitch less the line's shift (the graph's display octave; a line that names no
              staff covers every staff of the part, as the G4 plan reads it);
     drawn    the legacy renderer, whole score, puts every notehead of every note under a line on the staff position of
              that written pitch (measured on the SVG against the staff lines of its bar), and labels each line
              8va / 8vb / 15ma / 15mb by what it does.
   The G0 hold-out references are checked like the others and never named. Needs puppeteer (NODE_PATH or
   PPP_BENCH_NODE_MODULES). Exit 1 on any difference. */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const searchPaths = [path.join(REPO, 'node_modules')].concat((process.env.PPP_BENCH_NODE_MODULES || '').split(path.delimiter).filter(Boolean));
const puppeteer = require(require.resolve('puppeteer', { paths: searchPaths }));
const { preparePage } = require(path.join(REPO, 'tests', 'boot'));
const { xmlText, ottavaFiles, holdouts } = require('./ottava-audit.js');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://127.0.0.1:8841');
const only = arg('--only', null);

(async () => {
  const hold = holdouts();
  const files = ottavaFiles().filter(f => !only || f.indexOf(only) >= 0);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 300000 });
  const page = await browser.newPage();
  await preparePage(page);
  await page.setViewport({ width: 1400, height: 900 });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message)));
  await page.goto(base + '/Piano%20Coach%20App.dc.html', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => window.PPP && window.PPP.app && window.PPPScoreGraph && window.Vex && window.Vex.Flow, { timeout: 60000 });
  await page.evaluate(() => window.__pppTest.practice());
  await new Promise(r => setTimeout(r, 1200));
  const lib = await page.evaluate(() => window.PPPScoreGraph.version);
  console.log('page ' + base + ' (scoregraph ' + lib + '), ' + files.length + ' files with an octave line\n');

  let bad = 0, k = 0;
  const totals = { notes: 0, under: 0, heads: 0, strikes: 0 };
  for (const rel of files) {
    const name = hold.has(rel) ? 'a G0 hold-out file #' + (++k) : rel;
    const buf = fs.readFileSync(path.join(REPO, rel));
    const r = await page.evaluate(async (b64, fileName, xml) => {
      const P = window.PPP, SG = window.PPPScoreGraph, App = P.app;
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const R = SG.rational;
      /* ---- the truth: the graph (concert pitch, and the lines of the part the app plays) */
      const imp = await SG.importFile(u, { name: fileName, scoreId: 'mx1-check' });
      if (!imp.ok) return { error: 'the graph does not open: ' + imp.code };
      const g = imp.graph, c = SG.time.ctx(g);
      const at = (m, w) => R.add(c.starts[c.index.get(m)], R.parse(w));
      let pi = g.parts.findIndex(p => p.staves.length >= 2);
      if (pi < 0) pi = g.parts.length - 1;
      const lines = g.parts[pi].spanners.filter(s => s.type === 'ottava' && s.from && s.to).map(s => {
        const assumed = !s.staff || !!(s.ext && s.ext['musicxml.ottava'] && s.ext['musicxml.ottava'].staff === 'assumed');
        return { covers: assumed ? g.parts[pi].staves.map(x => x.id) : [s.staff], a: at(s.from.m, s.from.at), z: at(s.to.m, s.to.at), shift: s.shift };
      });
      const heads = new Map();
      g.parts.forEach((part, k) => {
        const tr = part.instrument && part.instrument.transpose;
        const transposes = !!(tr && (tr.chromatic || tr.diatonic || tr.octave));
        part.events.forEach(e => (e.heads || []).forEach(h => {
          if (!h.pitch) return;
          const t = at(e.m, e.at), staff = h.staff || e.staff;
          let shift = 0, from = null;
          if (k === pi) lines.forEach(o => {
            if (o.covers.indexOf(staff) < 0 || R.lt(t, o.a) || !R.lt(t, o.z) || (from && R.lt(o.a, from))) return;
            shift = o.shift; from = o.a;
          });
          const w = transposes ? SG.pitch.written(h.pitch, tr) : h.pitch;
          const DI = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
          heads.set(h.id, { sounding: SG.pitch.midi(h.pitch), written: SG.pitch.midi(w) - 12 * shift, shift: shift,
            deg: 7 * SG.pitch.displayOctave(w, shift) + DI[w.step] });
        }));
      });
      /* positions and staves as the app numbers them: the projection (before finalize) names each note's head */
      const proj = SG.legacy.toScore(g, { name: fileName, id: 'mx1-check' });
      const r6 = x => Math.round(x * 1e6) / 1e6;
      const keyOf = n => n.m + '|' + r6(n.b) + '|' + (n.staff || 1);
      const want = [];
      proj.notes.forEach(n => { if (!n.rest && n.p) { const t = heads.get(n.sgHead); want.push({ key: keyOf(n), t: t }); } });
      const bag = list => list.map(x => x.key + '|' + x.t.sounding + '|' + x.t.written).sort();
      const out = { notes: want.length, under: want.filter(x => x.t.shift).length, bad: [] };

      /* ---- both doors: what sounds, what is printed, what the player strikes */
      const file = new File([u], fileName);
      const doors = [['import', (await P.Import.load(file)).score]];
      if (xml) doors.push(['parseMusicXML', P.parseMusicXML(xml, fileName)]);
      doors.forEach(([door, s]) => {
        const got = s.notes.filter(n => !n.rest && n.p).map(n => ({ key: keyOf(n),
          t: { sounding: n.soundingMidi != null ? n.soundingMidi : n.midi, written: n.writtenMidi != null ? n.writtenMidi : n.midi } }));
        const A = bag(want), B = bag(got);
        if (A.join(' ') !== B.join(' ')) {
          const onlyA = A.filter(x => B.indexOf(x) < 0), onlyB = B.filter(x => A.indexOf(x) < 0);
          out.bad.push(door + ': ' + onlyB.length + ' notes differ, e.g. the app has ' + onlyB.slice(0, 2).join(', ') + '; the graph ' + onlyA.slice(0, 2).join(', '));
        }
        const plan = P.PianoScore.of(s);
        const wrongStrikes = plan.strikes.filter(x => x.midi !== (x.note.soundingMidi != null ? x.note.soundingMidi : x.note.midi) || x.midi !== x.note.midi);
        if (wrongStrikes.length) out.bad.push(door + ': ' + wrongStrikes.length + ' strikes are not the note\'s pitch');
        if (door === 'import') out.strikes = plan.strikes.length;
        if (door === 'import' && B.join(' ') === A.join(' ')) {
          /* the strikes' pitches, as a multiset, are the graph's sounding pitches of the struck notes */
          const struck = plan.strikes.map(x => keyOf(x.note) + '|' + x.midi).sort();
          const soundOf = new Map();
          got.forEach(x => soundOf.set(x.key + '|' + x.t.sounding, true));
          const stray = struck.filter(x => !soundOf.has(x));
          if (stray.length) out.bad.push('player: ' + stray.length + ' strikes at a pitch no note there sounds, e.g. ' + stray[0]);
        }
      });

      /* ---- what the legacy renderer draws: the import door's Score, the whole score */
      const score = doors[0][1];
      score.id = 'mx1-check:' + fileName;
      App.shelveSong();
      App.adoptScore(score);
      App.enterSong(score, { kind: 'musicxml', name: fileName, importedAt: 0, status: 'parsed' }, false);
      App.go('player')();
      await new Promise(res => App.setState({ wholeScore: true, beat: 0, playing: false }, res));
      await new Promise(res => setTimeout(res, 900));
      const svg = document.querySelector('.ppp-staffwrap svg');
      if (!svg) { out.bad.push('nothing drawn'); return out; }
      const BOTTOM = { treble: 30, bass: 18, alto: 24, tenor: 22, percussion: 30 };      /* bottom line, diatonic (C4 = 28) */
      const clefAt = (mm, staffNo, b) => {
        let cl = (mm.clefs && mm.clefs[staffNo]) || (staffNo === 1 ? 'treble' : 'bass');
        (mm.clefChanges || []).forEach(ch => { if ((ch.staff || 1) === staffNo && ch.b <= b + 1e-6) cl = ch.clef; });
        return cl;
      };
      const byNo = {};
      score.measures.forEach(mm => { byNo[mm.number] = mm; });
      const staffBottom = {};
      svg.querySelectorAll('g.ppp-stave').forEach(gs => {
        const ys = [...gs.querySelectorAll('.vf-stave path')].map(p => /M[\d.]+ ([\d.]+)L/.exec(p.getAttribute('d'))).filter(Boolean).map(m => +m[1]);
        if (ys.length >= 5) staffBottom[gs.getAttribute('data-m') + '|' + gs.getAttribute('data-staff')] = { bottom: Math.max.apply(null, ys), gap: (Math.max.apply(null, ys) - Math.min.apply(null, ys)) / 4 };
      });
      const byOnset = new Map();
      want.forEach(x => {
        const [m, b, st] = x.key.split('|');
        const k2 = m + '|' + (+b).toFixed(3) + '|' + st;
        if (!byOnset.has(k2)) byOnset.set(k2, []);
        byOnset.get(k2).push(x.t);
      });
      /* every notehead drawn at an onset (the voices of a staff are drawn as separate notes with one onset key); a head
         is measured on its own glyph - the first path of .vf-notehead, since its group also holds the accidental */
      const drawnAt = new Map();
      svg.querySelectorAll('g.ppp-note[data-onset]').forEach(gn => {
        if (gn.getAttribute('data-rest') === '1') return;
        const k2 = gn.getAttribute('data-onset');
        if (!drawnAt.has(k2)) drawnAt.set(k2, []);
        gn.querySelectorAll('.vf-notehead').forEach(h => { const pth = h.querySelector('path'); if (pth) drawnAt.get(k2).push(pth.getBBox()); });
      });
      let checked = 0;
      byOnset.forEach((ts, k2) => {
        if (!ts.some(t => t.shift)) return;
        const [m, b, st] = k2.split('|');
        const line = staffBottom[m + '|' + st];
        if (!line) { out.bad.push('bar ' + m + ' staff ' + st + ': no staff lines found'); return; }
        if (!drawnAt.has(k2)) { out.bad.push('nothing drawn at ' + k2); return; }
        const cl = clefAt(byNo[m] || {}, +st, +b);
        const drawnDeg = drawnAt.get(k2).map(bb => BOTTOM[cl] + Math.round((line.bottom - (bb.y + bb.height / 2)) / (line.gap / 2)));
        /* a unison is drawn once; compare the sets */
        const wantDeg = Array.from(new Set(ts.map(t => t.deg))).sort((x, y) => x - y);
        const gotDeg = Array.from(new Set(drawnDeg)).sort((x, y) => x - y);
        checked += ts.length;
        if (wantDeg.join(',') !== gotDeg.join(',')) out.bad.push('drawn at ' + k2 + ' (' + cl + '): steps ' + gotDeg.join(',') + ', written ' + wantDeg.join(','));
      });
      out.drawnChecked = checked;
      if (checked < out.under) out.bad.push('only ' + checked + ' of ' + out.under + ' notes under a line were found drawn');
      /* the labels: an 8va (shift +1) reads "8va", an 8vb "8vb", two octaves "15ma" / "15mb" */
      const labels = [...svg.querySelectorAll('text')].map(t => t.textContent.trim()).filter(t => /^\(?(8va|8vb|15ma|15mb)\)?$/.test(t)).map(t => t.replace(/[()]/g, ''));
      const names = Array.from(new Set(lines.map(o => (Math.abs(o.shift) >= 2 ? '15m' : '8v') + (o.shift > 0 ? 'a' : 'b'))));
      names.forEach(nm => { if (labels.indexOf(nm) < 0) out.bad.push('no "' + nm + '" label drawn (found ' + Array.from(new Set(labels)).join(' ') + ')'); });
      labels.forEach(l => { if (names.indexOf(l) < 0) out.bad.push('a "' + l + '" label, but no such line in the file'); });
      return out;
    }, buf.toString('base64'), path.basename(rel), /\.mxl$/i.test(rel) ? xmlText(buf) : buf.toString('utf8'));
    if (r.error) { bad++; console.log('  FAIL ' + name + '  ' + r.error); continue; }
    totals.notes += r.notes; totals.under += r.under; totals.heads += r.drawnChecked || 0; totals.strikes += r.strikes || 0;
    const ok = !r.bad.length;
    if (!ok) bad++;
    console.log((ok ? '  ok   ' : '  FAIL ') + name + '  ' + r.notes + ' notes, ' + r.under + ' under a line, ' + (r.drawnChecked || 0) + ' drawn and measured' +
      (ok ? '' : '\n         ' + r.bad.slice(0, 4).join('\n         ')));
  }
  await browser.close();
  console.log('\n' + totals.notes + ' notes (' + totals.under + ' under a line, ' + totals.heads + ' of them measured on the page), ' + totals.strikes + ' strikes');
  console.log('page errors: ' + (pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : 'none'));
  console.log(bad ? bad + ' of ' + files.length + ' files FAIL' : 'every file: the app sounds the graph\'s pitch, prints it less the shift, and draws it there');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
