const crypto = require("crypto");
const Dispute = require("../../models/Dispute");
const Brand = require("../../models/Brand");
const VoucherClaim = require("../../models/VoucherClaim");
const { DOCUMENT_KIND, DOCUMENT_SERIES } = require("../../constants/document");
const { getSubscriptionConfig } = require("../settings");
const { buildBillingDetails } = require("../subscribeds");
const { generateDocumentNumber } = require("../documents");
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
    // The loss is booked and the recovery is queued. A missing advice is a
    // re-issue problem, not a reason to fail a webhook Razorpay will stop
    // retrying.
    console.error(
      `[issueChargebackDocument] could not issue an advice for dispute ${dispute.disputeId}:`,
      error?.message,
    );
    return null;
  }
};
