/* ============================================================================
   PPP ScoreGraph — exact rational numbers (docs/GOALS/G01 §6.1, §6.10)

   Notated time is a rational number of whole notes (W): a quarter is 1/4, a
   triplet eighth 1/12. In memory a Rat is {n, d}: integers, d > 0, reduced by
   their gcd after every operation. Stored as a string, "3/8", "0", "-1/4":
   reduced, "/d" only when d >= 2, |n| and d at most 2^31 - 1, so Python's
   fractions.Fraction("3/8") reads it as is.

   Arithmetic stays in JS Numbers while every intermediate is a safe integer
   and throws RationalOverflow the moment one is not. Only the conversion to
   microseconds uses BigInt; it rounds half up, in one place (micros).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.PPPScoreGraphModules = root.PPPScoreGraphModules || {}).rational = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORE_MAX = 2147483647;                 /* 2^31 - 1: the stored range of |n| and d */
  const RAT_RE = /^(0|-?[1-9][0-9]*)(\/[1-9][0-9]*)?$/;

  class RationalOverflow extends Error {
    constructor(what) { super('RationalOverflow: ' + what); this.name = 'RationalOverflow'; this.code = 'RationalOverflow'; }
  }
  class RationalFormatError extends Error {
    constructor(text, why) { super('E-RATIONAL: ' + JSON.stringify(text) + ' ' + why); this.name = 'RationalFormatError'; this.code = 'E-RATIONAL'; }
  }

  function safe(x, what) {
    if (!Number.isSafeInteger(x)) throw new RationalOverflow(what);
    return x;
  }
  function gcd(a, b) {
    a = a < 0 ? -a : a; b = b < 0 ? -b : b;
    while (b) { const t = a % b; a = b; b = t; }
    return a;
  }

  /* A reduced rational n/d. Both must be integers; d must not be 0. */
  function make(n, d) {
    if (d === undefined) d = 1;
    if (!Number.isInteger(n) || !Number.isInteger(d)) throw new TypeError('rational parts must be integers');
    if (d === 0) throw new RangeError('rational denominator 0');
    safe(n, 'numerator'); safe(d, 'denominator');
    if (n === 0) return { n: 0, d: 1 };
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d);
    return g === 1 ? { n: n, d: d } : { n: n / g, d: d / g };
  }

  const ZERO = Object.freeze({ n: 0, d: 1 });
  const ONE = Object.freeze({ n: 1, d: 1 });

  function isRat(x) {
    return !!x && typeof x === 'object' && Number.isSafeInteger(x.n) && Number.isSafeInteger(x.d) && x.d > 0;
  }

  function add(a, b) {
    const g = gcd(a.d, b.d);
    const da = a.d / g, db = b.d / g;
    return make(safe(safe(a.n * db, 'add') + safe(b.n * da, 'add'), 'add'), safe(a.d * db, 'add'));
  }
  function neg(a) { return a.n === 0 ? ZERO : { n: -a.n, d: a.d }; }
  function sub(a, b) { return add(a, neg(b)); }
  function mul(a, b) {
    if (a.n === 0 || b.n === 0) return ZERO;
    const g1 = gcd(a.n, b.d), g2 = gcd(b.n, a.d);
    return make(safe((a.n / g1) * (b.n / g2), 'mul'), safe((a.d / g2) * (b.d / g1), 'mul'));
  }
  function inv(a) {
    if (a.n === 0) throw new RangeError('division by zero');
    return a.n < 0 ? { n: -a.d, d: -a.n } : { n: a.d, d: a.n };
  }
  function div(a, b) { return mul(a, inv(b)); }

  function cmp(a, b) {
    const l = a.n * b.d, r = b.n * a.d;
    if (Number.isSafeInteger(l) && Number.isSafeInteger(r)) return l < r ? -1 : l > r ? 1 : 0;
    const L = BigInt(a.n) * BigInt(b.d), R = BigInt(b.n) * BigInt(a.d);
    return L < R ? -1 : L > R ? 1 : 0;
  }
  const eq = (a, b) => a.n === b.n && a.d === b.d;
  const lt = (a, b) => cmp(a, b) < 0;
  const le = (a, b) => cmp(a, b) <= 0;
  const gt = (a, b) => cmp(a, b) > 0;
  const ge = (a, b) => cmp(a, b) >= 0;
  const min = (a, b) => (cmp(a, b) <= 0 ? a : b);
  const max = (a, b) => (cmp(a, b) >= 0 ? a : b);
  const sign = a => (a.n > 0 ? 1 : a.n < 0 ? -1 : 0);
  const isZero = a => a.n === 0;
  /* The greatest integer <= a, exactly (n % d is exact for safe integers). */
  function floor(a) { return (a.n - (((a.n % a.d) + a.d) % a.d)) / a.d; }
  function fromInt(i) { return make(i, 1); }
  /* For display and tests only; nothing notated is computed in floating point. */
  function toNumber(a) { return a.n / a.d; }

  /* ----------------------------------------------------------- text form */
  function check(text) {
    if (typeof text !== 'string') return 'is not a string';
    const m = RAT_RE.exec(text);
    if (!m) return 'is not of the form n or n/d';
    const n = Number(m[1]), d = m[2] ? Number(m[2].slice(1)) : 1;
    if (Math.abs(n) > STORE_MAX || d > STORE_MAX) return 'is out of range (|n|, d <= 2^31 - 1)';
    if (m[2] && d < 2) return 'has a denominator below 2';
    if (gcd(n, d) !== 1 && n !== 0) return 'is not reduced';
    if (n === 0 && m[2]) return 'is not reduced';
    return null;
  }
  function isValid(text) { return check(text) === null; }
  function parse(text) {
    const why = check(text);
    if (why) throw new RationalFormatError(text, why);
    const slash = text.indexOf('/');
    return slash < 0 ? { n: Number(text), d: 1 } : { n: Number(text.slice(0, slash)), d: Number(text.slice(slash + 1)) };
  }
  function tryParse(text) { return isValid(text) ? parse(text) : null; }
  function format(a) { return a.d === 1 ? String(a.n) : a.n + '/' + a.d; }
  /* Does a stays inside the stored range (a value computed in memory can leave it)? */
  function storable(a) { return Math.abs(a.n) <= STORE_MAX && a.d <= STORE_MAX; }

  /* ---------------------------------------------------- microsecond rounding */
  /* roundHalfUp(n/d) = floor((2n + d) / (2d)) for n >= 0, in BigInt (§6.10). */
  function roundHalfUpBig(n, d) {
    if (d <= 0n) throw new RangeError('denominator must be positive');
    if (n < 0n) throw new RangeError('negative time');
    return (2n * n + d) / (2n * d);
  }
  /* Seconds as a Rat -> integer microseconds. */
  function micros(sec) {
    return Number(roundHalfUpBig(BigInt(sec.n) * 1000000n, BigInt(sec.d)));
  }
  /* A JS number of seconds (as recordings give them) -> integer microseconds, through its
     shortest decimal string so float multiplication error never decides a rounding. */
  function secondsToMicros(x) {
    if (typeof x !== 'number' || !isFinite(x)) throw new RangeError('seconds must be a finite number');
    const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(x));
    if (!m) throw new RangeError('negative or malformed seconds: ' + x);
    const frac = m[2] || '';
    let n = BigInt(m[1] + frac), d = 10n ** BigInt(frac.length);
    const e = m[3] ? Number(m[3]) : 0;
    if (e > 0) n *= 10n ** BigInt(e); else if (e < 0) d *= 10n ** BigInt(-e);
    return Number(roundHalfUpBig(n * 1000000n, d));
  }

  return Object.freeze({
    STORE_MAX, RAT_RE, RationalOverflow, RationalFormatError, ZERO, ONE,
    make, isRat, add, sub, neg, mul, div, inv, cmp, eq, lt, le, gt, ge, min, max, sign, isZero, floor,
    fromInt, toNumber, check, isValid, parse, tryParse, format, storable, gcd,
    roundHalfUpBig, micros, secondsToMicros
  });
});
