/* G13-S1: the rules of sync/merge.js, alone (no page, no network). Each rule of docs section 7.5 (G13-D7) is a property here, and each is broken by a mutant of
   tests/sync-page/mutants.js that this file must notice. */
'use strict';
const path = require('path');
const { ok, heading, finish } = require('../sync/lib.js');
const MODS = process.env.PPP_SYNC_MODULES_DIR ? path.resolve(process.env.PPP_SYNC_MODULES_DIR) : path.resolve(__dirname, '..', '..');
const M = require(path.join(MODS, 'sync', 'merge.js'));
const B = require(path.join(MODS, 'library-backup.js'));
const { packedScore, slotOf } = require('./lib.js');

const song = (o, at) => {
  o = o || {};
  const sc = o.score || packedScore(o.notes || 10, 4, o.seed || 1, o.title || 'T');
  return M.buildSongItem(Object.assign({ id: 'x', title: o.title || 'T', composer: 'C', addedAt: 100, lastAt: o.lastAt || 100, prog: o.prog || 0, mem: 0, measures: 4 }, o.card || {}), slotOf(sc, o.slot), at === undefined ? 100 : at);
};
const same = (a, b) => M.stable(a) === M.stable(b);

heading('canonical text and hashes');
ok('keys in any order are one text', M.stable({ b: 1, a: [1, { d: 2, c: 3 }] }) === M.stable({ a: [1, { c: 3, d: 2 }], b: 1 }));
ok('undefined is left out, like JSON does', M.stable({ a: 1, b: undefined }) === M.stable({ a: 1 }));
const h1 = M.hashText('abc'), h2 = M.hashText('abd');
ok('a hash is what the library accepts (8-64 of A-Za-z0-9_-)', /^[A-Za-z0-9_-]{8,64}$/.test(h1) && h1 !== h2 && M.hashText('abc') === h1);
ok('the same text of different length is another hash', M.hashText('a') !== M.hashText('a\u0000'));
const it = song({ seed: 1 });
ok('a content hash ignores the time and the score\'s own text, not the progress', M.contentHash(it) === M.contentHash(Object.assign({}, it, { savedAt: 999 })) && M.contentHash(it) !== M.contentHash(Object.assign({}, it, { progress: Object.assign({}, it.progress, { tempo: 1 }) })));
const plain = Object.assign({}, packedScore(10, 4, 1, 'T'));
const unpacked = B.mergeSlot ? null : null;
void unpacked;
ok('a packed score and the same notes as plain objects are one score', M.scoreHashOf({ score: packedScore(6, 4, 2) }) === M.scoreHashOf({ score: (() => { const p = packedScore(6, 4, 2); const keys = p._packedNoteKeys; const o = Object.assign({}, p); delete o._packedNoteKeys; o.notes = p.notes.map(r => { const n = {}; r.forEach((v, i) => { n[keys[i]] = v; }); return n; }); return o; })() }));
ok('another score is another hash', M.scoreHashOf({ score: packedScore(6, 4, 2) }) !== M.scoreHashOf({ score: packedScore(6, 4, 3) }));

heading('names and identity');
ok('a song\'s name is "song:" + its id', M.keyOf('song-abc12') === 'song:song-abc12' && M.idOf('song:song-abc12') === 'song-abc12');
const odd = M.keyOf('has space/and slash'), long = M.keyOf('x'.repeat(80));
ok('an id the library would refuse gets a name it accepts', /^song:[A-Za-z0-9_.:-]{1,64}$/.test(odd) && /^song:[A-Za-z0-9_.:-]{1,64}$/.test(long) && odd !== long);
ok('the same odd id is always the same name', M.keyOf('has space/and slash') === odd);
ok('the name of a copy is the same for the same pair, another for another', M.forkIdOf('song:a', 'h1') === M.forkIdOf('song:a', 'h1') && M.forkIdOf('song:a', 'h1') !== M.forkIdOf('song:a', 'h2') && M.forkIdOf('song:a', 'h1') !== M.forkIdOf('song:b', 'h1') && /^song-f[a-z0-9]{16}$/.test(M.forkIdOf('song:a', 'h1')));
const idk = M.identityKeys({ courseFrom: 'book/1', sharedFrom: 'sh9', arrangedFrom: 'p', arrangement: { level: 'easy', style: 'pop' } }, 'HH');
ok('identity, in order: method-book piece, shared score, arrangement + level, the score', JSON.stringify(idk) === JSON.stringify(['c:book/1', 's:sh9', 'a:p|easy|pop', 'h:HH']), JSON.stringify(idk));
ok('no identity but the score when a song has nothing else', JSON.stringify(M.identityKeys({}, 'HH')) === JSON.stringify(['h:HH']));

