/**
 * Jest, scoped to the money paths and nothing else.
 *
 * The rest of this repo has no test runner and that convention stands — see
 * `CLAUDE.md`. This exists for the handful of behaviours that cannot be verified
 * by clicking: atomic claims, partial unique indexes, idempotency keys, webhook
 * replay. They are rare, expensive when wrong, and exactly the class manual QA
 * never catches.
 */
module.exports = {
  testEnvironment: "node",
  // Only this folder. `testMatch` rather than `roots` so a stray `*.test.js`
  // elsewhere in the repo is never picked up by accident.
  testMatch: ["<rootDir>/__tests__/money/**/*.test.js"],
  globalSetup: "<rootDir>/__tests__/money/setup/globalSetup.js",
  /**
   * Releases the run lock the setup takes. Without it a finished run would keep
   * the database to itself until the lock's TTL expired.
   */
  globalTeardown: "<rootDir>/__tests__/money/setup/globalTeardown.js",
  // Every test file shares one database on a real cluster, so they must not run
  // concurrently — two files clearing the same collection would fail each other
  // in ways that look like real bugs. `--runInBand` in the npm script does the
  // same thing; this makes it true however jest is invoked.
  maxWorkers: 1,
  /**
   * Network round trips. The default 5s is enough until the cluster is slow, and
   * a timeout there reads as a failing assertion rather than a slow link.
   *
   * ⚠️ This governs **hooks** as well as tests, which is what the 30s it used to
   * be could not cover. A typical `beforeAll` here connects and then calls
   * `createIndexes()` on five models: measured at ~7s against an idle M0 (719ms
   * to connect, 6.3s for the indexes — and that is with every index already
   * present, so it is the cost of *checking* them, not building them). Under a
   * full 44-suite run the same hook competes with everything else on a shared
   * tier and comfortably passed 30s, which failed `verifyClaim.test.js` and all
   * ten of its tests at once while the suite passed alone in 22s.
   *
   * A hook timeout does not read as "the cluster was busy". It reads as ten
   * unrelated tests failing on correct assertions and passing on a re-run — the
   * same false flakiness that CLAUDE.md records sending two earlier debugging
   * sessions in the wrong direction.
   */
  testTimeout: 60000,
  // A leaked mongoose connection would otherwise hang the run with no clue why.
  detectOpenHandles: true,
  forceExit: true,
  verbose: true,
};
