/* G04 §20, §21.3, A27: the EngravedScore hash of every E fixture, R suite score and PPP transcription, at the desktop
   and phone screen configs and the print config (G4-E8, G4e Fixer R2: print's DP line-breaking and pagination had no
   committed regression baseline - the same mechanism that already covers the screen configs covers print too, since
   createEngraver(plan).layout({mode:'print'}) returns the same shape of EngravedScore, just with `pages`) -
   committed, so the same graphs lay out to the same geometry on every machine (Windows here, Linux in CI) - and the
   hash of each one's NotationPlan (the G4d-1a fixer, R8).

     node tests/engrave/tools/layout-hashes.js           compare with tests/engrave/baselines/layout-hashes.json (exit 1 on a difference)
     node tests/engrave/tools/layout-hashes.js --write   write that file (after an intended layout change, with the reason in the commit)

   A difference names the score and config; tests/engrave/tools/layout-view.js draws both sides for a look.

   G4-D1a-1: every change to what the layout outputs moves its version (engr/N, engrave/layout.js VERSION), and every change
   to what plan() outputs moves PLAN_VERSION (engrave/plan.js). --write checks both against a reference and refuses - exit 1,
   nothing written - hashes that differ from it under the version it has:
     the reference is the committed file at the branch's merge base with origin/main; its plan hashes, where that file does
     not hold them, are computed by that commit's own engrave/ (git archive) on the same graphs;
     when there is no such file to compare with - no git, no origin/main, or a merge base from before the file (a stale
     origin/main) - it FAILS CLOSED: the reference is the committed file here, so a write goes through only where the
     version moved from it (or nothing differs). It never writes after saying it could not check (the G4d-1a review R8). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('../helpers.js');
const { REPO, E } = H;

const FILE = path.join(REPO, 'tests', 'engrave', 'baselines', 'layout-hashes.json');
const FILE_REL = 'tests/engrave/baselines/layout-hashes.json';
const CONFIGS = { desktop: { breakpoint: 'desktop' }, phone: { breakpoint: 'phone' }, print: { mode: 'print' } };

async function inputs() {
  const out = [];
  const d = path.join(REPO, 'tests', 'engrave', 'fixtures', 'e');
  for (const f of fs.readdirSync(d).filter(x => x.endsWith('.musicxml')).sort()) out.push(['e/' + f, await H.graphOf('tests/engrave/fixtures/e/' + f)]);
  const corpus = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'engrave', 'corpus.json'), 'utf8'));
  for (const rel of corpus.files) out.push([rel, await H.graphOf(rel)]);
  H.goldenGraphs().forEach(([k, g]) => out.push([k, g]));
  return out;
}

const sortKeys = o => { const s = {}; Object.keys(o).sort().forEach(k => { s[k] = o[k]; }); return s; };
/* -> {hashes: {score: {config: layout hash}}, plans: {score: plan hash}} */
async function computeAll(order, engrave) {
  const X = engrave || E;
  const list = await inputs();
  if (order === 'reverse') list.reverse();
  const hashes = {}, plans = {};
  list.forEach(([id, g]) => {
    const p = X.plan(g);
    plans[id] = X.layoutHash(p);
    const eng = X.layout.createEngraver(p);
    hashes[id] = {};
    Object.keys(CONFIGS).forEach(c => { hashes[id][c] = X.layoutHash(eng.layout(CONFIGS[c])); });
  });
  return { hashes: sortKeys(hashes), plans: sortKeys(plans) };
}
async function compute(order) { return (await computeAll(order)).hashes; }

function diff(got, want) {
  const bad = [];
  Object.keys(want).forEach(k => {
    if (!got[k]) { bad.push(k + ': missing'); return; }
    Object.keys(want[k]).forEach(c => { if (got[k][c] !== want[k][c]) bad.push(k + ' ' + c + ': ' + got[k][c] + ' != ' + want[k][c]); });
  });
  Object.keys(got).filter(k => !want[k]).forEach(k => bad.push(k + ': not in the baseline'));
  return bad;
}
function diffPlans(got, want) {
  const bad = [];
  Object.keys(want).forEach(k => { if (got[k] !== want[k]) bad.push(k + ': plan ' + (got[k] || 'missing') + ' != ' + want[k]); });
  Object.keys(got).filter(k => !(k in want)).forEach(k => bad.push(k + ': plan not in the reference'));
  return bad;
}

