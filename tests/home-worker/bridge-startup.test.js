/* ============================================================================
   G10b-6: the Startup-folder launcher of the localhost bridge (tools/home-worker/start-hidden.vbs, start-hidden.cmd, install-startup.cmd, uninstall-startup.cmd, startup-shortcut.ps1).

   NOTHING here touches this user's real Startup folder, the registry or a scheduled task: the script is told (PPP_STARTUP_DIR) to use a temporary folder, the start is switched off
   (-NoStart / PPP_STARTUP_NOSTART), and the real Startup folder is listed before and after to prove it did not change. Windows only (WScript.Shell makes the shortcut): elsewhere it
   checks the files and says what it skipped.

     - the files: start-hidden.vbs reads no argument, runs the cmd hidden and does not wait; the cmd starts `worker.js --serve --log-file` and passes nothing on (no %1, no %*);
       install/uninstall pass nothing to the script but the action
     - install: one .lnk, wscript.exe //B //Nologo "<this folder>\start-hidden.vbs" and nothing else; again = the same; a different file of that name is never overwritten
     - uninstall: removes only that shortcut (a different file stays, exit 1) and stops the program that listens on the bridge's port when it is `worker.js --serve`
       (tested on a REAL `--serve` process on a port of its own - never on the default port)
     - install-startup.cmd / uninstall-startup.cmd, run for real with the hooks above, do the same

   node tests/home-worker/bridge-startup.test.js */
'use strict';
const L = require('./lib');
const { ok, heading, sleep } = L;
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const DIR = path.join(L.MODS, 'tools', 'home-worker');
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const code = t => t.split(/\r?\n/).filter(l => !/^\s*(rem\b|'|#)/i.test(l)).join('\n');          /* without comment lines */

function freePort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.unref(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); }); }
function run(cmd, args, env, timeout) {
  return new Promise(resolve => {
    const c = spawn(cmd, args, { env: Object.assign({}, process.env, env || {}), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
    const t = setTimeout(() => { c.kill(); }, timeout || 60000);
    c.on('close', code => { clearTimeout(t); resolve({ code: code, out: out }); });
  });
}
const ps = (action, extra, env) => run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(DIR, 'startup-shortcut.ps1'), action].concat(extra || []), env);
/* what the shortcut points to, read back through the same COM object Windows uses */
async function shortcut(lnk) {
  const r = await run('powershell', ['-NoProfile', '-Command', "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); [Console]::Out.Write(($s.TargetPath + '|' + $s.Arguments + '|' + $s.WorkingDirectory))"], { LNK: lnk });
  const p = r.out.split('|');
  return { target: p[0], args: p[1], cwd: p[2] };
}
const startupOf = () => path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const snapshot = () => { try { return fs.readdirSync(startupOf()).sort().join('|'); } catch (e) { return '(none)'; } };

