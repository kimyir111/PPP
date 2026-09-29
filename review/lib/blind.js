/* G9c: the blind assignment.

   Everything that decides which arrangement the reviewer sees as X and which as Y, and in what order the items appear, comes
   from HMAC-SHA256 keyed with a SECRET seed given at build time (`--seed`). The rule is public (this file); without the seed it
   cannot be replayed, and the seed is written to the KEY file only - never to the packet the reviewer opens (the M-H1 lesson,
   docs/DECISIONS.md G4-D2-19: a manifest that stated the seed and the rule let a reviewer recompute every X/Y).

     order      items are shown sorted by HMAC(seed, 'order|' + itemKey)
     assignment items sorted by HMAC(seed, 'xy|' + itemKey); the ones at even ranks show the G9 arm as X, the others as Y, so
                the split is as even as it can be (n even: exactly half; n odd: one more X-is-G9) - position bias cannot then
                pass for a preference for one arm
     ids        i01, i02, ... in shown order; they carry nothing else

   Nothing here depends on the order the items were passed in (they are re-sorted by key first), so the same items and seed give
   the same packet however the caller listed them. */
'use strict';
const crypto = require('crypto');

const hmac = (seed, label) => crypto.createHmac('sha256', String(seed)).update(label).digest('hex');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const itemKey = it => it.file + '|' + Number(it.targetLevel).toFixed(2) + '|' + it.handProfile;

/* items -> [{ id, key, item, x: 'g9'|'legacy', y: the other }] in the order the reviewer sees them */
function assign(items, seed) {
  if (seed == null || String(seed).length < 4) throw new Error('a secret --seed of at least 4 characters is required');
  const keyed = items.map(it => ({ item: it, key: itemKey(it) }));
  const keys = new Set(keyed.map(k => k.key));
  if (keys.size !== keyed.length) throw new Error('two items with the same file, level and hand profile');
  const byXy = keyed.slice().sort((a, b) => cmp(hmac(seed, 'xy|' + a.key), hmac(seed, 'xy|' + b.key)) || cmp(a.key, b.key));
  const rank = new Map(byXy.map((k, i) => [k.key, i]));
  const shown = keyed.slice().sort((a, b) => cmp(hmac(seed, 'order|' + a.key), hmac(seed, 'order|' + b.key)) || cmp(a.key, b.key));
  return shown.map((k, i) => {
    const x = rank.get(k.key) % 2 === 0 ? 'g9' : 'legacy';
    return { id: 'i' + String(i + 1).padStart(2, '0'), key: k.key, item: k.item, x: x, y: x === 'g9' ? 'legacy' : 'g9' };
  });
}
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

module.exports = { assign, itemKey, hmac, sha256 };
