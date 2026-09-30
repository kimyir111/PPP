/* G9c: the reviewer's page - ONE self-contained HTML file per packet (inline CSS and JS, no network, no fonts or scripts from
   anywhere, opens from disk).

   Per item: the two arrangements X and Y as engraved scores (SVG, drawn Node-side by engrave/, see neutral.js; each is embedded
   twice, laid out for a wide and for a narrow screen, and a media query at 720 px shows one, so a phone needs no sideways
   scrolling; the rating logic and the sound never read the drawings), a Play button
   for each (a small Web Audio synth of the same notes the score shows; nothing is loaded), and a form.
     H-8 (diagnostic): which is better (X / Y / no difference), and per arrangement: issue checkboxes (too hard, too easy, wrong
                       harmony, melody unclear, awkward hand position, thin/muddy) and a short "what is wrong" text.
     H-9 (pass/fail):  per arrangement: would you give this to a student - pass or fail (and an optional note); an optional
                       preference.
   Ratings are kept in localStorage as the reviewer works (wrapped in try/catch: with no storage the page still works, it just
   does not remember) and exported by a button as a JSON file (with the same JSON shown in a box to copy, in case a download
   is blocked). `review/decode.js` combines that file with the key.

   Wording rule: nothing on the page - text, CSS class, script identifier - may name the arrangers or the way an arrangement was
   made; tests/review scans the finished file for the words that would. */
'use strict';

const ISSUES = [
  ['too-hard', '너무 어려움'], ['too-easy', '너무 쉬움'], ['wrong-harmony', '화성이 이상함'], ['melody-unclear', '멜로디가 잘 안 들림'],
  ['awkward-hand', '손 위치가 불편함'], ['thin-muddy', '소리가 빈약하거나 탁함']
];
const STAGE_NAMES = { 1: '입문', 2: '초급', 3: '중급', 4: '중상급' };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/* JSON safe inside a <script> element */
const scriptJson = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const CSS = `
:root{color-scheme:light;--ink:#1c1b19;--muted:#5f5a52;--line:#ddd6ca;--bg:#f5f2ec;--card:#fffdf9;--accent:#1f5c8a;--ok:#1d7a46;--bad:#a83232}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
header.bar{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
header.bar h1{font-size:17px;margin:0;flex:1 1 220px}
.progress{font-size:14px;color:var(--muted)}
button,.btn{font:inherit;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:7px 14px;cursor:pointer;min-height:40px}
button.ghost{background:transparent;color:var(--accent)}
button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #f0a020;outline-offset:2px}
main{max-width:1180px;margin:0 auto;padding:16px}
.intro{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin-bottom:18px}
.intro label{display:block;margin-top:8px}
.intro input[type=text]{width:100%;max-width:340px;padding:8px;border:1px solid var(--line);border-radius:6px;font:inherit}
article.item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:0 0 22px}
article.item h2{font-size:18px;margin:0 0 2px}
.aim{color:var(--muted);font-size:14px;margin:0 0 10px}
.panel{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}
.panel h3{font-size:16px;margin:0 8px 8px 0;display:inline-block}
.tools{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap;vertical-align:middle}
.tools select{font:inherit;padding:6px;border-radius:6px;border:1px solid var(--line)}
.paper{background:#fffef9;color:#111;border:1px solid var(--line);border-radius:6px;margin:8px 0}
.paper svg{display:block;width:100%;height:auto}
.paper .narrow{display:none}
@media (max-width:720px){.paper .wide{display:none}.paper .narrow{display:block}}
fieldset{border:1px solid var(--line);border-radius:8px;margin:8px 0;padding:8px 12px}
legend{padding:0 6px;font-weight:600;font-size:14px}
.opts{display:flex;flex-wrap:wrap;gap:6px 18px}
.opts label{display:inline-flex;gap:6px;align-items:center;min-height:32px}
textarea{width:100%;font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;min-height:52px;resize:vertical}
.pref{background:#eef3f7;border-color:#c5d5e2}
details{margin:16px 0}
details textarea{min-height:140px;font:13px/1.4 ui-monospace,Menlo,Consolas,monospace}
.done{color:var(--ok);font-weight:600}
@media (max-width:640px){main{padding:10px}.intro,article.item{padding:12px}}
`;

