'use strict';
/* Would the suite notice if the plan got worse? (docs/GOALS/G11 §6.2 step 8: "mutation tests on practice/plan.js ... must each fail the check")

   plan.js is mutated here the way tests/scoregraph/mutation.test.js mutates the importers: a whole copy of the module with ONE
   line changed, loaded on its own so the real one is untouched. Each mutation is harmful on purpose, and each has to make a named,
   musical difference on a named fixture: the probe reads one thing a player hears or a student is asked (the order of the bars, a
   release, a velocity, the beats, a gate), the real module gives the value written here, the mutant does not. A mutation that
   changes nothing would mean a fixture hole; a mutation whose anchor has drifted fails loudly (the anchor must match exactly once)
   rather than silently passing, which is the failure mode G0's AnchorMissing exists for.

   MUT-NOOP is the control: a comment, and nothing moves. The first five are the ones G11 §6.2 names (drop the pedal change lift, shift
   one visit, key ties by pitch only, ignore the hand filter, an off-by-one volta pass). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers.js');

const SRC = path.join(H.REPO, 'practice', 'plan.js');
const roots = [];
let counter = 0;
test.after(() => roots.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { void e; } }));

/* the source with LF line ends (a Windows checkout gives CRLF, and the anchors are written with \n) */
const source = fs.readFileSync(SRC, 'utf8').split('\r\n').join('\n');

/* a copy of the module with each [find, replace] applied (each find must be in the source exactly once), required afresh */
function mutant(edits) {
  let text = source;
  edits.forEach(([find, replace]) => {
    const count = text.split(find).length - 1;
    assert.equal(count, 1, 'the anchor ' + JSON.stringify(find.slice(0, 70)) + ' matches ' + count + ' times, not once');
    text = text.replace(find, () => replace);
  });
  /* the copy lives in a temp directory: its two requires name the repository's files */
  const rational = JSON.stringify(path.join(H.REPO, 'scoregraph', 'rational.js')), pitch = JSON.stringify(path.join(H.REPO, 'scoregraph', 'pitch.js'));
  const wired = text.replace("require('../scoregraph/rational.js'), require('../scoregraph/pitch.js')", () => 'require(' + rational + '), require(' + pitch + ')');
  assert.notEqual(wired, text, 'the requires were rewired');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-mutant-' + (++counter) + '-'));
  roots.push(dir);
  const file = path.join(dir, 'plan.js');
  fs.writeFileSync(file, wired);
  return require(file);
}

/* the fixtures the probes read, once */
const memo = {};
const fx = name => memo[name] || (memo[name] = H.fixtureGraph(name));
const sg = name => memo['sg:' + name] || (memo['sg:' + name] = H.graphOfText(fs.readFileSync(path.join(H.REPO, 'tests', 'scoregraph', 'fixtures', 'xml', name + '.musicxml'), 'utf8').split('\r\n').join('\n'), name));
const e = name => memo['e:' + name] || (memo['e:' + name] = H.graphOfText(fs.readFileSync(path.join(H.REPO, 'tests', 'engrave', 'fixtures', 'e', name + '.musicxml'), 'utf8').split('\r\n').join('\n'), name));
const ord = (PL, g, opts) => H.order(PL.build(g, opts));
const strike = (PL, g, opts, f) => PL.build(g, opts).strikes.find(f);

