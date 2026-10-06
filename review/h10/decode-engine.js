/* G10b-0: decode the teacher's answers of the ENGINE comparison (the same pieces written from the in-browser model's notes and from the helper's notes, both by
   the page's v2 conversion) with the key.

     node review/decode.js --mode h10 --compare engine --key <key-dir>/key.json --ratings <ratings-h10-ID.json> [--out summary.json]

   Same page, same export (ppp-review-ratings/2) as H-10; the key says which of X and Y was the browser's reading and which the helper's, per piece. Counted per SOURCE:
     - wins, losses and ties (preference), per part and over both (part T the transcription as the review screen shows it, part A the Song Arranger's one-note-per-hand
       copy: only for pieces whose arranger accepted BOTH readings), with the helper's share of the decisive parts (Wilson interval, exact sign test)
     - pass rates ("would you give this to a student, small fixes allowed") with Wilson intervals, tag counts per source (part, piece), notes in the teacher's words
     - per piece: what each reading wrote for the piece (bars, tempo, metre, notes, rests, tuplets), what the excerpt drew (note heads, rests, tuplet brackets), how far the
       two readings agree on bars and tempo (a known disagreement is shown beside the verdict, never hidden), and the arranger's outcome
     - the visible differences: how many pieces the helper's score draws more note heads, rests or tuplet brackets in, and the means - a preference may follow what a reader sees
   It prints the disclaimers (the two sources differ visibly in how many notes they hold, so the blinding is partial). It decides nothing: whether the helper's notes are
   worth what they cost is the user's decision. */
'use strict';

const PARTS = ['T', 'A'];
const ARMS = ['browser', 'helper'];
const TAG_NAMES = { 'rests': 'rests', 'hands': 'hand split', 'bars-metre': 'bars / metre', 'durations': 'note lengths', 'pitch-octave': 'pitch / octave', 'missing-extra': 'missing or extra notes', 'other': 'other' };

const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const r3 = v => v == null ? null : Math.round(v * 1000) / 1000;
const stats = () => require('../decode.js');

