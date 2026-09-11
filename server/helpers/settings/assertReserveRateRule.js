const { throwError } = require("../../utils");
const { SETTLEMENT_DEFAULTS } = require("../../constants/customer");

/**
 * Every reserve rate an admin sets has to be the rate that actually gets used.
 *
 * ```
 * percent      <=  maxPercent
 * riskPercent  <=  maxPercent
 * riskPercent  >=  percent
 * ```
 *
 * ### Why this is a refusal and not a silent correction
 *
 * `buildReserveRiskMap` ends with `Math.min(percent, maxPercent)`, and that
 * ceiling is deliberate — it is what stops a fat-fingered `percent: 90` from
 * emptying a vendor's payout. But a ceiling that quietly rewrites the number is
 * the same failure this whole settings surface keeps producing: the admin sets
 * 15, the platform applies 3, and every screen agrees with the admin because the
 * stored value really is 15. The arithmetic on the vendor's statement is then
 * correct and unreproducible at the same time.
 *
 * So the ceiling stays as defence in depth — it still guards a document written
 * before this rule, and the `riskPercent ?? basePercent` fallback inside the map
 * — and a rate that could never be reached is refused **here**, at the moment
 * somebody types it, where the error can name the other number.
 *
 * ### And why `riskPercent >= percent`
 *
 * `riskPercent` is the raised rate a brand pays once their chargebacks cross
 * both thresholds. Below `percent` it would hold **less** from a brand under
 * suspicion than from a clean one — backwards, and invisible: the brand still
 * gets money, nothing errors, and the platform's exposure is largest exactly
 * where it meant to be smallest. Equal is allowed and means "no extra penalty".
 *
 * ### Why not in the Joi validator
 *
 * `updateSetting` merges a **partial** payload. A PATCH of
 * `{ customer: { settlement: { reserve: { maxPercent: 3 } } } }` carries no
 * `percent` at all, so a request-shaped validator has nothing to compare it
 * against and the rule breaks silently — the same reason
 * `assertSettlementTimingRule` runs where it does. This runs on the **merged**
 * document, after the assign and before the save.
 *
 * Checked whether or not `reserve.isEnabled` is on. Validating only while it is
 * on would let the bad numbers in quietly and then fail the *switch-on* request,
 * naming fields that request never touched.
 *
 * @param {object} customer the merged `Setting.customer` sub-document
 * @throws {CustomError} 422 when a configured rate could never be applied
 */
exports.assertReserveRateRule = (customer = {}) => {
  const reserve = customer.settlement?.reserve || {};
  const d = SETTLEMENT_DEFAULTS.reserve;

  const percent = reserve.percent ?? d.percent;
  const riskPercent = reserve.riskPercent ?? d.riskPercent;
  const maxPercent = reserve.maxPercent ?? d.maxPercent;

  if (percent > maxPercent) {
    throwError(
      422,
      `The base reserve rate cannot be above its own ceiling. ` +
        `reserve.percent is ${percent}% and reserve.maxPercent is ${maxPercent}%, ` +
        `so every brand would be held at ${maxPercent}% and the ${percent}% would never apply. ` +
        `Raise maxPercent to at least ${percent}, or lower percent.`,
    );
  }

  if (riskPercent > maxPercent) {
    throwError(
      422,
      `The risk reserve rate cannot be above its own ceiling. ` +
        `reserve.riskPercent is ${riskPercent}% and reserve.maxPercent is ${maxPercent}%, ` +
        `so a risky brand would be held at ${maxPercent}% and the ${riskPercent}% would never apply. ` +
        `Raise maxPercent to at least ${riskPercent}, or lower riskPercent.`,
    );
  }

  if (riskPercent < percent) {
    throwError(
      422,
      `The risk reserve rate cannot be below the base rate. ` +
        `reserve.riskPercent is ${riskPercent}% and reserve.percent is ${percent}%, ` +
        `which would hold back less from a brand with chargebacks than from one without. ` +
        `Set riskPercent to at least ${percent}.`,
    );
  }

  return { percent, riskPercent, maxPercent };
};
