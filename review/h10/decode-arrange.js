/* H-10c: decode the answers of the lead-sheet-against-reduction review (review/h10/packet-arrange.js, review/lib/page-arrange.js) with the key.

     node review/decode.js --mode h10 --compare arrange --key <key-dir>/key.json --ratings ratings-h10c-<id>.json [--out summary.json]
     node review/decode.js --mode h10 --compare arrange --key <key-dir>/key.json --db rows.json        (answers read out of the artifact database; review/h10/db-to-ratings.js)

   The page's export (ppp-review-ratings/3, mode h10, compare arrange) says per piece and part, per copy, "음(멜로디)이 원곡과 맞나요?" (ok / mostly / many), "학생에게 줄 수 있나요?"
   (asis / fix / no) and, for a pair, which of X and Y is better (X / same / Y); the key says which method made X and Y (a pair) or the one copy (a single). Counted per METHOD.

   THE VERDICT is the pass rule the key fixed before any answer existed (key.passRule; the numbers are read from the key, not from here):
     1. the share of the lead-sheet copies shown whose notes are judged accurate (ok or mostly) is at least leadNotesAccurateShare;
     2. there is no pair in which the lead-sheet copy is judged "many" (틀린 곳이 많아요) while the reduction's copy of the same piece and level is not;
     3. of the pairs answered, the lead-sheet copy is preferred or "similar" in at least leadPreferredOrSimilarShare.
   PASS when all three hold, FAIL when any one fails on the answers given, INCOMPLETE when none fails but an answer a rule needs is missing (an unanswered copy is counted in the worst
   and the best case: a rule is decided only when the missing answers cannot change it). It decides nothing beyond the rule: whether to switch is the user's decision, and the rule's own
   limits (one reviewer, a handful of pieces) are printed with it. */
'use strict';

const METHODS = ['leadsheet', 'reduce'];
const NOTES = ['ok', 'mostly', 'many'], HANDS = ['asis', 'fix', 'no'];
const NOTES_NAME = { ok: '맞아요', mostly: '대체로 맞아요', many: '틀린 곳이 많아요' };
const HAND_NAME = { asis: '그대로', fix: '조금 고치면', no: '안 돼요' };
const r3 = v => v == null ? null : Math.round(v * 1000) / 1000;
const stats = () => require('../decode.js');
const accurate = n => n === 'ok' || n === 'mostly';

/* a share rule k of n (u of them unanswered, counted wrong for the worst case and right for the best): true / false when the answers settle it, null when they do not */
function shareRule(k, n, u, thr) {
  if (!n) return { pass: null, share: null, worst: null, best: null };
  const worst = (k) / n, best = (k + u) / n;
  return { pass: worst >= thr - 1e-9 ? true : best < thr - 1e-9 ? false : null, share: u ? null : r3(k / n), worst: r3(worst), best: r3(best) };
}

