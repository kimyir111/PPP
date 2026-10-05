/* G10a-5 (H-10): the packet builder for the blind review of PPP's new recording conversion ("v2") against the classic one.
   Called by review/build.js `--mode h10`:

     node review/build.js --mode h10 --heard <dir> --out <packet-dir> --key-out <key-dir> [--seed <secret>] [--jobs 3]
                          [--excerpt-bars 12] [--excerpt-seconds N] [--level intermediate] [--no-titles]

   <dir> holds what review/h10/collect.js writes (or any folder shaped like it): `items.json` ([{ id, url, title?, excerpt?: { bars?, seconds?,
   start? }, inputClass? }]) and one `<id>.json` per item, the HEARD NOTES exactly as the app's browser transcription gives them
   ({ notes: [{ on, off, midi, vel }], pedals?, duration, engine, ... }); `collect-status.json` (optional) says why an item has none.

   Per item (review/lib/h10-item.js): the same heard notes go through the page's own conversion twice - classic (closeGaps, exactBars) and v2 (the
   page's v2 options, the plausibility check included) - and each result, and the Song Arranger's one-note-per-hand copy of it at the middle level
   (the page's own function, hands fallback included), is drawn by the app's engraver for the same seconds of the piece and sounded by the app's
   player plan. Which arm is X and which is Y, per item, is HMAC(seed, id) (review/lib/blind.js assignArms; an even split); both parts of an item
   keep the same sides. The page (review/lib/page-h10.js) names neither arm; the key (key.json, OUTSIDE every git tree, never given to the
   reviewer) holds the seed, the sides and everything about how each score was made (the hands fallback, a rejected v2 result, bars shown,
   drawn and written counts). Nothing here touches the app or the server. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..');
const BLIND = require(path.join(REPO, 'review/lib/blind.js'));
const PAGE = require(path.join(REPO, 'review/lib/page-h10.js'));
const ITEM = require(path.join(REPO, 'review/lib/h10-item.js'));

const FORMAT = 'ppp-review-packet/1', KEY_FORMAT = 'ppp-review-key/1';
const WORKER = path.join(__dirname, 'item-worker.js');
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));

/* G10 section 10, "Pass (starting point, fixed in the packet's manifest before it is built)": fixed here, in the key, before any answer exists.
   decode.js evaluates it on part 1 (the transcription: what v2 changes) and, for information, on part 2. It is a starting point; whether the
   conversion flips is the user's decision (section 14, U6). */
const PASS_RULE = Object.freeze({
  source: 'docs/GOALS/G10_AUDIO_TO_SCORE.md section 10, H-10',
  v2AtLeastAsGoodShare: 0.8,      /* "v2 >= v1 on >= 8 of 10": v2 preferred or similar, of the pieces answered */
  noPieceWhereOnlyV2Fails: true,  /* "no excerpt where only v2 looks wrong": v2 fails while the classic one passes */
  v2PassShare: 0.6                /* "the teacher would hand >= 6 of 10 v2 scores to a student with at most small fixes" */
});

