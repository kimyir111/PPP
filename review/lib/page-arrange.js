/* H-10c: the reviewer's page for the blind check of the NOTES of PPP's one-note-per-hand copies of piano covers - ONE self-contained HTML file, Korean, made for a
   phone (a 360 px column, large touch targets, one tap per choice), working from disk and as an Artifact page. The same skeleton as the H-10 page (review/lib/page-h10.js:
   its styles, its piano player, its packed drawings, its answer keeping), with another set of questions.

   Per piece ("A번 곡", "B번 곡" ...): a link to the original on YouTube (a new tab; no recording audio is in the page) and, for each level (초급, 중급; one part when the two
   levels give the same copies), either
     a PAIR   two scores X and Y of the SAME bars of the piece, two ways of making the copy; or
     a SINGLE one score, when only one of the two ways made a copy (which way is not said).
   Per score: "음(멜로디)이 원곡과 맞나요?" (맞아요 / 대체로 맞아요 / 틀린 곳이 많아요) and "학생에게 줄 수 있나요?" (그대로 / 조금 고치면 / 안 돼요); per pair: "어느 쪽이 나아요?"
   (X / 비슷해요 / Y); per part an optional note. Which of X and Y is which way is decided by a secret seed at build time and is nowhere in this file.

   Answers are kept as in H-10: in memory, in localStorage on every tap (try/catch: with no storage the page still works) and, when the page runs as an Artifact with the `db`
   capability, in the artifact database through the small adapter `store` below (window.claude.use('db'); documents answers/<packetId>/items/<id>, and answers/<packetId> for
   the reviewer's role; per item the newer `t` wins on load). The same file works with no capability at all; the header says which it is doing. Export: ratings JSON (format
   ppp-review-ratings/3, mode h10, compare arrange) by download, copy, or a text box.

   Wording rule: nothing on the page - text, class, id, script identifier - may name either way of making a copy; the builder scans the finished file (review/lib/h10-leak.js
   scanArrange) and refuses to write a packet that does. The script therefore never uses Array.prototype.reduce, and says nothing of a method. */
'use strict';
const H = require('./page-h10.js');
const SVGPACK = require('./svgpack.js');
const { esc, scriptJson, letter, CSS, CREDIT, linkAt, fmtSec } = H;
/* the H-10 page's player, with its one use of Array.prototype.reduce (the count of decoded recordings) written as a loop: this page's script may not contain that word (the builder's scan
   reads the script, and "reduce" is one of the two methods' names) */
const SUM_FROM = 'finish(r.reduce(function(a, b){ return a + b; }, 0))';
if (H.SOUND.indexOf(SUM_FROM) < 0) throw new Error('page-arrange: the sound block changed (the count of decoded recordings)');
const SOUND = H.SOUND.split(SUM_FROM).join('finish((function(){ var n = 0; r.forEach(function(x){ n += x; }); return n; })())');

const NOTES = [['ok', '맞아요'], ['mostly', '대체로 맞아요'], ['many', '틀린 곳이 많아요']];
const HANDS = [['asis', '그대로'], ['fix', '조금 고치면'], ['no', '안 돼요']];
const PREFS = [['X', 'X가 나아요'], ['same', '비슷해요'], ['Y', 'Y가 나아요']];
const Q_NOTES = '음(멜로디)이 원곡과 맞나요?';
const Q_HAND = '학생에게 줄 수 있나요?';
const Q_PREF = '어느 쪽이 나아요?';
const LEVEL_NAME = { beginner: '초급', intermediate: '중급' };
/* minutes: looking at a score, playing it and listening to the original takes about two; a pair is two scores and one choice; each piece costs half a minute to open the original */
const MINUTES = { single: 2, pair: 4.5, piece: 0.5 };
const TITLE = 'H-10c 악보 확인';

const CSS_EXTRA = `
button[data-act=notes][data-value=ok][aria-pressed=true],button[data-act=hand][data-value=asis][aria-pressed=true]{border-color:var(--ok);background:var(--okbg)}
button[data-act=notes][data-value=many][aria-pressed=true],button[data-act=hand][data-value=no][aria-pressed=true]{border-color:var(--bad);background:var(--badbg)}
.row.three button{flex:1 1 28%;padding:6px 6px;line-height:1.3}
.hint{margin:2px 0 6px;color:var(--muted);font-size:13px}
.q-gap{margin-top:12px}
`;

