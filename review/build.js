#!/usr/bin/env node
/* ============================================================================
   G9c - the blind-review packet builder (docs/GOALS/G09_CANDIDATES_CRITICS_REPAIR.md, section 12 "G9c - blind review tooling").

     node review/build.js --mode h8|h9 --out <dir> --key-out <dir> [--seed <secret>] [--items items.json] [--single-note-hands] [--list]

   --seed      optional; a SECRET string of at least 20 characters. Omit it and a random one is made. It decides which arrangement
               is X and which is Y and the order of the items, and it is written only to the key file. (A short seed can be guessed
               from the manifest's item order, so short seeds are refused.)
   --out       the packet directory (index.html + manifest.json): what the reviewer gets. MUST be outside every git working tree
               (the repository is refused, and so is any other checkout) - generated packets and keys are never committed.
   --key-out   REQUIRED, the key directory (key.json): NEVER give it to the reviewer. It must not be inside the packet's parent
               directory (nor the packet inside the key's), so that zipping the folder that holds the packet cannot ship the key.
   --items     a JSON list of {file, targetLevel, handProfile} instead of the documented input rule (tests and special reviews).
   --single-note-hands  the G9 arm only (the legacy arm is unchanged): no two-note chord in either hand at ANY stage (candidates `singleNoteHands`,
               docs/GOALS/G09 section 12 "G9 single-note hands"); recorded in key.json, never in the packet.
   --list      print the chosen items and stop (no packet is written).

   Nothing here touches the app or the server; it only reads the repository and writes the two directories above. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const REPO = path.resolve(__dirname, '..');
const BLIND = require('./lib/blind.js');
const NEUTRAL = require('./lib/neutral.js');
const PAGE = require('./lib/page.js');
const SELECT = require('./lib/select.js');

const FORMAT = 'ppp-review-packet/1', KEY_FORMAT = 'ppp-review-key/1';
/* decode.js's strata: G9 counts as fuller/sparser at this note-count ratio, and one arm as missing the level by more at this gap */
const FULLER_RATIO = 1.1, MISS_GAP = 0.1;
const REVIEW_NAME = { h8: 'H-8', h9: 'H-9' };

/* The app's sampled piano (audio/piano, Salamander Yamaha C5, CC BY 3.0), read from the repository at build time and embedded ONCE per
   page as base64 (the page decodes it with atob; it fetches nothing, so it works from disk and inside an Artifact page). The order is
   the app's PIANO.names: one recording every minor third from A0 (MIDI 21). */
const PIANO_NAMES = ['A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4',
  'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8'];
function readPianoSamples(dir) {
  const base = dir || path.join(REPO, 'audio', 'piano');
  return PIANO_NAMES.map(n => {
    const f = path.join(base, n + '.mp3');
    if (!fs.existsSync(f)) throw new Error('piano sample missing: ' + f + ' (the review page embeds all ' + PIANO_NAMES.length + ' recordings)');
    return fs.readFileSync(f).toString('base64');
  });
}

