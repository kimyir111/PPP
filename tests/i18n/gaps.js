#!/usr/bin/env node
/* G13-0 static i18n checker: every English string the page can show must have an entry in the ko, ja and zh catalogs.

     node tests/i18n/gaps.js [--check] [--update [--allow-new]] [--strict] [--list] [--json] [--root DIR] [--baseline FILE]

   The model (i18n.js): the English text is the key. `PPP_I18N.apply` walks the DOM text nodes and the placeholder / title / aria-label
   attributes, and `tx('literal')` translates a string made in code. So two kinds of string are read from the sources:
     template   the literal text pieces and the placeholder / title / aria-label values of the page's `<x-dc>` template (the pieces around
                `{{ }}` expressions are separate text nodes at run time; `<style>` and `<svg>` are not translated);
     tx         the first argument of every `tx('literal')` / `tx("literal")` / tx(`literal`) call in the shipped scripts.
   A string is a GAP in a locale when that locale's catalog has neither the string nor its normalized form (i18n.js `normalize`: curly
   quotes straight, white space collapsed) as a key. Strings that need no translation (PPP, MIDI, MusicXML, URLs, composer names...) are
   in ALLOW below. A text built by concatenation is invisible here: write it as one `tx('... {{n}} ...')` sentence (G13-D14); the live
   walk (tests/live/i18n-walk.js) checks what a static check cannot. A second check, PARITY, wants every key of one catalog in the others.

   --check    the CI form: exit 1 when a gap or a parity gap exists that the committed baseline does not list (only NEW gaps fail).
   --update   rewrite the baseline from the sources. It refuses when that would ADD an entry unless --allow-new is given, so the baseline
              can only shrink by accident (a new gap in the diff of the baseline file is then a deliberate act).
   --strict   with --check: also exit 1 when the baseline lists gaps that are fixed (so G13-2 shrinks it to nothing, and it stays there).
   --list     print every current gap, not only the new ones.   --json   print the result as JSON.
   --root     the tree to read (default: this repository).      --baseline   the baseline file (default: <root>/tests/i18n/gaps-baseline.json).

   Reads only the page, the shipped scripts and i18n/*.json. No network, no dependencies. */
'use strict';
const fs = require('fs');
const path = require('path');

const LOCALES = ['ko-KR', 'ja-JP', 'zh-CN'];
const APP = 'Piano Coach App.dc.html';
const BASELINE_REL = 'tests/i18n/gaps-baseline.json';
// directories whose scripts are not the page's (tests, tools, vendored libraries, data) or hold no scripts
const SKIP_DIRS = new Set('node_modules .git tests tools vendor docs data review i18n catalog samples audio assets __pycache__'.split(' '));   // none of these is read
const MIN_TEMPLATE = 50, MIN_TX = 300;
const SCRIPT_EXT = /\.(?:js|mjs|cjs|html)$/;

// Words that stay as they are in every language. A string whose Latin words are all in this set, or that is a URL, is not a gap.
const ALLOW_WORDS = new Set(['PPP', 'AI', 'ARR', 'MIDI', 'MusicXML', 'MXL', 'BPM', 'PDF', 'YouTube', 'MP3', 'MP4', 'WAV', 'M4A', 'PNG', 'JPG', 'JPEG',
  'URL', 'OMR', 'USB', 'Hanon', 'Czerny', 'Beyer', 'Burgmüller', 'Clementi', 'Bach', 'Mozart', 'Beethoven', 'Chopin', 'Satie', 'Debussy']);
const ALLOW_PATTERNS = [/^https?:\/\//i];

const norm = s => String(s == null ? '' : s).replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E\u201F]/g, '"').replace(/\s+/g, ' ').trim();
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', middot: '·', rarr: '→', larr: '←', times: '×', mdash: '—', ndash: '–', hellip: '…' };
const decode = s => s.replace(/&#39;/g, "'").replace(/&(amp|lt|gt|quot|nbsp|middot|rarr|larr|times|mdash|ndash|hellip);/g, (_, n) => ENTITIES[n]);

function allowed(s) {
  if (ALLOW_PATTERNS.some(rx => rx.test(s))) return true;
  const left = s.replace(/[A-Za-zÀ-ÿ]+/g, w => (ALLOW_WORDS.has(w) ? ' ' : w));
  return !/[A-Za-z]{2,}/.test(left);
}
const wanted = s => s.length >= 2 && /[A-Za-z]{2,}/.test(s) && !allowed(s);

function lineAt(text, index) { let n = 1; for (let i = text.indexOf('\n'); i >= 0 && i < index; i = text.indexOf('\n', i + 1)) n++; return n; }

function walk(root, rel, out) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(root, rel ? rel + '/' + e.name : e.name, out); }
    else if (SCRIPT_EXT.test(e.name)) out.push(rel ? rel + '/' + e.name : e.name);
  }
  return out;
}

