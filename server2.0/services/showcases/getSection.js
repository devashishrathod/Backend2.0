const mongoose = require("mongoose");
const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
const { escapeRegex } = require("../../validator/common");
const {
  resolveSectionForActor,
} = require("../../helpers/showcases");

exports.getSection = async (actor, query) => {
  // Reading another brand section metadata is still a leak, so the same
  // ownership rule applies to the read path.
  await resolveSectionForActor(actor, query.sectionId, {
    projection: { brandId: 1 },
  });

  let { sectionId, page, limit, type, search } = query;
  page = page || 1;
  limit = limit || 10;
  const skip = (page - 1) * limit;
  const mediaFilter = {
    $and: [
      { $eq: ["$$media.isActive", true] },
      { $eq: ["$$media.isDeleted", false] },
    ],
  };
  if (type) {
    mediaFilter.$and.push({
      $eq: ["$$media.type", type],
    });
  }
  if (search?.trim()) {
    const keyword = escapeRegex(search.trim().toLowerCase());
    mediaFilter.$and.push({
      $or: [
        {
          $regexMatch: {
            input: {
              $toLower: {
                $ifNull: ["$$media.title", ""],
              },
            },
            regex: keyword,
          },
        },
        {
          $regexMatch: {
            input: {
              $toLower: {
                $ifNull: ["$$media.altText", ""],
              },
            },
            regex: keyword,
          },
        },
      ],
    });
  }

  const pipeline = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(sectionId),
        //   brandId: brand._id,
        isDeleted: false,
      },
    },
    {
      $project: {
        title: 1,
        description: 1,
        coverImage: 1,
        sectionType: 1,
        sortOrder: 1,
        isActive: 1,
        createdAt: 1,
        updatedAt: 1,
        medias: {
          $filter: {
            input: "$medias",
            as: "media",
            cond: mediaFilter,
          },
        },
      },
    },
    {
      $addFields: {
        mediaCount: {
          $size: "$medias",
        },
        photoCount: {
          $size: {
            $filter: {
              input: "$medias",
              as: "media",
              cond: {
                $eq: ["$$media.type", "PHOTO"],
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
                $eq: ["$$media.type", "VIDEO"],
              },
            },
          },
        },
      },
    },
  ];

  const sections = await ShowcaseSection.aggregate(pipeline);
  if (!sections.length) throwError(404, "Section not found.");
  const section = sections[0];
  section.medias.sort((a, b) => a.sortOrder - b.sortOrder);
  const paginatedMedia = section.medias.slice(skip, skip + limit);
  const media = paginatedMedia.map(({ storage, ...item }) => item);
  delete section.medias;
  return {
    ...section,
    media: {
      page,
      limit,
      total: section.mediaCount,
      totalPages: Math.ceil(section.mediaCount / limit),
      data: media,
    },
  };
};