function decodeEngine(key, ratings) {
  const { wilson, signTestP } = stats();
  if (!key || key.format !== 'ppp-review-key/1' || key.mode !== 'h10' || key.compare !== 'engine') throw new Error('not an engine-comparison review key file (key.compare is not "engine")');
  if (!ratings || ratings.format !== 'ppp-review-ratings/2' || ratings.mode !== 'h10') throw new Error('not an H-10 ratings file exported by the review page (format ppp-review-ratings/2)');
  if (key.packetId !== ratings.packetId) throw new Error('the key is for packet ' + key.packetId + ' but the ratings are for packet ' + ratings.packetId);
  if (!Array.isArray(ratings.items)) throw new Error('the ratings file has no items list');
  const byId = new Map();
  ratings.items.forEach(r => {
    if (!key.items[r.id]) throw new Error('rating for an item the key does not have: ' + r.id);
    if (byId.has(r.id)) throw new Error('item rated twice: ' + r.id);
    byId.set(r.id, r);
  });
  const ids = Object.keys(key.items).sort();

  /* rows: one per (piece, part) that the packet has */
  const rows = [];
  ids.forEach(id => {
    const k = key.items[id], r = byId.get(id) || {};
    if (!ARMS.includes(k.X) || !ARMS.includes(k.Y) || k.X === k.Y) throw new Error('the key has no browser/helper sides for item ' + id);
    k.parts.forEach(part => {
      const a = r[part] || {};
      if (a.preference != null && !['X', 'Y', 'same'].includes(a.preference)) throw new Error('invalid preference for item ' + id + ' part ' + part + ': ' + JSON.stringify(a.preference));
      const arm = {};
      ['X', 'Y'].forEach(side => { const v = a[side] || {}; arm[k[side]] = { pass: v.pass === true ? true : v.pass === false ? false : null, tags: Array.isArray(v.tags) ? v.tags : [], text: typeof v.text === 'string' ? v.text.trim() : '' }; });
      const pref = a.preference === 'X' ? k.X : a.preference === 'Y' ? k.Y : a.preference === 'same' ? 'same' : null;
      const c = ARMS.reduce((o, n) => { const x = k.arms[n].counts[part]; o[n] = x ? { heads: x.wide.heads, rests: x.wide.rests, tuplets: x.wide.tuplets, ties: x.wide.ties } : null; return o; }, {});
      rows.push({ id: id, label: k.label, title: k.source && k.source.title, source: k.source && k.source.id, inputClass: k.inputClass || null, part: part, pref: pref, browser: arm.browser, helper: arm.helper, xIs: k.X, counts: c,
        flagged: !!(k.agreement && k.agreement.flags && k.agreement.flags.length), answered: byId.has(id) });
    });
  });

  const prefOf = list => ({ browser: list.filter(r => r.pref === 'browser').length, helper: list.filter(r => r.pref === 'helper').length, similar: list.filter(r => r.pref === 'same').length, unrated: list.filter(r => r.pref === null).length });
  const passOf = (list, arm) => { const p = list.filter(r => r[arm].pass === true).length, f = list.filter(r => r[arm].pass === false).length; return { pass: p, fail: f, unrated: list.length - p - f, rate: p + f ? r3(p / (p + f)) : null, wilson95: (w => w && w.map(r3))(wilson(p, p + f)) }; };
  const tagsOf = (list, arm) => { const t = {}; list.forEach(r => r[arm].tags.forEach(x => { t[x] = (t[x] || 0) + 1; })); return t; };
  const notesOf = (list, arm) => list.filter(r => r[arm].text).map(r => ({ id: r.id, part: r.part, text: r[arm].text }));
  const summarize = list => {
    const p = prefOf(list), dec = p.browser + p.helper;
    return {
      pieces: new Set(list.map(r => r.id)).size, parts: list.length,
      preference: Object.assign({}, p, { decisive: dec, helperShareOfDecisive: dec ? r3(p.helper / dec) : null, wilson95: (w => w && w.map(r3))(wilson(p.helper, dec)), signTestP: r3(signTestP(p.helper, dec)) }),
      pass: { browser: passOf(list, 'browser'), helper: passOf(list, 'helper') },
      tags: { browser: tagsOf(list, 'browser'), helper: tagsOf(list, 'helper') },
      notes: { browser: notesOf(list, 'browser'), helper: notesOf(list, 'helper') }
    };
  };

  const out = { packetId: key.packetId, mode: 'h10', compare: 'engine', pieces: ids.length, reviewer: ratings.reviewer || null, question: key.question || null };
  out.answered = { pieces: ids.filter(id => byId.has(id)).length };
  out.overall = summarize(rows);
  out.byPart = {};
  PARTS.forEach(p => { const l = rows.filter(r => r.part === p); if (l.length) out.byPart[p] = summarize(l); });
  /* pieces whose two readings disagree on the bars, the tempo or the metre (flags in the key) are read apart: a verdict there may be about the bars, not the notes */
  const split = list => ({ agreeing: summarize(list.filter(r => !r.flagged)), disagreeing: summarize(list.filter(r => r.flagged)) });
  out.byAgreement = {};
  PARTS.forEach(p => { const l = rows.filter(r => r.part === p); if (l.length) out.byAgreement[p] = split(l); });
  out.perPiece = ids.map(id => {
    const k = key.items[id];
    const o = { id: id, label: k.label, title: k.source && k.source.title, source: k.source && k.source.id, inputClass: k.inputClass || null, xIs: k.X, parts: {}, arranged: k.arranged,
      handsFallbackUsed: ARMS.reduce((m, a) => { m[a] = !!(k.arms[a].arrange && k.arms[a].arrange.handsFallback); return m; }, {}),
      v2Rejected: ARMS.reduce((m, a) => { m[a] = !!k.arms[a].v2Rejected; return m; }, {}), identicalSides: k.identicalSides, excerpt: { start: k.excerpt.start, end: k.excerpt.end },
      agreement: k.agreement || null, heardNotes: { browser: k.heard.browser.notes, helper: k.heard.helper.notes }, heardNotesInWindow: k.heardNotesInWindow || null,
      piece: ARMS.reduce((m, a) => { m[a] = k.arms[a].whole || null; return m; }, {}), barsShown: ARMS.reduce((m, a) => { m[a] = k.arms[a].barsShown; return m; }, {}) };
    rows.filter(r => r.id === id).forEach(r => { o.parts[r.part] = { preference: r.pref, browser: { pass: r.browser.pass, tags: r.browser.tags }, helper: { pass: r.helper.pass, tags: r.helper.tags }, drawn: r.counts }; });
    return o;
  });
  out.arrangerOutcome = {
    pieces: ids.length,
    bothArranged: ids.filter(id => key.items[id].arranged.browser && key.items[id].arranged.helper),
    onlyBrowserArranged: ids.filter(id => key.items[id].arranged.browser && !key.items[id].arranged.helper),
    onlyHelperArranged: ids.filter(id => !key.items[id].arranged.browser && key.items[id].arranged.helper),
    neither: ids.filter(id => !key.items[id].arranged.browser && !key.items[id].arranged.helper),
    handsFallback: ARMS.reduce((m, a) => { m[a] = ids.filter(id => key.items[id].arms[a].arrange && key.items[id].arms[a].arrange.handsFallback); return m; }, {}),
    v2ThrownAway: ARMS.reduce((m, a) => { m[a] = ids.filter(id => key.items[id].arms[a].v2Rejected); return m; }, {}),
    reasons: ids.reduce((o, id) => { ARMS.forEach(a => { const x = key.items[id].arms[a].arrange; if (x && !x.ok) o.push({ id: id, arm: a, reason: x.reason }); }); return o; }, [])
  };
  /* what could be seen in the drawings, per part: which source draws more note heads, rests and tuplet brackets (a preference may follow it) */
  out.visible = PARTS.map(p => {
    const l = rows.filter(r => r.part === p && r.counts.browser && r.counts.helper);
    if (!l.length) return null;
    const cmp = f => ({ helperMore: l.filter(r => r.counts.helper[f] > r.counts.browser[f]).length, helperFewer: l.filter(r => r.counts.helper[f] < r.counts.browser[f]).length, same: l.filter(r => r.counts.helper[f] === r.counts.browser[f]).length,
      mean: { browser: r3(mean(l.map(r => r.counts.browser[f]))), helper: r3(mean(l.map(r => r.counts.helper[f]))) } });
    const ratios = l.filter(r => r.counts.browser.heads > 0).map(r => r.counts.helper.heads / r.counts.browser.heads);
    return { part: p, pieces: l.length, heads: cmp('heads'), rests: cmp('rests'), tuplets: cmp('tuplets'), headsRatioHelperOverBrowser: { mean: r3(mean(ratios)), min: ratios.length ? r3(Math.min.apply(null, ratios)) : null, max: ratios.length ? r3(Math.max.apply(null, ratios)) : null } };
  }).filter(Boolean);
  const classes = [...new Set(rows.map(r => r.inputClass).filter(Boolean))];
  if (classes.length) { out.byInputClass = {}; classes.forEach(c => { out.byInputClass[c] = { T: summarize(rows.filter(r => r.inputClass === c && r.part === 'T')), A: summarize(rows.filter(r => r.inputClass === c && r.part === 'A')) }; }); }
  out.skippedAtBuild = (key.inputs && key.inputs.skipped) || [];
  out.buildWarnings = (key.inputs && key.inputs.warnings) || [];
  const heardRatios = ids.map(id => key.items[id].heard.helper.notes / key.items[id].heard.browser.notes).filter(isFinite);
  const ratio = heardRatios.length ? { mean: r3(mean(heardRatios)), min: r3(Math.min.apply(null, heardRatios)), max: r3(Math.max.apply(null, heardRatios)) } : null;
  out.heardNotesRatio = ratio;
  out.caveats = [
    'One reviewer and a handful of pieces, one excerpt each (about twelve bars chosen by time from the middle of the piece, from what the in-browser model heard; the helper\'s bars cover the same seconds): a share is not a population estimate and the intervals are wide. Bars elsewhere in the piece were not seen.',
    'Blinding is partial: the two sources differ visibly in how many notes they hold (' + (ratio ? 'the helper heard ' + ratio.mean + ' times as many as the browser model on average over these pieces, ' + ratio.min + ' to ' + ratio.max : 'see the per-piece heard counts') + '; see also `visible`), and an extra note is drawn as a head. A preference can follow density without the reviewer knowing which is which, and "missing or extra notes" is one tag for both directions: her notes say which.',
    'Both readings are the notes alone, written by the same v2 conversion with the page\'s own options: no pedal and no beats for either. The helper\'s own beat tracking is NOT used (measured on six pieces it made v2 write bars two to four times too short as wired), so this says nothing about the helper path as it would ship with its beats and pedal.',
    'Pieces whose two readings disagree on the bars, the tempo or the metre (`agreement.flags` in the key, shown per piece and in `byAgreement`) are not a clean comparison of the notes: a verdict there may be about the barlines. `byAgreement` splits the counts; read the agreeing pieces first.',
    'Part A (the Song Arranger\'s one-note-per-hand copy) exists only for pieces whose arranger accepted BOTH readings (`arrangerOutcome`); on the measured pieces that is few, and a refusal is itself a difference between the sources.',
    'The page played the written notes on the app\'s piano, not the recording: nothing was judged against the original sound except by opening the link. Pieces are the teacher\'s own choices, not a sample; the recordings are the ones she and the Lead chose.',
    'Nothing here decides anything: whether the helper\'s notes are worth what they cost (a PC with a GPU, a longer wait) is the user\'s decision.'
  ];
  return out;
}