const JS = `
(function(){
  var DATA = JSON.parse(document.getElementById('packet-data').textContent);
  var KEY = 'ppp-review:' + DATA.packetId;
  var ratings = {};
  var role = '';

  function load(){
    try { var raw = window.localStorage.getItem(KEY); if (raw) { var o = JSON.parse(raw); if (o && o.packetId === DATA.packetId) { ratings = o.ratings || {}; role = o.role || ''; } } } catch (e) { /* no storage: start empty */ }
  }
  function persist(){
    try { window.localStorage.setItem(KEY, JSON.stringify({ packetId: DATA.packetId, role: role, ratings: ratings })); } catch (e) { /* no storage: the page still works, it just does not remember */ }
  }
  function blank(){ return { preference: null, X: { pass: null, issues: [], text: '' }, Y: { pass: null, issues: [], text: '' } }; }

  function readItem(card){
    var id = card.getAttribute('data-item');
    var r = blank();
    var pref = card.querySelector('input[name="pref-' + id + '"]:checked');
    r.preference = pref ? pref.value : null;
    ['X', 'Y'].forEach(function(side){
      var p = card.querySelector('input[name="pass-' + id + '-' + side + '"]:checked');
      r[side].pass = p ? p.value === 'pass' : null;
      var boxes = card.querySelectorAll('input[data-issue][data-side="' + side + '"]:checked');
      r[side].issues = Array.prototype.map.call(boxes, function(b){ return b.getAttribute('data-issue'); });
      var t = card.querySelector('textarea[data-side="' + side + '"]');
      r[side].text = t ? t.value : '';
    });
    return r;
  }
  function writeItem(card, r){
    var id = card.getAttribute('data-item');
    var pref = card.querySelectorAll('input[name="pref-' + id + '"]');
    Array.prototype.forEach.call(pref, function(i){ i.checked = r.preference === i.value; });
    ['X', 'Y'].forEach(function(side){
      var v = r[side] || {};
      Array.prototype.forEach.call(card.querySelectorAll('input[name="pass-' + id + '-' + side + '"]'), function(i){ i.checked = v.pass !== null && v.pass !== undefined && ((i.value === 'pass') === v.pass); });
      Array.prototype.forEach.call(card.querySelectorAll('input[data-issue][data-side="' + side + '"]'), function(i){ i.checked = (v.issues || []).indexOf(i.getAttribute('data-issue')) >= 0; });
      var t = card.querySelector('textarea[data-side="' + side + '"]');
      if (t) t.value = v.text || '';
    });
  }
  function isDone(r){
    if (DATA.mode === 'h9') return r.X.pass !== null && r.Y.pass !== null;
    return r.preference !== null;
  }
  function exportObject(){
    var list = DATA.order.map(function(id){ var r = ratings[id] || blank(); return { id: id, preference: r.preference, X: r.X, Y: r.Y }; });
    return { format: 'ppp-review-ratings/1', packetId: DATA.packetId, mode: DATA.mode, reviewer: role, exportedAt: new Date().toISOString(), ratings: list };
  }
  function refresh(){
    var n = 0;
    DATA.order.forEach(function(id){ if (ratings[id] && isDone(ratings[id])) n++; });
    document.getElementById('progress').textContent = n + ' / ' + DATA.order.length + ' 문항 평가함';
    document.getElementById('export-json').value = JSON.stringify(exportObject(), null, 1);
  }
  function onChange(ev){
    var card = ev.target.closest ? ev.target.closest('article.item') : null;
    if (!card) return;
    ratings[card.getAttribute('data-item')] = readItem(card);
    persist(); refresh();
  }

  /* ---- sound: a small additive synth of the notes the score shows (no samples, no network) ---- */
  var AC = null, live = null;
  function stopSound(){
    if (!live) return;
    live.nodes.forEach(function(n){ try { n.stop(); } catch (e) {} });
    clearTimeout(live.timer);
    live.btn.textContent = '재생'; live.btn.setAttribute('aria-pressed', 'false');
    live = null;
  }
  function playSound(id, side, btn, speed){
    if (live && live.btn === btn) { stopSound(); return; }
    stopSound();
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { alert('이 브라우저는 소리 재생(Web Audio)을 지원하지 않습니다.'); return; }
    if (!AC) AC = new Ctor();
    if (AC.state === 'suspended') AC.resume();
    var it = DATA.items[id], notes = it[side];
    var spq = 60 / (it.tempo * speed);
    var t0 = AC.currentTime + 0.12, nodes = [];
    var master = AC.createGain(); master.gain.value = 0.16;
    var comp = AC.createDynamicsCompressor();
    master.connect(comp); comp.connect(AC.destination);
    notes.forEach(function(n){
      var t = t0 + n[0] * spq, dur = Math.max(n[1] * spq, 0.18);
      var f = 440 * Math.pow(2, (n[2] - 69) / 12);
      var env = AC.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(0.9, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.35, t + Math.min(dur, 1.6));
      env.gain.setValueAtTime(0.35, t + dur);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
      env.connect(master);
      var a = AC.createOscillator(); a.type = 'triangle'; a.frequency.value = f;
      var b = AC.createOscillator(); b.type = 'sine'; b.frequency.value = f * 2;
      var bg = AC.createGain(); bg.gain.value = 0.3;
      a.connect(env); b.connect(bg); bg.connect(env);
      a.start(t); b.start(t); a.stop(t + dur + 0.3); b.stop(t + dur + 0.3);
      nodes.push(a, b);
    });
    btn.textContent = '정지'; btn.setAttribute('aria-pressed', 'true');
    live = { nodes: nodes, btn: btn, timer: setTimeout(function(){ if (live && live.btn === btn) stopSound(); }, (it.totalQ * spq + 0.8) * 1000) };
  }

  function init(){
    load();
    var roleBox = document.getElementById('role');
    roleBox.value = role;
    roleBox.addEventListener('input', function(){ role = roleBox.value; persist(); refresh(); });
    Array.prototype.forEach.call(document.querySelectorAll('article.item'), function(card){
      var id = card.getAttribute('data-item');
      if (ratings[id]) writeItem(card, ratings[id]);
      card.addEventListener('change', onChange);
      card.addEventListener('input', onChange);
      Array.prototype.forEach.call(card.querySelectorAll('button[data-play]'), function(btn){
        btn.addEventListener('click', function(){
          var side = btn.getAttribute('data-play');
          var sp = card.querySelector('select[data-speed="' + side + '"]');
          playSound(id, side, btn, sp ? Number(sp.value) : 1);
        });
      });
    });
    document.getElementById('export-btn').addEventListener('click', function(){
      var text = JSON.stringify(exportObject(), null, 1);
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ratings-' + DATA.mode + '-' + DATA.packetId + '.json';
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
    document.getElementById('clear-btn').addEventListener('click', function(){
      if (!window.confirm('이 페이지의 평가를 모두 지울까요?')) return;
      ratings = {}; role = ''; roleBox.value = '';
      try { window.localStorage.removeItem(KEY); } catch (e) {}
      Array.prototype.forEach.call(document.querySelectorAll('article.item'), function(card){ writeItem(card, blank()); });
      refresh();
    });
    refresh();
    window.__pppReview = { exportObject: exportObject, key: KEY };
  }
  init();
})();
`;

