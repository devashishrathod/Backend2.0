const mongoose = require("mongoose");
const { SHOWCASE_MEDIA_TYPE } = require("../../constants/showcase");
const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");

exports.getAllVideoClips = async (query) => {
  let { brandId, page, limit } = query;
  page = page || 1;
  limit = limit || 10;
  const skip = (page - 1) * limit;
  const pipeline = [
    {
      $match: {
        brandId: new mongoose.Types.ObjectId(brandId),
        isActive: true,
        isDeleted: false,
        isVisible: true,
        isShowVideosInClips: true,
      },
    },
    { $unwind: "$medias" },
    {
      $match: {
        "medias.type": SHOWCASE_MEDIA_TYPE.VIDEO,
        "medias.isActive": true,
        "medias.isDeleted": false,
        "medias.isShowInVideoClips": true,
      },
    },
    {
      $sort: { sortOrder: 1, "medias.sortOrder": 1, createdAt: -1 },
    },
    {
      $facet: {
        totalCount: [{ $count: "count" }],
        data: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              sectionId: "$_id",
              sectionTitle: "$title",
              sectionCoverImage: "$coverImage",
              video: {
                _id: "$medias._id",
                type: "$medias.type",
                url: "$medias.url",
                thumbnail: { $ifNull: ["$medias.thumbnail", "$coverImage"] },
                title: "$medias.title",
                altText: "$medias.altText",
                createdAt: "$medias.createdAt",
                resolution: {
                  width: "$medias.metadata.width",
                  height: "$medias.metadata.height",
                },
                duration: { $ifNull: ["$medias.metadata.duration", 0] },
                sortOrder: "$medias.sortOrder",
              },
            },
          },
        ],
      },
    },
  ];
  const [result] = await ShowcaseSection.aggregate(pipeline);
  const total = result?.totalCount?.[0]?.count || 0;
  if (total <= 0) throwError(404, "No video clips found for this brand");
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
    data: result?.data || [],
  };
};
