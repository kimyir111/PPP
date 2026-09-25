#!/usr/bin/env node
/* MX-1 task 4: how is each committed octave line encoded? (docs/CURRENT_STATE.md issue 3, decision D-1)

     node tests/scoregraph/tools/ottava-audit.js [--json out.json]

   MusicXML's <pitch> is the pitch that sounds, and <octave-shift type="down"> is an 8va ("a treble clef line noted
   with 8va will be indicated with an octave-shift down from the pitch data indicated in the notes"). A file can still
   be encoded the other way - the printed pitch in <pitch> - and PPP, which now reads every file the MusicXML way, would
   then play that passage an octave off. This reads every committed MusicXML/MXL file that has an octave line and weighs
   the two readings for each one with two pieces of evidence from the file itself:

     page   where the notes under the line would be printed. Read as sounding, the page shows <pitch> - shift; read
            as written, it shows <pitch>. An engraver writes an 8va to bring notes back to the staff, so the reading
            that puts them nearer the staff is the plausible one (mean diatonic steps outside the staff, by clef).
     joins  the melodic step into and out of each line (the outer voice of the staff the line is on, within two bars):
            read as sounding, a line changes nothing in what sounds; read as written, the notes under it sound an
            octave away. A melody does not usually leap an octave at the exact place a line starts and stops.

   A verdict needs both to agree; otherwise it says "unclear" and the numbers are there to look at. The G0 hold-out
   references are audited like the others and never named (G0 rule): they are reported as a count only.
   Notes under the line are counted the way the app reads the line (Score.finalize: closed lines only, on the staff
   the line names, or on every staff when it names none), which is how issue 3 counted 30 files and 2,229 notes. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

/* the text of a MusicXML file, or of the score inside an .mxl (a zip: stored or deflated entries) */
function xmlText(buf) {
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return buf.toString('utf8');
  let out = '';
  for (let i = 0; i + 30 <= buf.length;) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString('utf8');
    const start = i + 30 + nlen + xlen;
    const data = buf.slice(start, start + size);
    if (/\.(xml|musicxml)$/i.test(name) && !/^META-INF/i.test(name)) out += method === 8 ? zlib.inflateRawSync(data).toString('utf8') : data.toString('utf8');
    i = start + size;
  }
  return out;
}

