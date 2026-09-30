'use strict';
/* G9e refusals: two synthetic dense "Vocaloid piano cover" pieces (tests/realize/g9e-refusals.test.js, the refusal checks). Built with the repo's own test helper mk(): A is an extreme cover
   (fast 16th runs to C7, octave/triad chords, a busy left hand), B a typical busy pop arrangement. Both are refused by the strict planner at every level.
   (The investigator's own file, synth.js, copied with the repo path made relative.) */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { mk } = require(path.join(REPO, 'tests', 'scoregraph', 'g3-helpers.js'));

const NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const pname = d => { while (d > 7 * 7 + 1) d -= 7; return NAMES[((d % 7) + 7) % 7] + Math.floor(d / 7); }; /* diatonic degree d: 0 = C0; folded to at most D7 */
const deg = (name, oct) => NAMES.indexOf(name) + 7 * oct;
const P = (name, oct) => pname(deg(name, oct));

/* A: fast 16th runs in the right hand (C5..C7), chordal melody on beat 1 (octaves/triads), busy left hand (16th arpeggios C2..E4 + octave bass chords); 16 bars of 4/4 in C major */
function pieceA() {
  const rh = [], lh = [];
  const scaleUp = (start, n) => Array.from({ length: n }, (_, i) => pname(start + i));
  for (let bar = 0; bar < 16; bar++) {
    const base = deg('C', 5) + (bar % 4) * 2; /* C5..: 4-bar climbing runs */
    const toks = [];
    /* beat 1: a chordal melody (triad, then octave-doubled) as 8ths; beats 2-4: 16th runs that climb above C6..C7 */
    if (bar % 2 === 0) toks.push(pname(base) + '+' + pname(base + 2) + '+' + pname(base + 4) + ':8', pname(base + 5) + '+' + pname(base + 7) + ':8');
    else toks.push(pname(base) + '+' + pname(base + 7) + ':8', pname(base + 1) + '+' + pname(base + 8) + ':8');
    for (let beat = 1; beat < 4; beat++) for (let k = 0; k < 4; k++) toks.push(pname(base + 3 + beat * 2 + k + (bar % 4 === 3 ? 6 : 0)) + ':16');
    rh.push(toks.join(' '));
    const bass = [deg('C', 2), deg('A', 1), deg('F', 1), deg('G', 1)][bar % 4];
    const lt = [];
    /* beat 1: octave + fifth bass chord as an 8th pair; then 16th arpeggio across two octaves */
    lt.push(pname(bass) + '+' + pname(bass + 7) + ':8', pname(bass) + '+' + pname(bass + 7) + '+' + pname(bass + 11) + ':8');
    for (let beat = 1; beat < 4; beat++) for (let k = 0; k < 4; k++) lt.push(pname(bass + [0, 2, 4, 7][k] + beat * 2 + (k === 3 ? 7 : 0)) + ':16');
    lh.push(lt.join(' '));
  }
  return mk({ time: [4, 4], rh: rh.join(' | '), lh: lh.join(' | ') });
}

/* B: less extreme (8th notes, chordal right hand up to A6, left hand octave bass + broken chord) - a "typical" busy pop piano arrangement */
function pieceB() {
  const rh = [], lh = [];
  for (let bar = 0; bar < 16; bar++) {
    const base = deg('E', 5) + (bar % 4);
    const r = [];
    for (let k = 0; k < 8; k++) r.push(k % 2 === 0 ? pname(base + (k % 4)) + '+' + pname(base + (k % 4) + 7) + ':8' : pname(base + 2 + (k % 3)) + ':8');
    rh.push(r.join(' '));
    const bass = [deg('C', 2), deg('A', 1), deg('F', 1), deg('G', 1)][bar % 4];
    const l = [];
    for (let k = 0; k < 8; k++) l.push(k === 0 ? pname(bass) + '+' + pname(bass + 7) + ':8' : pname(bass + [0, 2, 4, 7, 4, 2, 4][k - 1] + 7) + ':8');
    lh.push(l.join(' '));
  }
  return mk({ time: [4, 4], rh: rh.join(' | '), lh: lh.join(' | ') });
}

module.exports = { pieceA, pieceB };
