const { calculateRefundSplit, round2 } = require("./calculateRefundSplit");
const {
  assertRefundAllowance,
  COUNTS_AGAINST_ALLOWANCE,
} = require("./assertRefundAllowance");
const { releaseSettlementHold } = require("./releaseSettlementHold");
const { applyRefundCompletion } = require("./applyRefundCompletion");
const { issueRefundDocument } = require("./issueRefundDocument");
const {
  buildRefundDocumentSnapshot,
  REFUND_REASON_TEXT,
  REFUND_METHOD_TEXT,
} = require("./buildRefundDocumentSnapshot");
const {
  buildRefundListFilter,
  refundProjection,
  presentRefund,
} = require("./buildRefundReadPipeline");

module.exports = {
  // The one place that decides whose pocket a refund comes out of. Reads the
  // claim's frozen pricing, never the transaction's denormalised copy — that
  // copy cannot tell a fee promo from a net-bill promo.
  calculateRefundSplit,
  round2,
  // Counts refused requests, never approved ones — a customer with five good
  // refunds had five bad experiences.
  assertRefundAllowance,
  COUNTS_AGAINST_ALLOWANCE,
  /**
   * ⚠️ Must be called from every terminal state where no money moves. A hold
   * nobody releases keeps a vendor's money out of every future settlement, for
   * ever, and silently — the eligibility predicate just stops matching.
   */
  releaseSettlementHold,
  /**
   * Everything that changes when a refund lands, in one idempotent call. The
   * conditional claim on the request's status is what makes a redelivered
   * webhook a no-op.
   */
  applyRefundCompletion,
  /**
   * The customer's refund document — a REFUND RECEIPT today, a CREDIT NOTE the
   * day customer GST is switched on, decided from what the original actually
   * charged. Issued at completion only, so a failed refund cannot burn a number
   * out of a document-of-record series.
   */
  issueRefundDocument,
  buildRefundDocumentSnapshot,
  REFUND_REASON_TEXT,
  REFUND_METHOD_TEXT,
  // One projection per audience, decided once. `split` carries our promo share
  // and the MDR we swallow on the same sub-document the vendor legitimately
  // needs — which is exactly why this is not remembered at each call site.
  buildRefundListFilter,
  refundProjection,
  presentRefund,
};
