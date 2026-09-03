const BrandStatusHistory = require("../../models/BrandStatusHistory");

/**
 * Appends one immutable row to a brand's activate/deactivate audit trail.
 *
 * Mirrors `recordBrandVerificationHistory` — never updates an existing row, so
 * a second deactivation is a second row and the full "kitni bar, kab, kisne,
 * kyu" story survives.
 *
 * @param {Object} payload         Row to append.
 * @param {Object} [session=null]  Mongo session, when called inside a txn.
 * @returns {Promise<Object>} The created history document.
 */
exports.recordBrandStatusHistory = async (payload, session = null) => {
  const [history] = await BrandStatusHistory.create(
    [
      {
        brandId: payload.brandId,
        userId: payload.userId || null,
        action: payload.action,
        performedByType: payload.performedByType,
        performedBy: payload.performedBy || null,
        reason: payload.reason || null,
        brandUniqueId: payload.brandUniqueId || null,
        merchantId: payload.merchantId || null,
        previousState: payload.previousState || null,
        newState: payload.newState || null,
        metadata: payload.metadata ?? null,
      },
    ],
    session ? { session } : {},
  );
  return history;
};