function issueBoxes(id, side) {
  return ISSUES.map(([k, label]) => '<label><input type="checkbox" data-issue="' + k + '" data-side="' + side + '"> ' + esc(label) + '</label>').join('');
}

function panel(mode, it, side) {
  const head = '<div class="tools"><h3>편곡 ' + side + '</h3>' +
    '<button type="button" data-play="' + side + '" aria-pressed="false">재생</button>' +
    '<label>속도 <select data-speed="' + side + '"><option value="1">100%</option><option value="0.8">80%</option><option value="0.6">60%</option></select></label></div>';
  /* the same music drawn twice, for a wide and for a narrow screen (neutral.js); CSS shows one, so a phone reads a score laid out for its width */
  const svg = '<div class="paper" role="img" aria-label="편곡 ' + side + '의 악보: ' + esc(it.title) + '"><div class="wide">' + it[side].svg + '</div><div class="narrow">' + it[side].svgNarrow + '</div></div>';
  let form;
  if (mode === 'h8') {
    form = '<fieldset><legend>' + side + '는 무엇이 문제인가요?</legend><div class="opts">' + issueBoxes(it.id, side) + '</div>' +
      '<label for="t-' + it.id + side + '">짧은 메모 (무엇이 문제이고 어디인지)</label>' +
      '<textarea id="t-' + it.id + side + '" data-side="' + side + '" maxlength="600" placeholder="예: 5마디, 왼손이 너무 멀리 뜀"></textarea></fieldset>';
  } else {
    form = '<fieldset><legend>' + side + '를 학생에게 줄 수 있나요?</legend><div class="opts">' +
      '<label><input type="radio" name="pass-' + it.id + '-' + side + '" value="pass"> 통과</label>' +
      '<label><input type="radio" name="pass-' + it.id + '-' + side + '" value="fail"> 실패</label></div>' +
      '<label for="t-' + it.id + side + '">메모 (선택)</label>' +
      '<textarea id="t-' + it.id + side + '" data-side="' + side + '" maxlength="600"></textarea></fieldset>';
  }
  return '<div class="panel">' + head + svg + form + '</div>';
}

