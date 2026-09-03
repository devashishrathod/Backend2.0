const express = require("express");
const router = express.Router();

const {
  validateSchema,
  verifyJwtToken,
  isAdmin,
} = require("../middlewares");
const {
  listSettlements,
  settlementDetail,
  settlementTransactions,
  approve,
  rebuild,
  hold,
  cancel,
  abandon,
  pay,
  confirm,
  fail,
  retry,
  reverse,
  statementByToken,
  vendorDebt,
  vendorDebtWriteOff,
} = require("../controllers/settlements");
const {
  validateListSettlements,
  validateSettlementDetail,
  validateSettlementTransactions,
  validateApproveSettlement,
  validateRebuildSettlement,
  validateHoldSettlement,
  validateCancelSettlement,
  validateAbandonSettlement,
  validatePaySettlement,
  validateConfirmPayout,
  validateFailPayout,
  validateRetryPayout,
  validateReversePayout,
  validateStatementByToken,
  validateVendorDebt,
  validateWriteOffVendorDebt,
} = require("../validator/settlements");

/**
 * ---------------- the admin runs the payout ----------------
 *
 * Declared **above** the reads, because `/admin/...` is a literal first segment
 * and `/:settlementId` is a parameter. Express 5 matches in declaration order,
 * so a one-segment read route placed first would still not swallow these — they
 * differ in segment count — but `/admin/:id/approve` and a future
 * `/:settlementId/approve` would collide, and the ordering here is what decides
 * it. Cheaper to declare them in the safe order than to remember why later.
 *
 * Every one of these is `isAdmin`. There is no vendor-facing write on a
 * settlement at all: a vendor reads their money and disputes it through support,
 * because a settlement is our record of what we owe them, not a document they
 * fill in.
 */
/**
 * The public payout statement. **No JWT** — see the controller.
 *
 * ⚠️ Declared first, above every `:settlementId` route, for the reason the
 * transactions router declares its invoice link first: a literal second segment
 * must be matched before a parameter can swallow it. `/statement/:token` and
 * `/:settlementId/transactions` differ today only because `transactions` is a
 * literal, and that is too thin a margin to rely on the next route not closing.
 */
router.get(
  "/statement/:token",
  validateSchema(validateStatementByToken),
  statementByToken,
);

router.patch(
  "/admin/:settlementId/approve",
  isAdmin,
  validateSchema(validateApproveSettlement),
  approve,
);

/**
 * A held settlement, recomputed without the payments that went bad.
 *
 * Only the tainted rows are released; the clean ones stay claimed, which is what
 * stops the next nightly build taking them mid-rebuild.
 */
router.patch(
  "/admin/:settlementId/rebuild",
  isAdmin,
  validateSchema(validateRebuildSettlement),
  rebuild,
);

router.patch(
  "/admin/:settlementId/hold",
  isAdmin,
  validateSchema(validateHoldSettlement),
  hold,
);

/**
 * Cancelling releases every row back into the next cycle — nothing is lost, it
 * simply moves. Which is why the reason is required: the vendor's money changes
 * cycle because of this click.
 */
router.patch(
  "/admin/:settlementId/cancel",
  isAdmin,
  validateSchema(validateCancelSettlement),
  cancel,
);

/**
 * Give up on a payout that will never work.
 *
 * Only from `FAILED`, and only with a written reason. Retry stays the default —
 * this is the exit when retry is not the answer, and without it the settlement's
 * rows stay claimed for ever by something nobody will pay.
 */
router.patch(
  "/admin/:settlementId/abandon",
  isAdmin,
  validateSchema(validateAbandonSettlement),
  abandon,
);

/**
 * Money out.
 *
 * Two steps on purpose. `pay` opens a leg and compares the frozen payee against
 * the live bank account before anything moves; `confirm` records the UTR a
 * person read off their banking screen. `MANUAL_BANK` has no callback, so the
 * person **is** the callback, and collapsing the two would mean marking a
 * settlement paid before the NEFT was keyed in.
 */
