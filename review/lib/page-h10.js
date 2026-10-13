/* G10a-5 (H-10): the reviewer's page for the blind comparison of two ways PPP writes a recording down - ONE self-contained HTML file, Korean,
   made for a phone (a 360 px column, large touch targets, one tap per choice), working from disk and as an Artifact page.

   Per piece ("A번 곡", "B번 곡" ...): a link to the original on YouTube (a new tab; no recording audio is in the page) and two parts,
     (1) the transcription as PPP's review screen shows it, (2) the one-note-per-hand arrangement made from it at the middle level,
   each as two scores X and Y of the SAME seconds of the piece. Per part: which is better (X / Y / similar); per side: "would you give this to a
   student" (pass / fail, small fixes allowed), what is wrong (seven tags), an optional note. Which of X and Y is which way of writing it down is
   decided by a secret seed at build time and is nowhere in this file.

   The scores are the app's engraver's drawings of each way's own graph (review/lib/h10-draw.js); the sound is the app's own piano player
   plan (ties joined, written pedal, tempo map) played through the sampled piano the G9 page already carries (review/lib/page.js SOUND_JS:
   embedded recordings, nothing fetched). Drawings are packed (review/lib/svgpack.js: shared glyphs, shared markup fragments) and unpacked when a
   piece comes near the screen, in the layout that fits the viewport (the engraver's phone layout up to 720 px, else its desktop one).

   Answers are kept in three places and never lost: in memory, in localStorage on every tap (try/catch: with no storage the page still works), and,
   when the page runs as an Artifact with the `db` capability, in the artifact database through the small adapter `store` below
   (window.claude.use('db'); documents answers/<packetId>/items/<id>, and answers/<packetId> for the reviewer's role; per item, the newer
   `t` wins on load, so another device resumes where this one stopped). The same file works with no capability at all; the footer says which
   it is doing. Export: ratings JSON (format ppp-review-ratings/2) by download, copy, or a text box.

   Wording rule: nothing on the page - text, class, id, script identifier - may name either way of writing the music down; tests/review scan
   the finished file (and the drawings after unpacking) for the words that would. */
'use strict';
const { SOUND_JS } = require('./page.js');
const SVGPACK = require('./svgpack.js');

const TAGS = [
  ['rests', '쉼표가 이상해요'],
  ['hands', '손 나눔(위아래 오선)이 이상해요'],
  ['bars-metre', '마디·박자가 이상해요'],
  ['durations', '음 길이가 이상해요'],
  ['pitch-octave', '음 높이·옥타브가 이상해요'],
  ['missing-extra', '음이 빠졌거나 많아요'],
  ['other', '기타']
];
const PARTS = {
  T: { title: '① 받아쓴 악보', what: '원곡을 듣고 PPP가 적은 악보 그대로입니다.' },
  A: { title: '② 편곡 (한 손에 한 음, 중급)', what: '위 ①의 악보(같은 X와 Y)에 PPP의 편곡 기능을 써서 만든 악보입니다. 한 손에 한 번에 한 음씩, 중급으로 만들었습니다.' }
};
const MINUTES_PER_ITEM = 5.5;
/* CC BY 3.0 asks for credit: the piano recordings (wording of audio/piano/README.md; no link, the page carries no URL). The only place a version number ("V3", the recordings' own name) is in the page. */
const CREDIT = '<footer class="credit"><p>피아노 소리: Salamander Grand Piano V3, Alexander Holm 녹음 (Yamaha C5), CC BY 3.0 (Creative Commons Attribution 3.0) 라이선스. PPP 앱과 같은 녹음입니다.</p>' +
  '<p lang="en">Piano sound: Salamander Grand Piano V3 by Alexander Holm (a Yamaha C5), licensed under CC BY 3.0 (Creative Commons Attribution 3.0). The same recordings the PPP app uses.</p></footer>';
/* the G9 page's player, with one change: a note may carry its own velocity as a fourth number (the app's player plan has one per strike) */
const VEL_FROM = 'release(P, strike(P, n[2], t, PIANO.velocity), t + hold);';
if (SOUND_JS.indexOf(VEL_FROM) < 0) throw new Error('page-h10: the G9 sound block changed (pianoPhrase)');
const SOUND = SOUND_JS.replace(VEL_FROM, 'release(P, strike(P, n[2], t, n.length > 3 && n[3] > 0 ? n[3] : PIANO.velocity), t + hold);');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const scriptJson = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const letter = n => { let s = ''; let k = n; do { s = String.fromCharCode(65 + (k % 26)) + s; k = Math.floor(k / 26) - 1; } while (k >= 0); return s; };

