/* Shared Puppeteer boot: force English UI and skip the login gate. */
function preparePage(page) {
  return page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('ppp-locale', 'en-US');
      localStorage.setItem('ppp-guest', '1');
    } catch (e) {}
    /* The routes a person takes, by clicking what they would click. Loop and
       memory work are tabs of the Practice page, and upload is the button
       above the sidebar list, so every suite goes there the same way. */
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const firstLine = el => (el.innerText || el.textContent || '').trim().split('\n')[0].trim();
    window.__pppTest = {
      /* a sidebar entry, by its label (the line under it describes it) */
      nav(label) {
        const b = [...document.querySelectorAll('aside nav button')].find(x => firstLine(x) === label);
        if (b) b.click();
        return !!b;
      },
      upload() {
        const b = document.querySelector('aside > button');
        if (b) b.click();
        return !!b;
      },
      /* Practice, then one of its tabs: 'Start to finish', 'Loop a passage', 'Memorize' */
      async practice(tab, label) {
        this.nav(label || 'Practice');
        await wait(300);
        if (!tab) return true;
        const t = [...document.querySelectorAll('main [role=tab]')].find(x => firstLine(x) === tab);
        if (t) t.click();
        await wait(250);
        return !!t;
      }
    };
  });
}

module.exports = { preparePage };
