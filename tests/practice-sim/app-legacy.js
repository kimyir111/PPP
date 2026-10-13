/* G11b-0 (docs/GOALS/G11_ADAPTIVE_PRACTICE.md §7.4, §10 row G11b-0): the app's own practice engines and the
   practice page's own lap glue, run in Node, for the legacy-policy runner (tests/practice-sim/runner.js).

   Nothing here is re-implemented. The code that runs is the text of `Piano Coach App.dc.html`, read at run time:

     1. the page's inline script is cut into its top-level declarations (`const X =`, `function X(`, `class X`,
        each one up to the next top-level line); starting from the engines the practice loop uses (PianoScore,
        Score, PerformanceEngine, Learning, Memory, Coach and their constants), every declaration they name is
        taken along, transitively. That is 44 declarations at 270cfd7, about 2,600 lines, as written;
     2. from the page's component (`class Component extends DCLogic`), the methods a finished lap and the coach
        session go through - completeLap, advanceCoach, maybeReplan, requestPlan, coachContext, runCoachTask,
        recommendation, applyRecommendation, recordRecall, model, seq, setLoop, beginRun, ... - are cut out by
        name, also as written, and put on a stand-in component whose setState applies a patch at once;
     3. both run in ONE bare vm context (no require, no module, no document, no React), so the methods close over
        the engines exactly as they do in the page. Clock.now (the app's own injectable clock, App "Injectable so
        tests never depend on the wall clock") is pointed at the simulator's clock.

   What is NOT the app's code, and why (each is one line below, and the report names them):
     - liveMidi() answers true: a MIDI keyboard is connected (G11-D5: only such runs are evidence; the simulated
       learner is the keyboard);
     - the state field toggles.follow is false: a lap is a clock run started with Play, and togglePlay() turns
       Follow off before it starts the clock (App togglePlay); follow laps are not simulated;
     - setTimeout/clearTimeout are a queue the runner drains (adoptScore's first requestPlan, the toast timer);
     - the runner plays the role of the person: it presses Play, taps "Start today's session" (the home card's
       startToday: the first task of the plan not yet done) or "apply the recommendation", and feeds the
       learner's key presses to the page's own PerformanceEngine, then does what tick() does at the end of a lap
       (advanceTo past the last window, result(), completeLap, beginRun for the next lap).

   G11-D2 chose a page harness for the PLAYER's parity; the doc's §7.4 runs the legacy policy "in the page".
   The gate is npm-install free (no puppeteer), so this runs the page's script text in a vm instead: the same
   code, minus the DOM. tests/practice-sim/legacy.test.js checks that every extracted piece is byte-for-byte a
   slice of the app file and that a change to one of the app's thresholds changes what the runner does. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..');
const APP = path.join(REPO, 'Piano Coach App.dc.html');

/* the engines the practice loop reads, and the page-wide names the component methods below use */
const ENGINE_ROOTS = ['PianoScore', 'Score', 'PerformanceEngine', 'TIMING_DEFAULTS', 'Learning', 'LEARN', 'Memory', 'MEMORY',
  'Coach', 'COACH', 'Clock', 'DAY', 'seedSecs', 'MEM_LEVELS', 'clamp', 'R0', 'nowMs', 'tx', 'DIFFICULTY_MODE',
  'buildDemoScore', 'seedDemoHistory', 'ANALYSIS_STEPS', 'sharedParam'];
/* names that are local variables elsewhere in the page as well as top-level page names: never pulled in by an
   identifier match (`h` is React.createElement; the component is cut by method instead) */
const DENY = new Set(['h', 'Component']);
/* the component's methods a lap, a recall, a recommendation and a coach session go through */
const METHODS = ['adoptScore', 'completeLap', 'advanceCoach', 'coachOwnsLoop', 'maybeReplan', 'requestPlan', 'coachContext',
  'coachProvider', 'runCoachTask', 'taskLabel', 'model', 'seq', 'recommendation', 'applyRecommendation', 'recordRecall',
  'sectionOf', 'sections', 'range', 'songProgress', 'songMemory', 'weighted', 'setLoop', 'beginRun', 'perf', 'looping',
  'following', 'say', 'difficultyAssessment', 'memSection', 'memRec', 'memLevel'];

