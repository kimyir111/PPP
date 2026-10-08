/* Shared helpers for tests/practice/*.test.js (node --test, no dependencies; docs/GOALS/G11 §6.1, phase G11a-1). */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SG = require(path.join(REPO, 'scoregraph', 'index.js'));
const PLAN = require(path.join(REPO, 'practice', 'plan.js'));
const FIX = path.join(__dirname, 'fixtures');
const L = SG.legacy;

/* the graph of a MusicXML text, or of a fixture of this directory by name */
function graphOfText(text, id) {
  const r = SG.musicxml.import(text, { scoreId: id || 'practice' });
  if (!r.ok) throw new Error('import failed: ' + r.code + ' ' + r.message);
  return r.graph;
}
/* LF whatever the checkout did to the file (a Windows checkout gives it CRLF), so a test can edit a fixture by a multi-line anchor */
const fixtureText = name => fs.readFileSync(path.join(FIX, name + '.musicxml'), 'utf8').split('\r\n').join('\n');
const fixtureGraph = name => graphOfText(fixtureText(name), name);
/* a file of the repository (MusicXML, MXL, MIDI), through the importer the app uses; null if it does not open. A graph is frozen, so
   the one import is shared by every test of the process. */
const graphs = new Map();
async function graphOfFile(rel) {
  if (graphs.has(rel)) return graphs.get(rel);
  const r = await SG.importFile(new Uint8Array(fs.readFileSync(path.join(REPO, rel))), { name: path.basename(rel), scoreId: 'practice' });
  graphs.set(rel, r.ok ? r.graph : null);
  return graphs.get(rel);
}
/* every MusicXML file of a directory of the repository, sorted: [rel path, ...] */
const filesIn = (dir, re) => fs.readdirSync(path.join(REPO, dir)).filter(f => re.test(f)).sort().map(f => dir + '/' + f);

/* ------------------------------------------------------------ the app's own player */
/* PianoScore, Score and the follow gates, read out of Piano Coach App.dc.html with the few constants they use, the way
   tests/scoregraph/app-playback.test.js reads them: these are the app's own functions, not copies. The same comparison in
   the running page (with the scheduler and the matcher) is the G11a-2 harness. */
let app = null;
const scores = new WeakMap();
function appPlayer() {
  if (app) return app;
  const html = fs.readFileSync(path.join(REPO, 'Piano Coach App.dc.html'), 'utf8').replace(/\r\n/g, '\n');
  const decl = name => {
    const i = html.indexOf('\nconst ' + name + ' = ');
    if (i < 0) throw new Error('const ' + name + ' is not in the app');
    const line = html.slice(i + 1, html.indexOf('\n', i + 1));
    if (/;\s*$/.test(line)) return line + '\n';
    return html.slice(i + 1, html.indexOf('\n};\n', i) + 4);
  };
  const fn = name => {
    const i = html.indexOf('\nfunction ' + name + '(');
    if (i < 0) throw new Error('function ' + name + ' is not in the app');
    return html.slice(i + 1, html.indexOf('\n}\n', i) + 3);
  };
  const body = decl('PIANO') + decl('DYN_VEL') + decl('PEDAL_CC') + fn('firstAtOrAfter') + decl('STEP_SEMI') + decl('PITCH_RE') +
    fn('pitchToMidi') + fn('shiftPitchOctave') + fn('ottavaSemitones') + decl('PianoScore') + decl('Score') +
    'return { Score: Score, PianoScore: PianoScore };';
  const lib = new Function(body)();
  /* the follow gates are a method of the transport class: evaluate it as a method of a plain object */
  const a = html.indexOf('\n  followGates() {');
  const z = html.indexOf('\n  followDisarmRest()', a);
  if (a < 0 || z < a) throw new Error('followGates is not where it was');
  const gates = new Function('Score', 'return ({' + html.slice(a + 1, z) + '});')(lib.Score);
  app = {
    Score: lib.Score,
    PianoScore: lib.PianoScore,
    /* the Score a person's import leaves in the app: finalize(toScore(graph)); one per graph (a graph is frozen) */
    scoreOf(g) {
      if (!scores.has(g)) scores.set(g, lib.Score.finalize(L.toScore(g, { name: 'practice', id: 'practice:' + g.id })));
      return scores.get(g);
    },
    gates(score, from, to, hands) {
      const self = {
        state: { score: score, hands: hands },
        range: () => [from, to],
        handOk: (n, h) => (n.hand === 'x' ? false : !h || h === 'both' || (h === 'right' ? n.hand === 'r' : n.hand === 'l')),
        _gatesKey: null, _gates: null
      };
      return gates.followGates.call(self);
    }
  };
  return app;
}

/* ------------------------------------------------------------ canonical forms */
/* What the player, the scheduler and the matcher read of a plan, as plain arrays (floats exactly: the plan is bit for bit
   the old one's). The same function reads the old plan and the new, which carry these fields alike. */
function canon(plan) {
  const vi = new Map(plan.visits.map((v, i) => [v, i]));
  return {
    visits: plan.visits.map(v => [v.number, v.pass, v.startQ, v.lenQ, v.soundQ]),
    strikes: plan.strikes.map(s => [vi.get(s.visit), s.q, s.upQ, s.midi, s.vel, s.hand, s.m, s.abs]),
    ccs: plan.ccs.map(c => [c.q, c.cc, c.value, c.kind, c.type]),
    beats: plan.beats.map(b => [b.q, b.accent, b.m]),
    tempoMap: plan.tempoMap.map(t => [t.q, t.bpm]),
    soundLengthQ: plan.soundLengthQ,
    pedal: plan.pedal.map(p => [p[0], p[1]])
  };
}
const gatesCanon = gs => gs.map(g => [g.b, g.m, !!g.rest, g.dur === undefined ? null : g.dur, (g.notes || []).map(n => [n.midi, n.hand])]);
/* the first place two canonical forms differ, as a sentence ('' when they do not) */
function firstDiff(a, b) {
  for (const k of Object.keys(a)) {
    const x = a[k], y = b[k];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) return k + ': ' + x.length + ' against ' + y.length + ' entries';
      for (let i = 0; i < x.length; i++) if (JSON.stringify(x[i]) !== JSON.stringify(y[i])) return k + '[' + i + ']: ' + JSON.stringify(x[i]) + ' against ' + JSON.stringify(y[i]);
    }
    return k + ': ' + JSON.stringify(x) + ' against ' + JSON.stringify(y);
  }
  return '';
}

/* the play order as a short string: measure numbers, ^n for the n-th pass (n > 1), ' for the way back after a D.C. / D.S. */
const order = plan => plan.visits.map(v => v.number + (v.leg ? "'" : '') + (v.pass > 1 && !v.leg ? '^' + v.pass : '')).join(' ');
/* measure numbers only, in play order */
const numbers = plan => plan.visits.map(v => v.number).join(' ');
const round = (x, d) => Math.round(x * Math.pow(10, d || 6)) / Math.pow(10, d || 6);

/* a deterministic 32-bit LCG (the one the other suites use) */
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

module.exports = { REPO, SG, PLAN, FIX, L, graphOfText, fixtureText, fixtureGraph, graphOfFile, filesIn, appPlayer, canon, gatesCanon, firstDiff,
  order, numbers, round, lcg };
