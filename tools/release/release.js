#!/usr/bin/env node
/* G13-7a / G13-D12: deploy ppp-web by hand, with the checks in front and behind it. LOCAL USE, by a person: it is not run by any workflow, push or merge,
   and it deploys only with --confirm.

     node tools/release/release.js <sha>                 what it would do (steps 1 and 2 below), nothing changed
     node tools/release/release.js <sha> --confirm       and does it

   <sha> is 7 to 40 hex characters of a commit of the repository; the Render CLI needs the full 40, so it is resolved through the GitHub API (gh).

   1. refuses unless the check run named `gate` of that commit concluded `success` (read with `gh api`; no `gate` yet = pending = refused; red = refused)
      and refuses a commit that is not in the history of main (GitHub's compare says identical or behind; anything else, or no answer, refuses),
      unless --allow-unmerged is given (a loud warning, for the rare exception)
   2. prints the plan and the ROLLBACK command, built from the commit that is live now (window.PPP_BUILD of the page)
   3. --confirm: render deploys create srv-dalt5s6k1f9s739cuetg --commit <40-char sha> --confirm
   4. waits until the page's PPP_BUILD starts with the sha (polls every 15 s, gives up after --timeout-min, 20 by default; a failed deploy ends it at once);
      with --redeploy the page cannot tell, so it waits for the status `live` of the deploy it created
   5. node tests/live/smoke.js --sha <sha> --logs [--pc-code-file <file>]: any FAIL makes this exit 1 and prints the rollback command again
   6. adds one row to the top of the table in RELEASES.md (docs/, the columns it has), to be committed by the person

   Options: --site <url>  --service <srv-id>  --repo <owner/name> (default kimyir111/PPP: every gh call names it, whatever the directory)
            --rollback <sha> (when the live page cannot be read)  --allow-unmerged (deploy a commit that is not in main)
            --redeploy (the commit is already live: waits until Render says the new deploy is live)  --what "<text>" (the row's "What changed")
            --pc-code-file <file> (passed to the smoke check)  --timeout-min <n>

   Exit: 0 released and verified; 1 refused, failed, or the smoke check failed; 2 wrong usage.
   Nothing here prints a secret: the PC code file is only passed on by name. tests/release/release.test.js drives all of this with a fake gh, render and page. */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

const SERVICE_ID = 'srv-dalt5s6k1f9s739cuetg';
const SITE = 'https://ppp-web-2o99.onrender.com';
const GATE_CHECK = 'gate';
const POLL_MS = 15000, FIRST_WAIT_MS = 20000;
const BAD_DEPLOY = /failed|cancel/i;
const DEFAULT_REPO = 'kimyir111/PPP';

class UsageError extends Error {}
class Refusal extends Error {}

const USAGE = 'usage: node tools/release/release.js <sha> [--confirm] [--site URL] [--service ID] [--repo owner/name] [--rollback SHA] [--allow-unmerged] [--redeploy] [--what TEXT] [--pc-code-file FILE] [--timeout-min N]';

function parseArgs(argv) {
  const o = { sha: '', confirm: false, redeploy: false, allowUnmerged: false, help: false, repo: DEFAULT_REPO, service: SERVICE_ID, site: SITE, pcCodeFile: '', rollback: '', what: '', timeoutMin: 20, releasesFile: '' };
  const takes = { '--repo': 'repo', '--service': 'service', '--site': 'site', '--pc-code-file': 'pcCodeFile', '--rollback': 'rollback', '--what': 'what', '--timeout-min': 'timeoutMin', '--releases-file': 'releasesFile' };
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '--confirm') o.confirm = true;
    else if (a === '--redeploy') o.redeploy = true;
    else if (a === '--allow-unmerged') o.allowUnmerged = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (takes[a]) {
      const v = argv[++i];
      if (v === undefined || String(v).startsWith('--')) throw new UsageError(a + ' needs a value');
      o[takes[a]] = String(v);
    } else if (a.startsWith('-')) throw new UsageError('unknown option ' + a);
    else if (!o.sha) o.sha = a;
    else throw new UsageError('one commit only (got "' + o.sha + '" and "' + a + '")');
  }
  o.timeoutMin = Number(o.timeoutMin);
  if (!(o.timeoutMin > 0)) throw new UsageError('--timeout-min must be a number above 0');
  o.site = o.site.replace(/\/+$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(o.repo)) throw new UsageError('--repo is owner/name');
  return o;
}

