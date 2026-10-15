#!/usr/bin/env node
/* G13-S1: with PPP.sync 'off' (the default) the page is the page of origin/main: Home, Practice and Settings, in English and in Korean, the rendered DOM of this tree
   against the DOM of a git archive of a ref (default origin/main), each served by its own server.js on a free port, with the same visit made twice of this tree as the noise
   floor (tests/load-app/dom-identity.js does the comparing).

     node tests/sync-page/off-identity.js [ref]

   By hand, not in CI: against main it says that THIS change does not touch the page with the switch off, which is a statement about a change, not about the tree (another
   change that draws something new would fail it on every branch that has not merged it). Exit 0 when every screen is identical. Needs git, tar and puppeteer. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
process.env.PPP_PORT_RANGE = process.env.PPP_PORT_RANGE || '10850-10899';
const { startServer } = require('../serve-free.js');

const REPO = path.resolve(__dirname, '..', '..');
const ref = process.argv[2] || 'origin/main';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-off-identity-'));
  let a = null, b = null, failed = false;
  try {
    const tar = path.join(dir, 'tree.tar');
    const r1 = spawnSync('git', ['archive', '--format=tar', '-o', tar, ref], { cwd: REPO, encoding: 'utf8' });
    if (r1.status !== 0) { console.error('git archive ' + ref + ' failed: ' + (r1.stderr || '').slice(0, 200)); process.exit(2); }
    const tree = path.join(dir, 'tree');
    fs.mkdirSync(tree);
    const r2 = spawnSync('tar', ['-xf', tar, '-C', tree], { encoding: 'utf8' });
    if (r2.status !== 0) { console.error('tar failed: ' + (r2.stderr || '').slice(0, 200)); process.exit(2); }
    a = await startServer({});
    b = await startServer({ root: tree });
    const base = u => u.replace(/\/[^/]*$/, '');
    console.log('this tree ' + base(a.url) + ', ' + ref + ' ' + base(b.url));
    for (const loc of ['en-US', 'ko-KR']) {
      const r = spawnSync(process.execPath, [path.join(REPO, 'tests', 'load-app', 'dom-identity.js'), base(a.url), base(b.url), '--locale', loc, '--twice'], { env: process.env, encoding: 'utf8', timeout: 600000 });
      console.log('--- ' + loc + ' (exit ' + r.status + ')\n' + (r.stdout || '') + (r.stderr || ''));
      if (r.status !== 0) failed = true;
    }
  } finally {
    if (a) await a.close();
    if (b) await b.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the temp folder stays */ }
  }
  console.log(failed ? 'DIFFERENT' : 'IDENTICAL: the page with the switch off is ' + ref + '\'s');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
