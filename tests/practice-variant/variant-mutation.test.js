/* Mutation check of practice/variant.js (G11c-0). Each planted defect is made in a copy of the module (outside the repository, its relative requires pointed at this
   tree) and must make at least one of the checks of variant-checks.js fail; the copy without a defect must pass them all. A check that throws is a check that fails.
   node --test tests/practice-variant/variant-mutation.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { CHECKS, setFast } = require('./variant-checks.js');
setFast(true);

const SRC = fs.readFileSync(path.join(REPO, 'practice', 'variant.js'), 'utf8').replace(/\r\n/g, '\n');

/* [id, what it breaks, the text to find (exactly once), what to put there] */
const MUTANTS = [
  ['M01', 'a tie or slur across a seam is kept', "if (!inside) { if (sp.type === 'tie') info.tiesCut++; else if (sp.type === 'slur') info.slursCut++; else info.otherCut++; }", 'if (!inside) { return; }'],
  ['M02', 'the base\'s pedal and 8va lines are not clipped', "        if (!POSITION_SPANS.has(sp.type)) return;\n        const a = bW(sp.from)", "        return;\n        const a = bW(sp.from)"],
  ['M03', 'the clef is not put back at the right seam', "if (hasAfter && !nextHas && endState && now && !sameClef(now, endState)) add(endState, bm[hi + 1], '0');", 'void 0;'],
  ['M04', 'the clef is not carried in at the left seam', "if (!atStart && startV && !sameClef(before, startV)) add(startV, bm[lo], '0');", 'void 0;'],
  ['M05', 'the base\'s clef changes of the range stay', "bList.filter(cl => bi(cl) >= lo && bi(cl) <= hi).forEach(cl => { d.removeClef(part, cl.id); info.clefsRemoved++; });", 'void 0;'],
  ['M06', 'the range is never widened', 'const WIDEN_MAX = 2;', 'const WIDEN_MAX = 0;'],
  ['M07', 'a seam violation is ignored', 'if (!h.left && !h.right) break;', 'break;'],
  ['M08', 'the variant\'s own hard violations are ignored', "if (h.own > 0) return fail('VARIANT_HARD'", "if (false) return fail('VARIANT_HARD'"],
  ['M09', 'the judge has no margin', 'const JUDGE_MARGIN = 0.25;', 'const JUDGE_MARGIN = -100;'],
  ['M10', 'the judge ignores the direction', "const sign = direction === 'easier' ? 1 : -1;", 'const sign = 1;'],
  ['M11', 'identical bars are not refused', "if (lo > hi) return fail('VARIANT_IDENTICAL'", "if (false) return fail('VARIANT_IDENTICAL'"],
  ['M12', 'the identical ends of a range are replaced too', "    while (lo <= hi && sameList(bSound[lo - lo0], vSound[lo - lo0])) lo++;\n    while (hi >= lo && sameList(bSound[hi - lo0], vSound[hi - lo0])) hi--;", '    void 0;'],
  ['M13', 'the last bar of the range is kept', 'const inRange = new Set(bm.slice(lo, hi + 1));', 'const inRange = new Set(bm.slice(lo, hi));'],
  ['M14', 'one bar too many is copied from the variant', 'return k >= lo && k <= hi; })', 'return k >= lo && k <= hi + 1; })'],
  ['M15', 'bars of other lengths are accepted', 'if (!R.eq(R.parse(bm[i].dur), R.parse(vm[i].dur))) return', 'if (false) return'],
  ['M16', 'only the passage itself is checked for the bars', 'const TIMELINE_MARGIN = 2;', 'const TIMELINE_MARGIN = 0;'],
  ['M17', 'a key change near the passage is not looked at', "if (keysOf(base, barIds(base)) !== keysOf(variant, barIds(variant))) return", 'if (false) return'],
  ['M18', 'the key in force at the passage is not compared', "if ((kb ? kb.fifths + '|' + (kb.mode || '') : '') !== (kv ? kv.fifths + '|' + (kv.mode || '') : '')) return", 'if (false) return'],
  ['M19', 'another meter is accepted', "if (ms(mb) !== ms(mv)) return", 'if (false) return'],
  ['M20', 'the other hand on a staff is accepted', 'if (bs.limb && vs.limb && bs.limb !== vs.limb) return fail(', 'if (false) return fail('],
  ['M21', 'a variant with more staves is accepted', "if (vPart.staves.length > bPart.staves.length) return fail('VARIANT_STAVES'", "if (false) return fail('VARIANT_STAVES'"],
  ['M22', 'copied events carry no source of their own', 'x.prov = provOf(e.prov);', 'void 0;'],
  ['M23', 'the copy does not say what it is', "doc.provenance.sources.push({ id: d.newId('sr'), kind: 'generator', tool: TOOL, version: VERSION, params: params });", 'void 0;'],
  ['M24', 'the variant\'s directions are always added', '|| baseKinds.has(dd.kind)) return;', ') return;'],
  ['M25', 'a variant voice never takes a base voice', 'let pick = pool.find(x => x.label !== undefined && x.label === v.label) || pool[0];', 'let pick = null;'],
  ['M26', 'every hit of the checker is the splice\'s own', 'if (!(inside ? vHits : bHits).has(k))', 'if (true)'],
  ['M27', 'the checker is not asked', "if (bad.length) return { reason: 'VARIANT_NOTATION'", "if (false) return { reason: 'VARIANT_NOTATION'"],
  ['M28', 'the pedal changes of a clipped line are not trimmed', 'if (sp.changes) { sp.changes = changes.filter(ch => R.lt(bW(ch), rs)); if (!sp.changes.length) delete sp.changes; }', 'void 0;'],
  ['M29', 'a splice at the end of the piece reads past it', 'const hasAfter = hi + 1 < n;', 'const hasAfter = true;'],
  ['M30', 'the variant\'s tuplets are left out', 'ns.events = sp.events.map(x => evMap.get(x));', 'return;'],
  ['M31', 'a variant slur across a seam is kept', "else if (sp.type === 'slur') info.variantSlursCut++; return; }", "else if (sp.type === 'slur') info.variantSlursCut++; }"],
  ['M32', 'bad bar numbers are accepted', 'lo0 < 0 || hi0 < lo0 || hi0 >= n', 'hi0 < lo0 || hi0 >= n'],
  ['M33', 'the staff of a note does not count for "the same notes"', "sIdx.get(h.staff || e.staff) + '|'", "'0|'"],
  ['M34', 'the judge looks at the whole request, not the bars that differ', 'const jf = applied.from, jt = applied.to;', 'const jf = lo0, jt = hi0;'],
  ['M35', 'a multi-measure rest over the passage is accepted', "if (bm[i].multiRest && i + bm[i].multiRest - 1 >= lo) return", 'if (false) return'],
  ['M36', 'the words of the tune are lost', 'x.lyrics = clone(words.get(k)); info.lyricsKept++;', 'void 0;'],
  ['M37', 'a refusal has no alternative', 'if (!NO_ALTERNATIVE.has(reason)) {', 'if (false) {']
];

