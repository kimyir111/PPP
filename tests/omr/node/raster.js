/* omr-live-2: SVG pages -> PNG (A4, 300 DPI) or a vector PDF, with headless Chrome (docs/GOALS/G12_OMR.md section 10).

     node tests/omr/node/raster.js --jobs jobs.json

   jobs.json is an array; one Chrome serves them all.
     { "kind": "png", "svg": <file>, "out": <png file>,
       "viewport": { width, height, deviceScaleFactor },             what the page is shot in (CSS px and a scale)
       "clip": { x, y, width, height },                              the part of it kept
       "set_size": { width, height } | null }                        rewrite the SVG root's size first (px); a viewBox is added when it has none
     { "kind": "pdf", "svgs": [<file>...], "out": <pdf file>, "mm": { width, height } }
   Prints one JSON line {"ok": n, "failed": [...]} and exits 1 when any job failed. Local tool: puppeteer comes from the repository
   or from PPP_BENCH_NODE_MODULES (the way tests/bench/node/omr-live.js finds it). */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const searchPaths = [path.join(REPO, 'node_modules')].concat((process.env.PPP_BENCH_NODE_MODULES || '').split(path.delimiter).filter(Boolean));

/* the root <svg ...> tag of a file: its width and height replaced (and a viewBox added from the old size when there is none) */
function sizeSvg(svg, width, height) {
  const m = /<svg\b[^>]*>/.exec(svg);
  if (!m) throw new Error('no <svg> root');
  let tag = m[0];
  const num = name => { const a = new RegExp('\\s' + name + '="([\\d.]+)(?:px)?"').exec(tag); return a ? parseFloat(a[1]) : null; };
  const w0 = num('width'), h0 = num('height');
  const hasBox = /\sviewBox="/.test(tag);
  tag = tag.replace(/\swidth="[^"]*"/, '').replace(/\sheight="[^"]*"/, '');
  let extra = ' width="' + width + '" height="' + height + '"';
  if (!hasBox) {
    if (w0 == null || h0 == null) throw new Error('an <svg> without a viewBox or a size');
    extra += ' viewBox="0 0 ' + w0 + ' ' + h0 + '"';
  }
  tag = tag.replace(/<svg\b/, '<svg' + extra);
  return svg.slice(0, m.index) + tag + svg.slice(m.index + m[0].length);
}

/* the vector PDF is made in Chrome's quirks mode (no doctype), exactly as the design document's measurement made it: the page-level
   reader (PdfLayer) is sensitive to where Chrome puts the glyphs, and standards mode puts some of them elsewhere (measured: the browser
   draft's played-note F1 of two of six PDFs moved by 0.03-0.09). The PNGs are not affected (the same pixels in both modes). */
const htmlQuirks = body => '<html><body style="margin:0;color:#000">' + body + '</body></html>';
const html = body => '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff;color:#000">' + body + '</body></html>';

async function main() {
  const i = process.argv.indexOf('--jobs');
  if (i < 0) { console.error('usage: raster.js --jobs jobs.json'); process.exit(2); }
  const jobs = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
  const puppeteer = require(require.resolve('puppeteer', { paths: searchPaths }));
  /* --disable-gpu: with the GPU raster Chrome draws the same SVG with a different anti-aliasing from one shot to the next (measured:
     6 shots of one page, 3 different PNGs, within one browser session); on the CPU raster the same page is the same bytes, in any
     order and across launches. The pages of omr-live-2 must not change between runs (A0). */
  const browser = await puppeteer.launch({ headless: true, args: ['--disable-gpu'] });
  const failed = [];
  let ok = 0;
  const chromeVersion = await browser.version();
  try {
    const page = await browser.newPage();
    for (const job of jobs) {
      try {
        fs.mkdirSync(path.dirname(job.out), { recursive: true });
        if (job.kind === 'png') {
          let svg = fs.readFileSync(job.svg, 'utf8');
          if (job.set_size) svg = sizeSvg(svg, job.set_size.width + 'px', job.set_size.height + 'px');
          await page.setViewport(job.viewport);
          await page.setContent(html(svg));
          await page.screenshot({ path: job.out, clip: job.clip });
        } else if (job.kind === 'pdf') {
          const pages = job.svgs.map(f => '<div style="width:' + job.mm.width + 'mm;height:' + job.mm.height + 'mm;page-break-after:always;overflow:hidden">'
            + sizeSvg(fs.readFileSync(f, 'utf8'), job.mm.width + 'mm', job.mm.height + 'mm') + '</div>').join('');
          await page.setContent(htmlQuirks(pages));
          await page.pdf({ path: job.out, width: job.mm.width + 'mm', height: job.mm.height + 'mm', printBackground: true,
            margin: { top: 0, bottom: 0, left: 0, right: 0 } });
        } else throw new Error('unknown job kind ' + job.kind);
        ok++;
      } catch (e) { failed.push({ out: job.out, error: String(e && e.message || e) }); }
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify({ ok, failed, chrome: chromeVersion }));
  process.exit(failed.length ? 1 : 0);
}

module.exports = { sizeSvg };
if (require.main === module) main().catch(e => { console.error(e && e.stack || e); process.exit(3); });
