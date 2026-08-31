const { generateClaimCode, randomClaimCode } = require("./generateClaimCode");
const { recordClaimHistory, roleToPerformer } = require("./recordClaimHistory");
const {
  settleVoucherClaimPayment,
} = require("./settleVoucherClaimPayment");
const {
  buildVoucherInvoiceSnapshot,
} = require("./buildVoucherInvoiceSnapshot");
const { buildClaimTimeline } = require("./buildClaimTimeline");

module.exports = {
  generateClaimCode,
  randomClaimCode,
  // Append-only, and failure-tolerant: a lost audit row never rolls back a
  // paid claim.
  recordClaimHistory,
  roleToPerformer,
  // The single settlement path, shared by verify and the webhook. Idempotent at
  // every step so `resumeIncompleteSettlements` can simply run it again.
  settleVoucherClaimPayment,
  // Frozen at issue. The renderer performs no lookups at all.
  buildVoucherInvoiceSnapshot,
  // Built per audience rather than filtered — the raw audit row carries a
  // free-form snapshot that would leak our margin onto a vendor's page.
  buildClaimTimeline,
};
