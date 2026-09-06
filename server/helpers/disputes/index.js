const { recordDispute, summariseDisputes } = require("./recordDispute");
const { buildEvidencePack, buildNarrative } = require("./buildEvidencePack");
const { issueChargebackDocument } = require("./issueChargebackDocument");
const {
  buildChargebackDocumentSnapshot,
} = require("./buildChargebackDocumentSnapshot");

module.exports = {
  /**
   * The vendor's chargeback advice, issued the moment a dispute is lost — so
   * they learn about the deduction before the payout it comes out of, rather
   * than from money quietly missing.
   */
  issueChargebackDocument,
  buildChargebackDocumentSnapshot,
  /**
   * Everything we can prove about a disputed payment, assembled from our own
   * records — with the argument already written out.
   *
   * ⚠️ It does not call Razorpay and does not submit anything. A dispute gets
   * **one** response, filed by a person in the dashboard.
   */
  buildEvidencePack,
  buildNarrative,
  /**
   * ⚠️ The only place a dispute event is written. Razorpay redelivers these and
   * sends them out of order, so the event's own timestamp decides — in the
   * update's filter, not in an `if`.
   */
  recordDispute,
  /**
   * The denormalised copy `Transaction` carries for listing. `Dispute` is the
   * record; this is what a worklist filters on without a join.
   */
  summariseDisputes,
};