heading('items that are built and items that arrive');
const built = M.buildSongItem({ id: 'zzz', title: 'A', share: { id: 'shr', guest: true }, lastAt: 5 }, slotOf(packedScore(5, 4, 1)), 50);
ok('an item carries no id and no share mark (a mark names THIS browser\'s posts)', built && !('id' in built.card) && !('share' in built.card) && built.card.title === 'A' && built.card.lastAt === 5);
ok('a slot with no score is not a song (the built-in sample)', M.buildSongItem({ id: 'demo' }, { score: null, secs: {} }, 1) === null);
ok('the progress is everything of the slot but the score', built.progress.tempo === 90 && !('score' in built.progress) && built.progress.history && built.progress.secs);
const good = M.checkIncoming('song:q', { v: 1, card: { title: 'Q', url: 'javascript:alert(1)' }, score: packedScore(6, 4, 7), progress: { importSource: { kind: 'youtube', url: 'data:text/html,x' }, tempo: 80 }, scoreHash: 'sender-says', savedAt: 12 });
ok('an item that arrives is read, its links that are not web addresses are blanked and counted', good.ok && good.item.card.url === null && good.item.progress.importSource.url === null && good.blanked === 2, JSON.stringify(good.blanked));
ok('its score hash is made here from its score, never taken from the sender', good.item.scoreHash === M.scoreHashOf({ score: packedScore(6, 4, 7) }) && good.item.scoreHash !== 'sender-says');
ok('an unknown field is refused', M.checkIncoming('song:q', Object.assign({}, { v: 1, score: packedScore(4, 4, 1), evil: 1 })).code === 'unknown-field');
ok('no score is refused', M.checkIncoming('song:q', { v: 1, card: {} }).code === 'no-score' && M.checkIncoming('song:q', { v: 1, score: { measures: [], notes: [] } }).code === 'no-score');
ok('a card that is not an object is refused', M.checkIncoming('song:q', { v: 1, score: packedScore(4, 4, 1), card: [] }).code === 'bad-card');
ok('a __proto__ key anywhere is refused', M.checkIncoming('song:q', JSON.parse('{"v":1,"score":' + JSON.stringify(packedScore(4, 4, 1)) + ',"progress":{"__proto__":{"x":1}}}')).ok === false);
ok('nesting past the backup module\'s bound is refused', (() => { let deep = {}; let p = deep; for (let i = 0; i < 80; i++) { p.n = {}; p = p.n; } return M.checkIncoming('song:q', { v: 1, score: packedScore(4, 4, 1), progress: { deep: deep } }).ok === false; })());
ok('the name must be a song\'s', M.checkIncoming('state2', { v: 1 }).code === 'bad-key' && M.checkIncoming('state', { xp: 1 }).ok === true);
ok('the state item may have 64 fields at most', M.checkIncoming('state', (() => { const o = {}; for (let i = 0; i < 65; i++) o['f' + i] = i; return o; })()).code === 'too-many-fields');

