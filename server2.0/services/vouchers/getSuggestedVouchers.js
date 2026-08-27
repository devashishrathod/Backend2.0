const Voucher = require("../../models/Voucher");
const { buildAggregateLookup } = require("../../database");
const { pagination } = require("../../utils");
const { pickVoucherBanner } = require("../../helpers/vouchers");

/**
 * The admin's view of the "Suggestions" list.
 *
 * Deliberately NOT the customer pipeline. That one hides anything not currently
 * PUBLISHED and inside its validity window — which is right for the app, but
 * would make a voucher the admin pinned last week silently vanish from the
 * screen they manage it on. The admin needs to see everything they pinned,
 * including the entries that have since expired or been unpublished, so they
 * can decide whether to unpin them.
 *
 * `status` on each row is what tells them which is which.
 */
exports.getSuggestedVouchers = async (query) => {
  const { page = 1, limit = 10 } = query;

  const pipeline = [
    { $match: { isSuggested: true, isDeleted: false } },
    // Same order the customer sees, so the admin is arranging the real list.
    { $sort: { suggestionOrder: 1, suggestedAt: -1, _id: 1 } },
    {
      $project: {
        name: 1,
        description: 1,
        voucherCode: 1,
        status: 1,
        isActive: 1,
        banner: 1,
        suggestionOrder: 1,
        suggestedAt: 1,
        brandId: 1,
        suggestedBy: 1,
      },
    },
    ...buildAggregateLookup({
      from: "brands",
      localField: "brandId",
      as: "brand",
      project: { brandName: 1, logo: 1, uniqueId: 1 },
    }),
    ...buildAggregateLookup({
      from: "users",
      localField: "suggestedBy",
      as: "suggestedByUser",
      project: { name: 1, email: 1 },
    }),
  ];

  const result = await pagination(Voucher, pipeline, page, limit, "voucher");

  return {
    ...result,
    data: result.data.map(({ banner, ...voucher }) => ({
      ...voucher,
      ...pickVoucherBanner(banner),
    })),
  };
};
