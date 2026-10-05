/* G10a-5 (H-10): a page holds 4 scores x 2 layouts per item, about 0.9 MB of SVG per item, mostly the same few hundred bytes of markup repeated
   with different coordinates. Two lossless steps keep ten items near 4 MB (the piano recordings add 1.7 MB):

     hoist   every drawing of the page uses ONE glyph-id prefix, so the <defs> of the drawings are the same symbols; they are taken out of
             the drawings and written once (a symbol that differs between two drawings is an error, never merged)
     pack    the text between numbers (`"/>\n<use href="#g-noteheadBlack" class="vf-notehead" x="`) repeats thousands of times: each distinct
             fragment seen at least twice becomes one private-use character (U+E000 + its index) and a shared list gives them back

   unpack(dict, packed) is the exact inverse of pack (tests compare them, and the page carries the same few lines). Nothing here looks
   at what a drawing means. */
'use strict';

const NUM = /-?\d+(?:\.\d+)?/g;
const PUA_FIRST = 0xE000, PUA_LAST = 0xF8FF;

/* [fragments, numbers] with fragments.length === numbers.length + 1, so fragments[0] + numbers[0] + fragments[1] ... is the string */
function tokenize(s) {
  const frags = [], nums = [];
  let last = 0, m;
  NUM.lastIndex = 0;
  while ((m = NUM.exec(s))) { frags.push(s.slice(last, m.index)); nums.push(m[0]); last = m.index + m[0].length; }
  frags.push(s.slice(last));
  return { frags: frags, nums: nums };
}

/* pull the <defs> out of each drawing: { bodies: {key: svg without defs}, symbols: [markup sorted by id] } */
function hoistDefs(svgs) {
  const symbols = new Map(), bodies = {};
  Object.keys(svgs).forEach(key => {
    const s = svgs[key];
    const m = /<defs>\n?([\s\S]*?)<\/defs>\n?/.exec(s);
    if (!m) { bodies[key] = s; return; }
    (m[1].match(/<symbol id="[^"]+"[\s\S]*?<\/symbol>/g) || []).forEach(sym => {
      const id = /^<symbol id="([^"]+)"/.exec(sym)[1];
      if (symbols.has(id) && symbols.get(id) !== sym) throw new Error('glyph ' + id + ' is drawn differently in two drawings of one page; it cannot be shared');
      symbols.set(id, sym);
    });
    if (m[1].replace(/<symbol id="[^"]+"[\s\S]*?<\/symbol>\n?/g, '').trim()) throw new Error('a drawing has something other than symbols in its <defs>');
    bodies[key] = s.slice(0, m.index) + s.slice(m.index + m[0].length);
  });
  return { bodies: bodies, symbols: [...symbols.keys()].sort().map(id => symbols.get(id)) };
}

/* texts: {key: string} -> { dict: [fragment], packed: {key: string} } */
function pack(texts) {
  const keys = Object.keys(texts);
  const freq = new Map();
  const toks = {};
  keys.forEach(k => {
    if (/[-]/.test(texts[k])) throw new Error('a drawing already contains a private-use character');
    toks[k] = tokenize(texts[k]);
    toks[k].frags.forEach(f => freq.set(f, (freq.get(f) || 0) + 1));
  });
  const room = PUA_LAST - PUA_FIRST + 1;
  const dict = [...freq.entries()].filter(e => e[0].length >= 3 && e[1] >= 2 && e[1] * (e[0].length - 1) > e[0].length + 6)
    .sort((a, b) => b[1] * (b[0].length - 1) - a[1] * (a[0].length - 1) || (a[0] < b[0] ? -1 : 1)).slice(0, room).map(e => e[0]);
  const idx = new Map(dict.map((f, i) => [f, String.fromCharCode(PUA_FIRST + i)]));
  const packed = {};
  keys.forEach(k => {
    const t = toks[k];
    let out = '';
    t.frags.forEach((f, i) => { out += idx.has(f) ? idx.get(f) : f; if (i < t.nums.length) out += t.nums[i]; });
    packed[k] = out;
  });
  return { dict: dict, packed: packed };
}

function unpack(dict, s) { return s.replace(/[-]/g, c => dict[c.charCodeAt(0) - PUA_FIRST]); }

/* the page's own unpack, as source text (the same replace) */
const UNPACK_JS = 'function unpack(s){ return s.replace(/[\\uE000-\\uF8FF]/g, function(c){ return DICT[c.charCodeAt(0) - 0xE000]; }); }';

module.exports = { hoistDefs, pack, unpack, tokenize, UNPACK_JS };
