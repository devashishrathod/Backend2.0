const Transaction = require("../../models/Transaction");
const { notifyAdmins } = require("../notifications");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");

/**
 * Catch a SECOND captured payment on an order that is already settled.
 *
 * The conditional claim on `verified: false` guarantees only one caller
 * activates — which is exactly right for the ordinary race between the browser
 * callback and the webhook, because both carry the *same* payment.
 *
 * But it says nothing about a genuinely different payment landing on the same
 * order. Razorpay allows more than one payment attempt against an order, and a
 * retry after a capture that our side never recorded can produce two captures.
 * The loser of the conditional claim was simply told "already settled" and
 * dropped — so the second capture's money sat in the Razorpay account with
 * nothing pointing at it. That is a double charge on the customer, invisible.
 *
 * This is not specific to voucher claims; the same hole exists on the
 * subscription path, which is why it lives in a shared helper.
 *
 * Never throws — it runs on the *losing* side of a settlement that has already
 * succeeded, and must not turn that success into an error.
 *
 * @returns {Promise<{ isDouble: boolean, recorded?: boolean }>}
 */
exports.detectDoubleCapture = async ({ transaction, payment }) => {
  try {
    const incomingId = payment?.id;
    const settledId = transaction?.razorpayPaymentId;

    // Nothing to compare, or the ordinary case: the same payment arriving twice
    // (browser callback racing the webhook, or a Razorpay redelivery).
    if (!incomingId || !settledId || incomingId === settledId) {
      return { isDouble: false };
    }

    // Two different payment ids, both captured, one order. Real money.
    const amount = (payment.amount ?? 0) / 100;

    await Transaction.updateOne(
      { _id: transaction._id },
      {
        $set: {
          isDisputed: false,
          note: `Second captured payment ${incomingId} on this order (settled with ${settledId}). Needs a refund.`,
        },
        $addToSet: { duplicateCapturePaymentIds: incomingId },
      },
    );

    await notifyAdmins({
      type: NOTIFICATION_TYPES.WEBHOOK_FAILED,
      severity: NOTIFICATION_SEVERITY.CRITICAL,
      title: `Double capture on order ${transaction.razorpayOrderId}`,
      body:
        `Razorpay captured a second payment (${incomingId}) on an order that was already settled with ${settledId}. ` +
        `The customer has been charged twice — ${amount} needs refunding from the ${transaction.gatewayAccount} account.`,
      meta: {
        transactionId: transaction._id,
        purpose: transaction.purpose,
        gatewayAccount: transaction.gatewayAccount,
        razorpayOrderId: transaction.razorpayOrderId,
        settledPaymentId: settledId,
        duplicatePaymentId: incomingId,
        amount,
      },
      // One alert per duplicate payment, however many times it is redelivered.
      dedupeKey: `DOUBLE_CAPTURE:${incomingId}`,
      mail: {
        lines: [
          ["Order", transaction.razorpayOrderId || "-"],
          ["Already settled with", settledId],
          ["Second capture", incomingId],
          ["Amount", String(amount)],
          ["Account", transaction.gatewayAccount || "-"],
        ],
        footnote:
          "Refund the duplicate payment from the Razorpay dashboard for that account.",
      },
    });

    return { isDouble: true, recorded: true };
  } catch (error) {
    console.error(
      "[detectDoubleCapture] could not record a duplicate capture:",
      error?.message,
    );
    return { isDouble: true, recorded: false };
  }
};
