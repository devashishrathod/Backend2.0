const mongoose = require("mongoose");
const Feedback = require("../../model/Feedback");
const User = require("../../model/User");

exports.getAllReviews = async (userId, query) => {
  const {
    page = 1,
    limit = 10,
    rating,
    brand,
    subBrand,
    voucher,
    user,
    isBlocked,
    isActive,
    search = "",
    startDate,
    endDate,
  } = query;
  const filter = {
    isDeleted: false,
    isBlocked: isBlocked !== undefined ? isBlocked === "true" : false,
    isActive: isActive !== undefined ? isActive === "true" : true,
  };
  if (rating) filter.rating = parseInt(rating);
  if (brand) filter.brand = new mongoose.Types.ObjectId(brand);
  if (subBrand) filter.subBrand = new mongoose.Types.ObjectId(subBrand);
  if (voucher) filter.voucher = new mongoose.Types.ObjectId(voucher);
  if (user) filter.user = new mongoose.Types.ObjectId(user);
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }
  if (search) {
    const searchRegex = new RegExp(search, "i");
    const matchedUser = await User.findOne({ uniqueId: search });
    if (matchedUser && !filter.user) {
      filter.user = matchedUser._id;
    } else {
      filter.$or = [{ review: { $regex: searchRegex } }];
    }
  }
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const aggregatePipeline = [
    { $match: filter },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
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
        as: "brandLocation",
      },
    },
    {
      $lookup: {
        from: "subbrands",
        localField: "subBrand",
        foreignField: "_id",
        as: "subBrand",
      },
    },
    { $unwind: { path: "$subBrand", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "locations",
        localField: "subBrand.location",
        foreignField: "_id",
        as: "subBrandLocation",
      },
    },
    {
      $lookup: {
        from: "images",
        localField: "imageIds",
        foreignField: "_id",
        as: "images",
      },
    },
    {
      $lookup: {
        from: "feedbacklikes",
        let: { feedbackId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$feedback", "$$feedbackId"] },
                  { $eq: ["$isDeleted", false] },
                ],
              },
            },
          },
          { $count: "count" },
        ],
        as: "likesData",
      },
    },
    {
      $lookup: {
        from: "feedbacklikes",
        let: { feedbackId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$feedback", "$$feedbackId"] },
                  { $eq: ["$user", new mongoose.Types.ObjectId(userId)] },
                  { $eq: ["$isDeleted", false] },
                ],
              },
            },
          },
        ],
        as: "userLikedData",
      },
    },
    {
      $addFields: {
        likedCount: {
          $ifNull: [{ $arrayElemAt: ["$likesData.count", 0] }, 0],
        },
        isLiked: {
          $gt: [{ $size: "$userLikedData" }, 0],
        },
      },
    },
    {
      $addFields: {
        likedCount: {
          $ifNull: [{ $arrayElemAt: ["$likesData.count", 0] }, 0],
        },
      },
    },
    {
      $lookup: {
        from: "feedbackreplies",
        let: { feedbackId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$feedback", "$$feedbackId"] },
                  { $eq: ["$isDeleted", false] },
                  { $eq: ["$isBlocked", false] },
                ],
              },
            },
          },
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
            $project: {
              _id: 1,
              reply: 1,
              createdAt: 1,
              updatedAt: 1,
              "brand.companyName": 1,
            },
          },
        ],
        as: "replies",
      },
    },
    {
      $addFields: {
        replyCount: { $size: "$replies" },
      },
    },
    {
      $facet: {
        data: [
          { $sort: { createdAt: -1 } },
          { $skip: skip },
          { $limit: parseInt(limit) },
          {
            $project: {
              review: 1,
              rating: 1,
              createdAt: 1,
              isBlocked: 1,
              isActive: 1,
              likedCount: 1,
              isLiked: 1,
              replyCount: 1,
              replies: 1,
              user: { name: 1, image: 1, uniqueId: 1 },
              brand: { companyName: 1 },
              brandLocation: {
                shopOrBuildingNumber: 1,
                address: 1,
                city: 1,
                area: 1,
                country: 1,
              },
              subBrand: { companyName: 1 },
              subBrandLocation: {
                shopOrBuildingNumber: 1,
                address: 1,
                city: 1,
                area: 1,
                country: 1,
              },
              images: { imageUrl: 1 },
            },
          },
        ],
        totalCount: [{ $count: "count" }],
        totalReplyCount: [
          {
            $group: {
              _id: null,
              totalReplies: { $sum: { $size: "$replies" } },
            },
          },
        ],
      },
    },
  ];
  const result = await Feedback.aggregate(aggregatePipeline);
  const data = result[0].data;
  const totalFeedbacks = result[0].totalCount[0]?.count || 0;
  const totalReplies = result[0].totalReplyCount[0]?.totalReplies || 0;
  let overallVoucherRating = null;
  let overallBrandRating = null;
  if (voucher) {
    const voucherRating = await Feedback.aggregate([
      {
        $match: {
          voucher: new mongoose.Types.ObjectId(voucher),
          isDeleted: false,
          isBlocked: false,
          isActive: true,
        },
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$rating" },
        },
      },
    ]);
    overallVoucherRating = voucherRating[0]?.averageRating || null;
  }
  if (brand) {
    const brandRating = await Feedback.aggregate([
      {
        $match: {
          brand: new mongoose.Types.ObjectId(brand),
          isDeleted: false,
          isBlocked: false,
          isActive: true,
        },
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$rating" },
        },
      },
    ]);
    overallBrandRating = brandRating[0]?.averageRating || null;
  }
  return {
    totalFeedbacks,
    totalReplies,
    totalPages: Math.ceil(totalFeedbacks / limit),
    page: parseInt(page),
    limit: parseInt(limit),
    overallVoucherRating,
    overallBrandRating,
    data,
  };
};
