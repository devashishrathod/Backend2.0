const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
const { resolveActorBrand } = require("../../helpers/brands");
const {
  validateUniqueIds,
  validateUniqueSortOrders,
  normalizeSortOrder,
} = require("../../helpers/showcases");

/**
 * Re-number a brand's sections from a full ordered list.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 */
exports.reorderAllSections = async (actor, payload) => {
  let { sections, brandId } = payload;

  // `brandId` comes off the path, so it was previously whatever the caller
  // typed — a vendor could reorder another brand's showcase. Resolving it
  // through the actor pins a vendor to their own brand and still lets an admin
  // name any.
  const brand = await resolveActorBrand(actor, brandId);
  brandId = brand._id;

  // The request field is `id` — that is what the validator accepts and what the
  // docs publish. This read `sectionId` instead, a key the payload never has,
  // so `validateUniqueIds` dereferenced `undefined` and the endpoint answered
  // every well-formed request with a 500. It has never worked.
  validateUniqueIds(sections, "id");
  validateUniqueSortOrders(sections);
  sections = normalizeSortOrder(sections);
  const ids = sections.map((item) => item.id);

  const [matched, total] = await Promise.all([
    ShowcaseSection.countDocuments({
      brandId,
      isDeleted: false,
      _id: { $in: ids },
    }),
    ShowcaseSection.countDocuments({ brandId, isDeleted: false }),
  ]);

  if (matched !== sections.length) {
    throwError(400, "Invalid section list.");
  }

  // `normalizeSortOrder` renumbers the payload 1..n, so a partial list would
  // hand out positions that the sections left out already hold — two sections
  // at `sortOrder: 1`, and an order that depends on which one Mongo returns
  // first. A drag-and-drop UI has the whole list anyway, and the media reorder
  // endpoint has always required it.
  if (total !== sections.length) {
    throwError(
      400,
      `Please send the complete section order — ${total} sections expected, ${sections.length} received.`,
    );
  }

  await ShowcaseSection.bulkWrite(
    sections.map((item) => ({
      updateOne: {
        filter: {
          _id: item.id,
          brandId,
        },
        update: {
          $set: {
            sortOrder: item.sortOrder,
          },
        },
      },
    })),
    {
      ordered: false,
    },
  );
  return { updated: sections.length };
};