/* id, the mutation, what is read, and what the real module answers (the mutant must not) */
const MUTATIONS = [
  { id: 'MUT-PEDAL-LIFT', why: 'a printed pedal change no longer lifts the damper: the pedal stays down through it (CC64 127 only)',
    edits: [["const lifts = p => !!p && p.type === 'change'", "const lifts = p => !!p && p.type === 'never'"]],
    probe: PL => PL.build(fx('pedals')).ccs.filter(c => c.q === 2 && c.cc === 64).map(c => c.value).join(','), clean: '0,127' },
  { id: 'MUT-VISIT-SHIFT', why: 'one visit is placed half a quarter late: every strike after it drifts from the written bars',
    edits: [['soundLengthQ += v.lenQ; });', 'soundLengthQ += v.lenQ + (v.index === 1 ? 0.5 : 0); });']],
    probe: PL => PL.build(sg('repeats-simple')).strikes.map(s => s.q).join(','), clean: '0,4,8,12,16' },
  { id: 'MUT-TIE-PITCH-ONLY', why: 'a tie\'s end is found by pitch alone: the last note of that pitch anywhere is "the end", and the real continuation is struck again',
    edits: [["at.set(n.midi + '@' + n.abs.toFixed(3), n)", 'at.set(String(n.midi), n)'], ["at.get(n.midi + '@' + (cur.abs + cur.dur).toFixed(3))", 'at.get(String(n.midi))']],
    probe: PL => PL.build(fx('ties-edge')).strikes.filter(s => s.m === 2 && s.midi === 72).length, clean: 0 },
  { id: 'MUT-HAND-FILTER', why: 'the hand filter lets another part\'s notes through: follow mode asks for a note that is not the student\'s',
    edits: [["    if (n.hand === 'x') return false;                 /* a cue staff is read, not played */\n", '']],
    probe: PL => PL.followGates(PL.build(e('E35-voice-and-piano')), 'both').reduce((n, g) => n + g.notes.length, 0), clean: 8 },
  { id: 'MUT-VOLTA-PASS', why: 'a volta is chosen by the wrong pass: the first ending is played the second time',
    edits: [['openEnding.indexOf(pass) < 0)', 'openEnding.indexOf(pass + 1) < 0)']],
    probe: PL => ord(PL, sg('repeats-endings-1-2')), clean: '1 2 3 1^2 2^2 4^2 5^2' },
  { id: 'MUT-LOOP-START', why: 'a repeat with no forward sign inside a loop goes to the first bar of the piece, out of the loop, instead of the loop\'s start',
    edits: [['startStack[startStack.length - 1] : i0;\n          /* nested', 'startStack[startStack.length - 1] : 0;\n          /* nested']],
    probe: PL => ord(PL, sg('repeats-simple'), { range: { from: 1, to: 2 } }), clean: '2 2^2 3^2' },
  { id: 'MUT-DC-BACKPASS', why: 'on the way back after a D.C. the volta is read as the first time: the first ending is played again',
    edits: [['const pass = leg ? backPass : passNow();', 'const pass = leg ? 1 : passNow();']],
    probe: PL => ord(PL, fx('jump-dc-al-fine-volta'), { jumps: 'once' }), clean: "1 2 3 1^2 2^2 4^2 5^2 6^2 1' 2' 4'" },
  { id: 'MUT-FINE', why: 'a Fine does not end the piece: the way back plays on to the end of the score',
    edits: [["if (here.some(j => j.kind === 'fine')) break;", 'if (false) break;']],
    probe: PL => ord(PL, fx('jump-ds-al-fine'), { jumps: 'once' }), clean: "1 2 3 4 2' 3'" },
  { id: 'MUT-TOCODA', why: 'a To Coda is not taken: the way back plays on past it and the coda is only reached by chance',
    edits: [["const toCoda = here.find(j => j.kind === 'tocoda' && j.to !== null && j.to >= i0 && j.to <= i1);", 'const toCoda = null;']],
    probe: PL => ord(PL, fx('jump-ds-al-coda'), { jumps: 'once' }), clean: "1 2 3 4 2' 3' 5' 6'" },
  { id: 'MUT-DC-TARGET', why: 'a D.C. in a loop goes back to the start of the piece, out of the loop (so it cannot be followed there at all)',
    edits: [["const goal = j => (j.kind === 'dacapo' && j.to === null ? i0 : j.to);", "const goal = j => (j.kind === 'dacapo' && j.to === null ? 0 : j.to);"]],
    probe: PL => ord(PL, fx('jump-dc-al-fine-volta'), { jumps: 'once', range: { from: 4, to: 5 } }), clean: "5 6 5' 6'" },
  { id: 'MUT-JUMPS-DEFAULT', why: 'the jumps are on unless they are asked off: a student who did not ask gets a longer piece',
    edits: [["jumps: o.jumps === 'once' ? 'once' : false", "jumps: o.jumps === false ? false : 'once'"]],
    probe: PL => ord(PL, fx('jump-ds-al-fine')), clean: '1 2 3 4' },
  { id: 'MUT-COMPAT-DEFAULT', why: 'the graph rules are on unless compat is asked: a 6/4 hymn is counted in two instead of six',
    edits: [['legacyCompat: o.legacyCompat !== false', 'legacyCompat: o.legacyCompat === true']],
    probe: PL => PL.build(fx('meters-pickup')).beats.filter(b => b.m === 3).length, clean: 6 },
  { id: 'MUT-TEMPO-CARRY', why: 'a bar played again starts at the tempo the last bar ended on, not at the tempo written there',
    edits: [['out.push({ q: v.soundQ, bpm: lastAt(v.startQ) });', 'out.push({ q: v.soundQ, bpm: out.length ? out[out.length - 1].bpm : lastAt(v.startQ) });']],
    probe: PL => PL.build(fx('tempo-change')).tempoMap.find(t => t.q === 12).bpm, clean: 100 },
  { id: 'MUT-SOFT-PEDAL', why: 'the soft pedal is down and the notes are as loud as ever',
    edits: [['if (softAt(soft, writtenQ)) vel =', 'if (false && softAt(soft, writtenQ)) vel =']],
    probe: PL => PL.build(fx('pedals')).strikes.filter(s => s.m === 3).map(s => s.vel).join(','), clean: '58,58,58' },
  { id: 'MUT-MARCATO', why: 'a marcato is only a little louder',
    edits: [['if (n.marcato) vel += 22;', 'if (n.marcato) vel += 12;']],
    probe: PL => PL.build(fx('dynamics')).strikes[3].vel, clean: 70 },
  { id: 'MUT-HOLD-CHAIN', why: 'a tied note sounds only its own length: the carried-into note is silent and so is the end of the tie',
    edits: [['cont.add(nx.head);\n        }\n        hold.set(n.head, q);', 'cont.add(nx.head);\n        }\n        hold.set(n.head, n.dur);']],
    probe: PL => { const s = strike(PL, fx('ties-edge'), {}, x => x.m === 1 && x.midi === 72); return s.upQ - s.q; }, clean: 4 },
  { id: 'MUT-SOSTENUTO', why: 'the sostenuto holds a note that was already over when it went down',
    edits: [['n.abs <= s[0] + 1e-9 && n.abs + h > s[0] + 1e-9 && s[1] > upWritten', 'n.abs <= s[0] + 1e-9 && s[1] > upWritten']],
    probe: PL => strike(PL, fx('pedals'), {}, x => x.m === 3 && x.midi === 77).upQ, clean: 10 },
  { id: 'MUT-PEDAL-ONCE', why: 'the pedal is copied into the first visit only: a repeat is played with the pedal of the first time',
    edits: [['plan.ccs = pedalCCs(ccsWritten, visits);', 'plan.ccs = pedalCCs(ccsWritten, visits.slice(0, 1));']],
    probe: PL => PL.build(H.graphOfText(H.fixtureText('pedals').replace('<measure number="1">', '<measure number="1"><barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>')
      .replace('<measure number="2">', '<measure number="2"><barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>'), 'pedal-repeat')).ccs.length, clean: 13 },
  { id: 'MUT-HALF-PEDAL-UP', why: '(graph rule) the release of a half pedal sends the depth again: the pedal never comes up',
    edits: [['(compat || type !== \'stop\')', '(true)']],
    probe: PL => { const c = PL.build(fx('pedals'), { legacyCompat: false }).ccs; return c[c.length - 1].value; }, clean: 0 },
  { id: 'MUT-TIE-BY-ID', why: '(graph rule) the tie spanners are not followed: the unison\'s tied notes are struck again',
    edits: [['if (byHead.has(from) && byHead.has(to) && from !== to) cont.add(to);', 'if (false) cont.add(to);']],
    probe: PL => PL.build(fx('ties-unison'), { legacyCompat: false }).cont.size, clean: 2 },
  { id: 'MUT-BEATS-PICKUP', why: 'a pickup is counted from the start of its bar: its beat is accented as if it were the downbeat',
    edits: [['const lead = i === 0 && lenQ < nominal - 1e-6 ? nominal - lenQ : 0;', 'const lead = 0;']],
    probe: PL => PL.build(fx('meters-pickup')).beats[0].accent, clean: false },
  { id: 'MUT-BEATS-GROUPS', why: '(graph rule) a 6/4 bar is not counted in two',
    edits: [['sizes = n % 3 === 0 && n > 3 ?', 'sizes = false ?']],
    probe: PL => PL.build(fx('meters-pickup'), { legacyCompat: false }).beats.filter(b => b.m === 3).length, clean: 2 },
  { id: 'MUT-GRACE-ORDER', why: 'a pair of graces is played backwards',
    edits: [['grp.notes.sort((a, c) => a.grace.order - c.grace.order);', 'grp.notes.sort((a, c) => c.grace.order - a.grace.order);']],
    probe: PL => strike(PL, fx('grace-notes'), { graces: 'play' }, x => x.grace && x.q === 4.75).midi, clean: 81 },
  { id: 'MUT-GRACE-MAIN', why: 'an unslashed grace is played on the beat and the main note does not wait for it: the two sound at once',
    edits: [['mains.forEach(s => { s.q = base + spent;', 'mains.forEach(s => { s.q = s.q;']],
    probe: PL => strike(PL, fx('grace-notes'), { graces: 'play' }, x => !x.grace && x.m === 1 && x.midi === 77).q, clean: 2.5 },
  { id: 'MUT-GRACE-CUT', why: 'the note before a crushed grace is not shortened: it rings through the grace',
    edits: [['            s.upQ = cut;', '            s.upQ = s.upQ;']],
    probe: PL => strike(PL, fx('grace-notes'), { graces: 'play' }, x => !x.grace && x.m === 2 && x.midi === 76).upQ, clean: 4.75 },
  { id: 'MUT-GATE-TIES', why: 'follow mode (FOLLOW_TIE) still skips a tie that leads nowhere',
    edits: [['if (strikeTies ? !struck(plan, n) : n.tieStop) return;', 'if (n.tieStop) return;']],
    probe: PL => PL.followGates(PL.build(fx('ties-edge')), 'both', { ties: true }).length, clean: 9 },
  { id: 'MUT-GATE-VISIT', why: 'follow mode (FOLLOW_REPEAT) loses track of which visit a gate belongs to',
    edits: [['last.b = v.startQ + v.lenQ; last.to = k; }', 'last.b = v.startQ + v.lenQ; }']],
    probe: PL => PL.followGates(PL.build(sg('repeats-simple')), 'both', { repeats: true }).map(x => x.visit).join(','), clean: '0,1,2,3,4' }
];

