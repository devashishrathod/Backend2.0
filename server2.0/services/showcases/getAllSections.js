const mongoose = require("mongoose");
const ShowcaseSection = require("../../models/ShowcaseSection");
const { ROLES } = require("../../constants");
const { pagination, throwError } = require("../../utils");
const { escapeRegex } = require("../../validator/common");
const { resolveActorBrand } = require("../../helpers/brands");

/**
 * List showcase sections, scoped to what the caller may see.
 *
 * The brand filter used to be commented out, so a vendor asking for "my
 * sections" was handed every brand's sections on the platform.
 *
 * - VENDOR is pinned to their own brand. A `brandId` in the query is resolved
 *   through `resolveActorBrand`, which rejects anything that is not theirs, so
 *   the filter cannot be widened from the request.
 * - ADMIN stays global by design: omitting `brandId` lists across every brand,
 *   passing one narrows to it.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 */
exports.getAllSections = async (actor, query) => {
  const { page, limit, search, sortBy, order, isActive, isVisible, brandId } =
    query;

  const match = {
    isActive: isActive !== undefined ? isActive : true,
    isVisible: isVisible !== undefined ? isVisible : true,
    isDeleted: false,
  };

  if (actor?.role === ROLES.VENDOR) {
    const brand = await resolveActorBrand(actor, brandId);
    match.brandId = new mongoose.Types.ObjectId(brand._id);
  } else if (actor?.role === ROLES.ADMIN) {
    if (brandId) match.brandId = new mongoose.Types.ObjectId(brandId);
  } else {
    throwError(403, "Forbidden");
  }

  const pipeline = [];
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
