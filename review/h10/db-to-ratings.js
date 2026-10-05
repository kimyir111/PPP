/* G10a-5 (H-10): when the page runs as an Artifact with the `db` capability, the answers are documents in the artifact database
   (answers/<packetId>/items/<id>, and answers/<packetId> for the reviewer's role; see review/lib/page-h10.js). This turns what was read out of
   that database (ArtifactData list/query) into the same ratings file the page's export button writes, so decode.js reads either:

     node review/decode.js --mode h10 --key <key.json> --db <rows.json> [--out summary.json]

   rows.json: a list of { path, data } (or { id, data } for the items), or an object { "<path>": data }. Documents of another packet are ignored.
   No answer is invented: an item with no document is simply absent from the ratings (decode counts it as unanswered). */
'use strict';

function normalize(rows) {
  if (Array.isArray(rows)) return rows.map(r => ({ path: r.path || r.id || '', data: r.data !== undefined ? r.data : r }));
  return Object.keys(rows || {}).map(p => ({ path: p, data: rows[p] }));
}

const sideOf = s => ({ pass: s && s.pass === true ? true : s && s.pass === false ? false : null, tags: s && Array.isArray(s.tags) ? s.tags.slice() : [], text: s && typeof s.text === 'string' ? s.text : '' });
const partOf = p => ({ preference: p && ['X', 'Y', 'same'].includes(p.pref) ? p.pref : null, X: sideOf(p && p.X), Y: sideOf(p && p.Y) });

function dbToRatings(rows, packetId) {
  const list = normalize(rows);
  const items = new Map();
  let role = '';
  list.forEach(r => {
    const d = r.data;
    if (!d || typeof d !== 'object') return;
    const m = /(?:^|\/)answers\/([^/]+)\/items\/([^/]+)$/.exec(r.path);
    const isItem = m ? m[1] === packetId : (d.packetId === packetId && typeof d.id === 'string' && (d.T || d.A));
    if (isItem) {
      const id = m ? m[2] : d.id;
      if (d.packetId && d.packetId !== packetId) return;
      const o = { id: id, t: d.t || 0 };
      ['T', 'A'].forEach(p => { if (d[p]) o[p] = partOf(d[p]); });
      if (!items.has(id) || items.get(id).t < o.t) items.set(id, o);
      return;
    }
    const mm = /(?:^|\/)answers\/([^/]+)$/.exec(r.path);
    if (mm && mm[1] === packetId && typeof d.role === 'string') role = d.role;
  });
  return {
    format: 'ppp-review-ratings/2', mode: 'h10', packetId: packetId, reviewer: role, exportedAt: 'from the artifact database',
    items: [...items.values()].sort((a, b) => a.id < b.id ? -1 : 1).map(o => { const x = { id: o.id }; ['T', 'A'].forEach(p => { if (o[p]) x[p] = o[p]; }); return x; })
  };
}

module.exports = { dbToRatings };
