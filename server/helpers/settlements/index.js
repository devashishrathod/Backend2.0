const {
  buildEligibilityFilter,
  claimTransactions,
  claimRefundAdjustments,
  claimChargebackAdjustments,
  claimMaturedReserves,
  brandsWithMaturedReserves,
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
const {
  buildSettlementDocumentSnapshot,
  commissionTaxLines,
} = require("./buildSettlementDocumentSnapshot");
const { issueSettlementDocument } = require("./issueSettlementDocument");
const { computeVendorDebt, brandsWithAgedDebt } = require("./vendorDebt");
const { buildReserveRiskMap, RESERVE_BASIS } = require("./reserveRisk");

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
   * ⚠️ The reserve's way back out. `reserveHeld` was fully wired while
   * `reserveReleased` was a hardcoded `0` — so with the reserve switched on,
   * money went in and never came back. The lock stops the same reserve being
   * handed back every cycle.
   */
  claimMaturedReserves,
  /**
   * ⚠️ And the brands with nothing else to settle. `brandsWithEligibleMoney` is
   * a `distinct` over eligible **transactions**, so a brand that stops trading
   * would never be considered — and their reserve would sit for ever.
   */
  brandsWithMaturedReserves,
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
  /**
   * The vendor payout statement. Rendered on first ask rather than at payout —
   * most are never opened, and the number is allotted at build time either way,
   * so the series has no gaps.
   */
  /**
   * The payout statement, with the commission tax invoice printed inside it.
   * Frozen at PAID — every earlier state can still move.
   */
  buildSettlementDocumentSnapshot,
  issueSettlementDocument,
  commissionTaxLines,
  /**
   * ⚠️ What a brand owes that no cycle can reach.
   *
   * A negative `netPayable` carries forward, and carrying forward releases every
   * claim — which is right while the brand still trades and a silent, endless
   * loop the day they stop. This is the only thing that says so out loud.
   */
  computeVendorDebt,
  brandsWithAgedDebt,
  /**
   * ⚠️ Built **once per run**, not once per brand. Two aggregations grouped by
   * brand, rather than two round trips multiplied by however many brands the
   * night has — which is the number that grows.
   */
  buildReserveRiskMap,
  RESERVE_BASIS,
};
