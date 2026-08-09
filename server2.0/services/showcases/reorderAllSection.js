const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
//const { validateVendorBrand } = require("../../helpers/showcase/common");
const {
  validateUniqueIds,
  validateUniqueSortOrders,
  normalizeSortOrder,
} = require("../../helpers/showcases");

exports.reorderAllSections = async (userId, payload) => {
  //  const brand = await validateVendorBrand(user);
  let { sections, brandId } = payload;
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
