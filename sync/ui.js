/* PPP song sync, Settings > "Sync between devices (beta)" (G13-S1; docs/GOALS/G13_PRODUCTIZATION.md sections 7.1 and "G13-S1 as built").

   The one visible entry of the feature: a section of Settings that the page puts a <div data-sync-mount> for, and this file fills in. It is loaded only while PPP.sync is 'on'
   (the page's switch; 'off' is the default and then nothing of this exists), after sync/merge.js and sync/client.js.

   What a person does here: turn it on (a library is made; the link, the QR code and the code are shown, with the recovery code once), join a library by a code or by the
   link another device shows (a question first: what will be added), see how far the first upload is (it is slow by design: 240 songs an hour), answer the questions the
   engine asks (many removals, a long absence), add another device, change the code, stop syncing here, delete the library on the site, bring back a removed song (30 days).

   Everything it says goes through tx() (ko, ja, zh; English is the key). No text of the engine is shown as it is: the engine reports codes and numbers.

     PPPSync.boot({ adapter, storage, say, goSettings }) -> controller { engine, mount(el), unmount(), offerJoin(code), destroy() } */
(function (root) {
  'use strict';
  const doc = root.document;

  function interpolate(src, vars) {
    if (!vars) return src;
    return String(src).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
  }
  function tx(src, vars) {
    const I = root.PPP_I18N;
    return I && I.tx ? I.tx(src, vars) : interpolate(src, vars);
  }
  const HOUR = 3600 * 1000;
  const RC_KEY = 'ppp.sync.rc';                      /* the recovery code, in this tab's session only, until the person has saved it */

  /* ---------------------------------------------------------------- small DOM helpers */
  function h(tag, props, kids) {
    const el = doc.createElement(tag);
    if (props) {
      Object.keys(props).forEach(k => {
        const v = props[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'style') el.setAttribute('style', v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    (kids || []).forEach(c => { if (c === null || c === undefined || c === false) return; el.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
    return el;
  }
  const BASE = 'padding:10px 16px;border-radius:10px;font-family:inherit;font-size:12.5px;font-weight:600;white-space:nowrap;';
  const PRIM = BASE + 'border:0;background:var(--accent);color:#fff;cursor:pointer;';
  const SEC = BASE + 'border:1px solid var(--line);background:var(--bg);color:var(--ink);cursor:pointer;';
  const DANGER = BASE + 'border:1px solid var(--line);background:var(--bg);color:var(--bad);cursor:pointer;';
  const SOLID_BAD = BASE + 'border:0;background:var(--bad);color:#fff;cursor:pointer;';
  const NOTE = 'font-size:12px;line-height:1.5;color:var(--ink3);';
  const TEXT = 'font-size:12.5px;line-height:1.55;';
  const box = bad => 'display:flex;flex-direction:column;gap:10px;padding:12px 14px;border-radius:12px;background:var(--bg);border:1px solid ' + (bad ? 'var(--bad)' : 'var(--accent-2)') + ';';
  const INPUT = 'flex:1;min-width:0;flex-basis:220px;padding:9px 11px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font-family:\'JetBrains Mono\',monospace;font-size:11.5px;';
  /* the same field where it stands alone in a column (flex-basis would make it tall there) */
  const INPUT_FULL = INPUT.replace('flex:1;min-width:0;flex-basis:220px;', 'width:100%;box-sizing:border-box;');
  const ROW = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;';
  const SPLIT = 'display:flex;flex-direction:column;gap:8px;padding-top:14px;border-top:1px solid var(--line);';

  function locale() { try { return (root.PPP_I18N && root.PPP_I18N.getLocale && root.PPP_I18N.getLocale()) || 'en-US'; } catch (e) { return 'en-US'; } }
  function dateText(iso) {
    const t = Date.parse(iso);
    if (!isFinite(t)) return '';
    try { return new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(t)); } catch (e) { return new Date(t).toISOString().slice(0, 10); }
  }
  function ago(t) {
    if (!t) return tx('Not yet');
    const min = Math.max(0, (Date.now() - t) / 60000);
    if (min < 2) return tx('just now');
    if (min < 60) return tx('{{n}} min ago', { n: Math.round(min) });
    if (min < 60 * 24) return tx('{{n}} h ago', { n: Math.round(min / 60) });
    const days = Math.round(min / 1440);
    return days <= 1 ? tx('Yesterday') : tx('{{n}} days ago', { n: days });
  }
  function copyText(text, input) {
    try {
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) return root.navigator.clipboard.writeText(text).then(() => true, () => fallback());
    } catch (e) { /* the fallback */ }
    return Promise.resolve(fallback());
    function fallback() {
      try { if (input) { input.focus(); input.select(); return !!doc.execCommand('copy'); } } catch (e) { /* none */ }
      return false;
    }
  }

  /* the QR encoder is asked for only when a code is shown */
  let qrPromise = null;
  function loadQr() {
    if (root.PPPQr) return Promise.resolve(root.PPPQr);
    if (qrPromise) return qrPromise;
    qrPromise = new Promise(resolve => {
      try {
        const s = doc.createElement('script');
        s.src = './sync/qr.js?v=1';
        s.onload = () => resolve(root.PPPQr || null);
        s.onerror = () => resolve(null);
        doc.head.appendChild(s);
      } catch (e) { resolve(null); }
    }).then(q => { if (!q) qrPromise = null; return q; });
    return qrPromise;
  }

  /* ================================================================ boot */
  function boot(opts) {
    const Client = root.PPPSyncClient, Merge = root.PPPSyncMerge;
    if (!Client || !Merge) return null;
    const storage = opts.storage || root.localStorage;
    const engine = Client.create({
      storage: storage, adapter: opts.adapter, merge: Merge, backup: root.PPPBackup,
      fetch: (u, i) => root.fetch(u, i), base: opts.base || '',
      visible: () => !doc || doc.visibilityState !== 'hidden',
      online: () => !root.navigator || root.navigator.onLine !== false,
      copyTitle: t => tx('{{title}} (copy from another device)', { title: t }),
      indexedDB: root.indexedDB
    });
    const view = { panel: null, join: null, busy: false, msg: null, recovery: null, code: null, trash: [], trashLoaded: false, rcInput: '', codeInput: '', newCodeInput: '', showRecover: false, copied: '' };
    try { const rc = root.sessionStorage.getItem(RC_KEY); if (rc && engine.isOn()) { view.recovery = rc; view.panel = 'code'; } } catch (e) { /* no session storage */ }
    let mountEl = null, offI18n = null, offStatus = null, destroyed = false, qrSvg = '';

    const origin = () => { try { return root.location.origin; } catch (e) { return ''; } };
    const link = () => (engine.code() ? Client.linkFor(origin(), engine.code()) : '');
    const say = t => { try { if (opts.say) opts.say(t); } catch (e) { /* a toast */ } };
    const set = patch => { Object.assign(view, patch); render(); };
    const songsHere = () => { try { return opts.adapter.libraryRead().songs.filter(c => c && c.id !== 'demo').length; } catch (e) { return 0; } };

    function errorText(code) {
      switch (code) {
        case 'bad-format': return tx('That is not a sync code. It is 64 letters and numbers, or a link that has the code in it.');
        case 'bad-code': return tx('That code does not open a library. Check it and try again.');
        case 'rotated': return tx('This library has a new code. Enter the new one.');
        case 'deleted': return tx('That library was deleted.');
        case 'too-many': return tx('Too many tries from here just now. Wait a little and try again.');
        case 'busy': return tx('The server is busy. Try again in a few minutes.');
        case 'full': return tx('The library on the server is full. Remove songs you do not need and try again.');
        case 'offline': return tx('There is no connection right now. Try again when you are online.');
        case 'unsupported': return tx('This browser cannot compress songs for syncing. Try another browser.');
        case 'no-recovery': case 'bad-recovery': return tx('That recovery code does not match any library.');
        case 'cross-site': case 'unavailable': return tx('Syncing is not available on this site right now.');
        case 'storage': return tx('This browser has no room left. Remove a song from My Songs to make room.');
        default: return tx('Syncing did not work just now. It will try again.');
      }
    }

    /* ---------------------------------------------------------------- actions */
    async function turnOn() {
      if (view.busy) return;
      set({ busy: true, msg: null });
      const r = await engine.createLibrary();
      if (!r.ok) { set({ busy: false, msg: { kind: 'bad', text: errorText(r.error) } }); return; }
      try { root.sessionStorage.setItem(RC_KEY, r.recovery); } catch (e) { /* kept in memory only */ }
      if (opts.onTurnedOn) opts.onTurnedOn();
      engine.start();
      engine.syncNow('turn-on');
      set({ busy: false, panel: 'code', recovery: r.recovery, msg: null });
    }
    async function joinWith(code, addLocal) {
      if (view.busy) return;
      set({ busy: true, msg: null });
      const r = await engine.join(code, { addLocal: addLocal });
      if (!r.ok) { set({ busy: false, msg: { kind: 'bad', text: errorText(r.error) }, panel: view.panel === 'join' ? 'join' : view.panel }); return; }
      if (opts.onTurnedOn) opts.onTurnedOn();
      engine.start();
      engine.syncNow('join');
      set({ busy: false, join: null, panel: null, codeInput: '', msg: { kind: 'ok', text: tx('Joined. Your songs will come, and yours will be added. This can take a while: it goes on in the background.') } });
    }
    function startJoin(text) {
      const code = Client.parseCode(text);
      if (!code) { set({ msg: { kind: 'bad', text: errorText('bad-format') } }); return; }
      if (engine.isOn() && engine.code() === code) { set({ msg: { kind: 'info', text: tx('This device already uses that library.') }, codeInput: '' }); return; }
      set({ join: { code: code, n: songsHere(), hasLib: engine.isOn() }, panel: 'join', msg: null });
    }
    async function recoverWith() {
      if (view.busy) return;
      const text = view.rcInput;
      set({ busy: true, msg: null });
      const r = await engine.recover(text, { addLocal: true });
      if (!r.ok) { set({ busy: false, msg: { kind: 'bad', text: errorText(r.error === 'bad-code' ? 'bad-recovery' : r.error) } }); return; }
      try { root.sessionStorage.setItem(RC_KEY, r.recovery); } catch (e) { /* memory only */ }
      if (opts.onTurnedOn) opts.onTurnedOn();
      engine.start();
      engine.syncNow('recover');
      set({ busy: false, panel: 'code', recovery: r.recovery, rcInput: '', showRecover: false });
    }
    async function rotate() {
      if (view.busy) return;
      set({ busy: true, msg: null });
      const r = await engine.rotate();
      if (!r.ok) { set({ busy: false, panel: null, msg: { kind: 'bad', text: errorText(r.error) } }); return; }
      set({ busy: false, panel: 'code', msg: { kind: 'ok', text: tx('The code was changed. The old one no longer works: other devices must enter the new one.') } });
    }
    async function enterNewCode() {
      const c = Client.parseCode(view.newCodeInput);
      if (!c) { set({ msg: { kind: 'bad', text: errorText('bad-format') } }); return; }
      set({ busy: true });
      const r = await engine.enterNewCode(c);
      if (!r.ok) { set({ busy: false, msg: { kind: 'bad', text: errorText(r.error) } }); return; }
      engine.syncNow('new-code');
      set({ busy: false, newCodeInput: '', msg: { kind: 'ok', text: tx('Connected with the new code.') } });
    }
    function stop() {
      engine.forget();
      if (opts.onStopped) opts.onStopped();
      try { root.sessionStorage.removeItem(RC_KEY); } catch (e) { /* none */ }
      set({ panel: null, recovery: null, msg: { kind: 'ok', text: tx('Syncing is off on this device. Your songs here were not touched.') } });
    }
    async function deleteLib() {
      if (view.busy) return;
      set({ busy: true });
      const r = await engine.deleteLibrary();
      try { root.sessionStorage.removeItem(RC_KEY); } catch (e) { /* none */ }
      if (r.ok && opts.onStopped) opts.onStopped();
      if (!r.ok) { set({ busy: false, panel: null, msg: { kind: 'bad', text: errorText(r.error) } }); return; }
      set({ busy: false, panel: null, recovery: null, msg: { kind: 'ok', text: tx('The library was deleted from the server. Your songs on this device and in your backup files are still here.') } });
    }
    async function openTrash() {
      const rows = await engine.trashList();
      set({ panel: 'trash', trash: rows, trashLoaded: true, msg: null });
    }
    async function restoreRow(tid) {
      const r = await engine.restore(tid);
      const rows = await engine.trashList();
      set({ trash: rows, msg: r.ok ? { kind: 'ok', text: tx('The song is back in My Songs.') } : { kind: 'bad', text: errorText(r.error === 'storage' ? 'storage' : 'x') } });
      if (r.ok && opts.onSongsChanged) opts.onSongsChanged();
    }
    function confirmRecoverySaved() {
      try { root.sessionStorage.removeItem(RC_KEY); } catch (e) { /* none */ }
      set({ recovery: null });
    }

    /* ---------------------------------------------------------------- the view */
    function statusLine(st) {
      if (st.error === 'rotated') return { kind: 'bad', text: tx('This library has a new code. Enter the new one.') };
      if (st.error === 'deleted') return { kind: 'bad', text: tx('This library was deleted. Syncing has stopped; your songs here are still here.') };
      if (st.error === 'bad-code') return { kind: 'bad', text: tx('The code of this library is not valid any more.') };
      if (st.error === 'storage') return { kind: 'bad', text: errorText('storage') };
      if (st.error === 'full') return { kind: 'bad', text: errorText('full') };
      if (st.error === 'offline') return { kind: 'info', text: tx('There is no connection. Your songs wait here and are sent when you are online.') };
      if (st.error === 'busy' && st.songs.left > 0) {
        /* the library lets a device read and write a limited number an hour: that is not "busy", it is the hour's room, and it says how long */
        const h2 = Math.max(1, Math.ceil(Math.max(st.songs.etaMs, 1) / HOUR));
        return { kind: 'info', text: tx('{{done}} of {{total}} songs are synced. The rest takes about {{n}} hours: PPP sends a limited number each hour. You can keep practising.', { done: st.songs.done, total: st.songs.total, n: h2 }) };
      }
      if (st.error === 'busy') return { kind: 'info', text: tx('The server is busy. It will try again in a few minutes.') };
      if (st.phase === 'syncing') {
        if (st.pullTotal > 0) return { kind: 'info', text: tx('Syncing… {{done}} of {{total}} songs received', { done: Math.min(st.pulled, st.pullTotal), total: st.pullTotal }) };
        return { kind: 'info', text: tx('Syncing…') };
      }
      if (st.phase === 'waiting' || st.songs.left > 0 || st.songs.pending > 0) {
        const hours = Math.max(1, Math.ceil(st.songs.etaMs / HOUR));
        if (st.songs.etaMs > 0 || st.phase === 'waiting') return { kind: 'info', text: tx('{{done}} of {{total}} songs are synced. The rest takes about {{n}} hours: PPP sends a limited number each hour. You can keep practising.', { done: st.songs.done, total: st.songs.total, n: hours }) };
        return { kind: 'info', text: tx('{{done}} of {{total}} songs are synced. The rest goes in a moment.', { done: st.songs.done, total: st.songs.total }) };
      }
      return { kind: 'ok', text: tx('Synced {{when}}', { when: ago(st.lastSyncAt) }) };
    }

    function render() {
      if (destroyed || !mountEl) return;
      const st = engine.status();
      const root0 = mountEl;
      while (root0.firstChild) root0.removeChild(root0.firstChild);
      const card = h('div', { 'data-sync-section': '', style: 'border:1px solid var(--line);border-radius:18px;background:var(--surface);padding:20px 22px;display:flex;flex-direction:column;gap:14px;' });
      card.appendChild(h('div', null, [
        h('div', { style: 'font-size:14.5px;font-weight:600;', 'data-sync-title': '' }, [tx('Sync between devices (beta)')]),
        h('div', { style: NOTE + 'margin-top:3px;' }, [tx('Keep your songs and practice progress the same on your other devices. There is no sign-in: a secret code connects them.')])
      ]));
      const live = h('div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-sync-live': '' });
      if (view.msg) live.appendChild(h('div', { 'data-sync-msg': '', 'data-kind': view.msg.kind, style: TEXT + 'color:' + (view.msg.kind === 'bad' ? 'var(--bad)' : view.msg.kind === 'ok' ? 'var(--good)' : 'var(--ink2)') + ';' }, [view.msg.text]));
      card.appendChild(live);

      if (view.panel === 'join' && view.join) card.appendChild(joinBox());
      if (st.on) {
        card.appendChild(statusBlock(st));
        st.asks.forEach(a => card.appendChild(askBox(a)));
        if (view.panel === 'code') card.appendChild(codeBox());
        else if (view.panel === 'trash') card.appendChild(trashBox());
        else if (view.panel === 'stop') card.appendChild(stopBox());
        else if (view.panel === 'delete1' || view.panel === 'delete2') card.appendChild(deleteBox(view.panel === 'delete2'));
        else if (view.panel === 'rotate') card.appendChild(rotateBox());
        card.appendChild(actions(st));
        if (st.notices.length) card.appendChild(noticesBox(st));
      } else {
        card.appendChild(offBlock());
      }
      root0.appendChild(card);
      if (view.panel === 'code' || (view.recovery && st.on)) drawQr();
    }

    function offBlock() {
      const wrap = h('div', { style: 'display:flex;flex-direction:column;gap:12px;' });
      wrap.appendChild(h('div', { style: TEXT }, [tx('Anyone who has the code can see and change your songs. Keep it like a password: PPP cannot recover it for you.')]));
      wrap.appendChild(h('div', { style: NOTE }, [tx('The first upload can take a few hours when you have many songs. It goes on in the background and never stops you from practising.')]));
      wrap.appendChild(h('div', { style: ROW }, [
        h('button', { type: 'button', 'data-sync-on': '', style: PRIM + (view.busy ? 'opacity:.6;' : ''), disabled: view.busy ? true : null, onClick: turnOn }, [tx('Turn on syncing')])
      ]));
      const code = h('input', { type: 'text', 'data-sync-code-input': '', 'aria-label': tx('Code or link from another device'), placeholder: tx('Paste a code or a link from another device'), value: view.codeInput, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', style: INPUT,
        onInput: e => { view.codeInput = e.target.value; }, onKeydown: e => { if (e.key === 'Enter') startJoin(view.codeInput); } });
      wrap.appendChild(h('div', { style: SPLIT }, [
        h('div', { style: 'font-size:13px;font-weight:500;' }, [tx('Use a library you already have')]),
        h('div', { style: ROW }, [code, h('button', { type: 'button', 'data-sync-join': '', style: SEC, onClick: () => startJoin(view.codeInput) }, [tx('Connect')])])
      ]));
      const rc = view.showRecover;
      wrap.appendChild(h('div', { style: 'display:flex;flex-direction:column;gap:8px;' }, [
        h('button', { type: 'button', 'data-sync-recover-toggle': '', style: 'background:none;border:0;padding:0;text-align:left;font-family:inherit;font-size:12px;color:var(--accent);cursor:pointer;text-decoration:underline;', onClick: () => set({ showRecover: !rc }) }, [tx('I lost the code but I have the recovery code')]),
        rc ? h('div', { style: ROW }, [
          h('input', { type: 'text', 'data-sync-recovery-input': '', 'aria-label': tx('Recovery code'), placeholder: tx('Recovery code'), value: view.rcInput, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', style: INPUT, onInput: e => { view.rcInput = e.target.value; } }),
          h('button', { type: 'button', 'data-sync-recover': '', style: SEC, onClick: recoverWith }, [tx('Get the library back')])
        ]) : null
      ]));
      return wrap;
    }

    function statusBlock(st) {
      const s = statusLine(st);
      const wrap = h('div', { style: 'display:flex;flex-direction:column;gap:8px;' });
      wrap.appendChild(h('div', { 'data-sync-status': '', 'data-phase': st.phase, 'data-error': st.error || '', style: TEXT + 'font-weight:600;color:' + (s.kind === 'bad' ? 'var(--bad)' : s.kind === 'ok' ? 'var(--good)' : 'var(--ink)') + ';' }, [s.text]));
      if (st.songs.total > 0 && (st.songs.left > 0 || st.phase === 'syncing') && !st.error) {
        const pct = Math.max(0, Math.min(100, Math.round(st.songs.done / st.songs.total * 100)));
        wrap.appendChild(h('div', { 'data-sync-progress': String(pct), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': tx('Songs synced'),
          style: 'height:6px;border-radius:999px;background:var(--surface2);overflow:hidden;' }, [h('div', { style: 'height:100%;width:' + pct + '%;background:var(--accent);' })]));
      }
      if (st.keptUntil) wrap.appendChild(h('div', { 'data-sync-kept': '', style: NOTE }, [tx('The server keeps your library until {{date}}, 180 days after the last sync. Your songs on this device and in your backup files stay in any case.', { date: dateText(st.keptUntil) })]));
      wrap.appendChild(h('div', { 'data-sync-scope': '', style: NOTE }, [tx('Songs, scores and practice progress are synced. Settings, MIDI devices and the language stay on each device.')]));
      if (st.songs.bad > 0) wrap.appendChild(h('div', { 'data-sync-bad': '', style: TEXT + 'color:var(--bad);' }, [tx('{{n}} songs could not be synced.', { n: st.songs.bad })]));
      if (st.error === 'rotated' || st.error === 'bad-code') {
        wrap.appendChild(h('div', { style: ROW }, [
          h('input', { type: 'text', 'data-sync-newcode': '', 'aria-label': tx('The new code'), placeholder: tx('Paste the new code or link'), value: view.newCodeInput, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', style: INPUT, onInput: e => { view.newCodeInput = e.target.value; } }),
          h('button', { type: 'button', 'data-sync-newcode-go': '', style: PRIM, onClick: enterNewCode }, [tx('Connect')])
        ]));
      }
      return wrap;
    }

    function actions(st) {
      const wrap = h('div', { style: SPLIT });
      const row = h('div', { style: ROW });
      row.appendChild(h('button', { type: 'button', 'data-sync-now': '', style: SEC, onClick: () => engine.syncNow('now') }, [tx('Sync now')]));
      row.appendChild(h('button', { type: 'button', 'data-sync-add': '', style: SEC, onClick: () => set({ panel: view.panel === 'code' ? null : 'code', msg: null }) }, [tx('Add another device')]));
      row.appendChild(h('button', { type: 'button', 'data-sync-trash': '', style: SEC, onClick: openTrash }, [tx('Recently deleted')]));
      wrap.appendChild(row);
      const row2 = h('div', { style: ROW });
      row2.appendChild(h('button', { type: 'button', 'data-sync-rotate': '', style: SEC, onClick: () => set({ panel: 'rotate', msg: null }) }, [tx('Change the code…')]));
      row2.appendChild(h('button', { type: 'button', 'data-sync-stop': '', style: SEC, onClick: () => set({ panel: 'stop', msg: null }) }, [tx('Stop syncing on this device…')]));
      row2.appendChild(h('button', { type: 'button', 'data-sync-delete': '', style: DANGER, onClick: () => set({ panel: 'delete1', msg: null }) }, [tx('Delete the library on the server…')]));
      wrap.appendChild(row2);
      void st;
      return wrap;
    }

    function codeBox() {
      const code = engine.code();
      const wrap = h('div', { 'data-sync-code-box': '', role: 'group', 'aria-label': tx('Code of this library'), style: box(false) });
      if (view.recovery) {
        wrap.appendChild(h('div', { 'data-sync-recovery-box': '', style: box(true) }, [
          h('div', { style: TEXT + 'font-weight:600;' }, [tx('Recovery code - shown only now')]),
          h('div', { style: TEXT }, [tx('If you lose the library code and every device that has it, this code gives the library a new code. Whoever has it can take the library over, so keep it somewhere other than the code. PPP cannot show it again.')]),
          h('input', { type: 'text', readonly: true, 'data-sync-recovery-value': '', 'aria-label': tx('Recovery code'), value: view.recovery, style: INPUT_FULL, onFocus: e => e.target.select() }),
          h('div', { style: ROW }, [
            h('button', { type: 'button', 'data-sync-recovery-copy': '', style: SEC, onClick: e => { const inp = e.target.closest('[data-sync-recovery-box]').querySelector('input'); copyText(view.recovery, inp).then(ok => { view.copied = ok ? 'rc' : ''; if (ok) say(tx('Copied.')); }); } }, [tx('Copy')]),
            h('button', { type: 'button', 'data-sync-recovery-saved': '', style: PRIM, onClick: confirmRecoverySaved }, [tx('I saved it')])
          ])
        ]));
      }
      wrap.appendChild(h('div', { style: TEXT + 'font-weight:600;' }, [tx('Open this link on your other device, or scan the picture with its camera.')]));
      wrap.appendChild(h('div', { 'data-sync-qr': '', style: 'align-self:flex-start;width:200px;max-width:100%;border-radius:10px;overflow:hidden;background:#fff;border:1px solid var(--line);' }));
      const linkInput = h('input', { type: 'text', readonly: true, 'data-sync-link': '', 'aria-label': tx('Link to the library'), value: link(), style: INPUT, onFocus: e => e.target.select() });
      wrap.appendChild(h('div', { style: ROW }, [
        linkInput,
        h('button', { type: 'button', 'data-sync-link-copy': '', style: PRIM, onClick: () => copyText(link(), linkInput).then(ok => { if (ok) say(tx('Copied.')); }) }, [tx('Copy link')])
      ]));
      wrap.appendChild(h('div', { style: 'display:flex;flex-direction:column;gap:6px;' }, [
        h('div', { style: NOTE }, [tx('Or type this code on the other device:')]),
        h('div', { 'data-sync-code-text': '', style: 'font-family:\'JetBrains Mono\',monospace;font-size:12px;line-height:1.7;word-break:break-all;user-select:all;', 'data-no-i18n': '1' }, [Client.groupCode(code)])
      ]));
      wrap.appendChild(h('div', { 'data-sync-warning': '', style: TEXT + 'color:var(--bad);font-weight:600;' }, [tx('Anyone who has this code can see and change your songs. Keep it like a password: PPP cannot recover it for you.')]));
      wrap.appendChild(h('div', { style: ROW }, [h('button', { type: 'button', 'data-sync-code-close': '', style: SEC, onClick: () => set({ panel: null }) }, [tx('Close')])]));
      return wrap;
    }
    function drawQr() {
      const el = mountEl && mountEl.querySelector('[data-sync-qr]');
      const code = engine.code();
      if (!el || !code) return;
      loadQr().then(Q => {
        const target = mountEl && mountEl.querySelector('[data-sync-qr]');
        if (!target) return;
        if (!Q) { target.textContent = ''; target.style.display = 'none'; return; }
        try {
          qrSvg = Q.toSvg(Q.encode(Client.linkFor(origin(), code), { ecc: 'M' }), { border: 2, label: tx('QR code of the link to this library') });
          target.innerHTML = qrSvg;
          const svg = target.querySelector('svg');
          if (svg) { svg.style.display = 'block'; svg.style.width = '100%'; svg.style.height = 'auto'; }
        } catch (e) { target.textContent = ''; target.style.display = 'none'; }      /* too long for the encoder: the link and the code are there */
      });
    }

    function joinBox() {
      const j = view.join;
      const wrap = h('div', { 'data-sync-join-box': '', role: 'alertdialog', 'aria-label': tx('Join this song library?'), style: box(false) });
      wrap.appendChild(h('div', { style: TEXT + 'font-weight:600;' }, [tx('Join this song library?')]));
      wrap.appendChild(h('div', { style: TEXT }, [j.n > 0
        ? tx('Your {{n}} songs on this device will be added to it. The same song becomes one song and your practice is merged. Nothing on this device is removed or replaced.', { n: j.n })
        : tx('The songs of this library will come to this device. Nothing on this device is removed or replaced.')]));
      if (j.hasLib) wrap.appendChild(h('div', { 'data-sync-join-switch': '', style: TEXT + 'color:var(--bad);' }, [tx('This device is connected to another library now. It will leave that one; the songs here stay.')]));
      wrap.appendChild(h('div', { style: NOTE }, [tx('Join only a library that you made yourself or that someone you trust gave you: everyone who has its code can see and change the songs in it.')]));
      wrap.appendChild(h('div', { style: ROW }, [
        h('button', { type: 'button', 'data-sync-join-yes': '', style: PRIM, onClick: () => joinWith(j.code, true) }, [j.n > 0 ? tx('Join and add my songs') : tx('Join')]),
        j.n > 0 ? h('button', { type: 'button', 'data-sync-join-only': '', style: SEC, onClick: () => joinWith(j.code, false) }, [tx('Join, but keep my songs only on this device')]) : null,
        h('button', { type: 'button', 'data-sync-join-no': '', style: SEC, onClick: () => set({ join: null, panel: null }) }, [tx('Cancel')])
      ]));
      return wrap;
    }

    function titleList(titles, n) {
      const list = titles.filter(Boolean).slice(0, 5).map(t => '“' + t + '”').join(', ');
      return list ? list + (n > titles.filter(Boolean).slice(0, 5).length ? ', …' : '') : '';
    }
    function askBox(a) {
      const wrap = h('div', { 'data-sync-ask': a.kind, role: 'alertdialog', 'aria-label': tx('A question about your songs'), style: box(true) });
      const names = titleList(a.titles || [], a.n);
      if (a.kind === 'delete-in') {
        wrap.appendChild(h('div', { style: TEXT + 'font-weight:600;' }, [tx('{{n}} songs were removed on another device. Remove them here too?', { n: a.n })]));
        if (names) wrap.appendChild(h('div', { style: NOTE }, [names]));
        wrap.appendChild(h('div', { style: NOTE }, [tx('Removed songs are kept for 30 days in Recently deleted.')]));
        wrap.appendChild(h('div', { style: ROW }, [
          h('button', { type: 'button', 'data-sync-ask-yes': '', style: SOLID_BAD, onClick: () => engine.answer('delete-in', 'yes') }, [tx('Remove them here')]),
          h('button', { type: 'button', 'data-sync-ask-no': '', style: PRIM, onClick: () => engine.answer('delete-in', 'no') }, [tx('Keep them on this device')])
        ]));
      } else if (a.kind === 'delete-out') {
        wrap.appendChild(h('div', { style: TEXT + 'font-weight:600;' }, [tx('You removed {{n}} songs here. Remove them from your other devices too?', { n: a.n })]));
        if (names) wrap.appendChild(h('div', { style: NOTE }, [names]));
        wrap.appendChild(h('div', { style: NOTE }, [tx('Nothing is sent until you answer.')]));
        wrap.appendChild(h('div', { style: ROW }, [
          h('button', { type: 'button', 'data-sync-ask-yes': '', style: SOLID_BAD, onClick: () => engine.answer('delete-out', 'yes') }, [tx('Remove them everywhere')]),
          h('button', { type: 'button', 'data-sync-ask-no': '', style: PRIM, onClick: () => engine.answer('delete-out', 'no').then(() => { if (opts.onSongsChanged) opts.onSongsChanged(); }) }, [tx('No, bring them back here')])
        ]));
      } else if (a.kind === 'gone') {
        wrap.appendChild(h('div', { style: TEXT + 'font-weight:600;' }, [tx('This device was away for a long time. {{n}} songs here are no longer in the library: they may have been removed on another device.', { n: a.n })]));
        if (names) wrap.appendChild(h('div', { style: NOTE }, [names]));
        wrap.appendChild(h('div', { style: ROW }, [
          h('button', { type: 'button', 'data-sync-ask-yes': '', style: PRIM, onClick: () => engine.answer('gone', 'yes') }, [tx('Keep them and add them back')]),
          h('button', { type: 'button', 'data-sync-ask-no': '', style: SEC, onClick: () => engine.answer('gone', 'no').then(() => { if (opts.onSongsChanged) opts.onSongsChanged(); }) }, [tx('Remove them from this device')])
        ]));
      }
      return wrap;
    }

    function trashBox() {
      const wrap = h('div', { 'data-sync-trash-box': '', style: box(false) });
      wrap.appendChild(h('div', { style: TEXT + 'font-weight:600;' }, [tx('Recently deleted')]));
      wrap.appendChild(h('div', { style: NOTE }, [tx('Songs removed from this device, here or on another device, are kept for 30 days.')]));
      if (!engine.trashAvailable()) wrap.appendChild(h('div', { style: TEXT }, [tx('This browser cannot keep removed songs.')]));
      else if (!view.trash.length) wrap.appendChild(h('div', { 'data-sync-trash-empty': '', style: TEXT }, [tx('Nothing has been removed lately.')]));
      view.trash.forEach(r => {
        const days = Math.max(0, 30 - Math.floor((Date.now() - r.at) / 86400000));
        wrap.appendChild(h('div', { 'data-sync-trash-row': r.id, style: ROW + 'justify-content:space-between;' }, [
          h('div', { style: 'min-width:0;flex:1;flex-basis:200px;' }, [
            h('div', { style: 'font-size:13px;font-weight:500;overflow-wrap:anywhere;' }, [r.title || tx('Untitled')]),
            h('div', { style: NOTE }, [tx('Removed {{when}} · kept {{n}} more days', { when: ago(r.at), n: days })])
          ]),
          h('button', { type: 'button', 'data-sync-restore': r.id, style: SEC, onClick: () => restoreRow(r.tid) }, [tx('Restore')])
        ]));
      });
      wrap.appendChild(h('div', { style: ROW }, [h('button', { type: 'button', 'data-sync-trash-close': '', style: SEC, onClick: () => set({ panel: null }) }, [tx('Close')])]));
      return wrap;
    }
    function stopBox() {
      return h('div', { 'data-sync-stop-box': '', role: 'alertdialog', 'aria-label': tx('Stop syncing on this device'), style: box(true) }, [
        h('div', { style: TEXT }, [tx('This device stops syncing and forgets the code. Your songs here stay, the library on the server stays, and other devices go on syncing. You can join again with the code.')]),
        h('div', { style: ROW }, [
          h('button', { type: 'button', 'data-sync-stop-yes': '', style: SOLID_BAD, onClick: stop }, [tx('Stop syncing here')]),
          h('button', { type: 'button', 'data-sync-stop-no': '', style: SEC, onClick: () => set({ panel: null }) }, [tx('Cancel')])
        ])
      ]);
    }
    function rotateBox() {
      return h('div', { 'data-sync-rotate-box': '', role: 'alertdialog', 'aria-label': tx('Change the code'), style: box(true) }, [
        h('div', { style: TEXT }, [tx('A new code is made and the old one stops working at once. Every other device must enter the new code (or open the new link) before it syncs again. Use this if the code may have been seen by someone else.')]),
        h('div', { style: ROW }, [
          h('button', { type: 'button', 'data-sync-rotate-yes': '', style: SOLID_BAD, onClick: rotate }, [tx('Change the code')]),
          h('button', { type: 'button', 'data-sync-rotate-no': '', style: SEC, onClick: () => set({ panel: null }) }, [tx('Cancel')])
        ])
      ]);
    }
    function deleteBox(second) {
      const wrap = h('div', { 'data-sync-delete-box': second ? '2' : '1', role: 'alertdialog', 'aria-label': tx('Delete the library on the server'), style: box(true) });
      if (!second) {
        wrap.appendChild(h('div', { style: TEXT }, [tx('The library is deleted from the server: every synced song and its progress there. Your songs on this device, on your other devices and in backup files stay. Other devices stop syncing.')]));
        wrap.appendChild(h('div', { style: ROW }, [
          h('button', { type: 'button', 'data-sync-delete-next': '', style: DANGER, onClick: () => set({ panel: 'delete2' }) }, [tx('Go on')]),
          h('button', { type: 'button', 'data-sync-delete-no': '', style: SEC, onClick: () => set({ panel: null }) }, [tx('Cancel')])
        ]));
      } else {
        wrap.appendChild(h('div', { style: TEXT + 'font-weight:600;' }, [tx('Last check: delete the library on the server for good?')]));
        wrap.appendChild(h('div', { style: ROW }, [
          h('button', { type: 'button', 'data-sync-delete-yes': '', style: SOLID_BAD + (view.busy ? 'opacity:.6;' : ''), disabled: view.busy ? true : null, onClick: deleteLib }, [tx('Delete the library')]),
          h('button', { type: 'button', 'data-sync-delete-no2': '', style: SEC, onClick: () => set({ panel: null }) }, [tx('Cancel')])
        ]));
      }
      return wrap;
    }
    function noticesBox(st) {
      const lines = [];
      const seen = {};
      st.notices.slice(-6).forEach(n => {
        let text = null;
        if (n.code === 'copy') text = tx('Two devices changed “{{title}}” at the same time, so both versions are kept: the other one is a separate song.', { title: n.title || '' });
        else if (n.code === 'removed') text = n.n === 1 ? tx('A song removed on another device was removed here. It is in Recently deleted.') : tx('{{n}} songs removed on another device were removed here. They are in Recently deleted.', { n: n.n });
        else if (n.code === 'kept') text = tx('“{{title}}” was removed on another device, but you changed it here, so it was kept.', { title: n.title || '' });
        else if (n.code === 'reset') text = tx('The library on the server was older than this device, so this device sent its songs again.');
        else if (n.code === 'recovered') text = tx('{{n}} songs that were missing here came back from the library.', { n: n.n });
        else if (n.code === 'unreadable') text = tx('A song in the library could not be read and was skipped.');
        else if (n.code === 'changed-elsewhere') text = tx('A song you removed was changed on another device, so it came back.');
        else if (n.code === 'not-removed') text = tx('"{{title}}" was removed on another device, but this browser could not keep a copy in Recently deleted, so it was kept here.', { title: n.title || '' });
        if (text && !seen[text]) { seen[text] = 1; lines.push(h('div', { style: NOTE }, [text])); }
      });
      return h('div', { 'data-sync-notices': '', style: 'display:flex;flex-direction:column;gap:4px;' }, lines);
    }

    /* ---------------------------------------------------------------- mount */
    function mount(el) {
      unmount();
      mountEl = el;
      if (!el) return;
      render();
      offStatus = engine.on(() => { if (mountEl && mountEl.isConnected !== false) render(); });
      try { if (root.PPP_I18N && root.PPP_I18N.onChange) offI18n = root.PPP_I18N.onChange(() => render()); } catch (e) { offI18n = null; }
    }
    function unmount() {
      /* a code that was shown is put away when Settings is left (a recovery code that is not saved yet stays until it is) */
      if (view.panel === 'code' && !view.recovery) view.panel = null;
      if (offStatus) { offStatus(); offStatus = null; }
      if (offI18n && typeof offI18n === 'function') { try { offI18n(); } catch (e) { /* gone */ } }
      offI18n = null;
      mountEl = null;
    }

    /* a link was opened (or a code was typed elsewhere): the question comes first, in Settings */
    function offerJoin(code, how) {
      const c = Client.parseCode(code);
      if (!c) { set({ msg: { kind: 'bad', text: errorText('bad-format') }, panel: null }); return; }
      if (engine.isOn() && engine.code() === c) { set({ msg: { kind: 'info', text: tx('This device already uses that library.') }, panel: null }); return; }
      set({ join: { code: c, n: songsHere(), hasLib: engine.isOn() }, panel: 'join', msg: null });
      void how;
    }

    /* ---------------------------------------------------------------- the page's own events */
    const onVis = () => { if (!doc) return; if (doc.visibilityState === 'hidden') engine.flush(); else engine.wake('visible'); };
    const onHide = () => engine.flush();
    const onOnline = () => engine.wake('online');
    if (doc) doc.addEventListener('visibilitychange', onVis);
    root.addEventListener('pagehide', onHide);
    root.addEventListener('online', onOnline);
    if (engine.isOn()) engine.start();

    function destroy() {
      destroyed = true;
      unmount();
      if (doc) doc.removeEventListener('visibilitychange', onVis);
      root.removeEventListener('pagehide', onHide);
      root.removeEventListener('online', onOnline);
      engine.destroy();
    }
    return { engine: engine, mount: mount, unmount: unmount, offerJoin: offerJoin, destroy: destroy, render: render, _view: view };
  }

  root.PPPSync = { boot: boot, version: 1 };
})(typeof window !== 'undefined' ? window : this);
