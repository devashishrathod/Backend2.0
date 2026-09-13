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
   * ### Raised three times, and what each raise was actually measuring
   *
   * | | Trigger | TTL |
   * |---|---|---|
   * | 1 | a run measured 17.7 min against a 15 min TTL | 45 |
   * | 2 | 32.6 min across 55 suites | 90 |
   * | 3 | **71.6 min across 76 suites** | **180** |
   *
   * ⚠️ It is not the average that matters, it is the slowest run — and the third
   * raise is the one that shows why. Two runs of the **same** suite, back to
   * back on this machine, measured 34.9 and 71.6 minutes. That is not noise, it
   * is **contention**: anything else touching the cluster while the suite runs
   * roughly doubles it, and a laptop running the suite is a laptop somebody is
   * also working on.
   *
   * So the figure to set this against is the busy run, not the quiet one. At 90
   * minutes the 71.6 run had eighteen minutes left before it would have outlived
   * its own lock — which is the precise failure this exists to prevent, and it
   * does not announce itself: it reads as a scatter of unrelated tests failing
   * on assertions that are individually correct.
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
  TTL_MS: 180 * 60 * 1000,
});
