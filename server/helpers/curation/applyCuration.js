const { throwError } = require("../../utils");

/**
 * Pin or unpin a document on an admin-curated list.
 *
 * Vouchers ("Suggestions") and brands ("Top Brands") are curated identically —
 * a boolean, an order, and who stamped it — so the rule lives here once rather
 * than being written twice and drifting.
 *
 * Add and remove are the same call: pass the flag. That mirrors how
 * `updateSubBrand` treats `isActive`, and it means the admin UI needs one
 * endpoint per list, not two.
 *
 * @param {object} args
 * @param {import("mongoose").Model} args.model
 * @param {string} args.id                 document to curate
 * @param {object} args.fields             { flag, order, stampedAt, stampedBy }
 * @param {boolean} args.isCurated
 * @param {number} [args.order]            only meaningful when curating
 * @param {string} args.actorId
 * @param {string} args.notFoundMessage
 * @param {object} [args.projection]       extra fields to return
 */
exports.applyCuration = async ({
  model,
  id,
  fields,
  isCurated,
  order,
  actorId,
  notFoundMessage,
  projection = {},
}) => {
  const doc = await model.findOne({ _id: id, isDeleted: false });
  if (!doc) throwError(404, notFoundMessage);

  if (isCurated) {
    doc[fields.flag] = true;
    if (order !== undefined) doc[fields.order] = order;
    // Only stamped on the transition, so re-ordering an already-curated entry
    // does not rewrite who first picked it or when.
    if (!doc[fields.stampedAt]) {
      doc[fields.stampedAt] = new Date();
      doc[fields.stampedBy] = actorId;
    }
  } else {
    doc[fields.flag] = false;
    doc[fields.order] = 0;
    // Cleared so the next pick records a fresh stamp rather than inheriting the
    // previous one.
    doc[fields.stampedAt] = null;
    doc[fields.stampedBy] = null;
  }

  // `validateBeforeSave: false` because these documents predate several field
  // validators — a legacy row would otherwise fail on a field this call never
  // touches. Same workaround as deleteBanner.js.
  await doc.save({ validateBeforeSave: false });

  return {
    _id: doc._id,
    [fields.flag]: doc[fields.flag],
    [fields.order]: doc[fields.order],
    [fields.stampedAt]: doc[fields.stampedAt],
    ...Object.keys(projection).reduce(
      (acc, key) => ({ ...acc, [key]: doc[key] }),
      {},
    ),
  };
};

/** Field names for each curated list, so callers never spell them by hand. */
exports.CURATION_FIELDS = Object.freeze({
  VOUCHER: Object.freeze({
    flag: "isSuggested",
    order: "suggestionOrder",
    stampedAt: "suggestedAt",
    stampedBy: "suggestedBy",
  }),
  BRAND: Object.freeze({
    flag: "isTopBrand",
    order: "topOrder",
    stampedAt: "topAddedAt",
    stampedBy: "topAddedBy",
  }),
});
