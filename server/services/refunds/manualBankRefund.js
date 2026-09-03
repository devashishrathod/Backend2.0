const mongoose = require("mongoose");
const RefundRequest = require("../../models/RefundRequest");
const Transaction = require("../../models/Transaction");
const PayoutLeg = require("../../models/PayoutLeg");
const CustomerBankAccount = require("../../models/CustomerBankAccount");
const { throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const {
  REFUND_REQUEST_STATUS,
  REFUND_ACTOR,
} = require("../../constants/refund");
const {
  REFUND_METHODS,
  PAYOUT_PROVIDERS,
} = require("../../constants/customer");
const {
  PAYOUT_TYPE,
  PAYOUT_LEG_STATUS,
  PAYOUT_MODE,
} = require("../../constants/payout");
const { applyRefundCompletion } = require("../../helpers/refunds");
const {
  sendQuietly,
  notifyRefundBankDetailsRequested,
} = require("../../helpers/notifications");
const { resolveCustomerId } = require("../../helpers/customers");

const DUPLICATE_KEY = 11000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const assertAdmin = (actor) => {
  if (actor?.role !== ROLES.ADMIN) {
    throwError(403, "Only Trydood can do this.");
  }
};

const readable = (status) => String(status || "").replace(/_/g, " ").toLowerCase();

const load = async (requestId) => {
  const request = await RefundRequest.findOne({
    _id: requestId,
    isDeleted: false,
  });
  if (!request) throwError(404, "Refund request not found.");
  return request;
};

/**
 * ### The `MANUAL_BANK` fallback — when the money cannot go back the way it came
 *
 * `SOURCE` returns a refund to the card or UPI handle that paid. When that
 * instrument is closed or expired it fails **every time**, and before this
 * existed there was no second button: the request sat `FAILED`, the vendor's
 * money stayed held, an admin got a CRITICAL on each retry, and the customer
 * never got their money.
 *
 * ```
 * SOURCE fails
 *    → admin: request-bank-details      → AWAITING_BANK_DETAILS  (customer notified)
 *    → customer adds an account         (OTP + penny drop, services/customerBankAccounts)
 *    → customer: attach to this refund  → ADMIN_APPROVED
 *    → admin: pay                       → PayoutLeg INITIATED, refund PROCESSING
 *    → admin does the NEFT by hand
 *    → admin: confirm with the UTR      → leg PAID → applyRefundCompletion
 * ```
 *
 * ⚠️ **Admin-initiated, never automatic.** A `SOURCE` failure is not always a
 * dead instrument — a gateway blip fails the same way, and a retry usually
 * works. Switching automatically would ask every customer for bank details over
 * a two-minute outage, and bank details asked for and not needed is exactly how
 * a refund flow starts looking like a phishing attempt.
 */

/**
 * Ask the customer for an account to pay into.
 *
 * Only from `FAILED`: until `SOURCE` has actually failed there is nothing to
 * fall back from, and moving a healthy refund here would strand it waiting on a
 * customer who has no reason to answer.
 */
exports.requestBankDetails = async (actor, requestId, payload = {}) => {
  assertAdmin(actor);
  const request = await load(requestId);

  if (request.status !== REFUND_REQUEST_STATUS.FAILED) {
    throwError(
      409,
      `This refund is ${readable(request.status)}. Bank details are only asked for after a refund to the original method has failed.`,
    );
  }

  const reason = String(payload.reason || "").trim();
  if (reason.length < 3) {
    /**
     * Required for the same reason a rejection note is: the customer is about to
     * be asked for bank details out of the blue, and support needs to be able to
     * say why when they ring.
     */
    throwError(422, "A short reason is required — it is what support quotes back to the customer.");
  }

  const claimed = await RefundRequest.findOneAndUpdate(
    { _id: request._id, status: REFUND_REQUEST_STATUS.FAILED },
    {
      $set: {
        status: REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS,
        method: REFUND_METHODS.MANUAL_BANK,
        bankDetailsRequestedAt: new Date(),
        adminNote: reason,
        // ⚠️ Explicit: `syncOpenFlag` is a `pre("save")` hook and does not run
        // on `findOneAndUpdate`. A stale `false` here would free the
        // `(transactionId, isOpen)` slot and let a second refund be filed.
        isOpen: true,
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!claimed) throwError(409, "This refund has already moved on.");

  await sendQuietly(
    () => notifyRefundBankDetailsRequested({ request: claimed }),
    "refund bank details requested",
  );

  return claimed;
};

/**
 * The customer picks which of their accounts this refund goes to.
 *
 * ⚠️ Verified only. An unverified row is a record that somebody tried, not a
 * destination — a penny drop can fail on an account that exists, and a NEFT into
 * one of those cannot be recalled.
 */
exports.attachBankToRefund = async (actor, requestId, payload = {}) => {
  const customerId = resolveCustomerId(actor);
  if (!customerId) throwError(403, "Only the customer can do this.");

  const request = await load(requestId);

  if (String(request.customerId) !== String(customerId)) {
    throwError(403, "This refund is not yours.");
  }

  if (request.status !== REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS) {
    throwError(
      409,
      `This refund is ${readable(request.status)} and is not waiting for bank details.`,
    );
  }

  const account = await CustomerBankAccount.findOne({
    _id: payload.bankAccountId,
    customerId,
    isDeleted: false,
  }).lean();

  if (!account) throwError(404, "Bank account not found.");
  if (!account.isVerified) {
    throwError(
      422,
      "This account has not been verified yet. Add it again so we can confirm it with your bank first.",
    );
  }

  const claimed = await RefundRequest.findOneAndUpdate(
    {
      _id: request._id,
      status: REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS,
    },
    {
      $set: {
        /**
         * Straight back to approved, not to `FAILED`.
         *
         * The decision to refund was made long ago and has not changed; only the
         * destination has. Landing on `FAILED` would put it in the retry queue
         * as though `SOURCE` should be tried again, which is the one thing known
         * not to work.
         */
        status: REFUND_REQUEST_STATUS.ADMIN_APPROVED,
        customerBankAccountId: account._id,
        bankDetailsProvidedAt: new Date(),
        isOpen: true,
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!claimed) throwError(409, "This refund has already moved on.");

  return claimed;
};

/**
 * Start the transfer: open a leg, then move the request.
 *
 * ⚠️ The leg is created **before** the status changes, the same order
 * `startPayout` uses for settlements. A crash between the two leaves an
 * approved refund with an `INITIATED` leg — visible, and recoverable. The other
 * order leaves a `PROCESSING` refund with no leg at all, which reads as money in
 * flight that nobody can find.
 */
exports.payRefundToBank = async (actor, requestId) => {
  assertAdmin(actor);
  const request = await load(requestId);

  const READY = [
    REFUND_REQUEST_STATUS.ADMIN_APPROVED,
    REFUND_REQUEST_STATUS.ADMIN_OVERRIDE,
    // A bounced NEFT. The retry is a new leg, never a mutation of the old one.
    REFUND_REQUEST_STATUS.FAILED,
  ];

  if (request.method !== REFUND_METHODS.MANUAL_BANK) {
    throwError(422, "This refund is set to go back to the original payment method.");
  }
  if (!READY.includes(request.status)) {
    throwError(409, `This refund is ${readable(request.status)} and cannot be paid yet.`);
  }
  if (!request.customerBankAccountId) {
    throwError(422, "The customer has not chosen a bank account for this refund yet.");
  }

  const account = await CustomerBankAccount.findOne({
    _id: request.customerBankAccountId,
    isDeleted: false,
  }).lean();

  /**
   * Re-checked here, not trusted from the attach.
   *
   * Hours pass between choosing an account and an admin sending the money, and
   * an account can be removed in between. Paying into a row that is gone, or one
   * whose verification was never good, is the mistake with no recall.
   */
  if (!account?.isVerified) {
    throwError(
      422,
      "This refund's bank account is no longer verified. Ask the customer to add it again.",
    );
  }

  const amount = round2(request.approvedAmount ?? request.requestedAmount);
  if (!(amount > 0)) throwError(422, "There is nothing to pay on this refund.");

  const legNumber = (await PayoutLeg.countDocuments({
    payoutType: PAYOUT_TYPE.REFUND,
    refundRequestId: request._id,
  })) + 1;

  let leg;
  try {
    leg = await PayoutLeg.create({
      payoutType: PAYOUT_TYPE.REFUND,
      refundRequestId: request._id,
      customerId: request.customerId,
      legNumber,
      amount,
      provider: PAYOUT_PROVIDERS.MANUAL_BANK,
      status: PAYOUT_LEG_STATUS.INITIATED,
      /**
       * Frozen here, at the moment the money is committed. The account row can
       * change later; what matters in a dispute is where this transfer went.
       */
      bankSnapshot: {
        accountHolderName: account.accountHolderName,
        maskedAccountNumber: account.maskedAccountNumber,
        accountLast4Digits: account.accountLast4Digits,
        ifscCode: account.ifscCode,
        bankName: account.bankName,
        bankId: account._id,
      },
      initiatedAt: new Date(),
    });
  } catch (error) {
    /**
     * ⚠️ `payout_refund_inflight_unique` decided, not the `legNumber` one.
     *
     * `legNumber` comes from counting the existing legs, so two concurrent
     * clicks take 1 and 2 and **both** inserts pass a check on the number. Only
     * one then wins the status transition and the loser's leg is left
     * `INITIATED` and orphaned — which reads as a transfer that may already have
     * gone out, and confirming it pays the customer twice.
     *
     * A retry after a bounce is still fine: that leg is `FAILED`, not
     * `INITIATED`, so the index lets the next one open.
     */
    if (error?.code === DUPLICATE_KEY) {
      throwError(409, "A payout for this refund is already in flight.");
    }
    throw error;
  }

  const claimed = await RefundRequest.findOneAndUpdate(
    { _id: request._id, status: { $in: READY } },
    {
      $set: {
        status: REFUND_REQUEST_STATUS.PROCESSING,
        initiatedAt: new Date(),
        isOpen: true,
      },
      $inc: { attemptCount: 1 },
    },
    { returnDocument: "after" },
  ).lean();

  if (!claimed) throwError(409, "This refund is already being paid.");

  return { request: claimed, leg };
};

/**
 * The NEFT landed. The UTR is what makes it real.
 *
 * `MANUAL_BANK` has no callback — **a person is the callback**, exactly as on
 * the settlement side. The UTR is required because three days later, when the
 * customer says the money never arrived, it is the only thing that can be looked
 * up on a bank statement.
 */
exports.confirmRefundPayout = async (actor, requestId, payload = {}) => {
  assertAdmin(actor);
  const request = await load(requestId);

  if (request.status !== REFUND_REQUEST_STATUS.PROCESSING) {
    throwError(409, `This refund is ${readable(request.status)} and has no payout to confirm.`);
  }

  const utr = String(payload.utr || "").trim();
  if (!utr) {
    throwError(
      422,
      "The bank reference (UTR) is required — it is what a customer quotes back when money has not landed.",
    );
  }

  const mode = payload.mode || PAYOUT_MODE.NEFT;
  if (!Object.values(PAYOUT_MODE).includes(mode)) {
    throwError(422, `${mode} is not a payment mode we record.`);
  }

  const leg = await PayoutLeg.findOne({
    payoutType: PAYOUT_TYPE.REFUND,
    refundRequestId: request._id,
    status: PAYOUT_LEG_STATUS.INITIATED,
    isDeleted: false,
  }).sort({ legNumber: -1 });

  if (!leg) throwError(409, "There is no payout in flight for this refund.");

  /**
   * ⚠️ `paidAt` is taken, not assumed to be now: a Friday NEFT is often typed in
   * on Monday, and the ledger entry has to carry the date the money moved.
   */
  const paidAt = payload.paidAt ? new Date(payload.paidAt) : new Date();

  const claimedLeg = await PayoutLeg.findOneAndUpdate(
    { _id: leg._id, status: PAYOUT_LEG_STATUS.INITIATED },
    { $set: { status: PAYOUT_LEG_STATUS.PAID, utr, mode, paidAt } },
    { returnDocument: "after" },
  ).lean();

  // Two admins, one winner. The loser is told, not silently ignored.
  if (!claimedLeg) throwError(409, "This payout has already been confirmed.");

  /**
   * There is no gateway here, so the cumulative total has to be worked out
   * rather than read off a webhook. `applyRefundCompletion` writes it with
   * `$max`, so a value derived twice is still safe.
   */
  const transaction = await Transaction.findById(request.transactionId)
    .select("amountRefunded")
    .lean();

  const gatewayTotalRefunded = round2(
    (transaction?.amountRefunded || 0) + claimedLeg.amount,
  );

  const outcome = await applyRefundCompletion({
    refundRequest: request.toObject ? request.toObject() : request,
    gatewayTotalRefunded,
    utr,
    actor: { _id: actor?._id, role: REFUND_ACTOR.ADMIN },
  });

  return { leg: claimedLeg, completion: outcome };
};

/**
 * The NEFT bounced.
 *
 * ⚠️ The leg is **kept**, not edited. A retry opens a new one with the next
 * number, so both attempts survive with their own payee — and a bounce is
 * exactly the case where an auditor needs to see that money was once sent to an
 * account, not a record rewritten to say it never was.
 *
 * The request goes back to `FAILED`, which stays **open**: the customer is still
 * owed this money.
 */
exports.failRefundPayout = async (actor, requestId, payload = {}) => {
  assertAdmin(actor);
  const request = await load(requestId);

  if (request.status !== REFUND_REQUEST_STATUS.PROCESSING) {
    throwError(409, `This refund is ${readable(request.status)} and has no payout to fail.`);
  }

  const reason = String(payload.reason || "").trim();
  if (reason.length < 3) throwError(422, "A short reason is required.");

  const leg = await PayoutLeg.findOne({
    payoutType: PAYOUT_TYPE.REFUND,
    refundRequestId: request._id,
    status: PAYOUT_LEG_STATUS.INITIATED,
    isDeleted: false,
  }).sort({ legNumber: -1 });

  if (!leg) throwError(409, "There is no payout in flight for this refund.");

  await PayoutLeg.findOneAndUpdate(
    { _id: leg._id, status: PAYOUT_LEG_STATUS.INITIATED },
    {
      $set: {
        status: PAYOUT_LEG_STATUS.FAILED,
        failedAt: new Date(),
        failureReason: reason,
      },
    },
  );

  const claimed = await RefundRequest.findOneAndUpdate(
    { _id: request._id, status: REFUND_REQUEST_STATUS.PROCESSING },
    {
      $set: {
        status: REFUND_REQUEST_STATUS.FAILED,
        failureReason: reason,
        isOpen: true,
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!claimed) throwError(409, "This refund has already moved on.");

  return claimed;
};
