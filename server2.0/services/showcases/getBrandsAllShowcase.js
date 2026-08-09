const mongoose = require("mongoose");
const ShowcaseSection = require("../../models/ShowcaseSection");

exports.getBrandsAllShowcase = async (data) => {
  const sections = await ShowcaseSection.aggregate([
    {
      $match: {
        brandId: new mongoose.Types.ObjectId(data.brandId),
        isActive: true,
        isDeleted: false,
      },
    },
    {
      $project: {
        title: 1,
        description: 1,
        coverImage: 1,
        sortOrder: 1,
        sectionType: 1,
        medias: {
          $filter: {
            input: "$medias",
            as: "media",
            cond: {
              $and: [
                { $eq: ["$$media.isActive", true] },
                { $eq: ["$$media.isDeleted", false] },
              ],
            },
          },
        },
      },
    },
    { $sort: { sortOrder: 1 } },
  ]);
  return {
    brandId: data.brandId,
    sections: sections.map((section) => {
      section.medias.sort((a, b) => a.sortOrder - b.sortOrder);
      return {
        _id: section._id,
        title: section.title,
        description: section.description,
        coverImage: section.coverImage,
        sortOrder: section.sortOrder,
        sectionType: section.sectionType,
        mediaCount: section.medias.length,
        photoCount: section.medias.filter((x) => x.type === "PHOTO").length,
        videoCount: section.medias.filter((x) => x.type === "VIDEO").length,
        medias: section.medias.map(({ storage, metadata, ...item }) => item),
      };
    }),
  };
};
