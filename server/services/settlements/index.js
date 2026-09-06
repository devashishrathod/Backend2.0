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
  alertVendorDebt,
} = require("./settlementJobs");
const {
  writeOffVendorDebt,
  getVendorDebt,
} = require("./writeOffVendorDebt");

module.exports = {
  /**
   * One day, one settlement per brand. Claim first, total second â selecting and
   * then writing leaves a window in which a refund lands and the same money
   * moves twice.
   */
  buildSettlements,
  computeTotals,
  freezeBankSnapshot,
  /**
   * â ï¸ Approval is the last point at which exclusion is free, and the flag is
   * enforced **in the update filter** â a read-then-write check leaves the same
   * window it is trying to close.
   */
  approveSettlement,
  rebuildSettlement,
  cancelSettlement,
  /**
   * The exit for a payout that will never work. `FAILED â ABANDONED` is the only
   * way a failed settlement releases its rows, and nothing called it.
   */
  abandonSettlement,
  holdSettlement,
  /**
   * â ï¸ `APPROVED â PROCESSING` compares the live bank account against the one
   * that was approved. A vendor changing it mid-cycle usually means the old
   * account is closed, and NEFT has no recall.
   */
  startPayout,
  confirmPayout,
  failPayout,
  retryPayout,
  /**
   * â ï¸ Ledger first, rows second. A crash between them leaves an over-stated
   * reversal â visible and correctable â rather than money that is both paid and
   * claimable.
   */
  reversePayout,
  // One endpoint, two shapes.
  getSettlements,
  getSettlementDetail,
  getSettlementTransactions,
  /**
   * Public, token-addressed and unauthenticated — a vendor opening this from a
   * notification has no session in that browser, and a Download button that
   * needs a login is a Download button that does not work. Only a `PAID`
   * settlement has one: every earlier state can still move.
   */
  /**
   * The sweeps. A settlement is the one money path here that fails by *not*
   * happening, so each of these looks for an absence rather than an error.
   */
  sweepStalePayouts,
  sweepStrandedClaims,
  alertLateSettlements,
  reconcileSettlementLedger,
  sweepAbandonedDrafts,
  /**
   * ⚠️ The same family, one level up: a debt that no cycle can ever reach,
   * because every cycle claims it, nets negative and releases it again. Nothing
   * errors and no report shows it — this is the only thing that ever says so.
   */
  alertVendorDebt,
  /**
   * The deliberate act the sweep never takes. Writing a debt off is an
   * accounting decision with a person's name on it, and doing it automatically
   * would forgive a brand that is merely between seasons.
   */
  writeOffVendorDebt,
  getVendorDebt,
};