function decodeArrange(key, ratings) {
  const { wilson } = stats();
  if (!key || key.format !== 'ppp-review-key/1' || key.mode !== 'h10' || key.compare !== 'arrange') throw new Error('not a lead-sheet review key file (key.compare is not "arrange")');
  if (!ratings || ratings.format !== 'ppp-review-ratings/3' || ratings.mode !== 'h10' || ratings.compare !== 'arrange') throw new Error('not a ratings file exported by the lead-sheet review page (format ppp-review-ratings/3, compare arrange)');
  if (key.packetId !== ratings.packetId) throw new Error('the key is for packet ' + key.packetId + ' but the ratings are for packet ' + ratings.packetId);
  if (!Array.isArray(ratings.items)) throw new Error('the ratings file has no items list');
  const rule = key.passRule;
  if (!rule || typeof rule.leadNotesAccurateShare !== 'number' || typeof rule.leadPreferredOrSimilarShare !== 'number') throw new Error('the key has no pass rule');
  const byId = new Map();
  ratings.items.forEach(r => {
    if (!key.items[r.id]) throw new Error('rating for an item the key does not have: ' + r.id);
    if (byId.has(r.id)) throw new Error('item rated twice: ' + r.id);
    byId.set(r.id, r);
  });
  const ids = Object.keys(key.items).sort();
  const copyOf = (v, where) => {
    v = v || {};
    if (v.notes != null && !NOTES.includes(v.notes)) throw new Error('invalid notes answer for ' + where + ': ' + JSON.stringify(v.notes));
    if (v.hand != null && !HANDS.includes(v.hand)) throw new Error('invalid hand-off answer for ' + where + ': ' + JSON.stringify(v.hand));
    return { notes: v.notes == null ? null : v.notes, hand: v.hand == null ? null : v.hand };
  };

  /* rows: one per copy shown; pairs: one per pair shown */
  const copies = [], pairs = [];
  ids.forEach(id => {
    const k = key.items[id], r = byId.get(id) || {};
    Object.keys(k.parts).sort().forEach(pk => {
      const pt = k.parts[pk], a = r[pk] || {}, where = id + ' ' + pk;
      const base = { id: id, label: k.label, source: k.source && k.source.id, inputClass: k.inputClass || null, part: pk, levels: pt.levels, answered: byId.has(id) };
      if (pt.kind === 'pair') {
        if (a.preference != null && !['X', 'Y', 'same'].includes(a.preference)) throw new Error('invalid preference for ' + where + ': ' + JSON.stringify(a.preference));
        const rows = {};
        ['X', 'Y'].forEach(side => {
          const c = copyOf(a[side], where + ' ' + side);
          rows[pt[side]] = Object.assign({}, base, { method: pt[side], side: side, kind: 'pair', text: '' }, c);
        });
        const text = typeof a.text === 'string' ? a.text.trim() : '';
        const pref = a.preference === 'X' ? pt.X : a.preference === 'Y' ? pt.Y : a.preference === 'same' ? 'same' : null;
        METHODS.forEach(m => { if (!rows[m]) throw new Error('the key has no ' + m + ' side for ' + where); copies.push(rows[m]); });
        pairs.push(Object.assign({}, base, { pref: pref, text: text, lead: rows.leadsheet, reduce: rows.reduce, identicalSides: !!pt.identicalSides, soundsTheSame: !!pt.soundsTheSame }));
      } else {
        const c = copyOf(a.S, where + ' S');
        copies.push(Object.assign({}, base, { method: pt.S, side: 'S', kind: 'single', text: typeof a.text === 'string' ? a.text.trim() : '' }, c));
      }
    });
  });

  /* rule 1 */
  const lead = copies.filter(c => c.method === 'leadsheet');
  const leadAnswered = lead.filter(c => c.notes !== null), leadOk = leadAnswered.filter(c => accurate(c.notes));
  const r1 = Object.assign(shareRule(leadOk.length, lead.length, lead.length - leadAnswered.length, rule.leadNotesAccurateShare), {
    threshold: rule.leadNotesAccurateShare, copies: lead.length, accurate: leadOk.length, many: leadAnswered.length - leadOk.length, unanswered: lead.length - leadAnswered.length,
    wilson95: (w => w && w.map(r3))(wilson(leadOk.length, leadAnswered.length)),
    wrong: lead.filter(c => c.notes === 'many').map(c => c.id + ' ' + c.part + ' (' + c.source + ')')
  });
  /* rule 2 */
  const bad = [], unknown = [];
  pairs.forEach(p => {
    const l = p.lead.notes, rd = p.reduce.notes;
    if (l === 'many' && rd !== null && rd !== 'many') bad.push(p);
    else if ((l === 'many' && rd === null) || (l === null && rd !== 'many')) unknown.push(p);
  });
  const leadWrongNoReduce = copies.filter(c => c.method === 'leadsheet' && c.kind === 'single' && c.notes === 'many');
  const r2 = { pass: bad.length ? false : unknown.length ? null : true, applicable: pairs.length > 0, pairs: pairs.length,
    violations: bad.map(p => p.id + ' ' + p.part + ' (' + p.source + ')'), undecided: unknown.map(p => p.id + ' ' + p.part + ' (' + p.source + ')'),
    pieces: [...new Set(bad.map(p => p.source))],
    leadWrongWhereReductionMadeNone: leadWrongNoReduce.map(c => c.id + ' ' + c.part + ' (' + c.source + ')') };
  if (!pairs.length) r2.pass = true;
  /* rule 3 */
  const decided = pairs.filter(p => p.pref !== null), good = decided.filter(p => p.pref === 'leadsheet' || p.pref === 'same');
  const r3r = Object.assign(shareRule(good.length, pairs.length, pairs.length - decided.length, rule.leadPreferredOrSimilarShare), {
    threshold: rule.leadPreferredOrSimilarShare, applicable: pairs.length > 0, pairs: pairs.length, leadPreferred: decided.filter(p => p.pref === 'leadsheet').length, reducePreferred: decided.filter(p => p.pref === 'reduce').length,
    similar: decided.filter(p => p.pref === 'same').length, unanswered: pairs.length - decided.length
  });
  if (!pairs.length) r3r.pass = true;
  const rules = [r1.pass, r2.pass, r3r.pass];
  const verdict = rules.includes(false) ? 'FAIL' : rules.every(x => x === true) ? 'PASS' : 'INCOMPLETE';

  /* descriptive, per method */
  const tally = (list, f, names) => { const t = {}; names.forEach(n => { t[n] = list.filter(c => c[f] === n).length; }); t.unanswered = list.filter(c => c[f] === null).length; return t; };
  const byMethod = {};
  METHODS.forEach(m => {
    const l = copies.filter(c => c.method === m);
    byMethod[m] = { copies: l.length, pairs: l.filter(c => c.kind === 'pair').length, singles: l.filter(c => c.kind === 'single').length, notes: tally(l, 'notes', NOTES), hand: tally(l, 'hand', HANDS) };
  });
  const perPiece = ids.map(id => {
    const k = key.items[id];
    return { id: id, label: k.label, source: k.source && k.source.id, inputClass: k.inputClass || null, X: k.X, Y: k.Y, answered: byId.has(id), heardNotes: k.heard && k.heard.notes, conversion: k.conversion && { bars: k.conversion.measures, tempo: k.conversion.tempo, metre: k.conversion.metre, keyFifths: k.conversion.keyFifths, v2Rejected: k.conversion.v2Rejected },
      refusals: k.refusals, parts: Object.keys(k.parts).sort().map(pk => {
        const pt = k.parts[pk], mine = copies.filter(c => c.id === id && c.part === pk), pr = pairs.find(p => p.id === id && p.part === pk);
        return { part: pk, kind: pt.kind, levels: pt.levels, merged: pt.merged, identicalSides: pt.identicalSides == null ? null : pt.identicalSides, preference: pr ? pr.pref : null,
          copies: mine.map(c => ({ method: c.method, side: c.side, notes: c.notes, hand: c.hand })), text: (pr && pr.text) || (mine.find(c => c.text) || {}).text || '' };
      }) };
  });
  const comments = [];
  pairs.forEach(p => { if (p.text) comments.push({ id: p.id, part: p.part, source: p.source, text: p.text }); });
  copies.filter(c => c.kind === 'single' && c.text).forEach(c => comments.push({ id: c.id, part: c.part, source: c.source, text: c.text }));
  comments.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.part < b.part ? -1 : 1);

  const out = { packetId: key.packetId, mode: 'h10', compare: 'arrange', pieces: ids.length, reviewer: ratings.reviewer || null, question: key.question || null, passRule: rule };
  out.answered = { pieces: ids.filter(id => byId.has(id)).length, copies: copies.filter(c => c.notes !== null && c.hand !== null).length, copiesShown: copies.length, pairsShown: pairs.length, pairsPreferenceGiven: decided.length };
  out.verdict = verdict;
  out.rules = { leadNotesAccurate: r1, noPieceWhereOnlyLeadIsWrong: r2, leadPreferredOrSimilar: r3r };
  out.byMethod = byMethod;
  out.perPiece = perPiece;
  out.comments = comments;
  out.shown = key.shown || null;
  out.summary = key.summary || null;
  out.skippedAtBuild = (key.inputs && key.inputs.skipped) || [];
  out.caveats = [
    'One reviewer (the role she gave) and ' + ids.length + ' pieces, one excerpt each (about twelve bars chosen by time from the middle of the piece, the same bars for every copy of it): a share is not a population estimate, and with this few copies one answer moves a share by a large step. Bars elsewhere in the piece were not seen.',
    'The pass rule asks whether the NOTES are accurate. They can be wrong because the transcription heard them wrongly (both methods start from the same heard notes, so a transcription error is in both copies), not because of the lead sheet; rule 2 compares the lead sheet with the reduction on the same heard notes, rule 1 does not.',
    'Blinding is partial: the two methods differ visibly in density, in the left hand and in how often the 8va line is printed, so a preference can follow what the score looks like. Singles are shown where only one method made a copy (the reduction refused those covers); which method is not told, but the reviewer knows one method refused.',
    'Rule 3 and rule 2 are about pairs only: a piece for which the reduction made no copy has no pair, and its lead-sheet copy counts in rule 1 alone. A pair whose two sides are identical (`identicalSides`) is the same score twice.',
    'The page played the written notes on the app\'s piano, not the recording: nothing was judged against the original sound except by opening the link.',
    'Nothing here decides anything beyond the rule: switching recordings to the lead sheet is the user\'s decision.'
  ];
  return out;
}