function appHtml(file) { return fs.readFileSync(file || APP, 'utf8').replace(/\r\n/g, '\n'); }

function inlineScript(html) {
  const a = html.indexOf('<script type="text/x-dc"');
  if (a < 0) throw new Error('app-legacy: the page script (text/x-dc) is not where it was');
  const s0 = html.indexOf('>', a) + 1;
  const s1 = html.indexOf('\n</script>', s0);
  return html.slice(s0, s1);
}

/* top-level declarations, each from its first line to the line before the next top-level line */
function chunksOf(src) {
  const DECL = /^(?:const|let|var|function\*?|async function|class) +([A-Za-z_$][\w$]*)/;
  const chunks = [];
  let cur = null;
  src.split('\n').forEach(ln => {
    const m = DECL.exec(ln);
    if (m || /^[A-Za-z_$]/.test(ln)) { cur = { name: m ? m[1] : null, lines: [] }; chunks.push(cur); }
    if (cur) cur.lines.push(ln);
  });
  chunks.forEach(c => { c.text = c.lines.join('\n'); delete c.lines; });
  return chunks;
}

/* comments out, for the dependency scan only (the code that runs keeps them) */
function withoutComments(t) { return t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1'); }

function closure(chunks, roots) {
  const byName = new Map();
  chunks.forEach(c => { if (c.name && !byName.has(c.name)) byName.set(c.name, c); });
  const need = new Set();
  const stack = roots.slice();
  while (stack.length) {
    const n = stack.pop();
    if (need.has(n) || DENY.has(n)) continue;
    if (!byName.has(n)) throw new Error('app-legacy: the page has no top-level ' + n);
    need.add(n);
    const ids = withoutComments(byName.get(n).text).match(/[A-Za-z_$][\w$]*/g) || [];
    new Set(ids).forEach(id => { if (byName.has(id) && !need.has(id) && !DENY.has(id)) stack.push(id); });
  }
  return chunks.filter(c => c.name && need.has(c.name));   /* in page order */
}

/* one method of the component, as written: from `\n  name(` to its closing `\n  }` (or the end of a one-line method) */
function methodOf(body, name) {
  const re = new RegExp('\\n  (?:async )?' + name.replace(/\$/g, '\\$') + '\\([^\\n]*\\) \\{');
  const m = re.exec(body);
  if (!m) throw new Error('app-legacy: the component has no method ' + name);
  const start = m.index + 1;
  const firstLine = body.slice(start, body.indexOf('\n', start));
  if (/\}\s*$/.test(firstLine) && (firstLine.match(/\{/g) || []).length === (firstLine.match(/\}/g) || []).length) return firstLine;
  const end = body.indexOf('\n  }\n', start);
  if (end < 0) throw new Error('app-legacy: method ' + name + ' has no clean end');
  return body.slice(start, end + 4);
}

/* the component's initial state, as written (the class field `state = (() => { ... })();`) */
function stateInitOf(body) {
  const a = body.indexOf('\n  state = (() => {');
  const z = body.indexOf('\n  })();\n', a);
  if (a < 0 || z < 0) throw new Error('app-legacy: the component\'s initial state is not where it was');
  return body.slice(a + '\n  state = '.length, z + '\n  })()'.length);
}

/* the home card's "Start today's plan" button (the render values' startToday handler), as written: its body */
function startTodayOf(body) {
  const head = '\n      startToday: () => {\n';
  const a = body.indexOf(head);
  const z = body.indexOf('\n      },\n', a);
  if (a < 0 || z < 0) throw new Error('app-legacy: the startToday handler is not where it was');
  return body.slice(a + head.length, z + 1);
}

