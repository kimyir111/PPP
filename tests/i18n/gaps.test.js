/* G13-0: the mutation test of the static i18n checker (tests/i18n/gaps.js). A checker that cannot fail proves nothing, so this plants the
   mistakes it exists for in a copy of the page and the catalogs and wants it to fail on each, and pass on what is fine:
     node tests/i18n/gaps.test.js
   It runs in the gate beside `node tests/i18n/gaps.js --check` (the real tree against the committed baseline). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const gaps = require('./gaps.js');

const ROOT = path.join(__dirname, '..', '..');
const CHECKER = path.join(__dirname, 'gaps.js');
const APP = gaps.APP;
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const catalog = l => JSON.parse(read('i18n/' + l + '.json'));

/** A throwaway copy of what the checker reads, with the page text and the catalogs passed through the given edits. */
function tree({ app, catalogs, files } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-i18n-gaps-'));
  fs.mkdirSync(path.join(dir, 'i18n'));
  fs.mkdirSync(path.join(dir, 'tests', 'i18n'), { recursive: true });
  fs.writeFileSync(path.join(dir, APP), app ? app(read(APP)) : read(APP));
  for (const l of gaps.LOCALES) {
    const c = catalog(l);
    if (catalogs) catalogs(l, c.content);
    fs.writeFileSync(path.join(dir, 'i18n', l + '.json'), JSON.stringify(c));
  }
  fs.copyFileSync(path.join(ROOT, gaps.BASELINE_REL), path.join(dir, gaps.BASELINE_REL));
  for (const [rel, text] of Object.entries(files || {})) fs.writeFileSync(path.join(dir, rel), text);
  return dir;
}
const check = (dir, ...flags) => {
  const r = spawnSync(process.execPath, [CHECKER, '--root', dir, ...flags], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const cleanup = dir => fs.rmSync(dir, { recursive: true, force: true });
const withTree = (opts, fn) => { const dir = tree(opts); try { return fn(dir); } finally { cleanup(dir); } };

const PLANTED = 'A brand new sentence that nobody translated yet.';
const addScript = text => app => app + '\n<script>\nconst planted = ' + text + ';\n</script>\n';
const addTemplate = html => app => app.replace('</x-dc>', html + '\n</x-dc>');

test('the committed baseline is EMPTY (G13-2): the real tree has no gap and no parity gap, so any new one fails', () => {
  const r = check(ROOT, '--check', '--strict');
  assert.equal(r.code, 0, r.out);
  const base = JSON.parse(read(gaps.BASELINE_REL));
  assert.equal(Object.keys(base.gaps.template).length + Object.keys(base.gaps.tx).length, 0);
  assert.equal(Object.keys(base.parity).length, 0);
  const now = gaps.scan(ROOT);
  assert.equal(Object.keys(now.gaps.template).length + Object.keys(now.gaps.tx).length, 0, 'strings the page can show that a catalog lacks');
  assert.equal(Object.keys(now.parity).length, 0, 'keys of one catalog that another lacks');
});

test('an unchanged copy passes', () => withTree({}, dir => {
  const r = check(dir, '--check');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PASS: no new gap/);
}));

test('MUTATION: a new untranslated tx() literal fails, and names the string and the three locales', () => withTree({ app: addScript(`tx('${PLANTED}')`) }, dir => {
  const r = check(dir, '--check');
  assert.equal(r.code, 1, r.out);
  assert.ok(r.out.includes(PLANTED), r.out);
  for (const l of gaps.LOCALES) assert.match(r.out, new RegExp('missing in ' + l));
  assert.match(r.out, /\[tx\]/);
}));

test('MUTATION: tx() with double quotes, a backtick, and a variables argument fails too', () => {
  for (const call of [`tx("${PLANTED}")`, 'tx(`' + PLANTED + '`)', `tx('${PLANTED}', { n: 3 })`, `PPP_I18N.tx('${PLANTED}')`]) {
    withTree({ app: addScript(call) }, dir => {
      const r = check(dir, '--check');
      assert.equal(r.code, 1, call + '\n' + r.out);
      assert.ok(r.out.includes(PLANTED), call);
    });
  }
});

test('MUTATION: a new untranslated template label and a new tooltip / placeholder / aria-label fail', () => {
  for (const html of ['<div>Brand new label</div>', '<button title="Brand new tooltip">x</button>', '<input placeholder="Brand new hint">',
    '<span aria-label="Brand new reading label">x</span>', '<p>Hello {{ name }} brand new tail</p>']) {
    withTree({ app: addTemplate(html) }, dir => {
      const r = check(dir, '--check');
      assert.equal(r.code, 1, html + '\n' + r.out);
      assert.match(r.out, /\[template\]/, html);
    });
  }
});

test('MUTATION: a tx() in another shipped script of the repository is found (a new file is not skipped)', () => withTree({ files: { 'newfeature.js': `module.exports = () => tx('${PLANTED}');\n` } }, dir => {
  const r = check(dir, '--check');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /newfeature\.js:1/);
}));

