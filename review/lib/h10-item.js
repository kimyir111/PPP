/* G10a-5 (H-10): everything one review item needs, for both arms, from one recording's heard notes.

   buildItem(job) -> { id, excerpt, arms: { classic: { T, A, key }, v2: { T, A, key } } }
     T   the transcription as the app's review screen holds it: the arm's graph, an excerpt of it, drawn by the app's engraver and
         sounded by the app's player (review/lib/h10-draw.js)
     A   the one-note-per-hand Song Arranger copy at `level` (default intermediate) of THAT transcription, made by the page's own
         function (arrangeSingleNoteWithHandsFallback: the arranger, and for a v2 graph it refuses for hard violations the one retry
         on v2 with the classic hands), same bars as T; null when the arranger refused (the reason is in the key)
     key facts the reviewer must never see: whether the page threw the v2 result away (rejected), whether the hands fallback was used,
         the arranger's level note and rescued notes, bars and notes of each

   job: { id, title, heard, excerpt?: { bars, seconds, start }, level? }
   Which arm is X and which is Y is not decided here (review/h10/build-h10.js does it, after this): the drawings carry no arm name and one
   glyph-id prefix, so the result of an item is the same whatever the seed. Deterministic (the only clock in the result is `key.arrange.ms`,
   which is not part of the packet's id). */
'use strict';
const APP = require('./appcode.js');
const EX = require('./h10-excerpt.js');
const DRAW = require('./h10-draw.js');

const ARMS = ['classic', 'v2'];
const DEFAULT_LEVEL = 'intermediate';
const GLYPH_PREFIX = 'g-';

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

  const arms = {};
  for (const a of ARMS) {
    const c = conv[a], win = excerpt.arms[a].bars;
    const T = DRAW.drawPart(c.built.graph, win, GLYPH_PREFIX);
    const key = {
      wroteV2: c.v2, v2Rejected: c.rejected, measures: c.built.graph.timeline.measures.length, window: win, barsShown: win[1] - win[0] + 1,
      covers: excerpt.arms[a].covers, tempo: c.built.stats.tempo, graphIssues: (c.built.graphIssues || []).length
    };
    let A = null;
    const t0 = Date.now();
    let res;
    try { res = await arranger.arrange(c.built.graph, job.level || DEFAULT_LEVEL, title); }
    catch (e) { res = { ok: false, reason: 'THROWN', message: String(e && e.message || e) }; }
    key.arrange = { ok: !!res.ok, reason: res.ok ? null : res.reason, message: res.ok ? null : (res.message || null), handsFallback: res.ok ? (res.handsFallback || null) : null,
      levelNote: res.ok ? (res.levelNote || null) : null, rescued: res.ok && res.rescued ? res.rescued.length : 0, degraded: res.ok ? !!res.degraded : null, ms: Date.now() - t0 };
    if (res.ok) {
      const n = res.graph.timeline.measures.length;
      key.arrange.measures = n;
      if (n !== key.measures) key.arrange.problem = 'the copy has ' + n + ' bars, the transcription ' + key.measures;
      else A = DRAW.drawPart(res.graph, win, GLYPH_PREFIX);
    }
    arms[a] = { T: T, A: A, key: key };
  }
  return { id: job.id, title: title, excerpt: excerpt, arms: arms };
}

module.exports = { buildItem, ARMS, DEFAULT_LEVEL, GLYPH_PREFIX };
