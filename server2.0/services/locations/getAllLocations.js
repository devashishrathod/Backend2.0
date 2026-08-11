const { default: mongoose } = require("mongoose");
const Location = require("../../models/Location");
const { pagination, validateObjectId } = require("../../utils");

exports.getAllLocations = async (query) => {
  let {
    page,
    limit,
    search,
    addressLine1,
    addressLine2,
    landmark,
    shopOrBuildingNumber,
    userId,
    customerId,
    brandId,
    subBrandId,
    city,
    district,
    state,
    zipcode,
    country,
    isActive,
    addressType,
    isBrandAddress,
    isSubBrandAddress,
    isDefault,
    fromDate,
    toDate,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;
  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 10;
  const match = { isDeleted: false };
  if (isActive !== undefined) {
    match.isActive = isActive === "true" || isActive === true;
  }
  if (addressType) match.addressType = addressType;
  if (isBrandAddress !== undefined) match.isBrandAddress = isBrandAddress;
  if (isSubBrandAddress !== undefined) {
    match.isSubBrandAddress = isSubBrandAddress;
  }
  if (isDefault !== undefined) match.isDefault = isDefault;
  if (city) match.city = city?.toLowerCase();
  if (district) match.district = district?.toLowerCase();
  if (state) match.state = state?.toLowerCase();
  if (zipcode) match.zipcode = zipcode?.toLowerCase();
  if (country) match.country = country?.toLowerCase();
  if (userId) {
    validateObjectId(userId, "User Id");
    match.userId = new mongoose.Types.ObjectId(userId);
  }
  if (customerId) {
    validateObjectId(customerId, "Customer Id");
    match.customerId = new mongoose.Types.ObjectId(customerId);
  }
  if (brandId) {
    validateObjectId(brandId, "Brand Id");
    match.brandId = new mongoose.Types.ObjectId(brandId);
  }
  if (subBrandId) {
    validateObjectId(subBrandId, "Sub Brand Id");
    match.subBrandId = new mongoose.Types.ObjectId(subBrandId);
  }
  if (addressLine1) {
    match.addressLine1 = { $regex: new RegExp(addressLine1, "i") };
  }
  if (addressLine2) {
    match.addressLine2 = { $regex: new RegExp(addressLine2, "i") };
  }
  if (landmark) {
    match.landmark = { $regex: new RegExp(landmark, "i") };
  }
  if (shopOrBuildingNumber) {
    match.shopOrBuildingNumber = {
      $regex: new RegExp(shopOrBuildingNumber, "i"),
    };
  }
  if (search) {
    match.$or = [
      { addressLine1: { $regex: new RegExp(search, "i") } },
      { addressLine2: { $regex: new RegExp(search, "i") } },
      { landmark: { $regex: new RegExp(search, "i") } },
      { city: { $regex: new RegExp(search, "i") } },
      { district: { $regex: new RegExp(search, "i") } },
      { state: { $regex: new RegExp(search, "i") } },
      { zipcode: { $regex: new RegExp(search, "i") } },
      { country: { $regex: new RegExp(search, "i") } },
      { formattedAddress: { $regex: new RegExp(search, "i") } },
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
