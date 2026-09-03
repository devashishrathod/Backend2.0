const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  approveSettlement,
  rebuildSettlement,
  cancelSettlement,
  abandonSettlement,
  holdSettlement,
  startPayout,
  confirmPayout,
  failPayout,
  retryPayout,
  reversePayout,
} = require("../../services/settlements");

exports.approve = asyncWrapper(async (req, res) => {
  const result = await approveSettlement(req, req.params.settlementId, req.body);
  return sendSuccess(res, 200, "Settlement approved successfully.", result);
});

exports.rebuild = asyncWrapper(async (req, res) => {
  const result = await rebuildSettlement(req, req.params.settlementId, req.body);
  return sendSuccess(
    res,
    200,
    `Settlement rebuilt without ${result.removed} ineligible payment(s).`,
    result,
  );
});

exports.hold = asyncWrapper(async (req, res) => {
  const result = await holdSettlement(req, req.params.settlementId, req.body);
  return sendSuccess(res, 200, "Settlement put on hold.", result);
});

exports.cancel = asyncWrapper(async (req, res) => {
  const result = await cancelSettlement(req, req.params.settlementId, req.body);
  return sendSuccess(res, 200, "Settlement cancelled successfully.", result);
});

/**
 * The exit for a payout that will never go through.
 *
 * `FAILED -> ABANDONED` is the only way a failed settlement releases its rows,
 * and nothing called it — so a brand that closed, or an account that cannot be
 * corrected, left its takings claimed by a settlement nobody would ever pay.
 */
exports.abandon = asyncWrapper(async (req, res) => {
  const result = await abandonSettlement(req, req.params.settlementId, req.body);
  return sendSuccess(
    res,
    200,
    `Payout abandoned; ${result.released?.transactions ?? 0} payment(s) released into the next cycle.`,
    result,
  );
});

exports.pay = asyncWrapper(async (req, res) => {
  const result = await startPayout(req, req.params.settlementId, req.body);
  return sendSuccess(res, 200, "Payout started successfully.", result);
});

/**
 * `MANUAL_BANK` has no callback — a person is the confirmation, which is why the
 * UTR is required and why this is a separate step from starting the payout.
 */
exports.confirm = asyncWrapper(async (req, res) => {
  const result = await confirmPayout(req, req.params.settlementId, req.body);
  return sendSuccess(
    res,
    200,
    result.settled
      ? "Payout confirmed; the settlement is paid."
      : `Leg recorded. ₹${result.remaining.toFixed(2)} still to go.`,
    result,
  );
});

exports.fail = asyncWrapper(async (req, res) => {
  const result = await failPayout(req, req.params.settlementId, req.body);
  return sendSuccess(res, 200, "Payout marked as failed.", result);
});

exports.retry = asyncWrapper(async (req, res) => {
  const result = await retryPayout(req, req.params.settlementId);
  return sendSuccess(
    res,
    200,
    "Ready to retry — bank details refreshed.",
    result,
  );
});

exports.reverse = asyncWrapper(async (req, res) => {
  const result = await reversePayout(req, req.params.settlementId, req.body);
  return sendSuccess(res, 200, "Payout reversed successfully.", result);
});
