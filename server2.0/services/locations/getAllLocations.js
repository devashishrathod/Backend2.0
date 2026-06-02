const { default: mongoose } = require("mongoose");
const Location = require("../../models/Location");
const { pagination, validateObjectId } = require("../../utils");

exports.getAllLocations = async (query) => {
  let {
    page,
    limit,
    search,
    name,
    shopOrBuildingNumber,
    userId,
    address,
    area,
    city,
    district,
    state,
    zipcode,
    country,
    isActive,
    fromDate,
    toDate,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;
  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 10;
  const match = { isDeleted: false };
  if (typeof isActive !== "undefined") {
    match.isActive = isActive === "true" || isActive === true;
  }
  if (city) match.city = city?.toLowerCase();
  if (district) match.district = district?.toLowerCase();
  if (state) match.state = state?.toLowerCase();
  if (zipcode) match.zipcode = zipcode?.toLowerCase();
  if (country) match.country = country?.toLowerCase();
  if (userId) {
    validateObjectId(userId, "User Id");
    match.userId = new mongoose.Types.ObjectId(userId);
  }
  if (name) match.name = { $regex: new RegExp(name, "i") };
  if (address) match.address = { $regex: new RegExp(address, "i") };
  if (area) match.area = { $regex: new RegExp(area, "i") };
  if (shopOrBuildingNumber) {
    match.shopOrBuildingNumber = {
      $regex: new RegExp(shopOrBuildingNumber, "i"),
    };
  }
  if (search) {
    match.$or = [
      { name: { $regex: new RegExp(search, "i") } },
      { shopOrBuildingNumber: { $regex: new RegExp(search, "i") } },
      { address: { $regex: new RegExp(search, "i") } },
      { area: { $regex: new RegExp(search, "i") } },
      { city: { $regex: new RegExp(search, "i") } },
      { district: { $regex: new RegExp(search, "i") } },
      { state: { $regex: new RegExp(search, "i") } },
      { zipcode: { $regex: new RegExp(search, "i") } },
      { country: { $regex: new RegExp(search, "i") } },
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
  const pipeline = [{ $match: match }];
  const sortStage = {};
  sortStage[sortBy] = sortOrder === "asc" ? 1 : -1;
  pipeline.push({ $sort: sortStage });
  return await pagination(Location, pipeline, page, limit);
};
