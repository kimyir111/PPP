/* G10a-5 (H-10): everything one review item needs, for both arms, from one recording's heard notes.

   buildItem(job) -> { id, excerpt, arms: { classic: { T, A, key }, v2: { T, A, key } } }
     T   the transcription as the app's review screen holds it: the arm's graph, an excerpt of it, drawn by the app's engraver and
         sounded by the app's player (review/lib/h10-draw.js)
     A   the one-note-per-hand Song Arranger copy at `level` (default intermediate) of THAT transcription, made by the page's own
         function (arrangeSingleNoteWithHandsFallback: the arranger, and for a v2 graph it refuses for hard violations the one retry
         on v2 with the classic hands), same bars as T; null when the arranger refused (the reason is in the key)
     key facts the reviewer must never see: whether the page threw the v2 result away (rejected), whether the hands fallback was used,
         the arranger's level note and rescued notes, bars and notes of each

   job: { id, title, heard, excerpt?: { bars, seconds, start }, level?, arrange?: { recordingArrange: 'leadsheet' | 'reduce' } }
   (G10c-1b: job.arrange is the option the page's Song Arranger passes on in its plan; absent, the copy is the reduction, as before. The key then says which path made it.)
   Which arm is X and which is Y is not decided here (review/h10/build-h10.js does it, after this): the drawings carry no arm name and one
   glyph-id prefix, so the result of an item is the same whatever the seed. Deterministic (the only clock in the result is `key.arrange.ms`,
   which is not part of the packet's id).

   G10b-0: buildEngineItem(job) is the same item for the other comparison - the SAME recording read two ways, both written by the page's v2
   conversion: arm `browser` from the heard notes of the in-browser model (job.heard, what production serves) and arm `helper` from the notes
   of the helper ensemble (job.heardB; notes only: no pedal, no beats). One window of seconds is chosen from the BROWSER notes and shown for both. */
'use strict';
const APP = require('./appcode.js');
const EX = require('./h10-excerpt.js');
const DRAW = require('./h10-draw.js');

const ARMS = ['classic', 'v2'];
const ENGINE_ARMS = ['browser', 'helper'];
const DEFAULT_LEVEL = 'intermediate';
const GLYPH_PREFIX = 'g-';

/* the drawn and arranged parts of every arm: names -> { name: conversion }, the window of each arm, the job -> { name: { T, A, key } } */
async function drawArms(names, conv, excerpt, job, arranger, title) {
  const arms = {};
  for (const a of names) {
    const c = conv[a], win = excerpt.arms[a].bars;
    const T = DRAW.drawPart(c.built.graph, win, GLYPH_PREFIX);
    const key = {
      wroteV2: c.v2, v2Rejected: c.rejected, measures: c.built.graph.timeline.measures.length, window: win, barsShown: win[1] - win[0] + 1,
      covers: excerpt.arms[a].covers, tempo: c.built.stats.tempo, graphIssues: (c.built.graphIssues || []).length
    };
    let A = null;
    const t0 = Date.now();
    let res;
    try { res = await arranger.arrange(c.built.graph, job.level || DEFAULT_LEVEL, title, job.arrange); }
    catch (e) { res = { ok: false, reason: 'THROWN', message: String(e && e.message || e) }; }
    key.arrange = { ok: !!res.ok, reason: res.ok ? null : res.reason, message: res.ok ? null : (res.message || null), handsFallback: res.ok ? (res.handsFallback || null) : null,
      levelNote: res.ok ? (res.levelNote || null) : null, rescued: res.ok && res.rescued ? res.rescued.length : 0, degraded: res.ok ? !!res.degraded : null, ms: Date.now() - t0 };
    /* G10c-1b: only when the lead sheet was asked for: the path that made the copy, and why the lead sheet did not (the reviewer never sees either) */
    if (res.recordingArrange) key.arrange.recordingArrange = res.recordingArrange;
    if (res.leadsheetRefusal) key.arrange.leadsheetRefusal = res.leadsheetRefusal;
    if (res.ok) {
      const n = res.graph.timeline.measures.length;
      key.arrange.measures = n;
      if (n !== key.measures) key.arrange.problem = 'the copy has ' + n + ' bars, the transcription ' + key.measures;
      else A = DRAW.drawPart(res.graph, win, GLYPH_PREFIX);
    }
    arms[a] = { T: T, A: A, key: key };
  }
  return arms;
}

