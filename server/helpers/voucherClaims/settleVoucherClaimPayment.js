const crypto = require("crypto");
const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const VoucherUsage = require("../../models/VoucherUsage");

const { throwError } = require("../../utils");
const { commitPromoCode, releasePromoCode } = require("../promoCodes");
const { postCaptureEntries } = require("../ledger");
const { detectDoubleCapture } = require("../transactions");
const {
  notifyAdmins,
  notifyClaimPaid,
  notifyVendorClaimReceived,
  notifyClaimFailed,
  ADMIN_PATHS,
  adminUrl,
  deepLink,
} = require("../notifications");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const { SETTLEMENT_STAGE } = require("../../constants/transaction");
const {
  VOUCHER_CLAIM_STATUS,
  CLAIM_HISTORY_ACTION,
  CLAIM_REDEMPTION_MODE,
} = require("../../constants/voucherClaim");
const { recordClaimHistory } = require("./recordClaimHistory");
const {
  buildVoucherInvoiceSnapshot,
} = require("./buildVoucherInvoiceSnapshot");
const { generateInvoiceNumber } = require("../transactions");
const { getCustomerConfig, getSubscriptionConfig } = require("../settings");
const {
  INVOICE_SERIES,
  TRANSACTION_PURPOSE,
} = require("../../constants/transaction");

const DUPLICATE_KEY = 11000;

/** Map a Razorpay payment payload onto our Transaction fields. */
const mapPayment = (payment, expectedTotal) => ({
  entity: payment.entity,
  description: payment.description,
  status: payment.status,
  paidAmount: (payment.amount ?? 0) / 100,
  dueAmount: Math.max(0, expectedTotal - (payment.amount ?? 0) / 100),
  amountRefunded: (payment.amount_refunded ?? 0) / 100,
  refundStatus: payment.refund_status,
  isInternational: payment.international,
  paymentMethod: payment.method,
  walletProvider: payment.wallet,
  /**
   * Razorpay's MDR and the GST on it — the money that used to disappear.
   *
   * `payment.fee` is the **total** charged and already contains `payment.tax`;
   * they are not two fees to add up. Summing them would overstate the deduction
   * and make every reconciliation short.
   */
  fee: (payment.fee ?? 0) / 100,
  tax: (payment.tax ?? 0) / 100,
  gatewayFee: (payment.fee ?? 0) / 100,
  // What actually reached the bank, as opposed to what the customer paid.
  netReceived:
    ((payment.amount ?? 0) - (payment.fee ?? 0)) / 100,
  cardId: payment.card_id,
  bank: payment.bank,
  vpa: payment.vpa,
  notes: payment.notes,
  errorCode: payment.error_code,
  errorDescription: payment.error_description,
  errorReason: payment.error_reason,
  acquirerData: payment.acquirer_data,
  updatedAtRaw: payment.created_at,
});

/**
 * Turn a captured Razorpay payment into a redeemed voucher claim.
 *
 * The single settlement path, shared by the browser-driven verify endpoint and
 * the webhook. Both arrive with the same thing — a captured payment — and both
 * race each other on every single payment, because the browser callback and the
 * webhook fire at the same moment.
 *
 * ### The conditional claim, and why the stages exist
 *
 * `findOneAndUpdate({ verified: false })` is what makes that race safe: exactly
 * one caller proceeds and the other is told `alreadySettled`.
 *
 * But that claim is **terminal** — nothing can re-enter through it — and five
 * dependent writes follow it. A process that dies in between (a deploy, an OOM,
 * a Mongo blip) leaves a transaction marked `verified: true` with the work half
 * done, and no path back in: verify returns `alreadyVerified`, the webhook retry
 * returns `alreadySettled`, a replay does the same. Money captured, claim still
 * `PENDING`, vendor never credited, and nothing anywhere says so.
 *
 * Mongo multi-document transactions are used nowhere in this codebase and
 * introducing them here would be a large change. Instead every step is
 * **idempotent**, and `settlementStage` records how far it got:
 *
 * ```
 * CLAIMED   → the conditional claim landed
 * RECORDED  → claim redeemed, usage written, promo committed, ledger posted
 * INVOICED  → invoice number issued
 * COMPLETE  → notifications sent
 * ```
 *
 * `resumeIncompleteSettlements` finds anything `verified: true` and not
 * `COMPLETE`, and calls this again with `resume: true`. Because every step is
 * idempotent, **resume does not need to know where it stopped** — it runs
 * everything again and the finished parts are no-ops.
 *
 * @param {object}  args
 * @param {object}  args.transaction  the Transaction being settled
 * @param {object}  args.payment      the Razorpay payment payload
 * @param {object}  [args.actor]      whoever triggered it; a webhook has nobody
 * @param {boolean} [args.resume]     skip the conditional claim and redo the rest
 */
