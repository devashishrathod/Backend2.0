const RefundRequest = require("../../models/RefundRequest");
const { throwError } = require("../../utils");
const { REFUND_REQUEST_STATUS } = require("../../constants/refund");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * States that count against a customer's allowance.
 *
 * **Approved refunds are not on this list, and that is the whole design.** The
 * signal that something is wrong is not how much money went back — it is *"a
 * vendor looked at this and said it was not legitimate"*. A customer with five
 * approved refunds had five genuinely bad experiences, and blocking their sixth
 * punishes exactly the person the process exists for. Counting raw requests
 * would also hit the customers of the worst brand first, and they are the ones
 * most entitled to ask.
 *
 * `CANCELLED` sits alongside the rejections on purpose: raise → the vendor sees
 * it → withdraw → raise again is a way to keep a vendor busy without ever
 * collecting a rejection. Withdrawing once is nothing; doing it five times is
 * the pattern this exists for.
 */
const COUNTS_AGAINST_ALLOWANCE = Object.freeze([
  REFUND_REQUEST_STATUS.VENDOR_REJECTED,
  REFUND_REQUEST_STATUS.ADMIN_REJECTED,
  REFUND_REQUEST_STATUS.CANCELLED,
]);

/**
 * May this customer open another refund request?
 *
 * ### The refusal has to leave a way through
 *
 * Both limits refuse with a message that points at support rather than a dead
 * end. A customer who has genuinely had three bad meals in a month and is
 * refused a fourth with *"you have reached your limit"* is stranded by a rule
 * that was aimed at somebody else — and the support ticket arrives anyway, only
 * angrier. An admin can still raise a refund on their behalf, so the rule slows
 * abuse down without ever closing the door.
 *
 * @param {object} options
 * @param {string} options.customerId
 * @param {object} options.config  the `refund` block from `getCustomerConfig()`
 * @param {string} [options.exceptTransactionId] a payment whose own open request
 *   should not count — see below
 * @throws {CustomError} 422 with a message that names the next step
 */
exports.assertRefundAllowance = async ({
  customerId,
  config = {},
  exceptTransactionId,
}) => {
  const maxOpen = Number(config.maxOpenRequests) || 0;
  const maxRejected = Number(config.maxRejectedPerWindow) || 0;
  const windowDays = Number(config.requestWindowDays) || 0;

  /**
   * How many are in flight **across all their claims**.
   *
   * Different from the unique index on `RefundRequest`, which allows one open
   * request per *payment*. This stops somebody opening a request against every
   * claim they have ever made and burying the vendor in a morning.
   */
  if (maxOpen > 0) {
    /**
     * ⚠️ The caller's own payment is excluded.
     *
     * A second tap on the **same** claim is not a second request — the service
     * has an idempotent path that hands back the one already open. Counting it
     * here would answer *"you already have a refund in progress"* to somebody
     * asking about that very refund, which reads as a bug and sends them to
     * support over nothing.
     *
     * The unique index on `(transactionId, isOpen)` is what actually stops two
     * requests against one payment. This limit is about **different** claims.
     */
    const open = await RefundRequest.countDocuments({
      customerId,
      isOpen: true,
      isDeleted: false,
      ...(exceptTransactionId
        ? { transactionId: { $ne: exceptTransactionId } }
        : {}),
    });

    if (open >= maxOpen) {
      throwError(
        422,
        open === 1
          ? "You already have a refund in progress. We will come back to you on that one first — write to support if it is urgent."
          : `You already have ${open} refunds in progress. We will come back to you on those first — write to support if something is urgent.`,
      );
    }
  }

  if (maxRejected > 0 && windowDays > 0) {
    const since = new Date(Date.now() - windowDays * DAY_MS);

    const refused = await RefundRequest.countDocuments({
      customerId,
      status: { $in: COUNTS_AGAINST_ALLOWANCE },
      createdAt: { $gte: since },
      isDeleted: false,
    });

    if (refused >= maxRejected) {
      /**
       * Says what to do next, and does not accuse.
       *
       * "You have been flagged" is both unpleasant and useless — the customer
       * cannot act on it, and if the flag is wrong there is nothing to correct
       * it with. Handing them a person to talk to is the only ending that works
       * for the honest customer and the dishonest one alike.
       */
      throwError(
        422,
        "We are not able to take this refund request automatically. Please write to support and we will look at it ourselves.",
      );
    }
  }
};

exports.COUNTS_AGAINST_ALLOWANCE = COUNTS_AGAINST_ALLOWANCE;