function reportArrange(o) {
  const L = [];
  const pc = v => v == null ? 'n/a' : (100 * v).toFixed(0) + '%';
  const ci = w => w ? '[' + pc(w[0]) + ', ' + pc(w[1]) + ']' : 'n/a';
  const word = v => v === true ? 'holds' : v === false ? 'FAILS' : 'not decided yet (answers missing)';
  const tally = (t, names, nameOf) => names.map(n => (nameOf[n] || n) + ' ' + t[n]).join(', ') + (t.unanswered ? ', unanswered ' + t.unanswered : '');
  L.push('Packet ' + o.packetId + ' (H-10c, the lead sheet against the reduction), ' + o.pieces + ' pieces, ' + o.answered.pieces + ' with answers' + (o.reviewer ? ', reviewer role: ' + o.reviewer : ''));
  if (o.question) L.push('Question: ' + o.question);
  L.push('VERDICT: ' + o.verdict + '  (the pass rule written into the key before any answer: ' + o.passRule.source + ')');
  const r1 = o.rules.leadNotesAccurate, r2 = o.rules.noPieceWhereOnlyLeadIsWrong, r3 = o.rules.leadPreferredOrSimilar;
  L.push('  1. lead-sheet copies whose notes are accurate (맞아요 or 대체로 맞아요), needed ' + pc(r1.threshold) + ': ' + r1.accurate + ' of ' + r1.copies + (r1.unanswered ? ' (' + r1.unanswered + ' unanswered; between ' + pc(r1.worst) + ' and ' + pc(r1.best) + ')' : ' = ' + pc(r1.share) + ' ' + ci(r1.wilson95)) + ' -> ' + word(r1.pass) + (r1.wrong.length ? '; judged 틀린 곳이 많아요: ' + r1.wrong.join(', ') : ''));
  L.push('  2. no pair where only the lead-sheet copy is 틀린 곳이 많아요 (' + r2.pairs + ' pairs) -> ' + word(r2.pass) + (r2.violations.length ? ': ' + r2.violations.join(', ') : '') + (r2.undecided.length ? '; undecided: ' + r2.undecided.join(', ') : '') + (r2.leadWrongWhereReductionMadeNone.length ? '; lead sheet judged wrong where the reduction made no copy (not part of this rule): ' + r2.leadWrongWhereReductionMadeNone.join(', ') : ''));
  L.push('  3. pairs with the lead-sheet copy preferred or similar, needed ' + pc(r3.threshold) + ': ' + (r3.leadPreferred + r3.similar) + ' of ' + r3.pairs + ' (lead ' + r3.leadPreferred + ', reduction ' + r3.reducePreferred + ', similar ' + r3.similar + (r3.unanswered ? ', unanswered ' + r3.unanswered : '') + ') -> ' + word(r3.pass));
  METHODS.forEach(m => {
    const x = o.byMethod[m];
    L.push((m === 'leadsheet' ? 'Lead sheet' : 'Reduction') + ': ' + x.copies + ' copies shown (' + x.pairs + ' in pairs, ' + x.singles + ' alone); notes: ' + tally(x.notes, NOTES, NOTES_NAME) + '; hand over to a student: ' + tally(x.hand, HANDS, HAND_NAME));
  });
  L.push('Per piece:');
  o.perPiece.forEach(x => {
    L.push('  ' + x.id + ' ' + x.label + ' (' + x.source + ')' + (x.inputClass ? ' [' + x.inputClass + ']' : '') + (x.conversion ? ' ' + x.conversion.bars + ' bars, tempo ' + x.conversion.tempo + ', ' + x.conversion.metre + ', key ' + x.conversion.keyFifths : '') + (x.refusals.length ? '; refused: ' + x.refusals.map(f => f.method + '@' + f.level + ' ' + f.reason).join(', ') : ''));
    x.parts.forEach(p => L.push('    ' + p.part + ' ' + p.kind + (p.merged ? ' (both levels the same)' : '') + (p.kind === 'pair' ? ', prefers ' + (p.preference || 'unanswered') + (p.identicalSides ? ' (X and Y drawn identically)' : '') : '') +
      ': ' + p.copies.map(c => c.method + ' notes ' + (c.notes || '?') + ' / hand ' + (c.hand || '?')).join('; ')));
  });
  if (o.comments.length) { L.push('Comments:'); o.comments.forEach(c => L.push('  ' + c.id + ' ' + c.part + ' (' + c.source + '): ' + c.text)); }
  if (o.skippedAtBuild.length) L.push('Not in the packet: ' + o.skippedAtBuild.map(s => s.id + ' (' + s.reason.slice(0, 100) + ')').join('; '));
  L.push('Caveats:'); o.caveats.forEach(c => L.push('  - ' + c));
  return L.join('\n');
}

module.exports = { decodeArrange, reportArrange, shareRule };
