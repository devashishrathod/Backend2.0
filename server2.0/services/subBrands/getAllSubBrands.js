const mongoose = require("mongoose");
const SubBrand = require("../../models/SubBrand");
const { buildAggregateLookup } = require("../../database");
const { pagination, validateObjectId } = require("../../utils");

exports.getAllSubBrands = async (query) => {
  let {
    page,
    limit,
    search,
    userId,
    brandId,
    locationId,
    workHoursId,
    outletType,
    email,
    mobile,
    whatsappNumber,
    uniqueId,
    storeId,
    isActive,
    fromDate,
    toDate,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 10;

  const match = { isDeleted: false };

  if (userId) {
    validateObjectId(userId, "User Id");
    match.userId = new mongoose.Types.ObjectId(userId);
  }
  if (brandId) {
    validateObjectId(brandId, "Brand Id");
    match.brandId = new mongoose.Types.ObjectId(brandId);
  }
  if (locationId) {
    validateObjectId(locationId, "Location Id");
    match.locationId = new mongoose.Types.ObjectId(locationId);
  }
  if (workHoursId) {
    validateObjectId(workHoursId, "Work Hours Id");
    match.workHoursId = new mongoose.Types.ObjectId(workHoursId);
  }
  if (outletType) match.outletType = outletType;
  if (isActive !== undefined) {
    match.isActive = isActive === "true" || isActive === true;
  }
  if (email) match.email = { $regex: new RegExp(email, "i") };
  if (mobile) match.mobile = { $regex: new RegExp(mobile, "i") };
  if (whatsappNumber) {
    match.whatsappNumber = { $regex: new RegExp(whatsappNumber, "i") };
  }
  if (uniqueId) match.uniqueId = { $regex: new RegExp(uniqueId, "i") };
  if (storeId) match.storeId = { $regex: new RegExp(storeId, "i") };

  if (search) {
    match.$or = [
      { email: { $regex: new RegExp(search, "i") } },
      { mobile: { $regex: new RegExp(search, "i") } },
      { whatsappNumber: { $regex: new RegExp(search, "i") } },
      { uniqueId: { $regex: new RegExp(search, "i") } },
      { storeId: { $regex: new RegExp(search, "i") } },
      { description: { $regex: new RegExp(search, "i") } },
    ];
  }

  if (fromDate || toDate) {
    match.joinedDate = {};
    if (fromDate) match.joinedDate.$gte = new Date(fromDate);
    if (toDate) {
      const d = new Date(toDate);
      d.setHours(23, 59, 59, 999);
      match.joinedDate.$lte = d;
    }
  }

  const sortStage = {};
  sortStage[sortBy] = sortOrder === "asc" ? 1 : -1;

  const pipeline = [
    { $match: match },
    { $sort: sortStage },

    // =========================================================
    // SUB BRAND LOCATION
    // =========================================================
    ...buildAggregateLookup({
      from: "locations",
      localField: "locationId",
      as: "location",
    }),

    // =========================================================
    // SUB BRAND WORK HOURS
    // =========================================================
    ...buildAggregateLookup({
      from: "workhours",
      localField: "workHoursId",
      as: "workHours",
    }),

    { $project: { __v: 0 } },
  ];

  return await pagination(SubBrand, pipeline, page, limit);
};
