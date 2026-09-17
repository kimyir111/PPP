/* ============================================================================
   LIVE COACH TEST — makes exactly one real model request.

   Everything else in the suite runs against a fake provider. This one proves
   the real path end to end, whichever provider is answering: the service
   reaches the model, the returned plan passes the same validator fake plans go
   through, the panel attributes it to whoever actually wrote it, and a task the
   model invented configures a practice session PPP can really run.

   Against Ollama it is free. Against Anthropic it costs one request.

   It is deliberately not part of `npm test`. Run it by hand:

     node tests/coach-live.test.js

   With no provider it skips rather than failing, and it never prints a key.
   ========================================================================== */

const puppeteer = require('puppeteer');
const { preparePage } = require('./boot');

const APP = 'http://127.0.0.1:8777/Piano%20Coach%20App.dc.html';
const SERVICE = 'http://127.0.0.1:8788';
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) errors.push(name + (detail ? ' — ' + detail : ''));
};

(async () => {
  /* ---- is a live coach actually there? ---- */
  let health;
  try {
    health = await (await fetch(SERVICE + '/health', { cache: 'no-store' })).json();
  } catch (e) {
    console.log('SKIPPED: the local service is not running. Start it with `npm run omr`.');
    process.exit(0);
  }
  if (!health.coach) {
    console.log('SKIPPED: the service is running but no coach provider is available.');
    console.log('Either run Ollama with the configured model, or put ANTHROPIC_API_KEY');
    console.log('in the .env file at the project root, then restart the service.');
    process.exit(0);
  }

  const PROVIDER = health.coachProvider;

  console.log('\n── the service ────────────────────────');
  ok('/health reports the coach enabled', health.coach === true, 'coach: true');
  ok('/health names the provider', !!PROVIDER, PROVIDER);
  ok('/health names the model', !!health.coachModel, health.coachModel);
  ok('/health carries no key material',
    !/sk-ant|ANTHROPIC_API_KEY/.test(JSON.stringify(health)), 'provider and model name only');

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await preparePage(page);

  const consoleErrors = [], pageErrors = [], failedRequests = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('requestfailed', r => failedRequests.push(r.url() + ' ' + (r.failure() || {}).errorText));

  /* Record the exact request and response for /coach without altering either,
     so the real plan can be re-validated against the real context afterwards. */
  await page.evaluateOnNewDocument(() => {
    window.__live = { calls: 0, ctx: null, raw: null, status: 0, done: false };
    const real = window.fetch;
    window.fetch = function (url, init) {
      const isCoach = typeof url === 'string' && /\/coach$/.test(url);
      if (isCoach) {
        window.__live.calls++;
        try { window.__live.ctx = JSON.parse(init.body).context; } catch (e) { /* recorded as null */ }
      }
      return real.apply(this, arguments).then(r => {
        if (!isCoach) return r;
        window.__live.status = r.status;
        return r.clone().json().then(
          j => { window.__live.raw = j.ok ? j.plan : null; window.__live.done = true; return r; },
          () => { window.__live.done = true; return r; }
        );
      });
    };
  });

  /* Not networkidle0: a local model can think for a minute, so the network is
     still busy long after the page is usable. Wait on the call itself. */
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__live && window.__live.done, { timeout: 300000 });
  await sleep(1500);

  const live = await page.evaluate(() => window.__live);

  console.log('\n── one real request ───────────────────');
  ok('exactly one live coach call was made', live.calls === 1, live.calls + ' call(s)');
  ok('the service answered 200', live.status === 200, 'HTTP ' + live.status);
  ok('a plan came back', !!(live.raw && live.raw.tasks),
    live.raw ? live.raw.tasks.length + ' task(s), ' + live.raw.sessionMinutes + ' min' : 'none');
  ok('the context sent was the seeded demo song',
    !!(live.ctx && live.ctx.song && live.ctx.learning),
    live.ctx ? live.ctx.song.title + ', ' + live.ctx.song.measureCount + ' measures, ' +
      live.ctx.learning.measuresPlayed + ' played' : '');
  ok('the browser sent a context and nothing else',
    !/sk-ant|ANTHROPIC_API_KEY|authorization/i.test(JSON.stringify(live.ctx || {})),
    'no key material in the request body');

  /* ---- the real plan goes through the same gate as a fake one ---- */
  const checked = await page.evaluate(() => {
    const v = PPP.Coach.validate(window.__live.raw, window.__live.ctx);
    const allowed = window.__live.ctx.allowed;
    const tasks = v.plan ? v.plan.tasks : [];
    const eligible = allowed.memoryEligibleSections;
    /* every percentage the prose cites must be one PPP actually measured */
    const text = v.plan
      ? [v.plan.summary, v.plan.todayGoal, v.plan.coachNote].concat(tasks.map(t => t.reason)).join(' ')
      : '';
    const cited = (text.match(/(\d+)\s*%/g) || []).map(x => parseInt(x, 10));
    return {
      ok: v.ok, issues: v.issues || [], tasks: tasks,
      inScore: tasks.every(t => allowed.measures.indexOf(t.range.start) > -1 &&
                                allowed.measures.indexOf(t.range.end) > -1),
      ordered: tasks.every(t => t.range.start <= t.range.end),
      legalHands: tasks.every(t => allowed.hands.indexOf(t.hand) > -1),
      legalModes: tasks.every(t => allowed.modes.indexOf(t.mode) > -1),
      memoryOk: tasks.filter(t => t.mode === 'memory')
        .every(t => eligible.some(s => t.range.start >= s.from && t.range.end <= s.to)),
      memoryTasks: tasks.filter(t => t.mode === 'memory').length,
      eligibleCount: eligible.length,
      inRange: tasks.every(t => t.tempoPercent >= 30 && t.tempoPercent <= 120 &&
                                t.repetitions >= 1 && t.repetitions <= 8),
      cited: cited,
      invented: cited.filter(n => allowed.percentages.indexOf(n) < 0),
      summary: v.plan ? v.plan.summary : '',
      goal: v.plan ? v.plan.todayGoal : '',
      note: v.plan ? v.plan.coachNote : ''
    };
  });

  console.log('\n── the real plan meets the same guardrails ──');
  ok('it passes PPP’s validator', checked.ok === true,
    checked.tasks.length + ' task(s) survived, ' +
    (checked.issues.length ? checked.issues.length + ' issue(s): ' + checked.issues.join(' | ') : 'no issues'));
  ok('every measure exists in this score', checked.inScore);
  ok('no range runs backwards', checked.ordered);
  ok('every hand is one PPP has', checked.legalHands);
  ok('every mode is one PPP can run', checked.legalModes);
  ok('memory work only where it was earned', checked.memoryOk,
    checked.memoryTasks + ' memory task(s), ' + checked.eligibleCount + ' eligible section(s)');
  ok('tempo and repetitions are in range', checked.inRange);
  ok('every figure it cites is one PPP measured', checked.invented.length === 0,
    checked.cited.length ? 'cited ' + checked.cited.join('%, ') + '%' : 'cited no figures');

  console.log('\n  what the model wrote:');
  console.log('    goal:    ' + checked.goal);
  console.log('    summary: ' + checked.summary);
  checked.tasks.forEach((t, i) => console.log('    ' + (i + 1) + '. m' + t.range.start + '–' + t.range.end +
    '  ' + t.hand + '  ' + t.tempoPercent + '%  ' + t.mode + '  ×' + t.repetitions + '  — ' + t.reason));
  if (checked.note) console.log('    note:    ' + checked.note);

  /* ---- attribution ----
     The coach panel is on the player screen, so go there before reading it. */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside nav button')].find(x => /Practice/.test(x.innerText || ''));
    if (b) b.click();
  });
  await sleep(1200);
  const attributed = await page.evaluate(() => {
    const panel = [...document.querySelectorAll('main section')]
      .find(s => /PPP Coach/.test(s.innerText || ''));
    return panel ? ((panel.innerText.match(/PLANNED BY [^\n]+/i) || [])[0] || null) : null;
  });
  console.log('\n── the panel is honest ────────────────');
  ok('the panel credits the provider that actually answered',
    new RegExp('planned by ' + PROVIDER, 'i').test(attributed || ''),
    attributed + ' (service reported ' + PROVIDER + ')');
  ok('it does not claim PPP planned it', !/planned by ppp/i.test(attributed || ''));

  /* ---- and the plan is executable ---- */
  const first = checked.tasks[0];
  const scoreTempo = await page.evaluate(() => 84);
  const applied = await page.evaluate(async (t) => {
    /* scoped to the coach panel — Home's recommendation card can carry the
       same "Measures 21–24" label, and clicking that would prove nothing */
    const label = 'Measures ' + t.range.start + '–' + t.range.end;
    const panel = [...document.querySelectorAll('main section')]
      .find(s => /PPP Coach/.test(s.innerText || ''));
    /* task rows render in plan order and each is numbered, so the first row
       carrying a measure range is tasks[0] */
    const b = [...(panel ? panel.querySelectorAll('button') : [])]
      .filter(x => /Measures \d+/.test(x.innerText || ''))[0];
    if (!b || (b.innerText || '').indexOf(label) < 0) return { found: false, saw: b ? b.innerText.replace(/\n/g, ' | ') : null };
    b.click();
    await new Promise(r => setTimeout(r, 900));
    const txt = document.querySelector('main').innerText;
    const loop = (txt.match(/Loop:?\s*(\d+)\s*→\s*(\d+)/) || []).slice(1).map(Number);
    const tempo = +((txt.match(/(\d+)\s*BPM/) || [])[1]);
    const memory = /Memory Mode/i.test((document.querySelector('header div div') || {}).innerText || '');
    const nav = [...document.querySelectorAll('aside nav button')].find(x => /Practice/.test(x.innerText || ''));
    if (nav) nav.click();
    await new Promise(r => setTimeout(r, 900));
    return {
      found: true, loop: loop, tempo: tempo, memory: memory,
      total: document.querySelectorAll('.ppp-note').length,
      hidden: document.querySelectorAll('.ppp-note.ppp-off').length
    };
  }, first);

  console.log('\n── clicking a real task ───────────────');
  ok('the task is on screen as a button', applied.found === true,
    applied.found ? 'task 1 of the plan' : 'saw: ' + applied.saw);
  ok('it sets the loop to the task’s range',
    applied.found && applied.loop[0] === first.range.start && applied.loop[1] === first.range.end,
    applied.found ? 'Loop ' + applied.loop.join(' → ') + ', task asked for ' +
      first.range.start + '–' + first.range.end : '');
  ok('it sets the tempo the task asked for',
    applied.found && Math.abs(applied.tempo - Math.round(scoreTempo * first.tempoPercent / 100)) <= 1,
    applied.found ? applied.tempo + ' BPM (' + first.tempoPercent + '% of ' + scoreTempo + ')' : '');
  ok('it sets the hand the task asked for',
    applied.found && (first.hand === 'both'
      ? applied.hidden === 0
      : applied.hidden > 0 && applied.hidden < applied.total),
    applied.found ? first.hand + ' — ' + applied.hidden + ' of ' + applied.total + ' notes hidden' : '');
  ok('still exactly one live call after all of that',
    (await page.evaluate(() => window.__live.calls)) === 1, 'nothing re-planned by accident');

  /* ---- nothing broke, nothing leaked ---- */
  const stored = await page.evaluate(() => {
    let all = '';
    for (let i = 0; i < localStorage.length; i++) all += localStorage.getItem(localStorage.key(i));
    return { bytes: all.length, leak: /sk-ant|ANTHROPIC/i.test(all) };
  });
  console.log('\n── console, network and storage ───────');
  ok('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');
  ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'clean');
  ok('no failed requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | ') || 'clean');
  ok('nothing key-shaped in localStorage', stored.leak === false,
    stored.bytes + ' bytes stored, no key material');

  await browser.close();

  console.log('\n────────────────────────────────────────');
  if (errors.length) {
    console.log(errors.length + ' PROBLEM(S):');
    errors.forEach(e => console.log('  ✗ ' + e));
    process.exit(1);
  }
  console.log('The live provider works end to end: ' + PROVIDER + ' (' + health.coachModel + '). Exactly one request was made.');
})().catch(e => { console.error(e); process.exit(1); });
