const Banner = require("../../models/Banner");
const { toAdminBannerShape } = require("../../helpers/banners");
const { throwError } = require("../../utils");

exports.getBanner = async (id) => {
  const banner = await Banner.findOne({ _id: id, isDeleted: false }).lean();
  if (!banner) throwError(404, "Banner not found.");
  return toAdminBannerShape(banner);
};
