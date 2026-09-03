const Banner = require("../../models/Banner");
const { throwError } = require("../../utils");

exports.deleteBanner = async (userId, id) => {
  const banner = await Banner.findOne({ _id: id, isDeleted: false });
  if (!banner) throwError(404, "Banner not found.");

  banner.isDeleted = true;
  banner.isActive = false;
  banner.updatedBy = userId;
  // Deleting doesn't touch type/media, so it shouldn't be blocked by
  // full-document validation (e.g. legacy documents saved before the
  // BANNER_TYPE enum switched to uppercase).
  await banner.save({ validateBeforeSave: false });
};