test('MUT-NOOP: a comment changes nothing (the control)', () => {
  const same = mutant([["  const FALLBACK_QPM = 84;", "  /* mutation: a comment */\n  const FALLBACK_QPM = 84;"]]);
  for (const [name, g, opts] of [['pedals', fx('pedals'), {}], ['dynamics', fx('dynamics'), {}], ['grace-notes', fx('grace-notes'), { graces: 'play' }],
    ['jump-dc-al-fine-volta', fx('jump-dc-al-fine-volta'), { jumps: 'once' }], ['ties-edge', fx('ties-edge'), {}]]) {
    assert.deepEqual(H.canon(same.build(g, opts)), H.canon(H.PLAN.build(g, opts)), name);
  }
});

MUTATIONS.forEach(m => {
  test(m.id + ': ' + m.why, () => {
    const real = m.probe(H.PLAN);
    assert.deepEqual(real, m.clean, m.id + ': the real module answers ' + JSON.stringify(m.clean) + ' (the probe is meaningful)');
    const bad = m.probe(mutant(m.edits));
    assert.notDeepEqual(bad, m.clean, m.id + ': the mutant must not answer ' + JSON.stringify(m.clean) + ' - the suite would not notice it');
  });
});

test('every mutation is a distinct anchor and the table is not shrinking quietly', () => {
  const ids = MUTATIONS.map(m => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(MUTATIONS.length >= 27, MUTATIONS.length + ' mutations');
  const anchors = MUTATIONS.map(m => m.edits[0][0]);
  assert.equal(new Set(anchors).size, anchors.length, 'no two mutations share an anchor');
});