const CSS = `
:root{color-scheme:light;--ink:#1c1b19;--muted:#5f5a52;--line:#ddd6ca;--bg:#f5f2ec;--card:#fffdf9;--accent:#1f5c8a;--sel:#dcebf6;--ok:#1d7a46;--okbg:#dff2e6;--bad:#a83232;--badbg:#f8e0e0;--tap:46px}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{word-break:keep-all;overflow-wrap:anywhere;margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",Roboto,Arial,sans-serif;padding:0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
header.bar{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:8px 14px}
.bar-row{display:flex;align-items:center;gap:10px;max-width:860px;margin:0 auto}
.bar-row h1{font-size:16px;margin:0;flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-row .progress{font-size:14px;color:var(--muted);white-space:nowrap}
.meter{height:6px;background:var(--line);border-radius:3px;margin:6px auto 0;max-width:860px;overflow:hidden}
.meter i{display:block;height:100%;width:0;background:var(--accent);transition:width .2s}
button,.btn{font:inherit;color:var(--ink);background:var(--card);border:2px solid var(--line);border-radius:12px;padding:8px 12px;min-height:var(--tap);cursor:pointer;text-align:center;touch-action:manipulation}
button.primary,a.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.small{min-height:38px;padding:4px 10px;font-size:14px}
button.ghost{background:transparent}
button[aria-pressed=true]{border-color:var(--accent);background:var(--sel);font-weight:700}
button[data-value=pass][aria-pressed=true]{border-color:var(--ok);background:var(--okbg)}
button[data-value=fail][aria-pressed=true]{border-color:var(--bad);background:var(--badbg)}
button:focus-visible,a:focus-visible,textarea:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #f0a020;outline-offset:2px}
a.btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;color:var(--accent);border:2px solid var(--accent);border-radius:12px;padding:8px 12px;min-height:var(--tap);background:var(--card)}
main{max-width:860px;margin:0 auto;padding:12px 12px 40px}
.intro,article.item,section#summary{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 14px;margin:0 0 18px}
.intro h2,#summary h2{font-size:19px;margin:0 0 6px}
.intro ol{padding-left:20px;margin:8px 0}
.intro li{margin:6px 0}
.intro label{display:block;margin-top:10px}
.intro input[type=text]{width:100%;max-width:360px;padding:10px;border:2px solid var(--line);border-radius:10px;font:inherit;min-height:var(--tap)}
article.item h2{font-size:20px;margin:0}
article.item h2 small{font-weight:400;color:var(--muted);font-size:14px}
.item-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;justify-content:space-between}
.aim{color:var(--muted);font-size:14px;margin:4px 0 10px}
section.part{border-top:2px solid var(--line);margin-top:14px;padding-top:12px}
section.part h3{font-size:17px;margin:0 0 2px}
section.part .what{margin:0 0 8px;color:var(--muted);font-size:14px}
.badge-done{display:none;font-size:13px;color:var(--ok);font-weight:700;margin-left:8px}
section.part.done .badge-done{display:inline}
.side{border:1px solid var(--line);border-radius:12px;padding:10px;margin:10px 0}
.side h4{margin:0;font-size:18px;display:inline-block;margin-right:8px}
.tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.tools select{font:inherit;min-height:var(--tap);padding:4px 8px;border-radius:10px;border:2px solid var(--line);background:var(--card)}
.paper{background:#fffef9;color:#111;border:1px solid var(--line);border-radius:8px;margin:8px 0;overflow:hidden;width:100%;aspect-ratio:var(--arw)}
@media (max-width:720px){.paper{aspect-ratio:var(--arn)}}
[hidden]{display:none !important}
article.item,section.part{scroll-margin-top:72px}
.paper svg{display:block;width:100%;height:auto}
.q{margin:8px 0 4px;font-weight:600;font-size:15px}
.q small{font-weight:400;color:var(--muted)}
.row{display:flex;flex-wrap:wrap;gap:8px}
.row.two button{flex:1 1 45%}
.row.three button{flex:1 1 30%}
.row.tags{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.row.tags button{min-height:44px;font-size:14px;line-height:1.3;padding:6px 8px}
details.note{margin:8px 0 0}
details.note summary{cursor:pointer;min-height:40px;display:flex;align-items:center;color:var(--accent)}
textarea{width:100%;font:inherit;padding:10px;border:2px solid var(--line);border-radius:10px;min-height:76px;resize:vertical}
.pref{background:#eef3f7;border:1px solid #c5d5e2;border-radius:12px;padding:10px;margin:10px 0 4px}
.prog-line{font-size:14px;color:var(--muted)}
#save-state{font-size:12px;color:var(--muted);white-space:nowrap}
#save-state.ok{color:var(--ok)}#save-state.err{color:var(--bad)}
.summary-list{margin:6px 0;padding-left:20px}
.summary-list a{color:var(--accent)}
details.export{margin:12px 0}
details.export textarea{min-height:150px;font:13px/1.4 ui-monospace,Menlo,Consolas,monospace}
footer.credit{margin:8px 0 24px;font-size:13px;color:var(--muted)}
footer.credit p{margin:2px 0}
.hidden-defs{position:absolute;width:0;height:0;overflow:hidden}
@media (min-width:721px){main{padding:18px 16px 48px}.intro,article.item,section#summary{padding:18px 20px}}
`;

