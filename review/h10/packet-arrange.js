/* H-10c: the packet builder for the blind check of the NOTES of the Song Arranger's copies of real piano covers - the lead sheet (recordingArrange 'leadsheet') against the
   reduction ('reduce'). Called by review/h10/packet.js (buildH10) for `--compare arrange`, i.e. by review/build.js:

     node review/build.js --mode h10 --compare arrange --heard <dir> --out <packet-dir> --key-out <key-dir> [--seed <secret>] [--jobs 3] [--excerpt-bars 12] [--excerpt-seconds N] [--no-titles]

   <dir> is a heard-notes folder (items.json and one <id>.json per piece: what review/h10/collect.js or review/h10/helper-heard.js writes). The notes are read ONCE per piece, by
   the page's own v2 conversion; the Song Arranger's one-note-per-hand copy of that score is made at beginner and at intermediate, each with the lead sheet and with the reduction
   (review/lib/h10-item.js buildArrangeItem: the page's own function, every fallback included; a lead sheet that refused and fell back to the reduction counts as a refusal of the
   lead sheet). One window of about twelve bars, chosen from the conversion, is drawn for every copy by the app's engraver and sounded by the app's player plan.

   What the page shows (review/lib/page-arrange.js), per piece and level:
     a PAIR    two scores X and Y of the same bars, when both methods made a copy; which side is which method is HMAC(seed, piece id), an even split over the pieces that have a
               pair, the same sides for both levels;
     a SINGLE  one score, when only one method made a copy; which method, and why the other made none, are in the key only.
   When a piece's copies are the same at both levels (the same sounding notes, for every method that made one) the two levels are ONE part ("초급 · 중급"), drawn from beginner: the
   notes are what is asked about, and the same notes would be judged twice. The key says so (`merged`).
   The page names neither method anywhere; this builder REFUSES to write a packet whose page, manifest or drawings carry the vocabulary of the methods (review/lib/h10-leak.js
   scanArrange). The key (OUTSIDE every git tree, never given to the reviewer) holds the seed, the sides, what each copy was made by, every refusal and the PASS RULE, written
   here, before any answer exists; review/h10/decode-arrange.js evaluates it. Nothing here touches the app or the server. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const REPO = path.resolve(__dirname, '..', '..');
const BLIND = require(path.join(REPO, 'review/lib/blind.js'));
const PAGE = require(path.join(REPO, 'review/lib/page-arrange.js'));
const ITEM = require(path.join(REPO, 'review/lib/h10-item.js'));
const LEAK = require(path.join(REPO, 'review/lib/h10-leak.js'));

const FORMAT = 'ppp-review-packet/1', KEY_FORMAT = 'ppp-review-key/1';
const METHODS = ITEM.ARRANGE_METHODS;           /* ['leadsheet', 'reduce'] */
const LEVELS = ITEM.ARRANGE_LEVELS;             /* ['beginner', 'intermediate'] */
const LEVEL_KEY = { beginner: 'B', intermediate: 'I' };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/* The pass rule, fixed in the key BEFORE any answer exists. The user's rule (2026-10-07): "if the notes are accurate, switch to the lead sheet". Evaluated by decode-arrange.js, which
   reads the numbers from the key it is given, not from here. */
const PASS_RULE = Object.freeze({
  source: 'the user, 2026-10-07: "if the notes are accurate, switch to the lead sheet" (docs/GOALS/G10_AUDIO_TO_SCORE.md sections 33 and 34)',
  accurate: 'the notes question ("음(멜로디)이 원곡과 맞나요?") answered 맞아요 (ok) or 대체로 맞아요 (mostly); 틀린 곳이 많아요 (many) is not accurate',
  leadNotesAccurateShare: 0.8,        /* 1: of the lead-sheet copies the page showed (pairs and singles; a part that merges the two levels is one copy), at least this share is accurate */
  noPieceWhereOnlyLeadIsWrong: true,  /* 2: no pair in which the lead-sheet copy is judged 틀린 곳이 많아요 while the reduction's copy of the same piece and level is not (pieces whose reduction made no copy have nothing to compare: they count in rule 1 only) */
  leadPreferredOrSimilarShare: 0.8,   /* 3: of the pairs answered, at least this share has the lead-sheet copy preferred or 비슷해요 */
  verdict: 'PASS when all three hold; FAIL when any one fails on the answers given; INCOMPLETE when none fails but an answer the rule needs is missing. The answers are one reviewer\'s and a handful of pieces; the verdict is the rule\'s, the switch is the user\'s'
});

