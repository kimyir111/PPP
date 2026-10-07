/* G10a-5 (H-10): decode the teacher's answers with the key.

     node review/decode.js --mode h10 --key <key-dir>/key.json --ratings <ratings-h10-ID.json> [--out summary.json]

   The page's export (ppp-review-ratings/2: per piece and part, the preference X / Y / same, and per side pass / fail, tags, a note) is joined to the
   key (which of X and Y was v2 and which the classic conversion, per piece), and counted per arm:
     - wins, losses and ties (preference), per part and over both: part T is the transcription as the review screen shows it, part A the Song
       Arranger's one-note-per-hand copy of it (a piece whose arranger refused one of the two has no part A: said in `arrangerOutcome`)
     - pass rates ("would you give this to a student, small fixes allowed"), with Wilson intervals
     - tag counts per arm (rests, hands, bars and metre, durations, pitch and octave, missing or extra notes, other), per part and per piece
     - the starting rule of G10 section 10, evaluated as the key fixed it before any answer existed (v2 at least as good on 8 of 10, no piece where
       only v2 fails, v2 handed to a student on 6 of 10: as shares of the pieces answered) - on part T, and for information on part A
     - what a reader could see in the drawings (rests, tuplet brackets, heads of each arm), so a preference can be read against it
   It prints the disclaimers. It decides nothing: the flip is the user's decision (G10 section 14, U6). */
'use strict';

const PARTS = ['T', 'A'];
const ARMS = ['v2', 'classic'];
const TAG_NAMES = { 'rests': 'rests', 'hands': 'hand split', 'bars-metre': 'bars / metre', 'durations': 'note lengths', 'pitch-octave': 'pitch / octave', 'missing-extra': 'missing or extra notes', 'other': 'other' };

const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const r3 = v => v == null ? null : Math.round(v * 1000) / 1000;

function stats() { return require('../decode.js'); }

