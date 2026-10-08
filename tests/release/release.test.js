/* G13-7a / G13-D12: tools/release/release.js and tools/release/smoke-issue.js, driven with a fake gh, a fake render, a fake page and a fake smoke check.
   No network, no process started, no file of the repository written.

     node tests/release/release.test.js

   PPP_RELEASE_MODULE / PPP_SMOKE_ISSUE_MODULE: the modules under test (default: the repository's); tests/release/mutants.js points them at copies with one rule
   broken and demands that this file then fails.

   What it holds: a commit that is not in main refuses (also when GitHub does not say), unless --allow-unmerged; every gh call names the repository; the gate is read with
   filter=all and only a check run named exactly gate of GitHub Actions counts; a | or a backtick in a smoke failure cannot break the row; a redeploy waits for the status
   `live` of its deploy; the live-smoke workflow keeps its guards. A green gate goes ahead (dry run: only the plan; --confirm: deploy, wait, smoke, row, in that order); a red, pending, missing, unreadable or
   cancelled gate refuses and nothing is deployed; a sha under 7 characters refuses before anything is asked; a failed smoke check exits 1 and prints the rollback
   command with the sha that was live; a deploy that failed or never went live stops with no smoke check; the row has the columns of the table. */
'use strict';
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..', '..');
const R = require(process.env.PPP_RELEASE_MODULE ? path.resolve(process.env.PPP_RELEASE_MODULE) : path.join(REPO, 'tools', 'release', 'release.js'));
const S = require(process.env.PPP_SMOKE_ISSUE_MODULE ? path.resolve(process.env.PPP_SMOKE_ISSUE_MODULE) : path.join(REPO, 'tools', 'release', 'smoke-issue.js'));

let failed = 0, passed = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (cond || !detail ? '' : ' - ' + String(detail).slice(0, 600)));
  if (cond) passed++; else failed++;
};
const heading = t => console.log('\n-- ' + t + ' --');

