/* G04 §20, A29: the static check - no DOM measurement, no browser global, no clock, no random, no network, no locale,
   no VexFlow in the modules that turn a graph into an EngravedScore. Shared by layout.test.js (the real engrave/) and
   layout-mutation.test.js (§23 M18: a mutated copy must be caught by name).

     scanSource(src, file)  -> [{rule, file, line, text}]   one source (the tiers below by file name)
     scanDir(dir)           -> the same over every engrave/*.js, and the files it scanned by tier

   Two tiers (G04 §20):
     MEASURE (DOM measurement: getBBox, getComputedTextLength, measureText, ...) - every file of engrave/ but the
       drawing backend BACKEND (svg.js, G4c+), which is where §20 allows it;
     PURE (DOM and browser globals, clock, random, timers, network, dynamic code, locale, VexFlow, a non-relative
       require) - every file of engrave/ but BACKEND and EDGE: the G4a render-source files that talk to the page by
       design (IndexedDB, navigator.storage, a timer between chunks, savedAt). A new file is PURE until it is named here.

   What is scanned: the source with its comments blanked (a comment may name what it avoids) and its strings and regex
   literals kept - a string is scanned because globalThis['document'] is access too. So a banned word in a string
   literal is a finding; a word that merely contains a banned one (documentation, windowed) is not (\b bounds).
   Rules by construct, whatever precedes the dot: `root.document`, `globalThis.document`, `self.document` and a plain
   `document` are all `dom-global`. Two words need a rule of their own:
     window     - the close view's config field (cfg.window, config.window, { window: ... }) is layout's own name
                  (G4-B9); anywhere else, `window` is the browser global;
     globalThis - only the UMD wrapper's `typeof globalThis !== 'undefined' ? globalThis : this` may name it. */
'use strict';
const fs = require('fs');
const path = require('path');

const BACKEND = { 'svg.js': 'the drawing backend (G4c+): §20 allows DOM measurement here and nowhere else' };
/* the page adapter (G4d-2): the one file that works with the DOM - it puts the SVG into the app's view, reads the pointer
   (getScreenCTM), times its steps (performance.now) and colours through the page's CSS. Nothing in engrave/ requires it,
   so no path from a graph to an EngravedScore or an SVG can reach it (layout.test.js checks) */
const PAGE = { 'page.js': 'the renderer in the page (G4d-2): the DOM, the pointer, timings - it draws nothing it measures' };
const EDGE = {
  'index.js': 'the entry point: finds the page\'s IndexedDB and navigator.storage (G4a, G4-U1)',
  'source.js': 'the render source: yields to the page with setTimeout between chunks (G4a)',
  'store.js': 'the graph cache: IndexedDB, open/call timeouts, savedAt = Date.now() (G4a)'
};

