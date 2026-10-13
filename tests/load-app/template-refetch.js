#!/usr/bin/env node
/* G13-4c spike: does the dc-runtime's second fetch of the page (support.js:159, `fetch(location.href)` unless window.__resources is set) change anything that is drawn?

   The runtime first compiles the template from the DOM the browser parsed (`x-dc.innerHTML`), then fetches the file again and recompiles it from the raw text (`updateHtml`).
   If the two templates compile to the same thing, the second fetch (329 KB on the wire, 1.2 MB raw, and a second render of everything) is a no-op for the person. This tool
   holds the second fetch back, reads the compiled template (the runtime's own `__dcAnnotatedTemplate`: the encoded, `data-dc-tpl`-stamped template its builders are made from)
   and the rendered DOM before it, releases it, reads both again, and compares:

     node tests/load-app/template-refetch.js <base url> [--screens] [--locale ko-KR]

   --screens also opens Practice and Settings before and after (the DOM of each, whitespace-normalised). Exit 0 when nothing differs. Needs puppeteer. */
'use strict';
const args = process.argv.slice(2);
const li = args.indexOf('--locale');
const LOCALE = li >= 0 ? args[li + 1] : 'en-US';
const base = args.find((a, i) => !a.startsWith('--') && (li < 0 || i !== li + 1));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function loadPuppeteer() {
  for (const spec of ['puppeteer', process.env.PPP_PUPPETEER, 'D:/PPP/node_modules/puppeteer']) { if (!spec) continue; try { return require(spec); } catch (e) { /* next */ } }
  throw new Error('puppeteer is not installed');
}
const norm = s => String(s).replace(/\s+/g, ' ').replace(/> </g, '><').trim();
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0; while (i < n && a[i] === b[i]) i++;
  return { at: i, before: a.slice(Math.max(0, i - 100), i + 160), after: b.slice(Math.max(0, i - 100), i + 160) };
}

(async () => {
  if (!base) { console.error('usage: template-refetch.js <base url> [--screens] [--locale ko-KR]'); process.exit(2); }
  const browser = await loadPuppeteer().launch({ headless: 'new', args: ['--no-sandbox'] });
  let bad = 0;
  try {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument(l => { try { localStorage.setItem('ppp-guest', '1'); localStorage.setItem('ppp-locale', l); } catch (e) { /* */ } }, LOCALE);
    const held = [];
    let fetched = 0;
    await page.setRequestInterception(true);
    page.on('request', r => {
      if (r.resourceType() === 'fetch' && /Piano(%20| )Coach(%20| )App\.dc\.html/.test(r.url())) { fetched++; held.push(r); return; }
      r.continue().catch(() => {});
    });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));
    await page.goto(base + '/Piano%20Coach%20App.dc.html', { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => document.querySelectorAll('aside nav button').length >= 6, { timeout: 30000 });
    await page.evaluate(() => window.PPP_I18N && window.PPP_I18N.ready);
    await sleep(1500);
    const snap = () => page.evaluate(() => {
      const name = window.__dcRootName();
      return {
        name,
        annotated: window.__dcAnnotatedTemplate(name),
        source: window.__dcTemplateSource ? window.__dcTemplateSource(name) : null,
        dom: document.body.innerHTML,
        /* what React was handed: the names of the event props (and the other props that are not plain attributes) of every element, in document order */
        props: [...document.body.querySelectorAll('*')].map(e => {
          const k = Object.keys(e).find(x => x.indexOf('__reactProps$') === 0);
          return k ? Object.keys(e[k]).filter(n => n !== 'children' && n !== 'style').sort().join(',') : '';
        })
      };
    });
    const clickNav = async re => page.evaluate(src => {
      const rx = new RegExp(src);
      const b = [...document.querySelectorAll('aside nav button')].find(x => rx.test((x.innerText || '').trim().split('\n')[0].trim()));
      if (b) { b.click(); return true; } return false;
    }, re);
    const screens = args.includes('--screens') ? [['practice', '^(Practice|연습|練習|练习)$'], ['settings', '^(Settings|설정|設定|设置)$']] : [];
    const before = { home: await snap() };
    for (const [name, re] of screens) { if (!(await clickNav(re))) throw new Error('no nav button ' + name); await sleep(1500); before[name] = await snap(); }
    if (screens.length) { await clickNav('^(Home|홈|ホーム|首页)$'); await sleep(800); }
    console.log(`second fetch held: ${held.length} request(s) of the page (${fetched} seen); before: template ${before.home.annotated.length} chars, source ${before.home.source ? before.home.source.length : '-'} chars`);
    for (const r of held.splice(0)) r.continue().catch(() => {});
    await sleep(4000);                                   // the runtime recompiles from the raw text
    const after = { home: await snap() };
    for (const [name, re] of screens) { await clickNav(re); await sleep(1500); after[name] = await snap(); }
    for (const name of Object.keys(before)) {
      const b = before[name], a = after[name];
      const tpl = b.annotated === a.annotated;
      const src = b.source === a.source;
      const dom = norm(b.dom) === norm(a.dom);
      const props = JSON.stringify(b.props) === JSON.stringify(a.props);
      /* the only textual difference of the two templates: the DOM parser lowercased the event attributes (onClick -> onclick), the runtime maps them back */
      const unCamel = t => t.replace(/ sc-camel-on-([a-z-]+)=/g, (m, n) => ' on' + n.replace(/-/g, '') + '=');
      const onlyEvents = unCamel(a.annotated) === b.annotated;
      const events = [...new Set([...a.annotated.matchAll(/ sc-camel-on-([a-z-]+)=/g)].map(m => m[1]))].sort();
      if (!dom || !props || !onlyEvents) bad++;
      console.log(`  event attributes spelled differently in the two templates: ${events.join(', ') || 'none'}; nothing else differs: ${onlyEvents}; React props per element identical: ${props} (${a.props.length} elements)`);
      if (!props) { const i = b.props.findIndex((x, j) => x !== a.props[j]); console.log('  first element whose props differ: #' + i + ' before [' + b.props[i] + '] after [' + a.props[i] + ']'); }
      console.log(`${name.padEnd(9)} compiled template ${tpl ? 'IDENTICAL' : 'DIFFERENT'} (${a.annotated.length} chars), decoded source ${src ? 'identical' : 'different'}, rendered DOM ${dom ? 'IDENTICAL' : 'DIFFERENT'} (${norm(a.dom).length} chars)`);
      if (!tpl && !onlyEvents) console.log('  template: ' + JSON.stringify(firstDiff(unCamel(a.annotated), b.annotated)));
      if (!dom) console.log('  dom:      ' + JSON.stringify(firstDiff(norm(b.dom), norm(a.dom))));
    }
    console.log('page errors: ' + (errors.length ? JSON.stringify(errors) : 'none'));
  } finally { await browser.close(); }
  process.exitCode = bad ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
