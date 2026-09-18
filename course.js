/* PPP — Method Books (교재 진도).

   The order Korean piano academies teach in: Beyer, then Czerny 100 with
   Burgmüller and Hanon beside it, then sonatinas and Czerny 30, then Czerny 40.
   The scores are in catalog/method/ (index.json lists what is there); this
   file is the course around them — which piece is today's, how many times it
   has been played through today, what has been passed, and the streak.

   Every function takes the saved course state and returns a new one or a
   plain answer; nothing here touches the page, so tests walk it in node.
   Words shown go through the app's translations; the English is the source. */
(function (global) {
  'use strict';

  function interpolate(s, vars) {
    if (!vars) return String(s);
    return String(s).replace(/\{\{(\w+)\}\}/g, function (_, k) { return vars[k] == null ? '' : String(vars[k]); });
  }
  function t(src, vars) {
    var I = global.PPP_I18N;
    return I && I.tx ? I.tx(src, vars) : interpolate(src, vars);
  }

  /* The academy path, in teaching order. A step is one book; `with` names the
     books usually studied alongside it. */
  var PATH = [
    { stage: 1, book: 'beyer', with: [] },
    { stage: 2, book: 'czerny599', with: ['hanon', 'burgmuller25'] },
    { stage: 3, book: 'czerny849', with: ['hanon', 'sonatina'] },
    { stage: 4, book: 'czerny299', with: ['hanon'] }
  ];
  var STAGES = {
    1: { name: 'First steps', sub: 'Reading the staff, both hands in C' },
    2: { name: 'Elementary', sub: 'First études, new keys, evenness' },
    3: { name: 'Intermediate', sub: 'Sonatinas and finger mechanism' },
    4: { name: 'Upper intermediate', sub: 'Speed and fluency' }
  };
  var REPS = [3, 5, 10];
  var KEEP_DAYS = 400;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* a calendar day in the player's own time zone */
  function dayKey(d) {
    d = d instanceof Date ? d : new Date(d == null ? Date.now() : d);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function addDays(key, n) {
    var p = key.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2] + n, 12);
    return dayKey(d);
  }
  function pieceKey(book, no) { return book + ':' + no; }

  function fresh() {
    return { main: 'beyer', side: null, warm: null, at: {}, passed: {}, log: {}, reps: 5 };
  }
  function clone(s) { return JSON.parse(JSON.stringify(s)); }
  function norm(s) {
    var f = fresh();
    if (!s || typeof s !== 'object') return f;
    var out = {
      main: typeof s.main === 'string' ? s.main : f.main,
      side: typeof s.side === 'string' ? s.side : null,
      warm: typeof s.warm === 'string' ? s.warm : null,
      at: s.at && typeof s.at === 'object' ? s.at : {},
      passed: s.passed && typeof s.passed === 'object' ? s.passed : {},
      log: s.log && typeof s.log === 'object' ? s.log : {},
      reps: REPS.indexOf(s.reps) > -1 ? s.reps : f.reps
    };
    return clone(out);
  }

  /* ---- the catalog ---- */
  function book(cat, id) {
    var b = cat && cat.books ? cat.books : [];
    for (var i = 0; i < b.length; i++) if (b[i].id === id) return b[i];
    return null;
  }
  function piece(cat, id, no) {
    var b = book(cat, id);
    if (!b) return null;
    for (var i = 0; i < b.pieces.length; i++) if (b.pieces[i].no === no) return b.pieces[i];
    return null;
  }
  /* the numbers a book has scores for, in order */
  function numbers(cat, id) {
    var b = book(cat, id);
    return b ? b.pieces.map(function (p) { return p.no; }).sort(function (a, c) { return a - c; }) : [];
  }
  function isPassed(s, id, no) { return !!(s.passed[id] && s.passed[id][no]); }

  /* The piece a book is on: the one chosen, or the first not yet passed. */
  function current(s, cat, id) {
    var ns = numbers(cat, id);
    if (!ns.length) return null;
    var at = s.at[id];
    if (at != null && ns.indexOf(at) > -1) return at;
    for (var i = 0; i < ns.length; i++) if (!isPassed(s, id, ns[i])) return ns[i];
    return null;
  }
  /* the most recent piece passed before `no`, for review */
  function previous(s, cat, id, no) {
    var ns = numbers(cat, id);
    for (var i = ns.length - 1; i >= 0; i--) {
      if ((no == null || ns[i] < no) && isPassed(s, id, ns[i])) return ns[i];
    }
    return null;
  }
  function nextNumber(s, cat, id, no) {
    var ns = numbers(cat, id);
    for (var i = 0; i < ns.length; i++) if (ns[i] > no && !isPassed(s, id, ns[i])) return ns[i];
    return null;
  }

  function doneToday(s, day, key) {
    var d = s.log[day];
    return d && d[key] ? d[key] : 0;
  }

  /* Today's practice: a warm-up, the piece you are on, yesterday's piece to
     keep it in the fingers, and the piece in the book studied alongside. */
  function plan(s, cat, day) {
    s = norm(s);
    var items = [];
    function add(role, id, no) {
      if (!id || no == null) return;
      var p = piece(cat, id, no);
      if (!p) return;
      var key = pieceKey(id, no);
      for (var i = 0; i < items.length; i++) if (items[i].key === key) return;
      items.push({ role: role, book: id, no: no, key: key, piece: p, reps: s.reps, done: Math.min(doneToday(s, day, key), s.reps) });
    }
    if (s.warm) add('warm', s.warm, current(s, cat, s.warm));
    var cur = current(s, cat, s.main);
    add('new', s.main, cur);
    add('review', s.main, previous(s, cat, s.main, cur));
    if (s.side) add('side', s.side, current(s, cat, s.side));
    return items;
  }

  /* one more play-through today (or one fewer, to undo a mistaken tap) */
  function tick(s, day, key, delta) {
    s = norm(s);
    var d = s.log[day] || (s.log[day] = {});
    var n = Math.max(0, Math.min(99, (d[key] || 0) + (delta == null ? 1 : delta)));
    if (n) d[key] = n; else delete d[key];
    if (!Object.keys(d).length) delete s.log[day];
    return trim(s, day);
  }
  /* set today's circles for a piece to exactly n (tapping a circle) */
  function setCount(s, day, key, n) {
    s = norm(s);
    return tick(s, day, key, n - doneToday(s, day, key));
  }

  /* Passing a piece moves the book on to the next one not yet passed. */
  function pass(s, cat, id, no, day) {
    s = norm(s);
    s.passed[id] = s.passed[id] || {};
    s.passed[id][no] = day;
    var nx = nextNumber(s, cat, id, no);
    if (nx != null) s.at[id] = nx; else delete s.at[id];
    return s;
  }
  function unpass(s, id, no) {
    s = norm(s);
    if (s.passed[id]) {
      delete s.passed[id][no];
      if (!Object.keys(s.passed[id]).length) delete s.passed[id];
    }
    s.at[id] = no;
    return s;
  }
  function setCurrent(s, id, no) {
    s = norm(s);
    s.at[id] = no;
    return s;
  }
  function choose(s, role, id) {
    s = norm(s);
    if (role === 'main') {
      s.main = id;
      if (s.side === id) s.side = null;
      if (s.warm === id) s.warm = null;
    } else if (role === 'side') s.side = id && id !== s.main ? id : null;
    else if (role === 'warm') s.warm = id && id !== s.main ? id : null;
    return s;
  }
  /* Studying a book the academy way: the books the path pairs with it fill
     the warm-up (Hanon) and the book alongside, where those are still free. */
  function chooseWithPath(s, cat, id) {
    s = choose(s, 'main', id);
    var step = null;
    for (var i = 0; i < PATH.length; i++) if (PATH[i].book === id) step = PATH[i];
    if (!step) return s;
    step.with.forEach(function (w) {
      if (!book(cat, w) || !numbers(cat, w).length || w === s.warm || w === s.side) return;
      if (w === 'hanon') { if (!s.warm) s.warm = w; }
      else if (!s.side) s.side = w;
    });
    return s;
  }
  function setReps(s, n) {
    s = norm(s);
    if (REPS.indexOf(n) > -1) s.reps = n;
    return s;
  }
  function trim(s, day) {
    var cut = addDays(day, -KEEP_DAYS);
    Object.keys(s.log).forEach(function (k) { if (k < cut) delete s.log[k]; });
    return s;
  }

  /* ---- the record ---- */
  function dayTotal(s, day) {
    var d = s.log[day];
    if (!d) return 0;
    var n = 0;
    Object.keys(d).forEach(function (k) { n += d[k]; });
    return n;
  }
  /* days in a row with practice, counting today only once it has some */
  function streak(s, day) {
    s = norm(s);
    var k = dayTotal(s, day) ? day : addDays(day, -1);
    var n = 0;
    while (dayTotal(s, k) > 0) { n++; k = addDays(k, -1); }
    return n;
  }
  /* the last n days, oldest first */
  function days(s, day, n) {
    s = norm(s);
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var k = addDays(day, -i);
      out.push({ day: k, total: dayTotal(s, k) });
    }
    return out;
  }
  function progress(s, cat, id) {
    var b = book(cat, id);
    if (!b) return { passed: 0, available: 0, total: 0, pct: 0 };
    var ns = numbers(cat, id);
    var passed = ns.filter(function (no) { return isPassed(s, id, no); }).length;
    var total = b.count || ns.length;
    return { passed: passed, available: ns.length, total: total, pct: total ? Math.round((passed / total) * 100) : 0 };
  }
  /* every piece is passed: time for the next book on the path */
  function finished(s, cat, id) {
    var ns = numbers(cat, id);
    return ns.length > 0 && ns.every(function (no) { return isPassed(s, id, no); });
  }
  function nextBook(id) {
    for (var i = 0; i < PATH.length - 1; i++) if (PATH[i].book === id) return PATH[i + 1].book;
    return null;
  }
  /* a plan item's role, in words */
  function roleName(role) {
    return t({ warm: 'Warm-up', 'new': 'Today\'s piece', review: 'Review piece', side: 'Alongside' }[role] || role);
  }

  global.PPP_COURSE = {
    PATH: PATH, STAGES: STAGES, REPS: REPS,
    dayKey: dayKey, addDays: addDays, pieceKey: pieceKey,
    fresh: fresh, norm: norm, book: book, piece: piece, numbers: numbers, isPassed: isPassed,
    current: current, previous: previous, nextNumber: nextNumber, doneToday: doneToday,
    plan: plan, tick: tick, setCount: setCount, pass: pass, unpass: unpass, setCurrent: setCurrent,
    choose: choose, chooseWithPath: chooseWithPath, setReps: setReps, dayTotal: dayTotal, streak: streak, days: days,
    progress: progress, finished: finished, nextBook: nextBook, roleName: roleName
  };
})(typeof window !== 'undefined' ? window : globalThis);
