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
   * Longer than a full suite, short enough that a run killed with Ctrl+C does not
   * block the next one for an afternoon.
   *
   * ⚠️ This was 15 minutes, against a comment claiming a full suite took about
   * four. It now takes **17.7 minutes** — so the lock was expiring mid-run, and a
   * lock that self-heals while its holder is still working protects nothing at
   * exactly the moment it matters: a second run started at minute sixteen would
   * be waved through to clear collections the first one is still using. That is
   * the failure CLAUDE.md describes as unrelated tests failing on correct
   * assertions, which has already cost two debugging detours.
   *
   * Keep this comfortably above the real runtime. If the suite grows past ~30
   * minutes, raise it again rather than letting it lapse.
   */
  TTL_MS: 45 * 60 * 1000,
});
