const { generateClaimCode, randomClaimCode } = require("./generateClaimCode");
const { recordClaimHistory, roleToPerformer } = require("./recordClaimHistory");
const {
  settleVoucherClaimPayment,
} = require("./settleVoucherClaimPayment");
const {
  buildVoucherInvoiceSnapshot,
} = require("./buildVoucherInvoiceSnapshot");
const { buildClaimTimeline } = require("./buildClaimTimeline");
const {
  buildOutletSection,
  buildVoucherSection,
  buildPricingSection,
  buildPaymentInfoSection,
  buildSettlementSection,
} = require("./buildClaimDetailSections");

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
  /**
   * The sections a claim payment is read in — outlet, voucher, pricing, payment
   * and the **vendor payout** it ended up in.
   *
   * Each decides its own audience once, in one file, rather than at the two
   * detail services that both assemble them. `buildSettlementSection` is the
   * one to be careful with: it reports Trydood paying the vendor, never
   * Razorpay paying Trydood.
   */
  buildOutletSection,
  buildVoucherSection,
  buildPricingSection,
  buildPaymentInfoSection,
  buildSettlementSection,
};