/* ---- the page's script ---- */
const JS = `
(function(){
  var DATA = JSON.parse(document.getElementById('packet-data').textContent);
  var SVG = JSON.parse(document.getElementById('svg-data').textContent);
  var DICT = JSON.parse(document.getElementById('svg-dict').textContent);
  ${SVGPACK.UNPACK_JS}
  var KEY = 'ppp-review:' + DATA.packetId;
  var answers = {};
  var role = '';

  function blankSide(){ return { pass: null, tags: [], text: '' }; }
  function blankPart(){ return { pref: null, X: blankSide(), Y: blankSide() }; }
  function sanitizeSide(s){
    s = s || {};
    var tags = [];
    (Array.isArray(s.tags) ? s.tags : []).forEach(function(t){ if (DATA.tags.indexOf(t) >= 0 && tags.indexOf(t) < 0) tags.push(t); });
    return { pass: s.pass === true ? true : s.pass === false ? false : null, tags: tags, text: typeof s.text === 'string' ? s.text.slice(0, 600) : '' };
  }
  function sanitizePart(p){
    p = p || {};
    return { pref: p.pref === 'X' || p.pref === 'Y' || p.pref === 'same' ? p.pref : null, X: sanitizeSide(p.X), Y: sanitizeSide(p.Y) };
  }
  function sanitizeItem(id, v){
    var o = { t: typeof v.t === 'number' ? v.t : 0 };
    DATA.cards[id].parts.forEach(function(p){ o[p] = sanitizePart(v[p]); });
    return o;
  }
  function part(id, p){
    if (!answers[id]) answers[id] = { t: 0 };
    if (!answers[id][p]) answers[id][p] = blankPart();
    return answers[id][p];
  }
  function partDone(id, p){
    var a = answers[id] && answers[id][p];
    return !!(a && a.pref !== null && a.X.pass !== null && a.Y.pass !== null);
  }

  /* ---- keeping the answers ---- */
  function localLoad(){
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return false;
      var o = JSON.parse(raw);
      if (!o || o.packetId !== DATA.packetId) return false;
      role = typeof o.role === 'string' ? o.role : '';
      Object.keys(o.answers || {}).forEach(function(id){ if (DATA.cards[id]) answers[id] = sanitizeItem(id, o.answers[id]); });
      return true;
    } catch (e) { return false; }
  }
  function localSave(){
    try { window.localStorage.setItem(KEY, JSON.stringify({ packetId: DATA.packetId, role: role, answers: answers })); return true; } catch (e) { return false; }
  }

  /* the artifact database, when the page runs where window.claude.use('db') answers; otherwise nothing here does anything */
  var store = { db: null, state: 'local', timers: {}, busy: {}, again: {}, roleTimer: null, lastError: null, writes: 0 };
  function setState(s, msg){
    store.state = s;
    var el = document.getElementById('save-state');
    if (!el) return;
    el.className = s === 'ok' ? 'ok' : s === 'error' ? 'err' : '';
    el.textContent = s === 'ok' ? '저장됨 (서버)' : s === 'error' ? (msg || '서버 저장 실패 - 이 기기에는 저장됨') : s === 'checking' ? '저장 확인 중...' : '이 기기에 저장됨';
  }
  function dbBase(){ return 'answers/' + DATA.packetId; }
  function dbPush(id){
    if (!store.db) return Promise.resolve();
    if (store.busy[id]) { store.again[id] = true; return store.busy[id]; }
    var body = { id: id, packetId: DATA.packetId, t: answers[id].t, v: 1 };
    DATA.cards[id].parts.forEach(function(p){ body[p] = answers[id][p] || blankPart(); });
    var attempt = function(n){
      return store.db.doc(dbBase() + '/items/' + id).set(body).then(function(){ store.writes++; setState('ok'); }, function(e){
        if (e && e.code === 'unavailable' && n < 1) return new Promise(function(r){ setTimeout(r, 1000 + Math.random() * 1500); }).then(function(){ return attempt(n + 1); });
        store.lastError = e && (e.code || e.message) || 'error';
        setState('error');
      });
    };
    store.busy[id] = attempt(0).then(function(){
      store.busy[id] = null;
      if (store.again[id]) { store.again[id] = false; return dbPush(id); }
    });
    return store.busy[id];
  }
  function dbSchedule(id){
    if (!store.db) return;
    clearTimeout(store.timers[id]);
    store.timers[id] = setTimeout(function(){ dbPush(id); }, 700);
  }
  function dbPushRole(){
    if (!store.db) return;
    clearTimeout(store.roleTimer);
    store.roleTimer = setTimeout(function(){
      store.db.doc(dbBase()).set({ packetId: DATA.packetId, role: role, t: Date.now(), v: 1 }).then(function(){ setState('ok'); }, function(e){ store.lastError = e && (e.code || e.message); setState('error'); });
    }, 700);
  }
  /* the newer item wins; an item this device has and the database lacks (or has older) goes up */
  function dbPull(){
    var base = dbBase();
    return Promise.all([store.db.collection(base + '/items').get(), store.db.doc(base).get()]).then(function(r){
      var changed = false, seen = {};
      r[0].docs.forEach(function(d){
        var v = d.data();
        if (!v || !DATA.cards[v.id]) return;
        seen[v.id] = true;
        var mine = answers[v.id];
        if (!mine || (v.t || 0) > (mine.t || 0)) { answers[v.id] = sanitizeItem(v.id, v); changed = true; }
        else if ((mine.t || 0) > (v.t || 0)) dbSchedule(v.id);
      });
      Object.keys(answers).forEach(function(id){ if (!seen[id] && answers[id].t) dbSchedule(id); });
      var m = r[1] && r[1].exists ? r[1].data() : null;
      if (m && typeof m.role === 'string' && m.role && !role) { role = m.role; var rb = document.getElementById('role'); if (rb) rb.value = role; changed = true; }
      else if (role && (!m || m.role !== role)) dbPushRole();
      if (changed) { localSave(); paintAll(); refresh(); }
      setState('ok');
    }, function(e){ store.lastError = e && (e.code || e.message); setState('error'); });
  }
  function dbInit(){
    var C = window.claude;
    if (!C || typeof C.use !== 'function') { setState('local'); return; }
    setState('checking');
    var done = false;
    var timer = setTimeout(function(){ if (!done) setState('local'); }, 12000);
    C.use('db').then(function(db){
      done = true; clearTimeout(timer);
      if (!db) { setState('local'); return; }
      store.db = db;
      dbPull();
    }, function(){ done = true; clearTimeout(timer); setState('local'); });
  }

  function touch(id){
    answers[id].t = Date.now();
    localSave();
    dbSchedule(id);
    refresh();
  }

  /* ---- the controls ---- */
  function cardOf(el){ return el.closest ? el.closest('article.item') : null; }
  function paintPart(card, p){
    var id = card.getAttribute('data-item'), sec = card.querySelector('section.part[data-part="' + p + '"]');
    if (!sec) return;
    var a = answers[id] && answers[id][p] || blankPart();
    Array.prototype.forEach.call(sec.querySelectorAll('button[data-act="pref"]'), function(b){ b.setAttribute('aria-pressed', a.pref === b.getAttribute('data-value') ? 'true' : 'false'); });
    ['X', 'Y'].forEach(function(side){
      var s = a[side];
      Array.prototype.forEach.call(sec.querySelectorAll('button[data-side="' + side + '"][data-act="pass"]'), function(b){
        b.setAttribute('aria-pressed', s.pass !== null && ((b.getAttribute('data-value') === 'pass') === s.pass) ? 'true' : 'false');
      });
      Array.prototype.forEach.call(sec.querySelectorAll('button[data-side="' + side + '"][data-act="tag"]'), function(b){
        b.setAttribute('aria-pressed', s.tags.indexOf(b.getAttribute('data-value')) >= 0 ? 'true' : 'false');
      });
      var t = sec.querySelector('textarea[data-side="' + side + '"]');
      if (t && t.value !== s.text) t.value = s.text;
      var d = sec.querySelector('details[data-side="' + side + '"]');
      if (d && s.text) d.open = true;
    });
    sec.classList.toggle('done', partDone(id, p));
  }
  function paintAll(){
    Array.prototype.forEach.call(document.querySelectorAll('article.item'), function(card){
      DATA.cards[card.getAttribute('data-item')].parts.forEach(function(p){ paintPart(card, p); });
    });
  }
  function onClick(ev){
    var b = ev.target.closest ? ev.target.closest('button[data-act]') : null;
    if (!b) return;
    var card = cardOf(b), sec = b.closest('section.part');
    if (!card || !sec) return;
    var id = card.getAttribute('data-item'), p = sec.getAttribute('data-part'), act = b.getAttribute('data-act'), v = b.getAttribute('data-value'), side = b.getAttribute('data-side');
    var a = part(id, p);
    if (act === 'pref') a.pref = a.pref === v ? null : v;
    else if (act === 'pass') a[side].pass = (a[side].pass !== null && (v === 'pass') === a[side].pass) ? null : v === 'pass';
    else if (act === 'tag') { var i = a[side].tags.indexOf(v); if (i >= 0) a[side].tags.splice(i, 1); else a[side].tags.push(v); }
    else return;
    paintPart(card, p);
    touch(id);
  }
  function onInput(ev){
    var t = ev.target;
    if (!t || t.tagName !== 'TEXTAREA' || !t.getAttribute('data-side')) return;
    var card = cardOf(t), sec = t.closest('section.part');
    if (!card || !sec) return;
    var id = card.getAttribute('data-item');
    part(id, sec.getAttribute('data-part'))[t.getAttribute('data-side')].text = t.value.slice(0, 600);
    touch(id);
  }

  /* ---- progress, the summary, the export ---- */
  function totals(){
    var done = 0, all = 0, itemsDone = 0, firstOpen = null, open = [];
    DATA.order.forEach(function(id){
      var ok = true;
      DATA.cards[id].parts.forEach(function(p){
        all++;
        if (partDone(id, p)) done++; else { ok = false; open.push([id, p]); if (!firstOpen) firstOpen = [id, p]; }
      });
      if (ok) itemsDone++;
    });
    return { done: done, all: all, itemsDone: itemsDone, items: DATA.order.length, firstOpen: firstOpen, open: open };
  }
  function exportObject(){
    return {
      format: 'ppp-review-ratings/2', mode: 'h10', packetId: DATA.packetId, reviewer: role, exportedAt: new Date().toISOString(),
      items: DATA.order.map(function(id){
        var a = answers[id] || {}, o = { id: id };
        DATA.cards[id].parts.forEach(function(p){
          var x = a[p] || blankPart();
          o[p] = { preference: x.pref, X: { pass: x.X.pass, tags: x.X.tags.slice(), text: x.X.text }, Y: { pass: x.Y.pass, tags: x.Y.tags.slice(), text: x.Y.text } };
        });
        return o;
      })
    };
  }
  function refresh(){
    var t = totals();
    document.getElementById('progress').textContent = t.done + ' / ' + t.all;
    document.getElementById('meter-fill').style.width = (t.all ? Math.round(100 * t.done / t.all) : 0) + '%';
    var rb = document.getElementById('resume-btn');
    rb.hidden = !(t.done > 0 && t.done < t.all);
    var sum = document.getElementById('summary-status');
    sum.textContent = t.done === t.all ? '모두 끝났어요. 수고하셨습니다!' : t.itemsDone + ' / ' + t.items + '곡 완료 (부분 ' + t.done + ' / ' + t.all + ')';
    var list = document.getElementById('summary-open');
    list.innerHTML = '';
    t.open.forEach(function(x){
      var li = document.createElement('li'), a = document.createElement('a');
      a.href = '#sec-' + x[0] + '-' + x[1];
      a.textContent = DATA.cards[x[0]].label + '번 곡 ' + (x[1] === 'T' ? '① 받아쓴 악보' : '② 편곡');
      li.appendChild(a); list.appendChild(li);
    });
    document.getElementById('summary-open-wrap').hidden = !t.open.length;
    document.getElementById('export-json').value = JSON.stringify(exportObject(), null, 1);
  }
  function jump(id, p){
    var el = document.getElementById('sec-' + id + '-' + p);
    if (el) { paintCard(cardOfId(id)); el.scrollIntoView({ block: 'start' }); }
  }
  function cardOfId(id){ return document.getElementById('item-' + id); }

  function saveFile(name, text){
    var C = window.claude;
    var viaAnchor = function(){
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };
    if (C && typeof C.use === 'function') {
      C.use('downloads').then(function(d){ if (d && typeof d.save === 'function') return d.save({ filename: name, data: text }).catch(viaAnchor); viaAnchor(); }, viaAnchor);
    } else viaAnchor();
  }
  function copyText(text, done){
    var ta = document.getElementById('export-json');
    var viaSelect = function(){ try { ta.focus(); ta.select(); document.execCommand('copy'); done(true); } catch (e) { done(false); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function(){ done(true); }, viaSelect); else viaSelect();
  }

  /* ---- the scores: unpacked when a piece comes near the screen, in the layout that fits ---- */
  var mq = window.matchMedia ? window.matchMedia('(max-width:720px)') : null;
  var layoutIndex = function(){ return (mq ? mq.matches : window.innerWidth <= 720) ? 1 : 0; };
  function paintPaper(el){
    var d = SVG[el.getAttribute('data-svg')], i = layoutIndex();
    if (!d) return;
    if (el.getAttribute('data-layout') === String(i)) return;
    el.innerHTML = unpack(d.svg[i]);
    el.setAttribute('data-layout', String(i));
  }
  function paintCard(card){ if (card) Array.prototype.forEach.call(card.querySelectorAll('.paper[data-svg]'), paintPaper); }
  function paintEverything(){ Array.prototype.forEach.call(document.querySelectorAll('article.item'), paintCard); }
  var observer = null;
  function watchCards(){
    var cards = document.querySelectorAll('article.item');
    if (!('IntersectionObserver' in window)) { paintEverything(); return; }
    observer = new IntersectionObserver(function(entries){ entries.forEach(function(e){ if (e.isIntersecting) paintCard(e.target); }); }, { rootMargin: '1500px 0px' });
    Array.prototype.forEach.call(cards, function(c){ observer.observe(c); });
  }
  function onLayoutChange(){
    Array.prototype.forEach.call(document.querySelectorAll('.paper[data-layout]'), paintPaper);
  }

  ${SOUND}

  function init(){
    var had = localLoad();
    var roleBox = document.getElementById('role');
    roleBox.value = role;
    roleBox.addEventListener('input', function(){ role = roleBox.value.slice(0, 60); localSave(); dbPushRole(); refresh(); });
    var main = document.querySelector('main');
    main.addEventListener('click', onClick);
    main.addEventListener('input', onInput);
    Array.prototype.forEach.call(document.querySelectorAll('button[data-play]'), function(btn){
      btn.addEventListener('click', function(){
        var sp = btn.parentNode.querySelector('select[data-speed]');
        playSound(btn.getAttribute('data-part-key'), btn.getAttribute('data-play'), btn, sp ? Number(sp.value) : 1);
      });
    });
    document.getElementById('resume-btn').addEventListener('click', function(){ var t = totals(); if (t.firstOpen) jump(t.firstOpen[0], t.firstOpen[1]); });
    document.getElementById('export-btn').addEventListener('click', function(){ saveFile('ratings-h10-' + DATA.packetId + '.json', JSON.stringify(exportObject(), null, 1)); });
    document.getElementById('copy-btn').addEventListener('click', function(){
      var b = document.getElementById('copy-btn');
      copyText(JSON.stringify(exportObject(), null, 1), function(ok){ b.textContent = ok ? '복사했어요' : '복사 실패 - 아래 상자에서 직접 복사하세요'; setTimeout(function(){ b.textContent = '결과 복사'; }, 2500); });
    });
    document.getElementById('clear-btn').addEventListener('click', function(){
      if (!window.confirm('이 페이지의 답을 모두 지울까요? (되돌릴 수 없어요)')) return;
      answers = {}; role = ''; roleBox.value = '';
      try { window.localStorage.removeItem(KEY); } catch (e) {}
      DATA.order.forEach(function(id){ answers[id] = { t: Date.now() }; DATA.cards[id].parts.forEach(function(p){ answers[id][p] = blankPart(); }); dbSchedule(id); });
      localSave(); dbPushRole(); paintAll(); refresh();
    });
    if (mq && mq.addEventListener) mq.addEventListener('change', onLayoutChange); else if (mq && mq.addListener) mq.addListener(onLayoutChange);
    paintAll();
    refresh();
    watchCards();
    setState('local');
    dbInit();
    if (had) { var t = totals(); if (t.done > 0 && t.firstOpen) setTimeout(function(){ jump(t.firstOpen[0], t.firstOpen[1]); }, 50); }
    window.__pppReview = {
      exportObject: exportObject, key: KEY, answers: function(){ return answers; }, expandAll: paintEverything, totals: totals,
      store: { state: function(){ return store.state; }, lastError: function(){ return store.lastError; }, writes: function(){ return store.writes; }, flush: function(){ return Promise.all(Object.keys(store.timers).map(function(id){ clearTimeout(store.timers[id]); return dbPush(id); })); } },
      sound: { load: loadSamples, samples: samples, pick: pickSample, lastRun: function(){ return lastRun; }, renderOffline: renderOffline, renderNotes: function(notes){ DATA.items.probe = { tempo: 60, totalQ: 2, X: notes, Y: notes }; return renderOffline('probe', 'X', 1); }, notes: function(partKey, side){ return DATA.items[partKey][side]; } }
    };
  }
  init();
})();
`;

