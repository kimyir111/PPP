/* G11b-1: write the GOLDEN dump of the legacy aggregates (tests/practice/baselines/learner-legacy.json) from the page of a commit.

     node tests/practice/learner-record.js [--rev a070d70] [--upstream http://127.0.0.1:9210]

   The dump is what tests/learner-log.test.js (section `identity`) compares the page under PPP.learner 'legacy' with, byte for byte: the
   localStorage keys and the state the legacy readers use after a scripted practice session (ten laps of every kind, a seeded Math.random, the
   app's injectable clock). It must come from the page BEFORE PPP.learner existed - the last commit of main that has no `LEARNER_MODE` - so that
   the claim "the legacy aggregates are unchanged" compares the new page with the old one and not with itself. The page is read from git
   (`git show REV:Piano Coach App.dc.html`) and served through a proxy in front of this tree's server; every other file is this tree's.
   Without --upstream the tree's server is started on a free port (tests/serve-free.js). */
'use strict';
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { fileProxy } = require('./learner-proxy');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = 'Piano Coach App.dc.html';

async function main() {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const rev = opt('--rev', 'a070d70');
  const text = execFileSync('git', ['show', rev + ':' + PAGE], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  if (/LEARNER_MODE/.test(text)) throw new Error(rev + ' already has PPP.learner: the golden dump must come from the page before it');
  let upstream = opt('--upstream', null), closeUp = async () => {};
  if (!upstream) {
    const { startServer } = require('../serve-free');
    const srv = await startServer();
    upstream = new URL(srv.url).origin;
    closeUp = srv.close;
  }
  const proxy = await fileProxy(upstream, { replace: { [PAGE]: text } });
  try {
    const url = proxy.url(upstream + '/Piano%20Coach%20App.dc.html');
    const env = Object.assign({}, process.env, { LL_RECORD_URL: url });
    delete env.PPP_PORT;
    const code = await new Promise(resolve => {
      const child = spawn(process.execPath, [path.join(ROOT, 'tests', 'learner-log.test.js'), '--record'], { cwd: ROOT, env, stdio: 'inherit' });
      child.on('close', resolve);
    });
    process.exitCode = code;
  } finally {
    await proxy.close();
    await closeUp();
  }
}
main().catch(e => { console.error(e); process.exit(2); });