async function buildItem(job, ctx) {
  ctx = ctx || {};
  const arranger = ctx.arranger || APP.arranger();
  const title = job.title || 'Recording';
  const heard = job.heard;
  const conv = {};
  ARMS.forEach(a => { conv[a] = APP.convertHeard(heard, title, a === 'v2'); });
  const barStarts = {};
  ARMS.forEach(a => { barStarts[a] = conv[a].built.stats.barStarts; });
  const ex = job.excerpt || {};
  const excerpt = EX.pickExcerpt({ heard: heard.notes, barStarts: barStarts, bars: ex.bars, seconds: ex.seconds, start: ex.start });
  const arms = await drawArms(ARMS, conv, excerpt, job, arranger, title);
  return { id: job.id, title: title, excerpt: excerpt, arms: arms };
}

/* ---- G10b-0: the engine comparison ---- */
const median = xs => { const s = xs.filter(x => isFinite(x)).sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const r3 = v => v == null ? null : Math.round(v * 1000) / 1000;

/* what one conversion wrote for the WHOLE piece (the key only): bars, tempo, metre, what the app's Score holds */
function wholeFacts(c, title) {
  const st = c.built.stats, score = APP.scoreOf(c.built.graph, title);
  const heads = score.notes.filter(n => !n.rest), rests = score.notes.filter(n => n.rest);
  return {
    bars: c.built.graph.timeline.measures.length, tempo: st.tempo, metre: st.beatsPerBar + '/' + (st.beatType || 4), beatsPerBar: st.beatsPerBar, beatType: st.beatType || 4,
    barSeconds: r3(EX.medianBarSeconds(st.barStarts)), keyFifths: st.key && st.key.fifths != null ? st.key.fifths : null, beatSource: st.beatSource || null,
    tempoAlias: st.tempoAlias || null, heads: heads.length, rests: rests.length, tupletBrackets: score.notes.filter(n => n.tupletStart).length, chords: score.chords
  };
}

/* how far the two readings of one recording agree on the bars: tempo, metre, bar length and where the bars begin.
   alignedShare: of the bar starts of the arm with the LONGER bars, the share that has a bar start of the other arm within a tenth of the shorter bar
   (about 1 when the same downbeats are read, also when one arm writes twice as long bars; near 0 when the barlines fall on other beats).
   phaseBeats: the median distance, in beats, of the other arm's nearest bar start before each of those (0 when aligned).
   Both are given for the whole piece and for the excerpt (`window`: the bars the reviewer sees, [start - a bar, end)): barlines that agree in most of the piece but not in
   the excerpt, or the reverse, are a disagreement the teacher's eyes meet or do not. Flags are for the Lead's eyes, never the page's. */
function alignment(L, S, tol, beat, lo, hi) {
  let hit = 0, n = 0;
  const dists = [];
  for (let i = 0; i < L.length - 1; i++) {
    if (L[i] < lo - 1e-9 || L[i] >= hi) continue;
    let best = Infinity, before = null;
    S.forEach(s => { const d = Math.abs(s - L[i]); if (d < best) best = d; if (s <= L[i] + tol && (before == null || s > before)) before = s; });
    n++; if (best <= tol) hit++;
    if (before != null) dists.push(Math.max(0, L[i] - before) / beat);
  }
  return { alignedShare: n ? r3(hit / n) : null, phaseBeats: n ? r3(median(dists)) : null, bars: n };
}
function barAgreement(a, b, win) {
  const out = { tempo: { browser: a.tempo, helper: b.tempo }, metre: { browser: a.metre, helper: b.metre }, barSeconds: { browser: a.barSeconds, helper: b.barSeconds }, flags: [] };
  out.tempoRatio = a.tempo && b.tempo ? r3(b.tempo / a.tempo) : null;
  out.barRatio = a.barSeconds && b.barSeconds ? r3(b.barSeconds / a.barSeconds) : null;
  out.sameMetre = a.metre === b.metre;
  const near = (x, y, tol) => Math.abs(x / y - 1) <= tol;
  if (out.tempoRatio && (near(out.tempoRatio, 2, 0.08) || near(out.tempoRatio, 0.5, 0.08))) out.flags.push('tempo-octave');
  if (!out.sameMetre) out.flags.push('metre');
  if (out.barRatio && Math.abs(Math.log2(out.barRatio)) > 0.3 && !out.flags.includes('tempo-octave')) out.flags.push('bar-length');
  const longer = out.barRatio && out.barRatio > 1 ? 'helper' : 'browser';
  const L = longer === 'helper' ? b.starts : a.starts, S = longer === 'helper' ? a.starts : b.starts, shortBar = Math.min(a.barSeconds, b.barSeconds);
  out.alignedShare = null; out.phaseBeats = null; out.window = null;
  if (L.length > 1 && S.length > 1 && shortBar > 0) {
    const tol = 0.1 * shortBar, beat = shortBar / ((longer === 'helper' ? a : b).beatsPerBar || 4);
    const whole = alignment(L, S, tol, beat, -Infinity, Infinity);
    out.alignedShare = whole.alignedShare; out.phaseBeats = whole.phaseBeats;
    if (win) { const w = alignment(L, S, tol, beat, win[0] - shortBar, win[1]); out.window = { alignedShare: w.alignedShare, phaseBeats: w.phaseBeats, bars: w.bars }; }
    const low = x => x != null && x < 0.5;
    if ((low(out.alignedShare) || (out.window && low(out.window.alignedShare))) && !out.flags.includes('tempo-octave') && !out.flags.includes('bar-length')) out.flags.push('bar-phase');
  }
  return out;
}

/* job: { id, title, heard (the browser's notes), heardB (the helper's), excerpt?: { bars, seconds, start }, level? } -> { id, title, excerpt, arms: { browser, helper }, agreement, heardIn } */
async function buildEngineItem(job, ctx) {
  ctx = ctx || {};
  const arranger = ctx.arranger || APP.arranger();
  const title = job.title || 'Recording';
  const input = { browser: job.heard, helper: job.heardB };
  if (!input.helper || !input.helper.notes) throw new Error('an engine item needs the helper notes (job.heardB)');
  const conv = {};
  ENGINE_ARMS.forEach(a => { conv[a] = APP.convertHeard(input[a], title, true); });
  const barStarts = {};
  ENGINE_ARMS.forEach(a => { barStarts[a] = conv[a].built.stats.barStarts; });
  const ex = job.excerpt || {};
  /* the window is chosen from what the BROWSER heard (the helper hears about 1.6 times as many notes, so its density would pick another stretch) and its default length from the
     browser's own bars; the helper's bars then cover the same seconds */
  const excerpt = EX.pickExcerpt({ heard: input.browser.notes, barStarts: barStarts, bars: ex.bars, seconds: ex.seconds, start: ex.start, lengthArms: ['browser'] });
  const arms = await drawArms(ENGINE_ARMS, conv, excerpt, job, arranger, title);
  const whole = {}, heardIn = {};
  ENGINE_ARMS.forEach(a => {
    whole[a] = wholeFacts(conv[a], title);
    const inWin = input[a].notes.filter(n => n.on >= excerpt.start - 1e-9 && n.on < excerpt.end - 1e-9);
    heardIn[a] = inWin.length;
    arms[a].key.whole = whole[a];
    arms[a].key.heardNotesInWindow = inWin.length;
  });
  const agreement = barAgreement(Object.assign({ starts: barStarts.browser }, whole.browser), Object.assign({ starts: barStarts.helper }, whole.helper), [excerpt.start, excerpt.end]);
  return { id: job.id, title: title, excerpt: excerpt, arms: arms, agreement: agreement, heardIn: heardIn };
}

module.exports = { buildItem, buildEngineItem, barAgreement, ARMS, ENGINE_ARMS, DEFAULT_LEVEL, GLYPH_PREFIX };
