/* Generates the import test fixtures.

   The piano fixtures are engraved with VexFlow and printed to PDF/PNG/JPG, so
   they are real notation images whose exact musical content we know — which is
   what lets the OMR tests assert against ground truth rather than vibes.

   Run: node tests/fixtures/make-fixtures.js
*/
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;

/* Ground truth. Kept alongside the fixtures so tests can assert against it. */
const TRUTH = {
  title: 'PPP Test Score',
  keyFifths: 0, beats: 4, beatType: 4, tempo: 84,
  measures: 8, staves: 2,
  /* per measure: treble quarter notes, bass half notes */
  treble: [
    ['c/4', 'e/4', 'g/4', 'e/4'], ['f/4', 'a/4', 'c/5', 'a/4'],
    ['g/4', 'b/4', 'd/5', 'b/4'], ['c/5', 'b/4', 'a/4', 'g/4'],
    ['a/4', 'c/5', 'e/5', 'c/5'], ['f/4', 'a/4', 'c/5', 'f/5'],
    ['e/5', 'd/5', 'c/5', 'b/4'], ['c/5', 'g/4', 'e/4', 'c/4']
  ],
  bass: [
    ['c/3', 'g/3'], ['f/2', 'c/3'], ['g/2', 'd/3'], ['c/3', 'e/3'],
    ['a/2', 'e/3'], ['f/2', 'c/3'], ['g/2', 'b/2'], ['c/3', 'c/2']
  ]
};

function pageHtml(fromBar, bars, perLine) {
  const treble = TRUTH.treble.slice(fromBar, fromBar + bars);
  const bass = TRUTH.bass.slice(fromBar, fromBar + bars);
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/vexflow@4.2.3/build/cjs/vexflow.js"></script>
<style>
  @page { size: A4; margin: 14mm; }
  html,body { margin:0; padding:0; background:#fff; }
  #t { font: 20px Georgia, serif; text-align:center; margin: 6mm 0 4mm; }
  #s { font: 11px Georgia, serif; text-align:center; color:#333; margin-bottom: 6mm; }
  #out { display:flex; flex-direction:column; gap:10mm; align-items:center; }
</style></head><body>
<div id="t">${TRUTH.title}</div>
<div id="s">for optical music recognition testing</div>
<div id="out"></div>
<script>
const VF = Vex.Flow;
const TREBLE = ${JSON.stringify(treble)};
const BASS = ${JSON.stringify(bass)};
const PER = ${perLine};
const out = document.getElementById('out');
for (let line = 0; line * PER < TREBLE.length; line++) {
  const bars = TREBLE.slice(line * PER, line * PER + PER);
  const lows = BASS.slice(line * PER, line * PER + PER);
  const div = document.createElement('div');
  out.appendChild(div);
  const W = 170 * bars.length + 90, H = 260;
  const r = new VF.Renderer(div, VF.Renderer.Backends.SVG);
  r.resize(W, H);
  const ctx = r.getContext();
  ctx.setFont('Arial', 10);
  let x = 10;
  bars.forEach((bar, i) => {
    const w = (i === 0 ? 90 : 0) + 170;
    const t = new VF.Stave(x, 20, w);
    const b = new VF.Stave(x, 140, w);
    if (i === 0) {
      t.addClef('treble').addTimeSignature('4/4');
      b.addClef('bass').addTimeSignature('4/4');
    }
    t.setContext(ctx).draw();
    b.setContext(ctx).draw();
    /* Join the staves at every barline. Real piano engraving runs the barlines
       through both staves, and that vertical connection is what OMR uses to
       group them into one grand-staff part — without it Audiveris reads two
       independent single-staff systems. */
    if (i === 0) {
      new VF.StaveConnector(t, b).setType(VF.StaveConnector.type.BRACE).setContext(ctx).draw();
      new VF.StaveConnector(t, b).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
    }
    if (i === bars.length - 1) new VF.StaveConnector(t, b).setType(VF.StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw();
    const tn = bar.map(k => new VF.StaveNote({ keys: [k], duration: 'q', clef: 'treble' }));
    const bn = lows[i].map(k => new VF.StaveNote({ keys: [k], duration: 'h', clef: 'bass' }));
    const tv = new VF.Voice({ num_beats: 4, beat_value: 4 }).addTickables(tn);
    const bv = new VF.Voice({ num_beats: 4, beat_value: 4 }).addTickables(bn);
    new VF.Formatter().format([tv, bv], w - (i === 0 ? 90 : 0) - 30);
    tv.setStave(t).draw(ctx, t);
    bv.setStave(b).draw(ctx, b);
    x += w;
  });
}
window.__ready = true;
</script></body></html>`;
}

async function render(page, html, base, opts) {
  const tmp = path.join(OUT, '_tmp.html');
  fs.writeFileSync(tmp, html, 'utf8');
  await page.goto('file:///' + tmp.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
  await new Promise(r => setTimeout(r, 400));
  if (opts.pdf) await page.pdf({ path: path.join(OUT, base + '.pdf'), format: 'A4', printBackground: true, scale: 1 });
  if (opts.png) {
    const el = await page.$('body');
    await el.screenshot({ path: path.join(OUT, base + '.png') });
  }
  if (opts.jpg) {
    const el = await page.$('body');
    await el.screenshot({ path: path.join(OUT, base + '.jpg'), type: 'jpeg', quality: 88 });
  }
  fs.unlinkSync(tmp);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 2 });

  /* clean single page: 8 bars, 4 per line */
  await render(page, pageHtml(0, 8, 4), 'piano-clean', { pdf: true, png: true, jpg: true });

  /* multi-page: same music, 2 bars per line so it spills over two A4 pages */
  await render(page, pageHtml(0, 8, 2), 'piano-multipage', { pdf: true });

  /* an image with no notation at all */
  await render(page, `<!DOCTYPE html><html><body style="margin:0;background:#fff;font:28px Georgia,serif;">
    <div style="padding:60px;width:900px;">
      <h1>Shopping list</h1><p>Milk, bread, coffee. No music here whatsoever.</p>
      <p>This fixture exists to prove PPP refuses input that contains no notation.</p>
    </div><script>window.__ready=true;</script></body></html>`, 'no-music', { png: true });

  await browser.close();

  /* a file that claims to be a PDF but is not */
  fs.writeFileSync(path.join(OUT, 'malformed.pdf'), Buffer.from('%PDF-1.4\nthis is not actually a pdf body\n%%EOF\n'));

  fs.writeFileSync(path.join(OUT, 'truth.json'), JSON.stringify(TRUTH, null, 2));

  fs.readdirSync(OUT).filter(f => !/\.js$/.test(f)).sort().forEach(f => {
    const st = fs.statSync(path.join(OUT, f));
    console.log('  ' + f.padEnd(26) + (st.size / 1024).toFixed(0) + ' KB');
  });
})().catch(e => { console.error(e); process.exit(1); });
