const BrandVerificationHistory = require("../../models/BrandVerificationHistory");

/**
 * Appends one immutable row to a brand's verification audit trail.
 *
 * Never updates an existing row — a second rejection on the same brand is a
 * second row, so the full "kitni bar, kab, kisne, kyu" story is preserved.
 *
 * @param {Object} payload         Row to append.
 * @param {Object} [session=null]  Mongo session, when called inside a txn.
 * @returns {Promise<Object>} The created history document.
 */
exports.recordBrandVerificationHistory = async (payload, session = null) => {
  const [history] = await BrandVerificationHistory.create(
    [
      {
        brandId: payload.brandId,
        systemVerifyId: payload.systemVerifyId,
        action: payload.action,
        performedByType: payload.performedByType,
        performedBy: payload.performedBy || null,
        attemptNumber: payload.attemptNumber,
        brandUniqueId: payload.brandUniqueId || null,
        merchantId: payload.merchantId || null,
        score: payload.score ?? null,
        previousStatus: payload.previousStatus || null,
        newStatus: payload.newStatus || null,
        reason: payload.reason || null,
        metadata: payload.metadata ?? null,
      },
    ],
    session ? { session } : {},
  );
  return history;
};