/* the shape of a drawing (its viewBox width / height), so the box holds its height before the drawing is unpacked and the page does not jump as pieces come near */
function shape(draw, p, side, layout) {
  const part = draw[p][side], m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(layout ? part.svgNarrow : part.svg);
  if (!m) throw new Error('a drawing has no viewBox');
  return m[1] + ' / ' + m[2];
}

/* one side of one part */
function sidePanel(item, p, side) {
  const key = item.id + p.toLowerCase();
  const tags = TAGS.map(t => '<button type="button" data-act="tag" data-side="' + side + '" data-value="' + t[0] + '" aria-pressed="false">' + esc(t[1]) + '</button>').join('');
  return '<div class="side" data-side="' + side + '">' +
    '<div class="tools"><h4>' + side + '</h4>' +
    '<button type="button" class="primary small" data-play="' + side + '" data-part-key="' + key + '" aria-pressed="false">재생</button>' +
    '<select data-speed="' + side + '" aria-label="속도"><option value="1">속도 100%</option><option value="0.8">80%</option><option value="0.6">60%</option></select></div>' +
    '<div class="paper" role="img" aria-label="' + side + ' 악보" data-svg="' + key + side + '" style="--arw:' + shape(item.draw, p, side, 0) + ';--arn:' + shape(item.draw, p, side, 1) + '"></div>' +
    '<div class="q">' + side + ' 악보를 학생에게 줄 수 있나요? <small>(작은 수정 정도는 괜찮아요)</small></div>' +
    '<div class="row two"><button type="button" data-act="pass" data-side="' + side + '" data-value="pass" aria-pressed="false">줄 수 있어요</button>' +
    '<button type="button" data-act="pass" data-side="' + side + '" data-value="fail" aria-pressed="false">못 줘요</button></div>' +
    '<div class="q">무엇이 이상한가요? <small>(여러 개 가능, 없으면 건너뛰세요)</small></div>' +
    '<div class="row tags">' + tags + '</div>' +
    '<details class="note" data-side="' + side + '"><summary>메모 쓰기 (선택)</summary>' +
    '<textarea data-side="' + side + '" maxlength="600" aria-label="' + side + ' 메모" placeholder="예: 5번째 마디 왼손 쉼표가 이상해요"></textarea></details></div>';
}