const QUESTION = 'are the notes of the lead-sheet copies accurate (the melody agrees with the original), against the reduction\'s copies of the same covers? The user\'s rule: if the notes are accurate, switch recordings to the lead sheet';
const ARM_TEXT = {
  leadsheet: "the Song Arranger's one-note-per-hand copy made with recordingArrange 'leadsheet' (the page's own arrangeSingleNoteWithLeadsheet; it counts only when the lead sheet itself made the copy, not when it refused and the reduction did)",
  reduce: "the Song Arranger's one-note-per-hand copy made with recordingArrange 'reduce' (the reduction: the page's arrangeSingleNoteWithHandsFallback, the hands retry included)"
};

/* the sounding notes and counts of a drawn copy: two copies with the same signature sound and read the same (fingering may differ) */
const copySig = p => sha(JSON.stringify([p.notes, p.counts.score]));
const drawSig = p => sha(p.svg + p.svgNarrow + JSON.stringify(p.notes));

/* one piece's result -> its parts: per level a pair (both methods) or a single (one) or nothing; the two levels merge when every method gives the same copy at both */
function partsOf(r, levels) {
  const perLevel = (levels || LEVELS).map(level => {
    const c = {};
    METHODS.forEach(m => { c[m] = r.levels[level][m].made ? r.levels[level][m].part : null; });
    return { level: level, copies: c, sig: JSON.stringify(METHODS.map(m => c[m] ? copySig(c[m]) : null)) };
  });
  const any = l => METHODS.some(m => l.copies[m]);
  const out = [];
  const [a, b] = perLevel;
  if (a && b && any(a) && a.sig === b.sig) out.push({ key: 'BI', levels: [a.level, b.level], copies: a.copies, merged: true });
  else perLevel.forEach(l => { if (any(l)) out.push({ key: LEVEL_KEY[l.level], levels: [l.level], copies: l.copies, merged: false }); });
  return out.map(p => Object.assign(p, {
    kind: METHODS.every(m => p.copies[m]) ? 'pair' : 'single',
    title: p.levels.map(l => PAGE.LEVEL_NAME[l]).join(' · ')
  }));
}

/* what the key says about one drawn copy */
const countsKey = p => ({ wide: p.counts.wide, narrow: p.counts.narrow, score: p.counts.score, struck: p.counts.struck, seconds: p.seconds, barsShown: p.bars });

