/* The signup limiter's own rules, apart from the server (G13-5; docs/GOALS/G13_PRODUCTIZATION.md TD26): the numbers, what a count of recent accounts allows, and the
   places held by requests that have passed the check and not yet written their account. server.js does the HTTP, the keyed address tag and the store. */
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

/* why an account may not be made now, or null. made = { siteHour, addrHour, addrDay } as the table says; before = { site, tag }: the places held at this moment by
   other requests of the whole site and of this address (they have passed the same check and have not written yet, so each counts as one more account);
   local: the address is the machine itself, which is not limited per address (the site's cap is the site's). */
function refusal(made, before, local) {
  if (made.siteHour + before.site >= SIGNUP.SITE_HOUR) return 'site';
  if (!local && (made.addrHour + before.tag >= SIGNUP.PER_ADDRESS_HOUR || made.addrDay + before.tag >= SIGNUP.PER_ADDRESS_DAY)) return 'address';
  return null;
}

/* The places held. take(tag) is called BEFORE the table is read (so two requests of the same moment cannot both see an empty table); it returns the places held by
   others at that moment ({ site, tag }) and a release() to call when the request is over, whatever it ended with. A release is idempotent. */
function inflight() {
  let site = 0;
  const byTag = new Map();
  return {
    take(tag) {
      const held = byTag.get(tag) || 0;
      const before = { site: site, tag: held };
      site++; byTag.set(tag, held + 1);
      let done = false;
      return {
        before: before,
        release() {
          if (done) return;
          done = true;
          site--;
          const left = (byTag.get(tag) || 1) - 1;
          if (left > 0) byTag.set(tag, left); else byTag.delete(tag);
        }
      };
    },
    held() { return { site: site, tags: byTag.size }; }
  };
}

module.exports = { SIGNUP, LOOPBACK, refusal, inflight };