function partSection(item, p) {
  return '<section class="part" id="sec-' + item.id + '-' + p + '" data-part="' + p + '"><h3>' + esc(PARTS[p].title) + '<span class="badge-done">완료</span></h3>' +
    '<p class="what">' + esc(PARTS[p].what) + '</p>' +
    sidePanel(item, p, 'X') + sidePanel(item, p, 'Y') +
    '<div class="pref"><div class="q">어느 쪽이 더 나은가요?</div><div class="row three">' +
    '<button type="button" data-act="pref" data-value="X" aria-pressed="false">X가 더 나아요</button>' +
    '<button type="button" data-act="pref" data-value="Y" aria-pressed="false">Y가 더 나아요</button>' +
    '<button type="button" data-act="pref" data-value="same" aria-pressed="false">비슷해요</button></div></div></section>';
}

const fmtSec = s => { const t = Math.max(0, Math.round(s)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

/* the YouTube link, opened at the excerpt's first second (a plain link: the page embeds nothing and fetches nothing) */
function linkAt(url, start) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.searchParams.set('t', Math.max(0, Math.floor(start)) + 's');
    return u.toString();
  } catch (e) { return null; }
}

function itemCard(item) {
  const href = item.url ? linkAt(item.url, item.start) : null;
  const parts = item.parts.map(p => partSection(item, p)).join('');
  return '<article class="item" id="item-' + item.id + '" data-item="' + item.id + '">' +
    '<div class="item-head"><h2>' + esc(item.label) + '번 곡' + (item.title ? ' <small>' + esc(item.title) + '</small>' : '') + '</h2>' +
    (href ? '<a class="btn small" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">원곡 열기 (' + fmtSec(item.start) + '부터) ↗</a>' : '') + '</div>' +
    '<p class="aim">곡의 ' + fmtSec(item.start) + ' ~ ' + fmtSec(item.end) + ' 부분입니다. X와 Y는 같은 구간이에요 (마디 번호와 마디 수는 서로 다를 수 있어요).</p>' +
    parts + '</article>';
}

