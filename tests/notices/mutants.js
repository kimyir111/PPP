/* G13-3 mutation checks of the parts that are not the generator (those are the MUTANTS list of notices.test.js, in-process). A copy of the tree is made once, ONE rule is
   broken in it, the suite that should notice is run against the copy (PPP_NOTICES_ROOT, see lib.js), and the copy is put back. A mutant that survives is a rule nothing
   tests. The repository's own files are never touched.

     node tests/notices/mutants.js            run all of them (and the unbroken copy, which must pass)
     node tests/notices/mutants.js S1 P4      only these
     node tests/notices/mutants.js --node     only the server mutants (no browser needed)

   Exit code 0 when every mutant is killed. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const DIRS = ['scoregraph', 'playability', 'difficulty', 'songgraph', 'arrangement', 'realize', 'engrave', 'rec', 'candidates', 'critics', 'repair', 'omr', 'practice', 'i18n',
  'assets', 'audio', 'catalog', 'vendor', 'samples'];

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name)); else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}
function makeCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-notices-mut-'));
  for (const e of fs.readdirSync(REPO, { withFileTypes: true })) {
    if (e.isFile() && /\.(js|json|html|md|yaml|yml|py|txt)$/.test(e.name)) fs.copyFileSync(path.join(REPO, e.name), path.join(dir, e.name));
  }
  for (const d of DIRS.concat(['tools/notices'])) if (fs.existsSync(path.join(REPO, d))) copyDir(path.join(REPO, d), path.join(dir, d));
  return dir;
}

const SERVER = 'youtube-share.test.js', UI = 'notices-ui.test.js', FILES = 'notices/notices.test.js';
/* id, file, what the mutant breaks, [from, to], the test that must fail */
const M = [
  /* server.js: the guard (a policy guard, G13 doc U9) */
  ['S1', 'server.js', 'a YouTube-derived score is posted to the public list by POST (the guard is gone)',
    ["if (!guest && body.listed === true && youtubeDerivedShare(body.score, body.youtubeDerived)) {", "if (false) {"], SERVER],
  ['S2', 'server.js', 'a stored YouTube-derived share can be posted afterwards by PATCH',
    ["if (body.listed === true && !row.listed && youtubeDerivedShare(row.score, false)) {", "if (false) {"], SERVER],
  ['S3', 'server.js', 'a score with a YouTube source and no mark is refused too (a hymn with a performance to watch is not made from that audio)',
    ["return !!(src && typeof src === 'object' && src.youtubeDerived === true);", "return !!(src && typeof src === 'object' && (src.youtubeDerived === true || src.kind === 'youtube'));"], SERVER],
  ['S4', 'server.js', 'the mark inside the score is not read (a copy somebody added, a stored share)',
    ["return !!(src && typeof src === 'object' && src.youtubeDerived === true);", "return false;"], SERVER],
  ['S5', 'server.js', 'the page\'s flag is not read',
    ["if (flag === true) return true;", ""], SERVER],
  ['S6', 'server.js', 'a guest\'s link is refused too (a guest link is never listed, and stays allowed)',
    ["if (!guest && body.listed === true && youtubeDerivedShare(", "if (body.listed === true && youtubeDerivedShare("], SERVER],
  ['S7', 'server.js', 'a link send (listed left out) is refused too',
    ["if (!guest && body.listed === true && youtubeDerivedShare(", "if (!guest && body.listed !== false && youtubeDerivedShare("], SERVER],
  ['S8', 'server.js', 'a PATCH that changes nothing on an already posted share is refused (a posted share is touched)',
    ["if (body.listed === true && !row.listed && youtubeDerivedShare(", "if (body.listed === true && youtubeDerivedShare("], SERVER],
  ['S9', 'server.js', 'taking a share down is refused too',
    ["if (body.listed === true && !row.listed && youtubeDerivedShare(", "if (!row.listed === false && youtubeDerivedShare("], SERVER],
  ['S10', 'server.js', 'the refusal has no code',
    ["return jsonError(res, 403, YOUTUBE_NOT_PUBLIC, { code: 'youtube-not-public' });\n    }\n    const ownerId = guest ? guestId : user.id;", "return jsonError(res, 403, YOUTUBE_NOT_PUBLIC);\n    }\n    const ownerId = guest ? guestId : user.id;"], SERVER],
  ['S11', 'server.js', 'the notices file is sent as a download (text/markdown), not shown',
    ["'.md': 'text/plain; charset=utf-8'", "'.md': 'text/markdown; charset=utf-8'"], FILES],
  ['S12', 'static-allow.js', 'the notices file is not on the served list',
    ["  'THIRD_PARTY_NOTICES.md'\n]);", "  'THIRD_PARTY_NOTICES.mdx'\n]);"], FILES],
  /* the page */
  ['P1', 'Piano Coach App.dc.html', 'the About & licences section is not in Settings',
    ["<div data-about-section style=", "<div data-about-removed style="], UI],
  ['P2', 'Piano Coach App.dc.html', 'the CC BY attribution is not in the section',
    ["aboutSounds: tx('Piano sounds: Salamander Grand Piano V3 by Alexander Holm, licensed under CC BY 3.0. Notes longer than nine seconds are shortened.'),", "aboutSounds: '',"], UI],
  ['P3', 'Piano Coach App.dc.html', 'the licence notices file is not linked',
    ["aboutNoticesHref: './THIRD_PARTY_NOTICES.md',", "aboutNoticesHref: '#',"], UI],
  ['P4', 'Piano Coach App.dc.html', 'the rights notice is not where the YouTube link is entered',
    ["<div data-youtube-notice style=", "<div data-youtube-removed style="], UI],
  ['P5', 'Piano Coach App.dc.html', 'no song is taken for a YouTube one',
    ["youtubeDerivedOf(songId, seen) {\n    seen = seen || {};", "youtubeDerivedOf(songId, seen) {\n    return false;\n    seen = seen || {};"], UI],
  ['P6', 'Piano Coach App.dc.html', 'an arrangement is not followed to the song it was made from',
    ["return parent ? this.youtubeDerivedOf(parent, seen) : false;", "return false;"], UI],
  ['P7', 'Piano Coach App.dc.html', 'the page does not say in the payload that the song is a YouTube one',
    ["      youtubeDerived: ytDerived ? true : undefined\n", "      youtubeDerived: undefined\n"], UI],
  ['P8', 'Piano Coach App.dc.html', 'the copy that is sent carries no mark',
    ["if (this.youtubeDerivedOf(songId)) out.source = Object.assign({}, out.source, { youtubeDerived: true });", ""], UI],
  ['P9', 'Piano Coach App.dc.html', 'a copy somebody adds loses the mark',
    ["      if (ytMark) score.source.youtubeDerived = true;\n", ""], UI],
  ['P10', 'Piano Coach App.dc.html', 'the Post button is not turned off',
    ["sharePostDisabled: ytBlocked,", "sharePostDisabled: false,"], UI],
  ['P11', 'Piano Coach App.dc.html', 'a share that is posted cannot be taken down (blocked whether posted or not)',
    ["const ytBlocked = !posted && !!t.card && this.youtubeDerivedOf(t.card.id);", "const ytBlocked = !!t.card && this.youtubeDerivedOf(t.card.id);"], UI],
  ['P12', 'Piano Coach App.dc.html', 'an arrangement made by the page does not take the mark of its source',
    ["    if (this.youtubeDerivedOf(d.songId)) source.youtubeDerived = true;\n", ""], UI],
  ['P13', 'Piano Coach App.dc.html', 'every score with a YouTube source is taken for a transcription (a hymn with a performance to watch is blocked)',
    ["if ((src.kind || (card && card.kind)) === 'youtube' && inferredAudioNotation(src)) return true;", "if ((src.kind || (card && card.kind)) === 'youtube') return true;"], UI],
  ['P15', 'Piano Coach App.dc.html', 'a copy that only has a YouTube source gets the mark when it is added (a hymn is blocked in the hands of whoever adds it)',
    ["const ytMark = !!(score.source && score.source.youtubeDerived === true);", "const ytMark = !!(score.source && (score.source.youtubeDerived === true || score.source.kind === 'youtube'));"], UI],
  ['P14', 'Piano Coach App.dc.html', 'the page posts it anyway when asked (the client does not stop a post)',
    ["    if (ytDerived && listed === true) return Promise.reject(new Error(tx('A score made from a YouTube link cannot be posted to Shared Scores. You can still send its link.')));\n", ""], UI]
];