exports.settleVoucherClaimPayment = async ({
  transaction,
  payment,
  actor = {},
  resume = false,
}) => {
  if (!transaction) throwError(404, "Transaction not found.");

  const claim = await VoucherClaim.findOne({ transactionId: transaction._id });
  if (!claim) {
    // A claim transaction with no claim is a broken write, not a business case.
    throwError(500, "This payment has no voucher claim attached to it.");
  }

  // ---------------- not captured ----------------
  if (!resume && !payment?.captured) {
    // Nothing was taken, so let the promo hold and the usage slot go.
    await releasePromoCode({
      transactionId: transaction._id,
      reason: `Payment not captured (${payment?.status || "unknown"})`,
    });
    await VoucherClaim.updateOne(
      { _id: claim._id, status: VOUCHER_CLAIM_STATUS.PENDING },
      {
        $set: {
          status: VOUCHER_CLAIM_STATUS.FAILED,
          holdsUsageSlot: false,
        },
      },
    );
    await recordClaimHistory({
      claimId: claim._id,
      customerId: claim.customerId,
      brandId: claim.brandId,
      transactionId: transaction._id,
      action: CLAIM_HISTORY_ACTION.PAYMENT_FAILED,
      toStatus: VOUCHER_CLAIM_STATUS.FAILED,
      reason: payment?.error_description || payment?.error_reason,
    });
    // Nothing was charged, and the customer should hear that from us rather
    // than work it out from a missing receipt.
    await notifyClaimFailed({
      claim,
      reason: payment?.error_description || payment?.error_reason,
    });
    throwError(
      402,
      payment?.error_description ||
        payment?.error_reason ||
        `Payment was not captured (status: ${payment?.status || "unknown"}). Please try again.`,
    );
  }

  // ---------------- stage 0: claim the transaction ----------------
  let claimed;
  if (resume) {
    // The claim already happened; a resume must not try to take it again or it
    // would find `verified: true` and conclude someone else won.
    claimed = await Transaction.findById(transaction._id);
  } else {
    claimed = await Transaction.findOneAndUpdate(
      { _id: transaction._id, verified: false },
      {
        $set: {
          ...mapPayment(payment, transaction.amount),
          razorpayPaymentId: payment.id,
          verified: true,
          verifiedAt: new Date(),
          settlementStage: SETTLEMENT_STAGE.CLAIMED,
        },
      },
      { returnDocument: "after" },
    );

    if (!claimed) {
      const settled = await Transaction.findById(transaction._id);

      // "Someone else settled it" is not always the same payment. Razorpay
      // allows more than one attempt on an order, so this can be a genuinely
      // SECOND capture — money taken twice, with the conditional claim quietly
      // dropping it. That has to reach a human.
      await detectDoubleCapture({
        transaction: settled || transaction,
        payment,
      });

      return {
        alreadySettled: true,
        transaction: settled,
        claim,
      };
    }
  }

  const pricing = claim.pricing;

  // ---------------- stage 1: the domain records ----------------
  //
  // Four writes, each idempotent on its own, so a resume can run them all again.

  /**
   * The redemption ledger row.
   *
   * ⚠️ A duplicate key here is **not** a failure. The stale-claim sweep can
   * cancel a PENDING claim and release its slot, and the payment can capture
   * afterwards — by which time another claim may hold that once-per-user slot.
   * The money has already been taken, so refusing to settle would leave a
   * customer charged with nothing to show for it.
   *
   * So the usage is written without the slot instead, flagged, and an admin is
   * told. It is a business conflict, not a technical failure.
   */
  let usageConflict = false;
  const existingUsage = await VoucherUsage.findOne({ voucherClaimId: claim._id });
  if (!existingUsage) {
    const usageDoc = {
      voucherId: claim.voucherId,
      voucherVersionId: claim.voucherVersionId,
      versionNumber: claim.versionNumber,
      offerId: claim.offerId,
      customerId: claim.customerId,
      brandId: claim.brandId,
      subBrandId: claim.subBrandId,
      voucherClaimId: claim._id,
      transactionId: claimed._id,
      billAmount: pricing.billAmount,
      paidAmount: pricing.totalPayable,
      discountAmount: pricing.offerDiscount,
      isOncePerUser: claim.isOncePerUser,
      isReversed: false,
      usedAt: claimed.verifiedAt || new Date(),
    };

    try {
      await VoucherUsage.create(usageDoc);
    } catch (error) {
      if (error?.code !== DUPLICATE_KEY) throw error;

      usageConflict = true;
      await VoucherUsage.create({
        ...usageDoc,
        // Out of the once-per-user index, so the row can exist at all.
        isOncePerUser: false,
        slotConflict: true,
      });
      await notifyAdmins({
        type: NOTIFICATION_TYPES.WEBHOOK_FAILED,
        severity: NOTIFICATION_SEVERITY.WARNING,
        title: `Once-per-user slot conflict on claim ${claim.claimCode}`,
        body:
          `A payment captured for claim ${claim.claimCode} after another claim had taken the same ` +
          `once-per-user slot. The payment was settled — the customer has been charged — but the ` +
          `offer was redeemed twice. Decide whether to refund one of them.`,
        meta: {
          claimId: claim._id,
          claimCode: claim.claimCode,
          voucherId: claim.voucherId,
          offerId: claim.offerId,
          customerId: claim.customerId,
          transactionId: claimed._id,
        },
        dedupeKey: `SLOT_CONFLICT:${claim._id}`,
        deepLink: deepLink(ADMIN_PATHS.claim(claim._id)),
        mail: {
          lines: [
            ["Claim code", claim.claimCode || "-"],
            ["Amount charged", String(claim.pricing?.totalPayable ?? "-")],
            ["Transaction", String(claimed._id)],
          ],
          /**
           * Two screens, because the decision needs both: the claim says what was
           * redeemed twice, and the transaction is where a refund is issued from.
           */
          actions: [
            { label: "Open claim", url: adminUrl(ADMIN_PATHS.claim(claim._id)) },
            {
              label: "Open transaction",
              url: adminUrl(ADMIN_PATHS.transaction(claimed._id)),
            },
          ],
          footnote:
            "The payment is settled and the customer has been charged — nothing is broken. The decision is whether the second redemption should be refunded.",
        },
      });
    }
  }

  /**
   * Phase 1 captures straight to `REDEEMED`: paying at the counter *is* the
   * redemption. Phase 2 stops the same capture at `PAID` and waits for a scan —
   * a behaviour switch, not a migration.
   */
  const paidStatus =
    claim.redemptionMode === CLAIM_REDEMPTION_MODE.AUTO
      ? VOUCHER_CLAIM_STATUS.REDEEMED
      : VOUCHER_CLAIM_STATUS.PAID;

  // Conditional on PENDING, so a resume does not overwrite a claim that has
  // since been refunded or cancelled by a human.
  await VoucherClaim.updateOne(
    { _id: claim._id, status: VOUCHER_CLAIM_STATUS.PENDING },
    {
      $set: {
        status: paidStatus,
        paidAt: claimed.verifiedAt || new Date(),
        ...(paidStatus === VOUCHER_CLAIM_STATUS.REDEEMED
          ? { redeemedAt: claimed.verifiedAt || new Date() }
          : {}),
      },
    },
  );

  // The discount is final. If the reservation had already been swept as stale,
  // this re-claims it — the money was captured at the discounted amount, so it
  // has to be honoured and the ledger has to say so.
  const promoCommit = await commitPromoCode({
    transactionId: claimed._id,
    voucherClaimId: claim._id,
    pricing: {
      promoCode: claim.promoCode,
      promoDiscount: claim.promoDiscount,
    },
    customerId: claim.customerId,
    brandId: claim.brandId,
    userId: actor.userId || claimed.createdBy,
  });

  // Every ledger row this capture produces. Idempotent by unique index, which
  // is what makes the resume safe rather than double-crediting the vendor.
  const ledger = await postCaptureEntries({
    transaction: claimed,
    claim,
    pricing,
  });

  await Transaction.updateOne(
    { _id: claimed._id },
    { $set: { settlementStage: SETTLEMENT_STAGE.RECORDED } },
  );

  /**
   * ---------------- stage 2: the invoice ----------------
   *
   * **Only the number and the snapshot.** The PDF is rendered on the first
   * download request instead — rendering and uploading one on every claim does
   * not survive scale, and most invoices are never opened.
   *
   * The **number** is still allotted here, at settle time, because an invoice
   * series must have no gaps: allotting it lazily would number invoices in the
   * order they were downloaded rather than the order they were issued.
   *
   * Idempotent by the `$exists: false` guard, so a resume does not burn a second
   * number on a transaction that already has one — which would leave a hole in
   * the series, the exact thing this ordering protects.
   */
  if (!claimed.invoiceId) {
    const [customerConfig, sellerConfig] = await Promise.all([
      getCustomerConfig(),
      // One legal entity, so the seller identity comes from the vendor-side
      // config rather than a second copy free to disagree with it.
      getSubscriptionConfig(),
    ]);

    const invoiceId = await generateInvoiceNumber({
      series:
        customerConfig.invoice.seriesPrefix ||
        INVOICE_SERIES[TRANSACTION_PURPOSE.VOUCHER_CLAIM],
    });

    const freshClaim = await VoucherClaim.findById(claim._id);
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: { ...claimed.toObject(), invoiceId },
      claim: freshClaim,
      config: customerConfig,
      seller: sellerConfig,
      billTo: {
        name: freshClaim.customerSnapshot?.name,
        email: claimed.email,
        contact: claimed.contact,
      },
    });

    // Conditional on the number still being absent, so two racing writers cannot
    // both allot one.
    const numbered = await Transaction.findOneAndUpdate(
      { _id: claimed._id, invoiceId: { $exists: false } },
      {
        $set: {
          invoiceId,
          invoiceSnapshot: snapshot,
          invoiceToken: crypto.randomBytes(32).toString("hex"),
        },
      },
      { returnDocument: "after" },
    );
    if (numbered) claimed = numbered;
  }

  await Transaction.updateOne(
    { _id: claimed._id },
    { $set: { settlementStage: SETTLEMENT_STAGE.INVOICED } },
  );

  /**
   * ---------------- stage 3: tell people ----------------
   *
   * Last, and deliberately so: a notification is the only step here whose
   * failure costs nothing but a message. Everything above it moves money.
   *
   * Idempotent through `dedupeKey`, so a resume does not send the receipt twice.
   * `notify` never throws, so a mail outage cannot leave a settled payment
   * marked incomplete and retried forever.
   */
  const settledClaim = await VoucherClaim.findById(claim._id);
  await notifyClaimPaid({ claim: settledClaim, transaction: claimed });
  await notifyVendorClaimReceived({ claim: settledClaim });

  await Transaction.updateOne(
    { _id: claimed._id },
    { $set: { settlementStage: SETTLEMENT_STAGE.COMPLETE } },
  );

  if (promoCommit?.exceededLimit) {
    // A limited code went past its cap because a late payment had to be
    // honoured. Nothing to undo — but somebody should know.
    await notifyAdmins({
      type: NOTIFICATION_TYPES.WEBHOOK_FAILED,
      severity: NOTIFICATION_SEVERITY.WARNING,
      title: `Promo code ${claim.promoCode} went past its limit`,
      body:
        `A payment captured after the reservation for ${claim.promoCode} had lapsed. The discount ` +
        `was honoured because the money was taken at that price, so the code is now over its cap.`,
      meta: { claimId: claim._id, promoCode: claim.promoCode },
      dedupeKey: `PROMO_OVER_LIMIT:${claim.promoCode}`,
      deepLink: deepLink(ADMIN_PATHS.promo(claim.promoCode)),
      mail: {
        lines: [
          ["Promo code", claim.promoCode || "-"],
          ["Claim code", claim.claimCode || "-"],
          ["Discount honoured", String(claim.pricing?.promoDiscount ?? "-")],
        ],
        ctaLabel: "Open promo code",
        ctaUrl: adminUrl(ADMIN_PATHS.promo(claim.promoCode)),
        footnote:
          "Nothing to undo — the money was taken at that price. Lower the cap or close the code if it should stop here.",
      },
    });
  }

  await recordClaimHistory({
    claimId: claim._id,
    customerId: claim.customerId,
    brandId: claim.brandId,
    transactionId: claimed._id,
    action: CLAIM_HISTORY_ACTION.PAYMENT_CAPTURED,
    performedBy: actor.userId,
    role: actor.role,
    fromStatus: VOUCHER_CLAIM_STATUS.PENDING,
    toStatus: paidStatus,
    amount: pricing.totalPayable,
    snapshot: {
      razorpayPaymentId: claimed.razorpayPaymentId,
      ledgerEntries: ledger.posted,
      usageConflict,
      resumed: resume,
    },
  });

  return {
    alreadySettled: false,
    transaction: claimed,
    claim: settledClaim,
    ledger,
    usageConflict,
    promo: claim.promoCode
      ? {
          code: claim.promoCode,
          discount: claim.promoDiscount,
          reconciled: Boolean(promoCommit?.reconciled),
          exceededLimit: Boolean(promoCommit?.exceededLimit),
        }
      : null,
  };
};
