/* ============================================================================
   G10b-3: tools/home-worker/worker.js --pair (and pair.cmd) - the one-click side of the pairing link, with the clipboard and the browser stubbed.

   The link  <siteUrl>/#pc=<client code>  is copied to the Windows clipboard (clip, the link on its standard input) and opened in the PC's browser (rundll32 url.dll,FileProtocolHandler <link>), and a
   Korean sentence says what to do. The code is the MASTER secret of the PC link, so this pins:
     - where the code comes from (settings clientCode: a code or a whole link; else pc-code.txt next to the settings; never echoed when it is wrong)
     - the argument vectors: no shell anywhere, the code on clip's stdin, the link as ONE argument of the opener, nothing else carries it
     - the code is never printed: not by the log (it hides it, also in a pairing link), not on the console - unless --show
     - nothing is sent to the site; an address that is not a plain http(s) one never reaches a program; every failure says what to do
     - the real processes: with real children (Node scripts standing in for clip and the browser) the bytes that arrive are exactly the link
     - G10b-4: TWO links - the PHONE link (clip, --show) never has "&local=1"; the link opened in THIS PC's browser has it; the output names the link (linkTag: 6 characters,
       the same the site gives, no character of the code) and never says the PC is connected (the page may still ask); "&anything" after the code is understood

   node tests/home-worker/pair.test.js */
'use strict';
const L = require('./lib');
const { ok, heading } = L;
const W = L.mod('tools/home-worker/worker.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Writable } = require('stream');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');

const CODE = 'df939159694a77c96e27fbeb72188b19d39e52de415adf1e2d73d9dca13e445d';
const SITE = 'https://ppp-web-2o99.onrender.com';
const LINK = SITE + '/#pc=' + CODE;
const TOKEN = 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43);
const LINK_PC = LINK + '&local=1';                       /* what this PC's own browser is given */
const TAG = W.linkTagOf(CODE);

/* a spawn that records what it was asked and answers as the plan says */
function fakeSpawn(plan) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    const c = { cmd: cmd, args: args.slice(), opts: opts, stdin: null };
    const i = calls.push(c) - 1;
    const how = (plan && plan(c, i)) || {};
    if (how.throws) throw Object.assign(new Error('spawn ' + cmd + ' ENOENT'), { code: 'ENOENT' });
    const child = new EventEmitter();
    child.stdin = opts && opts.stdio && opts.stdio[0] === 'pipe' ? new Writable({ write(chunk, enc, cb) { c.stdin = (c.stdin || '') + chunk.toString(); cb(); } }) : null;
    child.kill = () => {};
    setImmediate(() => { if (how.error) child.emit('error', Object.assign(new Error('boom'), { code: how.error })); else child.emit('close', how.exit == null ? 0 : how.exit); });
    return child;
  };
  fn.calls = calls;
  return fn;
}
const sinks = () => { const s = { out: [], err: [] }; s.stdout = l => s.out.push(l); s.stderr = l => s.err.push(l); s.all = () => s.out.concat(s.err).join('\n'); return s; };
const cfgOf = over => Object.assign({}, W.DEFAULTS, { siteUrl: SITE, token: TOKEN, clientCode: CODE, _file: '' }, over || {});
const tmp = L.tmpDir('ppp-pair-');

