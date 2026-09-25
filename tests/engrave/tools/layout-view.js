/* G04 §20, G4b: a development view of an EngravedScore - never loaded by the app.

     node tests/engrave/tools/layout-view.js <score> [--phone] [--width=<sp>] [--boxes] [--out=<dir>]

   <score> is a repo path (MusicXML, MXL, MIDI or a .sg.json graph). Writes <out>/<name>.<config>.svg (default
   tests/engrave/out/layout/): the layout's objects drawn at their coordinates - Bravura outlines from the pinned
   font data for glyphs, rectangles for stems, ledger lines and barlines, the staff lines, volta brackets - and with
   --boxes every object's box, the system bands and the measure boxes, so spacing and collisions can be seen.
   G4c-G4f draw the score for real (engrave/svg.js); this is only a picture of the geometry. */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const E = require(path.join(REPO, 'engrave', 'index.js'));

const PX = 10;   /* px per staff space */

/* Bravura outlines from the pinned VexFlow font data, as SVG path data in staff spaces (y down), origin at 0,0 */
let OUTLINES = null;
function outline(name) {
  if (!OUTLINES) {
    const m = require(path.join(REPO, 'vendor', 'vexflow-4.2.3.js'));
    const VF = m.Flow || m;
    const font = VF.getMusicFontStack()[0];
    OUTLINES = { glyphs: font.getGlyphs(), k: 4 / font.getResolution(), cache: new Map() };
  }
  if (OUTLINES.cache.has(name)) return OUTLINES.cache.get(name);
  const g = OUTLINES.glyphs[name];
  if (!g || !g.o) { OUTLINES.cache.set(name, null); return null; }
  const t = String(g.o).trim().split(/\s+/), k = OUTLINES.k;
  const P = (x, y) => (+x * k).toFixed(3) + ' ' + (-y * k).toFixed(3);
  const out = [];
  for (let i = 0; i < t.length;) {
    const c = t[i++];
    if (c === 'm') { out.push('M' + P(t[i], t[i + 1])); i += 2; }
    else if (c === 'l') { out.push('L' + P(t[i], t[i + 1])); i += 2; }
    /* VexFlow writes the end point first, then the control point(s) */
    else if (c === 'q') { out.push('Q' + P(t[i + 2], t[i + 3]) + ' ' + P(t[i], t[i + 1])); i += 4; }
    else if (c === 'b') { out.push('C' + P(t[i + 2], t[i + 3]) + ' ' + P(t[i + 4], t[i + 5]) + ' ' + P(t[i], t[i + 1])); i += 6; }
    else if (c === 'z') out.push('Z');
  }
  const d = out.join('');
  OUTLINES.cache.set(name, d);
  return d;
}

const COLORS = { notehead: '#000', rest: '#000', accidental: '#1a4fb0', dot: '#000', stem: '#555', flag: '#555', ledger: '#000',
  clef: '#6b2fa0', keysig: '#1a4fb0', timesig: '#6b2fa0', barline: '#000', staff: '#000', volta: '#0a7d45' };

