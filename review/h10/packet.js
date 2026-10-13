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
   drawn and written counts). Nothing here touches the app or the server.

   G10b-0 - the engine comparison:

     node review/build.js --mode h10 --compare engine --heard <dir of browser heard notes + items.json> --heard-b <dir of helper notes, the same format>
                          --out <packet-dir> --key-out <key-dir> [--seed <secret>] [--jobs 3] [--excerpt-bars 12] [--excerpt-seconds N] [--level intermediate] [--no-titles]

   The same pieces from two note sources, BOTH written by the page's v2 conversion: arm `browser` = the in-browser model's heard notes (what production serves), arm `helper` =
   the helper ensemble's notes (TransKun + Kong; review/h10/helper-heard.js converts the helper's files). Per piece: part T for both, part A only when the arranger accepts BOTH
   (the H-10 rule), one window of seconds chosen from the BROWSER notes and shown for both. X or Y per piece by HMAC(seed, id). The page says only that the two scores are two
   readings of the same audio; the builder refuses to write a packet whose page, manifest or drawings carry the vocabulary of the sources (review/lib/h10-leak.js). The key
   records, per piece, how far the two readings agree on tempo, metre and where the bars begin (`agreement`), so a known bar or tempo-octave disagreement is visible before the
   teacher spends her eyes on it.

   H-10c - the lead sheet against the reduction (review/h10/packet-arrange.js):

     node review/build.js --mode h10 --compare arrange --heard <dir of heard notes + items.json> --out <packet-dir> --key-out <key-dir> [--seed <secret>] [--jobs 3] [--excerpt-bars 12] [--excerpt-seconds N] [--no-titles]

   One note set per piece, read once by the page's v2 conversion; the Song Arranger's one-note-per-hand copy of it at beginner and at intermediate, each made with recordingArrange
   'leadsheet' and with 'reduce'. Pair (X and Y) where both made a copy, a single where only one did. Questions about the NOTES; the pass rule is written into the key. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..');
const BLIND = require(path.join(REPO, 'review/lib/blind.js'));
const PAGE = require(path.join(REPO, 'review/lib/page-h10.js'));
const ITEM = require(path.join(REPO, 'review/lib/h10-item.js'));
const LEAK = require(path.join(REPO, 'review/lib/h10-leak.js'));

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
      try { out[j.id] = { ok: true, result: await (j.compare === 'engine' ? ITEM.buildEngineItem(j, ctx) : j.compare === 'arrange' ? ITEM.buildArrangeItem(j, ctx) : ITEM.buildItem(j, ctx)) }; } catch (e) { out[j.id] = { ok: false, error: String(e && e.stack || e) }; }
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

/* ---- G10b-0: the second folder of the engine comparison ---- */
const DURATION_TOLERANCE = 2;   /* seconds: the same audio decoded two ways (the browser's decode, ffmpeg) agrees to well under this */
/* the helper's notes for the pieces of the first folder: { notes: { id: heard }, skipped: [{ id, reason }] }. The folder is shaped like the first (<id>.json per piece, an items.json
   when it has one); a piece it lacks, or whose file is not notes, is skipped with the reason, never dropped silently; ids only this folder has are reported too. */
function readHelperDir(dir, firstItems) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('--heard-b ' + dir + ' is not a folder');
  const heard = {}, skipped = [], have = new Set();
  const itemsFile = path.join(dir, 'items.json');
  if (fs.existsSync(itemsFile)) {
    const list = json(itemsFile);
    if (Array.isArray(list)) list.forEach(it => { if (it && it.id != null) have.add(String(it.id)); });
  }
  firstItems.forEach(it => {
    const f = path.join(dir, it.id + '.json');
    if (!fs.existsSync(f)) { skipped.push({ id: it.id, reason: 'no helper notes: ' + it.id + '.json is not in --heard-b' }); return; }
    let h;
    try { h = json(f); } catch (e) { skipped.push({ id: it.id, reason: 'the helper file ' + it.id + '.json is not JSON' }); return; }
    const notes = h && h.notes;
    if (!Array.isArray(notes) || notes.length < 4 || !notes.every(n => n && isFinite(n.on) && isFinite(n.off) && isFinite(n.midi))) {
      skipped.push({ id: it.id, reason: 'the helper file ' + it.id + '.json is not heard notes (needs at least 4 notes with on, off and midi)' }); return;
    }
    const a = it.heard, da = Number(a.duration), db = Number(h.duration);
    if (isFinite(da) && isFinite(db) && !a.truncated && !h.truncated && Math.abs(da - db) > DURATION_TOLERANCE) {
      skipped.push({ id: it.id, reason: 'the two note sets are not the same audio: the first set covers ' + da.toFixed(1) + ' s, the second ' + db.toFixed(1) + ' s' }); return;
    }
    heard[it.id] = h;
  });
  const ids = new Set(firstItems.map(it => it.id));
  have.forEach(id => { if (!ids.has(id)) skipped.push({ id: id, reason: 'in --heard-b but not in --heard (no browser notes for it): left out' }); });
  return { notes: heard, skipped: skipped };
}

