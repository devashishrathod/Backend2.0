const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const {
  SETTLEMENT_STATUS,
  SETTLEMENT_FAILURE_REASON,
} = require("../constants/settlement");
const { PAYOUT_MODE } = require("../constants/payout");

const settlementIdParam = Joi.object({
  settlementId: objectId().required().messages({
    "any.required": "settlementId is required.",
    "any.invalid": "Invalid settlementId.",
  }),
});

/**
 * Listing settlements.
 *
 * ⚠️ No `vendorId` and no free `brandId` semantics: scope comes from the token.
 * `brandId` is accepted only as a **narrowing** filter on top of it — a vendor
 * passing someone else's brand gets an empty page, never their own rows dressed
 * up as the answer to the question they asked.
 */
exports.validateListSettlements = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    status: Joi.string()
      .uppercase()
      .valid(...Object.values(SETTLEMENT_STATUS))
      .optional()
      .messages({
        "any.only": `status must be one of: ${Object.values(SETTLEMENT_STATUS).join(", ")}`,
      }),
    settlementNumber: Joi.string().trim().uppercase().optional(),
    // Everything still holding rows.
    open: Joi.boolean().optional(),
    /**
     * The admin worklist proper — flagged for revalidation, bounced, or held.
     * Sorted oldest-first by the service, because the point of a worklist is
     * what has been waiting longest.
     */
    needsAttention: Joi.boolean().optional(),
    brandId: objectId().optional(),
    from: Joi.date().iso().optional().messages({
      "date.format": "from must be an ISO date, e.g. 2026-08-01",
    }),
    // Inclusive of the whole day — the service widens it to 23:59:59.
    to: Joi.date().iso().optional().messages({
      "date.format": "to must be an ISO date, e.g. 2026-08-31",
    }),
  }),
};

exports.validateSettlementDetail = { params: settlementIdParam };

/** The statement lines. Paged separately — a busy brand's day is hundreds. */
exports.validateSettlementTransactions = {
  params: settlementIdParam,
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(200).optional(),
  }),
};

/**
 * ---------------- the admin decides ----------------
 *
 * Approval takes an optional note and nothing else. Every figure was computed at
 * build time and re-checked against `needsRevalidation` inside the update
 * filter; letting an admin post an amount here would be letting them overwrite
 * the only number the ledger agrees with.
 */
exports.validateApproveSettlement = {
  params: settlementIdParam,
  body: Joi.object({
    note: Joi.string().trim().max(500).allow("", null).optional().messages({
      "string.max": "Please keep it under {#limit} characters.",
    }),
  }),
};

/** Rebuild drops the tainted rows and recomputes. The reason is for the log. */
exports.validateRebuildSettlement = {
  params: settlementIdParam,
  body: Joi.object({
    reason: Joi.string().trim().max(500).allow("", null).optional(),
  }),
};

exports.validateHoldSettlement = {
  params: settlementIdParam,
  body: Joi.object({
    reason: Joi.string().trim().min(3).max(500).required().messages({
      "any.required": "Please say why this settlement is going on hold.",
      "string.empty": "Please say why this settlement is going on hold.",
      "string.min": "Please give a little more detail.",
    }),
  }),
};

/**
 * Cancelling releases every row back to the next cycle, so the reason is
 * **required** — the vendor's money moves because of it, and "cancelled" alone
 * tells whoever picks up the ticket nothing.
 */
exports.validateCancelSettlement = {
  params: settlementIdParam,
  body: Joi.object({
    reason: Joi.string().trim().min(3).max(500).required().messages({
      "any.required": "Please say why you are cancelling this settlement.",
      "string.empty": "Please say why you are cancelling this settlement.",
      "string.min": "Please give a little more detail.",
    }),
  }),
};

/**
 * Abandoning a failed payout.
 *
 * `reason` required: this is the one action that writes a payout attempt off
 * entirely. The rows go back into the next cycle and somebody will ask why
 * months later.
 */