function svgOf(eng, opts) {
  const pg = eng.pages[0];
  const W = pg.w * PX, H = pg.h * PX;
  const o = [];
  o.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W.toFixed(0) + '" height="' + H.toFixed(0) + '" viewBox="0 0 ' + pg.w + ' ' + pg.h + '">');
  o.push('<rect x="0" y="0" width="' + pg.w + '" height="' + pg.h + '" fill="#fff"/>');
  if (opts.boxes) {
    eng.systems.forEach(s => o.push('<rect x="' + s.box[0] + '" y="' + s.box[1] + '" width="' + (s.box[2] - s.box[0]) + '" height="' + (s.box[3] - s.box[1]) +
      '" fill="#fff7e0" stroke="#e0b040" stroke-width="0.05"/>'));
    eng.measures.forEach(m => {
      const s = eng.systems[m.system];
      o.push('<rect x="' + m.x + '" y="' + s.box[1] + '" width="' + m.w + '" height="' + (s.box[3] - s.box[1]) + '" fill="none" stroke="#9cf" stroke-width="0.04"/>');
      m.columns.forEach(c => o.push('<line x1="' + c.x + '" y1="' + s.box[1] + '" x2="' + c.x + '" y2="' + s.box[3] + '" stroke="' + (c.time ? '#f99' : '#c9f') + '" stroke-width="0.03"/>'));
      o.push('<text x="' + (m.x + 0.2) + '" y="' + (s.box[1] + 0.8) + '" font-size="0.9" fill="#48a" font-family="sans-serif">' + m.number + '</text>');
    });
  }
  eng.objects.forEach(ob => {
    const c = COLORS[ob.kind] || '#c00';
    const b = ob.box;
    if (ob.kind === 'staff') {
      const sp = ob.space || 1;
      for (let i = 0; i < ob.lines; i++) {
        const y = b[1] + 0.065 * sp + i * sp;
        o.push('<line x1="' + b[0] + '" y1="' + y.toFixed(3) + '" x2="' + b[2] + '" y2="' + y.toFixed(3) + '" stroke="#000" stroke-width="' + (0.13 * sp).toFixed(3) + '"/>');
      }
      return;
    }
    if (ob.kind === 'volta') {
      o.push('<path d="M' + b[0] + ' ' + (ob.start ? b[3] : b[1]) + 'V' + b[1] + 'H' + b[2] + (ob.open ? '' : 'V' + b[3]) + '" fill="none" stroke="#000" stroke-width="0.13"/>');
      if (ob.label) o.push('<text x="' + (b[0] + 0.4) + '" y="' + (b[1] + 1.4) + '" font-size="1.3" font-family="serif">' + ob.label.replace(/[<&]/g, '') + '</text>');
      return;
    }
    if (ob.kind === 'brace') {
      /* a plain curly brace through the box */
      const x0 = b[0], x1 = b[2], y0 = b[1], y1 = b[3], ym = (y0 + y1) / 2, xm = (x0 + x1) / 2;
      o.push('<path d="M' + x1 + ' ' + y0 + 'C' + x0 + ' ' + (y0 + 1) + ' ' + x1 + ' ' + (ym - 1) + ' ' + x0 + ' ' + ym + 'C' + x1 + ' ' + (ym + 1) + ' ' + x0 + ' ' + (y1 - 1) + ' ' + x1 + ' ' + y1 +
        '" fill="none" stroke="#000" stroke-width="0.35"/>');
      return;
    }
    const d = ob.glyph ? outline(ob.glyph) : null;
    if (d) {
      const s = ob.scale || 1;
      o.push('<path transform="translate(' + ob.origin[0] + ' ' + ob.origin[1] + ')' + (s !== 1 ? ' scale(' + s + ')' : '') + '" d="' + d + '" fill="' + c + '"/>');
    } else {
      o.push('<rect x="' + b[0] + '" y="' + b[1] + '" width="' + Math.max(0.01, b[2] - b[0]).toFixed(2) + '" height="' + Math.max(0.01, b[3] - b[1]).toFixed(2) + '" fill="' + c + '"/>');
    }
    if (opts.boxes) o.push('<rect x="' + b[0] + '" y="' + b[1] + '" width="' + (b[2] - b[0]).toFixed(2) + '" height="' + (b[3] - b[1]).toFixed(2) + '" fill="none" stroke="#f0a" stroke-width="0.02"/>');
  });
  const hard = eng.diagnostics.filter(x => x.code === 'HARD_VIOLATION');
  if (hard.length) o.push('<text x="1" y="' + (pg.h - 0.5) + '" font-size="0.9" fill="#c00" font-family="sans-serif">' + hard.length + ' hard violations: ' +
    hard.slice(0, 4).map(h => h.detail).join('; ').replace(/[<&]/g, '') + '</text>');
  o.push('</svg>');
  return o.join('\n');
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
  const eng = E.layout.engrave(E.plan(graph), cfg);
  const out = path.resolve(REPO, val('out') || 'tests/engrave/out/layout');
  fs.mkdirSync(out, { recursive: true });
  const name = path.basename(abs).replace(/\.(musicxml|xml|mxl|mid|sg\.json)$/i, '') + '.' + eng.config.breakpoint + '-' + eng.config.width + '.svg';
  fs.writeFileSync(path.join(out, name), svgOf(eng, { boxes: !!flag('boxes') }));
  console.log(path.relative(REPO, path.join(out, name)).replace(/\\/g, '/'), eng.systems.length + ' systems', eng.systems.map(s => s.measures.length).join(','),
    eng.diagnostics.length + ' diagnostics');
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { svgOf, outline };
