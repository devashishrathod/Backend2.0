const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const { REFUND_REASON } = require("../constants/refund");
const { PAYOUT_MODE } = require("../constants/payout");

/**
 * Asking for a refund.
 *
 * `amount` is optional on purpose: most customers want the whole thing back, and
 * making them restate a figure the server already knows is a way to get it typed
 * wrong. Omitted means everything still refundable.
 */
exports.validateRequestRefund = {
  body: Joi.object({
    claimId: objectId().required().messages({
      "any.required": "claimId is required.",
      "any.invalid": "Invalid claimId.",
    }),
    amount: Joi.number().positive().precision(2).optional().messages({
      "number.positive": "A refund has to be for more than zero.",
    }),
    reason: Joi.string()
      .valid(...Object.values(REFUND_REASON))
      .required()
      .messages({
        "any.only": `reason must be one of: ${Object.values(REFUND_REASON).join(", ")}`,
        "any.required": "Please tell us why you want a refund.",
      }),
    /**
     * Required by the service when `reason` is OTHER. Enforced there rather than
     * here so the rule lives next to the reason list it depends on.
     */
    reasonNote: Joi.string().trim().max(500).allow("", null).optional().messages({
      "string.max": "Please keep it under {#limit} characters.",
    }),
  }),
};

const objectIdParam = (name) =>
  Joi.object({
    [name]: objectId().required().messages({
      "any.required": `${name} is required.`,
      "any.invalid": `Invalid ${name}.`,
    }),
  });

/**
 * The vendor approves — in full, or for less.
 *
 * `approvedAmount` is optional: omitted means "all of it", which is what most
 * approvals are. The **may go down, never up** rule is enforced in the service,
 * against the amount stored on the request — a validator has no way to know what
 * the customer asked for.
 */
exports.validateApproveRefund = {
  params: objectIdParam("requestId"),
  body: Joi.object({
    approvedAmount: Joi.number().positive().precision(2).optional().messages({
      "number.positive": "An approved amount has to be more than zero.",
    }),
    note: Joi.string().trim().max(500).allow("", null).optional(),
  }),
};

/**
 * The vendor declines.
 *
 * `note` is **required**. It is the only thing an admin has to review when the
 * customer disputes the refusal, and "rejected" on its own turns every appeal
 * into a phone call.
 */
exports.validateRejectRefund = {
  params: objectIdParam("requestId"),
  body: Joi.object({
    note: Joi.string().trim().min(3).max(500).required().messages({
      "any.required": "Please say why you are declining this refund.",
      "string.empty": "Please say why you are declining this refund.",
      "string.min": "Please give a little more detail.",
    }),
  }),
};

/** The customer withdraws their own request. */
exports.validateWithdrawRefund = {
  params: objectIdParam("requestId"),
};

/**
 * The admin clears a refund for payment.
 *
 * `overrideReason` is **required by the service** when the vendor said no or
 * never answered — not here, because a validator cannot see the request's
 * current status. Declaring it optional and enforcing it there keeps one rule in
 * one place.
 */
exports.validateAdminApproveRefund = {
  params: objectIdParam("requestId"),
  body: Joi.object({
    note: Joi.string().trim().max(500).allow("", null).optional(),
    overrideReason: Joi.string().trim().min(3).max(500).allow("", null).optional().messages({
      "string.min": "Please give a little more detail.",
    }),
  }),
};

exports.validateAdminRejectRefund = {
  params: objectIdParam("requestId"),
  body: Joi.object({
    note: Joi.string().trim().min(3).max(500).required().messages({
      "any.required": "Please say why you are declining this refund.",
      "string.empty": "Please say why you are declining this refund.",
    }),
  }),
};

/** Sending the money. Takes nothing — every figure was frozen at approval. */
exports.validatePayRefund = {
  params: objectIdParam("requestId"),
};

// ---------------------------------------------------------------------------
// MANUAL_BANK — when the money cannot go back the way it came.
// ---------------------------------------------------------------------------

/**
 * The admin asks the customer for an account.
 *
 * `reason` is required for the same reason a rejection note is: the customer is
 * about to be asked for bank details out of nowhere, and support needs a
 * sentence to quote back when they ring to ask whether it is genuine.
 */
exports.validateRequestRefundBankDetails = {
  params: objectIdParam("requestId"),
  body: Joi.object({
    reason: Joi.string().trim().min(3).max(500).required().messages({
      "any.required": "Please say why the original refund could not be sent.",
      "string.empty": "Please say why the original refund could not be sent.",
      "string.min": "Please give a little more detail.",
    }),
  }),
};

/** The customer picks one of their own verified accounts. */
exports.validateChooseRefundBankAccount = {
  params: objectIdParam("requestId"),
  body: Joi.object({
    bankAccountId: objectId().required().messages({
      "any.required": "Please choose a bank account.",
      "any.invalid": "That is not a valid bank account.",
    }),
  }),
};

exports.validatePayRefundToBank = {
  params: objectIdParam("requestId"),
};

/**
 * Confirming a hand-made NEFT.
 *
 * ⚠️ `utr` is required and not optional-with-a-default: three days later, when
 * the customer says the money never arrived, it is the only thing that can be
 * looked up on a bank statement. A blank one turns a five-minute check into a
 * reconciliation.
 *
 * ⚠️ `paidAt` is accepted because a Friday transfer is often typed in on Monday,
 * and the ledger entry has to carry the date the money actually moved.
 */
exports.validateConfirmRefundBankPayout = {
  params: objectIdParam("requestId"),
  body: Joi.object({
    utr: Joi.string().trim().min(4).max(64).required().messages({
      "any.required": "The bank reference (UTR) is required.",
      "string.empty": "The bank reference (UTR) is required.",
      "string.min": "That does not look like a bank reference.",
    }),
    mode: Joi.string()
      .valid(...Object.values(PAYOUT_MODE))
      .optional(),
    paidAt: Joi.date().max("now").optional().messages({
      "date.max": "A transfer cannot have been made in the future.",
    }),
  }),
};

exports.validateFailRefundBankPayout = {
  params: objectIdParam("requestId"),
  body: Joi.object({
    reason: Joi.string().trim().min(3).max(500).required().messages({
      "any.required": "Please say why the transfer failed.",
      "string.empty": "Please say why the transfer failed.",
    }),
  }),
};

const { REFUND_REQUEST_STATUS } = require("../constants/refund");

/**
 * Listing refunds.
 *
 * ⚠️ No `customerId` here, deliberately. Scope comes from the token, never from
 * the query string — a listing that accepted an identity filter would let a
 * customer type someone else's id and read their refunds. `brandId` **is**
 * accepted, but only as a narrowing filter on top of a scope that already
 * restricts the caller.
 */
exports.validateListRefunds = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    status: Joi.string()
      .uppercase()
      .valid(...Object.values(REFUND_REQUEST_STATUS))
      .optional()
      .messages({
        "any.only": `status must be one of: ${Object.values(REFUND_REQUEST_STATUS).join(", ")}`,
      }),
    // The worklist: everything still moving, oldest first.
    open: Joi.boolean().optional(),
    claimCode: Joi.string().trim().uppercase().optional(),
    brandId: objectId().optional(),
    outletId: objectId().optional(),
    from: Joi.date().iso().optional().messages({
      "date.format": "from must be an ISO date, e.g. 2026-08-01",
    }),
    // Inclusive of the whole day — the service widens it to 23:59:59.
    to: Joi.date().iso().optional().messages({
      "date.format": "to must be an ISO date, e.g. 2026-08-31",
    }),
  }),
};

exports.validateRefundDetail = {
  params: objectIdParam("requestId"),
};