(async () => {
  heading('the code, from what a person pastes');
  {
    ok('the plain code, capitals, spaces every 8, dashes, a whole pairing link, a link with %20 and words before it', [CODE, CODE.toUpperCase(), CODE.match(/.{1,8}/g).join(' '), CODE.match(/.{1,8}/g).join('-'), LINK, SITE + '/#pc=' + CODE.match(/.{1,8}/g).join('%20'), 'open ' + LINK + '\r\n'].every(t => W.codeFrom(t) === CODE));
    ok('not a code: 63 and 65 hex, letters outside 0-9a-f, empty, null, a link with a short code, two codes', ['', null, undefined, CODE.slice(1), CODE + '0', 'g'.repeat(64), SITE + '/#pc=' + CODE.slice(2), CODE + CODE].every(t => W.codeFrom(t) === ''));
    ok('G10b-4: what follows an "&" after "#pc=<code>" is not part of the code (&local=1, &utm=x, both); a shorter or longer hex run is still no code; an "&" without "#pc=" is no code', [LINK + '&local=1', LINK + '&utm=x&local=1', LINK + '&', LINK.toUpperCase().replace('HTTPS://PPP-WEB-2O99.ONRENDER.COM/#PC=', SITE + '/#pc=') + '&x'].every(t => W.codeFrom(t) === CODE)
      && ['#pc=' + CODE + '0&local=1', SITE + '/#pc=' + CODE.slice(1) + '&local=1', SITE + '/#pc=' + CODE + CODE + '&x=1', SITE + '/#pc=&' + CODE, CODE + '&local=1', CODE + '&'].every(t => W.codeFrom(t) === ''));
  }

  heading('the link\'s name (linkTag): the same 6 characters as the site\'s, none of them a secret');
  {
    const J = L.mod('home-jobs.js');
    const serverTag = J.linkTagOf(J.linkIdOf(J.codeHash(CODE)));
    ok('the worker computes the site\'s linkTag from the code, offline: 6 lowercase hex, the last 6 of the link id', /^[0-9a-f]{6}$/.test(TAG) && TAG === serverTag && TAG === J.linkIdOf(J.codeHash(CODE)).slice(-6), TAG + ' vs ' + serverTag);
    ok('for 200 random codes too (the same derivation on both sides)', Array.from({ length: 200 }, () => require('crypto').randomBytes(32).toString('hex')).every(c => W.linkTagOf(c) === J.linkTagOf(J.linkIdOf(J.codeHash(c)))));
    ok('it is not made of the code: the 6 characters are not in the code; for what is not a code it is empty', !CODE.includes(TAG) && W.linkTagOf('') === '' && W.linkTagOf('abc') === '' && W.linkTagOf(null) === '' && W.linkTagOf(CODE.toUpperCase()) === '');
    ok('the site gives it only for a link id (null for anything else)', J.linkTagOf('pc_' + 'ab'.repeat(11)) === 'ababab' && J.linkTagOf('u_123') === null && J.linkTagOf('pc_xyz') === null && J.linkTagOf(undefined) === null);
  }

  heading('the settings: clientCode is optional, cleaned, and never the worker\'s business');
  {
    const f = n => path.join(tmp, n);
    const write = (n, o) => { fs.writeFileSync(f(n), JSON.stringify(Object.assign({ siteUrl: SITE, token: TOKEN }, o))); return f(n); };
    ok('a code in clientCode is read; so is a whole link, with capitals and spaces', W.loadConfig(write('a.json', { clientCode: CODE }), {}).clientCode === CODE && W.loadConfig(write('b.json', { clientCode: LINK.toUpperCase().replace('HTTPS://PPP-WEB-2O99.ONRENDER.COM/#PC=', LINK.slice(0, LINK.indexOf('#pc=') + 4)) }), {}).clientCode === CODE && W.loadConfig(write('c.json', { clientCode: ' ' + CODE.match(/.{1,8}/g).join(' ') + ' ' }), {}).clientCode === CODE);
    const none = W.loadConfig(write('d.json', {}), {});
    const junk = W.loadConfig(write('e.json', { clientCode: 'not a code' }), {});
    ok('no clientCode is the empty string; a wrong one is cleaned to the empty string and remembered as "given" (so --pair can say it is wrong)', none.clientCode === '' && !none._clientCodeGiven && junk.clientCode === '' && junk._clientCodeGiven === true);
    ok('the example settings file has the key, empty', JSON.parse(fs.readFileSync(path.join(L.REPO, 'tools/home-worker/worker.config.example.json'), 'utf8')).clientCode === '');
    ok('a settings file with clientCode makes no new problem for the worker (configProblems is the same)', W.configProblems(Object.assign({}, W.loadConfig(write('f.json', { clientCode: CODE, pythonPath: process.execPath, transcribePy: __filename }), {}))).length === 0);
    const cap = sinks();
    const code = await W.checkSetup(W.loadConfig(write('g.json', { clientCode: CODE, pythonPath: process.execPath, transcribePy: __filename, kongCheckpoint: __filename }), {}), W.makeLog({ token: TOKEN, clientCode: CODE }, cap.stdout, cap.stderr), { runTool: () => Promise.resolve({ code: 0, tail: 'cuda\n' }), request: () => Promise.resolve({ status: 200, body: { nextPollSeconds: 3600 } }) });
    ok('--check never mentions it', code === 0 && !cap.all().includes(CODE) && !/#pc=/.test(cap.all()), cap.all().slice(-300));
  }

  heading('where the code is: clientCode, else pc-code.txt next to the settings');
  {
    const dir = path.join(tmp, 'cfgdir'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'worker.config.json');
    const base = cfgOf({ clientCode: '', _file: file });
    const put = t => fs.writeFileSync(path.join(dir, 'pc-code.txt'), t);
    try { fs.unlinkSync(path.join(dir, 'pc-code.txt')); } catch (e) { /* none */ }
    const none = W.findPcCode(base);
    ok('nothing anywhere: "none", and the file it looked for is named (next to the settings)', none.code === '' && none.problem === 'none' && none.file === path.join(dir, 'pc-code.txt'), JSON.stringify(none));
    put(CODE + '\n'); ok('pc-code.txt with the code and a newline', W.findPcCode(base).code === CODE);
    put('﻿' + LINK + '\r\n'); ok('pc-code.txt with a BOM and the whole pairing link (what PPP copies)', W.findPcCode(base).code === CODE);
    put('  ' + CODE.toUpperCase() + '  '); ok('with capitals and spaces', W.findPcCode(base).code === CODE);
    put('please paste the link here'); const bad = W.findPcCode(base);
    ok('a file that holds something else: "bad-file", and what it holds is not in the answer', bad.code === '' && bad.problem === 'bad-file' && !JSON.stringify(bad).includes('paste'));
    put(CODE); ok('the settings win over the file', W.findPcCode(Object.assign({}, base, { clientCode: 'ab'.repeat(32) })).code === 'ab'.repeat(32));
    ok('a wrong clientCode in the settings with no file is said ("bad-setting")', W.findPcCode(Object.assign({}, base, { _clientCodeGiven: true }), { readFile: () => { throw new Error('no file'); } }).problem === 'bad-setting');
    const home = W.findPcCode(cfgOf({ clientCode: '', _file: '' }), { homedir: () => path.join(tmp, 'home'), readFile: f => { if (f === path.join(tmp, 'home', '.ppp-home-worker', 'pc-code.txt')) return CODE; throw new Error('no'); } });
    ok('settings that are only the environment: ~/.ppp-home-worker/pc-code.txt', home.code === CODE);
  }

  heading('--pair on Windows: clip with the link on stdin, the browser with the link as one argument, a Korean sentence; the code is not printed');
  {
    const sp = fakeSpawn(), cap = sinks(), shown = [];
    const code = await W.pairThisPc(cfgOf(), { spawn: sp, platform: 'win32', stdout: cap.stdout, stderr: cap.stderr, out: l => shown.push(l) });
    ok('exit 0', code === 0, cap.all());
    ok('first clip, with no arguments, and the PHONE link - exactly it, no newline, NO "&local=1" - on its standard input', sp.calls[0].cmd === 'clip' && sp.calls[0].args.length === 0 && sp.calls[0].stdin === LINK && !/local/.test(sp.calls[0].stdin) && sp.calls[0].opts.stdio[0] === 'pipe');
    ok('then rundll32 url.dll,FileProtocolHandler <link>: two arguments, the second is THIS PC\'s link: the same with "&local=1" at the end, whole', sp.calls[1].cmd === 'rundll32' && JSON.stringify(sp.calls[1].args) === JSON.stringify(['url.dll,FileProtocolHandler', LINK_PC]) && sp.calls[1].stdin === null);
    ok('two different links: the one for the phone is a prefix of the one for the PC and only the PC\'s says it is local; "local" is nowhere else in what was started', LINK_PC.startsWith(LINK) && LINK_PC !== LINK && LINK_PC.slice(LINK.length) === '&local=1' && JSON.stringify(sp.calls.map(c => [c.cmd, c.args, c.stdin])).split('local').length === 2);
    ok('both started with an argument vector and shell: false (no shell, so nothing in the link is interpreted); windowsHide', sp.calls.length === 2 && sp.calls.every(c => c.opts.shell === false && c.opts.windowsHide === true && Array.isArray(c.args)));
    ok('the code is in exactly two places: clip\'s stdin and the opener\'s last argument', sp.calls.filter(c => JSON.stringify(c.args).includes(CODE) || (c.stdin || '').includes(CODE) || c.cmd.includes(CODE)).length === 2 && !sp.calls.some(c => c.cmd.includes(CODE)));
    ok('the Korean sentence, then the English one: opened in the browser, phone link copied, the link\'s NAME to compare; it does NOT say the PC is connected (the page may still be asking)', cap.out.length === 2 && /^\[[\d:]+\] 브라우저에서 링크를 열었고, 휴대폰용 링크를 복사했어요\./.test(cap.out[0]) && cap.out[0].includes('PC 링크 이름이 …' + TAG + ' 인지 확인하세요') && /^\[[\d:]+\] Opened the link in your browser and copied the phone link\./.test(cap.out[1]) && cap.out[1].includes('PC link name on the screen is …' + TAG) && !/연결됐어요/.test(cap.all()) && !/is connected/i.test(cap.all()), cap.out.join(' | '));
    ok('NOTHING of the code, on either stream, and no "#pc=" link; nothing was shown (the link\'s name is not the code)', !cap.all().includes(CODE) && !/#pc=[0-9a-f]/.test(cap.all()) && !/\bpc=/.test(cap.all()) && !/local=1/.test(cap.all()) && cap.err.length === 0 && shown.length === 0, cap.all());
  }
  {
    const sp = fakeSpawn(), cap = sinks(), shown = [];
    const code = await W.pairThisPc(cfgOf(), { spawn: sp, platform: 'win32', show: true, stdout: cap.stdout, stderr: cap.stderr, out: l => shown.push(l) });
    ok('with --show the PHONE link is printed once, on the console (without "&local=1"), and still not by the log', code === 0 && shown.length === 1 && shown[0] === LINK && !/local/.test(shown[0]) && !cap.all().includes(CODE), shown.join('|'));
  }

  heading('the log hides the code, and a pairing link made of it, wherever it shows up');
  {
    const cap = sinks();
    const log = W.makeLog({ token: TOKEN, clientCode: CODE }, cap.stdout, cap.stderr);
    log('the link is ' + LINK + ' and the code ' + CODE + '.'); log.warn('again ' + CODE.toUpperCase().toLowerCase() + ' / ' + SITE + '/#pc=' + CODE);
    log('a link nobody told the log about: ' + SITE + '/#pc=' + 'ab'.repeat(32));
    log('this PC\'s link: ' + LINK_PC + ' and one nobody told it about: ' + SITE + '/#pc=' + 'cd'.repeat(32) + '&local=1');
    ok('the code and every "#pc=<64 hex>" are replaced (also with &local=1 after it)', !cap.all().includes(CODE) && !cap.all().includes('ab'.repeat(32)) && !cap.all().includes('cd'.repeat(32)) && /#pc=\*\*\*/.test(cap.all()) && cap.all().includes('***'), cap.all());
    const split = sinks();
    W.makeLog({ clientCode: CODE }, split.stdout, split.stderr)('x ' + CODE.slice(0, 20) + '​' + CODE.slice(20) + ' y');
    ok('a code cut by a zero-width character is joined and hidden too', !split.all().includes(CODE) && !split.all().includes(CODE.slice(0, 20)), split.all());
  }

  heading('every failure says what to do, in Korean and English, and spawns nothing it should not');
  {
    const run = async (cfg, deps) => { const sp = fakeSpawn(deps && deps.plan); const cap = sinks(); const code = await W.pairThisPc(cfg, Object.assign({ spawn: sp, platform: 'win32', stdout: cap.stdout, stderr: cap.stderr, out: () => {}, readFile: () => { throw new Error('no file'); } }, deps && deps.deps)); return { code: code, sp: sp, cap: cap }; };
    const noCode = await run(cfgOf({ clientCode: '', _file: path.join(tmp, 'x', 'worker.config.json') }));
    ok('no code anywhere: exit 1, says where to put it (pc-code.txt next to the settings) and how to get it (Connect another device: copy link); nothing spawned', noCode.code === 1 && noCode.sp.calls.length === 0 && /pc-code\.txt/.test(noCode.cap.all()) && /다른 기기 연결: 링크 복사/.test(noCode.cap.all()) && /Connect another device: copy link/.test(noCode.cap.all()), noCode.cap.all());
    const badFile = await run(cfgOf({ clientCode: '', _file: path.join(tmp, 'x', 'worker.config.json') }), { deps: { readFile: () => 'hunter2 is my password' } });
    ok('a pc-code.txt that holds something else: exit 1, the file is named, its content is NOT repeated', badFile.code === 1 && badFile.sp.calls.length === 0 && /pc-code\.txt/.test(badFile.cap.all()) && !/hunter2/.test(badFile.cap.all()));
    const badSet = await run(cfgOf({ clientCode: '', _clientCodeGiven: true }));
    ok('a clientCode in the settings that is not a code: exit 1, said', badSet.code === 1 && /clientCode/.test(badSet.cap.all()) && badSet.sp.calls.length === 0);
    for (const [label, site] of [['empty', ''], ['not an address', 'ppp'], ['ftp', 'ftp://x.com'], ['plain http to another host', 'http://ppp.example.com']]) {
      const r = await run(cfgOf({ siteUrl: site }));
      ok('the site address is ' + label + ': exit 1, nothing spawned', r.code === 1 && r.sp.calls.length === 0 && /siteUrl/.test(r.cap.all()), r.cap.all());
    }
    for (const site of ['https://x.com/&calc', 'https://x.com/a b', 'https://x.com/"; calc "', 'https://x.com/%0d%0a', 'https://x.com/a|b', 'https://user:pw@x.com', 'https://x.com/$(calc)', 'https://x.com/^', 'https://x.com/`x`']) {
      const r = await run(cfgOf({ siteUrl: site }));
      ok('a site address with characters a shell would act on (' + JSON.stringify(site) + '): exit 1, no program is started, the code is not shown', r.code === 1 && r.sp.calls.length === 0 && !r.cap.all().includes(CODE), r.cap.all());
    }
    ok('a localhost address over plain http is fine (a test on one\'s own machine); a path on the site is kept', await (async () => { const r = await run(cfgOf({ siteUrl: 'http://127.0.0.1:8777' })); const r2 = await run(cfgOf({ siteUrl: SITE + '/ppp/' })); return r.code === 0 && r.sp.calls[0].stdin === 'http://127.0.0.1:8777/#pc=' + CODE && r2.code === 0 && r2.sp.calls[0].stdin === SITE + '/ppp/#pc=' + CODE; })());
    const noClip = await run(cfgOf(), { plan: c => (c.cmd === 'clip' ? { error: 'ENOENT' } : {}) });
    ok('clip cannot be started: exit 1, "could not be copied", run with --show; the code is not printed', noClip.code === 1 && /링크를 복사하지 못했어요/.test(noClip.cap.all()) && /--show/.test(noClip.cap.all()) && !noClip.cap.all().includes(CODE));
    const clipFails = await run(cfgOf(), { plan: c => (c.cmd === 'clip' ? { exit: 1 } : {}) });
    ok('clip answers with an error: the same', clipFails.code === 1 && /링크를 복사하지 못했어요/.test(clipFails.cap.all()));
    const throws = await run(cfgOf(), { plan: c => (c.cmd === 'clip' ? { throws: true } : {}) });
    ok('spawn itself throws: the same, no crash', throws.code === 1 && /링크를 복사하지 못했어요/.test(throws.cap.all()));
    const noBrowser = await run(cfgOf(), { plan: c => (c.cmd === 'rundll32' ? { exit: 1 } : {}) });
    ok('the browser cannot be opened but the link is copied: exit 0, says the link is copied and this PC\'s browser was not opened', noBrowser.code === 0 && /휴대폰용 링크를 복사했어요/.test(noBrowser.cap.out.join('\n')) && /브라우저는 열지 못했어요/.test(noBrowser.cap.err.join('\n')) && !noBrowser.cap.all().includes(CODE));
    const other = await run(cfgOf(), { deps: { platform: 'plan9' } });
    ok('a system with no known tools: exit 1, says so, nothing spawned', other.code === 1 && other.sp.calls.length === 0 && /--show/.test(other.cap.all()));
    const mac = await run(cfgOf(), { deps: { platform: 'darwin' } }), lin = await run(cfgOf(), { deps: { platform: 'linux' } });
    ok('macOS and Linux have their tools too (pbcopy/open, xclip/xdg-open), the same way (the phone link copied, the PC\'s own link opened)', mac.sp.calls[0].cmd === 'pbcopy' && mac.sp.calls[0].stdin === LINK && mac.sp.calls[1].cmd === 'open' && mac.sp.calls[1].args[mac.sp.calls[1].args.length - 1] === LINK_PC && lin.sp.calls[0].cmd === 'xclip' && JSON.stringify(lin.sp.calls[0].args) === JSON.stringify(['-selection', 'clipboard']) && lin.sp.calls[1].cmd === 'xdg-open' && lin.sp.calls[1].args[0] === LINK_PC);
  }

  heading('nothing is sent to the site: --pair never makes a request');
  {
    let hits = 0;
    const srv = http.createServer((rq, rs) => { hits++; rs.writeHead(200); rs.end('{}'); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const site = 'http://127.0.0.1:' + srv.address().port;
    const sp = fakeSpawn(), cap = sinks();
    const code = await W.pairThisPc(cfgOf({ siteUrl: site }), { spawn: sp, platform: 'win32', stdout: cap.stdout, stderr: cap.stderr, out: () => {} });
    await new Promise(r => setTimeout(r, 300));
    ok('the link is built for that site, copied and opened; the site saw no request at all', code === 0 && hits === 0 && sp.calls[0].stdin === site + '/#pc=' + CODE, 'hits ' + hits);
    srv.close();
  }

  heading('the real processes: what clip and the browser would receive is exactly the link');
  {
    const dir = path.join(tmp, 'real'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'copy.js'), "let b=[];process.stdin.on('data',d=>b.push(d));process.stdin.on('end',()=>{require('fs').writeFileSync(" + JSON.stringify(path.join(dir, 'copy.out')) + ",Buffer.concat(b));require('fs').writeFileSync(" + JSON.stringify(path.join(dir, 'copy.argv')) + ",JSON.stringify(process.argv.slice(2)));});");
    fs.writeFileSync(path.join(dir, 'open.js'), 'require("fs").writeFileSync(' + JSON.stringify(path.join(dir, 'open.argv')) + ',JSON.stringify(process.argv.slice(2)));');
    const cap = sinks();
    const code = await W.pairThisPc(cfgOf(), { spawn: spawn, tools: { copy: [process.execPath, [path.join(dir, 'copy.js')]], open: [process.execPath, [path.join(dir, 'open.js'), 'url.dll,FileProtocolHandler']] }, stdout: cap.stdout, stderr: cap.stderr, out: () => {} });
    ok('real children: exit 0', code === 0, cap.all());
    ok('the "clipboard" got the link byte for byte on its standard input, and no argument', fs.readFileSync(path.join(dir, 'copy.out'), 'utf8') === LINK && fs.readFileSync(path.join(dir, 'copy.argv'), 'utf8') === '[]');
    ok('the "browser" got THIS PC\'s link (with &local=1) as ONE argument, whole, after the handler name', JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, 'open.argv'), 'utf8'))) === JSON.stringify(['url.dll,FileProtocolHandler', LINK_PC]));
  }

  heading('through the command line: --pair, --show, --config');
  {
    const dir = path.join(tmp, 'cli'); fs.mkdirSync(dir, { recursive: true });
    const cfgFile = path.join(dir, 'worker.config.json');
    fs.writeFileSync(cfgFile, JSON.stringify({ siteUrl: SITE, token: TOKEN }));
    fs.writeFileSync(path.join(dir, 'pc-code.txt'), LINK);
    const origOut = process.stdout.write.bind(process.stdout);
    const run = async args => {
      const sp = fakeSpawn(), seen = [], cap = sinks();
      process.stdout.write = c => { seen.push(String(c)); return true; };
      let code;
      try { code = await W.main(['node', 'worker.js'].concat(args), { pair: { spawn: sp, platform: 'win32', stdout: cap.stdout, stderr: cap.stderr } }); } finally { process.stdout.write = origOut; }
      return { code: code, sp: sp, seen: seen.join(''), cap: cap };
    };
    const a = await run(['--pair', '--config', cfgFile]);
    ok('--pair with the code in pc-code.txt next to the settings: it works, the link goes to clip, and the console has no code', a.code === 0 && a.sp.calls[0].stdin === LINK && !a.seen.includes(CODE) && !a.cap.all().includes(CODE), a.cap.all());
    const b = await run(['--pair', '--show', '--config', cfgFile]);
    ok('--pair --show: the console gets the link (and only the link), the log lines still have no code', b.code === 0 && b.seen.trim() === LINK && !b.cap.all().includes(CODE));
    const c = await run(['--pair', '--config', path.join(dir, 'missing.json')]);
    ok('a settings file that does not exist: exit 1, said, nothing spawned', c.code === 1 && c.sp.calls.length === 0);
  }

  heading('the files around it');
  {
    const src = fs.readFileSync(path.join(L.MODS, 'tools/home-worker/worker.js'), 'utf8');
    const pairSrc = src.slice(src.indexOf('--pair: connect the person'), src.indexOf('G10b-4: one run at a time'));
    ok('the pair code never uses a shell: no exec, execSync, spawnSync, shell: true, and no template or "+" building of a command line', pairSrc.length > 2000 && !/\bexec(Sync|File|FileSync)?\s*\(/.test(pairSrc) && !/spawnSync/.test(pairSrc) && !/shell:\s*true/.test(pairSrc) && /shell:\s*false/.test(pairSrc) && !/cmd\.exe|powershell|\/c\b/i.test(pairSrc.replace(/\/\*[\s\S]*?\*\//g, '')), 'len ' + pairSrc.length);
    ok('it never talks to the site (no request, http or https call in the pair code)', !/\brequest\(|https?\.request|fetch\(/.test(pairSrc));
    ok('"&local=1" is in the pair code for the browser\'s link only: the clipboard gets the other', /const pcLink = link \+ '&local=1'/.test(pairSrc) && /runPiped\(spawnFn, tools\.copy\[0\], tools\.copy\[1\], link\)/.test(pairSrc) && /tools\.open\[1\]\.concat\(\[pcLink\]\)/.test(pairSrc));
    const cmd = fs.readFileSync(path.join(L.REPO, 'tools/home-worker/pair.cmd'), 'utf8');
    ok('pair.cmd: UTF-8 console (the Korean line), the repo root, node worker.js --pair, a pause; plain ASCII (git keeps LF, a Windows checkout makes CRLF); it does not echo anything of the code', /chcp 65001/.test(cmd) && /node tools\\home-worker\\worker\.js --pair\r?\n/.test(cmd) && /pause/.test(cmd) && /^[\x00-\x7f]*$/.test(cmd) && !/%[A-Za-z~]*code/i.test(cmd) && !/--show/.test(cmd.replace(/^rem.*$/gm, '')));
    ok('pc-code.txt is never committed (.gitignore)', /^\/tools\/home-worker\/pc-code\.txt$/m.test(fs.readFileSync(path.join(L.REPO, '.gitignore'), 'utf8')));
  }
})().then(() => { L.rmDir(tmp); L.finish('the pairing shortcut of the home-PC worker'); }, e => { console.error(e); L.rmDir(tmp); process.exit(1); });