/* opts: { seed, heard, jobs, excerptBars, excerptSeconds, titles, log, results? }; dirs: { outDir, keyDir }; helpers: { readPianoSamples, gitCommit } */
async function buildArrange(opts, dirs, helpers) {
  const P = require('./packet.js');
  const log = opts.log || (() => {});
  if (!opts.heard) throw new Error('--heard <dir> is required with --compare arrange (the folder of heard notes: items.json and one <id>.json per piece)');
  if (opts.heardB) throw new Error('--heard-b is only for --compare engine');
  if (opts.level) throw new Error('--level is not used with --compare arrange (both beginner and intermediate are made; --levels beginner makes one)');
  const levels = opts.levels ? String(opts.levels).split(',').map(x => x.trim()).filter(Boolean) : LEVELS.slice();
  if (!levels.length || levels.some(l => !LEVELS.includes(l)) || new Set(levels).size !== levels.length) throw new Error('--levels is a list of ' + LEVELS.join(', ') + ' (default both), got ' + JSON.stringify(opts.levels));
  const seed = opts.seed == null ? crypto.randomBytes(16).toString('hex') : String(opts.seed);
  const input = P.readHeardDir(opts.heard);
  const skipped = input.skipped.slice();
  input.skipped.forEach(s => log('SKIPPED ' + s.id + ': ' + s.reason));
  const pick = (item, opt, name) => item.excerpt[name] != null ? item.excerpt[name] : opt;
  const jobs = input.items.map(it => ({
    id: it.id, title: it.title || 'Recording', heard: it.heard, compare: 'arrange', levels: levels,
    excerpt: { bars: pick(it, opts.excerptBars, 'bars'), seconds: pick(it, opts.excerptSeconds, 'seconds'), start: it.excerpt.start }
  }));
  if (!jobs.length) throw new Error('no item could be built: ' + JSON.stringify(skipped));
  log('building ' + jobs.length + ' piece(s), each at ' + levels.length + ' level(s) with ' + METHODS.length + ' methods' + ((opts.jobs || 1) > 1 ? ', in ' + Math.min(opts.jobs, jobs.length) + ' processes' : '') + '...');
  const t0 = Date.now();
  const built = opts.results || await P.buildItems(jobs, { jobs: opts.jobs, log: log });
  const timeMs = Date.now() - t0;

  const ok = [];
  input.items.forEach(it => {
    const b = built[it.id];
    if (!b || !b.ok) { skipped.push({ id: it.id, reason: 'build failed: ' + String(b && b.error || 'no result').split('\n')[0].slice(0, 300) }); return; }
    const r = b.result, problems = [];
    levels.forEach(l => METHODS.forEach(m => { const c = r.levels[l][m]; if (c.part) problems.push.apply(problems, P.drawnProblems(c.part, l + ' ' + m)); }));
    if (problems.length) { skipped.push({ id: it.id, reason: 'what is drawn is not what the Score holds: ' + problems.join('; ') }); return; }
    const parts = partsOf(r, levels);
    if (!parts.length) { skipped.push({ id: it.id, reason: 'neither method made a copy that could be drawn (at either level)' }); return; }
    ok.push({ src: it, r: r, parts: parts, hasPair: parts.some(p => p.kind === 'pair') });
  });
  skipped.forEach(s => { if (!input.skipped.includes(s)) log('SKIPPED ' + s.id + ': ' + s.reason); });
  if (!ok.length) throw new Error('no item could be built: ' + JSON.stringify(skipped));

  const shown = BLIND.assignArms(ok.map(o => ({ id: o.src.id, pair: o.hasPair })), seed, METHODS[0], METHODS[1], it => it.pair);
  const byId = new Map(ok.map(o => [o.src.id, o]));
  const pageItems = [], keyItems = {}, manifestItems = [];
  shown.forEach((s, k) => {
    const o = byId.get(s.key), r = o.r, label = PAGE.letter(k);
    const title = opts.titles === false ? null : (o.src.title || null);
    const cv = r.conversion;
    /* the bars drawn start and end at barlines: the link and the line above the scores say those seconds (the window the excerpt was chosen by lies inside them) */
    const start = cv.covers[0], end = cv.covers[1];
    const parts = o.parts.map(p => {
      const sides = p.kind === 'pair' ? { X: s.x, Y: s.y } : { S: METHODS.find(m => p.copies[m]) };
      const draw = {};
      Object.keys(sides).forEach(side => { draw[side] = p.copies[sides[side]]; });
      return { key: p.key, title: p.title, kind: p.kind, levels: p.levels, sides: sides, draw: draw, merged: p.merged };
    });
    pageItems.push({ id: s.id, label: label, title: title, url: o.src.url, start: start, end: end, parts: parts });
    manifestItems.push({ id: s.id, label: label, title: title, url: o.src.url, excerpt: { startSeconds: start, endSeconds: end },
      parts: parts.map(p => ({ key: p.key, title: p.title, kind: p.kind, versions: p.kind === 'pair' ? [{ label: 'X' }, { label: 'Y' }] : [{ label: 'S' }] })) });
    const heardKey = h => ({ notes: h.notes.length, duration: h.duration || null, engine: h.engine || null, truncated: !!h.truncated, digest: sha(JSON.stringify(h.notes)).slice(0, 12) });
    const perLevel = {}, refusals = [];
    levels.forEach(l => {
      perLevel[l] = {};
      METHODS.forEach(m => {
        const c = r.levels[l][m];
        perLevel[l][m] = Object.assign({}, c.key, { drawn: !!c.part, counts: c.part ? countsKey(c.part) : null });
        if (!c.made) refusals.push({ level: l, method: m, reason: c.key.reason || c.key.leadsheetRefusal || c.key.problem || 'not made', leadsheetRefusal: c.key.leadsheetRefusal, madeBy: c.key.madeBy, problem: c.key.problem || null });
      });
    });
    const partKeys = {};
    parts.forEach(p => {
      partKeys[p.key] = Object.assign({ kind: p.kind, levels: p.levels, merged: p.merged }, p.kind === 'pair' ? { X: p.sides.X, Y: p.sides.Y, identicalSides: drawSig(p.draw.X) === drawSig(p.draw.Y), soundsTheSame: copySig(p.draw.X) === copySig(p.draw.Y) } : { S: p.sides.S, other: METHODS.find(m => m !== p.sides.S) });
    });
    keyItems[s.id] = {
      label: label, X: parts.some(p => p.kind === 'pair') ? s.x : null, Y: parts.some(p => p.kind === 'pair') ? s.y : null, source: { id: o.src.id, url: o.src.url, title: o.src.title }, inputClass: o.src.inputClass,
      heard: heardKey(o.src.heard), excerpt: { start: r.excerpt.start, end: r.excerpt.end, seconds: r.excerpt.seconds, how: r.excerpt.how, barSeconds: r.excerpt.barSeconds, drawnFrom: start, drawnTo: end },
      conversion: cv, levels: perLevel, parts: partKeys, refusals: refusals
    };
    parts.forEach(p => { if (p.kind === 'pair' && partKeys[p.key].identicalSides) log('NOTE ' + s.id + ' (' + o.src.id + ') ' + p.title + ': X and Y are drawn identically'); });
    if (cv.v2Rejected) log('NOTE ' + s.id + ' (' + o.src.id + '): the page threw the v2 conversion away (its plausibility check); the copies were made from the classic conversion');
  });

  /* no side of any part of any piece may repeat a side of ANOTHER piece (a repeated score would give the way away without the key). The two sides of one pair may be identical (the two methods
     agree): that is kept, said in the key (identicalSides) and on the console. */
  const sigs = new Map();
  pageItems.forEach(it => it.parts.forEach(p => Object.keys(p.draw).forEach(side => {
    const sg = drawSig(p.draw[side]), where = it.id + ' ' + p.key + side, had = sigs.get(sg);
    if (had && had.id !== it.id) throw new Error(where + ' is identical to ' + had.where + ' (a repeated score would reveal which is which); refusing');
    if (!had) sigs.set(sg, { id: it.id, where: where });
  })));

  const idBody = { mode: 'h10', compare: 'arrange', items: pageItems.map(i => [i.id, i.url, i.start, i.end, i.parts.map(p => [p.key, p.kind, Object.keys(p.draw).map(side => drawSig(p.draw[side]))])]) };
  const packetId = sha(JSON.stringify(idBody)).slice(0, 12);
  const html = PAGE.pageHtml({ packetId: packetId, items: pageItems, samples: helpers.readPianoSamples() });
  const manifest = { format: FORMAT, review: 'H-10c', mode: 'h10', compare: 'arrange', packetId: packetId, files: ['index.html'], items: manifestItems,
    note: 'index.html is the whole review: open it (a phone is fine), answer, and use its buttons at the end. This manifest lists what is inside.' };
  const manifestText = JSON.stringify(manifest, null, 1) + '\n';
  const warnings = [];
  const bad = LEAK.scanArrange(html, manifestText, PAGE.drawingsOf(html), { seed: seed, credit: PAGE.CREDIT, titles: pageItems.map(i => i.title) });
  if (bad.length) throw new Error('the packet would give the methods away; refusing to write it: ' + bad.slice(0, 5).join(' | '));
  LEAK.titleWarnings(pageItems.map(i => i.title)).forEach(w => { warnings.push(w); log('WARNING ' + w); });

  /* what was made and what was refused, per method and level (aggregate; the pieces are in the items) */
  const summary = {};
  METHODS.forEach(m => { summary[m] = {}; levels.forEach(l => { const list = ok.map(o => o.r.levels[l][m]); summary[m][l] = { made: list.filter(c => c.made).length, refused: list.filter(c => !c.made).length, of: list.length }; }); });
  const partCount = k => pageItems.reduce((n, it) => n + it.parts.filter(p => p.kind === k).length, 0);
  const key = {
    format: KEY_FORMAT, review: 'H-10c', mode: 'h10', compare: 'arrange', packetId: packetId, seed: seed, builtFrom: helpers.gitCommit(),
    question: QUESTION, passRule: PASS_RULE, arms: ARM_TEXT,
    parts: { B: 'beginner', I: 'intermediate', BI: 'beginner and intermediate: the same copies at both levels, drawn from beginner (the sounding notes are equal for every method that made one)' },
    assignment: 'per piece: X is the lead sheet when the piece\'s rank by HMAC-SHA256(seed, "xy|" + id) among the pieces that have a pair is even (review/lib/blind.js assignArms, balance); a piece with no pair takes its side from the parity of its own HMAC; order by HMAC(seed, "order|" + id); both levels of a piece keep the sides',
    options: { excerptBars: opts.excerptBars || null, excerptSeconds: opts.excerptSeconds || null, levels: levels, titles: opts.titles !== false },
    items: keyItems, summary: summary, shown: { pieces: pageItems.length, pairs: partCount('pair'), singles: partCount('single'), minutes: PAGE.minutesFor(pageItems) },
    inputs: { rule: 'review/README.md, "H-10c"', skipped: skipped, warnings: warnings, buildSeconds: Math.round(timeMs / 100) / 10 },
    warning: 'NEVER give this file (or its seed) to the reviewer.'
  };
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

module.exports = { buildArrange, partsOf, copySig, PASS_RULE, METHODS, LEVELS, QUESTION };
