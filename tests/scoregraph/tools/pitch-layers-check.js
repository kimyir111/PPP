#!/usr/bin/env node
/* D7 end to end, in the real page (docs/GOALS/G02_SCORE_IMPORT.md §26).

     node tests/scoregraph/tools/pitch-layers-check.js [--base URL]

   The node tests check what the adapter puts on a Score. This checks what the app then does with it:
   the sheet must draw the written pitch, the player must sound the concert pitch, and an ordinary
   piano file must come out exactly as it did before. Needs `npm start` and puppeteer, like
   shadow-legacy.js and app-import-check.js. */
'use strict';
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const searchPaths = [path.join(repoRoot, 'node_modules')].concat(
  (process.env.PPP_BENCH_NODE_MODULES || '').split(path.delimiter).filter(Boolean));
const puppeteer = require(require.resolve('puppeteer', { paths: searchPaths }));
const base = arg('--base', 'http://127.0.0.1:8777');

let bad = 0;
const say = (what, ok, detail) => {
  process.stdout.write((ok ? '  ok   ' : '  FAIL ') + what + (detail ? '  ' + detail : '') + '\n');
  if (!ok) bad++;
};
const b64 = rel => fs.readFileSync(path.join(repoRoot, rel)).toString('base64');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message)));
  await page.goto(base + '/Piano%20Coach%20App.dc.html', { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction('typeof PPP === "object" && typeof PPPScoreGraph === "object"', { timeout: 180000 });

  await page.evaluate(() => {
    window.scoreOf = async (b64, name) => {
      const bin = atob(b64);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const f = new File([u], name);
      const out = await PPP.Import.load(f);
      return out.score;
    };
    /* what the sheet renderer resolves a note to (App 10659): writtenP wins when it is there */
    window.drawn = n => (n.writtenP || n.p);
    /* what the player schedules (App 2866) */
    window.played = n => (n.soundingMidi != null ? n.soundingMidi : n.midi);
  });

  process.stdout.write('a transposing part: the page is written, the sound is concert\n');
  const tr = await page.evaluate(async d => {
    const s = await window.scoreOf(d, 'transposing.musicxml');
    const rows = s.notes.filter(n => !n.rest).map(n => ({
      drawn: window.drawn(n), writtenMidi: n.writtenMidi, played: window.played(n), p: n.p, staff: n.staff
    }));
    return { rows: rows, key: s.measures[0].key.fifths };
  }, b64('tests/scoregraph/fixtures/xml/transposing.musicxml'));

  /* Score.finalize orders by absolute position then staff, so the two parts interleave */
  const wantDrawn = ['D5', 'Bb2', 'E5', 'F#5', 'F3', 'C5'];
  const wantPlayed = [72, 34, 74, 76, 41, 70];
  say('the sheet draws the written pitch',
    JSON.stringify(tr.rows.map(r => r.drawn)) === JSON.stringify(wantDrawn),
    JSON.stringify(tr.rows.map(r => r.drawn)));
  say('the player sounds the concert pitch',
    JSON.stringify(tr.rows.map(r => r.played)) === JSON.stringify(wantPlayed),
    JSON.stringify(tr.rows.map(r => r.played)));
  say('the printed key goes with the printed notes', tr.key === 0, 'fifths ' + tr.key);
  say('and the two really are different notes',
    tr.rows.every(r => r.writtenMidi !== r.played),
    JSON.stringify(tr.rows.map(r => r.writtenMidi + '/' + r.played)));

  process.stdout.write('\nan ordinary piano file is untouched\n');
  for (const [name, rel] of [['fur-elise.musicxml', 'catalog/fur-elise.musicxml'],
    ['gymnopedie.musicxml', 'catalog/gymnopedie-1.musicxml'],
    ['ottava.musicxml', 'tests/scoregraph/fixtures/xml/ottava-8va-8vb.musicxml']]) {
    const r = await page.evaluate(async (d, n) => {
      const s = await window.scoreOf(d, n);
      const ns = s.notes.filter(x => !x.rest);
      return {
        drawnIsP: ns.every(x => window.drawn(x) === (x.writtenP || x.p)),
        /* with no transposition, what is printed and what sounds differ only by an 8va */
        agree: ns.every(x => window.played(x) === x.writtenMidi + (x.ottavaShift || 0)),
        shifted: ns.filter(x => x.ottavaShift).length,
        count: ns.length
      };
    }, b64(rel), name);
    say(name + ': printed and sounding differ only by an 8va', r.agree,
      r.count + ' notes, ' + r.shifted + ' under an octave line');
  }

  process.stdout.write('\nthe way back is unaffected\n');
  const roll = await page.evaluate(async d => {
    PPP.legacyImport = true;
    const old = await window.scoreOf(d, 'fur-elise.musicxml');
    PPP.legacyImport = false;
    const now = await window.scoreOf(d, 'fur-elise.musicxml');
    const key = s => s.notes.filter(n => !n.rest).map(n => n.p + ':' + window.played(n) + ':' + window.drawn(n)).join(' ');
    return { same: key(old) === key(now), n: now.notes.length };
  }, b64('catalog/fur-elise.musicxml'));
  say('both readers draw and sound the same notes', roll.same, roll.n + ' notes');

  await page.close();
  await browser.close();
  process.stdout.write('\npage errors: ' + (pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : 'none') + '\n');
  process.stdout.write(bad ? bad + ' failed\n' : 'display is written, sound is concert, and a piano score is unchanged\n');
  process.exit(bad ? 1 : 0);
})();