/* the layout shape (viewBox width / height) of a drawn copy, so its box holds its height before it is unpacked */
function shapeOf(part, layout) {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(layout ? part.svgNarrow : part.svg);
  if (!m) throw new Error('a drawing has no viewBox');
  return m[1] + ' / ' + m[2];
}
const choiceRow = (act, side, list, cls) => '<div class="row ' + (cls || 'three') + '">' + list.map(c =>
  '<button type="button" data-act="' + act + '" data-side="' + side + '" data-value="' + c[0] + '" aria-pressed="false">' + esc(c[1]) + '</button>').join('') + '</div>';

/* one drawn copy: its label (X, Y, or none), Play, the score and the two questions */
function copyPanel(item, part, side) {
  const key = item.id + part.key.toLowerCase();
  const single = side === 'S', who = single ? '' : side + ' ';
  return '<div class="side" data-side="' + side + '">' +
    '<div class="tools">' + (single ? '' : '<h4>' + side + '</h4>') +
    '<button type="button" class="primary small" data-play="' + side + '" data-part-key="' + key + '" aria-pressed="false">재생</button>' +
    '<select data-speed="' + side + '" aria-label="속도"><option value="1">속도 100%</option><option value="0.8">80%</option><option value="0.6">60%</option></select></div>' +
    '<div class="paper" role="img" aria-label="' + (single ? '악보' : side + ' 악보') + '" data-svg="' + key + side + '" style="--arw:' + shapeOf(part.draw[side], 0) + ';--arn:' + shapeOf(part.draw[side], 1) + '"></div>' +
    '<div class="q">' + who + esc(Q_NOTES) + '</div>' + choiceRow('notes', side, NOTES) +
    '<div class="q q-gap">' + who + esc(Q_HAND) + '</div>' + choiceRow('hand', side, HANDS) + '</div>';
}

function partSection(item, part) {
  const pair = part.kind === 'pair';
  const what = (pair ? '같은 마디를 두 가지 방식으로 편곡한 악보 X와 Y입니다.' : '이 부분은 악보가 하나만 있어요.') + (part.levels.length > 1 ? ' 초급과 중급의 악보가 같아서 하나로 합쳤어요.' : '');
  return '<section class="part" id="sec-' + item.id + '-' + part.key + '" data-part="' + part.key + '"><h3>' + esc(part.title) + '<span class="badge-done">완료</span></h3>' +
    '<p class="what">' + esc(what) + '</p>' +
    (pair ? copyPanel(item, part, 'X') + copyPanel(item, part, 'Y') + '<div class="pref"><div class="q">' + esc(Q_PREF) + '</div>' + choiceRow('pref', 'P', PREFS) + '</div>' : copyPanel(item, part, 'S')) +
    '<details class="note"><summary>메모 쓰기 (선택)</summary><textarea data-part-text="1" maxlength="600" aria-label="메모" placeholder="예: 3번째 마디 멜로디가 원곡과 달라요"></textarea></details></section>';
}

function itemCard(item) {
  const href = item.url ? linkAt(item.url, item.start) : null;
  return '<article class="item" id="item-' + item.id + '" data-item="' + item.id + '">' +
    '<div class="item-head"><h2>' + esc(item.label) + '번 곡' + (item.title ? ' <small>' + esc(item.title) + '</small>' : '') + '</h2>' +
    (href ? '<a class="btn small" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">원곡 열기 (' + fmtSec(item.start) + '부터) ↗</a>' : '') + '</div>' +
    '<p class="aim">곡의 ' + fmtSec(item.start) + ' ~ ' + fmtSec(item.end) + ' 부분입니다. 아래 악보는 모두 이 구간의 같은 마디예요.</p>' +
    item.parts.map(p => partSection(item, p)).join('') + '</article>';
}

