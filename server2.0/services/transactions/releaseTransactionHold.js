const Transaction = require("../../models/Transaction");
const RefundRequest = require("../../models/RefundRequest");
const { throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const { CLAIM_HISTORY_ACTION } = require("../../constants/voucherClaim");
const {
  REFUND_CUSTOMER_LABEL,
  REFUND_REQUEST_STATUS,
} = require("../../constants/refund");
const { releaseSettlementHold } = require("../../helpers/refunds");
const { getCustomerConfig } = require("../../helpers/settings");
const { recordClaimHistory } = require("../../helpers/voucherClaims");
const { buildTransactionFilter } = require("../../helpers/transactions");

/**
 * The explicit admin action that lets a held payment back into settlement.
 *
 * ### ⚠️ Why this exists
 *
 * `settlementHold` is the most dangerous field in this system, and it is
 * deliberately **monotonic**: five code paths set it and, until this endpoint,
 * exactly one cleared it — `releaseSettlementHold`, callable only from the three
 * refund-rejection paths.
 *
 * Everything else that sets a hold had no way out at all:
 *
 * | Set by | Released by, before this |
 * |---|---|
 * | a chargeback, **including one we won** | nothing |
 * | a refund that reached `FAILED` | nothing |
 * | a refund made in the Razorpay dashboard | nothing |
 * | a completed refund | nothing |
 *
 * The dispute webhook says so in as many words — *"releasing it is an explicit
 * admin action, taken once somebody has decided who bears the loss"* — and that
 * action did not exist. A vendor whose chargeback we **won** had that money
 * frozen out of every future settlement, permanently, with nothing anywhere
 * saying why.
 *
 * ### It does not bypass the reasons that are still live
 *
 * `allowDisputed` covers a resolved chargeback, because that is the decision an
 * admin is here to make. It does **not** cover an open refund: while a customer
 * is still owed an answer, the money genuinely is not the vendor's, and this
 * refuses rather than pretending. It also refuses an unresolved dispute — the
 * bank is still deciding, and there is nothing for an admin to decide yet.
 */
exports.releaseTransactionHold = async (actor, transactionId, payload = {}) => {
  if (actor?.role !== ROLES.ADMIN) {
    throwError(403, "Only an admin can release a settlement hold.");
  }

  const reason = String(payload.reason || "").trim();
  if (!reason) {
    /**
     * Required. This puts money back into a payout run after something took it
     * out, and "who decided the vendor keeps this, and why" is the first
     * question anybody asks when it is queried months later.
     */
    throwError(422, "Please say why this hold is being released.");
  }

  const transaction = await Transaction.findOne({
    _id: transactionId,
    ...buildTransactionFilter({ purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM }),
    isDeleted: false,
  }).lean();

  if (!transaction) throwError(404, "Payment not found.");

  if (!transaction.settlementHold) {
    /**
     * Not an error to the caller's mind — they wanted it released and it is.
     * Said plainly rather than as a failure, because an admin retrying a button
     * that already worked should not be told something went wrong.
     */
    return {
      released: false,
      alreadyReleasable: true,
      message: "This payment was not on hold.",
    };
  }

  /**
   * ⚠️ A chargeback the bank has not resolved is nobody's to override — not even
   * an admin's, because there is nothing to decide yet.
   *
   * Checked **here** rather than left to `allowDisputed`: that flag exists to
   * override a *resolved* dispute, which is a judgement about who bears a loss
   * that has already landed. An open one is a judgement the bank has not made.
   * Releasing now can pay out money that is about to be pulled back.
   */
  if (transaction.isDisputed && !transaction.disputeResolvedAt) {
    throwError(
      409,
      "This payment has a chargeback the bank has not resolved yet. Wait for " +
        "the outcome — releasing it now could pay out money that is about to be taken back.",
    );
  }

  /**
   * ⚠️ An open refund is not an admin's to override here.
   *
   * The customer is still owed a decision, and until they get one the money is
   * not the vendor's. Decide the refund; the hold comes off on its own.
   *
   * `FAILED` counts as open, and that is deliberate rather than an oversight to
   * route around: a refund that failed is one the customer has been *promised*
   * and has not received. Releasing the vendor's money there would settle a sale
   * the customer is still owed a refund on. The exit for that state is to
   * resolve the refund — which today means the `MANUAL_BANK` fallback (S1.5),
   * not this endpoint.
   */
  const openRefunds = await RefundRequest.find({
    transactionId: transaction._id,
    isOpen: true,
    isDeleted: false,
  })
    .select("_id status bankDetailsRequestedAt")
    .lean();

  /**
   * ⚠️ The one open state this endpoint may override — and only once it has gone
   * stale.
   *
   * `AWAITING_BANK_DETAILS` waits on the **customer**, and some never answer:
   * the number changed, the app was deleted, ₹200 was not worth the trouble.
   * Every other open state resolves on its own eventually; this one can sit for
   * ever, and `settlementHold` sits with it — keeping the vendor's money out of
   * every settlement, indefinitely, as the price of somebody else's silence.
   *
   * Releasing it does **not** cancel the refund. The money is still owed, the
   * request stays open, and if the customer ever does supply an account,
   * `claimRefundAdjustments` takes the clawback out of a later cycle — by then
   * the payment carries a `settlementId`, which is exactly the condition that
   * function tests. Nothing is written off; the vendor stops being frozen.
   *
   * The wait is `refund.bankDetailsStaleDays`, and it is checked here rather
   * than trusted from the caller: an endpoint that let an admin type the number
   * would let one typed as `0`.
   */
  const config = await getCustomerConfig();
  const staleDays = Number(config.refund?.bankDetailsStaleDays) || 30;
  const staleBefore = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  const overridableStall =
    openRefunds.length === 1 &&
    openRefunds[0].status === REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS &&
    openRefunds[0].bankDetailsRequestedAt &&
    new Date(openRefunds[0].bankDetailsRequestedAt).getTime() <= staleBefore;

  if (openRefunds.length && !overridableStall) {
    const worst = openRefunds[0];
    const isFailed = worst?.status === REFUND_REQUEST_STATUS.FAILED;
    const isWaitingOnCustomer =
      worst?.status === REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS;

    throwError(
      409,
      isFailed
        ? "A refund on this payment failed and the customer has still not been " +
            "paid back. Settle the refund first — releasing the hold now would " +
            "pay the vendor for a sale the customer is owed a refund on."
        : isWaitingOnCustomer
          ? `This refund is waiting on the customer's bank details, asked for on ` +
            `${new Date(worst.bankDetailsRequestedAt).toDateString()}. ` +
            `The hold can only be released after ${staleDays} days of no reply — ` +
            `until then the refund may still complete on its own.`
          : `This payment has ${openRefunds.length} refund request(s) still open — ` +
            `${REFUND_CUSTOMER_LABEL[worst?.status] || worst?.status}. ` +
            `Decide the refund and the hold comes off by itself.`,
    );
  }

  const result = await releaseSettlementHold({
    transactionId: transaction._id,
    reason: `Released by admin: ${reason}`,
    /**
     * The whole point of the endpoint. A resolved chargeback — won or lost — is
     * a decision about who bears the loss, and a person is making it here.
     */
    allowDisputed: true,
    /**
     * The helper counts open refunds itself and refuses on any — which is right
     * everywhere except here, where the whole decision **is** that this one
     * stalled. Naming it rather than loosening the helper keeps the guard intact
     * for every other caller: a second open refund would still block, and the
     * partial unique index on `(transactionId, isOpen)` means there cannot be
     * one anyway.
     */
    ...(overridableStall ? { exceptRequestId: openRefunds[0]._id } : {}),
  });

  if (!result.released) {
    /**
     * The only remaining blocker is a dispute the bank has not resolved. Named,
     * so the admin knows to wait rather than to retry.
     */
    throwError(
      409,
      result.blockedBy === "DISPUTE"
        ? "This payment has a chargeback the bank has not resolved yet. " +
            "Wait for the outcome — releasing it now could pay out money that is about to be taken back."
        : `The hold could not be released (${result.blockedBy}).`,
    );
  }

  /**
   * Append-only, and on the claim's timeline rather than a private log: this is
   * a money decision a human made, and it belongs where the rest of that claim's
   * story is.
   */
  await recordClaimHistory({
    claimId: transaction.voucher?.claimId,
    customerId: transaction.customerId,
    brandId: transaction.brandId,
    transactionId: transaction._id,
    action: CLAIM_HISTORY_ACTION.SETTLEMENT_HOLD_RELEASED,
    role: actor.role,
    performedBy: actor.userId,
    reason,
    snapshot: {
      previousHoldReason: transaction.settlementHoldReason,
      disputeStatus: transaction.disputeStatus,
      amountRefunded: transaction.amountRefunded,
    },
  });

  return {
    released: true,
    transactionId: transaction._id,
    invoiceId: transaction.invoiceId,
    /**
     * Stated, so the panel can tell the admin what will happen next rather than
     * leaving them to guess whether anything did.
     */
    message:
      "Hold released. This payment will be picked up by the next settlement run.",
  };
};
