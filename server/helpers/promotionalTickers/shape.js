const { toMediaResponse } = require("../media");

/**
 * What an admin sees of a promotional ticker.
 *
 * ### 🔴 The same hole the customer feed had
 *
 * `getTicker` returned the mongoose document and `getAllTickers` returned raw
 * aggregation output, so `icon.storage` went out with both — `publicId` on
 * Cloudinary, `bucket` and `key` on S3. The customer route was fixed in A-3
 * because it was public and unauthenticated; these two are behind an admin gate,
 * which makes them less urgent and not less wrong.
 *
 * A whitelist, so a column added to the schema tomorrow does not reach the panel
 * until somebody writes it down here.
 */
exports.toAdminTickerShape = (ticker) => {
  if (!ticker) return null;

  const plain = ticker.toObject ? ticker.toObject() : ticker;

  return {
    _id: plain._id,
    title: plain.title,
    icon: toMediaResponse(plain.icon, { forAdmin: true }),
    redirect: {
      type: plain.redirect?.type ?? null,
      targetId: plain.redirect?.targetId ?? null,
      url: plain.redirect?.url ?? null,
    },
    displayOrder: plain.displayOrder ?? 0,
    startDate: plain.startDate ?? null,
    endDate: plain.endDate ?? null,
    isActive: plain.isActive,
    createdBy: plain.createdBy ?? null,
    updatedBy: plain.updatedBy ?? null,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
};

exports.toAdminTickerListShape = (rows = []) =>
  (rows || []).map(exports.toAdminTickerShape);