const SERVICE = 'srv-dalt5s6k1f9s739cuetg';
const NEW = '1234567' + 'a'.repeat(33);        /* the commit to release */
const OLD = 'b727ada' + '0'.repeat(33);        /* the commit that is live */
const ROOT = '/repo';
const RELEASES = ROOT + '/RELEASES.md';
const TABLE_HEAD = '| Date (UTC) | Commit | Deploy | What changed | Rollback to | Smoke / verified | Phone cold (FCP / ready / KB) |';
/* a copy of the top of the real releases table (the test does not open the real file: it is not an input of the gate) */
const TABLE = [
  '# Releases', '', 'Intro text.', '',
  TABLE_HEAD,
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| 2026-10-08 05:55 | `b727ada` | `dep-db3j0g8m7kps73et2v60` | Score view: My Songs opens a song on its whole score (#219) | `3567e27` | `smoke.js --sha b727ada`: 15 checks passed (G13-0, 2026-10-08) | 8.6 s / 9.0 s / 1,407 KB |',
  '| 2026-10-07 18:02 | `3567e27` | `dep-db38ijrncjis73eqj9ng` | G10b-5: the PC button is always findable (#218) | `7ec61cb` | - | - |',
  '', '## Where these rows come from', '', 'Text.', ''
];
const GREEN = [{ id: 11, name: 'gate', status: 'completed', conclusion: 'success', completed_at: '2026-10-08T05:00:00Z', app: { slug: 'github-actions' } }];
const REPO_SLUG = 'kimyir111/PPP';
const PASS_OUT = 'PASS /health answers ok\nPASS the live build is the expected commit\n\nSMOKE PASSED: 15 checks\n';

/* a world: the fake outside of release.js and the record of what it did */
function world(over) {
  const w = Object.assign({
    gate: GREEN, ghFails: false, live: 'b727ada', liveAfter: '1234567', pollsBeforeLive: 2, compare: 'behind', compareFails: false, deployStatusBefore: null, listsBeforeLive: 0,
    smoke: { code: 0, out: PASS_OUT }, deployStatus: 'live', createFails: false, createStillDeploys: false, env: {}, eol: '\n',
    message: 'Merge pull request #231 from kimyir111/g13-7a-monitoring\n\nG13-7a: monitoring and release tooling\n\nbody', tableOk: true
  }, over || {});
  w.log = []; w.out = []; w.clock = Date.parse('2026-10-08T07:00:00Z'); w.created = null; w.pollsAfter = 0; w.fetches = 0; w.listsAfter = 0; w.ghPaths = []; w.ghApiOutside = [];
  w.files = {}; w.files[RELEASES] = w.tableOk ? TABLE.join(w.eol) : 'Releases with no table\n';
  const commit = ref => {
    const full = [NEW, OLD].find(f => f.startsWith(ref));
    if (!full) throw new Error('HTTP 404: No commit found for SHA: ' + ref);
    return { sha: full, commit: { message: full === NEW ? w.message : 'older commit' } };
  };
  w.io = {
    root: ROOT, env: w.env,
    out: l => w.out.push(String(l)),
    now: () => new Date(w.clock),
    sleep: async ms => { w.clock += ms; },
    gh: args => {
      const p = String(args[1]);
      w.ghPaths.push(p);
      if (args[0] !== 'api' || !p.startsWith('repos/' + (w.repoExpected || REPO_SLUG) + '/')) w.ghApiOutside.push(args.join(' '));
      w.log.push('gh ' + p.replace(/^repos\/[^/]+\/[^/]+\//, ''));
      if (w.ghFails && /check-runs/.test(p)) throw new Error('HTTP 502');
      if (w.compareFails && /\/compare\//.test(p)) throw new Error('HTTP 502');
      let m;
      if ((m = /\/commits\/([0-9a-f]+)\/check-runs\?check_name=gate/.exec(p))) return JSON.stringify({ total_count: w.gate.length, check_runs: w.gate });
      if ((m = /\/compare\/main\.\.\.([0-9a-f]{40})$/.exec(p))) return JSON.stringify({ status: w.compare });
      if ((m = /\/commits\/([0-9a-f]+)$/.exec(p))) return JSON.stringify(commit(m[1]));
      throw new Error('unexpected gh call ' + p);
    },
    render: args => {
      w.log.push('render ' + args.join(' '));
      if (args[0] === 'deploys' && args[1] === 'create') {
        w.createArgs = args;
        if (w.createFails && !w.createStillDeploys) throw Object.assign(new Error('render: not logged in'), { stdout: '' });
        w.created = { commit: { id: args[args.indexOf('--commit') + 1] }, createdAt: new Date(w.clock).toISOString().replace(/\.\d+Z$/, '.123456Z'), id: 'dep-new1', status: w.deployStatus };
        if (w.createFails) throw Object.assign(new Error('exit 1'), { stdout: 'streaming logs...' });
        return 'Deploy dep-new1 created\n';
      }
      if (args[0] === 'deploys' && args[1] === 'list') {
        const old = { commit: { id: OLD }, createdAt: '2026-10-08T05:55:14.048061Z', id: 'dep-old0', status: 'live' };
        if (w.created) {
          w.listsAfter++;
          if (w.deployStatusBefore) w.created.status = w.listsAfter > w.listsBeforeLive ? w.deployStatus : w.deployStatusBefore;
        }
        return JSON.stringify(w.created ? [w.created, old] : [old]);
      }
      throw new Error('unexpected render call ' + args.join(' '));
    },
    fetchBuild: async () => {
      w.fetches++;
      if (!w.created) return w.live;
      w.pollsAfter++;
      return w.pollsAfter > w.pollsBeforeLive ? w.liveAfter : w.live;
    },
    smoke: async args => { w.log.push('smoke ' + args.join(' ')); w.smokeArgs = args; return w.smoke; },
    readFile: f => { if (!(f in w.files)) throw new Error('ENOENT ' + f); return w.files[f]; },
    writeFile: (f, s) => { w.files[f] = s; w.log.push('write'); }
  };
  return w;
}
async function run(argv, over) {
  const w = world(over);
  w.code = await R.main(argv.concat(['--releases-file', RELEASES]), w.io);
  w.text = w.out.join('\n');
  return w;
}
const did = (w, re) => w.log.some(l => re.test(l));
const index = (w, re) => w.log.findIndex(l => re.test(l));
const DEPLOY_NEW = 'render deploys create ' + SERVICE + ' --commit ' + NEW + ' --confirm';
const DEPLOY_OLD = 'render deploys create ' + SERVICE + ' --commit ' + OLD + ' --confirm';
const cellsOf = line => line.replace(/^\|\s*|\s*\|$/g, '').replace(/\\\|/g, '\u0001').split(' | ').map(c => c.replace(/\u0001/g, '|'));

(async () => {
  heading('a green gate: the dry run');
  {
    const w = await run([NEW.slice(0, 7)]);
    ok('exit 0, and it says nothing was changed', w.code === 0 && /DRY RUN: nothing was changed/.test(w.text), w.code + ' ' + w.text);
    ok('the short sha was resolved to the 40 characters, and the gate of those 40 was read with filter=all', did(w, /^gh commits\/1234567$/) && did(w, new RegExp('^gh commits/' + NEW + '/check-runs\\?check_name=gate&filter=all&per_page=100$')), w.log.join(' / '));
    ok('every gh call is `gh api repos/kimyir111/PPP/...`: the repository is named, not taken from the directory', w.ghPaths.length >= 4 && w.ghApiOutside.length === 0, w.ghApiOutside.join(' | '));
    ok('no deploy, no smoke check, no file written', !did(w, /^render deploys create/) && !did(w, /^smoke/) && !did(w, /^write/) && w.files[RELEASES] === TABLE.join('\n'));
    ok('the plan names the full commit, the live build, and the rollback command with the FULL 40-character sha that is live now', w.text.includes('commit    ' + NEW) && w.text.includes('live now  b727ada') && w.text.includes('ROLLBACK  ' + DEPLOY_OLD), w.text);
    ok('the plan shows the deploy command it would run, and the pull request title as the row\'s text', w.text.includes('deploy    ' + DEPLOY_NEW) && w.text.includes('G13-7a: monitoring and release tooling (#231)'), w.text);
    ok('it says the commit is in the history of main', /merged    in the history of main/.test(w.text));
  }

  heading('a commit that is not in main refuses (also when GitHub does not say)');
  for (const st of ['ahead', 'diverged', 'something-new']) {
    const dry = await run([NEW], { compare: st });
    const real = await run([NEW, '--confirm'], { compare: st });
    ok('compare says "' + st + '": REFUSED in the dry run and with --confirm, nothing deployed, the live page not even read', dry.code === 1 && real.code === 1 && /REFUSED: commit 1234567 is not in the history of main \(compare says /.test(real.text) && !did(real, /^render/) && !did(real, /^smoke/) && real.fetches === 0, real.code + ' ' + real.text);
  }
  {
    const w = await run([NEW, '--confirm'], { compareFails: true });
    ok('GitHub gives no answer to the comparison ("could not tell"): REFUSED too', w.code === 1 && /GitHub did not say/.test(w.text) && !did(w, /^render/) && w.fetches === 0, w.text);
    for (const st of ['identical', 'behind']) {
      const v = await run([NEW, '--confirm'], { compare: st });
      ok('compare says "' + st + '": goes ahead', v.code === 0 && did(v, /^render deploys create/) && /merged    in the history of main/.test(v.text), v.text);
    }
  }
  {
    const w = await run([NEW, '--confirm', '--allow-unmerged'], { compare: 'diverged' });
    ok('--allow-unmerged goes ahead with a loud warning (in the plan and again right before the deploy)', w.code === 0 && did(w, /^render deploys create/) && (w.text.match(/!!!/g) || []).length >= 4 && /NOT IN MAIN \(diverged\)/.test(w.text) && /WARNING: 1234567 is NOT in the history of main/.test(w.text), w.text);
    const v = await run([NEW, '--confirm', '--allow-unmerged'], { compareFails: true });
    ok('--allow-unmerged also when GitHub gave no answer', v.code === 0 && /NOT IN MAIN \(no answer\)/.test(v.text) && did(v, /^render deploys create/), v.text);
    const merged = await run([NEW, '--confirm', '--allow-unmerged']);
    ok('--allow-unmerged on a merged commit prints no warning', merged.code === 0 && !/!!!/.test(merged.text));
    const gate = await run([NEW, '--confirm', '--allow-unmerged'], { gate: [{ id: 3, name: 'gate', status: 'completed', conclusion: 'failure' }] });
    ok('--allow-unmerged does not lift the gate', gate.code === 1 && !did(gate, /^render/));
  }

  heading('a green gate: --confirm does the six steps in order');
  {
    const w = await run([NEW, '--confirm']);
    ok('exit 0', w.code === 0, w.code + '\n' + w.text);
    ok('render was called once, with exactly: deploys create <service> --commit <40 chars> --confirm', w.log.filter(l => /^render deploys create/.test(l)).length === 1 && w.createArgs.join(' ') === 'deploys create ' + SERVICE + ' --commit ' + NEW + ' --confirm', w.createArgs && w.createArgs.join(' '));
    const order = ['gh commits/' + NEW + '/check-runs', 'render deploys create', 'smoke', 'write'].map(p => index(w, new RegExp('^' + p.replace(/[/]/g, '\\/'))));
    ok('the order is: gate read, deploy created, smoke check, row written', order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3], JSON.stringify(order));
    ok('it waited for the page: 3 polls (2 still on the old build, the 3rd the new one), with the clock moved by sleeps, not by a busy loop', w.pollsAfter === 3 && w.clock - Date.parse('2026-10-08T07:00:00Z') >= 20000 + 2 * 15000, w.pollsAfter + ' polls');
    ok('the smoke check got --sha <40>, --logs and the site (and no --pc-code-file)', w.smokeArgs.join(' ') === '--sha ' + NEW + ' --logs --site https://ppp-web-2o99.onrender.com', w.smokeArgs.join(' '));
    ok('the plan was printed before the deploy (it is the first thing said)', w.out[0].startsWith('release plan for ' + SERVICE));
    const rows = w.files[RELEASES].split('\n');
    const sep = rows.findIndex(l => /^\| -+ \|/.test(l));
    const added = rows[sep + 1];
    ok('one row was added, directly under the separator (newest first), and the other rows are as they were', rows.length === TABLE.length + 1 && rows.slice(0, sep + 1).join('\n') === TABLE.slice(0, sep + 1).join('\n') && rows.slice(sep + 2).join('\n') === TABLE.slice(sep + 1).join('\n'), added);
    const c = cellsOf(added);
    ok('the row has the 7 columns of the table', c.length === 7 && c.length === cellsOf(TABLE_HEAD).length, c.length + ': ' + added);
    ok('the row: date (UTC, the deploy\'s creation minute), `commit` (7), `deploy id`, what changed, `rollback` (7), smoke text, phone cold -', /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(c[0]) && c[0] === '2026-10-08 07:00' && c[1] === '`1234567`' && c[2] === '`dep-new1`' && c[3] === 'G13-7a: monitoring and release tooling (#231)' && c[4] === '`b727ada`' && c[5] === '`smoke.js --sha 1234567 --logs`: 15 checks passed (release.js, 2026-10-08)' && c[6] === '-', JSON.stringify(c));
    ok('it says to commit the row', /Commit the new row/.test(w.text));
  }
  {
    const w = await run([NEW.slice(0, 9).toUpperCase(), '--confirm']);
    ok('a 9-character sha (any case) is resolved: Render still gets the 40 characters', w.code === 0 && w.createArgs.join(' ') === 'deploys create ' + SERVICE + ' --commit ' + NEW + ' --confirm', w.createArgs && w.createArgs.join(' '));
  }
  {
    const w = await run([NEW, '--confirm'], { eol: '\r\n' });
    ok('a releases file with CRLF line ends keeps them (no mixed endings)', w.code === 0 && !/[^\r]\n/.test(w.files[RELEASES]) && w.files[RELEASES].split('\r\n').length === TABLE.length + 1);
  }
  {
    const w = await run([NEW, '--confirm', '--pc-code-file', 'D:/secret/pc-code.txt', '--what', 'a | b']);
    ok('--pc-code-file is passed on to the smoke check as a path (the file is never opened here); --what overrides the text, and a | in it is escaped', w.smokeArgs.join(' ').endsWith('--pc-code-file D:/secret/pc-code.txt') && w.files[RELEASES].includes('| a \\| b |') && w.files[RELEASES].includes('--logs --pc-code-file`: 15 checks'), w.smokeArgs.join(' '));
  }
  {
    const w = await run([NEW, '--confirm', '--what', 'x'], { message: 'Fix the thing (#5)\n\n* detail' });
    ok('a squash commit\'s first line is the text as it is', R.whatChanged('Fix the thing (#5)\n\n* detail') === 'Fix the thing (#5)' && w.code === 0);
  }

  heading('the gate is the first thing: no gate, a pending, a red, an unreadable one refuses and nothing is deployed');
  const refused = async (name, over, re) => {
    const w = await run([NEW, '--confirm'], over);
    ok(name + ': exit 1, REFUSED, nothing deployed, no smoke check, no row', w.code === 1 && /REFUSED/.test(w.text) && (!re || re.test(w.text)) && !did(w, /^render/) && !did(w, /^smoke/) && !did(w, /^write/) && w.fetches === 0, w.code + ' ' + w.text + ' | ' + w.log.join(' / '));
  };
  await refused('a RED gate (failure)', { gate: [{ id: 3, name: 'gate', status: 'completed', conclusion: 'failure' }] }, /concluded failure/);
  await refused('a CANCELLED gate', { gate: [{ id: 3, name: 'gate', status: 'completed', conclusion: 'cancelled' }] }, /concluded cancelled/);
  await refused('a TIMED OUT gate', { gate: [{ id: 3, name: 'gate', status: 'completed', conclusion: 'timed_out' }] }, /timed_out/);
  await refused('a SKIPPED gate', { gate: [{ id: 3, name: 'gate', status: 'completed', conclusion: 'skipped' }] }, /skipped/);
  await refused('a completed gate with no conclusion', { gate: [{ id: 3, name: 'gate', status: 'completed', conclusion: null }] }, /not success/);
  await refused('a gate still IN PROGRESS', { gate: [{ id: 3, name: 'gate', status: 'in_progress', conclusion: null }] }, /pending/);
  await refused('a QUEUED gate', { gate: [{ id: 3, name: 'gate', status: 'queued', conclusion: null }] }, /pending/);
  await refused('NO gate check run at all (missing = pending)', { gate: [] }, /no check run named gate/);
  await refused('check runs but none called gate (a shard is not the verdict)', { gate: [{ id: 4, name: 'shard-a', status: 'completed', conclusion: 'success' }, { id: 5, name: 'plan', status: 'completed', conclusion: 'success' }] }, /no check run named gate/);
  await refused('a gate that cannot be read (gh fails)', { ghFails: true }, /could not be read/);
  {
    const w = await run(['deadbeef', '--confirm']);
    ok('a sha GitHub cannot resolve refuses (nothing deployed)', w.code === 1 && /cannot resolve/.test(w.text) && !did(w, /^render/), w.text);
  }
  {
    const w = await run([NEW, '--confirm'], { gate: [{ id: 5, name: 'gate', status: 'completed', conclusion: 'success' }, { id: 9, name: 'gate', status: 'completed', conclusion: 'failure' }] });
    ok('two gate runs: the NEWEST decides - an older green one does not save a newer red one', w.code === 1 && /concluded failure/.test(w.text) && !did(w, /^render/), w.text);
    const v = await run([NEW, '--confirm'], { gate: [{ id: 5, name: 'gate', status: 'completed', conclusion: 'failure' }, { id: 9, name: 'gate', status: 'completed', conclusion: 'success' }] });
    ok('and a re-run that went green after a red one is green', v.code === 0 && did(v, /^render deploys create/), v.text);
  }

  heading('the sha: under 7 characters (or not hex) refuses before anything is asked');
  for (const bad of ['abc123', 'a', 'zzzzzzz', '1234567g', NEW + 'a']) {
    const w = await run([bad, '--confirm']);
    ok('"' + bad.slice(0, 12) + '": exit 2, no gh call, no render call', w.code === 2 && w.log.length === 0 && /not a commit sha/.test(w.text), w.code + ' ' + w.text);
  }
  {
    const none = await run(['--confirm']);
    const two = await run([NEW, OLD]);
    const unknown = await run([NEW, '--force']);
    ok('no sha, two shas, an unknown option: exit 2 and nothing asked', none.code === 2 && two.code === 2 && unknown.code === 2 && none.log.length + two.log.length + unknown.log.length === 0);
  }

  heading('--confirm is the only way to deploy');
  {
    const w = await run([NEW]);
    ok('without --confirm a green gate still deploys nothing', w.code === 0 && !did(w, /^render deploys create/) && !did(w, /^smoke/));
    const ci = await run([NEW, '--confirm'], { env: { GITHUB_ACTIONS: 'true' } });
    ok('--confirm inside GitHub Actions (or CI) is refused: a person deploys', ci.code === 1 && /person at a terminal/.test(ci.text) && !did(ci, /^render deploys create/) && ci.log.length === 0, ci.text);
    const ci2 = await run([NEW], { env: { CI: 'true' } });
    ok('the dry run is allowed there', ci2.code === 0);
  }

  heading('the live build: the rollback needs it');
  {
    const w = await run([NEW, '--confirm'], { live: null });
    ok('a page that shows no build refuses (no rollback target) and deploys nothing', w.code === 1 && /nothing to roll back to/.test(w.text) && !did(w, /^render deploys create/), w.text);
    const v = await run([NEW, '--confirm', '--rollback', OLD.slice(0, 10)], { live: null });
    ok('--rollback <sha> names the target (resolved to 40 characters) and it goes ahead', v.code === 0 && v.text.includes('ROLLBACK  ' + DEPLOY_OLD) && did(v, /^render deploys create/), v.text);
    const same = await run([NEW, '--confirm'], { live: '1234567' });
    ok('the commit is already live: refused, unless --redeploy', same.code === 1 && /already live/.test(same.text) && !did(same, /^render deploys create/));
    const re = await run([NEW, '--confirm', '--redeploy'], { live: '1234567', liveAfter: '1234567', deployStatusBefore: 'build_in_progress', listsBeforeLive: 3 });
    const smokeAt = index(re, /^smoke/), listsBefore = re.log.slice(0, smokeAt).filter(l => /^render deploys list/.test(l)).length;
    ok('--redeploy: the page already shows the build, so it waits for Render to say the new deploy is live (3 lists still building, then live) and only then runs the smoke check', re.code === 0 && smokeAt > 0 && listsBefore >= 5 && re.listsAfter >= 5 && /the deploy is build_in_progress/.test(re.text), listsBefore + ' lists before the smoke check: ' + re.text);
    const stuck = await run([NEW, '--confirm', '--redeploy', '--timeout-min', '1'], { live: '1234567', liveAfter: '1234567', deployStatusBefore: 'build_in_progress', listsBeforeLive: 1e9 });
    ok('--redeploy of a deploy that stays building: gives up after the timeout, no smoke check, no row', stuck.code === 1 && !did(stuck, /^smoke/) && !did(stuck, /^write/) && /did not become 1234567 within 1 minutes/.test(stuck.text), stuck.text);
    const failedRe = await run([NEW, '--confirm', '--redeploy'], { live: '1234567', liveAfter: '1234567', deployStatusBefore: 'build_in_progress', listsBeforeLive: 1, deployStatus: 'update_failed' });
    ok('--redeploy of a deploy that fails: stops with the failure, no smoke check', failedRe.code === 1 && /FAILED on Render \(status update_failed\)/.test(failedRe.text) && !did(failedRe, /^smoke/), failedRe.text);
    const normal = await run([NEW, '--confirm']);
    ok('a normal release does not ask Render at every poll (the page is enough)', normal.code === 0 && normal.log.filter(l => /^render deploys list/.test(l)).length <= 3, normal.log.filter(l => /^render deploys list/.test(l)).length + ' lists');
  }

  heading('the smoke check fails: exit 1, the rollback command again, a row that says so');
  {
    const w = await run([NEW, '--confirm'], { smoke: { code: 1, out: 'PASS a\nFAIL a fresh profile has no failed request (4xx/5xx)  - 500 https://x/y\n\nSMOKE FAILED: 1 of 15\n' } });
    ok('exit 1', w.code === 1, w.code + '');
    ok('"SMOKE FAILED" and the rollback command with the full sha of the build that was live are printed', /SMOKE FAILED/.test(w.text) && w.text.split('\n').some(l => l.trim() === DEPLOY_OLD), w.text);
    const row = w.files[RELEASES].split('\n').find(l => l.startsWith('| 2026-10-08 07:00'));
    ok('the row is still written (the deploy happened) with **FAILED**, the count and the first failing check', row && /\*\*FAILED\*\* 1 of 15/.test(row) && /fresh profile has no failed request/.test(row) && cellsOf(row).length === 7, row);
    const crash = await run([NEW, '--confirm'], { smoke: { code: 2, out: 'smoke crashed: Error' } });
    ok('a smoke check that crashed (exit 2, no summary) is a failure too, and the row says it did not finish', crash.code === 1 && /did not finish\*\* \(exit 2\)/.test(crash.files[RELEASES]) && /Roll back with/.test(crash.text));
    const silent = await run([NEW, '--confirm'], { smoke: { code: 0, out: 'nothing recognisable' } });
    ok('exit 0 with no "SMOKE PASSED" line is not written down as a pass', /did not finish/.test(silent.files[RELEASES]));
  }

  heading('the deploy does not go live');
  {
    const w = await run([NEW, '--confirm'], { pollsBeforeLive: 1e9, deployStatus: 'update_failed' });
    ok('Render says update_failed: it stops at once (after 3 polls), no smoke check, exit 1, the rollback is printed', w.code === 1 && /FAILED on Render \(status update_failed\)/.test(w.text) && !did(w, /^smoke/) && w.pollsAfter === 3 && w.text.includes(DEPLOY_OLD), w.pollsAfter + ' polls: ' + w.text);
    const row = w.files[RELEASES].split('\n').find(l => l.startsWith('| 2026-10-08 07:00'));
    ok('and the row records it: update_failed, never live, rollback n/a', row && /update_failed/.test(row) && /never live/.test(row) && cellsOf(row)[4] === 'n/a', row);
  }
  {
    const w = await run([NEW, '--confirm', '--timeout-min', '1'], { pollsBeforeLive: 1e9, deployStatus: 'build_in_progress' });
    ok('a build that is just slow: gives up after --timeout-min, exit 1, no smoke check, NO row, the old build is named, the rollback is printed', w.code === 1 && /did not become 1234567 within 1 minutes/.test(w.text) && !did(w, /^smoke/) && !did(w, /^write/) && w.text.includes(DEPLOY_OLD) && w.pollsAfter < 10, w.pollsAfter + ' polls: ' + w.text);
  }
  {
    const w = await run([NEW, '--confirm'], { createFails: true });
    ok('render fails and no deploy exists: "NOT created", exit 1, nothing waited for, no smoke check', w.code === 1 && /deploy was NOT created/.test(w.text) && !did(w, /^smoke/) && w.fetches === 1 && !did(w, /^write/), w.text);
    const v = await run([NEW, '--confirm'], { createFails: true, createStillDeploys: true });
    ok('render ends with an error but the deploy is there (it streamed the build\'s logs): carries on, waits, checks', v.code === 0 && did(v, /^smoke/) && /ended with an error after it started/.test(v.text), v.text);
  }

  heading('the releases file');
  {
    const w = await run([NEW, '--confirm'], { tableOk: false });
    ok('a file whose table it does not know is left alone; the row is printed to add by hand, and the exit is 1 even though the smoke check passed', w.code === 1 && w.files[RELEASES] === 'Releases with no table\n' && /COULD NOT add the row/.test(w.text) && /\| 2026-10-08 07:00 \| `1234567`/.test(w.text), w.text);
    ok('insertRow refuses a row with the wrong number of columns', R.insertRow(TABLE.join('\n'), '| a | b |') === null);
    ok('whatChanged: a merge commit gives its title and (#N); a pipe is escaped; empty is "-"', R.whatChanged('Merge pull request #7 from a/b\n\nTitle | x') === 'Title \\| x (#7)' && R.whatChanged('') === '-');
    const row = R.formatRow({ date: '2026-01-02 03:04', sha: NEW, deployId: null, what: 'w', rollback: OLD, smoke: 's' });
    ok('formatRow without a deploy id says "(not read)" and has 7 cells', cellsOf(row).length === 7 && cellsOf(row)[2] === '(not read)', row);
  }

  heading('the gate: only a check run named exactly gate, of GitHub Actions, counts');
  {
    const actions = { slug: 'github-actions' };
    const red = { id: 5, name: 'gate', status: 'completed', conclusion: 'failure', app: actions };
    const stranger = { id: 99, name: 'gate', status: 'completed', conclusion: 'success', app: { slug: 'some-other-app' } };
    const w = await run([NEW, '--confirm'], { gate: [red, stranger] });
    ok('a green check named gate from ANOTHER app with a higher id does not hide a red gate of Actions', w.code === 1 && /concluded failure/.test(w.text) && !did(w, /^render/), w.text);
    const alone = await run([NEW, '--confirm'], { gate: [stranger] });
    ok('and a green "gate" of another app alone is no gate at all', alone.code === 1 && /no check run named gate/.test(alone.text) && !did(alone, /^render/), alone.text);
    const near = await run([NEW, '--confirm'], { gate: ['gate-docs', 'Gate', 'gate ', 'gate/plan', 'the gate'].map((name, i) => ({ id: 20 + i, name, status: 'completed', conclusion: 'success', app: actions })) });
    ok('a name that merely looks like gate (gate-docs, Gate, "gate ", the gate) is not the gate', near.code === 1 && /no check run named gate/.test(near.text) && !did(near, /^render/), near.text);
    const noField = await run([NEW, '--confirm'], { gate: [{ id: 3, name: 'gate', status: 'completed', conclusion: 'success' }] });
    ok('a check run with no app field (GitHub did not say) is judged by its name and result', noField.code === 0, noField.text);
    const ok2 = await run([NEW, '--confirm'], { gate: [{ id: 3, name: 'gate', status: 'completed', conclusion: 'failure', app: actions }, { id: 4, name: 'gate', status: 'completed', conclusion: 'success', app: actions }, stranger] });
    ok('the highest id of the Actions gate decides (a re-run went green); a stranger above it is ignored', ok2.code === 0, ok2.text);
  }

  heading('the repository is named in every gh call');
  {
    const w = await run([NEW, '--confirm', '--repo', 'someone/else'], { repoExpected: 'someone/else' });
    ok('--repo changes it for every call', w.code === 0 && w.ghPaths.length >= 4 && w.ghPaths.every(p => p.startsWith('repos/someone/else/')) && w.ghApiOutside.length === 0, w.ghPaths.join(' | '));
    const bad = await run([NEW, '--repo', 'not-a-repo']);
    const bad2 = await run([NEW, '--repo', '../x/y z']);
    ok('--repo must be owner/name (exit 2, nothing asked)', bad.code === 2 && bad2.code === 2 && bad.log.length === 0 && bad2.log.length === 0);
    ok('and the real gh is run in the repository folder', /execFileSync\('gh', args, \{ cwd: root,/.test(fs.readFileSync(path.join(REPO, 'tools', 'release', 'release.js'), 'utf8')));
  }

  heading('a smoke failure, a commit title or a deploy id cannot break the row');
  {
    const strict = row => row.replace(/\\\|/g, '').split('|').length - 2;      /* the columns a table renderer sees: every | not escaped */
    const hostile = 'FAIL a fresh profile has no failed request  - 500 https://x/y?a=1|b=2 `code` | extra column |  `';
    const w = await run([NEW, '--confirm'], { smoke: { code: 1, out: 'PASS a\n' + hostile + '\n\nSMOKE FAILED: 1 of 15\n' } });
    const row = w.files[RELEASES].split('\n').find(l => l.startsWith('| 2026-10-08 07:00'));
    ok('a | and backticks in the failing check do not add a column or leave a code span open: 7 columns, an even number of backticks, the pipes escaped', row && strict(row) === 7 && (row.match(/`/g) || []).length % 2 === 0 && /a=1\\\|b=2/.test(row) && /\*\*FAILED\*\* 1 of 15/.test(row), row);
    ok('the row still goes into the table (insertRow accepts it)', row && w.files[RELEASES].split('\n').length === TABLE.length + 1);
    const direct = R.formatRow({ date: '2026-01-02 03:04|x', sha: NEW, deployId: 'dep|x`y', what: 'a | b `c', rollback: 'n/a|', smoke: 'ok | `bad', phone: '1 | 2' });
    ok('formatRow escapes every cell, not only the smoke one (7 columns whatever the text)', strict(direct) === 7 && (direct.match(/`/g) || []).length % 2 === 0, direct);
    ok('an escape already there is not doubled (\\| stays \\|)', R.formatRow({ date: 'd', sha: NEW, deployId: 'x', what: 'a \\| b', rollback: 'n/a', smoke: 's' }).includes('| a \\| b |'));
    ok('balanced backticks in the text of a commit stay as they are (they are styling)', R.formatRow({ date: 'd', sha: NEW, deployId: 'x', what: 'G8b: `PPP.arranger` switch', rollback: 'n/a', smoke: 's' }).includes('G8b: `PPP.arranger` switch'));
  }

  heading('.github/workflows/live-smoke.yml keeps its guards');
  {
    const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'live-smoke.yml'), 'utf8').replace(/\r\n/g, '\n');
    const code = wf.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
    const block = name => { const m = new RegExp('^' + name + ':\\n((?:[ \\t].*\\n|\\n)*)', 'm').exec(code + '\n'); return m ? m[1] : ''; };
    const perms = block('permissions').split('\n').map(l => l.trim()).filter(Boolean);
    ok('permissions: contents read and issues write, nothing else', perms.join(',') === 'contents: read,issues: write', perms.join(','));
    const triggers = block('on').split('\n').filter(l => /^ {2}\S/.test(l)).map(l => l.trim().replace(/:.*/, ''));
    ok('it runs on a schedule and by hand only: no push, no pull request, no workflow_run', triggers.join(',') === 'schedule,workflow_dispatch' && /cron: '5 21 \* \* \*'/.test(code), triggers.join(','));
    ok('the job runs only in kimyir111/PPP (a fork never wakes production)', /^ {4}if: \$\{\{ github\.repository == 'kimyir111\/PPP' \}\}$/m.test(code), '');
    const smokeStep = /- name: smoke check of the live site\n((?: {8,}.*\n)+)/.exec(code + '\n');
    ok('the smoke step has timeout-minutes: 12 (a hang is an ordinary failure) and is shorter than the job\'s 15', smokeStep && /^ {8}timeout-minutes: 12$/m.test(smokeStep[1]) && /^ {4}timeout-minutes: 15$/m.test(code), smokeStep && smokeStep[1].slice(0, 200));
    ok('the issue step runs on failure() || cancelled()', /- name: open or update the issue[^\n]*\n {8}if: \$\{\{ failure\(\) \|\| cancelled\(\) \}\}\n/.test(code), '');
    ok('no secret and no deploy: no `secrets.`, no render command, only the workflow token', !/secrets\./.test(code) && !/render deploys/.test(code) && (code.match(/\$\{\{ github\.token \}\}/g) || []).length === 1);
  }

  heading('smoke-issue.js: the workflow\'s report of a failed daily smoke');
  {
    const calls = [];
    const mk = (open, text, env) => ({
      env: Object.assign({ GITHUB_REPOSITORY: 'o/r', GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '42' }, env || {}),
      out: () => {}, now: () => new Date('2026-10-09T21:07:00Z'),
      readFile: f => { if (text === null) throw new Error('ENOENT'); return text; },
      gh: (args, input) => { calls.push({ args, input }); return args[1] === 'list' ? JSON.stringify(open) : ''; }
    });
    const log = [];
    for (let i = 0; i < 100; i++) log.push('PASS check ' + i);
    log.push('FAIL /health answers ok  - HTTP 0', 'SMOKE FAILED: 1 of 101');
    let code = await S.main(['smoke.log'], mk([], log.join('\n')));
    const create = calls.find(c => c.args[1] === 'create');
    ok('no open issue: it creates one titled exactly "Live smoke failed"', code === 0 && create && create.args[create.args.indexOf('--title') + 1] === 'Live smoke failed' && !calls.some(c => c.args[1] === 'comment'), JSON.stringify(calls.map(c => c.args)));
    ok('the body holds the run link, the failing line and the tail only (60 lines, not the whole 102)', create.input.includes('https://github.com/o/r/actions/runs/42') && create.input.includes('FAIL /health answers ok') && create.input.includes('SMOKE FAILED: 1 of 101') && !create.input.includes('PASS check 10\n') && create.input.includes('PASS check 99'), create.input.slice(0, 300));
    ok('it is aimed at the repository by --repo (no git context needed)', create.args.includes('--repo') && create.args[create.args.indexOf('--repo') + 1] === 'o/r');
    calls.length = 0;
    code = await S.main(['smoke.log'], mk([{ number: 9, title: 'Live smoke failed' }, { number: 3, title: 'Live smoke failed (old)' }, { number: 12, title: 'Live smoke failed' }], 'FAIL x'));
    const comment = calls.find(c => c.args[1] === 'comment');
    ok('an issue with that title is open: it comments on the OLDEST such issue and creates nothing (a similar title is not it)', code === 0 && comment && comment.args[2] === '9' && !calls.some(c => c.args[1] === 'create') && /failed again/.test(comment.input), JSON.stringify(calls.map(c => c.args)));
    calls.length = 0;
    await S.main(['missing.log'], mk([], null));
    const noLog = calls.find(c => c.args[1] === 'create');
    ok('no output file (the step before it failed): it still opens the issue and says the check did not run', noLog && /did not run or wrote no output/.test(noLog.input));
    calls.length = 0;
    await S.main(['smoke.log'], mk([], 'a\n```\nb\n' + 'x'.repeat(5000) + '\n' + 'y'.repeat(9000)));
    const big = calls.find(c => c.args[1] === 'create');
    ok('a fence inside the output cannot close the body\'s fence, and a huge output is cut', (big.input.match(/```/g) || []).length === 2 && big.input.length < 7500, big.input.length + '');
  }

  if (failed) { console.error('\n' + failed + ' failed (' + passed + ' passed): release'); process.exit(1); }
  console.log('\n' + passed + ' passed: release');
})().catch(e => { console.error('release test crashed:', e && e.stack || e); process.exit(2); });
