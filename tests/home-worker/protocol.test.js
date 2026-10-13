/* ============================================================================
   G10b-4: starting the PC worker at once from the PC's own browser - the worker side (tools/home-worker/worker.js, run-hidden.vbs, run-once-hidden.cmd, register-protocol.cmd).

   The page launches  pppworker://run  (no data in it). Windows hands that to a per-user protocol handler that runs the worker once, hidden. Nothing here touches the real registry, the real
   scheduled tasks or the real desktop: reg.exe is a stub that keeps its own tiny registry in memory, and the real processes are Node scripts and a local HTTP server.

     - --register-protocol: HKCU only (never HKLM), reg.exe with an argument VECTOR and shell: false, three values, the command is  wscript.exe //B //Nologo "<this folder>\run-hidden.vbs"
       with no %1; the path is refused when it holds a quote, a percent sign, a control character or a line break, is not absolute, is not run-hidden.vbs or does not exist (nothing is
       written then); idempotent; --protocol-status tells registered / not / elsewhere / not ours; --unregister-protocol removes exactly the key it made (and refuses a key it did not)
     - the files: run-hidden.vbs ignores every argument (hidden window, no waiting); run-once-hidden.cmd runs  --once --log-file ; nothing passes %1 or %* anywhere
     - the RUN LOCK of --once: a second run while a live one (alive pid, younger than 45 minutes) stops at once with one line and exit 0; a stale lock (dead pid, 45 minutes or older, unreadable
       and not brand new, from the future) is taken over; the lock goes when the run ends - normally, by a rejected token, by process 'exit' - and only if it is still ours
     - --log-file: the lines of a run go to a file (the token is hidden as ever), by default worker.log next to the settings file, and the file stays small

   node tests/home-worker/protocol.test.js */
'use strict';
const L = require('./lib');
const { ok, heading } = L;
const W = L.mod('tools/home-worker/worker.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');