heading('practice: the union, commutative and idempotent');
const hist = (m, att, last, runs) => ({ byMeasure: m ? { [m]: { attempts: att, lastAt: last } } : {}, runs: runs || [], rev: att });
const pa = { history: hist('1', 3, 10, [{ at: 1, from: 1, to: 1, tempo: 80, hands: 'b' }]), memory: { sections: { s1: { level: 2, lastMemoryTest: 5, attempts: [1] } }, rev: 1 }, secs: { s1: { acc: 60, mem: 10, reps: 4 } }, memLevel: 1, blindRuns: 2, mastered: false, tempo: 70, loopFrom: 1, loopTo: 2 };
const pb = { history: hist('2', 5, 20, [{ at: 2, from: 2, to: 2, tempo: 80, hands: 'b' }]), memory: { sections: { s1: { level: 3, lastMemoryTest: 4, attempts: [] }, s2: { level: 1, lastMemoryTest: 1, attempts: [] } }, rev: 2 }, secs: { s1: { acc: 40, mem: 30, reps: 2 }, s2: { acc: 10, mem: 0, reps: 1 } }, memLevel: 3, blindRuns: 1, mastered: true, tempo: 90, loopFrom: 3, loopTo: 4 };
const mab = M.mergeProgress(pa, pb, 100, 200), mba = M.mergeProgress(pb, pa, 200, 100);
ok('commutative: the same whichever side asks', same(mab, mba));
ok('idempotent: merging a version with itself changes nothing', same(M.mergeProgress(pa, pa, 5, 5), pa) && same(M.mergeProgress(mab, mab, 5, 5), mab));
ok('the history is the union: both measures, both runs', mab.history.byMeasure['1'] && mab.history.byMeasure['2'] && mab.history.runs.length === 2);
ok('per measure the record with more attempts wins', same(M.mergeProgress({ history: hist('1', 2, 50) }, { history: hist('1', 5, 10) }, 1, 1).history.byMeasure['1'], { attempts: 5, lastAt: 10 }));
ok('on equal attempts the later record wins', same(M.mergeProgress({ history: hist('1', 4, 50) }, { history: hist('1', 4, 90) }, 1, 1).history.byMeasure['1'], { attempts: 4, lastAt: 90 }));
ok('per section the higher level', mab.memory.sections.s1.level === 3 && !!mab.memory.sections.s2);
ok('per field the larger count: acc, mem, reps', mab.secs.s1.acc === 60 && mab.secs.s1.mem === 30 && mab.secs.s1.reps === 4 && mab.secs.s2.reps === 1);
ok('memLevel and blindRuns the larger, mastered if either', mab.memLevel === 3 && mab.blindRuns === 2 && mab.mastered === true);
ok('tempo and loop are the newer side\'s, as a pair', mab.tempo === 90 && mab.loopFrom === 3 && mab.loopTo === 4 && M.mergeProgress(pa, pb, 300, 200).tempo === 70 && M.mergeProgress(pa, pb, 300, 200).loopTo === 2);
ok('a tie in time is decided by the text, the same on both sides', same(M.mergeProgress(pa, pb, 100, 100), M.mergeProgress(pb, pa, 100, 100)));

heading('the card');
const ca = { title: 'Old', composer: 'C', kind: 'musicxml', addedAt: 50, lastAt: 500, prog: 80, mem: 40, measures: 8 };
const cb = { title: 'New title', composer: 'C2', kind: 'musicxml', addedAt: 70, lastAt: 300, prog: 20, mem: 10, measures: 12 };
const mc = M.mergeCard(ca, cb, 'b', 'b');
ok('what belongs to the score follows the score (title, composer, measures)', mc.title === 'New title' && mc.composer === 'C2' && mc.measures === 12);
ok('addedAt the earlier, lastAt the later, prog and mem with the later', mc.addedAt === 50 && mc.lastAt === 500 && mc.prog === 80 && mc.mem === 40);
ok('the card merge is commutative with its sides swapped', same(M.mergeCard(ca, cb, 'b', 'b'), M.mergeCard(cb, ca, 'a', 'a')));

heading('the score: one side changed it, or both');
const base = song({ seed: 1, title: 'Base' }, 100);
const edited = song({ seed: 2, title: 'Edited' }, 200);
const baseSh = { sh: base.scoreHash };
let r = M.mergeSong(base, edited, baseSh, 'song:q');
ok('only the library changed the score: it is taken (and the practice is merged)', r.scoreFrom === 'remote' && r.item.scoreHash === edited.scoreHash && !r.fork);
r = M.mergeSong(edited, base, baseSh, 'song:q');
ok('only this device changed it: it stays', r.scoreFrom === 'local' && r.item.scoreHash === edited.scoreHash && !r.fork);
const bEd = song({ seed: 3, title: 'Edited on B' }, 300);
r = M.mergeSong(edited, bEd, baseSh, 'song:q');
ok('both changed it: the newer stays the song', r.scoreFrom === 'fork' && r.item.scoreHash === bEd.scoreHash && r.fork && r.fork.item.scoreHash === edited.scoreHash && r.fork.keptSide === 'remote');
ok('the other is kept as a copy with its own score and progress, under a deterministic name', r.fork.id === M.forkIdOf('song:q', edited.scoreHash) && r.fork.item.card.title === 'Edited');
const r2 = M.mergeSong(bEd, edited, baseSh, 'song:q');
ok('the same decision on the other device (the sides swapped)', r2.item.scoreHash === r.item.scoreHash && r2.fork.id === r.fork.id && r2.fork.item.scoreHash === r.fork.item.scoreHash && r2.fork.keptSide === 'local');
ok('no common point known (this device never synced it): both are taken as changed, nothing is overwritten', M.mergeSong(edited, bEd, null, 'song:q').scoreFrom === 'fork');
const sameScoreB = song({ seed: 2, title: 'Edited', slot: { tempo: 55 } }, 300);
r = M.mergeSong(edited, sameScoreB, baseSh, 'song:q');
ok('the same score: it is only practice that is merged, no copy', r.scoreFrom === 'same' && !r.fork && r.item.progress.tempo === 55);
ok('a merge is idempotent', same(M.mergeSong(edited, edited, baseSh, 'k').item.progress, edited.progress) && M.mergeSong(edited, edited, baseSh, 'k').item.scoreHash === edited.scoreHash);

