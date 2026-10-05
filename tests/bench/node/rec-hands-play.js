#!/usr/bin/env node
/* G10a-2b: what the hand split of a recording's score asks of the hands (docs/GOALS/G10 section 26; a suite with "hands_play": true).

     node tests/bench/node/rec-hands-play.js --graphs graphs.jsonl --out out.jsonl     graphs: notate.js --emit-graph lines {"id", "graph"}

   Each output line is {"id", "play": {bars, moments, crossed, hard: {SPAN, KEYS, VELOCITY}, lines: n} | null} for the graph's two
   hands (a note's hand is its staff's limb, as everywhere in PPP):
     moments, crossed   critics/metrics.js handCrossing: at every onset, the notes each hand sounds (held ones included); a moment
                        has both hands sounding, and is crossed when the right hand's lowest note is below the left hand's highest.
                        The one-note arranger refuses a relaxed plan whose candidate crosses at more than 1 % of its moments
                        (candidates/index.js HAND_CROSSING_MAX); this is the same measure on the recording's own score.
     hard               the G5a analyzer (playability/) on the graph at the medium hand profile: hard violations by code.
     lines              the same analyzer on the two lines the one-note arranger never removes, the right hand's top note and the
                        left hand's bottom note of each attack (G9 singleNoteHands): their VELOCITY violations (a leap too far
                        for the time between two attacks), which make every candidate fail the arranger's hard filter.
   Metric tool, not part of the system under test: it reads the repository's scoregraph/, playability/ and critics/metrics.js. */
'use strict';
const fs = require('fs');
const path = require('path');

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const SG = require(path.join(repoRoot, 'scoregraph', 'index.js'));
const PLA = require(path.join(repoRoot, 'playability', 'index.js'));
const CRIT = require(path.join(repoRoot, 'critics', 'metrics.js'));
const graphsPath = arg('--graphs'), outPath = arg('--out');
if (!graphsPath || !outPath) { process.stderr.write('usage: rec-hands-play.js --graphs graphs.jsonl --out out.jsonl\n'); process.exit(2); }

const PROFILE = 'medium';

/* the two lines the one-note arranger keeps: per attack, the right hand's highest note and the left hand's lowest */
function lines(attacks) {
  return attacks.map(a => {
    const m = a.limb === 'RH' ? Math.max.apply(null, a.midis) : Math.min.apply(null, a.midis);
    const h = a.heads.find(x => x.midi === m) || a.heads[0];
    return { limb: a.limb, onsetSec: a.onsetSec, m: a.m, heads: [{ id: h.id, midi: m, offSec: h.offSec }], midis: [m] };
  });
}

function play(g) {
  const hc = CRIT.handCrossing(g);
  const attacks = PLA.graph.attacksOf(g);
  const rep = PLA.analyze(attacks, { profile: PROFILE });
  const by = rep.totals.byCode || {};
  const lineRep = PLA.analyze(lines(attacks), { profile: PROFILE });
  return { bars: g.timeline.measures.length, moments: hc.moments, crossed: hc.crossed,
    hard: { SPAN: by.SPAN || 0, KEYS: by.KEYS || 0, VELOCITY: by.VELOCITY || 0 }, lines: (lineRep.totals.byCode || {}).VELOCITY || 0 };
}

const out = fs.openSync(outPath, 'w');
fs.readFileSync(graphsPath, 'utf8').split('\n').filter(l => l.trim()).forEach(line => {
  const job = JSON.parse(line);
  let p = null;
  if (job.graph) {
    try { p = play(SG.parse(job.graph)); } catch (e) { p = null; }
  }
  fs.writeSync(out, JSON.stringify({ id: job.id, play: p }) + '\n');
});
fs.closeSync(out);
