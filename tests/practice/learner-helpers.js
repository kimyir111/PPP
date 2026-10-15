'use strict';
/* Shared by the G11b-2 tests (learner.test.js, policy.test.js, policy-validate.js, learner-policy-mutation.test.js): small
   pieces and run log entries made by practice/runlog.js's own builder, so every test feeds the model what the page logs. */
const path = require('path');
const RUNLOG = require(path.join(__dirname, '..', '..', 'practice', 'runlog.js'));

const DAY = 86400000, MIN = 60000;
const T0 = Date.UTC(2026, 0, 5, 18, 0, 0);

/* n bars of 4/4, numbers first..first+n-1 unless given, r and l notes per bar */
function piece(n, o) {
  o = o || {};
  const nums = o.numbers || Array.from({ length: n }, (_, i) => (o.first == null ? 1 : o.first) + i);
  return {
    scoreTempo: o.tempo || 100,
    measures: nums.map((num, i) => ({ number: num, q: o.q || 4, notes: (o.notes && o.notes[i]) || { r: o.r == null ? 6 : o.r, l: o.l == null ? 4 : o.l } }))
  };
}

/* one run log entry: acc(i, hand) -> share of notes matched; hands 'both'|'left'|'right'; ratio = tempo / score tempo */
let seq = 0;
function entry(pc, at, from, to, acc, o) {
  o = o || {};
  const hands = o.hands || 'both';
  const rows = [];
  for (let i = from; i <= to; i++) {
    ['r', 'l'].forEach((h, hi) => {
      if (hands === 'left' && h !== 'l') return;
      if (hands === 'right' && h !== 'r') return;
      const e = pc.measures[i].notes[h];
      if (!e) return;
      const k = Math.max(0, Math.min(e, Math.round(e * (typeof acc === 'function' ? acc(i, h) : acc))));
      const sd = o.signed == null ? 0 : o.signed;
      rows.push({ mi: i, h: hi, e: e, k: k, sd: k ? sd * k : null, ad: k ? Math.abs(o.abs == null ? 40 : o.abs) * k : null, ids: [] });
    });
  }
  const ex = rows.reduce((s, r) => s + r.e, 0), ht = rows.reduce((s, r) => s + r.k, 0);
  const ratio = o.ratio == null ? 1 : o.ratio;
  return RUNLOG.buildEntry({
    id: 'r' + (++seq), at: at, src: o.src || 'measured', mode: o.src === 'memory' ? 'memory' : 'practice', hands: hands,
    tempo: pc.scoreTempo * ratio, scoreTempo: pc.scoreTempo, from: from, to: to, hints: 0, level: 0,
    expected: ex, matched: ht, wrong: 0, extra: 0, accuracy: ex ? ht / ex : 0, rows: rows, wrongs: []
  }).entry;
}

/* a Coach.context-shaped object for a piece: what Coach.validate reads (allowed) and what the policy reads (memory) */
function ctxOf(pc, o) {
  o = o || {};
  return {
    allowed: {
      measures: pc.measures.map(m => m.number), hands: ['left', 'right', 'both'], modes: ['practice', 'memory'],
      tempoPercent: { min: 30, max: 120 }, repetitions: { min: 1, max: 8 },
      memoryEligibleSections: o.eligible || [], percentages: o.percentages || []
    },
    memory: { songMemory: 0, sections: o.sections || [], dueReviews: o.due || [] }
  };
}

module.exports = { piece, entry, ctxOf, DAY, MIN, T0, RUNLOG };