const ARM_TEXT = {
  version: { v2: "the page's recording conversion with recording 'v2' (the page's own options; its plausibility check applies)", classic: "the page's classic conversion (closeGaps, exactBars)" },
  engine: {
    browser: "the in-browser model's heard notes (what production serves; the app's own browser transcription, no pedal), written by the page's v2 conversion with the page's own options (its plausibility check applies)",
    helper: "the helper ensemble's notes (TransKun + Kong, run on the Lead's PC; the accepted notes only, no pedal, no beats), written by the same v2 conversion with the same options"
  }
};
const COMPARES = {
  version: { arms: ITEM.ARMS, first: 'v2', second: 'classic' },
  engine: { arms: ITEM.ENGINE_ARMS, first: 'browser', second: 'helper' }
};

/* the packet. opts: { seed, heard, heardB?, compare?: 'engine', jobs, excerptBars, excerptSeconds, level, titles, log, results? }; dirs: { outDir, keyDir }; helpers: { readPianoSamples, gitCommit } */
async function buildH10(opts, dirs, helpers) {
  const log = opts.log || (() => {});
  const compare = opts.compare || 'version';
  if (compare === 'arrange') return require('./packet-arrange.js').buildArrange(opts, dirs, helpers);   /* H-10c: the lead sheet against the reduction */
  if (!COMPARES[compare]) throw new Error("--compare must be 'engine' or 'arrange' (omit it for the classic-against-v2 comparison)");
  const C = COMPARES[compare], engine = compare === 'engine';
  if (!opts.heard) throw new Error('--heard <dir> is required for --mode h10 (the folder review/h10/collect.js wrote: items.json and one <id>.json of heard notes per item)');
  if (engine && !opts.heardB) throw new Error('--heard-b <dir> is required with --compare engine (the helper notes of the same pieces, in the same format: review/h10/helper-heard.js makes them)');
  if (!engine && opts.heardB) throw new Error('--heard-b is only for --compare engine');
  const seed = opts.seed == null ? crypto.randomBytes(16).toString('hex') : String(opts.seed);
  const input = readHeardDir(opts.heard);
  const skipped = input.skipped.slice();
  input.skipped.forEach(s => log('SKIPPED ' + s.id + ': ' + s.reason));
  let helperOf = null;
  if (engine) {
    const hb = readHelperDir(opts.heardB, input.items);
    helperOf = hb.notes;
    hb.skipped.forEach(s => { skipped.push(s); input.skipped.push(s); log('SKIPPED ' + s.id + ': ' + s.reason); });   /* in input.skipped too: logged once */
    input.items = input.items.filter(it => helperOf[it.id]);
  }
  const pick = (item, opt, name) => item.excerpt[name] != null ? item.excerpt[name] : opt;
  const jobs = input.items.map(it => Object.assign({
    id: it.id, title: it.title || 'Recording', heard: it.heard, level: opts.level,
    excerpt: { bars: pick(it, opts.excerptBars, 'bars'), seconds: pick(it, opts.excerptSeconds, 'seconds'), start: it.excerpt.start }
  }, engine ? { compare: 'engine', heardB: helperOf[it.id] } : {}));
  if (!jobs.length) throw new Error('no item could be built: ' + JSON.stringify(skipped));
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
    C.arms.forEach(a => { ['T', 'A'].forEach(p => { if (r.arms[a][p]) problems.push.apply(problems, drawnProblems(r.arms[a][p], a + ' ' + p)); }); });
    if (problems.length) { skipped.push({ id: it.id, reason: 'what is drawn is not what the Score holds: ' + problems.join('; ') }); return; }
    ok.push({ src: it, r: r });
  });
  skipped.forEach(s => { if (!input.skipped.includes(s)) log('SKIPPED ' + s.id + ': ' + s.reason); });
  if (!ok.length) throw new Error('no item could be built: ' + JSON.stringify(skipped));

  const shown = BLIND.assignArms(ok.map(o => ({ id: o.src.id })), seed, C.first, C.second);
  const byId = new Map(ok.map(o => [o.src.id, o]));
  const pageItems = [], keyItems = {}, manifestItems = [];
  shown.forEach((s, k) => {
    const o = byId.get(s.key), r = o.r, armOf = side => r.arms[side === 'X' ? s.x : s.y];
    const parts = ['T'], draw = { T: { X: armOf('X').T, Y: armOf('Y').T } };
    if (C.arms.every(a => r.arms[a].A)) { parts.push('A'); draw.A = { X: armOf('X').A, Y: armOf('Y').A }; }
    const label = PAGE.letter(k);
    const title = opts.titles === false ? null : (o.src.title || null);
    pageItems.push({ id: s.id, label: label, title: title, url: o.src.url, start: r.excerpt.start, end: r.excerpt.end, parts: parts, draw: draw });
    manifestItems.push({ id: s.id, label: label, title: title, url: o.src.url, excerpt: { startSeconds: r.excerpt.start, endSeconds: r.excerpt.end }, parts: parts,
      versions: [{ label: 'X' }, { label: 'Y' }] });
    const armKey = a => {
      const x = r.arms[a];
      return Object.assign({}, x.key, { counts: { T: x.T.counts, A: x.A ? x.A.counts : null } });
    };
    const heardKey = h => ({ notes: h.notes.length, duration: h.duration || null, engine: h.engine || null, truncated: !!h.truncated, digest: sha(JSON.stringify(h.notes)).slice(0, 12) });
    const arms = {}, arranged = {};
    C.arms.forEach(a => { arms[a] = armKey(a); arranged[a] = !!r.arms[a].A; });
    keyItems[s.id] = {
      X: s.x, Y: s.y, label: label, parts: parts, source: { id: o.src.id, url: o.src.url, title: o.src.title }, inputClass: o.src.inputClass,
      heard: engine ? { browser: heardKey(o.src.heard), helper: Object.assign(heardKey(helperOf[o.src.id]), { summary: helperOf[o.src.id].helper || null }) } : heardKey(o.src.heard),
      excerpt: { start: r.excerpt.start, end: r.excerpt.end, seconds: r.excerpt.seconds, how: r.excerpt.how, barSeconds: r.excerpt.barSeconds, arms: r.excerpt.arms },
      arms: arms, arranged: arranged,
      identicalSides: { T: sideSig(draw.T.X) === sideSig(draw.T.Y), A: draw.A ? sideSig(draw.A.X) === sideSig(draw.A.Y) : null }
    };
    if (engine) { keyItems[s.id].agreement = r.agreement; keyItems[s.id].heardNotesInWindow = r.heardIn; }
    if (keyItems[s.id].identicalSides.T) log('NOTE item ' + s.id + ' (' + o.src.id + '): the two transcriptions are drawn identically (' + (engine ? 'the two note sets give the same score' : 'the page threw v2 away, or both readings agree') + ')');
    if (engine) {
      const ag = r.agreement;
      if (ag.flags.length) log('DISAGREE item ' + s.id + ' (' + o.src.id + '): the two readings disagree on ' + ag.flags.join(', ') + ' (browser / helper: tempo ' + ag.tempo.browser + ' / ' + ag.tempo.helper + ', metre ' + ag.metre.browser + ' / ' + ag.metre.helper +
        ', bars ' + r.arms.browser.key.measures + ' / ' + r.arms.helper.key.measures + (ag.alignedShare != null ? '; aligned bar starts ' + ag.alignedShare + ' of the piece' + (ag.window && ag.window.alignedShare != null ? ', ' + ag.window.alignedShare + ' of the excerpt' : '') + ', phase ' + ag.phaseBeats + ' beats' : '') + ')');
      C.arms.forEach(a => { if (r.arms[a].key.v2Rejected) log('NOTE item ' + s.id + ' (' + o.src.id + '): the page threw the v2 result of the ' + a + ' notes away (its plausibility check), so that score was written by the classic conversion'); });
    }
  });

  /* no side of any part of any item may repeat a side of ANOTHER item (a repeated score would give the way away without the key). The two sides of one part may be
     identical (v2 and the classic reading agree, or the page threw v2 away): that item is kept, said in the key (identicalSides) and on the console. */
  const sigs = new Map();
  pageItems.forEach(it => it.parts.forEach(p => ['X', 'Y'].forEach(side => {
    const sg = sideSig(it.draw[p][side]), where = it.id + ' ' + p + side, had = sigs.get(sg);
    if (had && had.id !== it.id) throw new Error(where + ' is identical to ' + had.where + ' (a repeated score would reveal which is which); refusing');
    if (!had) sigs.set(sg, { id: it.id, where: where });
  })));

  const idBody = Object.assign({ mode: 'h10' }, engine ? { compare: 'engine' } : {}, { items: pageItems.map(i => [i.id, i.url, i.start, i.end, i.parts, i.parts.map(p => ['X', 'Y'].map(s => sideSig(i.draw[p][s])))]) });
  const packetId = sha(JSON.stringify(idBody)).slice(0, 12);
  const html = PAGE.pageHtml({ packetId: packetId, items: pageItems, samples: helpers.readPianoSamples(), compare: compare });
  const manifest = {
    format: FORMAT, review: 'H-10', mode: 'h10', packetId: packetId, files: ['index.html'], items: manifestItems,
    note: engine ? 'index.html is the whole review: open it (a phone is fine), answer, and use its buttons at the end. This manifest lists what is inside.'
      : 'index.html is the whole review: open it in a browser (a phone is fine), answer, and use its buttons at the end. This manifest lists what is inside.'
  };
  const manifestText = JSON.stringify(manifest, null, 1) + '\n';
  const warnings = [];
  if (engine) {
    /* the vocabulary of the two readings must not be on the page, in the manifest or in a drawing (titles are the pieces' own: warned about, not scanned) */
    const bad = LEAK.scanEngine(html, manifestText, PAGE.drawingsOf(html), { seed: seed, credit: PAGE.CREDIT, titles: pageItems.map(i => i.title) });
    if (bad.length) throw new Error('the packet would give the sources away; refusing to write it: ' + bad.slice(0, 5).join(' | '));
    LEAK.titleWarnings(pageItems.map(i => i.title)).forEach(w => { warnings.push(w); log('WARNING ' + w + ' (shown for both sides; rename it in items.json or build with --no-titles)'); });
  }
  const key = Object.assign({ format: KEY_FORMAT, review: 'H-10', mode: 'h10' }, engine ? { compare: 'engine' } : {}, {
    packetId: packetId, seed: seed, builtFrom: helpers.gitCommit(),
    arms: ARM_TEXT[compare],
    parts: { T: 'the transcription as the review screen shows it', A: "the Song Arranger's one-note-per-hand copy at the middle level (arrangeSingleNoteWithHandsFallback)" },
    assignment: 'per item: X is ' + C.first + ' when the item\'s rank by HMAC-SHA256(seed, "xy|" + id) is even (review/lib/blind.js assignArms); order by HMAC(seed, "order|" + id); both parts of an item keep the sides',
    options: { excerptBars: opts.excerptBars || null, excerptSeconds: opts.excerptSeconds || null, level: opts.level || ITEM.DEFAULT_LEVEL, titles: opts.titles !== false }
  }, engine ? {
    question: "are the scores written from the helper ensemble's notes better (its extra notes are real) or worse (extra clutter) than the ones written from the in-browser model's notes? Both go through the same v2 conversion; the helper's beats and pedal are not used",
    excerptRule: 'one window of seconds per piece, chosen from the BROWSER notes (the helper hears more); each arm shows the bars that cover it'
  } : { passRule: PASS_RULE }, {
    items: keyItems,
    inputs: { rule: 'review/README.md, "H-10"', skipped: skipped, buildSeconds: Math.round(timeMs / 100) / 10 },
    warning: 'NEVER give this file (or its seed) to the reviewer.'
  });
  if (engine) key.inputs.warnings = warnings;
  fs.mkdirSync(dirs.outDir, { recursive: true });
  fs.mkdirSync(dirs.keyDir, { recursive: true });
  const write = (dir, name, text) => { fs.writeFileSync(path.join(dir, name), text); return path.join(dir, name); };
  const files = {
    html: write(dirs.outDir, 'index.html', html),
    manifest: write(dirs.outDir, 'manifest.json', manifestText),
    key: write(dirs.keyDir, 'key.json', JSON.stringify(key, null, 1) + '\n')
  };
  return { outDir: dirs.outDir, keyDir: dirs.keyDir, files: files, packetId: packetId, count: pageItems.length, manifest: manifest, key: key, buildMs: timeMs, skipped: skipped, warnings: warnings };
}
module.exports = { buildH10, sha, sideSig, drawnProblems, readHeardDir, readHelperDir, buildItems, PASS_RULE, FORMAT, KEY_FORMAT, ID_RE, DURATION_TOLERANCE };
