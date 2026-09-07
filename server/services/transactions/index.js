const { previewSubscribeOrder } = require("./previewSubscribeOrder");
const { createSubscribeOrder } = require("./createSubscribeOrder");
const { verifySubscribeTransaction } = require("./verifySubscribeTransaction");
const { regenerateInvoice } = require("./regenerateInvoice");
const { handleRazorpayWebhook } = require("./handleRazorpayWebhook");
const { resolveSettler, SETTLER_PURPOSES } = require("./webhookSettlers");
const { resumeIncompleteSettlements } = require("./settlementJobs");
const { replayWebhookEvent } = require("./replayWebhookEvent");
const {
  getWebhookEvents,
  getWebhookEvent,
} = require("./getWebhookEvents");
const { getPaymentHealth } = require("./getPaymentHealth");
const { disputeDeadlines } = require("./disputeJobs");
const { reapShadowIndexesJob } = require("./indexJobs");
const { getDisputes, getDispute } = require("./getDisputes");
const {
  addVendorDisputeEvidence,
  getDisputeEvidencePack,
} = require("./disputeEvidence");

const {
  releaseTransactionHold,
} = require("./releaseTransactionHold");

module.exports = {
  // The one explicit way a settlementHold ever comes off outside the
  // refund-decision paths. See the service for why it has to exist.
  releaseTransactionHold,
  previewSubscribeOrder,
  createSubscribeOrder,
  verifySubscribeTransaction,
  regenerateInvoice,
  handleRazorpayWebhook,
  resolveSettler,
  SETTLER_PURPOSES,
  /**
   * The repair path for a settlement that was claimed and then abandoned.
   * Dispatches every money flow through the registry above, so it belongs
   * beside it rather than inside either flow.
   */
  resumeIncompleteSettlements,
  replayWebhookEvent,
  getWebhookEvents,
  getWebhookEvent,
  getDisputes,
  getDispute,
  // What only the outlet has, and everything we can prove, respectively.
  addVendorDisputeEvidence,
  getDisputeEvidencePack,
  // Jobs, stuck money and index guarantees in one answer.
  getPaymentHealth,
  disputeDeadlines,
  /**
   * ⚠️ A blanket unique index that an older build of this service keeps
   * recreating. While it is there, every second voucher claim fails — see the
   * job for why this is hourly and not only a boot check.
   */
  reapShadowIndexesJob,
};
