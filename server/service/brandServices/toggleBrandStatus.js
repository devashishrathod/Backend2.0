const Brand = require("../../model/Brand");
const User = require("../../model/User");
const { throwError } = require("../../utils");
const { ROLES } = require("../../constants");

exports.toggleBrandStatus = async (userId, brandId) => {
  const user = await User.findById(userId);
  if (!user || user?.isDeleted) throwError(404, "Invalid User! User not found");
  const brand = await Brand.findById(brandId);
  if (!brand || brand?.isDeleted) {
    throwError(404, "Invalid Brand! Brand not found");
  }
  if (
    user?.role === ROLES.VENDOR &&
    brand?.user?.toString() !== userId?.toString()
  ) {
    throwError(403, "You are not authorized to perform this action");
  }
  brand.isActive = !brand.isActive;
  await brand.save();
  return brand;
};