function extract(file) {
  const html = appHtml(file);
  const src = inlineScript(html);
  const chunks = chunksOf(src);
  const comp = chunks.find(c => c.name === 'Component');
  if (!comp || !/^class Component extends DCLogic \{/.test(comp.text)) throw new Error('app-legacy: class Component is not where it was');
  const methods = METHODS.map(n => ({ name: n, text: methodOf(comp.text, n) }));
  const stateInit = stateInitOf(comp.text);
  /* and every page-wide name the methods and the initial state use */
  const names = new Set(chunks.filter(c => c.name).map(c => c.name));
  const used = new Set((withoutComments(methods.map(m => m.text).join('\n') + '\n' + stateInit).match(/[A-Za-z_$][\w$]*/g) || [])
    .filter(id => names.has(id) && !DENY.has(id)));
  return { html, engines: closure(chunks, ENGINE_ROOTS.concat([...used].sort())), methods, stateInit, startToday: startTodayOf(comp.text) };
}

/* Build the vm. Returns { E (the engines), newApp(), timers }. `file` lets a test run a changed copy of the app. */
function build(opts) {
  opts = opts || {};
  const x = extract(opts.file);
  let timers = [];
  let timerId = 0;
  const window = {};                                /* no PPP_I18N (tx falls back to English), no PPP_COURSE, no coach provider */
  const ctx = vm.createContext({
    window, console,
    /* only the zero-delay ones are kept, for drainTimers (adoptScore's first plan); a delayed one is the toast clearing
       its message (say()), which no practice decision reads - keeping it would hold every app state of a run alive */
    setTimeout: (f, ms) => { timerId++; if (!(ms > 0)) timers.push(f); return timerId; },
    clearTimeout: () => {}
  });
  const methodsObj = '({\n' + x.methods.map(m => m.text).join(',\n') + '\n})';
  const code = x.engines.map(c => c.text).join('\n') + '\n' +
    'const __methods = ' + methodsObj + ';\n' +
    'const __stateInit = () => ' + x.stateInit + ';\n' +
    'const __startToday = function (S) {\n' + x.startToday + '};\n' +
    '({ PianoScore, Score, PerformanceEngine, TIMING_DEFAULTS, Learning, LEARN, Memory, MEMORY, Coach, COACH, Clock, DAY, MEM_LEVELS, __methods, __stateInit, __startToday })';
  const E = vm.runInContext(code, ctx, { filename: 'Piano Coach App.dc.html (practice engines)' });
  /* Speed only, never behaviour: Learning.measureView is a pure function of one measure's stat object, and
     Learning.record never edits a stat in place (it deep-copies the ones a run touches, so an unchanged measure keeps its
     object). The view of a stat object is therefore computed once. No caller writes to a view (legacy.test.js checks
     the page's code for that, and that the runner's results are the same without this cache). */
  if (opts.memo !== false) {
    const measureView = E.Learning.measureView;
    const seen = new WeakMap();
    E.Learning.measureView = function (stat) {
      if (!stat || typeof stat !== 'object') return measureView.call(this, stat);
      let v = seen.get(stat);
      if (!v) { v = measureView.call(this, stat); seen.set(stat, v); }
      return v;
    };
  }

  function newApp() {
    const app = Object.create(E.__methods);
    app._dead = false;
    app.state = E.__stateInit();
    app.setState = function (patch) {
      const p = typeof patch === 'function' ? patch(this.state, {}) : patch;
      if (p) this.state = { ...this.state, ...p };
    };
    /* the two stand-ins (see the header): a keyboard is connected, and Play turned Follow off */
    app.liveMidi = () => true;
    /* the home card's button, called the way its onClick calls it (with the state of the render it was drawn in) */
    app.startToday = function () { return E.__startToday.call(this, this.state); };
    app.go = () => () => {};                         /* "go to the player" when nothing is left: the runner is there already */
    app.state.toggles = Object.assign({}, app.state.toggles, { follow: false, midi: true });
    app.state.screen = 'player';
    return app;
  }
  function drainTimers() {
    const due = timers;
    timers = [];
    return due.map(f => f());
  }
  return { E, newApp, drainTimers, extracted: x, ctx };
}

module.exports = { build, extract, chunksOf, closure, methodOf, inlineScript, appHtml, ENGINE_ROOTS, METHODS, REPO, APP };
