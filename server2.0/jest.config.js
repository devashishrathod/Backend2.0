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
  // Every test file shares one database on a real cluster, so they must not run
  // concurrently — two files clearing the same collection would fail each other
  // in ways that look like real bugs. `--runInBand` in the npm script does the
  // same thing; this makes it true however jest is invoked.
  maxWorkers: 1,
  // Network round trips. The default 5s is enough until the cluster is slow, and
  // a timeout there reads as a failing assertion rather than a slow link.
  testTimeout: 30000,
  // A leaked mongoose connection would otherwise hang the run with no clue why.
  detectOpenHandles: true,
  forceExit: true,
  verbose: true,
};
