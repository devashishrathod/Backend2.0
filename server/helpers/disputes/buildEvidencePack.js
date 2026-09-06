const Dispute = require("../../models/Dispute");
const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const VoucherClaimHistory = require("../../models/VoucherClaimHistory");
const Customer = require("../../models/Customer");
const { throwError } = require("../../utils");
const { CUSTOMER_CURRENCY_DEFAULTS } = require("../../constants/customer");
const { CLAIM_REDEMPTION_MODE } = require("../../constants/voucherClaim");
const { invoiceUrl } = require("../notifications/panelLinks");

const money = (amount) =>
  `${CUSTOMER_CURRENCY_DEFAULTS.currencySymbol}${Number(amount || 0).toLocaleString(
    "en-IN",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  )}`;

const at = (date) =>
  date
    ? new Date(date).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

/** Never put a whole phone number or email in a document that leaves the building. */
const maskContact = (value = "") => {
  const text = String(value || "");
  if (!text) return null;
  if (text.includes("@")) {
    const [name, domain] = text.split("@");
    return `${name.slice(0, 2)}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
  }
  return `${"*".repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`;
};

/**
 * Everything we can prove about a disputed payment, in one place.
 *
 * ### ⚠️ Why this can be built from our own records
 *
 * The obvious worry with a chargeback is that the proof lives at the outlet —
 * the kitchen ticket, the CCTV, somebody's memory. For a *delivery* dispute that
 * is often true. But this platform's claims are **paid at the counter**:
 * `settleVoucherClaimPayment` captures straight to `REDEEMED` because, as its own
 * note says, paying at the counter *is* the redemption.
 *
 * So the payment record is itself evidence of presence: this customer, at this
 * outlet, at this minute, for a bill of this size. That is the strongest thing a
 * card network will read, and we already hold it.
 *
 * What we do **not** hold — the KOT, the camera — is a bonus the outlet can add,
 * and the vendor is asked for it. Filing never waits on them: an admin can send
 * this pack on its own, which matters because a dispute gets **one** response and
 * the deadline is the bank's.
 *
 * ### What this deliberately does not do
 *
 * It does not talk to Razorpay and it does not submit anything. Evidence is filed
 * by a person, in the dashboard, once — see `docs/dispute_flow.md` §5.3.
 *
 * @param {string} disputeId  Razorpay's dispute id, or our row's `_id`
 * @returns {Promise<object>} the pack, with a ready-to-paste `narrative`
 */
exports.buildEvidencePack = async (disputeId) => {
  const dispute = await Dispute.findOne({
    $or: [
      { disputeId },
      ...(String(disputeId).match(/^[0-9a-fA-F]{24}$/) ? [{ _id: disputeId }] : []),
    ],
    isDeleted: false,
  }).lean();

  if (!dispute) throwError(404, "Dispute not found.");

  const transaction = await Transaction.findById(dispute.transactionId).lean();
  if (!transaction) {
    // The dispute exists but its payment does not — a data problem, not an
    // evidence problem, and saying so beats returning an empty pack.
    throwError(
      409,
      "This dispute is not linked to a payment we hold. Check the transaction before filing.",
    );
  }

  const [claim, history, customer] = await Promise.all([
    transaction.voucher?.claimId
      ? VoucherClaim.findById(transaction.voucher.claimId).lean()
      : null,
    VoucherClaimHistory.find({
      ...(transaction.voucher?.claimId
        ? { claimId: transaction.voucher.claimId }
        : { transactionId: transaction._id }),
    })
      .sort({ createdAt: 1 })
      .lean(),
    transaction.customerId
      ? Customer.findById(transaction.customerId)
          .select("email mobile uniqueId createdAt")
          .lean()
      : null,
  ]);

  const outlet = claim?.outletSnapshot || {};
  const brand = claim?.brandSnapshot || {};
  const pricing = claim?.pricing || transaction.voucher || {};

  /**
   * ⚠️ Paid at the counter, so the payment time **is** the presence.
   *
   * Stated explicitly because it is the argument, and an admin under a deadline
   * should not have to reconstruct it from the data every time.
   */
  const paidInPerson =
    claim?.redemptionMode === CLAIM_REDEMPTION_MODE.AUTO ||
    !claim?.redemptionMode;

  const pack = {
    dispute: {
      disputeId: dispute.disputeId,
      status: dispute.status,
      phase: dispute.phase,
      reason: dispute.reasonCode || dispute.reason,
      amount: dispute.amount,
      respondBy: dispute.respondBy,
      openedAt: dispute.openedAt,
      /** How long is left. Negative means the window has already closed. */
      hoursLeft: dispute.respondBy
        ? Math.round(
            (new Date(dispute.respondBy).getTime() - Date.now()) / 3600000,
          )
        : null,
    },

    payment: {
      razorpayPaymentId: transaction.razorpayPaymentId,
      razorpayOrderId: transaction.razorpayOrderId,
      method: transaction.paymentMethod,
      amount: transaction.paidAmount ?? transaction.amount,
      paidAt: transaction.verifiedAt || transaction.paidAt,
      /**
       * That we hold a valid signature is itself evidence: the callback was
       * signed with our account's secret, so the payment reached us through
       * Razorpay rather than being asserted by a client.
       */
      signatureVerified: Boolean(transaction.razorpaySignature),
      invoiceId: transaction.invoiceId,
      invoiceUrl: transaction.invoiceUrl || invoiceUrl(transaction.documentToken),
    },

    customer: {
      // ⚠️ Masked. This document is uploaded to a third party.
      email: maskContact(customer?.email),
      mobile: maskContact(customer?.mobile),
      customerSince: customer?.createdAt,
      reference: customer?.uniqueId,
    },

    where: {
      brand: brand.name || brand.brandName,
      outlet: outlet.name || outlet.outletName,
      address: outlet.address,
      city: outlet.city,
    },

    whatWasBought: {
      claimCode: claim?.claimCode,
      billAmount: claim?.billAmount ?? pricing.billAmount,
      netBill: pricing.netBill,
      offerDiscount: pricing.offerDiscount,
      promoCode: pricing.promoCode,
      convenienceFee: pricing.convenienceFee,
      totalPaid: pricing.totalPayable ?? transaction.paidAmount,
    },

    delivery: {
      paidInPerson,
      redemptionMode: claim?.redemptionMode,
      redeemedAt: claim?.redeemedAt,
      claimStatus: claim?.status,
    },

    timeline: history.map((row) => ({
      at: row.createdAt,
      action: row.action,
      by: row.performedByRole,
      from: row.fromStatus,
      to: row.toStatus,
      reason: row.reason,
    })),

    /** Filled in by the vendor, when they have something to add. See §3 below. */
    vendorNotes: dispute.vendorEvidenceNote
      ? {
          note: dispute.vendorEvidenceNote,
          at: dispute.vendorEvidenceAt,
        }
      : null,
  };

  pack.narrative = buildNarrative(pack);
  return pack;
};

/**
 * The same facts as a paragraph somebody can paste into Razorpay.
 *
 * ⚠️ Written out rather than left to the admin, because this is filed **once**,
 * against a deadline, and the difference between a won dispute and a lost one is
 * usually whether anybody had time to write the argument down properly.
 */
const buildNarrative = (pack) => {
  const lines = [];

  lines.push(
    `This payment was made in person at ${pack.where.outlet || pack.where.brand || "the merchant's outlet"}` +
      `${pack.where.city ? `, ${pack.where.city}` : ""}.`,
  );

  /**
   * ⚠️ Unconditional. This sentence used to be gated on `paidAt`, and with it
   * the **payment id** — the one reference the reviewer at the bank matches the
   * case against, and the first thing an admin pastes into the dashboard. A
   * transaction that predates `verifiedAt`, or one captured straight from a
   * webhook that carried no timestamp, produced a narrative with no id in it at
   * all. The date is the optional part, not the identifier.
   */
  lines.push(
    `The customer paid ${money(pack.payment.amount)}` +
      `${pack.payment.paidAt ? ` on ${at(pack.payment.paidAt)}` : ""} ` +
      `(Razorpay payment ${pack.payment.razorpayPaymentId}${
        pack.payment.method ? `, ${pack.payment.method}` : ""
      }).`,
  );

  if (pack.delivery.paidInPerson) {
    lines.push(
      `On this platform a voucher is paid for at the counter — the payment is the ` +
        `redemption, so the transaction itself places the customer at the outlet at ` +
        `that time.`,
    );
  }

  if (pack.whatWasBought.claimCode) {
    lines.push(
      `The claim reference is ${pack.whatWasBought.claimCode}, against a bill of ` +
        `${money(pack.whatWasBought.billAmount)}` +
        `${pack.whatWasBought.offerDiscount ? ` with a ${money(pack.whatWasBought.offerDiscount)} offer applied` : ""}.`,
    );
  }

  if (pack.payment.signatureVerified) {
    lines.push(
      `The payment callback carried a valid Razorpay signature for our merchant ` +
        `account, so it was received through Razorpay and not asserted by the client.`,
    );
  }

  if (pack.payment.invoiceUrl) {
    lines.push(`A receipt was issued and is available at ${pack.payment.invoiceUrl}.`);
  }

  if (pack.customer.customerSince) {
    lines.push(
      `The customer's account was created on ${at(pack.customer.customerSince)}, ` +
        `before this transaction.`,
    );
  }

  if (pack.vendorNotes?.note) {
    lines.push(`From the outlet: ${pack.vendorNotes.note}`);
  }

  return lines.join(" ");
};

exports.buildNarrative = buildNarrative;