/* the first step of the introduction: the version comparison says "two ways"; the engine comparison (G10b-0) says the two scores are two readings of the same recording, and nothing more (no name of either) */
const STEP_ONE = {
  version: '<li>곡마다 같은 노래를 PPP가 <b>두 가지 방법</b>으로 악보로 만들었습니다. 그 악보가 <b>X</b>와 <b>Y</b>입니다. 어느 쪽이 어떤 방법인지는 알려드리지 않고, 곡마다 X와 Y가 바뀝니다.</li>',
  engine: '<li>곡마다 같은 노래를 PPP가 <b>두 가지로 듣고</b> 악보로 만들었습니다. 같은 녹음을 서로 다르게 읽어서 받아쓴 두 악보가 <b>X</b>와 <b>Y</b>입니다. 어느 쪽이 어떤 것인지는 알려드리지 않고, 곡마다 X와 Y가 바뀝니다. 그래서 두 악보는 음의 수, 쉼표, 마디 나눔이 서로 다를 수 있어요. 원곡과 견주어 어느 쪽이 더 맞는지 봐 주세요. 원곡에 없는 음이 적혀 있거나 있는 음이 빠져 있으면 <b>음이 빠졌거나 많아요</b>를 눌러 주세요.</li>'
};
function intro(n, minutes, lo, hi, compare) {
  return '<section class="intro"><h2>진행 방법</h2>' +
    '<ol>' +
    STEP_ONE[compare === 'engine' ? 'engine' : 'version'] +
    '<li>곡마다 두 부분이에요. <b>① 받아쓴 악보</b>는 원곡을 듣고 PPP가 적은 악보 그대로입니다. <b>② 편곡</b>은 ①의 악보에 PPP의 편곡 기능(한 손에 한 음, 중급)을 쓴 결과예요.</li>' +
    '<li>악보는 곡 중간의 일부(열두 마디 안팎, ' + (lo === hi ? '약 ' + lo + '초' : '약 ' + lo + '~' + hi + '초') + ')만 보여드립니다. X와 Y는 <b>같은 구간</b>이에요. 원곡은 <b>원곡 열기</b>로 새 탭에서 열어 그 구간을 들어 보세요 (이 페이지에는 원곡 소리가 들어 있지 않아요).</li>' +
    '<li><b>재생</b>은 악보에 적힌 음을 PPP 앱의 피아노 소리로 들려줍니다 (원곡 소리가 아니에요). 처음 한 번은 소리를 불러오느라 잠깐 걸려요.</li>' +
    '<li>부분마다 X와 Y 각각 <b>학생에게 줄 수 있나요?</b>(작은 수정 정도는 괜찮아요)를 누르고, 이상한 점이 있으면 해당 항목을 누르세요. 마지막에 <b>어느 쪽이 더 나은지</b> 하나를 고르면 그 부분은 끝입니다. 모두 한 번씩 누르면 돼요.</li>' +
    '<li>시간은 한 곡에 5~6분 정도, ' + n + '곡이면 약 ' + minutes + '분입니다. 한 번에 끝내지 않아도 됩니다. 페이지를 닫았다가 다시 열면 하던 곳에서 이어서 할 수 있어요. 시간이 모자라면 ①만 먼저 해 주셔도 큰 도움이 됩니다.</li>' +
    '<li>누를 때마다 저장됩니다. 맨 아래 <b>마무리</b>에서 결과를 보낼 수 있어요.</li></ol>' +
    '<label for="role">역할 (예: "피아노 선생님"; 이름은 적지 마세요)<input type="text" id="role" autocomplete="off" maxlength="60"></label></section>';
}

