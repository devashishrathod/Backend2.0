const { throwError } = require("../../utils");
const {
  SETTLEMENT_DEFAULTS,
  REFUND_DEFAULTS,
} = require("../../constants/customer");

/**
 * The one rule that keeps a refund from ever touching money the vendor already has.
 *
 * ```
 * delayDays * 24  >=  windowHours + vendorApprovalHours + adminBufferHours
 * ```
 *
 * A refund reduces that cycle's payable — nothing more. That only works while
 * every refund is fully resolved *before* the settlement it belongs to leaves.
 * Break the inequality and the platform is recovering money from a vendor who
 * has already banked it: negative balances, a conversation nobody wants to have,
 * and a reconciliation problem that surfaces weeks later rather than at save
 * time.
 *
 * ### Why this is not in the Joi validator
 *
 * `updateSetting` merges a **partial** payload. A PATCH of
 * `{ customer: { refund: { windowHours: 48 } } }` carries no `settlement` block
 * at all, so a request-shaped validator has nothing to compare against and the
 * rule breaks silently. This runs on the **merged** document instead — after the
 * assign, before the save — which is the only place both halves are visible.
 *
 * Falls back to the constants for anything the merged object is missing, so it
 * behaves the same on a document that predates these blocks.
 *
 * @param {object} customer the merged `Setting.customer` sub-document
 * @throws {CustomError} 422 when the windows no longer fit inside the delay
 */
exports.assertSettlementTimingRule = (customer = {}) => {
  const settlement = customer.settlement || {};
  const refund = customer.refund || {};

  const delayDays = settlement.delayDays ?? SETTLEMENT_DEFAULTS.delayDays;
  const windowHours = refund.windowHours ?? REFUND_DEFAULTS.windowHours;
  const vendorApprovalHours =
    refund.vendorApprovalHours ?? REFUND_DEFAULTS.vendorApprovalHours;
  const adminBufferHours =
    refund.adminBufferHours ?? REFUND_DEFAULTS.adminBufferHours;

  const settlementDelayHours = delayDays * 24;
  const refundPathHours = windowHours + vendorApprovalHours + adminBufferHours;

  if (settlementDelayHours < refundPathHours) {
    throwError(
      422,
      `A refund could outlive the settlement it belongs to. Paying out on T+${delayDays} gives ${settlementDelayHours}h, ` +
        `but the refund path needs ${refundPathHours}h ` +
        `(${windowHours}h for the customer to raise it + ${vendorApprovalHours}h for the vendor to respond + ${adminBufferHours}h for admin). ` +
        `Either raise settlement.delayDays to ${Math.ceil(refundPathHours / 24)} or shorten the refund windows.`,
    );
  }

  return { settlementDelayHours, refundPathHours };
};
