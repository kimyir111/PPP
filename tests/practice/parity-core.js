/* G11a-2: the cause rules of the event-parity harness (docs/GOALS/G11 section 6.2, items 3-5). Pure functions over canonical dumps, no browser and no app:
   it runs in the page (tests/practice/parity.js adds it with addScriptTag, as window.PPPParity) and in Node (tests/practice/parity-core.test.js holds the rules
   to account against planted errors, so the check cannot pass because the rule table is loose).

   Two plans are compared. THE LEGACY ONE (L) is what PianoScore.build makes; THE NEW ONE (N) is practice/plan.js. With every fix option off the two must be the
   same to the last bit (strictOf: one string, the same canon.js function on both sides). With a fix option on, N may differ from L ONLY in the ways the four
   causes of G11-D3 allow, and every difference is booked to its cause; what no rule covers is UNEXPLAINED and fails:

     JUMP           the D.C. / D.S. / To Coda / Fine signs are followed once. N's first leg is L's order up to the sign that turned it (a PREFIX of L's visits),
                    bit for bit; everything after it (N's way-back visits, L's visits that the jump skipped or moved) is the territory of the cause. Inside it
                    there is still a rule: a visit of N is the same bar as a visit of L, so what it sounds, relative to its start, is what L's visit of that bar
                    sounds (the same notes, loudness, releases, pedal, beats and tempo) - with ONE rule of its own, the tie at a jump (G11a-4): a note tied from a bar
                    the way back did not come from is STRUCK at the arrival (the old plan leaves it silent), and the note that was tied into a bar the way back does
                    not go to is released at its own length (the old plan holds it through the chain, into a bar that is not the one it is tied to). Both are read
                    from the old plan's own tie links (ctx.ties), at an arrival only; the return of a repeat is not one.
                    And one rule for the damper (G11a-4, F3): at an arrival a pedal that is down comes up (and goes down again where the written pedal is down there:
                    controller events marked `jump`, dump field 3), and a note the pedal or the sostenuto holds is released at the end of the bar before the sign
                    at the latest (the old plan lets it ring on into the arrival).
     GRACE          grace notes sound. N has extra strikes, each marked `grace`, only in a bar that holds a grace note; a strike that is not a grace is L's strike
                    with the same bar, place, pitch, hand and loudness, moved LATER (the unslashed grace takes its time from the main note) or with its release CUT
                    SHORT (the slashed grace takes it from the note before), and only in or next to a bar that holds a grace note. Nothing else moves.
     FOLLOW_REPEAT  follow mode asks a repeated passage each time the clock plays it: the gates are the legacy gates of each stretch of the play order, in order.
                    (The oracle is the app's own followGates called once per stretch, not a second copy of the rule.)
     FOLLOW_TIE     follow mode asks exactly the notes the clock strikes: the gates gain the notes that a tie leads into from nowhere (computed from the legacy
                    plan's own tie map), the rest gates at their onsets go, and a rest gate that such an onset falls into is cut short.

   A dump of a plan (dumpOf) is plain arrays of rounded numbers:
     v  visits   [measure index, number, pass, leg, startQ, lenQ, soundQ, arrival]   (arrival: 1 for the first visit after a D.C. / D.S. / To Coda)
     s  strikes  [visit, abs, q, upQ, midi, vel, hand, m, grace]            (in the plan's own order)
     c  ccs      [q, cc, value, jump]     b  beats [q, accent]     t  tempoMap [q, bpm]     len  soundLengthQ
                (jump: 1 for the damper action at the arrival of a jump, which the old plan does not make)
   Gates are canon.js gatesOf: [b, m, rest, dur, [[midi, hand], ...]].

   A plain script (window.PPPParity) and a Node module. It needs canon.js (window.PPPPracticeCanon / require('./canon.js')). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./canon.js'));
  else root.PPPParity = factory(root.PPPPracticeCanon);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const r6 = C.r6;
  const EPS = 1e-6;
  const handOf = h => (h == null ? '' : String(h));
  const J = JSON.stringify;

  /* ------------------------------------------------------------------ strict form */
  /* Everything the scheduler, the matcher, the falling notes and the simulator read of a plan, ids stripped: canon.js planOf (visits, strikes, ccs, beats,
     tempo map, length) plus what planOf leaves out - the pedal spans, the kind and type of each controller event, the measure of each beat. */
  function strictOf(plan) {
    const o = C.planOf(plan);
    o.pedal = (plan.pedal || []).map(p => [r6(p[0]), r6(p[1])]);
    o.ccKinds = (plan.ccs || []).map(c => [c.kind || '', c.type || '']);
    o.beatM = (plan.beats || []).map(b => b.m);
    return o;
  }
  /* the first place two strict forms differ, as a sentence ('' when they do not) */
  function firstDiff(a, b) {
    for (const k of Object.keys(a)) {
      const x = a[k], y = b[k];
      if (J(x) === J(y)) continue;
      if (Array.isArray(x) && Array.isArray(y)) {
        if (x.length !== y.length) return k + ': ' + x.length + ' against ' + y.length + ' entries';
        for (let i = 0; i < x.length; i++) if (J(x[i]) !== J(y[i])) return k + '[' + i + ']: ' + J(x[i]) + ' against ' + J(y[i]);
      }
      return k + ': ' + J(x) + ' against ' + J(y);
    }
    return '';
  }

  /* ------------------------------------------------------------------ the dump */
  function dumpOf(plan) {
    const visits = plan.visits || [];
    const vIdx = new Map(visits.map((v, i) => [v, i]));
    return {
      v: visits.map(v => [v.index, v.number, v.pass, v.leg ? 1 : 0, r6(v.startQ), r6(v.lenQ), r6(v.soundQ), v.jumped ? 1 : 0]),
      s: (plan.strikes || []).map(s => [vIdx.get(s.visit), r6(s.abs), r6(s.q), r6(s.upQ), s.midi, s.vel, handOf(s.hand), s.m, s.grace ? 1 : 0]),
      c: (plan.ccs || []).map(c => [r6(c.q), c.cc, c.value, c.type === 'jump' ? 1 : 0]),
      b: (plan.beats || []).map(b => [r6(b.q), b.accent ? 1 : 0]),
      t: (plan.tempoMap || []).map(t => [r6(t.q), r6(t.bpm)]),
      len: r6(plan.soundLengthQ || 0)
    };
  }

  /* what a visit sounds, relative to its own start: its strikes (not graces), controller events, beats and tempo entries. `timing` false leaves the
     times out (a bar next to a grace note may have its notes moved). */
  function svOf(D) {
    if (!D._sv) {
      const sv = D.v.map(() => []);
      D.s.forEach(s => { if (s[0] != null && sv[s[0]]) sv[s[0]].push(s); });
      Object.defineProperty(D, '_sv', { value: sv, enumerable: false });
    }
    return D._sv;
  }
  /* a strike's place in the music, whatever plan it is in: bar number | pitch | hand | written place (what a tie link of the old plan is keyed by) */
  const placeOf = s => s[7] + '|' + s[4] + '|' + s[6] + '|' + s[1];
  /* tie: { drop: Set of places struck again at an arrival (left out of both sides), cut: Set of places whose release the jump shortened (not compared) } */
  function visitSig(D, j, timing, tie) {
    const v = D.v[j], a = v[6] - 1e-9, z = v[6] + v[5] - 1e-9, at = v[6];
    const inV = q => q >= a && q < z;
    let list = svOf(D)[j].filter(s => !s[8]);
    if (tie && tie.drop) list = list.filter(s => !tie.drop.has(placeOf(s)));
    const cutOf = s => !!(tie && tie.cut && tie.cut.has(placeOf(s)));
    /* a visit that an arrival follows: no release is later than that arrival (the damper comes up there), on both sides - tie.endDist is the distance from this visit's start */
    const rel = s => r6(tie && tie.endDist != null ? Math.min(s[3] - s[2], tie.endDist - (s[2] - at)) : s[3] - s[2]);
    const strikes = list.map(s => (timing ? [r6(s[2] - at), cutOf(s) ? null : rel(s), s[4], s[5], s[6], s[7]] : [s[4], s[5], s[6], s[7]]));
    strikes.sort((x, y) => (J(x) < J(y) ? -1 : J(x) > J(y) ? 1 : 0));
    return J([strikes, D.c.filter(e => inV(e[0]) && !e[3]).map(e => [r6(e[0] - at), e[1], e[2]]), D.b.filter(e => inV(e[0])).map(e => [r6(e[0] - at), e[1]]),
      D.t.filter(e => inV(e[0])).map(e => [r6(e[0] - at), e[1]])]);
  }

  /* ------------------------------------------------------------------ the plan: JUMP and GRACE */
  /* explainPlan(L, N, ctx) -> { unexplained: [sentence...], bad: n, jump, grace }
       ctx.allow          { JUMP: bool, GRACE: bool }  which causes may explain a difference (the options that were on)
       ctx.graceMeasures  Set of measure indexes that hold a grace note (from the graph, not from either plan)
       ctx.ties           { ends: [{place, bar, from}], sources: [{place, to}] } the old plan's tie links that cross a bar line: `place` as placeOf, `bar` the measure index of
                          the tied-to note, `from` the measure index of the note it is tied from, `to` the measure index of the note a source is tied into. Absent: none.
     jump  { turned, visitsAdded, visitsSkipped, strikes, unchecked }    grace  { strikes, moved, cut }    tie  { struck, cut, silent, held }
     - counts per cause (zero when the cause did not act). tie.silent and tie.held are the rule's failures: a tied-to note that is still silent at an arrival, and a note
     that is still held through the chain into a bar the way back does not go to (each is also reported as unexplained). */
  function explainPlan(L, N, ctx) {
    const allow = ctx.allow || {}, gm = ctx.graceMeasures || new Set();
    const out = { unexplained: [], bad: 0, jump: { turned: 0, visitsAdded: 0, visitsSkipped: 0, strikes: 0, unchecked: 0 }, grace: { strikes: 0, moved: 0, cut: 0 },
      tie: { struck: 0, cut: 0, silent: 0, held: 0, lifted: 0, ringing: 0, capped: 0 } };
    const tieEnds = (ctx.ties && ctx.ties.ends) || [], tieSources = (ctx.ties && ctx.ties.sources) || [];
    const sourceTo = new Map(tieSources.map(t => [t.place, t.to]));
    const isArrival = j => !!(N.v[j] && N.v[j][7]);
    /* the sounding quarter of the first arrival that starts after q (Infinity: none): where the damper comes up */
    const arrivalAfter = q => { for (let j = 0; j < N.v.length; j++) if (N.v[j][7] && N.v[j][6] > q + 1e-9) return N.v[j][6]; return Infinity; };
    const bad = msg => { out.bad++; if (out.unexplained.length < 8) out.unexplained.push(msg); };

    /* 1. the order: N's first leg is a prefix of L's visits */
    let k = 0;
    while (k < N.v.length && !N.v[k][3]) k++;
    for (let i = k; i < N.v.length; i++) if (!N.v[i][3]) { bad('visit ' + i + ' is a first-leg visit after a way-back visit'); break; }
    const wayBack = N.v.length - k;
    if (wayBack > 0) {
      if (!allow.JUMP) bad('the order has ' + wayBack + ' way-back visit(s) and no JUMP option was on');
      else { out.jump.turned = 1; out.jump.visitsAdded = wayBack; out.jump.visitsSkipped = Math.max(0, L.v.length - k); }
    }
    if (k > L.v.length) bad('the first leg has ' + k + ' visits, the legacy order only ' + L.v.length);
    for (let i = 0; i < Math.min(k, L.v.length); i++) {
      if (J(N.v[i].slice(0, 3).concat(N.v[i].slice(4))) !== J(L.v[i].slice(0, 3).concat(L.v[i].slice(4)))) { bad('visit ' + i + ' is ' + J(N.v[i]) + ', the legacy visit ' + J(L.v[i])); break; }
    }
    if (wayBack > 0 && k <= L.v.length) {
      const first = k < L.v.length ? L.v[k][6] : L.len;
      if (Math.abs(N.v[k][6] - first) > EPS) bad('the way back starts at ' + N.v[k][6] + ', the first leg ends at ' + first);
    }
    if (!wayBack && k < L.v.length) bad('the order stops after ' + k + ' of the legacy ' + L.v.length + ' visits with no way back');
    if (wayBack === 0 && N.len !== L.len) bad('the sounding length is ' + N.len + ', the legacy ' + L.len);

    /* 2. the first leg's controller events, beats and tempo map: exactly the legacy ones */
    const T = k < N.v.length ? N.v[k][6] : Infinity;
    [['ccs', 'c'], ['beats', 'b'], ['tempo map', 't']].forEach(([name, f]) => {
      const a = L[f].filter(e => e[0] < T - 1e-9), b = N[f].filter(e => e[0] < T - 1e-9);
      if (J(a) !== J(b)) {
        let i = 0;
        while (i < a.length && i < b.length && J(a[i]) === J(b[i])) i++;
        bad('the first leg\'s ' + name + ' differ at entry ' + i + ': ' + J(b[i]) + ' against the legacy ' + J(a[i]));
      }
    });

    /* 3. the first leg's strikes. Graces are N's own extras; the others are L's, equal unless a grace moved them. */
    const nearGrace = j => gm.has(N.v[j][0]) || (j + 1 < N.v.length && gm.has(N.v[j + 1][0]));
    const keyOf = s => s[0] + '|' + s[1] + '|' + s[4] + '|' + s[6] + '|' + s[7] + '|' + s[5];
    const group = list => { const m = new Map(); list.forEach(s => { const key = keyOf(s); if (!m.has(key)) m.set(key, []); m.get(key).push(s); }); m.forEach(a => a.sort((x, y) => x[2] - y[2] || x[3] - y[3])); return m; };
    const lFirst = L.s.filter(s => s[0] < k), nFirst = N.s.filter(s => s[0] < k && !s[8]);
    N.s.forEach(s => {
      if (!s[8]) return;
      out.grace.strikes++;
      if (!allow.GRACE) { bad('a grace strike (bar ' + s[7] + ', ' + s[4] + ') and no GRACE option was on'); return; }
      const vi = N.v[s[0]];
      if (!vi || !gm.has(vi[0])) bad('a grace strike in bar ' + s[7] + ', which holds no grace note');
      if (s[2] < -EPS || !(s[3] > s[2])) bad('a grace strike (bar ' + s[7] + ', ' + s[4] + ') starts at ' + s[2] + ' and is released at ' + s[3]);
    });
    const gl = group(lFirst), gn = group(nFirst);
    new Set([...gl.keys(), ...gn.keys()]).forEach(key => {
      const a = gl.get(key) || [], b = gn.get(key) || [];
      if (a.length !== b.length) { bad('the first leg has ' + b.length + ' strike(s) of ' + key + ' (visit|place|pitch|hand|bar|velocity), the legacy ' + a.length); return; }
      a.forEach((x, i) => {
        const y = b[i], dq = y[2] - x[2], du = y[3] - x[3];
        if (Math.abs(dq) <= EPS && Math.abs(du) <= EPS) return;
        /* the note before the sign, tied into a bar the way back does not go to: released at its own length (the tie at a jump) */
        if (allow.JUMP && Math.abs(dq) <= EPS && du < -EPS && isArrival(y[0] + 1) && sourceTo.has(placeOf(y)) && sourceTo.get(placeOf(y)) !== N.v[y[0] + 1][0] && y[3] > y[2] + EPS) { out.tie.cut++; return; }
        /* the damper comes up at the arrival of a jump: a release that was later than the end of the bar before the sign is that end (F3) */
        if (allow.JUMP && Math.abs(dq) <= EPS && du < -EPS && Math.abs(y[3] - Math.min(x[3], arrivalAfter(y[2]))) <= EPS) { out.tie.capped++; return; }
        if (!allow.GRACE) { bad('a strike moved (' + key + ': ' + x[2] + '..' + x[3] + ' became ' + y[2] + '..' + y[3] + ') and no GRACE option was on'); return; }
        if (!nearGrace(y[0])) { bad('a strike moved (' + key + ': ' + x[2] + '..' + x[3] + ' became ' + y[2] + '..' + y[3] + ') in a bar with no grace note near it'); return; }
        if (dq > EPS && du >= -EPS) out.grace.moved++;
        else if (Math.abs(dq) <= EPS && du < -EPS) out.grace.cut++;
        else if (dq > EPS && y[3] > y[2] + EPS) { out.grace.moved++; out.grace.cut++; }          /* moved by one group, cut by the next */
        else bad('a strike moved in a way no grace allows (' + key + ': ' + x[2] + '..' + x[3] + ' became ' + y[2] + '..' + y[3] + ')');
      });
    });

    /* 4. the way back: each visit is the same bar the legacy plays, so it sounds what the legacy visit of that bar sounds */
    for (let j = k; j < N.v.length; j++) {
      const idx = N.v[j][0];
      const lj = L.v.findIndex(v => v[0] === idx);
      out.jump.strikes += svOf(N)[j].filter(s => !s[8]).length;
      if (lj < 0) { out.jump.unchecked++; continue; }
      const timing = !nearGrace(j);
      /* the tie at a jump: what this visit may do differently from the old plan's visit of the same bar */
      const tie = { drop: new Set(), cut: new Set() };
      if (allow.JUMP && isArrival(j)) {
        const before = j > 0 ? N.v[j - 1][0] : -1;
        tieEnds.forEach(e => { if (e.bar === idx && e.from !== before) tie.drop.add(e.place); });
      }
      if (allow.JUMP && isArrival(j + 1)) {
        const next = N.v[j + 1][0];
        tieSources.forEach(t => { if (t.to !== next) tie.cut.add(t.place); });
      }
      { const A = arrivalAfter(N.v[j][6]); if (A < Infinity) tie.endDist = A - N.v[j][6]; }
      if (visitSig(N, j, timing, tie) !== visitSig(L, lj, timing, tie)) bad('way-back visit ' + j + ' (bar index ' + idx + ') does not sound what the legacy plays for that bar');
    }
    /* 5a. the damper at an arrival: where it is down as the sign is left, it comes up (an event marked `jump`, cc 64, value 0, at the arrival's start); and where the written pedal is down at
       the arrival's bar a pedal change presses it again. Read from N's own controller events. */
    if (allow.JUMP) {
      for (let j = k; j < N.v.length; j++) {
        if (!isArrival(j)) continue;
        const t0 = N.v[j][6];
        let down = 0;
        N.c.forEach(e => { if (e[1] === 64 && e[0] < t0 - 1e-9) down = e[2] > 0 ? e[2] : 0; });
        const lifts = N.c.some(e => e[3] && e[1] === 64 && e[2] === 0 && Math.abs(e[0] - t0) < 1e-9);
        if (down > 0 && !lifts) { out.tie.ringing++; bad('the damper is down as the way back leaves bar index ' + N.v[j - 1][0] + ' and is not lifted at the arrival in bar index ' + N.v[j][0]); }
        else if (lifts) out.tie.lifted++;
      }
      /* ...and no string is released after an arrival that begins while it sounds (a note the pedal or the sostenuto holds stops where the damper comes up) */
      let late = 0;
      N.s.forEach(x => { if (x[3] > arrivalAfter(x[2]) + EPS) late++; });
      if (late) { out.tie.ringing += late; bad(late + ' strike(s) are released after the arrival of a jump that begins while they sound (the damper comes up there)'); }
    }
    /* 5. the rule itself, read the other way round: where the tie leads nowhere the note is struck, and the note before the sign is not held through */
    if (allow.JUMP && (tieEnds.length || tieSources.length)) {
      for (let j = 0; j < N.v.length; j++) {
        const idx = N.v[j][0], mine = svOf(N)[j].filter(s => !s[8]);
        if (isArrival(j)) {
          const before = j > 0 ? N.v[j - 1][0] : -1;
          tieEnds.forEach(e => {
            if (e.bar !== idx || e.from === before) return;
            if (mine.some(s => placeOf(s) === e.place)) out.tie.struck++;
            else { out.tie.silent++; bad('a note tied from another bar is silent at the arrival in bar index ' + idx + ' (' + e.place + ')'); }
          });
        }
        if (isArrival(j + 1)) {
          const lj = j < k ? j : L.v.findIndex(v => v[0] === idx);
          if (lj < 0 || !L.v[lj]) continue;
          const old = svOf(L)[lj].filter(s => !s[8]);
          tieSources.forEach(t => {
            if (t.to === N.v[j + 1][0]) return;
            mine.filter(s => placeOf(s) === t.place).forEach(s => {
              const o = old.find(x => placeOf(x) === t.place);
              if (o && !(s[3] - s[2] < o[3] - o[2] - EPS)) { out.tie.held++; bad('a note before the sign is held through a tie into a bar the way back does not go to (bar index ' + idx + ', ' + t.place + ')'); }
            });
          });
        }
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ follow gates */
  /* the stretches of the play order follow mode gates in turn (practice/plan.js followGates, repeats): visits that follow one another on the page and
     on the same leg make one stretch. Returns [{first, last, leg, arrival}] with measure indexes (arrival: the stretch starts at the arrival of a jump). */
  function runsOf(D) {
    const runs = [];
    D.v.forEach(v => {
      const last = runs[runs.length - 1];
      if (last && Math.abs(last.endQ - v[4]) < 1e-9 && last.leg === v[3]) { last.last = v[0]; last.endQ = v[4] + v[5]; }
      else runs.push({ first: v[0], last: v[0], leg: v[3], endQ: v[4] + v[5], arrival: v[7] ? 1 : 0 });
    });
    return runs;
  }

  /* FOLLOW_REPEAT with no tie option: the gates must be exactly the oracle's. */
  function explainGatesExact(base, nu) {
    if (J(base) === J(nu)) return { bad: 0, unexplained: [] };
    if (base.length !== nu.length) return { bad: 1, unexplained: ['the gates are ' + nu.length + ', expected ' + base.length] };
    const i = base.findIndex((g, n) => J(g) !== J(nu[n]));
    return { bad: 1, unexplained: ['gate ' + i + ' is ' + J(nu[i]) + ', expected ' + J(base[i])] };
  }

  /* FOLLOW_TIE: `base` is what the legacy rule gates (or the oracle for a repeated play order), `nu` what the new rule gates; `dangling` is every
     [b, m, midi, hand] that a tie leads into from nowhere, once per stretch it is in. Returns { bad, unexplained, notes } (notes: how many were added). */
  function explainGatesTies(base, nu, dangling) {
    const out = { bad: 0, unexplained: [], notes: 0 };
    const bad = msg => { out.bad++; if (out.unexplained.length < 6) out.unexplained.push(msg); };
    const budget = new Map();
    dangling.forEach(d => { const key = d.join('|'); budget.set(key, (budget.get(key) || 0) + 1); });
    const take = (b, m, midi, hand) => {
      const key = [b, m, midi, hand].join('|'), c = budget.get(key) || 0;
      if (!c) return false;
      budget.set(key, c - 1); out.notes++;
      return true;
    };
    const danglesIn = (a, z) => dangling.some(d => d[0] > a + EPS && d[0] < z - EPS);
    const noteKeys = g => g[4].map(n => n[0] + '|' + n[1]);
    /* the notes of x that g does not have (multiset), or null when g has one that x lacks */
    const extra = (x, g) => {
      const have = new Map();
      noteKeys(x).forEach(k => have.set(k, (have.get(k) || 0) + 1));
      for (const k of noteKeys(g)) { const c = have.get(k) || 0; if (!c) return null; have.set(k, c - 1); }
      const rest = [];
      x[4].forEach(n => { const k = n[0] + '|' + n[1]; if ((have.get(k) || 0) > 0) { have.set(k, have.get(k) - 1); rest.push(n); } });
      return rest;
    };
    let i = 0, j = 0;
    while (i < base.length || j < nu.length) {
      const bg = base[i], xg = nu[j];
      if (bg && xg && J(bg) === J(xg)) { i++; j++; continue; }
      if (bg && xg && Math.abs(bg[0] - xg[0]) < EPS) {
        if (!bg[2] && !xg[2] && bg[1] === xg[1] && bg[3] === xg[3]) {
          const more = extra(xg, bg);
          if (more && more.length && more.every(n => take(xg[0], xg[1], n[0], n[1]))) { i++; j++; continue; }
        } else if (bg[2] && !xg[2] && xg[4].length && xg[4].every(n => take(xg[0], xg[1], n[0], n[1]))) { i++; j++; continue; }
        else if (bg[2] && xg[2] && bg[1] === xg[1] && xg[3] < bg[3] - EPS && danglesIn(bg[0], bg[0] + bg[3])) { i++; j++; continue; }
      }
      if (xg && !xg[2] && xg[4].length && (!bg || xg[0] < bg[0] - EPS) && xg[4].every(n => take(xg[0], xg[1], n[0], n[1]))) { j++; continue; }
      bad('gate ' + j + ' (' + J(xg) + ') is not the legacy gate ' + i + ' (' + J(bg) + ') plus a note a tie leads into from nowhere');
      break;
    }
    if (!out.bad) {
      let left = 0;
      budget.forEach(c => { left += c; });
      if (left) bad(left + ' note(s) that a tie leads into from nowhere are not asked');
    }
    return out;
  }

  return { strictOf, firstDiff, dumpOf, visitSig, explainPlan, svOf, runsOf, explainGatesExact, explainGatesTies, EPS };
});
