const crypto = require("crypto");
const Dispute = require("../../models/Dispute");
const Brand = require("../../models/Brand");
const VoucherClaim = require("../../models/VoucherClaim");
const { DOCUMENT_KIND, DOCUMENT_SERIES } = require("../../constants/document");
const { getSubscriptionConfig } = require("../settings");
const { buildBillingDetails } = require("../subscribeds");
const { generateDocumentNumber, alertDocumentFailed } = require("../documents");
const { ADMIN_PATHS } = require("../notifications");
const {
  buildChargebackDocumentSnapshot,
} = require("./buildChargebackDocumentSnapshot");

/**
 * Issue the vendor's chargeback advice.
 *
 * ### ⚠️ Called when a dispute becomes `LOST`, and only then
 *
 * `OPEN` and `UNDER_REVIEW` can still go either way, and a document saying money
 * is being recovered would be wrong for every dispute we go on to win. `WON`
 * needs no document — nothing is taken.
 *
 * Issued at the loss rather than at the recovery so the vendor hears about the
 * deduction *before* it happens. The recovery lands one or more payout cycles
 * later, and the settlement statement then names this advice, which is what lets
 * a deduction be traced back to the sale it came from.
 *
 * ### Idempotent, because Razorpay redelivers dispute webhooks out of order
 *
 * A second `dispute.lost` for the same dispute must not burn another number out
 * of a GST-facing sequence. The `$exists: false` guard settles that; the unique
 * partial index on `documentNumber` is the backstop.
 *
 * ### Never throws
 *
 * The loss is already booked to the ledger and the recovery is already queued.
 * A document that could not be built is a re-issue problem; it must not fail the
 * webhook, because a failed webhook is one Razorpay stops retrying.
 *
 * @param {object} args
 * @param {object} args.dispute      the dispute row, already LOST
 * @param {object} args.transaction  the disputed payment
 * @returns {Promise<object|null>} the refreshed dispute, or null if nothing was issued
 */
exports.issueChargebackDocument = async ({ dispute, transaction }) => {
  if (!dispute?._id) return null;
  // Already issued — a redelivery, or a late event replaying the same loss.
  if (dispute.documentNumber) return null;

  try {
    const [brand, claim, seller] = await Promise.all([
      Brand.findById(dispute.brandId || transaction?.brandId),
      // Best-effort: a subscription payment has no claim, and the advice reads
      // fine without one.
      transaction?.voucherClaimId
        ? VoucherClaim.findById(transaction.voucherClaimId).lean()
        : VoucherClaim.findOne({ transactionId: transaction?._id }).lean(),
      getSubscriptionConfig(),
    ]);

    const billing = brand ? await buildBillingDetails(brand) : {};

    const documentNumber = await generateDocumentNumber({
      series: DOCUMENT_SERIES[DOCUMENT_KIND.CHARGEBACK],
    });

    const documentSnapshot = buildChargebackDocumentSnapshot({
      dispute,
      transaction: transaction || {},
      claim,
      brand: brand || {},
      billing,
      seller,
      documentNumber,
    });

    // Conditional on the number still being absent, so two racing redeliveries
    // cannot both allot one.
    return await Dispute.findOneAndUpdate(
      { _id: dispute._id, documentNumber: { $exists: false } },
      {
        $set: {
          documentNumber,
          documentSnapshot,
          documentToken: crypto.randomBytes(32).toString("hex"),
        },
      },
      { returnDocument: "after" },
    ).lean();
  } catch (error) {
    /**
     * The loss is booked and the recovery is queued, so this must not throw at a
     * webhook Razorpay will stop retrying — but it must not be silent either.
     *
     * A chargeback advice is what tells the vendor why money was taken back off
     * them. Without it the debit appears on their settlement with nothing
     * explaining it, and there is no re-issue endpoint to produce one.
     */
    await alertDocumentFailed({
      source: "issueChargebackDocument",
      title: "A chargeback advice could not be issued",
      body:
        `The loss is booked and the recovery is queued, but the advice could not ` +
        `be written. The vendor will see the debit on their settlement with no ` +
        `document explaining where it came from.`,
      recordId: dispute._id,
      path: ADMIN_PATHS.dispute(dispute._id),
      lines: [
        ["Dispute", dispute.disputeId || String(dispute._id)],
        ["Amount", String(dispute.amount ?? "-")],
      ],
      footnote:
        "The ledger is correct and the recovery is unaffected — only the advice is missing. Re-issuing it is a manual step.",
      error,
    });
    return null;
  }
};
