const Banner = require("../../models/Banner");
const { throwError, validateObjectId } = require("../../utils");

exports.getBanner = async (id) => {
  validateObjectId(id, "Banner Id");
  const banner = await Banner.findById(id);
  if (!banner || banner.isDeleted) throwError(404, "Banner not found");
  return banner;
};