function reportEngine(o) {
  const L = [];
  const pc = v => v == null ? 'n/a' : (100 * v).toFixed(0) + '%';
  const ci = w => w ? '[' + pc(w[0]) + ', ' + pc(w[1]) + ']' : 'n/a';
  const tagLine = t => { const k = Object.keys(t); return k.length ? k.map(x => (TAG_NAMES[x] || x) + ' x' + t[x]).join(', ') : 'none'; };
  const section = (name, s, indent) => {
    const p = s.preference, ind = indent || '';
    L.push(ind + name + ': ' + s.pieces + ' pieces, ' + s.parts + ' parts');
    L.push(ind + '  preference: browser ' + p.browser + ', helper ' + p.helper + ', similar ' + p.similar + ', unanswered ' + p.unrated + (p.decisive ? '; helper share of decisive ' + pc(p.helperShareOfDecisive) + ' 95% CI ' + ci(p.wilson95) + ', sign test p=' + p.signTestP : ''));
    ARMS.forEach(a => {
      const x = s.pass[a];
      L.push(ind + '  ' + a + ': would give to a student ' + x.pass + ' / fail ' + x.fail + ' / unanswered ' + x.unrated + (x.rate != null ? ' (' + pc(x.rate) + ' ' + ci(x.wilson95) + ')' : '') + '; problems: ' + tagLine(s.tags[a]));
    });
  };
  L.push('Packet ' + o.packetId + ' (H-10, engine comparison: browser notes against helper notes, both through v2), ' + o.pieces + ' pieces, ' + o.answered.pieces + ' with answers' + (o.reviewer ? ', reviewer role: ' + o.reviewer : ''));
  if (o.question) L.push('Question: ' + o.question);
  section('Both parts', o.overall);
  PARTS.forEach(p => { const s = o.byPart[p]; if (s) section(p === 'T' ? 'Part T (the transcription)' : 'Part A (the one-note-per-hand arrangement)', s); });
  PARTS.forEach(p => {
    const b = o.byAgreement[p];
    if (!b || !b.disagreeing.parts) return;
    L.push('Part ' + p + ' split by whether the two readings agree on bars, tempo and metre:');
    section('agreeing', b.agreeing, '  ');
    section('disagreeing (read with care: the verdict may be about the barlines)', b.disagreeing, '  ');
  });
  L.push('Per piece (browser / helper):');
  o.perPiece.forEach(x => {
    const ag = x.agreement, pb = x.piece.browser, ph = x.piece.helper;
    L.push('  ' + x.id + ' ' + x.label + ' (' + x.source + ')' + (x.title ? ' ' + x.title : '') + (x.inputClass ? ' [' + x.inputClass + ']' : '') + (ag && ag.flags.length ? '  ** READINGS DISAGREE: ' + ag.flags.join(', ') + ' **' : ''));
    L.push('    heard notes ' + x.heardNotes.browser + ' / ' + x.heardNotes.helper + (x.heardNotesInWindow ? ' (in the excerpt ' + x.heardNotesInWindow.browser + ' / ' + x.heardNotesInWindow.helper + ')' : '') +
      (pb && ph ? '; written: bars ' + pb.bars + ' / ' + ph.bars + ', tempo ' + pb.tempo + ' / ' + ph.tempo + ', metre ' + pb.metre + ' / ' + ph.metre + ', rests ' + pb.rests + ' / ' + ph.rests + ', tuplet brackets ' + pb.tupletBrackets + ' / ' + ph.tupletBrackets : '') +
      '; bars shown ' + x.barsShown.browser + ' / ' + x.barsShown.helper + (ag && ag.alignedShare != null ? '; aligned bar starts ' + ag.alignedShare + ' of the piece' + (ag.window && ag.window.alignedShare != null ? ', ' + ag.window.alignedShare + ' of the excerpt' : '') + ', phase ' + ag.phaseBeats + ' beats' : ''));
    Object.keys(x.parts).forEach(p => {
      const y = x.parts[p], f = a => (y[a].pass === null ? '?' : y[a].pass ? 'pass' : 'fail') + (y[a].tags.length ? ' {' + y[a].tags.join(',') + '}' : '');
      L.push('    ' + p + ': prefers ' + (y.preference || 'unanswered') + '; browser ' + f('browser') + '; helper ' + f('helper') +
        (y.drawn.browser && y.drawn.helper ? '; drawn heads ' + y.drawn.browser.heads + ' / ' + y.drawn.helper.heads + ', rests ' + y.drawn.browser.rests + ' / ' + y.drawn.helper.rests + ', tuplets ' + y.drawn.browser.tuplets + ' / ' + y.drawn.helper.tuplets : ''));
    });
  });
  const ao = o.arrangerOutcome;
  L.push('Arranger: both readings arranged for ' + ao.bothArranged.length + ' of ' + ao.pieces + ' pieces' + (ao.bothArranged.length ? ' (' + ao.bothArranged.join(', ') + ')' : '') + (ao.onlyBrowserArranged.length ? '; only the browser\'s: ' + ao.onlyBrowserArranged.join(', ') : '') +
    (ao.onlyHelperArranged.length ? '; only the helper\'s: ' + ao.onlyHelperArranged.join(', ') : '') + (ao.neither.length ? '; neither: ' + ao.neither.join(', ') : '') +
    (ARMS.some(a => ao.v2ThrownAway[a].length) ? '; the page threw a v2 result away for ' + ARMS.filter(a => ao.v2ThrownAway[a].length).map(a => a + ' ' + ao.v2ThrownAway[a].join(',')).join('; ') : ''));
  o.visible.forEach(v => L.push('Visible in the drawings, part ' + v.part + ' (' + v.pieces + ' pieces): the helper draws more note heads in ' + v.heads.helperMore + ' (fewer in ' + v.heads.helperFewer + '), mean ' + v.heads.mean.browser + ' / ' + v.heads.mean.helper + ' (ratio mean ' + v.headsRatioHelperOverBrowser.mean + ', range ' + v.headsRatioHelperOverBrowser.min + '-' + v.headsRatioHelperOverBrowser.max +
    '); rests: more in ' + v.rests.helperMore + ', fewer in ' + v.rests.helperFewer + ', mean ' + v.rests.mean.browser + ' / ' + v.rests.mean.helper + '; tuplet brackets: more in ' + v.tuplets.helperMore + ', fewer in ' + v.tuplets.helperFewer + ', mean ' + v.tuplets.mean.browser + ' / ' + v.tuplets.mean.helper));
  if (o.byInputClass) Object.keys(o.byInputClass).forEach(c => { const s = o.byInputClass[c]; if (s.T.parts) L.push('Input class ' + c + ' (part T): preference browser ' + s.T.preference.browser + ', helper ' + s.T.preference.helper + ', similar ' + s.T.preference.similar + '; pass browser ' + s.T.pass.browser.pass + '/' + (s.T.pass.browser.pass + s.T.pass.browser.fail) + ', helper ' + s.T.pass.helper.pass + '/' + (s.T.pass.helper.pass + s.T.pass.helper.fail)); });
  ARMS.forEach(a => { if (o.overall.notes[a].length) { L.push('Notes on the ' + a + ' score:'); o.overall.notes[a].forEach(n => L.push('  ' + n.id + ' ' + n.part + ': ' + n.text)); } });
  if (o.skippedAtBuild.length) L.push('Not in the packet: ' + o.skippedAtBuild.map(s => s.id + ' (' + s.reason.slice(0, 100) + ')').join('; '));
  if (o.buildWarnings.length) L.push('Build warnings: ' + o.buildWarnings.join('; '));
  L.push('Caveats:'); o.caveats.forEach(c => L.push('  - ' + c));
  return L.join('\n');
}

module.exports = { decodeEngine, reportEngine, TAG_NAMES };