const repoBase = o => 'repos/' + o.repo;
const ghJson = (io, apiPath) => JSON.parse(io.gh(['api', apiPath]));
const short = sha => String(sha).slice(0, 7);
const utcMinute = d => new Date(d).toISOString().slice(0, 16).replace('T', ' ');

/* a sha (or a short one) -> { sha: the 40 characters, message } */
function resolveCommit(io, o, ref) {
  let j;
  try { j = ghJson(io, repoBase(o) + '/commits/' + ref); }
  catch (e) { throw new Refusal('cannot resolve commit ' + ref + ' with gh: ' + errText(e)); }
  if (!j || !/^[0-9a-f]{40}$/.test(String(j.sha))) throw new Refusal('GitHub did not answer a 40-character sha for ' + ref);
  return { sha: j.sha, message: String((j.commit && j.commit.message) || '') };
}

/* the gate of a commit: ok only when its newest check run named exactly `gate` (made by GitHub Actions, when GitHub says which app made it) is completed with the conclusion success */
function readGate(io, o, sha) {
  let j;
  try { j = ghJson(io, repoBase(o) + '/commits/' + sha + '/check-runs?check_name=' + GATE_CHECK + '&filter=all&per_page=100'); }
  catch (e) { return { ok: false, state: 'unreadable', why: 'the checks of ' + short(sha) + ' could not be read with gh: ' + errText(e) }; }
  const runs = ((j && j.check_runs) || []).filter(r => r && r.name === GATE_CHECK && (!r.app || r.app.slug === 'github-actions'));
  if (!runs.length) return { ok: false, state: 'missing', why: 'commit ' + short(sha) + ' has no check run named gate (not started, or never ran): that is pending, not green' };
  const run = runs.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));
  if (run.status !== 'completed') return { ok: false, state: 'pending', why: 'the gate of ' + short(sha) + ' is ' + run.status + ' (pending): wait for it, and read its result', run };
  if (run.conclusion !== 'success') return { ok: false, state: 'failed', why: 'the gate of ' + short(sha) + ' concluded ' + run.conclusion + ', not success', run };
  return { ok: true, state: 'success', run };
}

/* "Merge pull request #230 from x/y\n\nTitle" -> "Title (#230)"; a squash commit already ends with its (#N) */
function whatChanged(message, override) {
  const clean = s => String(s).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|').slice(0, 200);
  if (override) return clean(override);
  const lines = String(message || '').split(/\r?\n/);
  const first = (lines[0] || '').trim();
  const m = /^Merge pull request #(\d+) from \S+/.exec(first);
  if (m) {
    const title = lines.slice(1).map(s => s.trim()).find(Boolean);
    return clean((title || first) + ' (#' + m[1] + ')');
  }
  return clean(first) || '-';
}

/* one row of the table in RELEASES.md: Date (UTC) | Commit | Deploy | What changed | Rollback to | Smoke / verified | Phone cold */
function formatRow(r) {
  /* every cell: one line, a | escaped (a bare one would start another column), and an odd number of backticks (a code span that never closes) turned into quotes */
  const cell = s => {
    const one = String(s).replace(/\s+/g, ' ').trim().replace(/\\?\|/g, '\\|');
    return (one.match(/`/g) || []).length % 2 ? one.replace(/`/g, "'") : one;
  };
  return '| ' + [
    cell(r.date),
    '`' + short(r.sha) + '`',
    r.deployId ? '`' + cell(r.deployId) + '`' : '(not read)',
    cell(r.what),
    r.rollback ? (/^[0-9a-f]{7}/.test(r.rollback) ? '`' + short(r.rollback) + '`' : cell(r.rollback)) : '-',
    cell(r.smoke),
    cell(r.phone || '-')
  ].join(' | ') + ' |';
}

/* the file's text with the row first in the table, or null when the table is not what this knows (the columns differ: nothing is written) */
function insertRow(text, row) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const h = lines.findIndex(l => /^\|\s*Date \(UTC\)\s*\|\s*Commit\s*\|/.test(l));
  if (h < 0 || !/^\|\s*-{3}/.test(lines[h + 1] || '')) return null;
  const cells = l => l.replace(/\\\|/g, '\u0001').split('|').length - 2;
  if (cells(lines[h]) !== cells(row)) return null;
  lines.splice(h + 2, 0, row);
  return lines.join(eol);
}