router.patch(
  "/admin/:settlementId/pay",
  isAdmin,
  validateSchema(validatePaySettlement),
  pay,
);

router.patch(
  "/admin/:settlementId/confirm",
  isAdmin,
  validateSchema(validateConfirmPayout),
  confirm,
);

router.patch(
  "/admin/:settlementId/fail",
  isAdmin,
  validateSchema(validateFailPayout),
  fail,
);

/** A new leg with the next number, and a refreshed payee. The bounced one stays. */
router.patch(
  "/admin/:settlementId/retry",
  isAdmin,
  validateSchema(validateRetryPayout),
  retry,
);

/** The bank pulled it back after we had marked it paid. Ledger-first. */
router.patch(
  "/admin/:settlementId/reverse",
  isAdmin,
  validateSchema(validateReversePayout),
  reverse,
);

/**
 * ---------------- what a brand owes us ----------------
 *
 * ### ⚠️ Keyed on the brand, not on a settlement
 *
 * This is exactly the money no settlement was able to carry, so a settlement id
 * is the one key that by definition does not hold it. A brand whose deductions
 * outrun their takings builds a settlement with a negative `netPayable`; that
 * goes `CARRIED_FORWARD`, and carrying forward **is** releasing every claim it
 * held. While they still trade, new sales net it off. The day they stop, the
 * same rows are claimed and released every cycle for ever — nothing errors,
 * nothing is logged, and no report shows it.
 *
 * ⚠️ Declared **above** `/:settlementId`, with the rest of the literal-first
 * segments, for the reason given at the top of this file.
 *
 * Admin only, both of them. A vendor sees the consequence — the cycle that paid
 * them nothing, and why — through `SETTLEMENT_CARRIED_FORWARD` and their own
 * statement. What they must not see is a screen headed "outstanding debt" with a
 * figure on it: it reads as an invoice, and there is nothing for them to pay.
 */
router.get(
  "/admin/debt/:brandId",
  isAdmin,
  validateSchema(validateVendorDebt),
  vendorDebt,
);

/**
 * Stop chasing it, and say so in the books.
 *
 * Writes a matched pair of `MANUAL_ADJUSTMENT`s per row — crediting the vendor's
 * balance so no future cycle sees a debt, and debiting `PLATFORM_COST` because
 * we absorbed it. Requires a written reason: the ledger is never edited, and an
 * unexplained adjustment cannot be told apart from a mistake months later.
 */
router.patch(
  "/admin/debt/:brandId/write-off",
  isAdmin,
  validateSchema(validateWriteOffVendorDebt),
  vendorDebtWriteOff,
);

/**
 * ---------------- reading them ----------------
 *
 * `verifyJwtToken` rather than a role gate: **one endpoint, two shapes.** The
 * scope and the projection are both derived from the token inside, so the vendor
 * panel and the admin worklist call the same URL. A role gate here would mean
 * two endpoints and two chances for one of them to leak `bankSnapshot` or the
 * commission we take.
 *
 * A `CUSTOMER` token is refused inside `scopeFor` with a 403 — a settlement has
 * nothing in it that belongs to them.
 */
router.get(
  "/",
  verifyJwtToken,
  validateSchema(validateListSettlements),
  listSettlements,
);

router.get(
  "/:settlementId",
  verifyJwtToken,
  validateSchema(validateSettlementDetail),
  settlementDetail,
);

/**
 * The statement lines — the payments this settlement actually paid for.
 *
 * Paged away from the detail because a busy brand's cycle is hundreds of rows,
 * and the detail call is mostly read to answer "how much, and when".
 */
router.get(
  "/:settlementId/transactions",
  verifyJwtToken,
  validateSchema(validateSettlementTransactions),
  settlementTransactions,
);

module.exports = router;
