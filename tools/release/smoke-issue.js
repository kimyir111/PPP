#!/usr/bin/env node
/* G13-7a / G13-D11: the last step of .github/workflows/live-smoke.yml, run only when the daily smoke check (or a step before it) failed:

     node tools/release/smoke-issue.js <the smoke check's output file>

   Opens an issue titled "Live smoke failed" with the tail of the output, or - when one is already open - adds a comment to it (a site that stays down
   makes one issue with a comment a day, not an issue a day). It never closes anything. The workflow's token has `issues: write` and nothing else;
   the output of a smoke check holds only PASS/FAIL lines and URLs of the site (it is run with no PC code file and no secret).

   Environment: GH_TOKEN (set by the workflow), GITHUB_REPOSITORY, GITHUB_SERVER_URL, GITHUB_RUN_ID (all set by GitHub Actions).
   tests/release/smoke-issue.test.js runs it with a fake gh. */
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');

const TITLE = 'Live smoke failed';
const TAIL_LINES = 60, LINE_CHARS = 300, TAIL_CHARS = 6000;

/* the last lines of the output, short enough for an issue, with nothing that could close the fence around them */
function tailOf(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim() !== '').slice(-TAIL_LINES).map(l => l.slice(0, LINE_CHARS).replace(/```/g, "'''"));
  let out = lines.join('\n');
  if (out.length > TAIL_CHARS) out = '...\n' + out.slice(out.length - TAIL_CHARS);
  return out;
}

function bodyOf(o) {
  return [
    (o.again ? 'The daily live smoke check failed again' : 'The daily live smoke check (read-only, `node tests/live/smoke.js`) failed') + ' on ' + o.when + '.',
    '',
    '- run: ' + (o.runUrl || '(no run url)'),
    '- what it checks: `/health`, the build stamp, anonymous routes, a fresh browser profile with no page error and no failed request, the defaults of the app switches',
    '',
    o.tail ? 'Last lines of its output:' : 'The smoke check did not run or wrote no output: open the run.',
    ...(o.tail ? ['', '```', o.tail, '```'] : []),
    '',
    'Next: open the run; if the site itself is down look at the Render service `srv-dalt5s6k1f9s739cuetg`. A deploy of the commit before it is the rollback (`docs/RELEASE_CHECKLIST.md`). This issue is not closed by itself.'
  ].join('\n');
}

async function main(argv, io) {
  let text = '';
  try { text = io.readFile(argv[0]); } catch (e) { text = ''; }
  const repoArgs = io.env.GITHUB_REPOSITORY ? ['--repo', io.env.GITHUB_REPOSITORY] : [];
  const runUrl = io.env.GITHUB_RUN_ID && io.env.GITHUB_REPOSITORY
    ? (io.env.GITHUB_SERVER_URL || 'https://github.com') + '/' + io.env.GITHUB_REPOSITORY + '/actions/runs/' + io.env.GITHUB_RUN_ID : '';
  const when = io.now().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const tail = tailOf(text);

  let open = [];
  try {
    open = JSON.parse(io.gh(['issue', 'list', '--state', 'open', '--search', '"' + TITLE + '" in:title', '--json', 'number,title', '--limit', '30'].concat(repoArgs)) || '[]');
  } catch (e) { io.out('could not list the open issues (' + String(e.message).split('\n')[0] + '): opening a new one'); }
  const same = open.filter(i => i && i.title === TITLE).sort((a, b) => a.number - b.number)[0];
  if (same) {
    io.gh(['issue', 'comment', String(same.number), '--body-file', '-'].concat(repoArgs), bodyOf({ again: true, when, runUrl, tail }));
    io.out('commented on issue #' + same.number);
  } else {
    io.gh(['issue', 'create', '--title', TITLE, '--body-file', '-'].concat(repoArgs), bodyOf({ again: false, when, runUrl, tail }));
    io.out('opened a new issue: ' + TITLE);
  }
  return 0;
}

module.exports = { main, tailOf, bodyOf, TITLE };

if (require.main === module) {
  main(process.argv.slice(2), {
    env: process.env,
    out: l => console.log(l),
    now: () => new Date(),
    readFile: f => fs.readFileSync(f, 'utf8'),
    gh: (args, input) => execFileSync('gh', args, { encoding: 'utf8', timeout: 60000, input: input, stdio: ['pipe', 'pipe', 'inherit'] })
  }).then(code => process.exit(code)).catch(e => { console.error('smoke-issue crashed: ' + (e && e.stack || e)); process.exit(1); });
}