function decodeH10(key, ratings) {
  if (key && key.compare === 'engine') return require('./decode-engine.js').decodeEngine(key, ratings); /* G10b-0: the same pieces from two note sources */
  if (key && key.compare === 'arrange') return require('./decode-arrange.js').decodeArrange(key, ratings); /* H-10c: the lead sheet against the reduction */
  const { wilson, signTestP } = stats();
  if (!key || key.format !== 'ppp-review-key/1' || key.mode !== 'h10') throw new Error('not an H-10 review key file');
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
  const sideOf = k => ({ X: k.X, Y: k.Y });

  /* rows: one per (piece, part) that the packet has */
  const rows = [];
  ids.forEach(id => {
    const k = key.items[id], r = byId.get(id) || {};
    k.parts.forEach(part => {
      const a = r[part] || {};
      if (a.preference != null && !['X', 'Y', 'same'].includes(a.preference)) throw new Error('invalid preference for item ' + id + ' part ' + part + ': ' + JSON.stringify(a.preference));
      const arm = {};
      ['X', 'Y'].forEach(side => { const v = a[side] || {}; arm[sideOf(k)[side]] = { pass: v.pass === true ? true : v.pass === false ? false : null, tags: Array.isArray(v.tags) ? v.tags : [], text: typeof v.text === 'string' ? v.text.trim() : '' }; });
      const pref = a.preference === 'X' ? k.X : a.preference === 'Y' ? k.Y : a.preference === 'same' ? 'same' : null;
      const c = ARMS.reduce((o, n) => { const x = k.arms[n].counts[part]; o[n] = x ? { heads: x.wide.heads, rests: x.wide.rests, tuplets: x.wide.tuplets, ties: x.wide.ties } : null; return o; }, {});
      rows.push({ id: id, label: k.label, title: k.source && k.source.title, source: k.source && k.source.id, inputClass: k.inputClass || null, part: part, pref: pref, v2: arm.v2, classic: arm.classic, xIs: k.X, counts: c, answered: byId.has(id) });
    });
  });

  const prefOf = list => ({ v2: list.filter(r => r.pref === 'v2').length, classic: list.filter(r => r.pref === 'classic').length, similar: list.filter(r => r.pref === 'same').length, unrated: list.filter(r => r.pref === null).length });
  const passOf = (list, arm) => { const p = list.filter(r => r[arm].pass === true).length, f = list.filter(r => r[arm].pass === false).length; return { pass: p, fail: f, unrated: list.length - p - f, rate: p + f ? r3(p / (p + f)) : null, wilson95: (w => w && w.map(r3))(wilson(p, p + f)) }; };
  const tagsOf = (list, arm) => { const t = {}; list.forEach(r => r[arm].tags.forEach(x => { t[x] = (t[x] || 0) + 1; })); return t; };
  const notesOf = (list, arm) => list.filter(r => r[arm].text).map(r => ({ id: r.id, part: r.part, text: r[arm].text }));

  const summarize = list => {
    const p = prefOf(list), dec = p.v2 + p.classic;
    return {
      pieces: new Set(list.map(r => r.id)).size, parts: list.length,
      preference: Object.assign({}, p, { decisive: dec, v2ShareOfDecisive: dec ? r3(p.v2 / dec) : null, wilson95: (w => w && w.map(r3))(wilson(p.v2, dec)), signTestP: r3(signTestP(p.v2, dec)) }),
      pass: { v2: passOf(list, 'v2'), classic: passOf(list, 'classic') },
      tags: { v2: tagsOf(list, 'v2'), classic: tagsOf(list, 'classic') },
      notes: { v2: notesOf(list, 'v2'), classic: notesOf(list, 'classic') }
    };
  };

  /* the starting rule of G10 section 10, as the key fixed it, on one part's rows (a piece is a row here) */
  const rule = list => {
    const R = key.passRule || {};
    const answered = list.filter(r => r.pref !== null);
    const asGood = answered.filter(r => r.pref === 'v2' || r.pref === 'same').length;
    const onlyV2Fails = list.filter(r => r.v2.pass === false && r.classic.pass === true).map(r => r.id);
    const rated = list.filter(r => r.v2.pass !== null), v2Pass = rated.filter(r => r.v2.pass === true).length;
    const share = (k, n) => n ? r3(k / n) : null;
    const a = share(asGood, answered.length), c = share(v2Pass, rated.length);
    return {
      v2AtLeastAsGood: { count: asGood, of: answered.length, share: a, needs: R.v2AtLeastAsGoodShare, met: a == null ? null : a >= R.v2AtLeastAsGoodShare - 1e-9 },
      onlyV2Fails: { pieces: onlyV2Fails, met: onlyV2Fails.length === 0 || !R.noPieceWhereOnlyV2Fails },
      v2HandedToAStudent: { count: v2Pass, of: rated.length, share: c, needs: R.v2PassShare, met: c == null ? null : c >= R.v2PassShare - 1e-9 },
      allMet: a != null && c != null && a >= R.v2AtLeastAsGoodShare - 1e-9 && c >= R.v2PassShare - 1e-9 && (onlyV2Fails.length === 0 || !R.noPieceWhereOnlyV2Fails),
      complete: answered.length === list.length && rated.length === list.length
    };
  };

  const out = { packetId: key.packetId, mode: 'h10', pieces: ids.length, reviewer: ratings.reviewer || null };
  out.answered = { pieces: ids.filter(id => byId.has(id)).length };
  out.overall = summarize(rows);
  out.byPart = {};
  PARTS.forEach(p => { const l = rows.filter(r => r.part === p); if (l.length) out.byPart[p] = Object.assign(summarize(l), { startingRule: rule(l) }); });
  out.perPiece = ids.map(id => {
    const k = key.items[id];
    const o = { id: id, label: k.label, title: k.source && k.source.title, source: k.source && k.source.id, inputClass: k.inputClass || null, xIs: k.X, parts: {}, arranged: k.arranged,
      handsFallbackUsed: !!(k.arms.v2.arrange && k.arms.v2.arrange.handsFallback), v2Rejected: !!k.arms.v2.v2Rejected, identicalSides: k.identicalSides, excerpt: { start: k.excerpt.start, end: k.excerpt.end } };
    rows.filter(r => r.id === id).forEach(r => { o.parts[r.part] = { preference: r.pref, v2: { pass: r.v2.pass, tags: r.v2.tags }, classic: { pass: r.classic.pass, tags: r.classic.tags }, drawn: r.counts }; });
    return o;
  });
  out.arrangerOutcome = {
    pieces: ids.length,
    bothArranged: ids.filter(id => key.items[id].arranged.v2 && key.items[id].arranged.classic).length,
    onlyClassicArranged: ids.filter(id => !key.items[id].arranged.v2 && key.items[id].arranged.classic),
    onlyV2Arranged: ids.filter(id => key.items[id].arranged.v2 && !key.items[id].arranged.classic),
    neither: ids.filter(id => !key.items[id].arranged.v2 && !key.items[id].arranged.classic),
    v2ThroughHandsFallback: ids.filter(id => key.items[id].arms.v2.arrange && key.items[id].arms.v2.arrange.handsFallback),
    v2ThrownAway: ids.filter(id => key.items[id].arms.v2.v2Rejected),
    reasons: ids.reduce((o, id) => { ARMS.forEach(a => { const x = key.items[id].arms[a].arrange; if (x && !x.ok) o.push({ id: id, arm: a, reason: x.reason }); }); return o; }, [])
  };
  /* what could be seen in the drawings, per part: the arm that draws more rests / tuplet brackets (a preference may follow it) */
  out.visible = PARTS.map(p => {
    const l = rows.filter(r => r.part === p && r.counts.v2 && r.counts.classic);
    if (!l.length) return null;
    return { part: p, pieces: l.length, v2FewerRests: l.filter(r => r.counts.v2.rests < r.counts.classic.rests).length, v2MoreRests: l.filter(r => r.counts.v2.rests > r.counts.classic.rests).length,
      v2FewerTuplets: l.filter(r => r.counts.v2.tuplets < r.counts.classic.tuplets).length, v2MoreTuplets: l.filter(r => r.counts.v2.tuplets > r.counts.classic.tuplets).length,
      meanRests: { v2: r3(mean(l.map(r => r.counts.v2.rests))), classic: r3(mean(l.map(r => r.counts.classic.rests))) },
      meanTuplets: { v2: r3(mean(l.map(r => r.counts.v2.tuplets))), classic: r3(mean(l.map(r => r.counts.classic.tuplets))) } };
  }).filter(Boolean);
  /* the split CLEAN_INPUT / UPSTREAM_ERROR the design asks for (G10 section 10), when the items were labelled: reported apart, never dropped */
  const classes = [...new Set(rows.map(r => r.inputClass).filter(Boolean))];
  if (classes.length) { out.byInputClass = {}; classes.forEach(c => { out.byInputClass[c] = { T: summarize(rows.filter(r => r.inputClass === c && r.part === 'T')), A: summarize(rows.filter(r => r.inputClass === c && r.part === 'A')) }; }); }
  out.skippedAtBuild = (key.inputs && key.inputs.skipped) || [];
  out.caveats = [
    'One reviewer and a handful of pieces, one excerpt each (about twelve bars chosen from the middle of the piece by time, the same seconds for both ways): a share is not a population estimate and the intervals are wide. Bars elsewhere in the piece were not seen.',
    'Blinding is partial: the two ways differ in what the drawings show (v2 usually writes far fewer rests and tuplet brackets, and reads the bars differently); see `visible`. A preference can follow that without the reviewer knowing which is which.',
    'The recordings are what the app\'s own in-browser model heard (the browser Onsets & Frames path, no helper, no pedal): errors of the model are in both arms. Pieces are the teacher\'s own choices, not a sample.',
    'Part A is the Song Arranger\'s one-note-per-hand copy made as the app makes it: a v2 transcription the arranger refuses is arranged from the same heard notes converted with v2 and the classic hands (`handsFallback`), so part A of those pieces judges that conversion, not v2\'s own hand split. A piece whose arranger refused one of the two has no part A.',
    'Items of one piece are not independent (part T and part A share the reading); counts are per part, and the starting rule is evaluated on part T. The page played the written notes on the app\'s piano, not the recording: nothing was judged against the original sound except by opening the link.',
    'The starting rule (G10 section 10) is a starting point fixed in the key before any answer existed; meeting or missing it does not flip anything. The default of the app is the user\'s decision (U6).'
  ];
  return out;
}

