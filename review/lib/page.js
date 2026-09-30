/* G9c: the reviewer's page - ONE self-contained HTML file per packet (inline CSS and JS, no network, no fonts or scripts from
   anywhere, opens from disk).

   Per item: the two arrangements X and Y as engraved scores (SVG, drawn Node-side by engrave/, see neutral.js; each is embedded
   twice, laid out for a wide and for a narrow screen, and a media query at 720 px shows one, so a phone needs no sideways
   scrolling; the rating logic and the sound never read the drawings), a Play button
   for each (the same notes played on the PPP app's own sampled grand piano: the 30 Salamander recordings travel inside the page,
   once per page as base64, and the sampler is a port of the app's PIANO, pianoAttack, pianoDamp, pianoRoom, PianoSamples and
   PianoPlayer; if they cannot be decoded a small Web Audio synth plays the notes instead), and a form.
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
footer.credit{margin:8px 0 24px;font-size:13px;color:var(--muted)}
footer.credit p{margin:2px 0}
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

  /* ---- sound: the PPP app's sampled grand piano, ported from Piano Coach App.dc.html (PIANO, pianoAttack, pianoDamp,
     pianoRoom, PianoSamples, PianoPlayer.strike/release/prune/silence). The 30 recordings (a Yamaha C5 every minor third,
     A0 ... C8) are embedded in the page as base64 and decoded from those bytes on the first Play press; nothing is fetched.
     The notes are the same list the score shows. Every note is struck at one fixed mezzo-forte velocity, held for its written
     length and let go like a damper. If the recordings cannot be decoded, the small synth below plays the same notes. ---- */
  var PIANO = { low: 21, step: 3, count: 30, decodeRate: 32000, velocity: 80, maxVoices: 72 };
  var AC = null, live = null, lastRun = null, player = null;

  /* where the hammer lands in a recording (MP3 decoders disagree about the silence before it, so it is measured) */
  function pianoAttack(buf){
    var d = buf.getChannelData(0), sr = buf.sampleRate;
    var n = Math.min(d.length, Math.floor(sr * 0.3)), peak = 0, i;
    for (i = 0; i < n; i++) { var v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v; }
    var th = peak * 0.03;
    for (i = 0; i < n; i++) if ((d[i] < 0 ? -d[i] : d[i]) > th) return Math.max(0, i / sr - 0.002);
    return 0;
  }
  /* how fast a damper silences a string: slower in the bass, hardly at all at the top, where a piano has no dampers */
  function pianoDamp(midi){ return midi >= 89 ? 0.6 : midi < 40 ? 0.14 : midi < 60 ? 0.1 : 0.075; }
  /* a small room, so a close-miked sample does not sound played in a cupboard (the app's noise is random; this one is a fixed
     sequence, so every play and every test render has the same room) */
  function pianoRoom(ac){
    var sr = ac.sampleRate, len = Math.floor(sr * 1.6), buf = ac.createBuffer(2, len, sr), rng = 1;
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c), lp = 0;
      for (var i = 0; i < len; i++) {
        var t = i / sr;
        rng = (rng * 1664525 + 1013904223) >>> 0;
        lp += ((rng / 2147483648 - 1) - lp) * 0.3;     /* take the fizz off the top */
        d[i] = t < 0.008 ? 0 : lp * Math.exp(-t * 4);
      }
    }
    return buf;
  }

  /* the decoded recordings: list[k] = { buffer, onset } once decoded */
  var samples = { list: [], loading: null, done: false, got: 0 };
  function base64Bytes(s){
    var bin = atob(s), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function loadSamples(){
    if (samples.loading) return samples.loading;
    var blob = null;
    try { var el = document.getElementById('piano-samples'); blob = el ? JSON.parse(el.textContent) : null; } catch (e) { blob = null; }
    var finish = function(n){ samples.done = true; samples.got = n; return n > 0; };
    if (!blob || !blob.length) { samples.loading = Promise.resolve(finish(0)); return samples.loading; }
    /* an offline context decodes without asking for the speakers; its buffers play in any context */
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, ctx = null;
    try { if (OAC) ctx = new OAC(2, 1, PIANO.decodeRate); } catch (e) { ctx = null; }
    if (!ctx) ctx = AC;
    if (!ctx || typeof ctx.decodeAudioData !== 'function') { samples.loading = Promise.resolve(finish(0)); return samples.loading; }
    var decode = function(ab){ return new Promise(function(ok, fail){
      var p = ctx.decodeAudioData(ab, ok, fail);     /* old Safari only calls back */
      if (p && p.then) p.then(ok, fail);
    }); };
    samples.loading = Promise.all(blob.map(function(b64, k){
      return Promise.resolve().then(function(){ return decode(base64Bytes(b64)); })
        .then(function(buf){ samples.list[k] = { buffer: buf, onset: pianoAttack(buf) }; return 1; })
        .catch(function(){ samples.list[k] = null; return 0; });
    })).then(function(r){ return finish(r.reduce(function(a, b){ return a + b; }, 0)); }, function(){ return finish(0); });
    return samples.loading;
  }
  /* the nearest recording to a key and how far to pitch it: at most a semitone, or a neighbour's if that one did not decode */
  function pickSample(midi){
    var n = PIANO.count, k0 = Math.max(0, Math.min(n - 1, Math.round((midi - PIANO.low) / PIANO.step)));
    var order = [k0, k0 - 1, k0 + 1];
    for (var i = 0; i < order.length; i++) {
      var k = order[i], s = k >= 0 && k < n ? samples.list[k] : null;
      if (s) return { buffer: s.buffer, onset: s.onset, rate: Math.pow(2, (midi - (PIANO.low + k * PIANO.step)) / 12) };
    }
    return null;
  }

  /* the plain synth: plays when the recordings cannot be decoded, and for a single key none of whose neighbours decoded */
  function synthNote(ac, dest, t, dur, midi){
    var f = 440 * Math.pow(2, (midi - 69) / 12), nodes = [];
    var env = ac.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.9, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.35, t + Math.min(dur, 1.6));
    env.gain.setValueAtTime(0.35, t + dur);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    env.connect(dest);
    var a = ac.createOscillator(); a.type = 'triangle'; a.frequency.value = f;
    var b = ac.createOscillator(); b.type = 'sine'; b.frequency.value = f * 2;
    var bg = ac.createGain(); bg.gain.value = 0.3;
    a.connect(env); b.connect(bg); bg.connect(env);
    a.start(t); b.start(t); a.stop(t + dur + 0.3); b.stop(t + dur + 0.3);
    nodes.push(a, b);
    return nodes;
  }
  function synthPhrase(ac, notes, t0, spq){
    var master = ac.createGain(); master.gain.value = 0.16;
    var comp = ac.createDynamicsCompressor();
    master.connect(comp); comp.connect(ac.destination);
    var nodes = [], end = t0;
    notes.forEach(function(n){
      var t = t0 + n[0] * spq, dur = Math.max(n[1] * spq, 0.18);
      nodes = nodes.concat(synthNote(ac, master, t, dur, n[2]));
      end = Math.max(end, t + dur + 0.3);
    });
    return { mode: 'synth', voices: notes.length, nodes: nodes, end: end };
  }

  /* one player per audio context: a limiter (not an effect: ten notes at once must not clip), the bus at the app's 1.4, and the
     small room at the app's 0.22 wet */
  function makePlayer(ac){
    var lim = ac.createDynamicsCompressor();
    lim.threshold.value = -8; lim.knee.value = 6; lim.ratio.value = 12;
    lim.attack.value = 0.002; lim.release.value = 0.2;
    lim.connect(ac.destination);
    var bus = ac.createGain(); bus.gain.value = 1.4; bus.connect(lim);
    try {
      var room = ac.createConvolver(); room.buffer = pianoRoom(ac);
      var wet = ac.createGain(); wet.gain.value = 0.22;
      bus.connect(room); room.connect(wet); wet.connect(lim);
    } catch (e) { /* dry is still a piano */ }
    var spare = ac.createGain(); spare.gain.value = 0.16; spare.connect(bus);
    return { ac: ac, bus: bus, spare: spare, voices: [], keys: {} };
  }
  function prune(P, now, at){
    if (P.voices.length >= 24) P.voices = P.voices.filter(function(v){ return v.end > now; });
    var t = at == null ? now : at;
    /* voices scheduled for later are cheap and are not polyphony yet: steal only voices that overlap the new strike */
    var active = P.voices.filter(function(v){ return v.t <= t && v.off > t && v.end > t; });
    while (active.length >= PIANO.maxVoices) release(P, active.shift(), t, 0.02);
  }
  /* press a key at when, velocity 1-127 */
  function strike(P, midi, when, vel){
    var ac = P.ac, now = ac.currentTime, t = when == null || when < now ? now : when;
    prune(P, now, t);
    var v = Math.max(0.05, Math.min(1, vel / 127));
    var out = ac.createGain(), tone = ac.createBiquadFilter();
    tone.type = 'lowpass';
    /* a soft blow is a darker sound, not only a quieter one */
    tone.frequency.value = Math.min(18000, 700 * Math.pow(2, v * 4.6));
    tone.Q.value = 0.5;
    tone.connect(out);
    var s = pickSample(midi);
    if (!s) {     /* nothing decoded near this key: the synth, so the note is not silent */
      out.connect(P.spare);
      var sv = { midi: midi, t: t, off: t + 0.6, end: t + 0.9, out: out, srcs: synthNote(ac, tone, t, 0.6, midi) };
      P.voices.push(sv);
      return sv;
    }
    out.connect(P.bus);
    var voice = { midi: midi, t: t, off: Infinity, end: t, out: out, srcs: [] };
    var peak = 0.95 * Math.pow(v, 1.6), g = out.gain;
    g.setValueAtTime(0, t);
    var src = ac.createBufferSource();
    src.buffer = s.buffer;
    src.playbackRate.value = s.rate;
    src.connect(tone);
    var life = (s.buffer.duration - s.onset) / s.rate;
    g.linearRampToValueAtTime(peak, t + 0.003);
    /* the recordings stop short of silence; fade before one runs out */
    g.setTargetAtTime(0, t + Math.max(0.1, life - 1.8), 0.45);
    src.start(t, s.onset);
    voice.end = t + life;
    voice.srcs.push(src);
    src.stop(voice.end + 0.05);
    src.onended = function(){ try { out.disconnect(); } catch (e) {} };
    /* one string per key: striking it again stops what it was still sounding */
    var prev = P.keys[midi];
    if (prev && prev.t < t && prev.end > t) release(P, prev, t, 0.04);
    P.keys[midi] = voice;
    P.voices.push(voice);
    return voice;
  }
  /* let a key go at when; tau is how fast the damper works */
  function release(P, voice, when, tau){
    if (!voice) return;
    var now = P.ac.currentTime, t = when == null || when < now ? now : when;
    if (t < voice.t) t = voice.t;
    if (voice.off <= t || voice.end <= t) return;
    voice.off = t;
    var k = tau != null ? tau : pianoDamp(voice.midi), g = voice.out.gain;
    try {
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, k);
    } catch (e) {}
    voice.end = Math.min(voice.end, t + k * 7) + 0.02;
    voice.srcs.forEach(function(x){ try { x.stop(voice.end); } catch (e) {} });
  }
  /* stop: what sounds is let go quickly, what was still to come never plays */
  function silence(P, tau){
    var now = P.ac.currentTime;
    P.voices = P.voices.filter(function(v){
      if (v.t <= now) return true;
      v.srcs.forEach(function(x){ try { x.stop(); } catch (e) {} });
      try { v.out.disconnect(); } catch (e) {}
      return false;
    });
    P.voices.forEach(function(v){ release(P, v, now, tau == null ? 0.06 : tau); });
    P.voices = []; P.keys = {};
  }
  /* the whole phrase goes onto the audio clock at once, so a chord's notes land together and the tempo holds whatever the page
     is doing; each note is held for its written length (ties already joined) */
  function pianoPhrase(P, notes, t0, spq){
    var end = t0;
    notes.forEach(function(n){
      var t = t0 + n[0] * spq, hold = Math.max(n[1], 0.05) * spq;
      release(P, strike(P, n[2], t, PIANO.velocity), t + hold);
      end = Math.max(end, t + hold + 0.6);
    });
    return { mode: 'samples', voices: notes.length, player: P, end: end };
  }

  function setBtn(btn, text, on){ btn.textContent = text; btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  function stopSound(){
    if (!live) return;
    var run = live; live = null;
    clearTimeout(run.timer);
    if (run.result) {
      if (run.result.player) { try { silence(run.result.player, 0.06); } catch (e) {} }
      if (run.result.nodes) run.result.nodes.forEach(function(n){ try { n.stop(); } catch (e) {} });
    }
    setBtn(run.btn, '재생', false);
  }
  /* a phrase that has played to its end: the button goes back, and nothing is cut. Every note was already let go by its own damper
     (up to 0.6 s for the top octaves, which ring on), so a last silence here would chop the final high notes. */
  function finishSound(run){
    if (live !== run) return;
    live = null;
    setBtn(run.btn, '재생', false);
  }
  function begin(run, id, side, speed, decoded){
    var it = DATA.items[id], notes = it[side], spq = 60 / (it.tempo * speed), result = null, t0;
    if (decoded) {
      try {
        if (!player || player.ac !== AC) player = makePlayer(AC);     /* built first: the lead below starts after this work, not before */
        player.voices = []; player.keys = {};
        t0 = AC.currentTime + 0.12;
        result = pianoPhrase(player, notes, t0, spq);
      } catch (e) {     /* the sampler failed part way: what it started is let go, and the synth plays the notes instead */
        try { if (player) silence(player, 0.02); } catch (e2) {}
        result = null;
      }
    }
    if (!result) { t0 = AC.currentTime + 0.12; result = synthPhrase(AC, notes, t0, spq); }
    run.result = result;
    lastRun = { mode: result.mode, voices: result.voices, notes: notes.length, id: id, side: side };
    setBtn(run.btn, '정지', true);
    var ms = (Math.max(it.totalQ * spq + t0, result.end) - AC.currentTime) * 1000 + 300;
    run.timer = setTimeout(function(){ finishSound(run); }, ms);
  }
  /* The app's wake / unlock / ping: iOS takes "the page may use sound" only from a silent buffer started inside the tap itself, and
     playSound runs it before anything is awaited (the recordings decode after this, and the first real note comes later). */
  function pingAudio(ac){
    try {
      var buf = ac.createBuffer(1, 1, ac.sampleRate || 44100), src = ac.createBufferSource();
      src.buffer = buf; src.connect(ac.destination); src.start(0);
    } catch (e) {}
  }
  function unlockAudio(ac){
    if (ac.state !== 'running' && ac.resume) {
      try { var p = ac.resume(); if (p && p.then) p.then(function(){ pingAudio(ac); }, function(){}); } catch (e) {}
    }
    pingAudio(ac);
  }
  function playSound(id, side, btn, speed){
    if (live && live.btn === btn) { stopSound(); return; }
    stopSound();
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { alert('이 브라우저는 소리 재생(Web Audio)을 지원하지 않습니다.'); return; }
    if (!AC || AC.state === 'closed') {
      try { AC = new Ctor({ latencyHint: 'interactive' }); } catch (e) { try { AC = new Ctor(); } catch (e2) { AC = null; alert('이 브라우저는 소리 재생(Web Audio)을 지원하지 않습니다.'); return; } }
    }
    unlockAudio(AC);     /* synchronously, in the tap: before the decode below */
    var run = { btn: btn, timer: null, result: null };
    live = run;
    setBtn(btn, samples.done ? '정지' : '소리 불러오는 중...', true);
    loadSamples().then(function(ok){ return ok; }, function(){ return false; }).then(function(ok){
      if (live !== run) return;     /* stopped, or another Play pressed, while the recordings were loading */
      begin(run, id, side, speed, ok);
    });
  }
  /* what the page tests look at: the decoded recordings, the last play, and an offline render of a phrase through the same code */
  function renderOffline(id, side, speed, mode, seconds){
    var it = DATA.items[id], spq = 60 / (it.tempo * (speed || 1));
    var notes = seconds ? it[side].filter(function(n){ return n[0] * spq < seconds - 0.5; }) : it[side];
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, sr = 44100, last = 0;
    notes.forEach(function(n){ last = Math.max(last, (n[0] + n[1]) * spq); });
    var ac = new OAC(2, Math.ceil((last + 3) * sr), sr);
    return (mode === 'synth' ? Promise.resolve(false) : loadSamples()).then(function(ok){
      var res = ok ? pianoPhrase(makePlayer(ac), notes, 0.05, spq) : synthPhrase(ac, notes, 0.05, spq);
      return ac.startRendering().then(function(buf){ return { buffer: buf, mode: res.mode, voices: res.voices, notes: notes.length }; });
    });
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
    window.__pppReview = { exportObject: exportObject, key: KEY, sound: { load: loadSamples, samples: samples, pick: pickSample, lastRun: function(){ return lastRun; }, renderOffline: renderOffline, notes: function(id, side){ return DATA.items[id][side]; } } };
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
  h8: '<p>문항마다 같은 곡의 피아노 편곡 두 개, <b>X</b>와 <b>Y</b>가 나옵니다. 둘 다 같은 난이도로 요청했습니다 (어느 쪽도 정확히 그 난이도가 되리라는 보장은 없습니다). 악보를 읽고 <b>재생</b>을 눌러 들어본 뒤, 어느 편곡이 더 나은지 고르고 각각의 문제점을 체크해 주세요. 어느 쪽이 X이고 어느 쪽이 Y인지는 알려주지 않으며 문항마다 바뀝니다. 소리는 악보와 같은 음을 PPP 앱의 피아노 소리(녹음된 그랜드 피아노)로 들려주는 것입니다. 처음 재생할 때는 소리를 불러오느라 잠깐 걸릴 수 있습니다. 페달과 강약 표현은 넣지 않고 모든 음을 같은 세기로 치니, 음색이 아니라 음 자체를 판단해 주세요.</p>',
  h9: '<p>문항마다 같은 곡의 피아노 편곡 두 개, <b>X</b>와 <b>Y</b>가 나옵니다. 둘 다 같은 난이도로 요청했습니다 (어느 쪽도 정확히 그 난이도가 되리라는 보장은 없습니다). 악보를 읽고 <b>재생</b>을 눌러 들어본 뒤, 각 편곡을 <b>통과</b>(그 수준의 학생에게 지금 그대로 줄 수 있음) 또는 <b>실패</b>로 표시해 주세요. 어느 쪽이 X이고 어느 쪽이 Y인지는 알려주지 않으며 문항마다 바뀝니다. 소리는 악보와 같은 음을 PPP 앱의 피아노 소리(녹음된 그랜드 피아노)로 들려주는 것입니다. 처음 재생할 때는 소리를 불러오느라 잠깐 걸릴 수 있습니다. 페달과 강약 표현은 넣지 않고 모든 음을 같은 세기로 치니, 음색이 아니라 음 자체를 판단해 주세요.</p>'
};
/* CC BY 3.0 asks for credit: the piano recordings (wording of audio/piano/README.md; no link, the page carries no URL) */
const CREDIT = '<footer class="credit"><p>피아노 소리: Salamander Grand Piano V3, Alexander Holm 녹음 (Yamaha C5), CC BY 3.0 (Creative Commons Attribution 3.0) 라이선스. PPP 앱과 같은 녹음입니다.</p>' +
  '<p lang="en">Piano sound: Salamander Grand Piano V3 by Alexander Holm (a Yamaha C5), licensed under CC BY 3.0 (Creative Commons Attribution 3.0). The same recordings the PPP app uses.</p></footer>';
const TITLE = { h8: '블라인드 검토 H-8 (진단)', h9: '블라인드 검토 H-9 (통과 / 실패)' };

/* data: { mode, packetId, samples: [30 base64 mp3 strings, embedded once; see build.js readPianoSamples], items: [{id, title, composer, targetLevel, handProfile, measures, tempo, totalQ, X:{svg,svgNarrow,notes}, Y:{svg,svgNarrow,notes}}] } */
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
    data.items.map(i => itemCard(mode, i)).join('\n') + '\n' + CREDIT + '\n</main>\n' +
    (data.samples && data.samples.length ? '<script id="piano-samples" type="application/json">' + scriptJson(data.samples) + '</script>\n' : '') +
    '<script id="packet-data" type="application/json">' + scriptJson(payload) + '</script>\n<script>' + JS + '</script>\n</body></html>\n';
}

module.exports = { pageHtml, ISSUES };
