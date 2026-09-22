/* ============================================================================
   PPP ScoreGraph — a minimal XML reader and writer (docs/GOALS/G01 §19 R8)

   parse(text) -> {root}: elements as {name, attrs, kids, text}. `kids` are the
   child elements in order; `text` is the element's own character data (CDATA
   included), untrimmed. Comments and processing instructions are skipped.

   Safe by construction: a DOCTYPE is skipped, never interpreted (no internal
   subset, no external entity); only the five predefined entities and numeric
   character references are expanded, anything else is an error.

   esc(text) and attr(text) escape for writing.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { const M = root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}; M.xml = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  class XmlError extends Error {
    constructor(message, pos) { super('bad-xml: ' + message + (pos != null ? ' at offset ' + pos : '')); this.name = 'XmlError'; this.code = 'bad-xml'; }
  }
  const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  const NAME_RE = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;

  function decode(s, pos) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&([^;&\s]*);?/g, (m, name, off) => {
      if (!m.endsWith(';')) throw new XmlError('unterminated character reference', pos + off);
      if (name[0] === '#') {
        const cp = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        if (!isFinite(cp) || cp < 0 || cp > 0x10FFFF) throw new XmlError('bad character reference &' + name + ';', pos + off);
        return String.fromCodePoint(cp);
      }
      if (!Object.prototype.hasOwnProperty.call(ENTITIES, name)) throw new XmlError('unknown entity &' + name + '; (only predefined entities are read)', pos + off);
      return ENTITIES[name];
    });
  }

  function parse(text) {
    if (typeof text !== 'string') throw new XmlError('input is not text');
    let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
    const n = text.length;
    const stack = [];
    let root = null;
    const top = () => stack[stack.length - 1];
    function readName() {
      NAME_RE.lastIndex = i;
      const m = NAME_RE.exec(text);
      if (!m) throw new XmlError('expected a name', i);
      i += m[0].length;
      return m[0];
    }
    const skipWs = () => { while (i < n && /\s/.test(text[i])) i++; };
    while (i < n) {
      const lt = text.indexOf('<', i);
      if (lt < 0) {
        const rest = text.slice(i);
        if (stack.length) top().text += decode(rest, i);
        else if (rest.trim()) throw new XmlError('text outside the root element', i);
        break;
      }
      if (lt > i) {
        const chunk = text.slice(i, lt);
        if (stack.length) top().text += decode(chunk, i);
        else if (chunk.trim()) throw new XmlError('text outside the root element', i);
      }
      i = lt;
      if (text.startsWith('<!--', i)) {
        const e = text.indexOf('-->', i + 4);
        if (e < 0) throw new XmlError('unterminated comment', i);
        i = e + 3;
      } else if (text.startsWith('<![CDATA[', i)) {
        const e = text.indexOf(']]>', i + 9);
        if (e < 0) throw new XmlError('unterminated CDATA', i);
        if (!stack.length) throw new XmlError('CDATA outside the root element', i);
        top().text += text.slice(i + 9, e);
        i = e + 3;
      } else if (text.startsWith('<?', i)) {
        const e = text.indexOf('?>', i + 2);
        if (e < 0) throw new XmlError('unterminated processing instruction', i);
        i = e + 2;
      } else if (text.startsWith('<!DOCTYPE', i) || text.startsWith('<!doctype', i)) {
        /* skipped, never interpreted: an internal subset in [...] is jumped over as a whole */
        let depth = 0, j = i + 9;
        for (; j < n; j++) {
          const ch = text[j];
          if (ch === '"' || ch === "'") { const q = text.indexOf(ch, j + 1); if (q < 0) break; j = q; }
          else if (ch === '[') depth++;
          else if (ch === ']') depth--;
          else if (ch === '>' && depth <= 0) break;
        }
        if (j >= n) throw new XmlError('unterminated DOCTYPE', i);
        i = j + 1;
      } else if (text[i + 1] === '/') {
        i += 2;
        const name = readName();
        skipWs();
        if (text[i] !== '>') throw new XmlError('expected > after </' + name, i);
        i++;
        const el = stack.pop();
        if (!el || el.name !== name) throw new XmlError('</' + name + '> does not close <' + (el ? el.name : '') + '>', i);
      } else {
        i++;
        const name = readName();
        const el = { name: name, attrs: {}, kids: [], text: '' };
        for (;;) {
          skipWs();
          if (text[i] === '/' && text[i + 1] === '>') { i += 2; break; }
          if (text[i] === '>') { i++; stack.push(el); break; }
          if (i >= n) throw new XmlError('unterminated tag <' + name, i);
          const an = readName();
          skipWs();
          if (text[i] !== '=') throw new XmlError('expected = after attribute ' + an, i);
          i++;
          skipWs();
          const q = text[i];
          if (q !== '"' && q !== "'") throw new XmlError('attribute ' + an + ' is not quoted', i);
          const e = text.indexOf(q, i + 1);
          if (e < 0) throw new XmlError('unterminated attribute ' + an, i);
          if (Object.prototype.hasOwnProperty.call(el.attrs, an)) throw new XmlError('duplicate attribute ' + an, i);
          el.attrs[an] = decode(text.slice(i + 1, e), i + 1);
          i = e + 1;
        }
        const parent = stack.length ? (el === top() ? stack[stack.length - 2] : top()) : null;
        if (parent) parent.kids.push(el);
        else if (!root) root = el;
        else throw new XmlError('a second root element <' + name + '>', i);
      }
    }
    if (stack.length) throw new XmlError('<' + top().name + '> is not closed');
    if (!root) throw new XmlError('no root element');
    return { root: root };
  }

  /* Strip a namespace prefix ("x:note" -> "note") from every element name, in place. */
  function localNames(el) {
    const c = el.name.indexOf(':');
    if (c >= 0) el.name = el.name.slice(c + 1);
    el.kids.forEach(localNames);
    return el;
  }

  const esc = s => String(s).replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
  const attr = s => String(s).replace(/[&<>"]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));

  return Object.freeze({ XmlError, parse, localNames, esc, attr });
});
