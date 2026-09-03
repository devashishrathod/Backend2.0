const {
  buildEligibilityFilter,
  claimTransactions,
  claimRefundAdjustments,
  claimChargebackAdjustments,
  releaseSettlementClaims,
  countClaimedRows,
} = require("./settlementClaims");
const { transitionSettlement } = require("./transitionSettlement");
const {
  taintSettlement,
  describeTaintedRows,
} = require("./taintSettlement");
const {
  buildSettlementListFilter,
  settlementProjection,
  presentSettlement,
  scopeFor,
} = require("./buildSettlementReadPipeline");

module.exports = {
  buildEligibilityFilter,
  /**
   * Claim first, total second. Selecting and then writing leaves a window in
   * which a refund lands and the same money moves twice.
   */
  claimTransactions,
  claimRefundAdjustments,
  claimChargebackAdjustments,
  /**
   * ⚠️ The only exit from a non-PAID terminal state. The claim lock points one
   * way, so a settlement that leaves the happy path without releasing makes its
   * rows invisible to every future cycle — silently.
   */
  releaseSettlementClaims,
  countClaimedRows,
  /**
   * ⚠️ The only place a settlement's status changes. Release, the ledger
   * reversal and the history row are part of the transition, not something a
   * caller does afterwards.
   */
  transitionSettlement,
  /**
   * ⚠️ `settlementHold` is only a pre-claim filter. Once a transaction carries a
   * `settlementId`, a hold set afterwards changes nothing about that settlement
   * — so a risk event flags it instead, and approval is where the flag bites.
   */
  taintSettlement,
  describeTaintedRows,
  /**
   * A settlement covers a brand's whole day across every outlet, so the scope
   * here is brand-level -- deliberately not `buildAccessScopeFilter`, which
   * narrows a SUB_VENDOR to their own counter and would show an outlet manager
   * a figure that adds up to nothing they can see.
   */
  buildSettlementListFilter,
  settlementProjection,
  presentSettlement,
  scopeFor,
};
