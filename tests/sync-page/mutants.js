/* G13-S1: mutants of the sync page. Each one is the source of sync/merge.js, sync/client.js, sync/ui.js or the page with ONE rule or ONE safety check broken; the suite named
   with it must go red, or the check it is about is not held by anything.

     node tests/sync-page/mutants.js                 every Node-side mutant (merge.js and client.js), three at a time
     node tests/sync-page/mutants.js M03 C07         the named ones
     node tests/sync-page/mutants.js --page          the mutants of ui.js and of the page, in the browser suite (serial, fail-fast)
     node tests/sync-page/mutants.js --check         only that every anchor is in its source exactly once (a source that moved is told here)
   A Node mutant is run on a COPY of sync/ and library-backup.js in a temp folder (PPP_SYNC_MODULES_DIR): the tests load their modules from there. A page mutant is served to
   the browser in place of the file (PPP_SYNC_MUTANT, tests/sync-page/page.test.js). Needs puppeteer for --page (NODE_PATH or D:/PPP/node_modules). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const T = 'tests/sync-page/';

/* suites: what must go red */
const SUITES = {
  merge: { cmd: [T + 'merge.test.js'], env: {} },
  engine: { cmd: [T + 'engine.test.js'], env: {} },
  edge: { cmd: [T + 'engine-edge.test.js'], env: {} },
  converge: { cmd: [T + 'converge.test.js'], env: { PPP_SYNC_SEEDS: '4', PPP_SYNC_OPS: '60' } },
  qr: { cmd: [T + 'qr.test.js'], env: {} }
};

