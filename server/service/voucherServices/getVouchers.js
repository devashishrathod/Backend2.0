const mongoose = require("mongoose");
const { ROLES } = require("../../constants");
const User = require("../../model/User");
const Voucher = require("../../model/Voucher");
const Location = require("../../model/Location");
const { throwError } = require("../../utils");

exports.getVouchers = async (userId, query) => {
  const user = await User.findById(userId);
  if (!user) throwError(404, "User not found");
  let {
    brandId,
    subBrandId,
    categoryId,
    subCategoryId,
    status,
    isPublished,
    isActive,
    validFrom,
    validTill,
    page = 1,
    limit = 10,
    sortBy = "createdAt",
    sortOrder = "desc",
    onlyLiked = false,
    voucherType,
    userLat,
    userLng,
    minRating,
    maxRating,
    exactRating,
    minOffer,
    maxOffer,
    exactOffer,
    minPrice,
    maxPrice,
    exactPrice,
    maxDistance, // km
  } = query;
  const filter = { isDeleted: false };
  if (brandId && mongoose.isValidObjectId(brandId)) {
    filter.brand = new mongoose.Types.ObjectId(brandId);
  }
  if (subBrandId && mongoose.isValidObjectId(subBrandId)) {
    filter.subBrands = new mongoose.Types.ObjectId(subBrandId);
  }
  if (categoryId && mongoose.isValidObjectId(categoryId)) {
    filter.category = new mongoose.Types.ObjectId(categoryId);
  }
  if (subCategoryId && mongoose.isValidObjectId(subCategoryId)) {
    filter.subCategory = new mongoose.Types.ObjectId(subCategoryId);
  }
  if (status) filter.status = status;
  if (isPublished !== undefined) filter.isPublished = isPublished === "true";
  if (isActive !== undefined) filter.isActive = isActive === "true";
  if (validFrom || validTill) {
    filter.validFrom = {};
    if (validFrom) filter.validFrom.$gte = new Date(validFrom);
    if (validTill) filter.validFrom.$lte = new Date(validTill);
  }
  if (minOffer || maxOffer) filter.discount = {};
  if (minOffer) filter.discount.$gte = Number(minOffer);
  if (maxOffer) filter.discount.$lte = Number(maxOffer);
  if (minPrice || maxPrice || voucherType) filter.minOrderAmount = {};
  if (minPrice) filter.minOrderAmount.$gte = Number(minPrice);
  if (maxPrice) filter.minOrderAmount.$lte = Number(maxPrice);
  if (voucherType === "Very Low") filter.minOrderAmount.$lte = 5000;
  if (voucherType === "Very High") filter.minOrderAmount.$gte = 50000;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const pipeline = [];
  if (user.role === ROLES.USER && user.location) {
    const userLocation = await Location.findById(user.location).select(
      "location.coordinates"
    );
    const coords = userLocation?.location?.coordinates;
    if (
      Array.isArray(coords) &&
      coords.length === 2 &&
      Number.isFinite(coords[0]) &&
      Number.isFinite(coords[1]) &&
      !(coords[0] === 0 && coords[1] === 0)
    ) {
      userLng = coords[0]; // longitude
      userLat = coords[1]; // latitude
    }
  }
  if (userLat && userLng) {
    pipeline.push({
      $geoNear: {
        near: {
          type: "Point",
          coordinates: [parseFloat(userLng), parseFloat(userLat)],
        },
        distanceField: "distance",
        spherical: true,
        ...(maxDistance && { maxDistance: parseFloat(maxDistance) * 1000 }), // km -> meters
        query: { isDeleted: false },
      },
    });
    pipeline.push({
      $lookup: {
        from: "subbrands",
        localField: "_id", // location._id -> subbrand.location
        foreignField: "location",
        as: "subBrand",
      },
    });
    pipeline.push({ $unwind: "$subBrand" });
    pipeline.push({
      $lookup: {
        from: "vouchers",
        localField: "subBrand._id",
        foreignField: "subBrands",
        as: "voucher",
      },
    });
    pipeline.push({ $unwind: "$voucher" });
    pipeline.push({
      $group: {
        _id: "$voucher._id",
        doc: { $first: "$voucher" },
        nearestDistance: { $min: "$distance" },
      },
    });
    pipeline.push({
      $replaceRoot: {
        newRoot: {
          $mergeObjects: ["$doc", { distance: "$nearestDistance" }],
        },
      },
    });
    pipeline.push({ $match: filter });
  } else {
    pipeline.push({ $match: filter });
  }
  pipeline.push(
    { $match: filter },
    {
      $lookup: {
        from: "favoritevouchers",
        let: { voucherId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$voucher", "$$voucherId"] },
                  { $eq: ["$user", new mongoose.Types.ObjectId(userId)] },
                  { $eq: ["$isDeleted", false] },
                ],
              },
            },
          },
        ],
        as: "userLiked",
      },
    },
    {
      $addFields: {
        isLiked: {
          $cond: [{ $gt: [{ $size: "$userLiked" }, 0] }, true, false],
        },
      },
    },
    ...(onlyLiked === "true" ? [{ $match: { isLiked: true } }] : [])
  );
  pipeline.push(
    {
      $lookup: {
        from: "feedbacks",
        let: { vId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$voucher", "$$vId"] },
                  { $eq: ["$isDeleted", false] },
                  { $eq: ["$isBlocked", false] },
                ],
              },
            },
          },
          {
            $group: {
              _id: "$voucher",
              avgRating: { $avg: "$rating" },
              totalReviews: { $sum: 1 },
            },
          },
        ],
        as: "ratingStats",
      },
    },
    {
      $addFields: {
        avgRating: {
          $ifNull: [{ $arrayElemAt: ["$ratingStats.avgRating", 0] }, 0],
        },
        totalReviews: {
          $ifNull: [{ $arrayElemAt: ["$ratingStats.totalReviews", 0] }, 0],
        },
      },
    }
  );
  if (exactRating !== undefined && exactRating !== null && exactRating !== "") {
    pipeline.push({ $match: { avgRating: Number(exactRating) } });
  } else if (minRating || maxRating) {
    const ratingMatch = {};
    if (minRating) ratingMatch.$gte = Number(minRating);
    if (maxRating) ratingMatch.$lte = Number(maxRating);
    pipeline.push({ $match: { avgRating: ratingMatch } });
  }
  const exactMatch = {};
  if (exactPrice !== undefined && exactPrice !== null && exactPrice !== "") {
    exactMatch.minOrderAmount = Number(exactPrice);
  }
  if (exactOffer !== undefined && exactOffer !== null && exactOffer !== "") {
    exactMatch.discount = Number(exactOffer);
  }
  if (Object.keys(exactMatch).length) {
    pipeline.push({ $match: exactMatch });
  }
  pipeline.push(
    {
      $lookup: {
        from: "brands",
        localField: "brand",
        foreignField: "_id",
        as: "brand",
      },
    },
    { $unwind: { path: "$brand", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "locations",
        localField: "brand.location",
        foreignField: "_id",
        as: "brand.location",
      },
    }
  );
  pipeline.push({
    $lookup: {
      from: "subbrands",
      let: { subBrandIds: "$subBrands" },
      pipeline: [
        { $match: { $expr: { $in: ["$_id", "$$subBrandIds"] } } },
        {
          $lookup: {
            from: "locations",
            localField: "location",
            foreignField: "_id",
            as: "location",
          },
        },
        {
          $lookup: {
            from: "bills",
            let: { sbId: "$_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$subBrandId", "$$sbId"] } } },
              {
                $group: {
                  _id: null,
                  billValues: { $sum: "$billAmount" },
                  earnValues: { $sum: "$finalPayable" },
                },
              },
            ],
            as: "billStats",
          },
        },
        {
          $addFields: {
            billValues: {
              $ifNull: [{ $arrayElemAt: ["$billStats.billValues", 0] }, 0],
            },
            earnValues: {
              $ifNull: [{ $arrayElemAt: ["$billStats.earnValues", 0] }, 0],
            },
          },
        },
        {
          $lookup: {
            from: "refunds",
            let: { sbId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$subBrand", "$$sbId"] },
                      { $eq: ["$status", "APPROVED"] },
                      { $eq: ["$isDeleted", false] },
                    ],
                  },
                },
              },
              {
                $group: { _id: null, refundValues: { $sum: "$refundAmount" } },
              },
            ],
            as: "refundStats",
          },
        },
        {
          $addFields: {
            refundValues: {
              $ifNull: [{ $arrayElemAt: ["$refundStats.refundValues", 0] }, 0],
            },
          },
        },
      ],
      as: "subBrands",
    },
  });
  pipeline.push(
    {
      $lookup: {
        from: "bills",
        let: { vId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$voucherId", "$$vId"] } } },
          {
            $group: {
              _id: null,
              invoices: { $sum: 1 },
              billValues: { $sum: "$billAmount" },
              earnValues: { $sum: "$finalPayable" },
            },
          },
        ],
        as: "voucherBillStats",
      },
    },
    {
      $addFields: {
        invoices: {
          $ifNull: [{ $arrayElemAt: ["$voucherBillStats.invoices", 0] }, 0],
        },
        billValues: {
          $ifNull: [{ $arrayElemAt: ["$voucherBillStats.billValues", 0] }, 0],
        },
        earnValues: {
          $ifNull: [{ $arrayElemAt: ["$voucherBillStats.earnValues", 0] }, 0],
        },
        outlets: { $size: "$subBrands" },
      },
    },
    {
      $lookup: {
        from: "refunds",
        let: { vId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$voucher", "$$vId"] },
                  { $eq: ["$status", "APPROVED"] },
                  { $eq: ["$isDeleted", false] },
                ],
              },
            },
          },
          { $group: { _id: null, refundValues: { $sum: "$refundAmount" } } },
        ],
        as: "voucherRefundStats",
      },
    },
    {
      $addFields: {
        refundValues: {
          $ifNull: [
            { $arrayElemAt: ["$voucherRefundStats.refundValues", 0] },
            0,
          ],
        },
      },
    }
  );
  const sortOption = {};
  if (sortBy === "rating") sortOption.avgRating = sortOrder === "asc" ? 1 : -1;
  else if (sortBy === "offer")
    sortOption.discount = sortOrder === "asc" ? 1 : -1;
  else if (sortBy === "price")
    sortOption.minOrderAmount = sortOrder === "asc" ? 1 : -1;
  else if (sortBy === "distance")
    sortOption.distance = sortOrder === "asc" ? 1 : -1;
  else sortOption[sortBy] = sortOrder === "asc" ? 1 : -1;

  pipeline.push({
    $addFields: {
      distance: { $ifNull: ["$distance", null] }, // or 0 if you prefer
    },
  });

  pipeline.push(
    { $sort: sortOption },
    {
      $facet: {
        vouchers: [{ $skip: skip }, { $limit: parseInt(limit, 10) }],
        totalCount: [{ $count: "count" }],
      },
    },
    {
      $addFields: {
        total: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
      },
    }
  );
  const result =
    userLat && userLng
      ? await Location.aggregate(pipeline)
      : await Voucher.aggregate(pipeline);
  const totalCount = result[0]?.total || 0;
  if (totalCount === 0) throwError(404, "No any vouchers not found");
  return {
    total: totalCount,
    totalPages: Math.ceil(totalCount / limit),
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    vouchers: result[0]?.vouchers || [],
  };
};
