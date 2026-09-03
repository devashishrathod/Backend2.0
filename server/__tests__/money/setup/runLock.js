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
   * four — so the lock was expiring mid-run, and a lock that self-heals while its
   * holder is still working protects nothing at exactly the moment it matters: a
   * second run started at minute sixteen would be waved through to clear
   * collections the first one is still using. That is the failure CLAUDE.md
   * describes as unrelated tests failing on correct assertions, which has already
   * cost two debugging detours.
   *
   * ### Raised twice now, and the second time is why the margin is this wide
   *
   * 15 → 45 when a run measured 17.7 minutes. 45 → 90 now, because a full run is
   * **32.6 minutes** across 55 suites — past the ~30 minute mark the previous
   * note set as the trigger.
   *
   * ⚠️ It is not the average that matters, it is the slowest run. Two runs of the
   * same suite on the same machine measured 24.8 and 32.6 minutes: an eight
   * minute spread, on a value that only has to be exceeded **once** to reproduce
   * the bug. 45 minutes left twelve minutes of headroom against that spread,
   * which is not headroom.
   *
   * ⚠️ A too-long TTL costs only a wait after a killed run — `--clear` is right
   * there. A too-short one costs a debugging session, twice already. The two
   * mistakes are not the same size, so this is deliberately generous rather than
   * tight: keep it at roughly **3× the slowest observed run**.
   *
   * ```bash
   * node scripts/testRunLock.js           # who holds it
   * node scripts/testRunLock.js --clear   # take it back
   * ```
   */
  TTL_MS: 90 * 60 * 1000,
});