function intro(n, minutes, lo, hi) {
  return '<section class="intro"><h2>진행 방법</h2><ol>' +
    '<li>곡마다 같은 피아노 연주를 PPP가 <b>쉽게 편곡한 악보</b>를 보여드립니다. 악보가 둘(<b>X</b>와 <b>Y</b>)인 곳은 같은 연주를 PPP가 두 가지 방식으로 편곡한 것이고, 하나뿐인 곳은 한 가지 방식으로만 악보가 만들어진 곳이에요. 어느 쪽이 어떤 방식인지는 알려드리지 않고, 곡마다 X와 Y가 바뀝니다.</li>' +
    '<li>곡마다 <b>초급</b>과 <b>중급</b> 악보를 봅니다. 두 난이도의 악보가 같은 곡은 하나로 합쳐 보여드려요.</li>' +
    '<li>악보는 곡 중간의 일부(열두 마디 안팎, ' + (lo === hi ? '약 ' + lo + '초' : '약 ' + lo + '~' + hi + '초') + ')만 보여드립니다. <b>원곡 열기</b>로 새 탭에서 원곡을 열어 그 구간을 들으며 견주어 보세요 (이 페이지에는 원곡 소리가 들어 있지 않아요).</li>' +
    '<li><b>재생</b>은 악보에 적힌 음을 PPP 앱의 피아노 소리로 들려줍니다 (원곡 소리가 아니에요). 처음 한 번은 소리를 불러오느라 잠깐 걸려요.</li>' +
    '<li>악보마다 두 가지를 눌러 주세요. <b>' + esc(Q_NOTES) + '</b> 오른손 멜로디의 음이 원곡과 같은지가 핵심이에요. 반주(왼손)는 쉽게 바꾼 것이라 원곡과 달라도 괜찮아요. <b>' + esc(Q_HAND) + '</b> 작은 수정 정도는 "조금 고치면"이에요. 악보가 둘이면 마지막에 <b>' + esc(Q_PREF) + '</b>도 골라 주세요. 하고 싶은 말은 메모(선택)에 적어 주세요.</li>' +
    '<li>시간은 ' + n + '곡이면 약 ' + minutes + '분입니다. 한 번에 끝내지 않아도 됩니다. 페이지를 닫았다가 다시 열면 하던 곳에서 이어서 할 수 있어요.</li>' +
    '<li>누를 때마다 저장됩니다. 맨 아래 <b>마무리</b>에서 결과를 보낼 수 있어요.</li></ol>' +
    '<label for="role">역할 (예: "피아노 선생님"; 이름은 적지 마세요)<input type="text" id="role" autocomplete="off" maxlength="60"></label></section>';
}

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

  function kindOf(id, p){ return DATA.cards[id].kinds[p]; }
  function blankCopy(){ return { notes: null, hand: null }; }
  function blankPart(kind){ return kind === 'single' ? { S: blankCopy(), text: '' } : { pref: null, X: blankCopy(), Y: blankCopy(), text: '' }; }
  function oneOf(v, list){ return list.indexOf(v) >= 0 ? v : null; }
  function sanitizeCopy(c){ c = c || {}; return { notes: oneOf(c.notes, DATA.choices.notes), hand: oneOf(c.hand, DATA.choices.hand) }; }
  function sanitizePart(kind, p){
    p = p || {};
    var text = typeof p.text === 'string' ? p.text.slice(0, 600) : '';
    return kind === 'single' ? { S: sanitizeCopy(p.S), text: text } : { pref: oneOf(p.pref, DATA.choices.pref), X: sanitizeCopy(p.X), Y: sanitizeCopy(p.Y), text: text };
  }
  function sanitizeItem(id, v){
    var o = { t: typeof v.t === 'number' ? v.t : 0 };
    DATA.cards[id].parts.forEach(function(p){ o[p] = sanitizePart(kindOf(id, p), v[p]); });
    return o;
  }
  function part(id, p){
    if (!answers[id]) answers[id] = { t: 0 };
    if (!answers[id][p]) answers[id][p] = blankPart(kindOf(id, p));
    return answers[id][p];
  }
  function copyDone(c){ return !!(c && c.notes !== null && c.hand !== null); }
  function partDone(id, p){
    var a = answers[id] && answers[id][p];
    if (!a) return false;
    return kindOf(id, p) === 'single' ? copyDone(a.S) : (a.pref !== null && copyDone(a.X) && copyDone(a.Y));
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
    DATA.cards[id].parts.forEach(function(p){ body[p] = answers[id][p] || blankPart(kindOf(id, p)); });
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
    var kind = kindOf(id, p), a = answers[id] && answers[id][p] || blankPart(kind);
    var press = function(sel, on){ Array.prototype.forEach.call(sec.querySelectorAll(sel), function(b){ b.setAttribute('aria-pressed', on(b) ? 'true' : 'false'); }); };
    if (kind === 'pair') press('button[data-act="pref"]', function(b){ return a.pref === b.getAttribute('data-value'); });
    (kind === 'single' ? ['S'] : ['X', 'Y']).forEach(function(side){
      ['notes', 'hand'].forEach(function(act){
        press('button[data-side="' + side + '"][data-act="' + act + '"]', function(b){ return a[side][act] === b.getAttribute('data-value'); });
      });
    });
    var t = sec.querySelector('textarea[data-part-text]');
    if (t && t.value !== a.text) t.value = a.text;
    var d = sec.querySelector('details.note');
    if (d && a.text) d.open = true;
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
    else if ((act === 'notes' || act === 'hand') && a[side]) a[side][act] = a[side][act] === v ? null : v;
    else return;
    paintPart(card, p);
    touch(id);
  }
  function onInput(ev){
    var t = ev.target;
    if (!t || t.tagName !== 'TEXTAREA' || !t.getAttribute('data-part-text')) return;
    var card = cardOf(t), sec = t.closest('section.part');
    if (!card || !sec) return;
    var id = card.getAttribute('data-item');
    part(id, sec.getAttribute('data-part')).text = t.value.slice(0, 600);
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
  function copyOut(c){ return { notes: c.notes, hand: c.hand }; }
  function exportObject(){
    return {
      format: 'ppp-review-ratings/3', mode: 'h10', compare: 'arrange', packetId: DATA.packetId, reviewer: role, exportedAt: new Date().toISOString(),
      items: DATA.order.map(function(id){
        var a = answers[id] || {}, o = { id: id };
        DATA.cards[id].parts.forEach(function(p){
          var x = a[p] || blankPart(kindOf(id, p));
          o[p] = kindOf(id, p) === 'single' ? { S: copyOut(x.S), text: x.text } : { preference: x.pref, X: copyOut(x.X), Y: copyOut(x.Y), text: x.text };
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
      a.textContent = DATA.cards[x[0]].label + '번 곡 ' + DATA.cards[x[0]].titles[x[1]];
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
    document.getElementById('export-btn').addEventListener('click', function(){ saveFile('ratings-h10c-' + DATA.packetId + '.json', JSON.stringify(exportObject(), null, 1)); });
    document.getElementById('copy-btn').addEventListener('click', function(){
      var b = document.getElementById('copy-btn');
      copyText(JSON.stringify(exportObject(), null, 1), function(ok){ b.textContent = ok ? '복사했어요' : '복사 실패 - 아래 상자에서 직접 복사하세요'; setTimeout(function(){ b.textContent = '결과 복사'; }, 2500); });
    });
    document.getElementById('clear-btn').addEventListener('click', function(){
      if (!window.confirm('이 페이지의 답을 모두 지울까요? (되돌릴 수 없어요)')) return;
      answers = {}; role = ''; roleBox.value = '';
      try { window.localStorage.removeItem(KEY); } catch (e) {}
      DATA.order.forEach(function(id){ answers[id] = { t: Date.now() }; DATA.cards[id].parts.forEach(function(p){ answers[id][p] = blankPart(kindOf(id, p)); }); dbSchedule(id); });
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

/* the minutes a review takes: parts of a pair, single parts, and the pieces */
function minutesFor(items) {
  let m = 0;
  items.forEach(it => { m += MINUTES.piece; it.parts.forEach(p => { m += p.kind === 'pair' ? MINUTES.pair : MINUTES.single; }); });
  return Math.max(5, Math.round(m / 5) * 5);
}

/* data: { packetId, samples: [30 base64 mp3], items: [{ id, label, title, url, start, end, parts: [{ key, title, kind: 'pair'|'single', levels: [level names], draw: { X, Y } | { S } }] }] }
   with a drawn copy = { svg, svgNarrow, notes, seconds } from h10-draw.js */
function pageHtml(data) {
  const items = data.items;
  const svgs = {}, playable = {}, cards = {};
  items.forEach(it => {
    cards[it.id] = { label: it.label, parts: it.parts.map(p => p.key), kinds: {}, titles: {} };
    it.parts.forEach(p => {
      cards[it.id].kinds[p.key] = p.kind; cards[it.id].titles[p.key] = p.title;
      const key = it.id + p.key.toLowerCase(), sides = p.kind === 'pair' ? ['X', 'Y'] : ['S'];
      playable[key] = { tempo: 60, totalQ: Math.max.apply(null, sides.map(s => p.draw[s].seconds)) };
      sides.forEach(s => { playable[key][s] = p.draw[s].notes; svgs[key + s] = { w: p.draw[s].svg, n: p.draw[s].svgNarrow }; });
    });
  });
  const flat = {};
  Object.keys(svgs).forEach(k => { flat[k + '|0'] = svgs[k].w; flat[k + '|1'] = svgs[k].n; });
  const hoisted = SVGPACK.hoistDefs(flat);
  const packed = SVGPACK.pack(hoisted.bodies);
  const svgData = {};
  Object.keys(svgs).forEach(k => {
    const dims = [0, 1].map(i => { const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(flat[k + '|' + i]); if (!m) throw new Error('a drawing has no viewBox: ' + k); return [Number(m[1]), Number(m[2])]; });
    svgData[k] = { dims: dims, svg: [packed.packed[k + '|0'], packed.packed[k + '|1']] };
  });
  const payload = { packetId: data.packetId, mode: 'h10', compare: 'arrange', order: items.map(i => i.id), cards: cards, items: playable,
    choices: { notes: NOTES.map(c => c[0]), hand: HANDS.map(c => c[0]), pref: PREFS.map(c => c[0]) } };
  const minutes = minutesFor(items);
  const secs = items.map(i => Math.round(i.end - i.start)).filter(x => x > 0);
  const secLo = secs.length ? Math.min.apply(null, secs) : 0, secHi = secs.length ? Math.max.apply(null, secs) : 0;
  /* no word of "browser" on the page (the alert of a device without Web Audio says "this device") */
  const script = JS.split('이 브라우저는').join('이 기기는');
  return '<!DOCTYPE html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>' + esc(TITLE) + '</title><style>' + CSS + CSS_EXTRA + '</style></head><body>\n' +
    '<svg class="hidden-defs" aria-hidden="true" focusable="false"><defs>' + hoisted.symbols.join('') + '</defs></svg>\n' +
    '<header class="bar"><div class="bar-row"><h1>' + esc(TITLE) + '</h1><span id="save-state"></span><span class="progress" id="progress" aria-live="polite"></span>' +
    '<button type="button" class="small primary" id="resume-btn" hidden>이어서 하기</button></div><div class="meter"><i id="meter-fill"></i></div></header>\n' +
    '<main>' + intro(items.length, minutes, secLo, secHi) + '\n' + items.map(itemCard).join('\n') + '\n' +
    '<section id="summary"><h2>마무리</h2><p id="summary-status" class="prog-line"></p>' +
    '<div id="summary-open-wrap" hidden><p class="prog-line">아직 안 한 부분 (눌러서 이동):</p><ul class="summary-list" id="summary-open"></ul></div>' +
    '<p>답은 이 기기에 저장되어 있고, 서버에 저장되는 환경에서는 서버에도 저장됩니다 (맨 위 오른쪽 글자로 알 수 있어요). 아래 단추로 결과를 내려받거나 복사해서 보내 주세요.</p>' +
    '<div class="row two"><button type="button" class="primary" id="export-btn">결과 내려받기 (JSON)</button><button type="button" id="copy-btn">결과 복사</button></div>' +
    '<details class="export"><summary>결과를 글자로 보기 (내려받기가 막혔을 때 여기서 복사하세요)</summary><textarea id="export-json" readonly aria-label="결과"></textarea></details>' +
    '<p><button type="button" class="ghost small" id="clear-btn">모든 답 지우기</button></p></section>\n' +
    CREDIT + '<p class="packet-no">검토 번호 ' + esc(data.packetId) + '</p></main>' + String.fromCharCode(10) +
    (data.samples && data.samples.length ? '<script id="piano-samples" type="application/json">' + scriptJson(data.samples) + '</script>\n' : '') +
    '<script id="svg-dict" type="application/json">' + scriptJson(packed.dict) + '</script>\n' +
    '<script id="svg-data" type="application/json">' + scriptJson(svgData) + '</script>\n' +
    '<script id="packet-data" type="application/json">' + scriptJson(payload) + '</script>\n<script>' + script + '</script>\n</body></html>\n';
}

module.exports = { pageHtml, drawingsOf: H.drawingsOf, NOTES, HANDS, PREFS, LEVEL_NAME, MINUTES, TITLE, minutesFor, letter, CREDIT };
