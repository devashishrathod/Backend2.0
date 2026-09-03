const {
  buildSettlements,
  computeTotals,
  freezeBankSnapshot,
} = require("./buildSettlements");
const {
  approveSettlement,
  rebuildSettlement,
  cancelSettlement,
  abandonSettlement,
  holdSettlement,
} = require("./approveSettlement");
const {
  startPayout,
  confirmPayout,
  failPayout,
  retryPayout,
  reversePayout,
} = require("./paySettlement");
const {
  getSettlements,
  getSettlementDetail,
  getSettlementTransactions,
} = require("./getSettlements");
const {
  sweepStalePayouts,
  sweepStrandedClaims,
  alertLateSettlements,
  reconcileSettlementLedger,
  sweepAbandonedDrafts,
} = require("./settlementJobs");

module.exports = {
  /**
   * One day, one settlement per brand. Claim first, total second — selecting and
   * then writing leaves a window in which a refund lands and the same money
   * moves twice.
   */
  buildSettlements,
  computeTotals,
  freezeBankSnapshot,
  /**
   * ⚠️ Approval is the last point at which exclusion is free, and the flag is
   * enforced **in the update filter** — a read-then-write check leaves the same
   * window it is trying to close.
   */
  approveSettlement,
  rebuildSettlement,
  cancelSettlement,
  /**
   * The exit for a payout that will never work. `FAILED → ABANDONED` is the only
   * way a failed settlement releases its rows, and nothing called it.
   */
  abandonSettlement,
  holdSettlement,
  /**
   * ⚠️ `APPROVED → PROCESSING` compares the live bank account against the one
   * that was approved. A vendor changing it mid-cycle usually means the old
   * account is closed, and NEFT has no recall.
   */
  startPayout,
  confirmPayout,
  failPayout,
  retryPayout,
  /**
   * ⚠️ Ledger first, rows second. A crash between them leaves an over-stated
   * reversal — visible and correctable — rather than money that is both paid and
   * claimable.
   */
  reversePayout,
  // One endpoint, two shapes.
  getSettlements,
  getSettlementDetail,
  getSettlementTransactions,
  /**
   * The sweeps. A settlement is the one money path here that fails by *not*
   * happening, so each of these looks for an absence rather than an error.
   */
  sweepStalePayouts,
  sweepStrandedClaims,
  alertLateSettlements,
  reconcileSettlementLedger,
  sweepAbandonedDrafts,
};