const git = (args, opts) => execFileSync('git', args, Object.assign({ cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }, opts || {}));
/* the committed file at a commit, or null */
function fileAt(commit) { try { return JSON.parse(git(['show', commit + ':' + FILE_REL])); } catch (e) { return null; } }
/* the PLAN_VERSION engrave/plan.js has at a commit, or null */
function planVersionAt(commit) {
  try { const m = /const PLAN_VERSION = '([^']+)'/.exec(git(['show', commit + ':engrave/plan.js'])); return m ? m[1] : null; } catch (e) { return null; }
}
/* the plan hashes that commit's own engrave/ (and scoregraph/) give the same graphs, or null */
async function plansAt(commit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-plans-'));
  try {
    /* that commit's engrave/ and scoregraph/, file by file (no tar: the same on every OS) */
    git(['ls-tree', '-r', '--name-only', commit, 'engrave', 'scoregraph']).split('\n').filter(Boolean).forEach(rel => {
      const to = path.join(dir, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, execFileSync('git', ['show', commit + ':' + rel], { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 }));
    });
    const X = require(path.join(dir, 'engrave', 'index.js'));
    const out = {};
    (await inputs()).forEach(([id, g]) => { out[id] = X.layoutHash(X.plan(g)); });
    return sortKeys(out);
  } catch (e) { return null; } finally {
    Object.keys(require.cache).forEach(k => { if (k.startsWith(dir)) delete require.cache[k]; });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* what --write compares with: the merge base's file, or - failing closed - the committed file here */
function reference() {
  let base = null;
  try { base = git(['merge-base', 'HEAD', 'origin/main']).trim(); } catch (e) { base = null; }
  if (base) {
    const file = fileAt(base);
    if (file) return { name: 'the merge base ' + base.slice(0, 7) + ' with origin/main', commit: base, file: file };
    console.log('the merge base ' + base.slice(0, 7) + ' with origin/main has no ' + FILE_REL + ' (a stale origin/main?): it cannot be compared with');
  } else console.log('no merge base with origin/main (no git, or no origin/main): it cannot be compared with');
  const cur = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
  console.log('failing closed: checking against the committed ' + FILE_REL + ' - a changed hash is written only under a moved version');
  return { name: 'the committed file', commit: null, file: cur, closed: true };
}
/* configs a merge base can be silent about: it predates a config being added (G4-E8 - print, added on this branch,
   is not yet in origin/main's file). Without this, a change to that config's own code would slip past the guard
   with no version bump for as long as the branch carrying it is unmerged, because diff() only ever checks the keys
   the reference already has. So, in addition to the merge-base diff, also fail closed against whatever is already
   sitting in the committed file on disk (the one --write is about to overwrite) for any (score, config) pair the
   merge-base reference does not know about yet - same rule, same version gate, just a second source of "before". */
function diffAgainstNewConfigs(got, refHashes) {
  const bad = [];
  if (!fs.existsSync(FILE)) return bad;
  const onDisk = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (onDisk.version !== E.layout.VERSION) return bad; // a version mismatch is reported separately, not double-counted here
  Object.keys(onDisk.hashes || {}).forEach(id => {
    Object.keys(onDisk.hashes[id]).forEach(c => {
      const knownToRef = refHashes[id] && refHashes[id][c] !== undefined;
      if (knownToRef) return; // the merge-base diff above already covers this one
      if (got[id] && got[id][c] !== undefined && got[id][c] !== onDisk.hashes[id][c])
        bad.push(id + ' ' + c + ': ' + got[id][c] + ' != ' + onDisk.hashes[id][c] + ' (committed on disk, ahead of the merge base)');
    });
  });
  return bad;
}
/* -> the reasons to refuse the write (none: write) */
async function guard(got, plans, ref) {
  const out = [];
  const f = ref.file;
  if (!f) {
    if (ref.closed) out.push('there is no committed ' + FILE_REL + ' and no merge base to compare with: nothing proves the versions moved');
    return out;
  }
  const dl = diff(got, f.hashes || {});
  if (dl.length && f.version === E.layout.VERSION)
    out.push(dl.length + ' layout hashes differ from ' + ref.name + ' under the same version ' + f.version + ': an output change moves the version (G4-D1a-1) - bump VERSION in engrave/layout.js');
  if (!ref.closed) {
    const dn = diffAgainstNewConfigs(got, f.hashes || {});
    if (dn.length)
      out.push(dn.length + ' layout hashes differ from the committed ' + FILE_REL + ' under the same version ' + E.layout.VERSION +
        ' for a config the merge base does not have yet: an output change still moves the version (G4-D1a-1) - bump VERSION in engrave/layout.js');
  }
  const pv = f.planVersion || (ref.commit ? planVersionAt(ref.commit) : null);
  if (pv !== E.PLAN_VERSION) {
    if (pv === null) out.push('the plan version of ' + ref.name + ' is not known: cannot tell whether PLAN_VERSION moved (fail closed)');
  } else {
    const want = f.plans || (ref.commit ? await plansAt(ref.commit) : null);
    if (!want) out.push('the plan hashes of ' + ref.name + ' are not known: cannot tell whether plan() output changed under ' + pv + ' (fail closed)');
    else {
      const dp = diffPlans(plans, want);
      if (dp.length) out.push(dp.length + ' plans differ from ' + ref.name + ' under the same version ' + pv + ': an output change moves the version (G4-D1a-1) - bump PLAN_VERSION in engrave/plan.js');
    }
  }
  return out;
}

async function main() {
  const { hashes: got, plans } = await computeAll();
  if (process.argv.indexOf('--write') > 0) {
    const ref = reference();
    const why = await guard(got, plans, ref);
    if (why.length) {
      why.forEach(w => console.error('REFUSED: ' + w));
      console.error('nothing written (' + path.relative(REPO, FILE) + ')');
      process.exit(1);
    }
    fs.writeFileSync(FILE, JSON.stringify({ version: E.layout.VERSION, planVersion: E.PLAN_VERSION, configs: CONFIGS, hashes: got, plans: plans }, null, 1) + '\n');
    console.log('wrote ' + Object.keys(got).length + ' scores x ' + Object.keys(CONFIGS).length + ' configs and their plans to ' + path.relative(REPO, FILE) +
      ' (checked against ' + ref.name + ')');
    return;
  }
  const want = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const bad = diff(got, want.hashes).concat(want.plans ? diffPlans(plans, want.plans) : ['the file holds no plan hashes']);
  if (want.version !== E.layout.VERSION) bad.push('version ' + want.version + ' != ' + E.layout.VERSION);
  if (want.planVersion !== E.PLAN_VERSION) bad.push('planVersion ' + want.planVersion + ' != ' + E.PLAN_VERSION);
  console.log(Object.keys(got).length + ' scores x ' + Object.keys(CONFIGS).length + ' configs and their plans: ' + (bad.length ? bad.length + ' DIFFER' : 'all the committed hashes'));
  bad.slice(0, 20).forEach(b => console.log('  ' + b));
  process.exit(bad.length ? 1 : 0);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { FILE, CONFIGS, inputs, compute, computeAll, diff, diffPlans, guard };