function applyEdit(dir, file, from, to) {
  const f = path.join(dir, file);
  const src = fs.readFileSync(f, 'utf8');
  const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
  if (src.indexOf(from) < 0 && src.indexOf(CR + LF) >= 0) { from = from.split(LF).join(CR + LF); to = to.split(LF).join(CR + LF); }
  const i = src.indexOf(from);
  if (i < 0 || src.indexOf(from, i + 1) >= 0) throw new Error(file + ': the text to break is ' + (i < 0 ? 'not in the file: ' : 'more than once in the file: ') + JSON.stringify(from.slice(0, 90)));
  fs.writeFileSync(f, src.slice(0, i) + to + src.slice(i + from.length));
  return src;
}
function runTest(dir, test) {
  const isNodeTest = /\.test\.js$/.test(test) && !/ui/.test(test);
  const args = isNodeTest ? ['--test', path.join(REPO, 'tests', test)] : [path.join(REPO, 'tests', test)];
  const r = spawnSync(process.execPath, args, { env: Object.assign({}, process.env, { PPP_NOTICES_ROOT: dir }), encoding: 'utf8', timeout: 400000, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function main() {
  const args = process.argv.slice(2);
  const only = args.filter(a => !a.startsWith('--'));
  const nodeOnly = args.includes('--node');
  const picked = M.filter(m => (!only.length || only.includes(m[0])) && (!nodeOnly || m[4] !== UI));
  const dir = makeCopy();
  let bad = 0;
  try {
    if (!only.length) {
      for (const t of nodeOnly ? [SERVER, FILES] : [SERVER, FILES, UI]) {
        const r = runTest(dir, t);
        console.log((r.status === 0 ? 'ok      ' : 'FAILED  ') + 'unbroken copy: ' + t);
        if (r.status !== 0) { bad++; console.log(r.out.split('\n').slice(-25).join('\n')); }
      }
    }
    for (const m of picked) {
      const [id, file, what, [from, to], test] = m;
      let original;
      try { original = applyEdit(dir, file, from, to); } catch (e) {
        console.log('STALE    ' + id + ': ' + e.message);
        bad++;
        continue;
      }
      let r;
      try { r = runTest(dir, test); } finally { fs.writeFileSync(path.join(dir, file), original); }
      const killed = r.status !== 0;
      console.log((killed ? 'killed  ' : 'SURVIVED') + ' ' + id + ': ' + what + ' (' + test + ')');
      if (!killed) bad++;
    }
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* stays */ } }
  console.log(bad ? '\n' + bad + ' problem(s)' : '\nevery mutant was killed');
  process.exit(bad ? 1 : 0);
}
main();
