/* Open Hymnal ABC (two-staff SATB piano setting) -> score-partwise MusicXML.
   Voices S1/S1V1+S1V2 become the right hand; S2/S2V1+S2V2 the left. */
'use strict';

const KEY_FIFTHS = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7
};

// Key signature -> default alteration per pitch letter, same table as
// tests/bench/pppbench/metrics/readability.py `signature_alters`.
const SHARP_ORDER = 'FCGDAEB';

function signatureAlters(fifths) {
  const alters = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) {
    for (let i = 0; i < fifths && i < SHARP_ORDER.length; i++) alters[SHARP_ORDER[i]] = 1;
  } else if (fifths < 0) {
    const order = SHARP_ORDER.split('').reverse();
    for (let i = 0; i < -fifths && i < order.length; i++) alters[order[i]] = -1;
  }
  return alters;
}

function xmlEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[c]));
}

function headerField(text, letter) {
  const re = new RegExp('^' + letter + ':\\s*(.*)$', 'm');
  const m = re.exec(text);
  return m ? m[1].trim() : '';
}

function parseKey(k) {
  const raw = String(k || 'C').split('%')[0].trim();
  const m = /^(C#|F#|Bb|Eb|Ab|Db|Gb|Cb|[A-G])\s*(m|min|minor)?/i.exec(raw);
  if (!m) return { fifths: 0, mode: 'major' };
  const tonic = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  const minor = !!(m[2]);
  let fifths = KEY_FIFTHS[tonic];
  if (fifths == null) fifths = 0;
  if (minor) fifths -= 3;
  return { fifths: fifths, mode: minor ? 'minor' : 'major' };
}

function parseMeter(m) {
  const raw = String(m || '4/4').split('%')[0].trim();
  if (/^c/i.test(raw)) return { beats: 4, beatType: 4 };
  const p = /^(\d+)\s*\/\s*(\d+)/.exec(raw);
  return p ? { beats: +p[1], beatType: +p[2] } : { beats: 4, beatType: 4 };
}

function parseL(l) {
  const raw = String(l || '1/8').split('%')[0].trim();
  const p = /^(\d+)\s*\/\s*(\d+)/.exec(raw);
  if (!p) return 0.5;
  return (+p[1] / +p[2]) * 4;
}

function parseTempo(text) {
  const m = /\[Q:\s*(\d+)\s*\/\s*(\d+)\s*=\s*(\d+)/.exec(text)
    || /Q:\s*(\d+)\s*\/\s*(\d+)\s*=\s*(\d+)/.exec(text);
  if (!m) return 92;
  const unitQ = (+m[1] / +m[2]) * 4;
  return Math.round((+m[3]) * unitQ);
}

function typeDots(q) {
  const table = [
    [4, 'whole', 0], [3, 'half', 1], [2, 'half', 0], [1.5, 'quarter', 1],
    [1, 'quarter', 0], [0.75, 'eighth', 1], [0.5, 'eighth', 0],
    [0.375, '16th', 1], [0.25, '16th', 0], [0.125, '32nd', 0]
  ];
  for (let i = 0; i < table.length; i++) {
    if (q >= table[i][0] - 1e-6) return { type: table[i][1], dots: table[i][2] };
  }
  return { type: '32nd', dots: 0 };
}

function skipSpace(s, i) {
  while (i < s.length) {
    const c = s[i];
    if (c === '%' && (i === 0 || s[i - 1] === '\n' || s[i - 1] === '\r')) {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '`') { i++; continue; }
    break;
  }
  return i;
}

function parseLength(s, i, defQ) {
  let num = null, den = null;
  if (i < s.length && s[i] >= '0' && s[i] <= '9') {
    num = 0;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') num = num * 10 + (s.charCodeAt(i++) - 48);
  }
  while (s[i] === '/') {
    i++;
    let d = 0, saw = false;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') {
      saw = true;
      d = d * 10 + (s.charCodeAt(i++) - 48);
    }
    den = (den || 1) * (saw ? d : 2);
  }
  if (num == null && den == null) return { q: defQ, i: i };
  if (num == null) num = 1;
  if (den == null) den = 1;
  return { q: defQ * num / den, i: i };
}

function parsePitch(s, i) {
  let acc = null;
  if (s[i] === '^') {
    acc = 1; i++;
    if (s[i] === '^') { acc = 2; i++; }
  } else if (s[i] === '_') {
    acc = -1; i++;
    if (s[i] === '_') { acc = -2; i++; }
  } else if (s[i] === '=') { acc = 0; i++; }
  const ch = s[i];
  if (!ch || !/[A-Ga-g]/.test(ch)) return null;
  i++;
  const upper = ch === ch.toUpperCase();
  const step = ch.toUpperCase();
  let oct = upper ? 4 : 5;
  while (s[i] === ',') { oct--; i++; }
  while (s[i] === "'") { oct++; i++; }
  return { step: step, octave: oct, alter: acc, i: i };
}

function parseNoteGroup(s, i, defQ) {
  i = skipSpace(s, i);
  if (i >= s.length) return null;
  if (s[i] === 'z' || s[i] === 'x' || s[i] === 'Z') {
    const restCh = s[i++];
    if (restCh === 'Z') {
      const n = parseLength(s, i, 1);
      return { rest: true, pitches: [], q: (n.q || 1) * 4, i: n.i, barSkip: true };
    }
    const n = parseLength(s, i, defQ);
    return { rest: true, pitches: [], q: n.q, i: n.i };
  }
  const pitches = [];
  if (s[i] === '[') {
    i++;
    while (i < s.length && s[i] !== ']') {
      i = skipSpace(s, i);
      if (s[i] === ']') break;
      const p = parsePitch(s, i);
      if (!p) { i++; continue; }
      i = p.i;
      const ln = parseLength(s, i, defQ);
      i = ln.i;
      pitches.push({ step: p.step, octave: p.octave, alter: p.alter, explicit: p.alter !== null, q: ln.q });
    }
    if (s[i] === ']') i++;
    const outer = parseLength(s, i, null);
    if (outer.q != null) {
      pitches.forEach(p => { p.q = outer.q; });
      i = outer.i;
    }
  } else {
    const p = parsePitch(s, i);
    if (!p) return null;
    i = p.i;
    const ln = parseLength(s, i, defQ);
    i = ln.i;
    pitches.push({ step: p.step, octave: p.octave, alter: p.alter, explicit: p.alter !== null, q: ln.q });
  }
  let tie = false;
  i = skipSpace(s, i);
  if (s[i] === '-') { tie = true; i++; }
  const q = pitches.length ? pitches[0].q : defQ;
  return { rest: false, pitches: pitches, q: q, tie: tie, i: i };
}

function isBar(s, i) {
  return s[i] === '|' || (s[i] === ':' && s[i + 1] === '|') || (s[i] === ':' && s[i + 1] === ':');
}

function skipBar(s, i) {
  if (s[i] === ':') i++;
  if (s[i] === '|') {
    i++;
    while (s[i] === '|' || s[i] === ']' || s[i] === ':' || s[i] === '[' ) i++;
    if (s[i] === '1' || s[i] === '2') {
      while (i < s.length && s[i] !== '|' && s[i] !== ' ' && s[i] !== '\n') i++;
    }
  }
  return i;
}

function skipDecoration(s, i) {
  if (s[i] === '!') {
    i++;
    while (i < s.length && s[i] !== '!' && s[i] !== '\n') i++;
    if (s[i] === '!') i++;
    return i;
  }
  if (s[i] === '"') {
    i++;
    while (i < s.length && s[i] !== '"') i++;
    if (s[i] === '"') i++;
    return i;
  }
  if (s[i] === '{') {
    i++;
    while (i < s.length && s[i] !== '}') i++;
    if (s[i] === '}') i++;
    return i;
  }
  if (s[i] === '(' && /[0-9]/.test(s[i + 1] || '')) {
    i++;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    if (s[i] === ':') {
      i++;
      while (i < s.length && (s[i] >= '0' && s[i] <= '9' || s[i] === ':')) i++;
    }
    return i;
  }
  if (s[i] === '(' || s[i] === ')') return i + 1;
  if (s[i] === '>' || s[i] === '<' || s[i] === '.' || s[i] === '~' || s[i] === 'v' || s[i] === 'u' || s[i] === 'H' || s[i] === 'T' || s[i] === 'P') return i + 1;
  return i;
}

function parseVoiceMeasures(music, defQ) {
  const measures = [];
  let cur = [];
  let i = 0;
  const s = music;
  while (i < s.length) {
    i = skipSpace(s, i);
    if (i >= s.length) break;
    if (s[i] === '[') {
      const peek = s.slice(i, i + 8);
      if (/^\[V:/i.test(peek) || /^\[Q:/i.test(peek) || /^\[M:/i.test(peek) || /^\[K:/i.test(peek) || /^\[I:/i.test(peek)) {
        const close = s.indexOf(']', i);
        i = close < 0 ? s.length : close + 1;
        continue;
      }
      if (/^\[\d/.test(peek)) {
        const close = s.indexOf(']', i);
        i = close < 0 ? s.length : close + 1;
        continue;
      }
    }
    if (isBar(s, i)) {
      measures.push(cur);
      cur = [];
      i = skipBar(s, i);
      continue;
    }
    const next = skipDecoration(s, i);
    if (next !== i) { i = next; continue; }
    const n = parseNoteGroup(s, i, defQ);
    if (!n) { i++; continue; }
    if (n.barSkip) { i = n.i; continue; }
    cur.push(n);
    i = n.i;
  }
  if (cur.length) measures.push(cur);
  while (measures.length && !measures[0].length) measures.shift();
  while (measures.length && !measures[measures.length - 1].length) measures.pop();
  return measures;
}

function collectVoices(text) {
  const bodies = {};
  const re = /\[V:\s*([^\]]+)\]/g;
  const hits = [];
  let m;
  while ((m = re.exec(text))) {
    hits.push({ name: m[1].trim().split(/\s+/)[0], start: m.index + m[0].length, tag: m.index });
  }
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].tag : text.length;
    let chunk = text.slice(hits[i].start, end);
    chunk = chunk.replace(/^[wW]:.*$/gm, '');
    bodies[hits[i].name] = (bodies[hits[i].name] || '') + ' ' + chunk;
  }
  if (!Object.keys(bodies).length) {
    const k = text.lastIndexOf('\nK:');
    const rest = k >= 0 ? text.slice(text.indexOf('\n', k) + 1) : text;
    bodies.S1 = rest.replace(/^[wW]:.*$/gm, '');
  }
  return bodies;
}

function staffOf(name, names) {
  if (/^S2/i.test(name) || /bass/i.test(name)) return 2;
  if (/^S1/i.test(name) || /treble/i.test(name)) return 1;
  const i = names.indexOf(name);
  return i < Math.ceil(names.length / 2) ? 1 : 2;
}

function toMusicXml(abcText, opts) {
  opts = opts || {};
  const title = opts.title || headerField(abcText, 'T') || 'Untitled';
  const composerLine = (abcText.match(/^C:.*Music:.*/m) || abcText.match(/^C:.*/m) || [''])[0];
  const composer = opts.composer || composerLine.replace(/^C:\s*/, '').replace(/\s+/g, ' ').slice(0, 160);
  const meter = parseMeter(headerField(abcText, 'M'));
  const key = parseKey(headerField(abcText, 'K'));
  const defQ = parseL(headerField(abcText, 'L') || '1/8');
  const tempo = opts.tempo || parseTempo(abcText);
  const voices = collectVoices(abcText);
  const names = Object.keys(voices);
  if (!names.length) throw new Error('no voices');
  const parsed = {};
  let maxBars = 0;
  names.forEach(n => {
    parsed[n] = parseVoiceMeasures(voices[n], defQ);
    maxBars = Math.max(maxBars, parsed[n].length);
  });
  if (!maxBars) throw new Error('no measures');

  const byStaff = { 1: [], 2: [] };
  names.forEach(n => {
    const st = staffOf(n, names);
    byStaff[st].push(n);
  });
  if (!byStaff[1].length) byStaff[1] = names.slice(0, 1);
  if (!byStaff[2].length) byStaff[2] = names.slice(-1);

  // Apply the key signature's default alteration to notes with no explicit ABC accidental, and
  // carry an explicit accidental for the rest of its bar (same pitch letter+octave, same staff,
  // across every voice on that staff) - the fix for key_signature_playback and
  // bar_accidental_not_carried (docs/PPP_MASTER_ROADMAP.md MX-2).
  const sig = signatureAlters(key.fifths);
  for (let mi = 0; mi < maxBars; mi++) {
    [1, 2].forEach(st => {
      const entries = [];
      byStaff[st].forEach(name => {
        let local = 0;
        (parsed[name][mi] || []).forEach(group => {
          if (!group.rest) {
            group.pitches.forEach(p => entries.push({ onset: local, step: p.step, octave: p.octave, pitchRef: p }));
          }
          local += group.q;
        });
      });
      entries.sort((a, b) => a.onset - b.onset);
      const state = {};
      entries.forEach(e => {
        const key2 = e.step + '|' + e.octave;
        let finalAlter, printAccidental;
        if (e.pitchRef.explicit) {
          finalAlter = e.pitchRef.alter;
          printAccidental = true;
          state[key2] = finalAlter;
        } else if (key2 in state) {
          finalAlter = state[key2];
          printAccidental = false;
        } else {
          finalAlter = sig[e.step] || 0;
          printAccidental = false;
        }
        e.pitchRef.alter = finalAlter;
        e.pitchRef.printAccidental = printAccidental;
      });
    });
  }

  // Write a matching tie stop (sounding <tie> and printed <notations><tied>) on the note that
  // continues a tie: the next note-group of the same voice, matched pitch by pitch letter+octave -
  // the fix for tie_without_stop. A tied note must sound the same pitch as the note it continues,
  // so its alter is forced to match (overriding the key-signature/carry pass above) and it prints
  // no accidental of its own.
  names.forEach(name => {
    let pending = null;
    for (let mi = 0; mi < maxBars; mi++) {
      (parsed[name][mi] || []).forEach(group => {
        if (group.rest) { pending = null; return; }
        if (pending && pending.length) {
          group.pitches.forEach(p => {
            const match = pending.find(pp => !pp.used && pp.step === p.step && pp.octave === p.octave);
            if (match) {
              match.used = true;
              p.tieStop = true;
              p.alter = match.pitchRef.alter;
              p.printAccidental = false;
            }
          });
        }
        pending = group.tie ? group.pitches.map(p => ({ step: p.step, octave: p.octave, pitchRef: p, used: false })) : null;
      });
    }
  });

  const DIV = 24;
  const qToDur = q => Math.max(1, Math.round(q * DIV));
  const barQ = (meter.beats * 4) / meter.beatType;

  function emitNote(n, staff, voice, chord) {
    const td = typeDots(n.q);
    const dur = qToDur(n.q);
    if (n.rest || !n.pitches.length) {
      return '<note>' + (chord ? '<chord/>' : '') + '<rest/>'
        + '<duration>' + dur + '</duration><voice>' + voice + '</voice>'
        + '<type>' + td.type + '</type>' + (td.dots ? '<dot/>'.repeat(td.dots) : '')
        + '<staff>' + staff + '</staff></note>';
    }
    return n.pitches.map((p, pi) => {
      const acc = !p.printAccidental ? '' : (
        p.alter === 1 ? '<accidental>sharp</accidental>'
        : p.alter === 2 ? '<accidental>double-sharp</accidental>'
        : p.alter === -1 ? '<accidental>flat</accidental>'
        : p.alter === -2 ? '<accidental>flat-flat</accidental>'
        : '<accidental>natural</accidental>'
      );
      const alter = p.alter ? '<alter>' + p.alter + '</alter>' : '';
      const tieStop = p.tieStop ? '<tie type="stop"/>' : '';
      const tieStart = n.tie ? '<tie type="start"/>' : '';
      const tiedStop = p.tieStop ? '<tied type="stop"/>' : '';
      const tiedStart = n.tie ? '<tied type="start"/>' : '';
      const notations = (tiedStop || tiedStart) ? '<notations>' + tiedStop + tiedStart + '</notations>' : '';
      return '<note>' + ((chord || pi > 0) ? '<chord/>' : '')
        + '<pitch><step>' + p.step + '</step>' + alter + '<octave>' + p.octave + '</octave></pitch>'
        + '<duration>' + dur + '</duration>' + tieStop + tieStart
        + '<voice>' + voice + '</voice><type>' + td.type + '</type>'
        + (td.dots ? '<dot/>'.repeat(td.dots) : '') + acc
        + '<staff>' + staff + '</staff>' + notations + '</note>';
    }).join('');
  }

  let xml = '';
  xml += '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<score-partwise version="3.1">\n';
  xml += '  <work><work-title>' + xmlEsc(title) + '</work-title></work>\n';
  xml += '  <identification><creator type="composer">' + xmlEsc(composer || 'Traditional') + '</creator>\n';
  xml += '    <encoding><software>PPP Open Hymnal piano reduction</software></encoding>\n';
  xml += '  </identification>\n';
  xml += '  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>\n';
  xml += '  <part id="P1">\n';

  for (let mi = 0; mi < maxBars; mi++) {
    const num = mi + 1;
    xml += '    <measure number="' + num + '"' + (mi === 0 ? ' implicit="yes"' : '') + '>\n';
    if (mi === 0) {
      xml += '      <attributes><divisions>' + DIV + '</divisions>';
      xml += '<key><fifths>' + key.fifths + '</fifths><mode>' + key.mode + '</mode></key>';
      xml += '<time><beats>' + meter.beats + '</beats><beat-type>' + meter.beatType + '</beat-type></time>';
      xml += '<staves>2</staves>';
      xml += '<clef number="1"><sign>G</sign><line>2</line></clef>';
      xml += '<clef number="2"><sign>F</sign><line>4</line></clef>';
      xml += '</attributes>\n';
      xml += '      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>'
        + tempo + '</per-minute></metronome></direction-type><sound tempo="' + tempo + '"/></direction>\n';
    }
    const streams = [];
    byStaff[1].forEach((name, vi) => {
      streams.push({ staff: 1, voice: vi + 1, notes: (parsed[name][mi] || []) });
    });
    byStaff[2].forEach((name, vi) => {
      streams.push({ staff: 2, voice: 5 + vi, notes: (parsed[name][mi] || []) });
    });
    streams.forEach((st, si) => {
      if (si > 0) {
        const prev = streams[si - 1];
        const prevQ = prev.notes.reduce((a, n) => a + n.q, 0);
        if (prevQ > 0) xml += '      <backup><duration>' + qToDur(prevQ) + '</duration></backup>\n';
      }
      if (!st.notes.length) {
        xml += '      ' + emitNote({ rest: true, pitches: [], q: barQ }, st.staff, st.voice, false) + '\n';
        return;
      }
      st.notes.forEach(n => {
        xml += '      ' + emitNote(n, st.staff, st.voice, false) + '\n';
      });
    });
    xml += '    </measure>\n';
  }
  xml += '  </part>\n</score-partwise>\n';
  return xml;
}

module.exports = { toMusicXml, parseKey, parseMeter, collectVoices, parseVoiceMeasures, signatureAlters };
