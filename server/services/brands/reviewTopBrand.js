const Brand = require("../../models/Brand");
const { applyCuration, CURATION_FIELDS } = require("../../helpers/curation");

/**
 * Pin or unpin a brand on the customer app's "Top Brands" tab.
 *
 * Mirrors reviewVoucherSuggestion exactly — same helper, different field set.
 */
exports.reviewTopBrand = async (actor, payload) => {
  const { brandId, isTopBrand, topOrder } = payload;

  return applyCuration({
    model: Brand,
    id: brandId,
    fields: CURATION_FIELDS.BRAND,
    isCurated: isTopBrand,
    order: topOrder,
    actorId: actor.userId,
    notFoundMessage: "Brand not found!",
    projection: { brandName: 1, uniqueId: 1, isActive: 1 },
  });
};
