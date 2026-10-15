/* ============================================================================
   PPP OMR bar editor: the sheet (docs/GOALS/G12_OMR.md section 9.2, phase G12-4)

   A bottom sheet over the review screen, built for a thumb: one bar enlarged, the reason it was marked, a toolbar for the note that is selected, tools for the bar,
   undo and redo. It is plain DOM (no React): the page asks for it when a person taps a bar of a recognised score and it does nothing until then. Everything it
   changes goes through the session (omr/editor.js), which changes the graph only by the ops of omr/edit-ops.js and keeps the steps for undo.

     open({ document, session, host, measure }) -> controller
       session   a PPPOmrEditor session
       host      { tx, engrave (window.PPPEngrave), flags (window.PPPOmrFlags), onChange(info), onClose(), onBar(number), say(text), play(number), pageCrop(number) }
                 onChange is called after the sheet has drawn a change (a step, an undo, a redo, a discard): { graph, kind, op, measures, focus }; the page makes the
                 Score of that graph (toScore) and draws it, saves the song, and checks the bars again - never the other way round
       controller.go(measureNumberOrId), .close(), .refresh(), .state, .el

   Touch: every button is 44 px or more; the bar is tapped anywhere near a note to select it (the nearest note of the staff), a tap on an empty place of a staff puts a
   note there when "add notes" is on. Nothing is made by a gesture that cannot be undone with one tap.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./editor.js'), null);
  else root.PPPOmrEditorUI = factory(root.PPPOmrEditor, root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ED, browser) {
  'use strict';
  const VERSION = 1;
  const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const VALUES = ['whole', 'half', 'quarter', 'eighth', '16th'];
  const TIMES = [[2, 4], [3, 4], [4, 4], [6, 8], [9, 8], [12, 8], [2, 2], [3, 8]];
  const KEY_NAMES = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
  const STYLE_ID = 'ppp-omr-editor-style';

  const CSS = [
    '.ppp-edit{position:fixed;left:0;right:0;bottom:0;z-index:56;margin:0 auto;width:100%;max-width:680px;max-height:84vh;display:flex;flex-direction:column;box-sizing:border-box;',
    'background:var(--surface,#fff);color:var(--ink,#222);border:1px solid var(--line,#ddd);border-bottom:0;border-radius:18px 18px 0 0;box-shadow:0 -10px 30px rgba(20,18,16,.22);',
    'font-family:inherit;font-size:14px;line-height:1.45;padding:0 14px}',
    '.ppp-edit *{box-sizing:border-box}',
    '.ppp-edit-body{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding-bottom:8px}',
    '.ppp-edit-head{flex:none;display:flex;align-items:center;gap:6px;padding:8px 0 6px}',
    '.ppp-edit-title{flex:1;min-width:0;text-align:center;font-weight:650}',
    '.ppp-edit-title small{display:block;font-weight:400;font-size:12px;color:var(--ink3,#777)}',
    '.ppp-edit button{font-family:inherit;font-size:14px;color:var(--ink,#222);background:var(--bg,#f6f6f6);border:1px solid var(--line,#ddd);border-radius:11px;min-height:44px;min-width:44px;',
    'padding:0 12px;cursor:pointer;touch-action:manipulation}',
    '.ppp-edit button:disabled{opacity:.4;cursor:default}',
    '.ppp-edit button[aria-pressed=true],.ppp-edit button.on{background:var(--accent,#6048dc);border-color:var(--accent,#6048dc);color:#fff}',
    '.ppp-edit button.primary{background:var(--accent,#6048dc);border-color:var(--accent,#6048dc);color:#fff;font-weight:600}',
    '.ppp-edit button.warn{border-color:var(--bad,#c33);color:var(--bad,#c33)}',
    '.ppp-edit-why{margin:2px 0 6px;padding:7px 10px;border-radius:10px;background:var(--bg,#f6f6f6);border:1px solid var(--line,#ddd);font-size:13px;color:var(--ink2,#444)}',
    '.ppp-edit-why.bad{border-color:var(--bad,#c33)}',
    '.ppp-edit-why.good{border-color:var(--good,#2a8)}',
    '.ppp-edit-stage{overflow-x:auto;border:1px solid var(--line,#ddd);border-radius:12px;background:var(--paper,#fff);padding:6px 4px;min-height:96px;touch-action:pan-x pan-y}',
    '.ppp-edit-stage svg{display:block;color:var(--paper-ink,var(--ink,#222));margin:0 auto}',
    '.ppp-edit-stage .ppp-edit-sel{color:var(--accent,#6048dc)}',
    '.ppp-edit-stage .ppp-edit-sel *{stroke-width:inherit}',
    '.ppp-edit-fill{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}',
    '.ppp-edit-chip{display:inline-flex;align-items:center;min-height:32px;padding:0 10px;border-radius:999px;border:1px solid var(--line,#ddd);background:var(--bg,#f6f6f6);font-size:12.5px}',
    '.ppp-edit-chip.bad{border-color:var(--bad,#c33);color:var(--bad,#c33)}',
    '.ppp-edit-chip.good{border-color:var(--good,#2a8)}',
    '.ppp-edit-row{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}',
    '.ppp-edit-row>button{flex:1 1 auto}',
    '.ppp-edit-label{margin:10px 0 2px;font-size:12px;font-weight:650;color:var(--ink3,#777)}',
    '.ppp-edit-hint{margin:6px 0;font-size:13px;color:var(--ink3,#777)}',
    '.ppp-edit-msg{margin:6px 0;padding:8px 10px;border-radius:10px;border:1px solid var(--bad,#c33);color:var(--bad,#c33);background:var(--bg,#f6f6f6);font-size:13px}',
    '.ppp-edit-foot{flex:none;padding:6px 0 10px;border-top:1px solid var(--line,#ddd)}',
    '.ppp-edit-row>button{min-width:0;white-space:normal;line-height:1.25;font-size:13.5px}',
    '@media (min-width:721px){.ppp-edit{left:auto;right:16px;bottom:16px;width:460px;max-height:86vh;border:1px solid var(--line,#ddd);border-radius:18px}}'
  ].join('');

  const plain = (s, v) => String(s).replace(/\{\{(\w+)\}\}/g, (m, k) => (v && v[k] !== undefined ? v[k] : m));
  const beats = r => { const m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(r)); return m ? (+m[1]) / (m[2] ? +m[2] : 1) * 4 : 0; };
  const fmtBeats = x => String(Math.round(x * 100) / 100).replace(/\.0+$/, '');

  function open(opts) {
    const doc = opts.document || (browser && browser.document);
    const win = opts.window || (browser && browser.window) || (doc && doc.defaultView) || null;
    const session = opts.session, host = opts.host || {};
    const tx = typeof host.tx === 'function' ? host.tx : plain;
    if (!doc || !session) throw new Error('the editor sheet needs a document and a session');

    if (!doc.getElementById(STYLE_ID)) {
      const st = doc.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(st);
    }
    const h = (tag, attrs, kids) => {
      const el = doc.createElement(tag);
      Object.keys(attrs || {}).forEach(k => {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      });
      (kids || []).forEach(c => { if (c) el.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
      return el;
    };
    const btn = (act, label, fn, o) => {
      o = o || {};
      return h('button', { type: 'button', 'data-act': act, class: o.cls || '', disabled: o.disabled, title: o.title || label, 'aria-label': o.aria || label, 'aria-pressed': o.pressed === undefined ? undefined : String(!!o.pressed), onclick: fn }, [label]);
    };

    const state = { bar: null, sel: null, head: null, add: false, value: 'quarter', tools: false, msg: null, detail: null, split: false, time: false, clef: false, stave: false };
    /* the bar the person was on before each step (aligned with the session's steps), so that an undo lands where the step was made and a redo where it was */
    const trail = [], redoTrail = [];
    const root = h('div', { class: 'ppp-edit', role: 'dialog', 'aria-modal': 'false', 'aria-label': tx('Fix measures'), 'data-omr-editor': '1' });
    let stage = null, svg = null, geometry = null, closed = false, padBefore = null, body = null;
    /* what the drawing of the bar was made from: the same graph and bar is not drawn again when only the words around it change */
    let painted = null, keepStage = null;
    (doc.body || doc.documentElement).appendChild(root);

    /* ---------------------------------------------------------------- what is on the graph now */
    const graph = () => session.graph;
    const measures = () => graph().timeline.measures;
    const idxOf = id => measures().findIndex(m => m.id === id);
    const numberOf = (m, i) => { const n = parseInt(m.number, 10); return isFinite(n) ? n : i + 1; };
    const barInfo = quick => session.bars({ flags: host.flags, quick: !!quick, hint: host.hint || null });
    function resolveBar(x) {
      const ms = measures();
      if (typeof x === 'string' && ms.some(m => m.id === x)) return x;
      if (typeof x === 'number') { const i = ms.findIndex((m, k) => numberOf(m, k) === x); if (i >= 0) return ms[i].id; }
      return null;
    }
    const staffIds = () => { const out = []; graph().parts.forEach(p => p.staves.forEach(s => out.push(s.id))); return out; };
    const handName = idx => {
      const n = staffIds().length;
      if (n === 2) return idx === 0 ? tx('Right hand') : tx('Left hand');
      return idx === 0 ? tx('Right hand') : tx('Staff {{n}}', { n: idx + 1 });
    };

    function errorText(code) {
      switch (code) {
        case 'in-tuplet': return tx('This note is part of a triplet or another tuplet, which cannot be changed here.');
        case 'no-room': return tx('There is no room: the next note is in the way, or the measure ends.');
        case 'too-short': return tx('That is the shortest note PPP writes.');
        case 'unprintable': return tx('That length cannot be written as one note.');
        case 'would-cut': return tx('A note would be cut off. Shorten or remove it first.');
        case 'last-bar': return tx('The only measure cannot be deleted.');
        case 'meter-differs': return tx('The two measures have different time signatures, so they cannot be joined.');
        case 'same-staff': return tx('The note is already on that staff.');
        case 'out-of-range': return tx('That note would be outside the piano.');
        case 'occupied': return tx('There is no free place for a note there.');
        case 'invalid': return tx('That change would break the score, so it was not made.');
        case 'nothing': return tx('There is nothing more to undo or redo.');
        default: return tx('That part of the score is no longer there.');
      }
    }

    /* ---------------------------------------------------------------- the bar */
    function widthFor(w) {
      const cols = new Set();
      w.parts.forEach(p => p.events.forEach(e => cols.add(e.at)));
      return Math.max(30, Math.min(120, 14 + 5.4 * cols.size));
    }
    function paintBar() {
      if (!stage) return;
      geometry = null; svg = null;
      painted = { graph: graph(), bar: state.bar, add: state.add };
      const E = host.engrave;
      const w = ED.windowGraph(graph(), state.bar);
      if (!E || !E.layout || !E.svg || !w) { stage.textContent = tx('This measure could not be drawn.'); return; }
      try {
        const plan = E.plan(w, { marks: true, chords: true });
        const cfg = E.layout.normalizeConfig({ breakpoint: 'phone', width: widthFor(w), barsPerSystem: 1, window: null });
        const eng = E.layout.createEngraver(plan).layout(cfg);
        stage.innerHTML = E.svg(eng, plan, { unit: 10, px: 10, inline: true });
      } catch (e) { stage.textContent = tx('This measure could not be drawn.'); return; }
      svg = stage.querySelector('svg');
      if (!svg) return;
      const vb = (svg.getAttribute('viewBox') || '0 0 100 100').split(/\s+/).map(Number);
      /* the drawing is cropped to what is drawn (the engraver leaves a short last system its natural width), so that the bar fills the sheet */
      try {
        const bb = svg.getBBox();
        if (bb && bb.width > 0) { vb[2] = Math.ceil(bb.x + bb.width + 8); svg.setAttribute('viewBox', vb.join(' ')); }
      } catch (e) { /* not laid out: the page's own box */ }
      /* about 9 px to a staff space as a least, and the whole width of the sheet when that is wider */
      svg.removeAttribute('height');
      svg.removeAttribute('width');
      svg.style.width = '100%';
      svg.style.minWidth = Math.round(vb[2] * 0.9) + 'px';
      svg.style.maxWidth = Math.round(vb[2] * 2.2) + 'px';
      svg.style.height = 'auto';
      readGeometry();
      markSelection();
    }
    /* the staves of the drawing (lines' y in the drawing's units), the notes with their staff and the time they stand at */
    function readGeometry() {
      const staves = [];
      svg.querySelectorAll('g.ppp-stave').forEach(g => {
        const p = g.querySelector('path.vf-stave');
        if (!p) return;
        const ys = (p.getAttribute('d') || '').split('M').filter(Boolean).map(s => parseFloat(s.trim().split(/[ ,]/)[1]));
        if (ys.length < 2 || ys.some(v => !isFinite(v))) return;
        staves.push({ no: parseInt(g.getAttribute('data-staff'), 10) || staves.length + 1, top: ys[0], space: (ys[ys.length - 1] - ys[0]) / (ys.length - 1) });
      });
      staves.sort((a, b) => a.no - b.no);
      geometry = { staves: staves };
    }
    const noteGroups = () => (svg ? Array.from(svg.querySelectorAll('g.ppp-note')) : []);
    function markSelection() {
      noteGroups().forEach(g => g.classList.toggle('ppp-edit-sel', !!state.sel && g.getAttribute('data-ev') === state.sel));
    }
    function pointOf(ev) {
      try {
        const pt = svg.createSVGPoint();
        pt.x = ev.clientX; pt.y = ev.clientY;
        return pt.matrixTransform(svg.getScreenCTM().inverse());
      } catch (e) { return null; }
    }
    /* the pitch a place on a staff means: line 0 is the top line, each half space a step */
    function pitchAtY(staffIdx, y) {
      const st = geometry && geometry.staves[staffIdx];
      const ids = staffIds();
      if (!st || !ids[staffIdx]) return null;
      const info = ED.staffAt(graph(), state.bar, ids[staffIdx]);
      if (!info) return null;
      const half = Math.round((y - st.top) / (st.space / 2));
      const dpos = info.topDpos - half;
      return { step: STEPS[((dpos % 7) + 7) % 7], oct: Math.floor(dpos / 7), dpos: dpos };
    }
    function staffAtY(y) {
      if (!geometry || !geometry.staves.length) return -1;
      let best = 0, bd = Infinity;
      geometry.staves.forEach((s, i) => {
        const bottom = s.top + 4 * s.space;
        const d = y < s.top ? s.top - y : y > bottom ? y - bottom : 0;
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    }
    /* the note group nearest a point, within reach (a thumb is wider than a notehead) */
    function nearestNote(pt) {
      let best = null, bd = Infinity;
      noteGroups().forEach(g => {
        let b = null;
        try { b = g.getBBox(); } catch (e) { b = null; }
        if (!b) return;
        const pad = 9;
        const dx = pt.x < b.x - pad ? b.x - pad - pt.x : pt.x > b.x + b.width + pad ? pt.x - (b.x + b.width + pad) : 0;
        const dy = pt.y < b.y - pad ? b.y - pad - pt.y : pt.y > b.y + b.height + pad ? pt.y - (b.y + b.height + pad) : 0;
        const d = dx * dx + dy * dy * 0.5;
        if (d < bd) { bd = d; best = { g: g, b: b, d: d, dx: dx, dy: dy }; }
      });
      return best && Math.sqrt(best.d) <= 14 ? best : null;
    }
    function onTap(ev) {
      if (!svg) return;
      const pt = pointOf(ev);
      if (!pt) return;
      const near = nearestNote(pt);
      if (!state.add) {
        if (near) { select(near.g.getAttribute('data-ev'), pt); return; }
        state.sel = null; state.head = null;
        render();
        return;
      }
      /* adding: a tap on a note itself selects it; a tap anywhere else on a staff puts a note there */
      if (near && near.dx === 0 && near.dy === 0 && near.g.getAttribute('data-rest') !== '1') { select(near.g.getAttribute('data-ev'), pt); return; }
      const si = staffAtY(pt.y);
      const pitch = pitchAtY(si, pt.y);
      if (!pitch) return;
      addNoteAt(si, pitch, pt);
    }
    function select(evId, pt) {
      const d = ED.describe(graph(), evId);
      if (!d) return;
      state.sel = evId;
      state.msg = null;
      state.head = null;
      if (d.heads.length) {
        let pick = d.heads[0];
        if (pt && d.heads.length > 1 && geometry) {
          const si = Math.max(0, d.staffIndex >= 0 ? d.staffIndex : staffAtY(pt.y));
          const p = pitchAtY(si, pt.y);
          if (p) pick = d.heads.slice().sort((a, b) => Math.abs(ED.dposOf(a.pitch) - p.dpos) - Math.abs(ED.dposOf(b.pitch) - p.dpos))[0];
        }
        state.head = pick.id;
      }
      render();
    }
    function addNoteAt(si, pitch, pt) {
      const ids = staffIds();
      const staff = ids[si];
      if (!staff) return;
      /* the place: the nearest rest of that staff (by x), else the nearest note's place for a chord */
      const cands = [];
      noteGroups().forEach(g => {
        const on = (g.getAttribute('data-onset') || '').split('|');
        if ((parseInt(on[2], 10) || 1) !== si + 1) return;
        let b = null;
        try { b = g.getBBox(); } catch (e) { b = null; }
        if (!b) return;
        cands.push({ ev: g.getAttribute('data-ev'), rest: g.getAttribute('data-rest') === '1', cx: b.x + b.width / 2 });
      });
      const rests = cands.filter(c => c.rest).sort((a, b) => Math.abs(a.cx - pt.x) - Math.abs(b.cx - pt.x));
      const notes = cands.filter(c => !c.rest).sort((a, b) => Math.abs(a.cx - pt.x) - Math.abs(b.cx - pt.x));
      let target = rests[0] || null;
      if (notes[0] && (!target || Math.abs(notes[0].cx - pt.x) + 3 < Math.abs(target.cx - pt.x))) target = notes[0];
      if (!target) { say(tx('There is no free place for a note there.')); return; }
      const d = ED.describe(graph(), target.ev);
      if (!d) return;
      run({ op: 'add', measure: state.bar, staff: staff, at: d.at, pitch: { step: pitch.step, oct: pitch.oct }, value: state.value });
    }

    /* ---------------------------------------------------------------- doing things */
    function say(text) { state.msg = text; render(); }
    /* a change: through the session, then the sheet is drawn, then the page is told (the page's own drawing waits for the sheet's) */
    function run(cmd) {
      const r = session.apply(cmd);
      if (!r.ok) { state.msg = errorText(r.code); state.detail = r.detail ? [r.detail.code, r.detail.message].filter(Boolean).join(' ') : [r.code, r.message].filter(Boolean).join(' '); render(); return r; }
      if (!r.changed) { state.msg = null; render(); return r; }
      state.msg = null;
      trail.push(state.bar);
      redoTrail.length = 0;
      changed(r, 'apply');
      return r;
    }
    function changed(r, kind) {
      const f = r.focus || {};
      const target = f.measure && resolveBar(f.measure) ? f.measure : (resolveBar(state.bar) ? state.bar : (measures()[0] || {}).id);
      state.bar = target;
      const exists = id => id && graph().parts.some(p => p.events.some(e => e.id === id));
      state.sel = exists(f.event) ? f.event : (exists(state.sel) ? state.sel : null);
      const d = state.sel ? ED.describe(graph(), state.sel) : null;
      state.head = d && d.heads.length ? (d.heads.some(x => x.id === f.head) ? f.head : (d.heads.some(x => x.id === state.head) ? state.head : d.heads[0].id)) : null;
      render(true);
      notify(kind, r);
    }
    function notify(kind, r) {
      if (typeof host.onChange === 'function') {
        const info = { graph: graph(), kind: kind, op: r.op || null, measures: r.measures || [], focus: r.focus || null, bar: state.bar };
        const go = () => { try { host.onChange(info); } catch (e) { if (win && win.console) win.console.warn('[ppp] editor onChange', e && e.message); } };
        if (win && typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => win.setTimeout(go, 0)); else go();
      }
    }
    const undo = () => {
      const r = session.undo();
      if (!r.ok) { say(errorText(r.code)); return; }
      const was = trail.pop();
      redoTrail.push(state.bar);
      if (was && resolveBar(was)) r.focus = Object.assign({}, r.focus || {}, { measure: was });
      changed(r, 'undo');
    };
    const redo = () => {
      const r = session.redo();
      if (!r.ok) { say(errorText(r.code)); return; }
      const next = redoTrail.pop();
      trail.push(state.bar);
      changed(r, 'redo');
      void next;
    };
    const discard = () => { const r = session.discard(); if (r.changed) { trail.push(state.bar); redoTrail.length = 0; changed(r, 'discard'); } };
    function goBar(id) {
      const b = resolveBar(id);
      if (!b) return;
      state.bar = b; state.sel = null; state.head = null; state.msg = null; state.split = state.time = state.clef = false;
      render();
      if (typeof host.onBar === 'function') { const i = idxOf(b); try { host.onBar(numberOf(measures()[i], i), b); } catch (e) { /* the page's */ } }
    }
    const stepBar = by => { const i = idxOf(state.bar) + by; if (i >= 0 && i < measures().length) goBar(measures()[i].id); };
    function stepSuspect(by) {
      const bars = barInfo();
      const here = idxOf(state.bar);
      const list = bars.filter(b => b.suspect).map(b => b.index);
      if (!list.length) return;
      let to = by > 0 ? list.find(i => i > here) : list.slice().reverse().find(i => i < here);
      if (to === undefined) to = by > 0 ? list[0] : list[list.length - 1];
      goBar(measures()[to].id);
    }
    function close() {
      if (closed) return;
      closed = true;
      if (root.parentNode) root.parentNode.removeChild(root);
      if (padBefore !== null && doc.body) doc.body.style.paddingBottom = padBefore;
      if (typeof host.onClose === 'function') { try { host.onClose(); } catch (e) { /* the page's */ } }
    }

    /* ---------------------------------------------------------------- the sheet */
    /* quick: the bars' doubts as of the last check (the new check comes next, off the edit's own time) */
    function render(quick) {
      if (closed) return;
      const keepScroll = body ? body.scrollTop : 0;
      const ms = measures();
      const bi = idxOf(state.bar);
      const bars = barInfo(quick);
      /* the drawing stays when the graph and the bar are the same: the stage element is put back */
      keepStage = stage && painted && painted.graph === graph() && painted.bar === state.bar && svg ? stage : null;
      if (keepStage && keepStage.parentNode) keepStage.parentNode.removeChild(keepStage);
      const info = bars[bi] || { suspect: false, reasons: [], fill: [] };
      const suspectCount = bars.filter(b => b.suspect).length;
      const sel = state.sel ? ED.describe(graph(), state.sel) : null;
      const steps = session.steps;
      const FL = host.flags;
      root.textContent = '';
      stage = null;
      body = h('div', { class: 'ppp-edit-body' });

      /* header */
      root.appendChild(h('div', { class: 'ppp-edit-head' }, [
        btn('prev-bar', '‹', () => stepBar(-1), { disabled: bi <= 0, aria: tx('Previous measure') }),
        h('div', { class: 'ppp-edit-title', 'aria-live': 'polite' }, [
          tx('Measure {{n}} of {{total}}', { n: numberOf(ms[bi], bi), total: ms.length }),
          h('small', { text: suspectCount ? tx('{{n}} measures to check', { n: suspectCount }) : tx('Nothing left to check') })
        ]),
        btn('next-bar', '›', () => stepBar(1), { disabled: bi >= ms.length - 1, aria: tx('Next measure') }),
        btn('close', '✕', close, { aria: tx('Close') })
      ]));
      root.appendChild(body);
      if (suspectCount) {
        body.appendChild(h('div', { class: 'ppp-edit-row' }, [
          btn('prev-suspect', '‹ ' + tx('Previous to check'), () => stepSuspect(-1), { aria: tx('Previous measure to check') }),
          btn('next-suspect', tx('Next to check') + ' ›', () => stepSuspect(1), { aria: tx('Next measure to check') })
        ]));
      }
      /* why this bar was marked */
      const why = [];
      if (info.reviewed) why.push(h('div', { class: 'ppp-edit-why good', 'data-why': 'reviewed', text: tx('You marked this measure as right.') }));
      else if (info.suspect) {
        const sentences = info.reasons.map(r => (FL && FL.reasonText ? FL.reasonText(r, tx) : r.code));
        why.push(h('div', { class: 'ppp-edit-why bad', 'data-why': 'suspect', text: sentences.slice(0, 3).join(' · ') || tx('PPP is not sure about this measure.') }));
      } else why.push(h('div', { class: 'ppp-edit-why', 'data-why': 'none', text: info.edited ? tx('You changed this measure.') : tx('Nothing stands out in this measure.') }));
      why.forEach(x => body.appendChild(x));

      /* the bar */
      if (keepStage) stage = keepStage; else stage = h('div', { class: 'ppp-edit-stage', 'data-stage': '1', onclick: onTap });
      body.appendChild(stage);
      /* how full each staff is */
      body.appendChild(h('div', { class: 'ppp-edit-fill' }, info.fill.map(f => h('span', { class: 'ppp-edit-chip ' + (f.ok ? 'good' : 'bad'), 'data-fill': f.index + ':' + (f.ok ? 'ok' : 'no') },
        [tx('{{hand}}: {{have}} of {{need}} beats', { hand: handName(f.index), have: fmtBeats(beats(f.have)), need: fmtBeats(beats(f.need)) })]))));

      if (state.msg) body.appendChild(h('div', { class: 'ppp-edit-msg', role: 'alert', 'data-msg': '1', 'data-detail': state.detail || '', text: state.msg }));

      /* accept */
      body.appendChild(h('div', { class: 'ppp-edit-row' }, [
        info.reviewed
          ? btn('unreviewed', tx('Take the mark off'), () => run({ op: 'unreviewed', measure: state.bar }))
          : btn('reviewed', tx('This measure is right'), () => run({ op: 'reviewed', measure: state.bar }), { cls: info.suspect ? 'primary' : '' }),
        host.play ? btn('play', tx('Play this measure'), () => { try { host.play(numberOf(ms[bi], bi)); } catch (e) { /* the page's */ } }) : null
      ]));

      /* the selected note */
      if (sel) renderSelection(sel);
      else body.appendChild(h('div', { class: 'ppp-edit-hint', text: state.add ? tx('Tap a place on the staff to put a note there.') : tx('Tap a note or a rest to change it.') }));

      /* adding */
      body.appendChild(h('div', { class: 'ppp-edit-label', text: tx('Add notes') }));
      body.appendChild(h('div', { class: 'ppp-edit-row' }, [
        btn('add-mode', state.add ? tx('Adding notes: on') : tx('Adding notes: off'), () => { state.add = !state.add; render(); }, { pressed: state.add })
      ]));
      body.appendChild(h('div', { class: 'ppp-edit-row', 'data-values': '1' }, VALUES.map(v => btn('value-' + v, valueLabel(v), () => { state.value = v; render(); }, { pressed: state.value === v, aria: valueLabel(v) }))));

      /* the bar's tools */
      body.appendChild(btn('tools', state.tools ? tx('Hide the measure tools') : tx('Measure tools'), () => { state.tools = !state.tools; render(); }, { pressed: state.tools }));
      if (state.tools) renderTools(ms, bi);

      /* history */
      root.appendChild(h('div', { class: 'ppp-edit-foot' }, [
        h('div', { class: 'ppp-edit-row' }, [
          btn('undo', tx('Undo'), undo, { disabled: !session.canUndo }),
          btn('redo', tx('Redo'), redo, { disabled: !session.canRedo }),
          btn('discard', tx('Discard my changes'), discard, { disabled: !session.edited, cls: 'warn' })
        ]),
        h('div', { class: 'ppp-edit-hint', 'data-steps': steps.undo + ':' + steps.redo, text: steps.undo ? tx('{{n}} changes made', { n: steps.undo }) : tx('No changes yet') })
      ]));
      /* the page behind the sheet can be scrolled to its end (the sheet's greatest height: the sheet is not measured, which would make the page lay out again) */
      if (doc.body && padBefore === null) {
        padBefore = doc.body.style.paddingBottom || '';
        if (win && win.innerWidth <= 720) doc.body.style.paddingBottom = Math.round((win.innerHeight || 600) * 0.84 + 16) + 'px';
      }
      body.scrollTop = keepScroll;
      if (keepStage) markSelection(); else paintBar();
      if (quick) {
        /* the check of the new graph, after the sheet is drawn: the header and the reason change, the drawing does not */
        const g = graph();
        const win = (typeof setTimeout === 'function' ? setTimeout : (f => f()));
        win(() => { if (!closed && graph() === g) render(false); }, 0);
      }
    }
    function valueLabel(v) {
      return v === 'whole' ? tx('Whole') : v === 'half' ? tx('Half') : v === 'quarter' ? tx('Quarter') : v === 'eighth' ? tx('Eighth') : tx('16th');
    }
    function renderSelection(sel) {
      const rows = [];
      if (sel.kind === 'rest') {
        rows.push(h('div', { class: 'ppp-edit-label', text: tx('Rest') }));
        rows.push(h('div', { class: 'ppp-edit-row' }, [
          btn('to-note', tx('Make a note'), () => run({ op: 'note', event: sel.id }), { disabled: !sel.canNote, cls: 'primary' }),
          btn('deselect', tx('Done'), () => { state.sel = null; state.head = null; render(); })
        ]));
      } else {
        const names = sel.heads.map(x => x.name);
        rows.push(h('div', { class: 'ppp-edit-label', text: tx('Note {{names}}', { names: names.join(' ') }) }));
        if (sel.heads.length > 1) {
          rows.push(h('div', { class: 'ppp-edit-row', 'data-heads': '1' }, sel.heads.map(x => btn('head-' + x.id, x.name, () => { state.head = x.id; render(); }, { pressed: state.head === x.id, aria: tx('Note {{names}}', { names: x.name }) }))));
        }
        const head = state.head || (sel.heads[0] && sel.heads[0].id);
        const hd = sel.heads.find(x => x.id === head) || sel.heads[0];
        rows.push(h('div', { class: 'ppp-edit-row' }, [
          btn('step-up', '▲ ' + tx('Up a step'), () => run({ op: 'step', head: head, by: 1 }), { aria: tx('Up a step') }),
          btn('step-down', '▼ ' + tx('Down a step'), () => run({ op: 'step', head: head, by: -1 }), { aria: tx('Down a step') })
        ]));
        rows.push(h('div', { class: 'ppp-edit-row' }, [
          btn('oct-up', '▲ ' + tx('Octave up'), () => run({ op: 'octave', head: head, by: 1 }), { aria: tx('Octave up') }),
          btn('oct-down', '▼ ' + tx('Octave down'), () => run({ op: 'octave', head: head, by: -1 }), { aria: tx('Octave down') })
        ]));
        const accBtn = (act, label, type) => btn(act, label, () => run({ op: 'accidental', head: head, acc: hd && hd.acc === type ? null : type }), { pressed: !!hd && (type === null ? !hd.acc : hd.acc === type) });
        rows.push(h('div', { class: 'ppp-edit-row' }, [
          accBtn('acc-sharp', tx('Sharp ♯'), 'sharp'), accBtn('acc-flat', tx('Flat ♭'), 'flat'), accBtn('acc-natural', tx('Natural ♮'), 'natural'),
          btn('acc-none', tx('No accidental'), () => run({ op: 'accidental', head: head, acc: null }), { pressed: !!hd && !hd.acc })
        ]));
        rows.push(h('div', { class: 'ppp-edit-row' }, [
          btn('val-halve', tx('Shorter'), () => run({ op: 'value', event: sel.id, change: 'halve' }), { disabled: !sel.canValue.halve }),
          btn('val-double', tx('Longer'), () => run({ op: 'value', event: sel.id, change: 'double' }), { disabled: !sel.canValue.double }),
          btn('val-dot', tx('Dot on or off'), () => run({ op: 'value', event: sel.id, change: 'dot' }), { disabled: !sel.canValue.dot })
        ]));
        const otherIdx = sel.staffIndex === 0 ? 1 : 0;
        rows.push(h('div', { class: 'ppp-edit-row' }, [
          btn('to-rest', tx('Make a rest'), () => run({ op: 'rest', event: sel.id }), { disabled: !sel.canRest }),
          btn('remove', sel.heads.length > 1 ? tx('Delete this note') : tx('Delete'), () => run({ op: 'remove', event: sel.id, head: sel.heads.length > 1 ? head : undefined }), { cls: 'warn' }),
          btn('to-staff', tx('Move to the {{hand}} staff', { hand: handName(otherIdx) }), () => run({ op: 'staff', event: sel.id }), { disabled: !sel.canStaff })
        ]));
        if (sel.inTuplet) rows.push(h('div', { class: 'ppp-edit-hint', text: tx('This note is part of a triplet or another tuplet, which cannot be changed here.') }));
      }
      rows.forEach(x => body.appendChild(x));
    }
    function renderTools(ms, bi) {
      const m = ms[bi];
      const g = graph();
      const part0 = g.parts[0];
      const bar = [];
      bar.push(h('div', { class: 'ppp-edit-label', text: tx('This measure') }));
      bar.push(h('div', { class: 'ppp-edit-row' }, [
        btn('bar-insert-before', tx('Insert an empty measure before'), () => run({ op: 'insert', before: m.id })),
        btn('bar-insert-after', tx('Insert an empty measure after'), () => run({ op: 'insert', after: m.id }))
      ]));
      bar.push(h('div', { class: 'ppp-edit-row' }, [
        btn('bar-delete', tx('Delete this measure'), () => run({ op: 'delete', measure: m.id }), { cls: 'warn', disabled: ms.length <= 1 }),
        btn('bar-merge', tx('Join with the next measure'), () => run({ op: 'merge', measure: m.id }), { disabled: bi >= ms.length - 1 }),
        btn('bar-split', tx('Split this measure'), () => { state.split = !state.split; render(); }, { pressed: state.split })
      ]));
      if (state.split) {
        /* a place to split at: every beat of the time signature */
        const meter = (g.timeline.meters || []).filter(x => idxOf(x.m) <= bi).sort((a, b) => idxOf(a.m) - idxOf(b.m)).pop();
        const unit = meter ? meter.beatType : 4;
        const total = beats(m.dur) / (4 / unit);
        const chips = [];
        for (let k = 1; k < Math.round(total); k++) {
          const gcd = (a, b) => (b ? gcd(b, a % b) : a);
          const g = gcd(k, unit);
          const at = (k / g) + (unit / g === 1 ? '' : '/' + (unit / g));
          chips.push(btn('bar-split-' + k, tx('After beat {{n}}', { n: k }), () => { state.split = false; run({ op: 'split', measure: m.id, at: at }); }));
        }
        if (!chips.length) chips.push(h('div', { class: 'ppp-edit-hint', text: tx('This measure is too short to split.') }));
        bar.push(h('div', { class: 'ppp-edit-row', 'data-splits': '1' }, chips));
      }
      /* time signature */
      bar.push(h('div', { class: 'ppp-edit-label', text: tx('Time signature from this measure') }));
      const meterNow = (g.timeline.meters || []).filter(x => idxOf(x.m) <= bi).sort((a, b) => idxOf(a.m) - idxOf(b.m)).pop();
      bar.push(h('div', { class: 'ppp-edit-row' }, TIMES.map(t => btn('time-' + t[0] + '-' + t[1], t[0] + '/' + t[1],
        () => run({ op: 'time', measure: m.id, beats: t[0], beatType: t[1] }),
        { pressed: !!meterNow && meterNow.beats.length === 1 && meterNow.beats[0] === t[0] && meterNow.beatType === t[1], aria: tx('Time signature {{n}}', { n: t[0] + '/' + t[1] }) }))));
      /* key */
      const keyNow = (g.timeline.keys || []).filter(k => !k.scope && idxOf(k.m) <= bi).sort((a, b) => idxOf(a.m) - idxOf(b.m)).pop();
      const fifths = keyNow ? keyNow.fifths : 0;
      const keyLabel = fifths === 0 ? tx('No sharps or flats') : fifths > 0 ? tx('{{n}} sharps', { n: fifths }) : tx('{{n}} flats', { n: -fifths });
      bar.push(h('div', { class: 'ppp-edit-label', text: tx('Key from this measure') }));
      bar.push(h('div', { class: 'ppp-edit-row' }, [
        btn('key-down', '♭', () => run({ op: 'key', measure: m.id, fifths: fifths - 1 }), { disabled: fifths <= -7, aria: tx('One more flat') }),
        h('span', { class: 'ppp-edit-chip', 'data-key': String(fifths), text: keyLabel + ' (' + (KEY_NAMES[fifths] || '') + ')' }),
        btn('key-up', '♯', () => run({ op: 'key', measure: m.id, fifths: fifths + 1 }), { disabled: fifths >= 7, aria: tx('One more sharp') })
      ]));
      /* clef, per staff */
      bar.push(h('div', { class: 'ppp-edit-label', text: tx('Clef from this measure') }));
      staffIds().forEach((sid, i) => {
        const info = ED.staffAt(g, m.id, sid);
        const now = info ? info.clefSign : 'G';
        bar.push(h('div', { class: 'ppp-edit-row', 'data-clef-staff': String(i) }, [
          h('span', { class: 'ppp-edit-chip', text: handName(i) }),
          btn('clef-' + i + '-G', tx('Treble clef'), () => run({ op: 'clef', measure: m.id, staff: sid, sign: 'G' }), { pressed: now === 'G' }),
          btn('clef-' + i + '-F', tx('Bass clef'), () => run({ op: 'clef', measure: m.id, staff: sid, sign: 'F' }), { pressed: now === 'F' }),
          btn('clef-' + i + '-C', tx('Alto clef'), () => run({ op: 'clef', measure: m.id, staff: sid, sign: 'C' }), { pressed: now === 'C' })
        ]));
      });
      /* hands, and one piano part */
      if (staffIds().length > 1) {
        bar.push(h('div', { class: 'ppp-edit-label', text: tx('Hands and staves') }));
        staffIds().forEach((sid, i) => {
          bar.push(h('div', { class: 'ppp-edit-row', 'data-hand-staff': String(i) }, [
            h('span', { class: 'ppp-edit-chip', text: handName(i) }),
            btn('hand-rh-' + i, tx('This staff is the right hand'), () => run({ op: 'hand', staff: sid, hand: 'RH' }), { disabled: i === 0 }),
            btn('hand-lh-' + i, tx('This staff is the left hand'), () => run({ op: 'hand', staff: sid, hand: 'LH' }), { disabled: i === staffIds().length - 1 })
          ]));
        });
        if (g.parts.length > 1 && part0) {
          bar.push(h('div', { class: 'ppp-edit-row' }, [btn('merge-staves', tx('These staves are one piano part'), () => run({ op: 'mergeStaves', keep: g.parts[0].id, into: g.parts[1].id }))]));
        }
      }
      bar.forEach(x => body.appendChild(x));
    }

    /* ---------------------------------------------------------------- go */
    state.bar = resolveBar(opts.measure) || (measures()[0] || {}).id;
    if (!state.bar) throw new Error('the score has no measure');
    root.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); });
    /* the first drawing is made from what the page already knows about its bars; the check of the graph comes after it */
    render(!!host.hint);
    const controller = {
      version: VERSION, el: root, state: state,
      go: x => goBar(x), close: close, refresh: () => { render(); },
      apply: cmd => run(cmd), undo: undo, redo: redo,
      get closed() { return closed; }
    };
    return controller;
  }

  return Object.freeze({ VERSION: VERSION, open: open, TIMES: TIMES });
});