const TOKEN = 'ppw_' + 'A'.repeat(12) + '_' + 'b'.repeat(43);
const ROOT = 'HKCU\\Software\\Classes\\pppworker';
const CMDKEY = ROOT + '\\shell\\open\\command';
const VBS = 'C:\\Users\\kim\\PPP\\tools\\home-worker\\run-hidden.vbs';
const tmp = L.tmpDir('ppp-proto-');
const sinks = () => { const s = { out: [], err: [] }; s.stdout = l => s.out.push(l); s.stderr = l => s.err.push(l); s.all = () => s.out.concat(s.err).join('\n'); return s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* a reg.exe that keeps a registry in memory: add / query / delete, in the output format of the real one */
function fakeReg(plan) {
  const reg = new Map(), calls = [];
  const spawnFn = (cmd, args, opts) => {
    calls.push({ cmd: cmd, args: args.slice(), opts: opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    setImmediate(() => {
      let code = 0, out = '';
      const verb = args[0], key = String(args[1] || ''), k = key.toLowerCase();
      const nameOf = () => (args.includes('/ve') ? '' : args[args.indexOf('/v') + 1]);
      if (plan && plan(args, calls.length)) code = 1;
      else if (verb === 'add') { if (!reg.has(k)) reg.set(k, new Map()); reg.get(k).set(nameOf(), args[args.indexOf('/d') + 1]); }
      else if (verb === 'query') {
        if (!reg.has(k) || !reg.get(k).has(nameOf())) code = 1;
        else out = '\r\nHKEY_CURRENT_USER\\' + key.replace(/^HKCU\\/i, '') + '\r\n    ' + (nameOf() === '' ? '(Default)' : nameOf()) + '    REG_SZ    ' + reg.get(k).get(nameOf()) + '\r\n\r\n';
      } else if (verb === 'delete') { for (const kk of Array.from(reg.keys())) if (kk === k || kk.startsWith(k + '\\')) reg.delete(kk); }
      if (out) child.stdout.emit('data', Buffer.from(out));
      child.emit('close', code);
    });
    return child;
  };
  return { spawn: spawnFn, reg: reg, calls: calls, snapshot: () => JSON.stringify(Array.from(reg.entries()).map(([k, v]) => [k, Array.from(v.entries())]).sort()) };
}
const base = (r, over) => Object.assign({ spawn: r.spawn, platform: 'win32', vbsPath: VBS, exists: () => true, regExe: 'C:\\Windows\\System32\\reg.exe' }, over || {});

(async () => {
  heading('--register-protocol: three values under HKCU\\Software\\Classes\\pppworker, reg.exe with an argument vector, no shell, no %1');
  {
    const r = fakeReg(), cap = sinks();
    const code = await W.registerProtocol(base(r, { stdout: cap.stdout, stderr: cap.stderr }));
    ok('exit 0', code === 0, cap.all());
    ok('three reg.exe calls (the key\'s own value, "URL Protocol", the command), each an ARRAY of arguments started with shell: false and a hidden window', r.calls.length === 3 && r.calls.every(c => c.cmd === 'C:\\Windows\\System32\\reg.exe' && Array.isArray(c.args) && c.opts.shell === false && c.opts.windowsHide === true && c.args[0] === 'add' && c.args.includes('/f')));
    ok('only HKCU (the current user\'s part of the registry) and only the pppworker key and the command below it - never HKLM, never HKCR, never any other key', r.calls.every(c => c.args[1] === ROOT || c.args[1] === CMDKEY) && !r.calls.some(c => /HKLM|HKEY_LOCAL_MACHINE|HKCR|HKEY_CLASSES_ROOT/i.test(JSON.stringify(c.args))));
    ok('the key: (Default) "URL:PPP worker" and "URL Protocol" = "" (a protocol, not a file type)', r.reg.get(ROOT.toLowerCase()).get('') === 'URL:PPP worker' && r.reg.get(ROOT.toLowerCase()).get('URL Protocol') === '' && r.calls[1].args.includes('URL Protocol') && r.calls[1].args[r.calls[1].args.indexOf('/d') + 1] === '');
    const cmd = r.reg.get(CMDKEY.toLowerCase()).get('');
    ok('the command value is exactly  wscript.exe //B //Nologo "<run-hidden.vbs>"  - ONE argument, the quotes inside it', cmd === 'wscript.exe //B //Nologo "' + VBS + '"' && r.calls[2].args.filter(a => a === cmd).length === 1);
    ok('the command has no %1, %L, %* or %0 (nothing of the address is passed on) and no shell word (cmd, /c, powershell)', !/%/.test(cmd) && !/\b(cmd|powershell)\b|\s\/c\s/i.test(cmd));
    ok('three keys exist and nothing else', r.reg.size === 2 && r.reg.has(ROOT.toLowerCase()) && r.reg.has(CMDKEY.toLowerCase()));
    ok('Korean first, then English; it says what was written, what runs, that the address is ignored, and how to undo it', /^\[[\d:]+\] 등록했어요/.test(cap.out[0]) && /^\[[\d:]+\] Registered\./.test(cap.out[1]) && /HKCU\\Software\\Classes\\pppworker/.test(cap.out[2]) && /주소 뒤의 내용은 받지 않아요/.test(cap.out[2]) && /anything after pppworker:\/\/ is ignored/.test(cap.out[3]) && /unregister-protocol\.cmd/.test(cap.out[4]) && /--unregister-protocol/.test(cap.out[5]), cap.out.join(' | ').slice(0, 300));
    const again = await W.registerProtocol(base(r, { stdout: () => {}, stderr: () => {} }));
    ok('idempotent: a second run succeeds and leaves the registry exactly as it was (same keys, same values)', again === 0 && r.calls.length === 6 && r.reg.size === 2 && r.reg.get(CMDKEY.toLowerCase()).get('') === cmd);
    const fromOther = fakeReg();
    await W.registerProtocol(base(fromOther, { vbsPath: 'D:\\Other Place\\김철수\\PPP\\tools\\home-worker\\run-hidden.vbs', stdout: () => {}, stderr: () => {} }));
    ok('a path with spaces and Korean letters is fine: still ONE argument, the quotes around the path are inside it', fromOther.calls[2].args[fromOther.calls[2].args.indexOf('/d') + 1] === 'wscript.exe //B //Nologo "D:\\Other Place\\김철수\\PPP\\tools\\home-worker\\run-hidden.vbs"');
  }

  heading('the path of run-hidden.vbs is checked before anything is written');
  {
    const bad = [
      ['a quote', 'C:\\a"b\\tools\\home-worker\\run-hidden.vbs'], ['a percent sign (%1 would be replaced by Windows)', 'C:\\a%1\\tools\\home-worker\\run-hidden.vbs'], ['%USERPROFILE%', '%USERPROFILE%\\run-hidden.vbs'],
      ['a line break', 'C:\\a\nb\\run-hidden.vbs'], ['a carriage return', 'C:\\a\rb\\run-hidden.vbs'], ['a tab / control character', 'C:\\a\tb\\run-hidden.vbs'], ['a NUL', 'C:\\a\u0000b\\run-hidden.vbs'],
      ['a line separator', 'C:\\a\u2028b\\run-hidden.vbs'], ['a relative path', 'tools\\home-worker\\run-hidden.vbs'], ['a dot-relative path', '.\\run-hidden.vbs'], ['another file name', 'C:\\x\\tools\\home-worker\\evil.vbs'],
      ['a file that merely ends in the name', 'C:\\x\\notrun-hidden.vbs'], ['empty', ''], ['not a string', 42]
    ];
    for (const [label, p] of bad) {
      const r = fakeReg(), cap = sinks();
      const code = await W.registerProtocol(base(r, { vbsPath: p, stdout: cap.stdout, stderr: cap.stderr }));
      ok(label + ': refused (exit 1), reg.exe was never started, nothing was written, and it says why in Korean and English', code === 1 && r.calls.length === 0 && r.reg.size === 0 && /등록하지 않았어요/.test(cap.err[0] || '') && /Not registered/.test(cap.err[1] || ''), cap.all().slice(0, 200));
    }
    const r = fakeReg(), cap = sinks();
    const code = await W.registerProtocol(base(r, { exists: () => false, stdout: cap.stdout, stderr: cap.stderr }));
    ok('a run-hidden.vbs that is not there: refused, nothing written', code === 1 && r.calls.length === 0 && /not there/.test(cap.all()));
    const r2 = fakeReg();
    const code2 = await W.registerProtocol(base(r2, { exists: f => /run-hidden\.vbs$/.test(f), stdout: () => {}, stderr: () => {} }));
    ok('and so is a run-once-hidden.cmd that is not next to it', code2 === 1 && r2.calls.length === 0);
    ok('the same words are the unit of the check: vbsProblem returns a sentence for each bad path and "" for a good one', W.vbsProblem(VBS, () => true) === '' && W.vbsProblem('C:\\a"b\\run-hidden.vbs', () => true) !== '' && W.vbsProblem('\\\\server\\share\\PPP\\run-hidden.vbs', () => true) === '' && W.vbsProblem('C:/Users/kim/PPP/run-hidden.vbs', () => true) === '');
  }

  heading('reg.exe fails, or this is not Windows');
  {
    const r = fakeReg(null), r2 = fakeReg((args, n) => n === 2), cap = sinks();
    const code = await W.registerProtocol(base(r2, { stdout: cap.stdout, stderr: cap.stderr }));
    ok('reg.exe fails on the second value: exit 1, it stops there (no third call), says it can be run again or undone', code === 1 && r2.calls.length === 2 && /다시 실행하거나 등록 해제/.test(cap.err.join(' ')) && /run it again, or run the unregister command/.test(cap.err.join(' ')), cap.all().slice(0, 300));
    const cap2 = sinks();
    const never = await W.registerProtocol(base(r, { spawn: () => { throw Object.assign(new Error('spawn reg.exe ENOENT'), { code: 'ENOENT' }); }, stdout: cap2.stdout, stderr: cap2.stderr }));
    ok('reg.exe cannot be started at all: exit 1, said, no crash', never === 1 && /ENOENT/.test(cap2.all()));
    for (const fn of ['registerProtocol', 'unregisterProtocol', 'protocolStatus']) {
      const rr = fakeReg(), c = sinks();
      const code3 = await W[fn](base(rr, { platform: 'linux', stdout: c.stdout, stderr: c.stderr }));
      ok(fn + ' on Linux/macOS: exit 1, "Windows only", reg.exe is not started', code3 === 1 && rr.calls.length === 0 && /Windows/.test(c.all()));
    }
  }

  heading('--protocol-status, and --unregister-protocol removes exactly what it made');
  {
    const r = fakeReg(), q = () => ({ stdout: () => {}, stderr: () => {} });
    const c0 = sinks();
    ok('nothing registered: status says so (exit 1) and points to register-protocol.cmd', (await W.protocolStatus(base(r, { stdout: c0.stdout, stderr: c0.stderr }))) === 1 && /register-protocol\.cmd/.test(c0.all()));
    const c1 = sinks();
    ok('unregister with nothing registered: exit 0, nothing to do, no delete', (await W.unregisterProtocol(base(r, { stdout: c1.stdout, stderr: c1.stderr }))) === 0 && !r.calls.some(c => c.args[0] === 'delete') && /Nothing is registered/.test(c1.all()));
    await W.registerProtocol(base(r, q()));
    const c2 = sinks();
    ok('after registering: status says registered and pointing to this folder (exit 0)', (await W.protocolStatus(base(r, { stdout: c2.stdout, stderr: c2.stderr }))) === 0 && /points to this folder/.test(c2.all()), c2.all());
    const c3 = sinks();
    ok('status from another folder: "points to another folder" (exit 1), with what it points to', (await W.protocolStatus(base(r, { vbsPath: 'C:\\Elsewhere\\home-worker\\run-hidden.vbs', stdout: c3.stdout, stderr: c3.stderr }))) === 1 && /another folder/.test(c3.all()) && /Users\\kim\\PPP/.test(c3.all()));
    const c3b = sinks();
    ok('status when run-hidden.vbs has been deleted: said', (await W.protocolStatus(base(r, { exists: () => false, stdout: c3b.stdout, stderr: c3b.stderr }))) === 1 && /run-hidden\.vbs is missing/.test(c3b.all()));
    const before = r.calls.length;
    const c4 = sinks();
    const un = await W.unregisterProtocol(base(r, { stdout: c4.stdout, stderr: c4.stderr }));
    const del = r.calls.slice(before).filter(c => c.args[0] === 'delete');
    ok('unregister: ONE delete, of exactly HKCU\\Software\\Classes\\pppworker, /f, an argument vector, shell: false; the registry is empty afterwards; exit 0', un === 0 && del.length === 1 && JSON.stringify(del[0].args) === JSON.stringify(['delete', ROOT, '/f']) && del[0].opts.shell === false && r.reg.size === 0, c4.all());
    ok('it says what was removed (that key and what is under it, nothing else) and that jobs wait for the next check, Korean first', /^\[[\d:]+\] 등록을 지웠어요/.test(c4.out[0]) && /nothing else/.test(c4.out[1]));
    const foreign = fakeReg();
    foreign.reg.set(ROOT.toLowerCase(), new Map([['', 'URL:Somebody else'], ['URL Protocol', '']]));
    foreign.reg.set(CMDKEY.toLowerCase(), new Map([['', '"C:\\Other\\app.exe" "%1"']]));
    const c5 = sinks();
    const un2 = await W.unregisterProtocol(base(foreign, { stdout: c5.stdout, stderr: c5.stderr }));
    ok('a pppworker key that someone else made (another title, another command): NOT removed (exit 1, no delete call, the registry is as it was)', un2 === 1 && !foreign.calls.some(c => c.args[0] === 'delete') && foreign.reg.size === 2 && /does not look like the one this tool makes/.test(c5.all()));
    const cs = sinks();
    ok('status says the same for it', (await W.protocolStatus(base(foreign, { stdout: cs.stdout, stderr: cs.stderr }))) === 1 && /does not look like/.test(cs.all()));
    const failDel = fakeReg((args) => args[0] === 'delete');
    await W.registerProtocol(base(failDel, q()));
    const c6 = sinks();
    ok('reg.exe fails on the delete: exit 1, said', (await W.unregisterProtocol(base(failDel, { stdout: c6.stdout, stderr: c6.stderr }))) === 1 && /Could not remove/.test(c6.all()));
    /* reg.exe prints paths in the console's code page: a Korean user name comes back as other bytes, and the status must still see "the same folder" */
    const kr = fakeReg(), krVbs = 'C:\\Users\\김철수\\PPP\\tools\\home-worker\\run-hidden.vbs';
    await W.registerProtocol(base(kr, { vbsPath: krVbs, stdout: () => {}, stderr: () => {} }));
    kr.reg.get(CMDKEY.toLowerCase()).set('', 'wscript.exe //B //Nologo "C:\\Users\\\ufffd\ufffd\ufffd\\PPP\\tools\\home-worker\\run-hidden.vbs"');
    const ck = sinks();
    ok('the same folder is recognised when reg.exe prints the Korean name in another code page', (await W.protocolStatus(base(kr, { vbsPath: krVbs, stdout: ck.stdout, stderr: ck.stderr }))) === 0, ck.all());
  }

  heading('through main(): the three flags need no settings file and reach the same code');
  {
    const r = fakeReg(), seen = [];
    const origOut = process.stdout.write.bind(process.stdout);
    process.stdout.write = c => { seen.push(String(c)); return true; };
    let a, b, c;
    try {
      a = await W.main(['node', 'worker.js', '--register-protocol'], { protocol: base(r) });
      b = await W.main(['node', 'worker.js', '--protocol-status'], { protocol: base(r) });
      c = await W.main(['node', 'worker.js', '--unregister-protocol'], { protocol: base(r) });
    } finally { process.stdout.write = origOut; }
    ok('register, status, unregister through the command line: 0, 0, 0 and the registry ends empty; no settings file was needed', a === 0 && b === 0 && c === 0 && r.reg.size === 0, [a, b, c].join(','));
    ok('--help lists them', await (async () => { const out = []; const o2 = console.log; console.log = s => out.push(s); try { await W.main(['node', 'worker.js', '--help']); } finally { console.log = o2; } const t = out.join('\n'); return /--register-protocol/.test(t) && /--unregister-protocol/.test(t) && /--protocol-status/.test(t) && /--log-file/.test(t); })());
  }

  heading('the files: nothing passes the address on, the window is hidden, the worker is run once');
  {
    const dir = path.join(L.REPO, 'tools/home-worker');
    const vbs = fs.readFileSync(path.join(dir, 'run-hidden.vbs'), 'utf8');
    const code = vbs.split(/\r?\n/).filter(l => !/^\s*'/.test(l)).join('\n');
    ok('run-hidden.vbs: starts run-once-hidden.cmd from its own folder, window style 0 (hidden), not waiting (False)', /WScript\.ScriptFullName/.test(code) && /GetParentFolderName/.test(code) && /run-once-hidden\.cmd/.test(code) && /\.Run\s+""""\s*&\s*here\s*&\s*"\\run-once-hidden\.cmd""",\s*0,\s*False\s*$/m.test(code), code);
    ok('run-hidden.vbs never looks at an argument: no WScript.Arguments, no Command line, nothing named args/argv in its code (only in the comments that say so)', !/Arguments|CommandLine|\bargs?\b|\bargv\b|%1|%\*/i.test(code) && /ignores every argument/.test(vbs));
    ok('run-hidden.vbs has one Run call and no other process or shell (no cmd /c, no powershell, no Exec, no CreateObject beyond the file system and the shell object)', (code.match(/\.Run\b/g) || []).length === 1 && !/powershell|cmd\s*\/c|\.Exec\b|ShellExecute/i.test(code) && (code.match(/CreateObject\("([^"]+)"\)/g) || []).sort().join() === 'CreateObject("Scripting.FileSystemObject"),CreateObject("WScript.Shell")');
    const once = fs.readFileSync(path.join(dir, 'run-once-hidden.cmd'), 'utf8').replace(/\r\n/g, '\n');
    const onceCode = once.split('\n').filter(l => !/^rem\b/i.test(l)).join('\n');
    ok('run-once-hidden.cmd: the repo root, then  node tools\\home-worker\\worker.js --once --log-file  with its output dropped (the log file has it); no pause, no window', /cd \/d "%~dp0\.\.\\\.\."/.test(onceCode) && /^node tools\\home-worker\\worker\.js --once --log-file >nul 2>nul$/m.test(onceCode) && !/\bpause\b|\bstart\b|\bset \/p\b/i.test(onceCode));
    ok('no %1, %2, %*, %~1... anywhere in the five files (an address would never reach a command line), and they are plain ASCII', ['run-hidden.vbs', 'run-once-hidden.cmd', 'register-protocol.cmd', 'unregister-protocol.cmd', 'run-once.cmd'].every(f => { const t = fs.readFileSync(path.join(dir, f), 'utf8'); return !/%(~?[0-9*]|\*)/.test(t) || /%~dp0/.test(t) && !/%~?[1-9*]/.test(t.replace(/%~dp0/g, '')); }) && ['run-hidden.vbs', 'run-once-hidden.cmd', 'register-protocol.cmd', 'unregister-protocol.cmd'].every(f => /^[\x00-\x7f]*$/.test(fs.readFileSync(path.join(dir, f), 'utf8'))));
    const reg = fs.readFileSync(path.join(dir, 'register-protocol.cmd'), 'utf8'), unreg = fs.readFileSync(path.join(dir, 'unregister-protocol.cmd'), 'utf8');
    ok('register-protocol.cmd / unregister-protocol.cmd: UTF-8 console, the repo root, node worker.js --register-protocol / --unregister-protocol, a pause; they say the registry part (HKEY_CURRENT_USER only) in their comments', /chcp 65001/.test(reg) && /node tools\\home-worker\\worker\.js --register-protocol\r?\n/.test(reg) && /pause/.test(reg) && /HKEY_CURRENT_USER/.test(reg) && /chcp 65001/.test(unreg) && /node tools\\home-worker\\worker\.js --unregister-protocol\r?\n/.test(unreg) && /pause/.test(unreg) && !/HKLM|HKEY_LOCAL_MACHINE/.test(reg + unreg));
    const src = fs.readFileSync(path.join(L.MODS, 'tools/home-worker/worker.js'), 'utf8');
    const protoSrc = src.slice(src.lastIndexOf('/*', src.indexOf('G10b-4: the pppworker:// link')), src.indexOf('async function main(argv'));
    const bare = protoSrc.replace(/\/\*[\s\S]*?\*\//g, '');
    ok('the protocol code: shell: false, no exec/execSync/spawnSync/shell: true, no HKLM / HKEY_LOCAL_MACHINE / HKCR, no %1', protoSrc.length > 3000 && /shell:\s*false/.test(protoSrc) && !/\bexec(Sync|File|FileSync)?\s*\(/.test(bare) && !/spawnSync/.test(bare) && !/shell:\s*true/.test(bare) && !/HKLM|HKEY_LOCAL_MACHINE|HKCR|HKEY_CLASSES_ROOT/.test(bare) && !/%1/.test(bare), 'len ' + protoSrc.length);
    ok('the hive is the current user\'s: the keys are built from HKCU', /const REG_HIVE = 'HKCU';/.test(protoSrc) && /const PROTO_ROOT = REG_HIVE \+ /.test(protoSrc));
    ok('the package.json test script runs this file, and .gitignore does not hide the new files', /protocol\.test\.js/.test(JSON.parse(fs.readFileSync(path.join(L.REPO, 'package.json'), 'utf8')).scripts['test:home-worker']) && !/run-hidden|protocol\.cmd/.test(fs.readFileSync(path.join(L.REPO, '.gitignore'), 'utf8')));
  }

  heading('the RUN LOCK: one --once at a time');
  {
    const dir = path.join(tmp, 'lock1'); fs.mkdirSync(dir, { recursive: true });
    const cfg = { _file: path.join(dir, 'worker.config.json') };
    const lockFile = path.join(dir, 'worker.lock');
    const t0 = 1_800_000_000_000;
    const first = W.acquireRunLock(cfg, { now: () => t0, pid: 4242, pidAlive: () => true });
    ok('the first run gets the lock: the file is next to the settings, holds { pid, startedAt }', first.ok === true && first.file === lockFile && JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === 4242 && JSON.parse(fs.readFileSync(lockFile, 'utf8')).startedAt === t0);
    const second = W.acquireRunLock(cfg, { now: () => t0 + 60_000, pid: 777, pidAlive: p => p === 4242 });
    ok('a second run a minute later, the first still alive: no lock - it is told who holds it (pid, start time) - and the file is untouched', second.ok === false && second.pid === 4242 && second.startedAt === t0 && JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === 4242);
    const edge = W.acquireRunLock(cfg, { now: () => t0 + W.LOCK_STALE_MS - 1000, pid: 777, pidAlive: () => true });
    ok('44 minutes 59 seconds later, still alive: still busy', edge.ok === false);
    const old = W.acquireRunLock(cfg, { now: () => t0 + W.LOCK_STALE_MS, pid: 777, pidAlive: () => true });
    ok('45 minutes later (a machine that slept, a hung run): taken over, even though the pid is "alive" (the pid may belong to something else now)', old.ok === true && JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === 777);
    W.releaseRunLock(old);
    ok('releasing removes the file', !fs.existsSync(lockFile));
    W.acquireRunLock(cfg, { now: () => t0, pid: 4242, pidAlive: () => true });
    const dead = W.acquireRunLock(cfg, { now: () => t0 + 1000, pid: 888, pidAlive: () => false });
    ok('the holder\'s process is gone (a crash, a power cut, a killed window): taken over at once', dead.ok === true && JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === 888);
    /* releasing only what is ours */
    const mine = dead;
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 999, startedAt: t0 + 5000 }));
    W.releaseRunLock(mine);
    ok('a lock that another run took over meanwhile is NOT removed by the old owner', fs.existsSync(lockFile) && JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === 999);
    W.releaseRunLock(mine);
    ok('and releasing twice does no harm', fs.existsSync(lockFile));
    fs.unlinkSync(lockFile);
    /* unreadable and future locks */
    fs.writeFileSync(lockFile, '{not json');
    const past = new Date(Date.now() - 60_000); fs.utimesSync(lockFile, past, past);
    const junk = W.acquireRunLock(cfg, { now: Date.now, pid: 1, pidAlive: () => true });
    ok('a lock file that cannot be read and is a minute old: taken over', junk.ok === true);
    W.releaseRunLock(junk);
    fs.writeFileSync(lockFile, '');
    const fresh = W.acquireRunLock(cfg, { now: Date.now, pid: 1, pidAlive: () => true });
    ok('a lock file that is empty and brand new (its maker is writing it right now): busy, not stolen', fresh.ok === false && fs.existsSync(lockFile));
    fs.unlinkSync(lockFile);
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 5, startedAt: t0 + 3 * 3600_000 }));
    const future = W.acquireRunLock(cfg, { now: () => t0, pid: 1, pidAlive: () => true });
    ok('a lock that says it starts 3 hours from now (the clock was moved): taken over', future.ok === true);
    W.releaseRunLock(future);
    for (const bad of [{ pid: 'x', startedAt: t0 }, { pid: -3, startedAt: t0 }, { pid: 1.5, startedAt: t0 }, { pid: 5 }, [], 'text', null]) {
      fs.writeFileSync(lockFile, JSON.stringify(bad)); const pastD = new Date(Date.now() - 60_000); fs.utimesSync(lockFile, pastD, pastD);
      const r = W.acquireRunLock(cfg, { now: () => t0, pid: 1, pidAlive: () => true });
      ok('a lock with ' + JSON.stringify(bad) + ' in it: taken over, no crash', r.ok === true);
      W.releaseRunLock(r);
    }
    /* the folder: the environment-only settings use ~/.ppp-home-worker */
    const home = path.join(tmp, 'home');
    const envOnly = W.acquireRunLock({ _file: '' }, { homedir: () => home, now: () => t0, pid: 1, pidAlive: () => true });
    ok('settings that are only the environment: the lock is in ~/.ppp-home-worker', envOnly.ok === true && envOnly.file === path.join(home, '.ppp-home-worker', 'worker.lock'));
    W.releaseRunLock(envOnly);
    fs.writeFileSync(path.join(tmp, 'a-file'), 'i am a file, not a folder');
    const blocked = W.acquireRunLock({ _file: path.join(tmp, 'a-file', 'x', 'worker.config.json') }, { now: () => t0, pid: 1 });
    ok('a settings folder where no lock can be made (here: a file in the way): the run goes on without one rather than not at all', blocked.ok === true && blocked.file === '' && !!blocked.skipped);
  }

  heading('the lock in real runs of  worker.js --once  (a local site; real child processes)');
  {
    const dir = path.join(tmp, 'real'); fs.mkdirSync(dir, { recursive: true });
    let claims = 0, mode = 'slow';
    const srv = http.createServer((rq, rs) => {
      const chunks = []; rq.on('data', c => chunks.push(c));
      rq.on('end', () => {
        if (rq.url === '/api/worker/claim') {
          claims++;
          if (mode === '401') { rs.writeHead(401, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify({ error: 'no', code: 'bad-token' })); }
          setTimeout(() => { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify({ job: null, nextPollSeconds: 3600 })); }, mode === 'slow' ? 2500 : 0);
        } else { rs.writeHead(404); rs.end('{}'); }
      });
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const cfgFile = path.join(dir, 'worker.config.json');
    fs.writeFileSync(cfgFile, JSON.stringify({ siteUrl: 'http://127.0.0.1:' + srv.address().port, token: TOKEN, pythonPath: process.execPath, transcribePy: __filename, kongCheckpoint: __filename, scratchDir: path.join(dir, 'scratch') }));
    const lockFile = path.join(dir, 'worker.lock');
    const run = args => new Promise(resolve => {
      const child = spawn(process.execPath, [path.join(L.MODS, 'tools/home-worker/worker.js')].concat(args || ['--once']).concat(['--config', cfgFile]), { windowsHide: true, env: Object.assign({}, process.env, { PPP_WORKER_TOKEN: '', PPP_WORKER_SITE: '' }) });
      let out = '';
      child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
      const done = new Promise(res => child.on('close', code => res({ code: code, out: out })));
      resolve({ child: child, done: done, out: () => out });
    });
    const first = await run();
    for (let i = 0; i < 80 && !fs.existsSync(lockFile); i++) await sleep(50);
    ok('a real --once is running and holds the lock (its own pid in the file)', fs.existsSync(lockFile) && JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === first.child.pid);
    const t1 = Date.now();
    const second = await run();
    const r2 = await second.done;
    ok('a second --once started meanwhile stops at once (well before the first ends), exit 0, ONE line, in Korean and English, naming the first one\'s pid; it asked the site nothing', r2.code === 0 && Date.now() - t1 < 2200 && r2.out.trim().split(/\r?\n/).length === 1 && r2.out.includes('이미 다른 실행이 진행 중이에요') && r2.out.includes('Another run is already going') && r2.out.includes('pid ' + first.child.pid) && claims === 1, r2.out.trim() + ' / claims ' + claims);
    const third = await run(['--once']);
    const r3 = await third.done;
    ok('and a third: the same', r3.code === 0 && /Another run is already going/.test(r3.out) && claims === 1);
    const r1 = await first.done;
    ok('the first run finishes normally ("Nothing is waiting.", exit 0) and its lock is gone', r1.code === 0 && /Nothing is waiting/.test(r1.out) && !fs.existsSync(lockFile), r1.out.slice(-200));
    mode = '401';
    const rejected = await (await run()).done;
    ok('a run whose token the site rejects (exit 2) also releases the lock', rejected.code === 2 && !fs.existsSync(lockFile), rejected.out.slice(-200));
    mode = 'fast';
    const fast = await (await run()).done;
    ok('a run after that gets the lock again and, with nothing waiting, ends and releases it', fast.code === 0 && !fs.existsSync(lockFile));
    /* a run that is killed hard cannot clean up: the next one finds a lock with a dead pid and takes it */
    mode = 'slow';
    const doomed = await run();
    for (let i = 0; i < 80 && !fs.existsSync(lockFile); i++) await sleep(50);
    doomed.child.kill('SIGKILL');          /* a hard kill on every system (the worker handles SIGTERM and would tidy up) */
    await doomed.done;
    ok('a run killed from outside leaves its lock behind (nothing could clean up) ...', fs.existsSync(lockFile) && JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === doomed.child.pid);
    mode = 'fast';
    const after = await (await run()).done;
    ok('... and the next run takes it over (the pid is dead), does its work and leaves none behind', after.code === 0 && /Nothing is waiting/.test(after.out) && !fs.existsSync(lockFile), after.out.slice(-200));
    srv.close();
  }

  heading('the exit hook: the lock goes on process exit too (Ctrl-C, process.exit), and the hook is removed when the run ends');
  {
    const dir = path.join(tmp, 'hook'); fs.mkdirSync(dir, { recursive: true });
    let release = null;
    const srv = http.createServer((rq, rs) => { rq.resume(); rq.on('end', () => { if (rq.url === '/api/worker/claim') release = () => { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify({ job: null, nextPollSeconds: 3600 })); }; else { rs.writeHead(404); rs.end('{}'); } }); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const cfgFile = path.join(dir, 'worker.config.json');
    fs.writeFileSync(cfgFile, JSON.stringify({ siteUrl: 'http://127.0.0.1:' + srv.address().port, token: TOKEN, pythonPath: process.execPath, transcribePy: __filename, kongCheckpoint: __filename, scratchDir: path.join(dir, 'scratch') }));
    const lockFile = path.join(dir, 'worker.lock');
    const exitBefore = process.listeners('exit').slice(), sigint = process.listeners('SIGINT').slice(), sigterm = process.listeners('SIGTERM').slice(), unh = process.listeners('unhandledRejection').slice();
    const cap = sinks();
    const outWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    let p;
    try {
      p = W.main(['node', 'worker.js', '--once', '--config', cfgFile]);
      for (let i = 0; i < 100 && !(fs.existsSync(lockFile) && release); i++) await sleep(50);
      const added = process.listeners('exit').filter(f => exitBefore.indexOf(f) < 0);
      ok('while the run is going: the lock is held and ONE new exit listener is registered', fs.existsSync(lockFile) && added.length === 1);
      added[0]();
      ok('calling that exit listener (what Node does when the process ends) removes the lock', !fs.existsSync(lockFile));
      release(); await p;
      ok('when the run ends the listener is removed again (no pile-up of listeners)', process.listeners('exit').filter(f => exitBefore.indexOf(f) < 0).length === 0 && !fs.existsSync(lockFile));
    } finally { process.stdout.write = outWrite; process.listeners('SIGINT').filter(f => sigint.indexOf(f) < 0).forEach(f => process.removeListener('SIGINT', f)); process.listeners('SIGTERM').filter(f => sigterm.indexOf(f) < 0).forEach(f => process.removeListener('SIGTERM', f)); process.listeners('unhandledRejection').filter(f => unh.indexOf(f) < 0).forEach(f => process.removeListener('unhandledRejection', f)); }
    srv.close();
  }

  heading('--log-file: the lines of a run also go to a file (the token hidden), by default worker.log next to the settings; the file stays small');
  {
    const dir = path.join(tmp, 'logs'); fs.mkdirSync(dir, { recursive: true });
    const srv = http.createServer((rq, rs) => { rq.resume(); rq.on('end', () => { if (rq.url === '/api/worker/claim') { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify({ job: null, nextPollSeconds: 3600 })); } else { rs.writeHead(404); rs.end('{}'); } }); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const cfgFile = path.join(dir, 'worker.config.json');
    fs.writeFileSync(cfgFile, JSON.stringify({ siteUrl: 'http://127.0.0.1:' + srv.address().port, token: TOKEN, pythonPath: process.execPath, transcribePy: __filename, kongCheckpoint: __filename, scratchDir: path.join(dir, 'scratch') }));
    const run = args => new Promise(resolve => { const c = spawn(process.execPath, [path.join(L.MODS, 'tools/home-worker/worker.js')].concat(args).concat(['--config', cfgFile]), { windowsHide: true }); let out = ''; c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; }); c.on('close', code => resolve({ code: code, out: out })); });
    const r1 = await run(['--once', '--log-file']);
    const f1 = path.join(dir, 'worker.log');
    ok('--log-file with no value: worker.log next to the settings file has the run (a start line with the date, "PPP home worker", "Nothing is waiting."), and so does the console', r1.code === 0 && fs.existsSync(f1) && /^---- \d{4}-\d\d-\d\dT[\d:.]+Z --once --log-file ----$/m.test(fs.readFileSync(f1, 'utf8')) && /PPP home worker/.test(fs.readFileSync(f1, 'utf8')) && /Nothing is waiting/.test(fs.readFileSync(f1, 'utf8')) && /Nothing is waiting/.test(r1.out), fs.existsSync(f1) ? fs.readFileSync(f1, 'utf8').slice(0, 200) : 'no file');
    const other = path.join(dir, 'sub', 'mine.log');
    const r2 = await run(['--once', '--log-file', other]);
    ok('--log-file <file>: that file (its folder is made)', r2.code === 0 && /Nothing is waiting/.test(fs.readFileSync(other, 'utf8')));
    const r3 = await run(['--once']);
    const size = fs.statSync(f1).size;
    ok('without the flag nothing is written to the file', r3.code === 0 && fs.statSync(f1).size === size);
    ok('the token is in no line of the file, and not in the console', !fs.readFileSync(f1, 'utf8').includes(TOKEN) && !fs.readFileSync(other, 'utf8').includes(TOKEN) && !r1.out.includes(TOKEN));
    const hidden = path.join(dir, 'tok.log');
    const r4 = await run(['--check', '--log-file', hidden]);
    ok('--check writes the settings file name and results to it, still with the token hidden (only its first 8 characters are ever shown)', fs.existsSync(hidden) && !fs.readFileSync(hidden, 'utf8').includes(TOKEN) && /Settings file:/.test(fs.readFileSync(hidden, 'utf8')), r4.code + ' ' + (fs.existsSync(hidden) ? fs.readFileSync(hidden, 'utf8').slice(0, 200) : ''));
    const big = path.join(dir, 'big.log');
    fs.writeFileSync(big, 'x'.repeat(600 * 1024));
    W.appendLog(big, 'new line');
    ok('past 512 KB the old file is set aside as <file>.old and the log starts again: it never grows without end', fs.existsSync(big + '.old') && fs.readFileSync(big, 'utf8') === 'new line\n' && fs.statSync(big + '.old').size === 600 * 1024);
    W.appendLog(path.join(tmp, 'a-file', 'no', 'good.log'), 'x');
    ok('a log that cannot be written (here: a file in the way of its folder) stops nothing', true);
    ok('with no file name, appendLog does nothing', (() => { try { W.appendLog('', 'x'); return true; } catch (e) { return false; } })());
    srv.close();
  }
})().then(() => { L.rmDir(tmp); L.finish('the pppworker:// start, the run lock and the log file of the home-PC worker'); }, e => { console.error(e); L.rmDir(tmp); process.exit(1); });
