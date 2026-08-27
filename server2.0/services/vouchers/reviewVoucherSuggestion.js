const Voucher = require("../../models/Voucher");
const { applyCuration, CURATION_FIELDS } = require("../../helpers/curation");

/**
 * Pin or unpin a voucher on the customer app's "Suggestions" tab.
 *
 * One call for both directions — `isSuggested: false` removes it. Reordering an
 * already-pinned voucher is the same call with a new `suggestionOrder`.
 */
exports.reviewVoucherSuggestion = async (actor, payload) => {
  const { voucherId, isSuggested, suggestionOrder } = payload;

  return applyCuration({
    model: Voucher,
    id: voucherId,
    fields: CURATION_FIELDS.VOUCHER,
    isCurated: isSuggested,
    order: suggestionOrder,
    actorId: actor.userId,
    notFoundMessage: "Voucher not found.",
    projection: { name: 1, voucherCode: 1, status: 1 },
  });
};
