/* Shared Puppeteer boot: force English UI and skip the login gate. */
function preparePage(page) {
  return page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('ppp-locale', 'en-US');
      localStorage.setItem('ppp-guest', '1');
    } catch (e) {}
  });
}

module.exports = { preparePage };