/* a copy of the module with one edit (found exactly once), its requires made absolute */
function load(m) {
  let src = SRC;
  if (m) {
    const n = src.split(m[2]).length - 1;
    if (n !== 1) throw new Error(m[0] + ': anchor found ' + n + ' times: ' + m[2]);
    src = src.replace(m[2], () => m[3]);
  }
  src = src.replace(/require\('\.\.\//g, "require('" + REPO.replace(/\\/g, '/') + '/');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-variant-mut-'));
  const file = path.join(dir, 'variant.js');
  fs.writeFileSync(file, src);
  try { return { V: require(file), dir: dir }; } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
}
const fails = (c, V) => { try { c.fn(V); return false; } catch (e) { return true; } };

/* the checks in order of what they cost (measured in the control run): a defect is found by the cheapest check that notices it, so a run does not pay for the dear ones first */
let ORDER = null;
test('control: the copy without a defect passes every check', () => {
  const { V, dir } = load(null);
  try {
    const cost = [];
    CHECKS.forEach(c => { const t = process.hrtime.bigint(); assert.doesNotThrow(() => c.fn(V), c.name); cost.push([c, Number(process.hrtime.bigint() - t)]); });
    ORDER = cost.sort((a, b) => a[1] - b[1]).map(x => x[0]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

MUTANTS.forEach(m => test(m[0] + ': ' + m[1], () => {
  const { V, dir } = load(m);
  try {
    const killer = (ORDER || CHECKS).find(c => fails(c, V));
    assert.ok(killer, m[0] + ' survived: no check notices that ' + m[1]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}));