/* ---- where output may go ---- */
function nearestExisting(p) {
  let cur = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(cur)) {
    const up = path.dirname(cur);
    if (up === cur) break;
    tail.unshift(path.basename(cur));
    cur = up;
  }
  return { base: cur, tail: tail };
}
function realTarget(p) {
  const n = nearestExisting(p);
  return path.join(fs.realpathSync(n.base), ...n.tail);
}
const within = (dir, p) => { const r = path.relative(dir, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/* throws unless `p` is somewhere a generated packet or key may live: not in this repository, and not in any git working tree */
function assertOutsideRepo(p, what) {
  const real = realTarget(p);
  const repoReal = fs.realpathSync(REPO);
  if (within(repoReal, real) || within(REPO, path.resolve(p))) {
    throw new Error(what + ' ' + p + ' is inside the repository working tree (' + REPO + '); generated packets and keys must live outside it. Use a directory under ' + os.tmpdir() + ' or elsewhere.');
  }
  const near = nearestExisting(p).base;
  const g = spawnSync('git', ['-C', near, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (g.status === 0 && String(g.stdout).trim()) {
    throw new Error(what + ' ' + p + ' is inside a git working tree (' + String(g.stdout).trim() + '); choose a directory outside every checkout.');
  }
  return real;
}
function planOutputs(out, keyOut) {
  if (!keyOut) throw new Error('--key-out is required (a directory for the key, kept apart from the packet; there is no default because a default beside the packet gets zipped with it)');
  const outDir = assertOutsideRepo(out, '--out');
  const keyDir = assertOutsideRepo(keyOut, '--key-out');
  /* not merely "not nested": the key may not sit inside the folder that holds the packet (a sibling, say), or a zip of that folder ships it */
  if (within(outDir, keyDir) || within(keyDir, outDir) || within(path.dirname(outDir), keyDir) || within(path.dirname(keyDir), outDir)) {
    throw new Error('the key directory and the packet directory must be separate trees: neither inside the other, and neither inside the other parent directory (a zip of the packet folder would carry the key): ' + keyDir + ' / ' + outDir);
  }
  return { outDir: outDir, keyDir: keyDir };
}

function gitCommit() {
  const r = spawnSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

/* Build a packet. opts: { mode, seed, out, keyOut, items?, cache?, log? } -> { outDir, keyDir, files, packetId, count } */
async function buildPacket(opts) {
  const mode = opts.mode;
  if (!REVIEW_NAME[mode]) throw new Error('--mode must be h8 or h9');
  if (!opts.out) throw new Error('--out is required');
  /* refuse before doing any work */
  const dirs = planOutputs(opts.out, opts.keyOut);
  const seed = opts.seed == null ? crypto.randomBytes(16).toString('hex') : String(opts.seed); /* random when not given; lives in the key only */
  const log = opts.log || (() => {});
  const cache = opts.cache || new Map();
  if (opts.singleNoteHands) cache.arrangeOpts = { singleNoteHands: true }; /* the G9 arm only; recorded in the key, never in the packet */

  let arranged, skipped = [];
  if (opts.items) {
    arranged = [];
    for (const it of opts.items) {
      const r = await SELECT.arrangeCached({ file: it.file, targetLevel: Number(it.targetLevel), handProfile: it.handProfile || 'large' }, cache);
      if (!r.ok) throw new Error('item ' + it.file + ' @' + it.targetLevel + ' cannot be arranged: ' + r.reason);
      r.tier = it.tier == null ? null : it.tier; r.stratum = it.stratum || null;
      arranged.push(r);
    }
  } else {
    const sel = await SELECT.selectItems(mode, { cache: cache, log: log });
    arranged = sel.items; skipped = sel.skipped;
  }

  const shown = BLIND.assign(arranged.map(r => Object.assign({}, r.item, { _r: r })), seed);
  const items = [], keyItems = {};
  shown.forEach(s => {
    const r = s.item._r;
    const arm = { g9: r.g9, legacy: r.legacy };
    const drawn = {
      X: NEUTRAL.render(r.measures, r.tempo, arm[s.x].notes, s.id + 'X-'),
      Y: NEUTRAL.render(r.measures, r.tempo, arm[s.y].notes, s.id + 'Y-')
    };
    const totalQ = r.measures.reduce((a, m) => a + m.lenQ, 0);
    /* confounds the reviewer cannot be told about, kept for decode.js (key only): density, hand balance, and who missed the target */
    const dg = NEUTRAL.density(r.measures, r.g9.notes), dl = NEUTRAL.density(r.measures, r.legacy.notes);
    const missG = Math.abs(r.g9.level - r.item.targetLevel), missL = Math.abs(r.legacy.level - r.item.targetLevel);
    const ratio = dl.notes ? dg.notes / dl.notes : null;
    items.push({ id: s.id, title: r.title, composer: r.composer, file: r.file, targetLevel: r.item.targetLevel, handProfile: r.item.handProfile,
      measures: r.measures.length, tempo: r.tempo, totalQ: totalQ, X: drawn.X, Y: drawn.Y });
    keyItems[s.id] = {
      X: s.x, Y: s.y, file: r.file, title: r.title, targetLevel: r.item.targetLevel, handProfile: r.item.handProfile, tier: r.tier, stratum: r.stratum,
      g9: { measuredLevel: r.g9.level, hardViolations: r.g9.hard, chosenSpec: r.g9.spec, repairedUnits: r.g9.repairedUnits, changedByRepair: r.g9.changedByRepair, soundingNotes: (s.x === 'g9' ? drawn.X : drawn.Y).notes.length },
      legacy: { engine: r.legacy.engine, level: r.legacy.levelName, measuredLevel: r.legacy.level, levelDistanceToTarget: r.legacy.levelDistance, soundingNotes: (s.x === 'legacy' ? drawn.X : drawn.Y).notes.length },
      strata: {
        drawnNotes: { g9: dg.notes, legacy: dl.notes }, leftHandNotes: { g9: dg.leftHand, legacy: dl.leftHand },
        noteRatio: ratio, fuller: ratio == null ? 'similar' : ratio >= FULLER_RATIO ? 'g9' : ratio <= 1 / FULLER_RATIO ? 'legacy' : 'similar',
        levelMiss: { g9: missG, legacy: missL }, missedMore: missG - missL > MISS_GAP ? 'g9' : missL - missG > MISS_GAP ? 'legacy' : 'similar'
      }
    };
  });

  /* no side of any item may repeat a side of another item (a repeated score would reveal the arm without the key) */
  const sides = new Set();
  items.forEach(i => ['X', 'Y'].forEach(l => {
    const sig = BLIND.sha256((i[l].svg + i[l].svgNarrow).split(i.id + l + '-').join('p-') + JSON.stringify(i[l].notes)); /* glyph ids name the item and label: compare without them */
    if (sides.has(sig)) throw new Error('item ' + i.id + ' side ' + l + ' is identical to a side of another item; refusing (it would reveal which arrangement is which)');
    sides.add(sig);
  }));

  const packetId = BLIND.sha256(JSON.stringify({ mode: mode, items: items.map(i => [i.id, i.X.svg, i.Y.svg, i.X.svgNarrow, i.Y.svgNarrow, i.X.notes, i.Y.notes]) })).slice(0, 12);
  const html = PAGE.pageHtml({ mode: mode, packetId: packetId, items: items, samples: readPianoSamples() });
  /* What the reviewer may see about the packet. Nothing about how X and Y were assigned or made: no seed, no rule, no engine
     name, no per-arrangement count, size or level (those would tell the two apart). Both labels carry the same fields. */
  const manifest = {
    format: FORMAT, review: REVIEW_NAME[mode], mode: mode, packetId: packetId,
    files: ['index.html'],
    items: items.map(i => ({
      id: i.id, piece: { file: i.file, title: i.title, composer: i.composer, bars: i.measures },
      targetLevel: i.targetLevel, handProfile: i.handProfile,
      versions: [{ label: 'X', bars: i.measures }, { label: 'Y', bars: i.measures }]
    })),
    note: 'index.html is the whole review: open it in a browser, rate, and use its download button. This manifest lists what is inside.'
  };
  const key = {
    format: KEY_FORMAT, review: REVIEW_NAME[mode], mode: mode, packetId: packetId, seed: seed, builtFrom: gitCommit(), singleNoteHands: !!opts.singleNoteHands,
    strataNote: 'strata (note-count ratio, left-hand notes, level miss) are for decode.js only; the packet says none of it',
    assignment: 'per item: X is G9 when the item\'s rank by HMAC-SHA256(seed, "xy|" + file|level|hand) is even (review/lib/blind.js); order by HMAC(seed, "order|" + ...)',
    items: keyItems,
    inputs: { rule: 'review/README.md, "Which pieces"', skipped: skipped },
    warning: 'NEVER give this file (or its seed) to the reviewer.'
  };

  fs.mkdirSync(dirs.outDir, { recursive: true });
  fs.mkdirSync(dirs.keyDir, { recursive: true });
  const write = (dir, name, text) => { fs.writeFileSync(path.join(dir, name), text); return path.join(dir, name); };
  const files = {
    html: write(dirs.outDir, 'index.html', html),
    manifest: write(dirs.outDir, 'manifest.json', JSON.stringify(manifest, null, 1) + '\n'),
    key: write(dirs.keyDir, 'key.json', JSON.stringify(key, null, 1) + '\n')
  };
  return { outDir: dirs.outDir, keyDir: dirs.keyDir, files: files, packetId: packetId, count: items.length, manifest: manifest, key: key };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const flag = n => args.indexOf(n) >= 0;
  if (flag('--help') || !flag('--mode')) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 18).join('\n')); return; }
  const mode = opt('--mode');
  const t0 = Date.now();
  if (flag('--list')) {
    const sel = await SELECT.selectItems(mode, { log: m => console.log(m) });
    sel.items.forEach(r => console.log(r.file, r.item.targetLevel, r.item.handProfile, 'tier', r.tier));
    return;
  }
  const items = flag('--items') ? JSON.parse(fs.readFileSync(opt('--items'), 'utf8')) : undefined;
  const r = await buildPacket({ mode: mode, seed: opt('--seed'), out: opt('--out'), keyOut: opt('--key-out'), items: items, singleNoteHands: flag('--single-note-hands'), log: m => console.log(m) });
  const size = f => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
  console.log('\npacket: ' + r.files.html + ' (' + size(r.files.html) + '), ' + r.count + ' items, id ' + r.packetId);
  console.log('        ' + r.files.manifest);
  console.log('key (NOT for the reviewer): ' + r.files.key);
  console.log('built in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { buildPacket, readPianoSamples, PIANO_NAMES, planOutputs, assertOutsideRepo, FORMAT, KEY_FORMAT, FULLER_RATIO, MISS_GAP };