/* the rules of docs section 7.5 (G13-D7) and the checks of the engine */
const NODE = [
  /* ---- merge.js: the rules */
  { id: 'M01', file: 'sync/merge.js', why: 'both changed a score: no copy is kept (the other version is lost)', from: "fork: { item: copy, id: forkIdOf(key, lose.scoreHash), keptSide: side === 'a' ? 'local' : 'remote' },", to: 'fork: null,', suites: ['merge', 'engine'] },
  { id: 'M02', file: 'sync/merge.js', why: 'only the library changed the score: this device keeps its own (the change is overwritten)', from: "if (!localChanged) return finish('b', 'remote');", to: "if (!localChanged) return finish('a', 'local');", suites: ['merge', 'engine'] },
  { id: 'M03', file: 'sync/merge.js', why: 'both changed it: the OLDER stays the song', from: "const keep = side === 'a' ? local : remote, lose = side === 'a' ? remote : local;", to: "const keep = side === 'a' ? remote : local, lose = side === 'a' ? local : remote;", suites: ['merge', 'engine'] },
  { id: 'M04', file: 'sync/merge.js', why: 'the name of a copy is not the same on two devices (they make two copies)', from: "const forkIdOf = (key, scoreHash) => 'song-f' + hashText(String(key) + '|' + String(scoreHash)).slice(1, 17);", to: "const forkIdOf = (key, scoreHash) => 'song-f' + hashText(String(key) + '|' + String(scoreHash) + Math.random()).slice(1, 17);", suites: ['merge', 'converge'] },
  { id: 'M05', file: 'sync/merge.js', why: 'practice: the newer side\'s history only (the other\'s attempts are dropped)', from: "if (k === 'history') out[k] = comm(bk.mergeHistory, x, y);", to: "if (k === 'history') out[k] = side === 'a' ? x : y;", suites: ['merge', 'engine'] },
  { id: 'M06', file: 'sync/merge.js', why: 'memory: the newer side\'s only', from: "else if (k === 'memory') out[k] = comm(bk.mergeMemory, x, y);", to: "else if (k === 'memory') out[k] = side === 'a' ? x : y;", suites: ['merge'] },
  { id: 'M07', file: 'sync/merge.js', why: 'sections: the smaller count wins', from: "else if (k === 'secs') out[k] = comm(bk.mergeSecs, x, y);", to: "else if (k === 'secs') out[k] = side === 'a' ? y : x;", suites: ['merge'] },
  { id: 'M08', file: 'sync/merge.js', why: 'memLevel and blindRuns: the smaller', from: "else if (k === 'memLevel' || k === 'blindRuns') out[k] = maxNum(x, y);", to: "else if (k === 'memLevel' || k === 'blindRuns') out[k] = Math.min(x, y);", suites: ['merge', 'engine'] },
  { id: 'M09', file: 'sync/merge.js', why: 'mastered only when both say so', from: "else if (k === 'mastered') out[k] = !!(x || y);", to: "else if (k === 'mastered') out[k] = !!(x && y);", suites: ['merge'] },
  { id: 'M10', file: 'sync/merge.js', why: 'tempo and loop: the OLDER side\'s', from: "else out[k] = side === 'a' ? x : y;                       /* loop, tempo, file name, import source: the newer side's */", to: "else out[k] = side === 'a' ? y : x;", suites: ['merge', 'converge'] },
  { id: 'M11', file: 'sync/merge.js', why: 'the card: addedAt the later (a song looks newer than it is)', from: "out.addedAt = Math.min(ca.addedAt, cb.addedAt);", to: "out.addedAt = Math.max(ca.addedAt, cb.addedAt);", suites: ['merge'] },
  { id: 'M12', file: 'sync/merge.js', why: 'the card: what belongs to the score does not follow the score', from: "SCORE_BOUND.forEach(k => { if (has(own, k)) out[k] = own[k]; else delete out[k]; });", to: "", suites: ['merge'] },
  { id: 'M13', file: 'sync/merge.js', why: 'xp: the largest entry, not the sum of the devices', from: "Object.keys(e).forEach(d => { if (isObj(e[d]) && isNum(e[d].v)) n += e[d].v; });", to: "Object.keys(e).forEach(d => { if (isObj(e[d]) && isNum(e[d].v)) n = Math.max(n, e[d].v); });", suites: ['merge', 'engine'] },
  { id: 'M14', file: 'sync/merge.js', why: 'a device\'s counter: the entry with the EARLIER time wins', from: "else o[d] = (x.at || 0) !== (y.at || 0) ? ((x.at || 0) > (y.at || 0) ? x : y) : (x.v >= y.v ? x : y);", to: "else o[d] = (x.at || 0) !== (y.at || 0) ? ((x.at || 0) > (y.at || 0) ? y : x) : (x.v >= y.v ? x : y);", suites: ['merge'] },
  { id: 'M15', file: 'sync/merge.js', why: 'a device\'s own counter is all it shows (what a merge set is counted as its own)', from: "return { own: Math.max(0, rec.own + d), seen: c };", to: "return { own: c, seen: c };", suites: ['merge', 'engine', 'converge'] },
  { id: 'M16', file: 'sync/merge.js', why: 'many removals are never asked about', from: "    if (n > 3) return true;\n    return n >= 2 && total > 0 && n / total > 0.2;", to: "    return false;", suites: ['merge', 'engine'] },
  { id: 'M17', file: 'sync/merge.js', why: 'a fifth of the library is not a question (only 4 or more)', from: "    return n >= 2 && total > 0 && n / total > 0.2;", to: "    return false;", suites: ['merge'] },
  { id: 'M18', file: 'sync/merge.js', why: 'what arrives is not put through the backup module\'s bounds (a __proto__ key, nesting)', from: "    if (!raw.ok) return { ok: false, code: raw.code };\n", to: "", suites: ['merge'] },
  { id: 'M19', file: 'sync/merge.js', why: 'the score hash of an item is the sender\'s', from: "    item.scoreHash = scoreHashOf({ score: item.score });", to: "    item.scoreHash = typeof obj.scoreHash === 'string' ? obj.scoreHash : scoreHashOf({ score: item.score });", suites: ['merge'] },
  { id: 'M20', file: 'sync/merge.js', why: 'a link that is not a web address is kept', from: "    const blanked = B().sanitize(pseudo);", to: "    const blanked = 0;", suites: ['merge', 'edge'] },
  { id: 'M21', file: 'sync/merge.js', why: 'an item with a field a song does not have is taken', from: "    if (unknown.length) return { ok: false, code: 'unknown-field' };", to: "", suites: ['merge'] },
  { id: 'M22', file: 'sync/merge.js', why: 'the share mark (this browser\'s posts) travels in the card', from: "  const CARD_DROP = ['id', 'share'];", to: "  const CARD_DROP = ['id'];", suites: ['merge'] },
  { id: 'M23', file: 'sync/merge.js', why: 'the same score is not an identity (the same song twice after a join)', from: "    if (scoreHash) out.push('h:' + scoreHash);", to: "", suites: ['merge', 'engine'] },
  { id: 'M24', file: 'sync/merge.js', why: 'a name an id cannot have is not made safe', from: "    return 'song:' + (ID_RE.test(s) ? s : 'x' + hashText(s).slice(1, 25));", to: "    return 'song:' + s;", suites: ['merge', 'edge'] },
  { id: 'M25', file: 'sync/merge.js', why: 'the content hash includes the time (every save is a change; two devices never agree)', from: "if (k !== 'savedAt' && k !== 'score') o[k] = item[k];", to: "if (k !== 'score') o[k] = item[k];", suites: ['merge', 'engine', 'converge'] },
  /* ---- client.js: the safety checks */
  { id: 'C01', file: 'sync/client.js', why: 'removals that arrive are applied whatever their number (no question)', from: "const held = rest.length > 0 && M.needsAsk(rest.length, total);", to: "const held = false;", suites: ['engine'] },
  { id: 'C02', file: 'sync/client.js', why: 'removals made here are sent whatever their number (no question)', from: "if (rest.length > 0 && M.needsAsk(rest.length, total)) {", to: "if (false) {", suites: ['engine'] },
  { id: 'C03', file: 'sync/client.js', why: 'a removal beats an edit (the song that was changed here goes)', from: "const changed = r.d === 1 || (!!L && !(r.rev && r.lh === M.contentHash(L)));", to: "const changed = false;", suites: ['engine', 'converge'] },
  { id: 'C04', file: 'sync/client.js', why: 'a long absence is not noticed (the library is not listed whole)', from: "if (b.tooOld && since > 0) {", to: "if (false) {", suites: ['edge'] },
  { id: 'C05', file: 'sync/client.js', why: 'what the library lost is sent again without asking', from: "              S.gone = Array.from(new Set(S.gone.concat(missing)));", to: "              missing.forEach(k => { const r = S.keys[k]; r.rev = 0; r.hash = ''; r.d = 1; r.lh = ''; r.del = 0; });", suites: ['edge'] },
  { id: 'C06', file: 'sync/client.js', why: 'a library that is older than the device is not told apart (reset)', from: "if (b.reset && !reset) {", to: "if (false) {", suites: ['edge'] },
  { id: 'C07', file: 'sync/client.js', why: 'a conflict that carries the hash that was sent is a conflict (not "applied")', from: "if (c.hash && c.hash === x.hash && !c.deleted && !c.stale) { done(c.key, c.rev, x); return; }", to: "", suites: ['edge'] },
  { id: 'C08', file: 'sync/client.js', why: 'the revision seen is not named in a write (everything is a new item)', from: "list.push({ key: d.key, item: it, hash: h, localHash: h, base: r.rev || 0 });", to: "list.push({ key: d.key, item: it, hash: h, localHash: h, base: 0 });", suites: ['engine', 'converge'] },
  { id: 'C09', file: 'sync/client.js', why: 'the hour\'s room is not kept (the library has to refuse)', from: "const WRITES_PER_HOUR = 240, WRITE_MARGIN = 6,", to: "const WRITES_PER_HOUR = 4000, WRITE_MARGIN = 6,", suites: ['edge'] },
  { id: 'C10', file: 'sync/client.js', why: 'no wait after a failure (a loop)', from: "      S.next = now() + Math.max(1000, wait);", to: "      S.next = 0;", suites: ['edge'] },
  { id: 'C11', file: 'sync/client.js', why: 'the second wall for secrets is off', from: "      if (secrets().some(s => text.indexOf(s) >= 0)) {", to: "      if (false) {", suites: ['edge'] },
  { id: 'C12', file: 'sync/client.js', why: 'the code goes in the URL as well', from: "      if (code) headers['X-PPP-Lib'] = code;", to: "      if (code) { headers['X-PPP-Lib'] = code; path += (path.indexOf('?') < 0 ? '?' : '&') + 'lib=' + code; }", suites: ['engine'] },
  { id: 'C13', file: 'sync/client.js', why: 'cookies are sent', from: "body: body, credentials: 'omit', cache:", to: "body: body, credentials: 'include', cache:", suites: ['engine'] },
  { id: 'C14', file: 'sync/client.js', why: 'what arrives is taken as it is (not checked)', from: "        const c = d.ok ? M.checkIncoming(m.key, d.obj) : d;", to: "        const c = d.ok ? { ok: true, item: Object.assign({ v: 1, card: {}, progress: {}, scoreHash: '' }, d.obj) } : d;", suites: ['edge'] },
  { id: 'C15', file: 'sync/client.js', why: 'the score of the song on the screen is replaced under the person\'s hands', from: "if (isOpen && L.scoreHash !== remote.scoreHash) { res.deferred.push(g.meta); return; }", to: "", suites: ['edge'] },
  { id: 'C16', file: 'sync/client.js', why: 'removed songs are not kept (Recently deleted is empty)', from: "        await trash.put({ tid: id + '@' + now(), id: id,", to: "        if (true) return false;\n        await trash.put({ tid: id + '@' + now(), id: id,", suites: ['engine', 'converge'] },
  { id: 'C17', file: 'sync/client.js', why: 'the copy of a forked score is not written', from: "            plan.push({ id: fid, text: JSON.stringify(M.slotOfItem(merged.fork.item)),", to: "            if (false) plan.push({ id: fid, text: JSON.stringify(M.slotOfItem(merged.fork.item)),", suites: ['engine', 'converge'] },
  { id: 'C18', file: 'sync/client.js', why: 'a frozen page is written to', from: "const frozen = () => !!(adapter.frozen && adapter.frozen());", to: "const frozen = () => false;", suites: ['edge'] },
  { id: 'C19', file: 'sync/client.js', why: 'two tabs run cycles at once', from: "      if (isObj(cur) && cur.tab !== tabId && now() - cur.t < CYCLE_LOCK_MS) return false;", to: "", suites: ['edge'] },
  { id: 'C20', file: 'sync/client.js', why: 'an unanswered question lets the cursor go (it is never asked again)', from: "          if (!a.held) S.since = pl.since;", to: "          S.since = pl.since;", suites: ['engine'] },
  { id: 'C22', file: 'sync/client.js', why: 'the person\'s removals are not recorded (never sent)', from: "          removedPut(id, { at: now(), key: key, title: typeof card.title === 'string' ? card.title : '' });", to: "", suites: ['engine', 'converge'] },
  { id: 'C23', file: 'sync/client.js', why: 'a new code is not noticed (the other devices go on trying with the old one)', from: "        rt.error = c === 'rotated' ? 'rotated' : c === 'deleted' ? 'deleted' : 'bad-code';\n        S.next = now() + 24 * HOUR;\n        return;", to: "        rt.error = 'offline';\n        backoff(e);\n        return;", suites: ['edge'] },
  { id: 'C24', file: 'sync/client.js', why: 'the song on the screen is marked changed after the library\'s practice was merged in (its old text is sent over)', from: "patch: Object.assign({}, patch, { lh: M.contentHash(remote) }), mapped: mapped, item: remote, openOnly: true });", to: "patch: Object.assign({}, patch, { d: 1, lh: '' }), mapped: mapped, item: remote, openOnly: true });", suites: ['edge'] },
  { id: 'C25', file: 'sync/client.js', why: 'the library\'s cursor does not follow our own writes (every push is followed by a listing)', from: "&& revs.length === b.maxRev - S.since) S.since = b.maxRev;", to: "&& revs.length === b.maxRev - S.since && false) S.since = b.maxRev;", suites: ['edge'] },
  { id: 'C26', file: 'sync/client.js', why: 'the cursor follows our own writes even over another device\'s (it steps over them)', from: "if (revs.length && !(Array.isArray(b.conflicts) && b.conflicts.length) && isNum(b.maxRev) && revs[0] === S.since + 1 && revs[revs.length - 1] === b.maxRev && revs.length === b.maxRev - S.since) S.since = b.maxRev;", to: "if (revs.length && isNum(b.maxRev)) S.since = b.maxRev;", suites: ['edge'] },
  { id: 'C27', file: 'sync/client.js', why: 'a request is never given up', from: "const timer = ctl ? setT(() => { try { ctl.abort(); } catch (e) { /* done */ } }, o.timeout || (method === 'PUT' ? 120000 : 45000)) : null;", to: "const timer = null;", suites: ['edge'] },
  { id: 'C28', file: 'sync/client.js', why: 'a song that was never sent and is gone stays in the books (pending for ever)', from: "        if (!r.rev && !r.del) { delete S.keys[key]; return; }", to: "", suites: ['edge'] },
  { id: 'C29', file: 'sync/client.js', why: 'a tombstone is never forgotten', from: "        if (r.del && isNum(r.delAt) && t - r.delAt > 35 * DAY) { delete S.keys[key]; return; }", to: "", suites: ['edge'] },
  { id: 'C30', file: 'sync/client.js', why: 'an id with characters the library refuses is not remembered with its name (its removal is a loss that comes back)', from: "          if (key !== 'song:' + id) r.id = id;", to: "", suites: ['edge'] },
  { id: 'C31', file: 'sync/client.js', why: 'a hostile id collision overwrites another song', from: "if (!linked && cards[id] && keyForId(id) !== key && S.keys[keyForId(id)] && S.keys[keyForId(id)].rev) id = 'song-r' + M.hashText(key).slice(1, 15);", to: "", suites: ['edge'] },
  { id: 'C32', file: 'sync/client.js', why: 'what could not be written to a full disk is half done', from: "      if (!writeSongs(plan.map(p => ({ id: p.id, text: p.text, card: p.card, before: p.before })))) { res.failed = true; res.copies = []; return res; }", to: "      writeSongs(plan.map(p => ({ id: p.id, text: p.text, card: p.card, before: p.before })));", suites: ['edge'] },
  { id: 'C34', file: 'sync/client.js', why: 'the yes of a question covers songs that came after it (they are sent without being asked about)', from: "      const rest = removed.filter(x => okIds.indexOf(x.id) < 0);", to: "      const rest = [];", suites: ['edge'] },
  { id: 'C35', file: 'sync/client.js', why: 'a removal that came from elsewhere is carried out although no copy could be kept', from: "        if (!x.raw || await trashPut(x.id, x.card, x.raw, why)) { list.push(x); continue; }", to: "        await trashPut(x.id, x.card, x.raw, why); list.push(x); continue;", suites: ['edge'] },
  { id: 'C33', file: 'sync/client.js', why: 'a body is not bounded when it is unpacked', from: "      if (total > max) { try { await reader.cancel(); } catch (e) { /* cancelled */ } return null; }", to: "", suites: ['edge'] }
];
void SUITES;

