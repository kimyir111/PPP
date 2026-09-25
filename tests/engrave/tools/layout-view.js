/* G04 §20, G4b-G4c: a development view of an EngravedScore - never loaded by the app.

     node tests/engrave/tools/layout-view.js <score> [--phone] [--width=<sp>] [--boxes] [--out=<dir>]

   <score> is a repo path (MusicXML, MXL, MIDI or a .sg.json graph). Writes <out>/<name>.<config>.svg (default
   tests/engrave/out/layout/): the score as engrave/svg.js draws it - the same backend the renderer will use, glyphs at
   the metrics' scale (G4c; the G4b review R7 found this view's own outline drawing 1.44 times too large, so it no
   longer draws anything itself) - and with --boxes every object's box, the system bands, the measure boxes and the
   columns over it, so spacing and collisions can be seen. */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const E = require(path.join(REPO, 'engrave', 'index.js'));

/* the boxes of the layout, as an overlay (thin lines in colours of their own) */
function boxesOf(eng) {
  const o = ['<g class="layout-boxes" fill="none" stroke-width="0.03">'];
  const r = v => Math.round(v * 100) / 100;
  eng.systems.forEach(s => o.push('<rect x="' + s.box[0] + '" y="' + s.box[1] + '" width="' + r(s.box[2] - s.box[0]) + '" height="' + r(s.box[3] - s.box[1]) + '" stroke="#e0b040"/>'));
  eng.measures.forEach(m => {
    const s = eng.systems[m.system];
    o.push('<rect x="' + m.x + '" y="' + s.box[1] + '" width="' + m.w + '" height="' + r(s.box[3] - s.box[1]) + '" stroke="#9cf"/>');
    m.columns.forEach(c => o.push('<line x1="' + c.x + '" y1="' + s.box[1] + '" x2="' + c.x + '" y2="' + s.box[3] + '" stroke="' + (c.time ? '#f99' : '#c9f') + '"/>'));
  });
  eng.objects.forEach(b => o.push('<rect x="' + b.box[0] + '" y="' + b.box[1] + '" width="' + r(b.box[2] - b.box[0]) + '" height="' + r(b.box[3] - b.box[1]) + '" stroke="#f0a" stroke-width="0.02"/>'));
  const hard = eng.diagnostics.filter(x => x.code === 'HARD_VIOLATION');
  if (hard.length) o.push('<text x="1" y="' + (eng.pages[0].h - 0.5) + '" font-size="0.9" fill="#c00" stroke="none" font-family="sans-serif">' + hard.length + ' hard violations: ' +
    hard.slice(0, 4).map(h => h.detail).join('; ').replace(/[<&]/g, '') + '</text>');
  o.push('</g>');
  return o.join('\n');
}

function svgOf(eng, plan, opts) {
  let s = E.svg(eng, plan);
  /* a white page behind, and the boxes over it when asked */
  s = s.replace(/(<svg[^>]*>)/, '$1\n<rect x="0" y="0" width="' + eng.pages[0].w + '" height="' + eng.pages[0].h + '" fill="#fff"/>');
  if (opts && opts.boxes) s = s.replace(/<\/svg>$/, boxesOf(eng) + '\n</svg>');
  return s;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('usage: layout-view.js <score> [--phone] [--width=<sp>] [--boxes] [--out=<dir>]'); process.exit(2); }
  const flag = n => args.find(a => a === '--' + n || a.startsWith('--' + n + '='));
  const val = n => { const a = flag(n); return a && a.indexOf('=') > 0 ? a.slice(a.indexOf('=') + 1) : null; };
  const abs = path.resolve(REPO, file);
  let graph;
  if (/\.sg\.json$/.test(abs)) graph = SG.parse(fs.readFileSync(abs, 'utf8'));
  else {
    const r = await SG.importFile(new Uint8Array(fs.readFileSync(abs)), { name: path.basename(abs), scoreId: 'view' });
    if (!r.ok) { console.error('does not open:', file); process.exit(1); }
    graph = r.graph;
  }
  const cfg = { breakpoint: flag('phone') ? 'phone' : 'desktop' };
  if (val('width')) cfg.width = +val('width');
  const plan = E.plan(graph);
  const eng = E.layout.engrave(plan, cfg);
  const out = path.resolve(REPO, val('out') || 'tests/engrave/out/layout');
  fs.mkdirSync(out, { recursive: true });
  const name = path.basename(abs).replace(/\.(musicxml|xml|mxl|mid|sg\.json)$/i, '') + '.' + eng.config.breakpoint + '-' + eng.config.width + '.svg';
  fs.writeFileSync(path.join(out, name), svgOf(eng, plan, { boxes: !!flag('boxes') }));
  console.log(path.relative(REPO, path.join(out, name)).replace(/\\/g, '/'), eng.systems.length + ' systems', eng.systems.map(s => s.measures.length).join(','),
    eng.diagnostics.length + ' diagnostics');
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { svgOf, boxesOf };