function smokeText(sha, args, res, date) {
  const shown = '`smoke.js --sha ' + short(sha) + (args.includes('--logs') ? ' --logs' : '') + (args.includes('--pc-code-file') ? ' --pc-code-file' : '') + '`';
  const pass = /SMOKE PASSED: (\d+) checks/.exec(res.out || '');
  const fail = /SMOKE FAILED: (\d+) of (\d+)/.exec(res.out || '');
  if (res.code === 0 && pass) return shown + ': ' + pass[1] + ' checks passed (release.js, ' + date + ')';
  /* the detail is the smoke check's own text (URLs, error messages): nothing in it may be a table or code mark */
  const firstFail = (String(res.out || '').split(/\r?\n/).find(l => l.startsWith('FAIL ')) || '').replace(/`/g, "'").replace(/\\?\|/g, '\\|');
  if (fail) return shown + ': **FAILED** ' + fail[1] + ' of ' + fail[2] + ' checks' + (firstFail ? ' - ' + firstFail.slice(5, 90) : '') + ' (release.js, ' + date + ')';
  return shown + ': **did not finish** (exit ' + res.code + ') (release.js, ' + date + ')';
}

const errText = e => String((e && (e.stderr && String(e.stderr).trim() || e.message)) || e).split('\n')[0].slice(0, 200);
const deployCommand = (o, sha) => 'render deploys create ' + o.service + ' --commit ' + sha + ' --confirm';

function listDeploys(io, o) {
  try { const j = JSON.parse(io.render(['deploys', 'list', o.service, '-o', 'json', '--confirm'])); return Array.isArray(j) ? j : []; }
  catch (e) { return null; }
}
/* the newest deploy of this commit that was created at or after `since` (ms) */
function findDeploy(list, sha, since) {
  return (list || []).filter(d => d && d.commit && d.commit.id === sha && Date.parse(d.createdAt) >= since - 120000)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;
}

/* wait until the page shows the build. statusLive (a redeploy of the build that is already live: the page cannot tell old from new) also waits until Render
   says that the deploy it created, deployId, is `live`; Render is then asked at every poll, otherwise at every third one (a failed build never becomes live). */
async function waitForLive(io, o, sha, since, say, statusLive, deployId) {
  const want = short(sha);
  const deadline = io.now().getTime() + o.timeoutMin * 60000;
  let polls = 0, build = null;
  await io.sleep(FIRST_WAIT_MS);
  for (;;) {
    build = await io.fetchBuild(o.site);
    const same = !!(build && build.startsWith(want));
    polls++;
    let d = null;
    if (statusLive || (!same && polls % 3 === 0)) {
      const list = listDeploys(io, o);
      d = (deployId && (list || []).find(x => x && x.id === deployId)) || findDeploy(list, sha, since);
    }
    if (d && BAD_DEPLOY.test(String(d.status))) return { live: false, why: 'failed', status: d.status, deployId: d.id, createdAt: d.createdAt };
    if (same && (!statusLive || (d && d.status === 'live'))) return { live: true, build: build };
    if (io.now().getTime() >= deadline) return { live: false, why: 'timeout', build: build, status: d && d.status };
    say('  ... the live build is ' + (build || '(unreadable)') + (statusLive ? ', the deploy is ' + ((d && d.status) || '(not listed yet)') : '') + ', waiting for ' + want);
    await io.sleep(POLL_MS);
  }
}

async function main(argv, io) {
  const say = l => io.out(l);
  const o0 = (() => { try { return parseArgs(argv); } catch (e) { return e; } })();
  if (o0 instanceof Error) { say(o0.message + '\n' + USAGE); return o0 instanceof UsageError ? 2 : 1; }
  const o = o0;
  if (o.help) { say(USAGE); return 0; }
  let target, deployed = false, rollbackFull = null;
  try {
    if (!o.sha) throw new UsageError('give the commit to deploy');
    if (!/^[0-9a-f]{7,40}$/i.test(o.sha)) throw new UsageError('"' + o.sha + '" is not a commit sha: 7 to 40 hex characters (it is resolved to the 40 that the Render CLI needs)');
    if (o.confirm && (io.env.CI || io.env.GITHUB_ACTIONS)) throw new Refusal('--confirm is for a person at a terminal: this does not deploy from CI');

    /* 1. the gate */
    target = resolveCommit(io, o, o.sha.toLowerCase());
    const gate = readGate(io, o, target.sha);
    if (!gate.ok) throw new Refusal(gate.why);

    /* 1b. only what is merged: GitHub compares main with the commit (identical or behind = in main's history); anything else, or no answer, refuses */
    let compare = null;
    try { compare = ghJson(io, repoBase(o) + '/compare/main...' + target.sha).status; } catch (e) { compare = null; }
    const onMain = compare === 'identical' || compare === 'behind';
    if (!onMain && !o.allowUnmerged) throw new Refusal('commit ' + short(target.sha) + ' is not in the history of main (' + (compare ? 'compare says ' + compare : 'GitHub did not say') + '): only merged commits are deployed. --allow-unmerged is for the rare exception');

    /* 2. the live build, the rollback, the plan */
    const liveBuild = await io.fetchBuild(o.site);
    let rollbackSha = null;
    if (o.rollback) {
      if (!/^[0-9a-f]{7,40}$/i.test(o.rollback)) throw new UsageError('--rollback is not a commit sha');
      rollbackSha = resolveCommit(io, o, o.rollback.toLowerCase()).sha;
    } else if (liveBuild && /^[0-9a-f]{7}/.test(liveBuild)) {
      rollbackSha = resolveCommit(io, o, liveBuild).sha;
    } else {
      throw new Refusal('the live page at ' + o.site + ' shows no build (' + (liveBuild || 'unreadable') + '), so there is nothing to roll back to: pass --rollback <sha> if you know it');
    }
    rollbackFull = rollbackSha;
    if (liveBuild && liveBuild.startsWith(short(target.sha)) && !o.redeploy) throw new Refusal(short(target.sha) + ' is already live: nothing to release (--redeploy to deploy the same commit again)');

    const what = whatChanged(target.message, o.what);
    const smokeArgs = ['--sha', target.sha, '--logs', '--site', o.site].concat(o.pcCodeFile ? ['--pc-code-file', o.pcCodeFile] : []);
    say('release plan for ' + o.service + ' (' + o.site + ')');
    say('  commit    ' + target.sha + '  ' + what);
    say('  merged    ' + (onMain ? 'in the history of main' : '!!! NOT IN MAIN (' + (compare || 'no answer') + '): shown only because --allow-unmerged was given !!!'));
    say('  gate      success' + (gate.run && gate.run.id ? ' (check run ' + gate.run.id + (gate.run.completed_at ? ', ' + gate.run.completed_at : '') + ')' : ''));
    say('  live now  ' + (liveBuild || '(unreadable)') + '  rollback target ' + rollbackSha);
    say('  deploy    ' + deployCommand(o, target.sha));
    say('  then      wait for PPP_BUILD ' + short(target.sha) + ' (up to ' + o.timeoutMin + ' min), node tests/live/smoke.js ' + smokeArgs.join(' ') + ', add a row to the releases table');
    say('  ROLLBACK  ' + deployCommand(o, rollbackSha));
    if (!o.confirm) {
      say('\nDRY RUN: nothing was changed. Add --confirm to deploy.');
      return 0;
    }

    /* 3. deploy */
    if (!onMain) say('\n!!! WARNING: ' + short(target.sha) + ' is NOT in the history of main. It is deployed only because of --allow-unmerged; get it merged, or the next deploy of main removes it. !!!');
    say('\n--confirm given: deploying ' + short(target.sha) + ' now.');
    const since = io.now().getTime();
    let createOut = '', createErr = null;
    try { createOut = io.render(['deploys', 'create', o.service, '--commit', target.sha, '--confirm']); }
    catch (e) { createErr = e; createOut = String((e && e.stdout) || ''); }
    let deploy = findDeploy(listDeploys(io, o), target.sha, since);
    if (createErr && !deploy) throw new Refusal('the deploy was NOT created (' + errText(createErr) + '). Nothing changed; the live build is still ' + (liveBuild || 'as it was'));
    deployed = true;
    const idInOutput = /\bdep-[0-9a-z]+\b/.exec(createOut || '');
    const deployId = (deploy && deploy.id) || (idInOutput && idInOutput[0]) || null;
    say('deploy created' + (deployId ? ': ' + deployId : '') + (createErr ? ' (the render command ended with an error after it started: ' + errText(createErr) + ')' : ''));

    /* 4. wait */
    const waited = await waitForLive(io, o, target.sha, since, say, !!(liveBuild && liveBuild.startsWith(short(target.sha))), deployId);
    deploy = findDeploy(listDeploys(io, o), target.sha, since) || deploy;
    const row = extra => Object.assign({ date: utcMinute((deploy && deploy.createdAt) || io.now()), sha: target.sha, deployId: deployId, what: what, rollback: rollbackSha }, extra);
    if (!waited.live) {
      if (waited.why === 'failed') {
        say('\nthe deploy FAILED on Render (status ' + waited.status + '): the new build never went live, the old one is still serving.');
        writeRow(io, o, say, row({ what: what + ' - **' + waited.status + '**, never live', rollback: 'n/a', smoke: '-' }));
      } else {
        say('\nthe live build did not become ' + short(target.sha) + ' within ' + o.timeoutMin + ' minutes (it shows ' + (waited.build || 'nothing') + '). No row was written: check `render deploys list ' + o.service + ' -o json --confirm`.');
      }
      say('ROLLBACK (only if the new build did go live and is wrong): ' + deployCommand(o, rollbackSha));
      return 1;
    }
    say('live: PPP_BUILD ' + waited.build);

    /* 5. smoke */
    say('\nsmoke check: node tests/live/smoke.js ' + smokeArgs.join(' '));
    const res = await io.smoke(smokeArgs);
    const smoke = smokeText(target.sha, smokeArgs, res, utcMinute(io.now()).slice(0, 10));

    /* 6. the row */
    const wrote = writeRow(io, o, say, row({ smoke: smoke }));
    if (res.code !== 0) {
      say('\nSMOKE FAILED (exit ' + res.code + '). The release is live. Roll back with:\n  ' + deployCommand(o, rollbackSha));
      return 1;
    }
    say('\nreleased and verified: ' + short(target.sha) + ' is live, ' + smoke);
    if (!wrote) return 1;
    say('Commit the new row of the releases table (a pull request), and tell the user (in Korean) what is live and the rollback: ' + deployCommand(o, rollbackSha));
    return 0;
  } catch (e) {
    if (e instanceof UsageError) { say(e.message + '\n' + USAGE); return 2; }
    if (e instanceof Refusal) { say((deployed ? 'STOPPED: ' : 'REFUSED: ') + e.message); }
    else say((deployed ? 'STOPPED AFTER THE DEPLOY WAS CREATED: ' : 'release.js failed: ') + errText(e));
    if (deployed && rollbackFull) say('ROLLBACK: ' + deployCommand(o, rollbackFull));
    return 1;
  }
}

/* adds the row to the file; false (and the row on screen) when it could not */
function writeRow(io, o, say, r) {
  const file = o.releasesFile || path.join(io.root, 'docs', 'RELEASES.md');
  const line = formatRow(r);
  try {
    const next = insertRow(io.readFile(file), line);
    if (next === null) throw new Error('the table in the file has other columns than this writes');
    io.writeFile(file, next);
    say('row added to ' + file + ':\n' + line);
    return true;
  } catch (e) {
    say('COULD NOT add the row to ' + file + ' (' + errText(e) + '). Add this line by hand, first in the table:\n' + line);
    return false;
  }
}

/* ---- the real world: gh, render, the page, the smoke check ---- */
function fetchBuild(site) {
  return new Promise(resolve => {
    let u;
    try { u = new URL(site + '/'); } catch (e) { return resolve(null); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { timeout: 30000, headers: { 'Cache-Control': 'no-cache' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => {
        body += c;
        const m = /PPP_BUILD="([^"]*)"/.exec(body);          /* it is at the top of the page: stop reading once it is seen */
        if (m) { resolve(m[1]); req.destroy(); } else if (body.length > 400000) { resolve(null); req.destroy(); }
      });
      res.on('end', () => resolve(null));
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function realIo(root) {
  return {
    root: root,
    env: process.env,
    out: l => console.log(l),
    now: () => new Date(),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    gh: args => execFileSync('gh', args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 50 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }),
    render: args => execFileSync('render', args, { encoding: 'utf8', timeout: 15 * 60000, maxBuffer: 50 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }),
    fetchBuild: fetchBuild,
    smoke: args => new Promise(resolve => {
      const child = spawn(process.execPath, [path.join(root, 'tests', 'live', 'smoke.js')].concat(args), { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      const take = d => { process.stdout.write(d); text += d; };
      child.stdout.on('data', take); child.stderr.on('data', take);
      child.on('error', e => resolve({ code: 2, out: String(e.message) }));
      child.on('exit', code => resolve({ code: code == null ? 2 : code, out: text }));
    }),
    readFile: f => fs.readFileSync(f, 'utf8'),
    writeFile: (f, s) => fs.writeFileSync(f, s)
  };
}

module.exports = { main, parseArgs, readGate, insertRow, formatRow, whatChanged, smokeText, realIo, SERVICE_ID, SITE };

if (require.main === module) {
  main(process.argv.slice(2), realIo(path.resolve(__dirname, '..', '..')))
    .then(code => process.exit(code))
    .catch(e => { console.error('release.js crashed: ' + (e && e.stack || e)); process.exit(1); });
}