/** The strings the page can show: {template: Map(string -> 'file:line'), tx: Map(...), files: [scanned files with a tx literal], dynamicCalls}. */
function extract(root) {
  const app = fs.readFileSync(path.join(root, APP), 'utf8');
  const tStart = app.indexOf('<x-dc>'), tEnd = app.indexOf('</x-dc>');
  if (tStart < 0 || tEnd < tStart) throw new Error('the page has no <x-dc> template: the checker no longer understands it');
  const blank = m => m.replace(/[^\n]/g, ' ');                 // keep the offsets (and so the line numbers) of what is cut out
  const tpl = app.slice(tStart, tEnd).replace(/<style[\s\S]*?<\/style>/g, blank).replace(/<svg[\s\S]*?<\/svg>/g, blank);
  const template = new Map();
  const addTpl = (s, at) => { s = norm(decode(s)); if (wanted(s) && !template.has(s)) template.set(s, APP + ':' + lineAt(app, tStart + at)); };
  for (const m of tpl.matchAll(/>([^<>]+)</g)) for (const piece of m[1].split(/\{\{[\s\S]*?\}\}/)) addTpl(piece, m.index);
  for (const m of tpl.matchAll(/\b(?:placeholder|title|aria-label)="([^"{]+)"/g)) addTpl(m[1], m.index);

  const tx = new Map();
  const files = [];
  let dynamicCalls = 0;
  const literal = /\btx\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*[,)]/g;
  for (const rel of walk(root, '', [])) {
    if (rel === 'i18n.js') continue;                           // defines tx
    const src = rel === APP ? app : fs.readFileSync(path.join(root, rel), 'utf8');
    let found = false;
    for (const m of src.matchAll(literal)) {
      if (m[1] === '`' && m[2].includes('${')) { dynamicCalls++; continue; }
      const s = norm(m[2].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\n/g, ' ').replace(/\\(['"`\\])/g, '$1'));
      found = true;
      if (wanted(s) && !tx.has(s)) tx.set(s, rel + ':' + lineAt(src, m.index));
    }
    if (found) files.push(rel);
  }
  return { template, tx, files, dynamicCalls };
}

/** {locale: Set of keys, including the normalized form of each}, and {locale: Set of raw keys}. */
function catalogs(root) {
  const idx = {}, raw = {};
  for (const l of LOCALES) {
    const content = JSON.parse(fs.readFileSync(path.join(root, 'i18n', l + '.json'), 'utf8')).content || {};
    raw[l] = new Set(Object.keys(content));
    idx[l] = new Set(raw[l]);
    for (const k of raw[l]) idx[l].add(norm(k));
  }
  return { idx, raw };
}

/** The current state: gaps {kind: {string: [locales lacking it]}}, parity {key: [locales lacking it]}, and the counts. */
function scan(root) {
  const ex = extract(root), cat = catalogs(root);
  // a checker that reads nothing passes everything: refuse a tree where far fewer strings than today's 119 / 813 are found
  if (ex.template.size < MIN_TEMPLATE || ex.tx.size < MIN_TX) throw new Error(`only ${ex.template.size} template strings and ${ex.tx.size} tx() literals were read (expected at least ${MIN_TEMPLATE} and ${MIN_TX}): the checker no longer understands the sources`);
  const gaps = { template: {}, tx: {} }, where = {};
  for (const kind of ['template', 'tx']) {
    for (const [s, at] of ex[kind]) {
      const lacking = LOCALES.filter(l => !cat.idx[l].has(s));
      if (lacking.length) { gaps[kind][s] = lacking; where[kind + '\u0000' + s] = at; }
    }
  }
  const all = new Set(LOCALES.flatMap(l => [...cat.raw[l]]));
  const parity = {};
  for (const k of all) { const lacking = LOCALES.filter(l => !cat.raw[l].has(k) && !cat.idx[l].has(norm(k))); if (lacking.length) parity[k] = lacking; }
  return { gaps, parity, where, counts: { template: ex.template.size, tx: ex.tx.size, scannedFiles: ex.files, dynamicCalls: ex.dynamicCalls, catalogs: Object.fromEntries(LOCALES.map(l => [l, cat.raw[l].size])) } };
}

const flat = state => {            // the set of "cells": kind, string, locale
  const out = new Set();
  for (const kind of ['template', 'tx']) for (const [s, ls] of Object.entries(state.gaps[kind])) for (const l of ls) out.add([kind, s, l].join('\u0000'));
  for (const [k, ls] of Object.entries(state.parity)) for (const l of ls) out.add(['parity', k, l].join('\u0000'));
  return out;
};

function readBaseline(file) {
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { gaps: { template: b.gaps && b.gaps.template || {}, tx: b.gaps && b.gaps.tx || {} }, parity: b.parity || {} };
}
function baselineText(state) {
  const n = Object.keys(state.gaps.template).length + Object.keys(state.gaps.tx).length;
  const NL = '\n';
  const block = (o, pad) => (Object.keys(o).length
    ? '{' + NL + Object.keys(o).sort().map(k => pad + '  ' + JSON.stringify(k) + ': ' + JSON.stringify(o[k])).join(',' + NL) + NL + pad + '}'
    : '{}');
  const note = 'G13-0: the i18n gaps that existed when the static checker (tests/i18n/gaps.js) was added. Only gaps NOT listed here fail the gate. '
    + 'G13-2 translates them and empties this file; never add to it by hand (--update refuses to add without --allow-new).';
  return [
    '{',
    '  "note": ' + JSON.stringify(note) + ',',
    '  "total": { "strings": ' + n + ', "parityKeys": ' + Object.keys(state.parity).length + ' },',
    '  "gaps": {',
    '    "template": ' + block(state.gaps.template, '    ') + ',',
    '    "tx": ' + block(state.gaps.tx, '    '),
    '  },',
    '  "parity": ' + block(state.parity, '  '),
    '}'
  ].join(NL) + NL;
}

/** {fresh: cells in state and not in the baseline, fixed: cells in the baseline and not in state}. */
function compare(state, base) {
  const now = flat(state), then = flat(base);
  return { fresh: [...now].filter(c => !then.has(c)).sort(), fixed: [...then].filter(c => !now.has(c)).sort() };
}
const show = cell => { const [kind, s, l] = cell.split('\u0000'); return { kind, string: s, locale: l }; };

function main(argv) {
  const args = argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const root = path.resolve(opt('--root', path.join(__dirname, '..', '..')));
  const baselineFile = path.resolve(opt('--baseline', path.join(root, BASELINE_REL)));
  const state = scan(root);
  const nGaps = Object.keys(state.gaps.template).length + Object.keys(state.gaps.tx).length, nParity = Object.keys(state.parity).length;
  const log = (...a) => { if (!args.includes('--json')) console.log(...a); };
  log(`i18n static check of ${root}`);
  log(`  strings read: ${state.counts.template} template, ${state.counts.tx} tx() literals (${state.counts.scannedFiles.join(', ')}); catalogs: ${LOCALES.map(l => l + ' ' + state.counts.catalogs[l]).join(', ')}`);
  log(`  gaps now: ${nGaps} strings (${Object.keys(state.gaps.template).length} template, ${Object.keys(state.gaps.tx).length} tx), parity: ${nParity} keys`);

  if (args.includes('--update')) {
    let base = { gaps: { template: {}, tx: {} }, parity: {} };
    try { base = readBaseline(baselineFile); } catch (e) { /* no baseline yet */ }
    const { fresh } = compare(state, base);
    if (fresh.length && !args.includes('--allow-new')) {
      console.log(`REFUSED: updating would add ${fresh.length} gap(s) to the baseline (use --allow-new only for a deliberate decision):`);
      for (const c of fresh.slice(0, 30)) { const g = show(c); console.log(`  [${g.kind}] ${g.locale}: ${JSON.stringify(g.string)}`); }
      return 1;
    }
    fs.writeFileSync(baselineFile, baselineText(state));
    log(`baseline written: ${baselineFile}`);
    return 0;
  }

  let base;
  try { base = readBaseline(baselineFile); } catch (e) { console.log(`FAIL: cannot read the baseline ${baselineFile}: ${e.message}`); return 1; }
  const { fresh, fixed } = compare(state, base);
  if (args.includes('--json')) console.log(JSON.stringify({ gaps: nGaps, parity: nParity, new: fresh.map(show), fixed: fixed.length, counts: state.counts }, null, 1));
  if (args.includes('--list') && !args.includes('--json')) {
    for (const kind of ['template', 'tx']) for (const [s, ls] of Object.entries(state.gaps[kind])) log(`  [${kind}] ${state.where[kind + '\u0000' + s]} lacks ${ls.join(',')}: ${JSON.stringify(s)}`);
    for (const [k, ls] of Object.entries(state.parity)) log(`  [parity] lacks ${ls.join(',')}: ${JSON.stringify(k)}`);
  }
  if (fixed.length) log(`  ${fixed.length} gap cell(s) of the baseline are fixed: run  node tests/i18n/gaps.js --update  to shrink it${args.includes('--strict') ? ' (--strict: this fails)' : ''}`);
  if (fresh.length) {
    log(`FAIL: ${fresh.length} new gap cell(s) that the baseline does not list. Add the string to i18n/ko-KR.json, ja-JP.json and zh-CN.json (key = the English text):`);
    for (const c of fresh.slice(0, 40)) {
      const g = show(c);
      log(`  [${g.kind}] ${g.kind === 'parity' ? '' : (state.where[g.kind + '\u0000' + g.string] || '') + ' '}missing in ${g.locale}: ${JSON.stringify(g.string)}`);
    }
    if (fresh.length > 40) log(`  ... and ${fresh.length - 40} more`);
    return 1;
  }
  if (fixed.length && args.includes('--strict')) { log('FAIL (--strict): the baseline lists fixed gaps'); return 1; }
  log(`PASS: no new gap (baseline: ${Object.keys(base.gaps.template).length + Object.keys(base.gaps.tx).length} strings, ${Object.keys(base.parity).length} parity keys)`);
  return 0;
}

module.exports = { extract, catalogs, scan, compare, flat, readBaseline, baselineText, allowed, norm, LOCALES, APP, BASELINE_REL };
if (require.main === module) {
  try { process.exitCode = main(process.argv); } catch (e) { console.error('i18n checker error: ' + (e && e.stack || e)); process.exitCode = 2; }
}