/* [rule, regex] - a regex must be global (every finding is reported) */
const MEASURE = [
  ['dom-measure', /\b(getBBox|getComputedTextLength|getSubStringLength|getExtentOfChar|getStartPositionOfChar|getEndPositionOfChar|getNumberOfChars|getTotalLength|getPointAtLength|getBoundingClientRect|getClientRects|getComputedStyle|getScreenCTM|getCTM|measureText|offsetWidth|offsetHeight|offsetLeft|offsetTop|clientWidth|clientHeight|scrollWidth|scrollHeight)\b/g]
];
const PURE = [
  ['dom-global', /\b(document|navigator|localStorage|sessionStorage|indexedDB|devicePixelRatio|innerWidth|innerHeight|outerWidth|outerHeight|matchMedia|getSelection|visualViewport|HTMLElement|SVGElement|OffscreenCanvas|DOMParser|XMLSerializer|MutationObserver|ResizeObserver|IntersectionObserver)\b/g],
  ['global-object', /\bself\s*\.|\bglobal\s*[.[]|\bframes\s*[.[]/g],
  ['clock', /\bDate\b|\bperformance\b|\bprocess\b/g],
  ['timer', /\b(setTimeout|setInterval|setImmediate|queueMicrotask|requestAnimationFrame|requestIdleCallback)\b/g],
  ['random', /\bMath\s*(\.\s*random\b|\[)|\bcrypto\b/g],
  ['network', /\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|sendBeacon)\b|\bimport\s*\(/g],
  ['dynamic-code', /\beval\s*\(|\bFunction\s*\(/g],
  ['locale', /\bIntl\b|\btoLocale\w*|\blocaleCompare\b/g],
  ['vexflow', /vexflow|\bVex\b/gi],
  ['require-nonrelative', /\brequire\s*\(\s*(?!['"]\.\.?\/)/g]
];
const UMD_ROOT = /typeof\s+globalThis\s*!==\s*['"]undefined['"]\s*\?\s*globalThis\s*:\s*this/g;

/* `window`: the browser global unless it is the config field */
function windowFindings(code) {
  const out = [];
  const re = /\bwindow\b/g;
  let m;
  while ((m = re.exec(code))) {
    const before = code.slice(Math.max(0, m.index - 40), m.index), after = code.slice(m.index + 6, m.index + 46);
    const field = /\b(cfg|config)\s*\.\s*$/.test(before);
    const key = /[{,]\s*$/.test(before) && /^\s*:/.test(after);
    if (!field && !key) out.push(m.index);
  }
  return out;
}

/* The source with comments blanked (newlines kept, so line numbers hold), strings, template literals and regex
   literals kept. A '/' starts a regex where an operand is expected: after an operator or opening bracket, at the
   start, or after a keyword that takes an expression. */
const KEYWORDS_BEFORE_EXPR = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
function regexAllowed(out) {
  let k = out.length - 1;
  while (k >= 0 && /\s/.test(out[k])) k--;
  if (k < 0) return true;
  const c = out[k];
  if (/[\w$]/.test(c)) {
    let s = k;
    while (s > 0 && /[\w$]/.test(out[s - 1])) s--;
    return KEYWORDS_BEFORE_EXPR.has(out.slice(s, k + 1));
  }
  return c !== ')' && c !== ']' && c !== '}';
}
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2), end = j < 0 ? n : j + 2;
      out += src.slice(i, end).replace(/[^\r\n]/g, ' ');
      i = end;
    } else if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      out += ' '.repeat(j - i);
      i = j;
    } else if (c === '"' || c === '\'' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && regexAllowed(out)) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '[') cls = true;
        else if (ch === ']') cls = false;
        else if (ch === '/' && !cls) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      out += src.slice(i, j);
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const lineOf = (code, idx) => code.slice(0, idx).split('\n').length;
function tiers(file) {
  const base = path.basename(file);
  return { measure: !BACKEND[base] && !PAGE[base], pure: !BACKEND[base] && !EDGE[base] && !PAGE[base] };
}
function scanSource(src, file) {
  const t = tiers(file || 'x.js');
  const code = stripComments(src);
  const out = [];
  const add = (rule, idx, len) => out.push({ rule: rule, file: file || null, line: lineOf(code, idx), text: code.substr(idx, len).trim() });
  const run = list => list.forEach(([rule, re]) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) { add(rule, m.index, Math.max(1, m[0].length)); if (!m[0].length) re.lastIndex++; }
  });
  if (t.measure) run(MEASURE);
  if (t.pure) {
    run(PURE);
    windowFindings(code).forEach(idx => add('dom-global', idx, 6));
    const rest = code.replace(UMD_ROOT, s => ' '.repeat(s.length));
    const g = /\bglobalThis\b/g;
    let m;
    while ((m = g.exec(rest))) add('global-object', m.index, 10);
  }
  return out.sort((a, b) => a.line - b.line || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
}
function scanDir(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
  const findings = [];
  const scanned = { measure: [], pure: [] };
  files.forEach(f => {
    const t = tiers(f);
    if (t.measure) scanned.measure.push(f);
    if (t.pure) scanned.pure.push(f);
    scanSource(fs.readFileSync(path.join(dir, f), 'utf8'), f).forEach(x => findings.push(x));
  });
  return { findings: findings, scanned: scanned, files: files };
}

module.exports = { BACKEND, EDGE, PAGE, MEASURE, PURE, stripComments, scanSource, scanDir };
