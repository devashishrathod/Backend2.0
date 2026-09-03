const mongoose = require("mongoose")
const BrandFeatures = require("../../models/BrandFeatures");
const Brand = require("../../models/Brand");
const { pagination, throwError } = require("../../utils");

exports.getAllBrandFeatures = async (query) => {
  let {
    brandId,
    page,
    limit,
    search,
    title,
    isActive,
    fromDate,
    toDate,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 10;

  const brand = await Brand.exists({ _id: brandId, isDeleted: false });
  if (!brand) throwError(404, "Brand not found!");

  const match = {
    brandId: new mongoose.Types.ObjectId(brandId),
    isDeleted: false,
  };

  if (typeof isActive !== "undefined") {
    match.isActive = isActive === "true" || isActive === true;
  }

  if (title) match.title = { $regex: new RegExp(title, "i") };

  if (search) {
    match.$or = [
      { title: { $regex: new RegExp(search, "i") } },
      { description: { $regex: new RegExp(search, "i") } },
    ];
  }

  if (fromDate || toDate) {
    match.createdAt = {};
    if (fromDate) match.createdAt.$gte = new Date(fromDate);
    if (toDate) {
      const d = new Date(toDate);
      d.setHours(23, 59, 59, 999);
      match.createdAt.$lte = d;
    }
  }

  const pipeline = [
    { $match: match },
    {
      $project: {
        brandId: 1,
        title: 1,
        description: 1,
        icon: 1,
        isActive: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  ];
  const sortStage = {};
  sortStage[sortBy] = sortOrder === "asc" ? 1 : -1;
  pipeline.push({ $sort: sortStage });
  return await pagination(BrandFeatures, pipeline, page, limit);
};
