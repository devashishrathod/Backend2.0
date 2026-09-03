const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  getDisputes,
  getDispute,
  addVendorDisputeEvidence,
  getDisputeEvidencePack,
} = require("../../services/transactions");

/**
 * One endpoint, two shapes.
 *
 * ⚠️ The scope and the projection both come from the token inside the service —
 * a role gate here would mean two endpoints and two chances for one of them to
 * leak the customer's details or our own deadline queue to an outlet.
 */
exports.disputeList = asyncWrapper(async (req, res) => {
  // The whole request goes down, not a picked-apart actor — the same shape
  // `releaseHold` and the settlement reads use, so `role` and `brandId` stay
  // together with the id that gets stamped on any record.
  const result = await getDisputes(req, req.validatedData);
  return sendSuccess(res, 200, "Disputes fetched successfully", result);
});

/** The outlet adds what only they have — a bill number, a camera timestamp. */
exports.disputeAddEvidence = asyncWrapper(async (req, res) => {
  const result = await addVendorDisputeEvidence(
    req,
    req.params.disputeId,
    req.body,
  );
  return sendSuccess(res, 200, result.message, result);
});

/**
 * Everything we can prove, with the argument already written out.
 *
 * Admin only: it carries the customer's masked contact, the full claim timeline
 * and the case we intend to make.
 */
exports.disputeEvidencePack = asyncWrapper(async (req, res) => {
  const result = await getDisputeEvidencePack(req, req.params.disputeId);
  return sendSuccess(res, 200, "Evidence pack prepared", result);
});

/**
 * One dispute, in the same two shapes the list uses.
 *
 * ⚠️ The projections come from the list's own module rather than being spelled
 * out again — a detail read with its own projection is the ordinary way a field
 * the list hides ends up on a screen it was kept off.
 */
exports.disputeDetail = asyncWrapper(async (req, res) => {
  const result = await getDispute(req, req.params.disputeId);
  return sendSuccess(res, 200, "Dispute fetched successfully", result);
});
