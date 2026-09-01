/**
 * The run lock's identity, in one place.
 *
 * ⚠️ Setup and teardown are loaded by jest in **separate module registries**, so
 * they cannot share state — only constants. An earlier version hung `LOCK_ID`
 * off `globalSetup`'s exported function and read it back in the teardown; it
 * came through as `undefined`, the release filtered on `{_id: undefined}`,
 * matched nothing, and the lock stayed held while the teardown reported success.
 *
 * A plain module both sides require has no such failure mode.
 */
module.exports = Object.freeze({
  LOCK_ID: "money-test-run",
  COLLECTION: "testrunlocks",
  /**
   * Comfortably longer than a full suite (~4 minutes today), short enough that a
   * run killed with Ctrl+C does not block the next one for an afternoon.
   */
  TTL_MS: 15 * 60 * 1000,
});
