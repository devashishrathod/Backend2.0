const Transaction = require("./../../models/Transaction");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const { buildTransactionFilter } = require("./buildTransactionFilter");

/**
 * Mark the payments that arrived in **our** bank as part of one Razorpay
 * settlement.
 *
 * ### Why a vendor payout must wait for this
 *
 * `verifiedAt` says the customer paid. It does **not** say the money is ours to
 * pay out — Razorpay holds it for its own cycle (T+2 by default) and then
 * settles the batch to our bank. Between those two moments the money exists on a
 * dashboard and nowhere else.
 *
 * A T+3 rule computed from `verifiedAt` is a *guess* that the gateway will have
 * settled by then. It is usually right, and the times it is wrong are the worst
 * possible times: Razorpay suspends settlements for an account under review, or
 * holds a batch over a bank holiday, or flags a payment for KYC. Paying a vendor
 * from money that has not arrived is how a platform ends up funding its own
 * float without deciding to.
 *
 * So settlement eligibility keys on `fundsReceivedAt`, and only this fills it in.
 *
 * ### Idempotent, because the webhook is redelivered
 *
 * The filter carries `fundsReceivedAt: null`, so a redelivery updates nothing and
 * reports zero. The timestamp is the gateway's own `created_at` rather than the
 * moment we processed it — a webhook that arrives two days late must not make
 * the money look two days newer than it is.
 *
 * @param {object} args
 * @param {string} args.settlementId  Razorpay's settlement id (`setl_…`)
 * @param {Date}   args.settledAt     when Razorpay settled it, from the entity
 * @param {string[]} args.paymentIds  the payments in that batch
 */
exports.recordFundsReceived = async ({ settlementId, settledAt, paymentIds }) => {
  if (!settlementId || !paymentIds?.length) {
    return { matched: 0, updated: 0 };
  }

  const result = await Transaction.updateMany(
    {
      ...buildTransactionFilter({ purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM }),
      razorpayPaymentId: { $in: paymentIds },
      // Never move it twice. A redelivery is expected and must be a no-op.
      fundsReceivedAt: null,
      isDeleted: false,
    },
    {
      $set: {
        fundsReceivedAt: settledAt || new Date(),
        razorpaySettlementId: settlementId,
      },
    },
  );

  return {
    matched: result.matchedCount ?? 0,
    updated: result.modifiedCount ?? 0,
  };
};
