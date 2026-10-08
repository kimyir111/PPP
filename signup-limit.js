/* The signup limiter's own rules, apart from the server (G13-5; docs/GOALS/G13_PRODUCTIZATION.md TD26): the numbers, what a count of recent accounts allows, how long a
   refused person is told to wait, and the one-at-a-time section in which the table is read and the account written. server.js does the HTTP, the keyed address tag and the store. */
'use strict';

/* ATTEMPTS: every request to the route from one address (it costs a scrypt before it can be answered), in memory, per ATTEMPT_MS.
   PER_ADDRESS_*: accounts made from one address (an IPv6 address counts as its /48) per hour and per day; SITE_HOUR: accounts made by everybody per hour.
   These three are counted from the accounts themselves (the users table), so a restart does not forget them. */
const SIGNUP = {
  ATTEMPTS: 20, ATTEMPT_MS: 15 * 60 * 1000,
  PER_ADDRESS_HOUR: 10, PER_ADDRESS_DAY: 30, SITE_HOUR: 100,
  HOUR_MS: 60 * 60 * 1000, DAY_MS: 24 * 60 * 60 * 1000
};

/* a request from this machine itself: the socket, the loopback address, no proxy header (a developer's server; the browser suites sign up many accounts from it) */
const LOOPBACK = /^(?:127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/i;

/* why an account may not be made now, or null: 'site' (everybody's hour is full), 'day' or 'hour' (this address's). made = { siteHour, addrHour, addrDay } as the table says;
   local: the address is the machine itself, which is not limited per address (the site's cap is the site's). The day comes before the hour: it is the longer wait. */
function refusal(made, local) {
  if (made.siteHour >= SIGNUP.SITE_HOUR) return 'site';
  if (!local && made.addrDay >= SIGNUP.PER_ADDRESS_DAY) return 'day';
  if (!local && made.addrHour >= SIGNUP.PER_ADDRESS_HOUR) return 'hour';
  return null;
}

/* seconds a refused person is told to wait (Retry-After): the longest it can take for the count to fall under the cap - an upper bound, not a promise. 'attempts' is the request limit. */
function retryAfter(reason) {
  return reason === 'day' ? SIGNUP.DAY_MS / 1000 : reason === 'attempts' ? SIGNUP.ATTEMPT_MS / 1000 : SIGNUP.HOUR_MS / 1000;
}

/* One at a time: serial() returns run(fn), which starts fn when every earlier fn has settled and gives back fn's own result or error. A signup reads the count of accounts
   and writes its own inside one of these, so a request that reads the table sees every account made before it, and no account is counted twice. (An earlier version held a
   "place" for a request in flight and released it after the write: a request that read the table in between counted the row and the place.) One server process holds the queue; the
   site is one instance (docs/GOALS/G10B_HOME_WORKER.md). A failure of one fn does not stop the next. */
function serial() {
  let tail = Promise.resolve();
  return function run(fn) {
    const p = tail.then(() => fn());
    tail = p.then(() => undefined, () => undefined);
    return p;
  };
}

module.exports = { SIGNUP, LOOPBACK, refusal, retryAfter, serial };