function itemCard(mode, it) {
  const stage = Math.floor(it.targetLevel);
  const aim = '두 편곡 모두 난이도 ' + it.targetLevel.toFixed(2) + ' 수준으로 요청했습니다 (난이도 척도: 1 = 입문, 2 = 초급, 3 = 중급, 4 = 중상급)' +
    (STAGE_NAMES[stage] ? ' - 대략 "' + STAGE_NAMES[stage] + '" 정도' : '') + '. 어느 쪽도 정확히 그 난이도가 되리라는 보장은 없습니다. 요청보다 조금 쉽거나 어렵게 나올 수 있으니, "너무 쉬움"이나 "너무 어려움"은 그 수준의 학생에게 실제로 그럴 때만 표시해 주세요. ' + it.measures + '마디, 손 크기: ' + ({ large: '큰 손', medium: '보통 손', small: '작은 손' }[it.handProfile] || it.handProfile) + '.';
  const pref = '<fieldset class="pref"><legend>' + (mode === 'h8' ? '어느 편곡이 더 나은가요?' : '어느 쪽이 더 마음에 드나요? (선택)') + '</legend><div class="opts">' +
    '<label><input type="radio" name="pref-' + it.id + '" value="X"> X가 더 낫다</label>' +
    '<label><input type="radio" name="pref-' + it.id + '" value="Y"> Y가 더 낫다</label>' +
    '<label><input type="radio" name="pref-' + it.id + '" value="same"> 차이 없음</label></div></fieldset>';
  return '<article class="item" data-item="' + it.id + '"><h2>' + esc(it.id.replace('i', '문항 ')) + ' - ' + esc(it.title) + (it.composer ? ' <small>(' + esc(it.composer) + ')</small>' : '') + '</h2>' +
    '<p class="aim">' + esc(aim) + '</p>' + panel(mode, it, 'X') + panel(mode, it, 'Y') + pref + '</article>';
}

