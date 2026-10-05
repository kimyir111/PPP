/* H-10 / G10b-0: the vocabulary scan. What a reader can see or a script can read must not say which score is which way of writing (or, in the
   engine comparison, which reading of the audio), nor how a score was made, nor carry a version or a build stamp, nor the seed.

   Used by the tests (tests/review/h10-helpers.js leakScan) and, for the engine comparison, by the builder itself before it writes the packet
   (review/h10/packet.js): a packet that would give the sources away is not written. Path data (d="...") is checked to be nothing but path
   characters and then left out (a glyph outline is numbers and the letters M L H V C S Q T A Z, "V2.5" is not a version); the piano recordings are
   a closed block of base64 that the tests check byte for byte (tests/review/helpers.js checkAudioBlob) and the scan leaves out. */
'use strict';

/* the words of the version comparison (H-10): the two ways PPP writes a recording down, and how the page builds a score */
const WORDS = ['classic', 'legacy', 'fallback', 'pipeline', 'hmac', 'seed', 'exactbars', 'closegaps', 'audio-score', 'handsfallback', 'hands:', 'arranger', 'g9', 'g10', 'sha256', 'commit', 'recording:', 'rec/'];
const STAMPS = [/\bv\d+(\.\d+)*\b/i, /\bbuild\b/i];
const PATHDATA = /\sd="([^"]*)"/g;

/* G10b-0, the engine comparison: the two readings of the audio are the in-browser model's and the helper ensemble's. None of this may be on the page.
   ENGINE_WORDS match anywhere (as a piece of a word too); ENGINE_WHOLE only as whole words ("localStorage" is the page's own storage, "local" is not); the one
   quoted 'local' that the page's save indicator uses ("local" = this device) is not a leak and is taken out first. */
const ENGINE_WORDS = ['browser', 'helper', 'engine', 'transkun', 'kong', 'ensemble', 'onsets', 'cuda', 'gpu', 'beat this', 'beatthis', 'qualitytier', 'fallbackfrom', 'pedal source', 'onnx', 'tensorflow', 'torch',
  '브라우저', '헬퍼', '엔진', '앙상블', '로컬'];
const ENGINE_WHOLE = ['local', 'model', 'frames', 'server', 'cloud'];
const QUOTED_LOCAL = /'local'/g;

function scanText(label, text, extra, whole) {
  const bad = [];
  const low = text.toLowerCase();
  WORDS.concat(extra || []).forEach(w => {
    const at = low.indexOf(w.toLowerCase());
    if (at >= 0) bad.push(label + ' contains "' + w + '": ' + JSON.stringify(text.slice(Math.max(0, at - 30), at + 40)));
  });
  (whole || []).forEach(w => {
    const body = w === 'local' ? text.replace(QUOTED_LOCAL, "''") : text;
    const m = new RegExp('\\b' + w + '\\b', 'i').exec(body);
    if (m) bad.push(label + ' contains the word "' + w + '": ' + JSON.stringify(body.slice(Math.max(0, m.index - 30), m.index + 40)));
  });
  /* a word that names a way of writing (the plain words, so a class or an id cannot say it either) */
  STAMPS.forEach(re => { const m = re.exec(text); if (m) bad.push(label + ' has a version or build stamp ' + JSON.stringify(m[0]) + ' near ' + JSON.stringify(text.slice(Math.max(0, m.index - 30), m.index + 40))); });
  return bad;
}
function withoutPathData(text) {
  const bad = [];
  const rest = text.replace(PATHDATA, (all, d) => { if (!/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]*$/.test(d)) bad.push('path data holds more than path characters: ' + d.slice(0, 60)); return ' d=""'; });
  return { rest: rest, bad: bad };
}

const AUDIO_BLOCK = /<script id="piano-samples" type="application\/json">[\s\S]*?<\/script>/;
const DRAWINGS_BLOCK = /(<script id="svg-data" type="application\/json">)[\s\S]*?(<\/script>)/;

/* the engine comparison's scan of a finished page: `html`, the manifest's text and the unpacked drawings (page-h10 drawingsOf). `titles` are left out of the
   text (a piece's own title may say "Hong Kong"; the Lead is told about those separately, see titleWarnings). Returns a list of problems. */
function scanEngine(html, manifest, drawings, o) {
  o = o || {};
  /* the piano credit is fixed text (the recordings' own name carries "V3"); the tests check it byte for byte */
  if (o.credit) html = html.split(o.credit).join('<footer class="credit">[credit]</footer>');
  const seedWords = o.seed ? [o.seed] : [];
  const blank = t => (o.titles || []).filter(x => x && String(x).length >= 4).reduce((s, x) => s.split(esc(x)).join('').split(String(x)).join(''), t);
  const bad = [];
  const page = withoutPathData(blank(html.replace(AUDIO_BLOCK, '<script id="piano-samples">[audio block]</script>').replace(DRAWINGS_BLOCK, '$1[drawings]$2')));
  bad.push.apply(bad, page.bad);
  const extra = ENGINE_WORDS.concat(seedWords);
  bad.push.apply(bad, scanText('the page', page.rest, extra, ENGINE_WHOLE));
  bad.push.apply(bad, scanText('the manifest', blank(manifest), extra, ENGINE_WHOLE));
  Object.keys(drawings).forEach(k => drawings[k].forEach((svg, i) => {
    const d = withoutPathData(svg);
    bad.push.apply(bad, d.bad);
    bad.push.apply(bad, scanText('drawing ' + k + (i ? ' narrow' : ' wide'), d.rest, extra, ENGINE_WHOLE));
  }));
  return bad;
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* titles that carry a word of the engine vocabulary: a warning for the Lead (the title is shown for both sides; a title that says "(helper)" would give the sources away; "Hong Kong" is a
   false alarm and the Lead decides). Only the engine words are looked for here, not the general ones ("classical" is a fine title). */
function titleWarnings(titles) {
  const out = [];
  (titles || []).forEach(t => {
    if (!t) return;
    const low = String(t).toLowerCase();
    ENGINE_WORDS.forEach(w => { if (low.indexOf(w) >= 0) out.push('title ' + JSON.stringify(t) + ' contains "' + w + '"'); });
    ENGINE_WHOLE.forEach(w => { if (new RegExp('\\b' + w + '\\b', 'i').test(String(t))) out.push('title ' + JSON.stringify(t) + ' contains the word "' + w + '"'); });
  });
  return out;
}

module.exports = { WORDS, STAMPS, PATHDATA, ENGINE_WORDS, ENGINE_WHOLE, scanText, withoutPathData, scanEngine, titleWarnings, AUDIO_BLOCK, DRAWINGS_BLOCK };