(async () => {
  heading('the files');
  {
    const vbs = read('start-hidden.vbs'), cmd = read('start-hidden.cmd'), inst = read('install-startup.cmd'), un = read('uninstall-startup.cmd'), p1 = read('startup-shortcut.ps1');
    ok('start-hidden.vbs runs start-hidden.cmd (found from its own path), hidden (0) and without waiting (False)', /ScriptFullName/.test(vbs) && /start-hidden\.cmd/.test(vbs) && /,\s*0,\s*False/.test(code(vbs)));
    ok('start-hidden.vbs never reads an argument (no Arguments, no command line, no environment)', !/Arguments|CommandLine|ExpandEnvironmentStrings|Environment\(/i.test(code(vbs)));
    ok('start-hidden.cmd starts `worker.js --serve --log-file` hidden, takes and passes nothing (no %1, %*, %0 after the folder, no pause)', /worker\.js --serve --log-file/.test(cmd) && !/%[1-9*]/.test(cmd) && !/\bpause\b/i.test(cmd));
    ok('start-hidden.cmd falls back to the usual Node folder when node is not on the PATH', /ProgramFiles%\\nodejs\\node\.exe/.test(cmd));
    ok('install-startup.cmd and uninstall-startup.cmd hand the script the action and nothing else (no %1, %*)', /startup-shortcut\.ps1" install/.test(inst) && /startup-shortcut\.ps1" uninstall/.test(un) && !/%[1-9*]/.test(inst + un));
    ok('they say it in Korean first and in English, and how to undo', /설치했어요/.test(inst) && /Installed\./.test(inst) && /uninstall-startup\.cmd/.test(inst) && /지웠어요/.test(un));
    ok('the script writes into the Startup folder only: no registry, no scheduled task, no administrator', !/Registry|HKLM|HKCU|reg\.exe|schtasks|Register-ScheduledTask|RunAs|New-ItemProperty/i.test(code(p1)));
    ok('the shortcut\'s command is wscript.exe //B //Nologo "<start-hidden.vbs>" and the script is plain ASCII', /'\/\/B \/\/Nologo "' \+ \$vbs \+ '"'/.test(p1) && !/[^\x00-\x7f]/.test(p1));
  }
  if (process.platform !== 'win32') { console.log('\n  - not Windows: the shortcut, the stop and the .cmd runs are skipped'); L.finish('the Startup launcher of the home-PC worker (files only)'); return; }

  const realBefore = snapshot();
  const tmp = L.tmpDir('ppp-startup-');
  const dir = path.join(tmp, 'Startup');
  const LNK = path.join(dir, 'PPP home worker (bridge).lnk');
  const env = { PPP_STARTUP_DIR: dir, PPP_STARTUP_NOSTART: '1' };
  try {
    heading('install -NoStart: ONE shortcut in the (temporary) Startup folder that runs wscript.exe //B //Nologo "start-hidden.vbs" and nothing else');
    {
      const st0 = await ps('status', [], env);
      ok('status before: not installed, and nothing is running on the bridge port of this test', /Startup shortcut: not installed/.test(st0.out) && st0.code === 0, st0.out);
      const r = await ps('install', ['-NoStart'], env);
      ok('install succeeds and names the shortcut', r.code === 0 && /Startup shortcut made/.test(r.out), r.out);
      ok('exactly one file was made, in the temporary folder', fs.existsSync(LNK) && fs.readdirSync(dir).length === 1);
      const sc = await shortcut(LNK);
      const vbs = path.join(DIR, 'start-hidden.vbs');
      ok('it runs wscript.exe from System32', path.resolve(sc.target).toLowerCase() === path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe').toLowerCase(), sc.target);
      ok('with exactly  //B //Nologo "<this folder>\\start-hidden.vbs"  as its arguments (no extra word, no %1)', sc.args === '//B //Nologo "' + vbs + '"', sc.args);
      ok('starting in the repository folder', path.resolve(sc.cwd).toLowerCase() === path.resolve(DIR, '..', '..').toLowerCase(), sc.cwd);
      ok('status after: installed', /Startup shortcut: installed/.test((await ps('status', [], env)).out));
      const again = await ps('install', ['-NoStart'], env);
      ok('installing again is the same (no error, still one file)', again.code === 0 && fs.readdirSync(dir).length === 1);
      /* a file that is not ours */
      fs.rmSync(LNK);
      fs.writeFileSync(LNK, 'somebody else\'s file');
      const clash = await ps('install', ['-NoStart'], env);
      ok('a DIFFERENT file with that name is not overwritten: install fails and says so', clash.code !== 0 && /already in the Startup folder/.test(clash.out) && fs.readFileSync(LNK, 'utf8') === 'somebody else\'s file', clash.out);
      const un0 = await ps('uninstall', [], Object.assign({}, env, { PPP_WORKER_BRIDGE_PORT: String(await freePort()) }));
      ok('uninstall does not remove a file that is not ours either (exit 1, file kept)', un0.code === 1 && fs.readFileSync(LNK, 'utf8') === 'somebody else\'s file', un0.out);
      fs.rmSync(LNK);
    }

    heading('uninstall: removes only our shortcut, and stops `worker.js --serve` on the bridge port (a real process, a port of its own)');
    {
      const port = await freePort();
      const pe = Object.assign({}, env, { PPP_WORKER_BRIDGE_PORT: String(port) });
      await ps('install', ['-NoStart'], pe);
      const cfgDir = L.tmpDir('ppp-startup-cfg-');
      const cfg = path.join(cfgDir, 'worker.config.json');
      fs.writeFileSync(cfg, JSON.stringify({ siteUrl: 'http://127.0.0.1:9', scratchDir: path.join(cfgDir, 's') }));
      const child = spawn(process.execPath, [path.join(DIR, 'worker.js'), '--serve', '--config', cfg], { env: Object.assign({}, process.env, { PPP_WORKER_BRIDGE_PORT: String(port), PPP_WORKER_TOKEN: '' }), stdio: 'ignore', windowsHide: true });
      const closed = new Promise(res => child.on('close', res));
      let up = false;
      for (let i = 0; i < 100 && !up; i++) { up = await new Promise(res => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); }); if (!up) await sleep(100); }
      ok('a real `worker.js --serve` is listening on the test port', up);
      const st = await ps('status', [], pe);
      ok('status sees the program on that port', /running on port \d+: yes/.test(st.out), st.out);
      const un = await ps('uninstall', [], pe);
      ok('uninstall removes the shortcut and says it stopped the program', un.code === 0 && /Startup shortcut removed/.test(un.out) && /The program was stopped/.test(un.out) && !fs.existsSync(LNK), un.out);
      const gone = await Promise.race([closed.then(() => true), sleep(10000).then(() => false)]);
      ok('the process is gone and its port is closed', gone && await new Promise(res => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(false); }); s.on('error', () => res(true)); }));
      if (!gone) child.kill();
      const none = await ps('uninstall', [], pe);
      ok('uninstall with nothing to remove and nothing running is fine', none.code === 0 && /no startup shortcut|There is no/.test(none.out) && /not running/.test(none.out), none.out);
      /* a program that is NOT worker.js --serve on that port is left alone */
      const other = http.createServer((q, r) => r.end('x'));
      await new Promise(r => other.listen(port, '127.0.0.1', r));
      const un2 = await ps('uninstall', [], pe);
      ok('another program on the port (not `worker.js --serve`) is NOT stopped', /not running on the bridge port/.test(un2.out) && other.listening);
      await new Promise(r => other.close(r));
      L.rmDir(cfgDir);
    }

    heading('install-startup.cmd and uninstall-startup.cmd, run for real with the hooks');
    {
      const cmd = f => run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', path.join(DIR, f)], Object.assign({}, env, { PPP_WORKER_BRIDGE_PORT: '47999' }), 90000);
      const r = await cmd('install-startup.cmd');
      ok('install-startup.cmd made the shortcut in the temporary folder and told the person what to do next (Korean and English)', r.code === 0 && fs.existsSync(LNK) && /설치했어요/.test(r.out.replace(/\uFFFD/g, '')) || (r.code === 0 && fs.existsSync(LNK) && /Installed\. Open PPP/.test(r.out)), 'code ' + r.code + ' ' + r.out.slice(-300));
      const u = await cmd('uninstall-startup.cmd');
      ok('uninstall-startup.cmd removed it', u.code === 0 && !fs.existsSync(LNK), 'code ' + u.code + ' ' + u.out.slice(-300));
    }
    ok('the REAL Startup folder of this user is exactly as it was before the test', snapshot() === realBefore, realBefore + ' -> ' + snapshot());
  } finally { L.rmDir(tmp); }
  L.finish('the Startup launcher of the home-PC worker');
})().catch(e => { console.error(e); process.exit(1); });