exports.validateAbandonSettlement = {
  params: settlementIdParam,
  body: Joi.object({
    reason: Joi.string().trim().min(3).max(500).required().messages({
      "any.required": "Please say why this payout is being abandoned.",
      "string.empty": "Please say why this payout is being abandoned.",
      "string.min": "Please give a little more detail.",
    }),
  }),
};

/**
 * Starting a payout takes nothing.
 *
 * The amount is the settlement's `netPayable` and the payee is its frozen
 * `bankSnapshot`, re-compared against the live account before a rupee moves.
 * An amount in the body would be an amount that disagrees with the ledger.
 */
exports.validatePaySettlement = {
  params: settlementIdParam,
  /**
   * Still nothing. The leg is sized to what the settlement still owes, computed
   * from the legs already paid — an amount in the body would be an amount that
   * disagrees with the ledger. How much actually left is recorded on `confirm`,
   * where the admin is reading it off their banking screen.
   */
  body: Joi.object({}),
};

/**
 * Confirming a payout — the UTR is the whole point.
 *
 * `MANUAL_BANK` has no callback: a person reading their banking screen is the
 * confirmation. The UTR is what a vendor quotes back three days later when the
 * money has not landed, so it is required and it is trimmed.
 *
 * `paidAt` is accepted because a Friday NEFT is often keyed in on Monday, and
 * the ledger dates the entry from the leg, not from the click.
 */
exports.validateConfirmPayout = {
  params: settlementIdParam,
  body: Joi.object({
    /**
     * What actually left the bank. Optional — omitted means "all of this leg",
     * which is the ordinary single-NEFT case. Given, it is how a split payout is
     * recorded honestly instead of closing the settlement on money that never
     * went.
     */
    amount: Joi.number().positive().precision(2).optional().messages({
      "number.positive": "The amount transferred has to be more than zero.",
    }),
    utr: Joi.string().trim().min(4).max(64).required().messages({
      "any.required": "The bank reference (UTR) is required.",
      "string.empty": "The bank reference (UTR) is required.",
      "string.min": "That does not look like a UTR.",
    }),
    mode: Joi.string()
      .uppercase()
      .valid(...Object.values(PAYOUT_MODE))
      .optional()
      .messages({
        "any.only": `mode must be one of: ${Object.values(PAYOUT_MODE).join(", ")}`,
      }),
    reference: Joi.string().trim().max(120).allow("", null).optional(),
    paidAt: Joi.date().iso().max("now").optional().messages({
      "date.max": "A payout cannot have been paid in the future.",
      "date.format": "paidAt must be an ISO date-time.",
    }),
  }),
};

/**
 * The bank bounced it.
 *
 * `reason` is a category the vendor is shown; `note` is the staff detail and
 * never leaves the admin projection.
 */
exports.validateFailPayout = {
  params: settlementIdParam,
  body: Joi.object({
    reason: Joi.string()
      .uppercase()
      .valid(...Object.values(SETTLEMENT_FAILURE_REASON))
      .optional()
      .messages({
        "any.only": `reason must be one of: ${Object.values(SETTLEMENT_FAILURE_REASON).join(", ")}`,
      }),
    note: Joi.string().trim().min(3).max(500).required().messages({
      "any.required": "Please record what the bank said.",
      "string.empty": "Please record what the bank said.",
    }),
  }),
};

/** Retry refreshes the bank snapshot and opens a new leg. Takes nothing. */
exports.validateRetryPayout = { params: settlementIdParam };

/**
 * Reversing a payout that came back after it was marked paid.
 *
 * Required reason: this writes `PAYOUT_REVERSAL` rows into a ledger that is
 * never edited, and an unexplained reversal is indistinguishable from a mistake.
 */
exports.validateReversePayout = {
  params: settlementIdParam,
  body: Joi.object({
    reason: Joi.string().trim().min(3).max(500).required().messages({
      "any.required": "Please say why this payout is being reversed.",
      "string.empty": "Please say why this payout is being reversed.",
      "string.min": "Please give a little more detail.",
    }),
  }),
};
