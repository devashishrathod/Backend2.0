const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
const { resolveActorBrand } = require("../../helpers/brands");
const {
  validateUniqueIds,
  validateUniqueSortOrders,
  normalizeSortOrder,
} = require("../../helpers/showcases");

exports.reorderAllSections = async (actor, payload) => {
  let { sections, brandId } = payload;

  // `brandId` comes off the path, so it was previously whatever the caller
  // typed — a vendor could reorder another brand's showcase. Resolving it
  // through the actor pins a vendor to their own brand and still lets an admin
  // name any.
  const brand = await resolveActorBrand(actor, brandId);
  brandId = brand._id;

  validateUniqueIds(sections);
  validateUniqueSortOrders(sections);
  sections = normalizeSortOrder(sections);
  const ids = sections.map((item) => item.sectionId);
  const total = await ShowcaseSection.countDocuments({
    brandId,
    isDeleted: false,
    _id: { $in: ids },
  });
  if (total !== sections.length) {
    throwError(400, "Invalid section list.");
  }
  await ShowcaseSection.bulkWrite(
    sections.map((item) => ({
      updateOne: {
        filter: {
          _id: item.sectionId,
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
