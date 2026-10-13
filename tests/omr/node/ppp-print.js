/* omr-live-2, engraver B: PPP's own print path (docs/GOALS/G12_OMR.md section 10; G04 section 17).

   MusicXML -> ScoreGraph (scoregraph/index.js importFile, the one door) -> print plan and layout (engrave/page.js printLayout, A4)
   -> one SVG string a page (printSvgs). Pure: no DOM, no browser, no network, nothing random; the same bytes in give the same
   SVG out on every platform and in any order (tests/omr/node/ppp-print.test.js checks that, 3 runs and reversed).

     node tests/omr/node/ppp-print.js --in truth.musicxml --out <dir>          writes <dir>/p1.svg ... and <dir>/print.json
     const { printPages } = require('./ppp-print.js'); await printPages(bytes, 'name.musicxml') -> { pages: [svg...], meta }

   The page's SVG is in the print layout's staff-space units (viewBox 0 0 120 169.71 on A4); whoever rasterises it gives it its size
   (raster.js). Text (title, page numbers) uses the page's fonts, which headless Chrome replaces with its fallbacks: that changes how
   a title looks, never where a note stands. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const PAGE = require(path.join(REPO, 'engrave', 'page.js'));

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

/* bytes: the MusicXML (Uint8Array / Buffer / string). Rejects with an Error when the file does not open or the layout throws. */
async function printPages(bytes, name) {
  const u8 = typeof bytes === 'string' ? new Uint8Array(Buffer.from(bytes, 'utf8')) : new Uint8Array(bytes);
  const r = await SG.importFile(u8, { name: name || 'excerpt.musicxml', scoreId: 'omr-live-2' });
  if (!r || !r.ok) throw new Error('the score does not open: ' + JSON.stringify(r && r.report && r.report.error || r && r.error || null));
  const built = PAGE.printLayout(r.graph, {});
  const svgs = PAGE.printSvgs(built.eng, built.plan);
  const raster = PAGE.noRaster(svgs);
  if (!raster.ok) throw new Error('the print output holds a raster element: ' + raster.bad.join('; '));
  const meta = {
    engraver: 'ppp-print',
    version: PAGE.VERSION,
    pages: svgs.length,
    page_size_sp: built.eng.pages.map(p => [p.w, p.h]),
    systems: built.eng.systems.length,
    diagnostics: (built.eng.diagnostics || []).map(d => d.code).sort(),
    svg_sha256: svgs.map(sha256)
  };
  return { pages: svgs, meta };
}

async function main() {
  const args = process.argv.slice(2);
  const val = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const input = val('--in'), out = val('--out');
  if (!input || !out) { console.error('usage: ppp-print.js --in truth.musicxml --out <dir>'); process.exit(2); }
  const res = await printPages(fs.readFileSync(input), path.basename(input));
  fs.mkdirSync(out, { recursive: true });
  res.pages.forEach((s, i) => fs.writeFileSync(path.join(out, 'p' + (i + 1) + '.svg'), s, 'utf8'));
  fs.writeFileSync(path.join(out, 'print.json'), JSON.stringify(res.meta, null, 1) + '\n', 'utf8');
  console.log(JSON.stringify({ pages: res.meta.pages, systems: res.meta.systems }));
}

module.exports = { printPages };
if (require.main === module) main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