/* the browser: ui.js and the page. { id, file ('sync/ui.js' | 'Piano Coach App.dc.html'), from, to } */
const PAGE = [
  { id: 'P01', file: 'Piano Coach App.dc.html', why: 'the head script takes a #lib= while the switch is off', from: "    if (h.slice(0, 5) !== '#lib=' || !on()) return;", to: "    if (h.slice(0, 5) !== '#lib=') return;" },
  { id: 'P02', file: 'Piano Coach App.dc.html', why: 'the switch is on by default', from: "const SYNC_DEFAULT = 'off';", to: "const SYNC_DEFAULT = 'on';" },
  { id: 'P03', file: 'Piano Coach App.dc.html', why: 'the page does not tell the engine about a removal', from: "        this._sync.engine.noteRemoved(id, gone, localStorage.getItem(SONG_KEY + id));", to: "" },
  { id: 'P04', file: 'sync/ui.js', why: 'a link joins at once (no question)', from: "      set({ join: { code: c, n: songsHere(), hasLib: engine.isOn() }, panel: 'join', msg: null });\n      void how;", to: "      joinWith(c, true);" },
  { id: 'P05', file: 'sync/ui.js', why: 'the recovery code stays after "I saved it"', from: "      try { root.sessionStorage.removeItem(RC_KEY); } catch (e) { /* none */ }\n      set({ recovery: null });", to: "      set({ recovery: view.recovery });" },
  { id: 'P06', file: 'sync/ui.js', why: 'stopping does not forget the code', from: "    function stop() {\n      engine.forget();", to: "    function stop() {" },
  { id: 'P07', file: 'sync/ui.js', why: 'the library is deleted at the first tap', from: "onClick: () => set({ panel: 'delete2' }) }, [tx('Go on')]),", to: "onClick: deleteLib }, [tx('Go on')]),", flags: 'ui' },
  { id: 'P08', file: 'sync/ui.js', why: 'the code is changed at the first tap (no question)', from: "onClick: () => set({ panel: 'rotate', msg: null }) }, [tx('Change the code…')]));", to: "onClick: rotate }, [tx('Change the code…')]));" },
  { id: 'P09', file: 'Piano Coach App.dc.html', why: 'the page lets the engine write while a restore or a delete freezes it', from: "      frozen: () => !!A._frozen,", to: "      frozen: () => false," },
  { id: 'P10', file: 'sync/ui.js', why: 'the code is shown in the link as a query (sent to the server)', from: "const link = () => (engine.code() ? Client.linkFor(origin(), engine.code()) : '');", to: "const link = () => (engine.code() ? origin() + '/?sync=on&lib=' + engine.code() : '');" }
];

