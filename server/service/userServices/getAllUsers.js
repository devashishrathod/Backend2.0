const User = require("../../model/User");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");

exports.getAllUsers = async (query) => {
  let { page, limit, uniqueId, role } = query;
  page = parseInt(query.page) || 1;
  limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;
  const match = { isDeleted: false };
  if (role) match.role = role;
  else match.role = ROLES.USER;

  if (uniqueId) match.uniqueId = uniqueId;
  if (query.isActive !== undefined) match.isActive = query.isActive === "true";
  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: "locations",
        localField: "location",
        foreignField: "_id",
        as: "location",
      },
    },
    { $unwind: { path: "$location", preserveNullAndEmptyArrays: true } },
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
        from: "subbrands",
        localField: "subBrand",
        foreignField: "_id",
        as: "subBrand",
      },
    },
    { $unwind: { path: "$subBrand", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        name: 1,
        lastActivity: 1,
        uniqueId: 1,
        isActive: 1,
        brand: {
          _id: "$brand._id",
          name: "$brand.name",
          logo: "$brand.logo",
        },
        subBrand: {
          _id: "$subBrand._id",
          brandId: "$subBrand.brand",
          companyName: "$subBrand.companyName",
          logo: "$subBrand.logo",
        },
        location: {
          shopOrBuildingNumber: "$location.shopOrBuildingNumber",
          address: "$location.address",
          area: "$location.area",
          state: "$location.state",
          city: "$location.city",
          country: "$location.country",
          zipCode: "$location.zipCode",
        },
      },
    },
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: limit }],
        totalCount: [{ $count: "count" }],
      },
    },
    {
      $project: {
        data: 1,
        total: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
      },
    },
  ];
  const result = await User.aggregate(pipeline);
  const total = result[0]?.total;
  if (total === 0) throwError(404, "No any user found");
  return {
    total,
    page,
    limit,
    data: result[0]?.data || [],
  };
};
