const Banner = require("../../models/Banner");
const { throwError } = require("../../utils");

exports.getBanner = async (id) => {
  const banner = await Banner.findOne({ _id: id, isDeleted: false });
  if (!banner) throwError(404, "Banner not found.");
  return banner;
};