const DI = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const PITCH_RE = /^([A-G])(#{0,3}|b{0,3})(-?\d+)$/;
const deg = p => { const m = PITCH_RE.exec(p || ''); return m ? (+m[3]) * 7 + DI[m[1]] : null; };
const midiOf = p => SG.pitch.midi({ step: p[0], alter: (p.match(/#/g) || []).length - (p.match(/b/g) || []).length, oct: +PITCH_RE.exec(p)[3] });
/* bottom and top line of a staff, as diatonic steps (C4 = 28) */
const STAFF = { treble: [30, 38], bass: [18, 26], alto: [24, 32], tenor: [22, 30], percussion: [30, 38] };
const outside = (d, clef) => { const s = STAFF[clef] || STAFF.treble; return d > s[1] ? d - s[1] : d < s[0] ? s[0] - d : 0; };
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r2 = v => (v == null ? null : Math.round(v * 100) / 100);

function positions(score) {
  let q = 0;
  const byNo = {};
  score.measures.forEach(mm => { mm.startQ = q; q += mm.lenQ; byNo[mm.number] = mm; });
  score.notes.forEach(n => { const mm = byNo[n.m]; n.abs = (mm ? mm.startQ : 0) + n.b; });
  return byNo;
}
function clefAt(byNo, n) {
  const mm = byNo[n.m];
  const staffNo = n.staff || 1;
  let c = (mm && mm.clefs && mm.clefs[staffNo]) || (staffNo === 1 ? 'treble' : 'bass');
  ((mm && mm.clefChanges) || []).forEach(ch => { if ((ch.staff || 1) === staffNo && ch.b <= n.b + 1e-6) c = ch.clef; });
  return c;
}

async function audit(rel) {
  const buf = fs.readFileSync(path.join(REPO, rel));
  const text = xmlText(buf);
  const software = (/<software>([^<]*)<\/software>/.exec(text) || [])[1] || null;
  const r = await SG.importFile(new Uint8Array(buf), { name: path.basename(rel), scoreId: 'mx1-audit' });
  if (!r.ok) return { rel, error: r.code };
  /* the graph's own lines (concert pitch; shift +1 = 8va) */
  const lines = [];
  r.graph.parts.forEach(part => part.spanners.filter(s => s.type === 'ottava').forEach(s => lines.push(s.shift)));
  const score = SG.legacy.toScore(r.graph, { name: rel, id: 'mx1' });
  const byNo = positions(score);
  const startOf = (m, b) => (byNo[m] ? byNo[m].startQ : 0) + (+b || 0);
  /* where each line is and which staff it is read on: the app's Score (toScore keeps the lines of the part the app
     plays, in the graph's order, and drops a line that never stops). What it does to the pitch - sounding minus
     written, +12 for an 8va - is the graph's own shift, so this audit does not depend on how the app signs it. */
  const gi = r.graph.parts.findIndex(p => p.staves.length >= 2);
  const piano = r.graph.parts[gi >= 0 ? gi : r.graph.parts.length - 1];
  const gLines = piano.spanners.filter(s => s.type === 'ottava' && s.to);
  if (gLines.length !== (score.ottavas || []).length) return { rel, error: 'lines ' + gLines.length + ' vs ' + (score.ottavas || []).length };
  const ovs = (score.ottavas || []).map((ov, i) => ({ a: startOf(ov.m, ov.b), z: startOf(ov.endM, ov.endB), staff: ov.staff,
    semi: 12 * gLines[i].shift }));
  const notes = score.notes.filter(n => !n.rest && n.p);
  /* the app's reading: the latest line that starts at or before the note, on the note's staff or on every staff */
  const shiftOf = n => {
    let best = 0, from = -Infinity;
    ovs.forEach(o => {
      if (o.staff != null && o.staff !== (n.staff || 1)) return;
      if (n.abs < o.a - 1e-6 || n.abs >= o.z - 1e-6 || o.a < from) return;
      best = o.semi; from = o.a;
    });
    return best;
  };
  const under = notes.filter(n => shiftOf(n) !== 0);
  /* page evidence: on the staff each line belongs to (a line that names no staff: the staff the note is on) */
  const pageS = [], pageW = [];
  under.forEach(n => {
    const d = deg(n.p), oct = shiftOf(n) / 12, clef = clefAt(byNo, n);
    pageS.push(outside(d - 7 * oct, clef));
    pageW.push(outside(d, clef));
  });
  /* join evidence: the outer voice (top for an 8va, bottom for an 8vb) of the line's staff, into and out of each line */
  const joinS = [], joinW = [];
  ovs.forEach(o => {
    const staffNo = o.staff != null ? o.staff : 1;
    const onStaff = notes.filter(n => (n.staff || 1) === staffNo);
    const onsets = new Map();
    onStaff.forEach(n => {
      const k = Math.round(n.abs * 1e4);
      const cur = onsets.get(k);
      const pick = o.semi > 0 ? (x, y) => (midiOf(x.p) >= midiOf(y.p) ? x : y) : (x, y) => (midiOf(x.p) <= midiOf(y.p) ? x : y);
      onsets.set(k, cur ? pick(cur, n) : n);
    });
    const seq = Array.from(onsets.values()).sort((x, y) => x.abs - y.abs);
    const inside = seq.filter(n => n.abs >= o.a - 1e-6 && n.abs < o.z - 1e-6);
    if (!inside.length) return;
    const before = seq.filter(n => n.abs < o.a - 1e-6 && n.abs >= o.a - 8).pop();
    const after = seq.filter(n => n.abs >= o.z - 1e-6 && n.abs < o.z + 8)[0];
    const first = inside[0], last = inside[inside.length - 1];
    [[before, first], [last, after]].forEach(([x, y]) => {
      if (!x || !y) return;
      const inX = x === first || x === last, px = midiOf(x.p), py = midiOf(y.p);
      const s = Math.abs(px - py);
      const w = Math.abs((inX ? px + o.semi : px) - (inX ? py : py + o.semi));
      joinS.push(s); joinW.push(w);
    });
  });
  const page = { sounding: r2(mean(pageS)), written: r2(mean(pageW)) };
  const joins = { sounding: median(joinS), written: median(joinW), n: joinS.length };
  const favours = (s, w, margin) => (s == null || w == null ? 0 : s + margin < w ? 1 : w + margin < s ? -1 : 0);
  const fp = favours(page.sounding, page.written, 0.5), fj = favours(joins.sounding, joins.written, 1.5);
  /* both agree; one says so and the other cannot tell; or they disagree / neither can tell */
  const verdict = fp === 1 && fj === 1 ? 'sounding' : fp === -1 && fj === -1 ? 'written'
    : fp >= 0 && fj >= 0 && fp + fj === 1 ? 'sounding (one sign)' : fp <= 0 && fj <= 0 && fp + fj === -1 ? 'written (one sign)' : 'unclear';
  const range = a => (a.length ? a.reduce((m, n) => (midiOf(n.p) < midiOf(m.p) ? n : m)).p + '-' + a.reduce((m, n) => (midiOf(n.p) > midiOf(m.p) ? n : m)).p : '');
  return {
    rel, software, lines: lines.length, shift: Array.from(new Set(lines.map(s => (s > 0 ? '8va' : '8vb') + (Math.abs(s) === 2 ? '(15)' : '')))).join('+'),
    notes: under.length, range: range(under), staves: Array.from(new Set(ovs.map(o => (o.staff == null ? 'any' : o.staff)))).join('+'),
    page, joins, verdict
  };
}

/* every committed MusicXML/MXL file with an octave line, as repository paths */
function ottavaFiles() {
  let tracked;
  try { tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n'); } catch (e) {
    /* a tree with no git (an archive of another commit): the files that are there, less what is never committed */
    tracked = [];
    const SKIP = new Set(['node_modules', '.git', 'tmp', 'out', '.cache', '__pycache__', 'data']);
    (function walk(d) {
      fs.readdirSync(d, { withFileTypes: true }).forEach(x => {
        if (SKIP.has(x.name)) return;
        const p = path.join(d, x.name);
        if (x.isDirectory()) walk(p); else tracked.push(path.relative(REPO, p).split(path.sep).join('/'));
      });
    })(REPO);
  }
  tracked = tracked.filter(f => /\.(musicxml|xml|mxl)$/i.test(f)).sort();
  return tracked.filter(rel => {
    const p = path.join(REPO, rel);
    if (!fs.existsSync(p)) return false;
    const text = xmlText(fs.readFileSync(p));
    return /<octave-shift\b/.test(text) && /<score-partwise|<score-timewise/.test(text);
  });
}
/* the G0 hold-out references: checked like the others, never named */
function holdouts() {
  const refs = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'bench', 'corpus', 'references.json'), 'utf8'));
  return new Set(refs.references.filter(x => x.holdout).map(x => x.path));
}

async function main() {
  const holdout = holdouts();
  const rows = [];
  for (const rel of ottavaFiles()) {
    const row = await audit(rel);
    row.holdout = holdout.has(rel);
    row.scope = /^(catalog|samples)\//.test(rel) ? 'catalogue' : 'fixture';
    rows.push(row);
  }
  const shown = rows.filter(r => !r.holdout);
  const fmt = r => [r.rel, r.shift, r.staves, r.notes, r.range, r.page.sounding + ' / ' + r.page.written,
    r.joins.sounding + ' / ' + r.joins.written + ' (' + r.joins.n + ')', r.verdict, r.software || ''].join(' | ');
  console.log('file | line | staff | notes | range (<pitch>) | page: steps off the staff, sounding / written | joins: median step, sounding / written (n) | verdict | software');
  shown.forEach(r => console.log(fmt(r)));
  const tally = list => list.reduce((o, r) => { o[r.verdict] = (o[r.verdict] || 0) + 1; return o; }, {});
  const ho = rows.filter(r => r.holdout);
  if (ho.length) console.log('G0 hold-out files (not named): ' + ho.length + ' files, ' + ho.reduce((a, r) => a + r.notes, 0) + ' notes, ' + JSON.stringify(tally(ho)));
  const cat = rows.filter(r => r.scope === 'catalogue');
  console.log('\ncatalogue and samples: ' + cat.length + ' files, ' + cat.reduce((a, r) => a + r.notes, 0) + ' notes under a line; verdicts ' + JSON.stringify(tally(cat)));
  const fx = rows.filter(r => r.scope === 'fixture');
  console.log('fixtures: ' + fx.length + ' files, ' + fx.reduce((a, r) => a + r.notes, 0) + ' notes; verdicts ' + JSON.stringify(tally(fx)));
  const out = arg('--json');
  if (out) fs.writeFileSync(out, JSON.stringify(rows.map(r => (r.holdout ? { holdout: true, notes: r.notes, verdict: r.verdict } : r)), null, 1) + '\n');
}

module.exports = { xmlText, ottavaFiles, holdouts, audit };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