/* data: { packetId, compare?: 'engine' (G10b-0: the introduction says the two scores are two readings of the same recording), samples: [30 base64 mp3], items: [{ id, label, title, url, start, end, parts: ['T'|'A'...],
     draw: { T: { X: part, Y: part }, A?: ... } }] } with part = { svg, svgNarrow, notes, seconds } from h10-draw.js */
function pageHtml(data) {
  const items = data.items;
  const svgs = {}, playable = {}, cards = {};
  items.forEach(it => {
    cards[it.id] = { label: it.label, parts: it.parts.slice() };
    it.parts.forEach(p => {
      const key = it.id + p.toLowerCase();
      const dr = it.draw[p];
      playable[key] = { tempo: 60, totalQ: Math.max(dr.X.seconds, dr.Y.seconds), X: dr.X.notes, Y: dr.Y.notes };
      ['X', 'Y'].forEach(side => { svgs[key + side] = { w: dr[side].svg, n: dr[side].svgNarrow }; });
    });
  });
  /* one list of drawings: key|layout -> svg */
  const flat = {};
  Object.keys(svgs).forEach(k => { flat[k + '|0'] = svgs[k].w; flat[k + '|1'] = svgs[k].n; });
  const hoisted = SVGPACK.hoistDefs(flat);
  const packed = SVGPACK.pack(hoisted.bodies);
  const svgData = {};
  Object.keys(svgs).forEach(k => {
    const dims = [0, 1].map(i => { const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(flat[k + '|' + i]); if (!m) throw new Error('a drawing has no viewBox: ' + k); return [Number(m[1]), Number(m[2])]; });
    svgData[k] = { dims: dims, svg: [packed.packed[k + '|0'], packed.packed[k + '|1']] };
  });
  const payload = { packetId: data.packetId, mode: 'h10', order: items.map(i => i.id), cards: cards, items: playable, tags: TAGS.map(t => t[0]) };
  const minutes = Math.round(items.length * MINUTES_PER_ITEM / 5) * 5;
  const secs = items.map(i => Math.round(i.end - i.start)).filter(x => x > 0);
  const secLo = secs.length ? Math.min.apply(null, secs) : 0, secHi = secs.length ? Math.max.apply(null, secs) : 0;
  const engine = data.compare === 'engine';
  const title = engine ? 'H-10b 악보 비교' : 'H-10 악보 비교';
  /* the engine comparison names no browser anywhere, in the Korean words either (the alert of a device without Web Audio says "this device") */
  const script = engine ? JS.split('이 브라우저는').join('이 기기는') : JS;
  return '<!DOCTYPE html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>' + esc(title) + '</title><style>' + CSS + '</style></head><body>\n' +
    '<svg class="hidden-defs" aria-hidden="true" focusable="false"><defs>' + hoisted.symbols.join('') + '</defs></svg>\n' +
    '<header class="bar"><div class="bar-row"><h1>' + esc(title) + '</h1><span id="save-state"></span><span class="progress" id="progress" aria-live="polite"></span>' +
    '<button type="button" class="small primary" id="resume-btn" hidden>이어서 하기</button></div><div class="meter"><i id="meter-fill"></i></div></header>\n' +
    '<main>' + intro(items.length, minutes, secLo, secHi, data.compare) + '\n' + items.map(itemCard).join('\n') + '\n' +
    '<section id="summary"><h2>마무리</h2><p id="summary-status" class="prog-line"></p>' +
    '<div id="summary-open-wrap" hidden><p class="prog-line">아직 안 한 부분 (눌러서 이동):</p><ul class="summary-list" id="summary-open"></ul></div>' +
    '<p>답은 이 기기' + (engine ? '' : '(브라우저)') + '에 저장되어 있고, 서버에 저장되는 환경에서는 서버에도 저장됩니다 (맨 위 오른쪽 글자로 알 수 있어요). 아래 단추로 결과를 내려받거나 복사해서 보내 주세요.</p>' +
    '<div class="row two"><button type="button" class="primary" id="export-btn">결과 내려받기 (JSON)</button><button type="button" id="copy-btn">결과 복사</button></div>' +
    '<details class="export"><summary>결과를 글자로 보기 (내려받기가 막혔을 때 여기서 복사하세요)</summary><textarea id="export-json" readonly aria-label="결과"></textarea></details>' +
    '<p><button type="button" class="ghost small" id="clear-btn">모든 답 지우기</button></p></section>\n' +
    CREDIT + '<p class="packet-no">검토 번호 ' + esc(data.packetId) + '</p></main>' + String.fromCharCode(10) +
    (data.samples && data.samples.length ? '<script id="piano-samples" type="application/json">' + scriptJson(data.samples) + '</script>\n' : '') +
    '<script id="svg-dict" type="application/json">' + scriptJson(packed.dict) + '</script>\n' +
    '<script id="svg-data" type="application/json">' + scriptJson(svgData) + '</script>\n' +
    '<script id="packet-data" type="application/json">' + scriptJson(payload) + '</script>\n<script>' + script + '</script>\n</body></html>\n';
}

/* the drawings of a finished page as plain SVG strings, for tests and checks: key (e.g. "i01tX") -> [wide, narrow] with the shared glyphs put back in */
function drawingsOf(html) {
  const grab = id => { const m = new RegExp('<script id="' + id + '" type="application/json">([\\s\\S]*?)</script>').exec(html); if (!m) throw new Error('no ' + id); return JSON.parse(m[1]); };
  const dict = grab('svg-dict'), data = grab('svg-data');
  const defs = /<svg class="hidden-defs"[^>]*><defs>([\s\S]*?)<\/defs><\/svg>/.exec(html)[1];
  const out = {};
  Object.keys(data).forEach(k => {
    out[k] = data[k].svg.map(s => SVGPACK.unpack(dict, s).replace(/^(<svg[^>]*>)\n?/, '$1<defs>' + defs + '</defs>\n'));
  });
  return out;
}

module.exports = { pageHtml, drawingsOf, TAGS, PARTS, MINUTES_PER_ITEM, CREDIT, letter, CSS, SOUND, esc, scriptJson, linkAt, fmtSec };