test('MUTATION: a string translated in ko only still fails for ja and zh', () => withTree({
  app: addScript(`tx('${PLANTED}')`),
  catalogs: (l, content) => { if (l === 'ko-KR') content[PLANTED] = '번역됨'; }
}, dir => {
  const r = check(dir, '--check');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /missing in ja-JP/);
  assert.match(r.out, /missing in zh-CN/);
  assert.doesNotMatch(r.out, /missing in ko-KR/);
}));

test('MUTATION: a translation removed from one catalog fails (and parity too)', () => {
  const ex = gaps.extract(ROOT);
  const base = JSON.parse(read(gaps.BASELINE_REL));
  const victim = [...ex.tx.keys()].find(s => !(s in base.gaps.tx) && s in catalog('ja-JP').content);
  assert.ok(victim, 'a translated tx() string to remove');
  withTree({ catalogs: (l, content) => { if (l === 'ja-JP') delete content[victim]; } }, dir => {
    const r = check(dir, '--check');
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(victim), r.out);
    assert.match(r.out, /missing in ja-JP/);
  });
});

test('MUTATION: a key added to one catalog only is a parity gap', () => withTree({ catalogs: (l, content) => { if (l === 'ko-KR') content['Only the Korean catalog has this key'] = '한국어만'; } }, dir => {
  const r = check(dir, '--check');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /\[parity\]/);
}));

test('what is fine passes: proper nouns, URLs, symbols, a translated string, curly quotes against straight ones', () => withTree({
  app: addScript(`[tx('MIDI'), tx('PPP'), tx('https://example.com/a'), tx('12 / 34'), tx('${PLANTED}'), tx('Don\\u2019t stop')]`),
  catalogs: (l, content) => { content[PLANTED] = 'x'; content["Don't stop"] = 'y'; }
}, dir => {
  const r = check(dir, '--check');
  assert.equal(r.code, 0, r.out);
}));

test('the extractor reads the page: it finds the strings today (a checker that reads nothing would pass everything)', () => {
  const ex = gaps.extract(ROOT);
  assert.ok(ex.template.size > 100 && ex.tx.size > 700, 'the extractor reads the page: ' + ex.template.size + ' template, ' + ex.tx.size + ' tx');
  assert.ok(ex.files.includes(APP));
});

test('the baseline only shrinks: a fixed gap passes (and --strict fails), --update shrinks, and --update refuses to add', () => {
  /* the committed baseline is empty, so a tree with one planted gap and a baseline that lists it (--update --allow-new) is the starting point */
  withTree({ app: addScript(`tx('${PLANTED}')`) }, dir => {
    const file = path.join(dir, gaps.BASELINE_REL);
    let r = check(dir, '--update', '--allow-new');
    assert.equal(r.code, 0, r.out);
    assert.ok(PLANTED in JSON.parse(fs.readFileSync(file, 'utf8')).gaps.tx, 'the baseline lists the planted gap');
    assert.equal(check(dir, '--check', '--strict').code, 0);
    for (const l of gaps.LOCALES) {                                  /* translate it: the gap is fixed */
      const p = path.join(dir, 'i18n', l + '.json');
      const c = JSON.parse(fs.readFileSync(p, 'utf8'));
      c.content[PLANTED] = 'translated ' + l;
      fs.writeFileSync(p, JSON.stringify(c));
    }
    r = check(dir, '--check');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /are fixed/);
    r = check(dir, '--check', '--strict');
    assert.equal(r.code, 1, r.out);
    r = check(dir, '--update');
    assert.equal(r.code, 0, r.out);
    const shrunk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(Object.keys(shrunk.gaps.tx).length, 0);
    assert.ok(!(PLANTED in shrunk.gaps.tx));
    r = check(dir, '--check', '--strict');
    assert.equal(r.code, 0, r.out);
  });
  withTree({ app: addScript(`tx('${PLANTED}')`) }, dir => {
    const file = path.join(dir, gaps.BASELINE_REL);
    const before = fs.readFileSync(file, 'utf8');
    let r = check(dir, '--update');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /REFUSED/);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'a refused update leaves the baseline alone');
    r = check(dir, '--update', '--allow-new');
    assert.equal(r.code, 0, r.out);
    assert.equal(check(dir, '--check').code, 0);
  });
});

test('a broken baseline or page, or a page that is read as empty, is an error, not a pass', () => {
  withTree({ app: app => app.split('tx(').join('tz(') }, dir => assert.equal(check(dir, '--check').code, 2));
  withTree({}, dir => {
    fs.writeFileSync(path.join(dir, gaps.BASELINE_REL), '{ not json');
    assert.equal(check(dir, '--check').code, 1);
  });
  withTree({ app: () => 'no template here' }, dir => assert.notEqual(check(dir, '--check').code, 0));
});