/* ---- the input folder ---- */
function readHeardDir(dir) {
  const itemsFile = path.join(dir, 'items.json');
  if (!fs.existsSync(itemsFile)) throw new Error('--heard ' + dir + ' has no items.json (the list of pieces: [{ id, url, title? }])');
  const list = json(itemsFile);
  if (!Array.isArray(list) || !list.length) throw new Error('items.json is not a non-empty list');
  const statusFile = path.join(dir, 'collect-status.json');
  const status = fs.existsSync(statusFile) ? json(statusFile) : {};
  const items = [], skipped = [], seen = new Set();
  list.forEach(it => {
    if (!it || !ID_RE.test(String(it.id))) throw new Error('an item in items.json has no usable id (letters, digits, - and _, up to 40): ' + JSON.stringify(it));
    const id = String(it.id);
    if (seen.has(id)) throw new Error('two items with the id ' + id);
    seen.add(id);
    const st = (status.items || status)[id] || null;
    const f = path.join(dir, id + '.json');
    if (!fs.existsSync(f)) { skipped.push({ id: id, reason: st && st.status ? 'not collected: ' + st.status + (st.error ? ' (' + st.error + ')' : '') : 'no heard-notes file ' + id + '.json' }); return; }
    const heard = json(f);
    const notes = heard && heard.notes;
    if (!Array.isArray(notes) || notes.length < 4 || !notes.every(n => n && isFinite(n.on) && isFinite(n.off) && isFinite(n.midi))) {
      skipped.push({ id: id, reason: id + '.json is not heard notes (needs at least 4 notes with on, off and midi)' }); return;
    }
    items.push({ id: id, url: it.url || (st && st.url) || null, title: it.title || (st && st.title) || null, excerpt: it.excerpt || {}, inputClass: it.inputClass || null, heard: heard });
  });
  return { items: items, skipped: skipped };
}

/* ---- building the items, several at a time in their own processes ---- */
function runInWorker(job, timeoutMs) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [WORKER], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    const finish = r => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* gone */ } finish({ ok: false, error: 'timed out after ' + Math.round(timeoutMs / 1000) + ' s' }); }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => finish({ ok: false, error: 'could not start the worker: ' + e.message }));
    child.on('close', code => { try { finish(JSON.parse(out)); } catch (e) { finish({ ok: false, error: 'worker exit ' + code + ': ' + (err || out).slice(-600) }); } });
    child.stdin.on('error', () => { /* the worker died first: close reports it */ });
    child.stdin.end(JSON.stringify(job));
  });
}

/* jobs: [{ id, title, heard, excerpt, level }] -> { id: { ok, result | error } }. n <= 1 runs in this process, one after the other. */
async function buildItems(jobs, opts) {
  opts = opts || {};
  const workers = (opts.jobs || 1) > 1, n = Math.max(1, Math.min(opts.jobs || 1, jobs.length)), log = opts.log || (() => {});
  const out = {};
  if (!workers) {
    const ctx = { arranger: require(path.join(REPO, 'review/lib/appcode.js')).arranger() };
    for (const j of jobs) {
      const t0 = Date.now();
      try { out[j.id] = { ok: true, result: await ITEM.buildItem(j, ctx) }; } catch (e) { out[j.id] = { ok: false, error: String(e && e.stack || e) }; }
      log('  ' + j.id + ': ' + (out[j.id].ok ? 'built' : 'FAILED') + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
    }
    return out;
  }
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const j = jobs[next++], t0 = Date.now();
      out[j.id] = await runInWorker(j, opts.timeoutMs || 15 * 60 * 1000);
      log('  ' + j.id + ': ' + (out[j.id].ok ? 'built' : 'FAILED') + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
    }
  };
  await Promise.all(Array.from({ length: n }, lane));
  return out;
}

const sideSig = p => sha(p.svg + p.svgNarrow + JSON.stringify(p.notes));
/* what a reader counts in the drawing must be what the arm's Score holds for the same bars (heads and rests exactly, in both layouts) */
function drawnProblems(part, label) {
  const bad = [];
  ['wide', 'narrow'].forEach(l => {
    const d = part.counts[l], s = part.counts.score;
    if (d.heads !== s.heads) bad.push(label + ' ' + l + ': ' + d.heads + ' note heads drawn, the Score has ' + s.heads);
    if (d.rests !== s.rests) bad.push(label + ' ' + l + ': ' + d.rests + ' rests drawn, the Score has ' + s.rests);
  });
  return bad;
}

