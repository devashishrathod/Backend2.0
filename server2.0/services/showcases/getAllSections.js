const ShowcaseSection = require("../../models/ShowcaseSection");
const { pagination } = require("../../utils");
const { escapeRegex } = require("../../validator/common");
// const { validateVendorBrand } = require("../../helpers/showcase/common");

exports.getAllSections = async (userId, query) => {
  // const brand = await validateVendorBrand(userId);
  const { page, limit, search, sortBy, order, isActive, isVisible } = query;
  const pipeline = [];
  const match = {
    // brandId: brand._id,
    isActive: isActive !== undefined ? isActive : true,
    isVisible: isVisible !== undefined ? isVisible : true,
    isDeleted: false,
  };

  pipeline.push({ $match: match });

  if (search?.trim()) {
    pipeline.push({
      $match: {
        title: {
          $regex: escapeRegex(search.trim().toLowerCase()),
          $options: "i",
        },
      },
    });
  }

  pipeline.push({
    $project: {
      title: 1,
      description: 1,
      coverImage: 1,
      sectionType: 1,
      sortOrder: 1,
      isActive: 1,
      createdAt: 1,
      updatedAt: 1,
      mediaCount: {
        $size: {
          $filter: {
            input: "$medias",
            as: "media",
            cond: {
              $and: [
                { $eq: ["$$media.isDeleted", false] },
                { $eq: ["$$media.isActive", true] },
              ],
            },
          },
        },
      },

      photoCount: {
        $size: {
          $filter: {
            input: "$medias",
            as: "media",
            cond: {
              $and: [
                { $eq: ["$$media.type", "PHOTO"] },
                { $eq: ["$$media.isDeleted", false] },
                { $eq: ["$$media.isActive", true] },
              ],
            },
          },
        },
      },

      videoCount: {
        $size: {
          $filter: {
            input: "$medias",
            as: "media",
            cond: {
              $and: [
                { $eq: ["$$media.type", "VIDEO"] },
                { $eq: ["$$media.isDeleted", false] },
                { $eq: ["$$media.isActive", true] },
              ],
            },
          },
        },
      },
    },
  });

  pipeline.push({
    $sort: {
      [sortBy]: order === "asc" ? 1 : -1,
      _id: 1,
    },
  });
  return pagination(ShowcaseSection, pipeline, page, limit);
};
