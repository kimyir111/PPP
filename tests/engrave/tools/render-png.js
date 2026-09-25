/* G04 §21.3 (the local look, never a CI gate): scores engraved by engrave/ and drawn by engrave/svg.js, as PNG - for a
   person to look at what the layout does.

     NODE_PATH=D:/PPP/node_modules node tests/engrave/tools/render-png.js <score>... [--phone] [--boxes] [--scale=<px per sp>] [--clip=x0,y0,x1,y1] [--out=<dir>]

   <score> is a repo path (MusicXML, MXL, MIDI or a .sg.json graph). Each is laid out at the desktop (or phone) screen
   config, drawn as layout-view.js draws it (white page, --boxes for the layout's boxes) and photographed by headless
   Chrome at --scale px a staff space (default 12). The page's text faces come from the fonts make-text-metrics.js
   caches (tests/engrave/out/fonts/, `--fetch` there first); without them Chrome uses its fallbacks, which changes how
   text looks, never where it stands. No network: requests are refused. Writes <out>/<name>.<config>.png (default
   tests/engrave/out/png/). */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const REPO = path.resolve(__dirname, '..', '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const E = require(path.join(REPO, 'engrave', 'index.js'));
const { svgOf } = require('./layout-view.js');
const TM = require('./make-text-metrics.js');

function fontFaces() {
  return TM.FACES.map(f => {
    const p = path.join(TM.CACHE, path.basename(f.url));
    if (!fs.existsSync(p)) return '';
    return '@font-face{font-family:"' + f.family + '";font-style:' + f.style + ';font-weight:' + f.weight + ';src:url(data:font/ttf;base64,' +
      fs.readFileSync(p).toString('base64') + ') format("truetype");}';
  }).join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const files = args.filter(a => !a.startsWith('--'));
  const flag = n => args.find(a => a === '--' + n || a.startsWith('--' + n + '='));
  const val = n => { const a = flag(n); return a && a.indexOf('=') > 0 ? a.slice(a.indexOf('=') + 1) : null; };
  if (!files.length) { console.error('usage: render-png.js <score>... [--phone] [--boxes] [--scale=<px>] [--clip=x0,y0,x1,y1] [--out=<dir>]'); process.exit(2); }
  const k = +(val('scale') || 12);
  const out = path.resolve(REPO, val('out') || 'tests/engrave/out/png');
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', r => { if (r.url().startsWith('data:') || r.url() === 'about:blank') r.continue(); else r.abort(); });
  const faces = fontFaces();
  for (const file of files) {
    const abs = path.resolve(REPO, file);
    let graph;
    if (/\.sg\.json$/.test(abs)) graph = SG.parse(fs.readFileSync(abs, 'utf8'));
    else {
      const r = await SG.importFile(new Uint8Array(fs.readFileSync(abs)), { name: path.basename(abs), scoreId: 'png' });
      if (!r.ok) { console.error('does not open:', file); continue; }
      graph = r.graph;
    }
    const plan = E.plan(graph);
    const eng = E.layout.engrave(plan, { breakpoint: flag('phone') ? 'phone' : 'desktop' });
    const svg = svgOf(eng, plan, { boxes: !!flag('boxes') }).replace(/ width="[\d.]+" height="[\d.]+"/, ' width="' + Math.ceil(eng.pages[0].w * k) + '" height="' + Math.ceil(eng.pages[0].h * k) + '"');
    await page.setViewport({ width: Math.ceil(eng.pages[0].w * k), height: Math.ceil(eng.pages[0].h * k) });
    await page.setContent('<!doctype html><html><head><style>' + faces + 'html,body{margin:0;background:#fff;color:#000}</style></head><body>' + svg + '</body></html>');
    await page.evaluate(() => document.fonts.ready);
    const name = path.basename(path.dirname(abs)) + '-' + path.basename(abs).replace(/\.(musicxml|xml|mxl|mid|sg\.json)$/i, '') + '.' + eng.config.breakpoint + '.png';
    /* --clip=x0,y0,x1,y1 (sp): a part of the page, for a closer look */
    const clip = val('clip') ? val('clip').split(',').map(Number) : null;
    await page.screenshot(clip ? { path: path.join(out, name.replace(/\.png$/, '.clip.png')), clip: { x: clip[0] * k, y: clip[1] * k, width: (clip[2] - clip[0]) * k, height: (clip[3] - clip[1]) * k } }
      : { path: path.join(out, name), fullPage: true });
    console.log(path.relative(REPO, path.join(out, name)).replace(/\\/g, '/'), eng.systems.length + ' systems', eng.curves.length + ' curves',
      eng.diagnostics.filter(d => d.code !== 'SYSTEM_SCALED').map(d => d.code).join(' '));
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