/* the packet. opts: { seed, heard, jobs, excerptBars, excerptSeconds, level, titles, log, results? }; dirs: { outDir, keyDir }; helpers: { readPianoSamples, gitCommit } */
async function buildH10(opts, dirs, helpers) {
  const log = opts.log || (() => {});
  if (!opts.heard) throw new Error('--heard <dir> is required for --mode h10 (the folder review/h10/collect.js wrote: items.json and one <id>.json of heard notes per item)');
  const seed = opts.seed == null ? crypto.randomBytes(16).toString('hex') : String(opts.seed);
  const input = readHeardDir(opts.heard);
  const skipped = input.skipped.slice();
  input.skipped.forEach(s => log('SKIPPED ' + s.id + ': ' + s.reason));
  const pick = (item, opt, name) => item.excerpt[name] != null ? item.excerpt[name] : opt;
  const jobs = input.items.map(it => ({
    id: it.id, title: it.title || 'Recording', heard: it.heard, level: opts.level,
    excerpt: { bars: pick(it, opts.excerptBars, 'bars'), seconds: pick(it, opts.excerptSeconds, 'seconds'), start: it.excerpt.start }
  }));
  log('building ' + jobs.length + ' item(s)' + ((opts.jobs || 1) > 1 ? ' in ' + Math.min(opts.jobs, jobs.length) + ' processes' : '') + '...');
  const t0 = Date.now();
  const built = opts.results || await buildItems(jobs, { jobs: opts.jobs, log: log });
  const timeMs = Date.now() - t0;

  /* items that built, drew what their Score holds, and have the same packets sides ... */
  const ok = [];
  input.items.forEach(it => {
    const b = built[it.id];
    if (!b || !b.ok) { skipped.push({ id: it.id, reason: 'build failed: ' + String(b && b.error || 'no result').split('\n')[0].slice(0, 300) }); return; }
    const r = b.result, problems = [];
    ITEM.ARMS.forEach(a => { ['T', 'A'].forEach(p => { if (r.arms[a][p]) problems.push.apply(problems, drawnProblems(r.arms[a][p], a + ' ' + p)); }); });
    if (problems.length) { skipped.push({ id: it.id, reason: 'what is drawn is not what the Score holds: ' + problems.join('; ') }); return; }
    ok.push({ src: it, r: r });
  });
  skipped.forEach(s => { if (!input.skipped.includes(s)) log('SKIPPED ' + s.id + ': ' + s.reason); });
  if (!ok.length) throw new Error('no item could be built: ' + JSON.stringify(skipped));

  const shown = BLIND.assignArms(ok.map(o => ({ id: o.src.id })), seed, 'v2', 'classic');
  const byId = new Map(ok.map(o => [o.src.id, o]));
  const pageItems = [], keyItems = {}, manifestItems = [];
  shown.forEach((s, k) => {
    const o = byId.get(s.key), r = o.r, armOf = side => r.arms[side === 'X' ? s.x : s.y];
    const parts = ['T'], draw = { T: { X: armOf('X').T, Y: armOf('Y').T } };
    if (r.arms.v2.A && r.arms.classic.A) { parts.push('A'); draw.A = { X: armOf('X').A, Y: armOf('Y').A }; }
    const label = PAGE.letter(k);
    const title = opts.titles === false ? null : (o.src.title || null);
    pageItems.push({ id: s.id, label: label, title: title, url: o.src.url, start: r.excerpt.start, end: r.excerpt.end, parts: parts, draw: draw });
    manifestItems.push({ id: s.id, label: label, title: title, url: o.src.url, excerpt: { startSeconds: r.excerpt.start, endSeconds: r.excerpt.end }, parts: parts,
      versions: [{ label: 'X' }, { label: 'Y' }] });
    const armKey = a => {
      const x = r.arms[a];
      return Object.assign({}, x.key, { counts: { T: x.T.counts, A: x.A ? x.A.counts : null } });
    };
    keyItems[s.id] = {
      X: s.x, Y: s.y, label: label, parts: parts, source: { id: o.src.id, url: o.src.url, title: o.src.title }, inputClass: o.src.inputClass,
      heard: { notes: o.src.heard.notes.length, duration: o.src.heard.duration || null, engine: o.src.heard.engine || null, truncated: !!o.src.heard.truncated,
        digest: sha(JSON.stringify(o.src.heard.notes)).slice(0, 12) },
      excerpt: { start: r.excerpt.start, end: r.excerpt.end, seconds: r.excerpt.seconds, how: r.excerpt.how, barSeconds: r.excerpt.barSeconds, arms: r.excerpt.arms },
      arms: { classic: armKey('classic'), v2: armKey('v2') },
      arranged: { classic: !!r.arms.classic.A, v2: !!r.arms.v2.A },
      identicalSides: { T: sideSig(draw.T.X) === sideSig(draw.T.Y), A: draw.A ? sideSig(draw.A.X) === sideSig(draw.A.Y) : null }
    };
    if (keyItems[s.id].identicalSides.T) log('NOTE item ' + s.id + ' (' + o.src.id + '): the two transcriptions are drawn identically (the page threw v2 away, or both readings agree)');
  });

  /* no side of any part of any item may repeat a side of ANOTHER item (a repeated score would give the way away without the key). The two sides of one part may be
     identical (v2 and the classic reading agree, or the page threw v2 away): that item is kept, said in the key (identicalSides) and on the console. */
  const sigs = new Map();
  pageItems.forEach(it => it.parts.forEach(p => ['X', 'Y'].forEach(side => {
    const sg = sideSig(it.draw[p][side]), where = it.id + ' ' + p + side, had = sigs.get(sg);
    if (had && had.id !== it.id) throw new Error(where + ' is identical to ' + had.where + ' (a repeated score would reveal which is which); refusing');
    if (!had) sigs.set(sg, { id: it.id, where: where });
  })));

  const packetId = sha(JSON.stringify({ mode: 'h10', items: pageItems.map(i => [i.id, i.url, i.start, i.end, i.parts, i.parts.map(p => ['X', 'Y'].map(s => sideSig(i.draw[p][s])))]) })).slice(0, 12);
  const html = PAGE.pageHtml({ packetId: packetId, items: pageItems, samples: helpers.readPianoSamples() });
  const manifest = {
    format: FORMAT, review: 'H-10', mode: 'h10', packetId: packetId, files: ['index.html'], items: manifestItems,
    note: 'index.html is the whole review: open it in a browser (a phone is fine), answer, and use its buttons at the end. This manifest lists what is inside.'
  };
  const key = {
    format: KEY_FORMAT, review: 'H-10', mode: 'h10', packetId: packetId, seed: seed, builtFrom: helpers.gitCommit(),
    arms: { v2: "the page's recording conversion with recording 'v2' (the page's own options; its plausibility check applies)", classic: "the page's classic conversion (closeGaps, exactBars)" },
    parts: { T: 'the transcription as the review screen shows it', A: "the Song Arranger's one-note-per-hand copy at the middle level (arrangeSingleNoteWithHandsFallback)" },
    assignment: 'per item: X is v2 when the item\'s rank by HMAC-SHA256(seed, "xy|" + id) is even (review/lib/blind.js assignArms); order by HMAC(seed, "order|" + id); both parts of an item keep the sides',
    options: { excerptBars: opts.excerptBars || null, excerptSeconds: opts.excerptSeconds || null, level: opts.level || ITEM.DEFAULT_LEVEL, titles: opts.titles !== false },
    passRule: PASS_RULE, items: keyItems,
    inputs: { rule: 'review/README.md, "H-10"', skipped: skipped, buildSeconds: Math.round(timeMs / 100) / 10 },
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
  return { outDir: dirs.outDir, keyDir: dirs.keyDir, files: files, packetId: packetId, count: pageItems.length, manifest: manifest, key: key, buildMs: timeMs, skipped: skipped };
}
module.exports = { buildH10, readHeardDir, buildItems, PASS_RULE, FORMAT, KEY_FORMAT, ID_RE };