heading('the progress that is not one song\'s: counters, courses');
ok('an own counter starts as all that is shown, then grows with what is added', (() => { const a = M.ctrAdvance(null, 40); const b = M.ctrAdvance(a, 55); return a.own === 40 && a.seen === 40 && b.own === 55 && b.seen === 55; })());
ok('a value that is set by a merge is not this device\'s own: only what is added after counts', (() => { let c = M.ctrAdvance(null, 40); c = { own: c.own, seen: 100 }; c = M.ctrAdvance(c, 110); return c.own === 50 && c.seen === 110; })());
ok('a reset takes this device\'s own down, never below 0', M.ctrAdvance({ own: 30, seen: 100 }, 0).own === 0 && M.ctrAdvance({ own: 30, seen: 100 }, 80).own === 10);
const ctrA = { xp: { d1: { v: 100, at: 10 }, d2: { v: 5, at: 5 } } }, ctrB = { xp: { d2: { v: 30, at: 20 }, d3: { v: 7, at: 1 } }, minutes: { d3: { v: 9, at: 1 } } };
const cm = M.ctrMerge(ctrA, ctrB);
ok('per device the entry with the later time; the total is the sum', cm.xp.d2.v === 30 && M.ctrTotal(cm, 'xp') === 137 && M.ctrTotal(cm, 'minutes') === 9);
ok('counters commute and are idempotent', same(M.ctrMerge(ctrA, ctrB), M.ctrMerge(ctrB, ctrA)) && same(M.ctrMerge(cm, cm), cm));
const sa = { ctr: ctrA, sessions: [1, 5, 0], streak: 3, learnDone: { a: true }, learnLesson: 'keys', learnStep: 2, skillMs: { treble: 1 }, course: { passed: { b1: { 1: true } }, log: { '2026-10-01': { n: 1 } } }, savedAt: 10 };
const sb = { ctr: ctrB, sessions: [4, 2, 6, 1], streak: 5, learnDone: { b: true }, learnLesson: 'rhythm', learnStep: 0, skillMs: { treble: 2 }, course: { passed: { b1: { 2: true } }, log: { '2026-10-01': { n: 3 }, '2026-10-02': { n: 1 } } }, savedAt: 20 };
const sm = M.mergeStateItems(sa, sb);
ok('weekly bars: per day the larger; streak the larger', same(sm.sessions, [4, 5, 6, 1]) && sm.streak === 5);
ok('what was done is the union', sm.learnDone.a && sm.learnDone.b && sm.course.passed.b1['1'] && sm.course.passed.b1['2'] && sm.course.log['2026-10-01'].n === 3 && sm.course.log['2026-10-02'].n === 1);
ok('where a person is in a lesson is the newer side\'s', sm.learnLesson === 'rhythm' && sm.learnStep === 0 && sm.skillMs.treble === 2);
ok('the state merge commutes and is idempotent', same(M.mergeStateItems(sa, sb), M.mergeStateItems(sb, sa)) && same(M.mergeStateItems(sm, sm), sm));

heading('when to ask');
ok('1 or 2 of 30 songs removed: no question; 4 or more: a question', !M.needsAsk(1, 30) && !M.needsAsk(2, 30) && !M.needsAsk(3, 30) && M.needsAsk(4, 30) && M.needsAsk(17, 30) && M.needsAsk(17, 500));
ok('more than a fifth of the library: a question (2 of 5, 3 of 10), one song never', M.needsAsk(2, 5) && M.needsAsk(3, 10) && !M.needsAsk(2, 10) && !M.needsAsk(1, 2) && !M.needsAsk(0, 0));

finish('the rules of sync/merge.js');
