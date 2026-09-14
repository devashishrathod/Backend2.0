/**
 * Fast unit tests — no database, no network, no lock.
 *
 * Deliberately a **second** config rather than another folder inside
 * `jest.config.js`. That suite runs against a real cluster on a shared test
 * database, takes a run lock for the whole run, and measures over half an hour;
 * everything about it is shaped by needing a live Mongo. Pure functions have
 * none of those needs and should not wait behind them, or make somebody think
 * twice before running the tests.
 *
 * What belongs here: logic that is a security boundary or is expensive to get
 * wrong, and that takes plain arguments — upload key scoping, magic-byte
 * sniffing, storage provider routing, temp file cleanup. What does not: anything
 * that needs a model, a session or a transaction. That is `__tests__/money/`.
 *
 *   npm run test:unit
 *
 * `npm test` is untouched and still means the money suite.
 */
module.exports = {
  testEnvironment: "node",
  // Explicit, so a stray `*.test.js` anywhere else is never picked up, and so
  // the two configs can never claim the same file.
  testMatch: ["<rootDir>/__tests__/unit/**/*.test.js"],
  // No globalSetup, no globalTeardown, no run lock: nothing here touches a
  // database, so there is nothing to reserve and nothing to clear.
  testTimeout: 5000,
  verbose: true,
};
