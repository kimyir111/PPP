/* PPP localization — same four locales as DuckScope: ko-KR, ja-JP, en-US, zh-CN.
   Catalogs live in ./i18n/*.json. Missing keys fall back to the English source. */
(function (global) {
  var SUPPORTED = ['ko-KR', 'ja-JP', 'en-US', 'zh-CN'];
  var DEFAULT_LOCALE = 'en-US';
  var STORAGE_KEY = 'ppp-locale';
  var COOKIE_KEY = 'ppp_locale';

  var OPTIONS = [
    { locale: 'ko-KR', countryCode: 'KR', flag: '🇰🇷', country: '대한민국', language: '한국어' },
    { locale: 'ja-JP', countryCode: 'JP', flag: '🇯🇵', country: '日本', language: '日本語' },
    { locale: 'en-US', countryCode: 'US', flag: '🇺🇸', country: 'United States', language: 'English' },
    { locale: 'zh-CN', countryCode: 'CN', flag: '🇨🇳', country: '中国', language: '简体中文' }
  ];

  var TIME_ZONE_LOCALES = {
    'Asia/Seoul': 'ko-KR',
    'Asia/Tokyo': 'ja-JP',
    'Asia/Shanghai': 'zh-CN',
    'Asia/Chongqing': 'zh-CN',
    'Asia/Harbin': 'zh-CN',
    'Asia/Urumqi': 'zh-CN'
  };

  function isLocale(value) {
    return !!value && SUPPORTED.indexOf(value) > -1;
  }

  function localeFromLanguageTag(tag) {
    var normalized = String(tag || '').trim().replace('_', '-').toLowerCase();
    var language = normalized.split('-')[0];
    if (language === 'ko') return 'ko-KR';
    if (language === 'ja') return 'ja-JP';
    if (language === 'zh') return 'zh-CN';
    if (language === 'en') return 'en-US';
    return null;
  }

  function detectLocale(languages, timeZone) {
    languages = languages || [];
    timeZone = timeZone || '';
    for (var i = 0; i < languages.length; i++) {
      var match = localeFromLanguageTag(languages[i]);
      if (match) return match;
    }
    if (TIME_ZONE_LOCALES[timeZone]) return TIME_ZONE_LOCALES[timeZone];
    if (timeZone.indexOf('America/') === 0) return 'en-US';
    return DEFAULT_LOCALE;
  }

  function browserLocale() {
    var languages = (typeof navigator !== 'undefined' && navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [(typeof navigator !== 'undefined' && navigator.language) || 'en-US'];
    var timeZone = '';
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    return detectLocale(languages, timeZone);
  }

  function persistCookie(locale) {
    if (typeof document === 'undefined') return;
    var secure = (typeof location !== 'undefined' && location.protocol === 'https:') ? '; Secure' : '';
    document.cookie = COOKIE_KEY + '=' + locale + '; Path=/; Max-Age=31536000; SameSite=Lax' + secure;
  }

  function applyDocumentLocale(locale, source) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    var el = document.documentElement;
    el.lang = locale;
    el.setAttribute('translate', 'no');
    el.classList.add('notranslate');
    el.dataset.locale = locale;
    el.dataset.localeSource = source || 'automatic';
  }

  function normalize(value) {
    return String(value || '')
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function interpolate(str, vars) {
    if (!vars) return str;
    return String(str).replace(/\{\{(\w+)\}\}/g, function (_, key) {
      return vars[key] == null ? '' : String(vars[key]);
    });
  }

  function indexContent(content) {
    var indexed = {};
    if (!content) return indexed;
    Object.keys(content).forEach(function (key) {
      var value = content[key];
      indexed[key] = value;
      var n = normalize(key);
      if (n && indexed[n] === undefined) indexed[n] = value;
    });
    return indexed;
  }

  var catalogs = {};
  SUPPORTED.forEach(function (loc) { catalogs[loc] = {}; });

  var locale = DEFAULT_LOCALE;
  var source = 'automatic';
  var listeners = [];

  try {
    var saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (isLocale(saved)) {
      locale = saved;
      source = 'manual';
    } else {
      locale = browserLocale();
      source = 'automatic';
    }
  } catch (e) {
    locale = browserLocale();
  }
  persistCookie(locale);
  applyDocumentLocale(locale, source);

  function getOption(loc) {
    for (var i = 0; i < OPTIONS.length; i++) if (OPTIONS[i].locale === loc) return OPTIONS[i];
    return OPTIONS[2];
  }

  function tx(src, vars) {
    if (src == null || src === '') return '';
    var catalog = catalogs[locale] || {};
    var hit = catalog[src];
    if (hit == null) hit = catalog[normalize(src)];
    var out = hit == null ? String(src) : String(hit);
    return interpolate(out, vars);
  }

  function setLocale(next) {
    if (!isLocale(next)) return locale;
    locale = next;
    source = 'manual';
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
    persistCookie(next);
    applyDocumentLocale(next, source);
    listeners.forEach(function (fn) { try { fn(next); } catch (e) {} });
    return locale;
  }

  function setAutomaticLocale() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    locale = browserLocale();
    source = 'automatic';
    persistCookie(locale);
    applyDocumentLocale(locale, source);
    listeners.forEach(function (fn) { try { fn(locale); } catch (e) {} });
    return locale;
  }

  function apply(root) {
    if (!root) return;
    var skip = 'svg, [data-no-i18n], script, style, textarea, input, code';
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var parent = node.parentElement;
      if (!parent || parent.closest(skip)) return;
      var raw = node.nodeValue;
      if (!raw) return;
      var trimmed = normalize(raw);
      if (!trimmed || trimmed.length < 2) return;
      if (/^[\d.%×x/\-–→←+]+$/.test(trimmed)) return;
      var translated = tx(trimmed);
      if (translated && translated !== trimmed) {
        node.nodeValue = raw.replace(trimmed, translated);
      }
    });
    var attrs = root.querySelectorAll('[placeholder], [title], [aria-label]');
    for (var i = 0; i < attrs.length; i++) {
      var el = attrs[i];
      ['placeholder', 'title', 'aria-label'].forEach(function (attr) {
        if (!el.hasAttribute(attr)) return;
        var v = el.getAttribute(attr);
        var t = tx(v);
        if (t && t !== v) el.setAttribute(attr, t);
      });
    }
  }

  function catalogUrl(loc) {
    try {
      if (typeof document !== 'undefined') {
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
          var src = scripts[i].src || '';
          if (/i18n\.js(\?|#|$)/.test(src)) {
            return src.replace(/i18n\.js(\?|#|$)/, 'i18n/' + loc + '.json$1').replace(/\?$|#$/, '');
          }
        }
      }
    } catch (e) {}
    return './i18n/' + loc + '.json';
  }

  var ready = Promise.all(SUPPORTED.map(function (loc) {
    return fetch(catalogUrl(loc), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { content: {} }; })
      .then(function (json) { catalogs[loc] = indexContent(json && json.content); })
      .catch(function () { catalogs[loc] = {}; });
  }));

  global.PPP_I18N = {
    SUPPORTED: SUPPORTED,
    OPTIONS: OPTIONS,
    STORAGE_KEY: STORAGE_KEY,
    ready: ready,
    isLocale: isLocale,
    detectLocale: detectLocale,
    getLocale: function () { return locale; },
    getSource: function () { return source; },
    getOption: function (loc) { return getOption(loc || locale); },
    t: tx,
    tx: tx,
    interpolate: interpolate,
    setLocale: setLocale,
    setAutomaticLocale: setAutomaticLocale,
    onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    apply: apply
  };
})(typeof window !== 'undefined' ? window : this);