function lf(t) { return String(t).split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)); }
function applyMutant(src, m) {
  let out = lf(src);
  [[m.from, m.to]].concat(m.also || []).forEach(pair => {
    const from = lf(pair[0]);
    const n = out.split(from).length - 1;
    if (n !== 1) throw new Error('mutant ' + m.id + ': its anchor is in the source ' + n + ' times (must be once): ' + from.slice(0, 80));
    out = out.split(from).join(pair[1]);
  });
  return out;
}

function copyModules(dest, mutant) {
  fs.mkdirSync(path.join(dest, 'sync'), { recursive: true });
  ['merge.js', 'client.js', 'qr.js', 'ui.js'].forEach(f => fs.copyFileSync(path.join(REPO, 'sync', f), path.join(dest, 'sync', f)));
  fs.copyFileSync(path.join(REPO, 'library-backup.js'), path.join(dest, 'library-backup.js'));
  if (mutant) {
    const target = path.join(dest, mutant.file);
    fs.writeFileSync(target, applyMutant(fs.readFileSync(target, 'utf8'), mutant));
  }
}
function run(cmd, env, cwd, timeoutMs) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, cmd, { cwd: cwd, env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* gone */ } }, timeoutMs || 600000);
    child.on('exit', code => { clearTimeout(timer); resolve({ code: code, out: out }); });
  });
}
async function killed(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-sync-mut-'));
  try {
    copyModules(dir, m);
    for (const s of m.suites) {
      const S = SUITES[s];
      const r = await run(S.cmd, Object.assign({ PPP_SYNC_MODULES_DIR: dir }, S.env), REPO, 300000);
      if (r.code !== 0) {
        const out = r.out.split('\n').filter(l => l.trim());
        const bad = (out.filter(l => /^\s*✗/.test(l))[0] || ('(no check failed: ' + (out.filter(l => /Error|    at /.test(l))[0] || out[out.length - 1] || '') + ')')).trim().slice(0, 120);
        return { by: s, detail: bad };
      }
    }
    return null;
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the temp folder stays */ } }
}
async function pageKilled(m) {
  const r = await run([T + 'page.test.js'], { PPP_SYNC_MUTANT: JSON.stringify(m), PPP_SYNC_FAILFAST: '1', NODE_PATH: process.env.NODE_PATH || 'D:/PPP/node_modules' }, REPO, 900000);
  if (r.code === 0) return null;
  const bad = (r.out.split('\n').filter(l => /✗/.test(l))[0] || r.out.split('\n').slice(-3).join(' ')).trim().slice(0, 130);
  return { by: 'page', detail: bad };
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check'), page = args.includes('--page');
  const names = args.filter(a => !a.startsWith('--'));
  const list = (page ? PAGE : NODE).filter(m => !names.length || names.indexOf(m.id) >= 0);
  /* every anchor, once */
  let bad = 0;
  for (const m of (names.length ? list : NODE.concat(PAGE))) {
    try { applyMutant(fs.readFileSync(path.join(REPO, m.file), 'utf8'), m); } catch (e) { bad++; console.error(e.message); }
  }
  if (bad) { console.error(bad + ' anchor(s) moved'); process.exit(2); }
  if (check) { console.log('all ' + (NODE.length + PAGE.length) + ' anchors are in their sources exactly once'); return; }
  let survived = 0, done = 0;
  const t0 = Date.now();
  const worker = async queue => {
    while (queue.length) {
      const m = queue.shift();
      const k = page ? await pageKilled(m) : await killed(m);
      done++;
      if (k) console.log('  killed   ' + m.id + ' (' + k.by + ') ' + m.why + (k.detail ? '  [' + k.detail + ']' : ''));
      else { survived++; console.log('  SURVIVED ' + m.id + ' ' + m.why); }
    }
  };
  const queue = list.slice();
  await Promise.all(Array.from({ length: page ? 1 : 3 }, () => worker(queue)));
  console.log('\n' + (list.length - survived) + ' of ' + list.length + ' mutants killed in ' + Math.round((Date.now() - t0) / 1000) + ' s' + (survived ? ', ' + survived + ' SURVIVED' : ''));
  process.exit(survived ? 1 : 0);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { NODE, PAGE, applyMutant };