function reportH10(o) {
  if (o.compare === 'engine') return require('./decode-engine.js').reportEngine(o);
  if (o.compare === 'arrange') return require('./decode-arrange.js').reportArrange(o);
  const L = [];
  const pc = v => v == null ? 'n/a' : (100 * v).toFixed(0) + '%';
  const ci = w => w ? '[' + pc(w[0]) + ', ' + pc(w[1]) + ']' : 'n/a';
  const tagLine = t => { const k = Object.keys(t); return k.length ? k.map(x => (TAG_NAMES[x] || x) + ' x' + t[x]).join(', ') : 'none'; };
  const section = (name, s) => {
    const p = s.preference;
    L.push(name + ': ' + s.pieces + ' pieces');
    L.push('  preference: v2 ' + p.v2 + ', classic ' + p.classic + ', similar ' + p.similar + ', unanswered ' + p.unrated + (p.decisive ? '; v2 share of decisive ' + pc(p.v2ShareOfDecisive) + ' 95% CI ' + ci(p.wilson95) + ', sign test p=' + p.signTestP : ''));
    ARMS.forEach(a => {
      const x = s.pass[a];
      L.push('  ' + a + ': would give to a student ' + x.pass + ' / fail ' + x.fail + ' / unanswered ' + x.unrated + (x.rate != null ? ' (' + pc(x.rate) + ' ' + ci(x.wilson95) + ')' : '') + '; problems: ' + tagLine(s.tags[a]));
    });
  };
  L.push('Packet ' + o.packetId + ' (H-10), ' + o.pieces + ' pieces, ' + o.answered.pieces + ' with answers' + (o.reviewer ? ', reviewer role: ' + o.reviewer : ''));
  section('Both parts', o.overall);
  PARTS.forEach(p => {
    const s = o.byPart[p];
    if (!s) return;
    section(p === 'T' ? 'Part T (the transcription)' : 'Part A (the one-note-per-hand arrangement)', s);
    const r = s.startingRule, yn = v => v == null ? 'n/a' : v ? 'met' : 'NOT met';
    L.push('  starting rule' + (r.complete ? '' : ' (incomplete answers)') + ': v2 at least as good ' + r.v2AtLeastAsGood.count + '/' + r.v2AtLeastAsGood.of + ' (needs ' + pc(r.v2AtLeastAsGood.needs) + ': ' + yn(r.v2AtLeastAsGood.met) + '); pieces where only v2 fails: ' +
      (r.onlyV2Fails.pieces.length ? r.onlyV2Fails.pieces.join(', ') : 'none') + ' (' + yn(r.onlyV2Fails.met) + '); v2 handed to a student ' + r.v2HandedToAStudent.count + '/' + r.v2HandedToAStudent.of + ' (needs ' + pc(r.v2HandedToAStudent.needs) + ': ' + yn(r.v2HandedToAStudent.met) + ')');
  });
  L.push('Per piece (v2 / classic: pass and problems; preference is by arm):');
  o.perPiece.forEach(x => {
    L.push('  ' + x.id + ' ' + x.label + (x.title ? ' ' + x.title : '') + (x.inputClass ? ' [' + x.inputClass + ']' : '') + (x.handsFallbackUsed ? ' (v2 arrangement via hands fallback)' : '') + (x.v2Rejected ? ' (v2 result thrown away by the plausibility check)' : ''));
    Object.keys(x.parts).forEach(p => {
      const y = x.parts[p], f = a => (y[a].pass === null ? '?' : y[a].pass ? 'pass' : 'fail') + (y[a].tags.length ? ' {' + y[a].tags.join(',') + '}' : '');
      L.push('    ' + p + ': prefers ' + (y.preference || 'unanswered') + '; v2 ' + f('v2') + '; classic ' + f('classic') + (y.drawn.v2 && y.drawn.classic ? '; rests v2 ' + y.drawn.v2.rests + ' / classic ' + y.drawn.classic.rests + ', tuplets ' + y.drawn.v2.tuplets + ' / ' + y.drawn.classic.tuplets : ''));
    });
  });
  const ao = o.arrangerOutcome;
  L.push('Arranger: both ways arranged for ' + ao.bothArranged + ' of ' + ao.pieces + ' pieces' + (ao.onlyClassicArranged.length ? '; only classic: ' + ao.onlyClassicArranged.join(', ') : '') + (ao.onlyV2Arranged.length ? '; only v2: ' + ao.onlyV2Arranged.join(', ') : '') + (ao.neither.length ? '; neither: ' + ao.neither.join(', ') : '') +
    '; v2 arranged through the hands fallback for ' + ao.v2ThroughHandsFallback.length + (ao.v2ThrownAway.length ? '; v2 thrown away by the page for ' + ao.v2ThrownAway.join(', ') : ''));
  if (o.visible.length) o.visible.forEach(v => L.push('Visible in the drawings, part ' + v.part + ': v2 draws fewer rests in ' + v.v2FewerRests + ' of ' + v.pieces + ' pieces (more in ' + v.v2MoreRests + '), fewer tuplet brackets in ' + v.v2FewerTuplets + ' (more in ' + v.v2MoreTuplets + '); mean rests v2 ' + v.meanRests.v2 + ' / classic ' + v.meanRests.classic));
  if (o.byInputClass) Object.keys(o.byInputClass).forEach(c => { const s = o.byInputClass[c]; if (s.T.parts) L.push('Input class ' + c + ' (part T): preference v2 ' + s.T.preference.v2 + ', classic ' + s.T.preference.classic + ', similar ' + s.T.preference.similar + '; v2 pass ' + s.T.pass.v2.pass + '/' + (s.T.pass.v2.pass + s.T.pass.v2.fail) + ', classic pass ' + s.T.pass.classic.pass + '/' + (s.T.pass.classic.pass + s.T.pass.classic.fail)); });
  ['v2', 'classic'].forEach(a => { if (o.overall.notes[a].length) { L.push('Notes on ' + a + ':'); o.overall.notes[a].forEach(n => L.push('  ' + n.id + ' ' + n.part + ': ' + n.text)); } });
  if (o.skippedAtBuild.length) L.push('Not in the packet: ' + o.skippedAtBuild.map(s => s.id + ' (' + s.reason.slice(0, 100) + ')').join('; '));
  L.push('Caveats:'); o.caveats.forEach(c => L.push('  - ' + c));
  return L.join('\n');
}

module.exports = { decodeH10, reportH10, TAG_NAMES };