const INTRO = {
  h8: '<p>문항마다 같은 곡의 피아노 편곡 두 개, <b>X</b>와 <b>Y</b>가 나옵니다. 둘 다 같은 난이도로 요청했습니다 (어느 쪽도 정확히 그 난이도가 되리라는 보장은 없습니다). 악보를 읽고 <b>재생</b>을 눌러 들어본 뒤, 어느 편곡이 더 나은지 고르고 각각의 문제점을 체크해 주세요. 어느 쪽이 X이고 어느 쪽이 Y인지는 알려주지 않으며 문항마다 바뀝니다. 소리는 악보와 같은 음을 단순한 합성 피아노로 낸 것이니, 음색이 아니라 음 자체를 판단해 주세요.</p>',
  h9: '<p>문항마다 같은 곡의 피아노 편곡 두 개, <b>X</b>와 <b>Y</b>가 나옵니다. 둘 다 같은 난이도로 요청했습니다 (어느 쪽도 정확히 그 난이도가 되리라는 보장은 없습니다). 악보를 읽고 <b>재생</b>을 눌러 들어본 뒤, 각 편곡을 <b>통과</b>(그 수준의 학생에게 지금 그대로 줄 수 있음) 또는 <b>실패</b>로 표시해 주세요. 어느 쪽이 X이고 어느 쪽이 Y인지는 알려주지 않으며 문항마다 바뀝니다. 소리는 악보와 같은 음을 단순한 합성 피아노로 낸 것이니, 음색이 아니라 음 자체를 판단해 주세요.</p>'
};
const TITLE = { h8: '블라인드 검토 H-8 (진단)', h9: '블라인드 검토 H-9 (통과 / 실패)' };

/* data: { mode, packetId, items: [{id, title, composer, targetLevel, handProfile, measures, tempo, totalQ, X:{svg,svgNarrow,notes}, Y:{svg,svgNarrow,notes}}] } */
function pageHtml(data) {
  const mode = data.mode;
  const payload = { packetId: data.packetId, mode: mode, order: data.items.map(i => i.id), items: {} };
  data.items.forEach(i => { payload.items[i.id] = { tempo: i.tempo, totalQ: i.totalQ, X: i.X.notes, Y: i.Y.notes }; });
  return '<!DOCTYPE html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(TITLE[mode]) + ' - ' + esc(data.packetId) + '</title><style>' + CSS + '</style></head><body>\n' +
    '<header class="bar"><h1>' + esc(TITLE[mode]) + '</h1><span class="progress" id="progress" aria-live="polite"></span>' +
    '<button type="button" id="export-btn">평가 내려받기 (JSON)</button><button type="button" class="ghost" id="clear-btn">평가 지우기</button></header>\n' +
    '<main><section class="intro"><h2 style="margin-top:0;font-size:18px">진행 방법</h2>' + INTRO[mode] +
    '<p>평가는 하는 대로 이 브라우저에 저장되므로, 페이지를 닫았다가 같은 컴퓨터에서 다시 열어 이어서 할 수 있습니다. 다 끝나면 <b>평가 내려받기 (JSON)</b>를 눌러 그 파일을 보내 주세요. 어디에도 업로드되지 않습니다.</p>' +
    '<label for="role">역할 (예: "피아니스트", "선생님"; 이름은 적지 마세요)<input type="text" id="role" autocomplete="off"></label>' +
    '<details><summary>평가를 텍스트로 보기 (내려받기가 막혔을 때 여기서 복사하세요)</summary><textarea id="export-json" readonly></textarea></details></section>\n' +
    data.items.map(i => itemCard(mode, i)).join('\n') + '\n</main>\n' +
    '<script id="packet-data" type="application/json">' + scriptJson(payload) + '</script>\n<script>' + JS + '</script>\n</body></html>\n';
}

module.exports = { pageHtml, ISSUES };
