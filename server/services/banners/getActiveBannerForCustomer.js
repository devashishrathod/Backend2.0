const Banner = require("../../models/Banner");

exports.getActiveBannerForCustomer = async () => {
  const now = new Date();

  const activeDatedBanner = await Banner.findOne({
    isActive: true,
    isDeleted: false,
    startDate: { $ne: null, $lte: now },
    endDate: { $ne: null, $gte: now },
  }).sort({ startDate: -1 });

  if (activeDatedBanner) return activeDatedBanner;

  const fallbackBanner = await Banner.findOne({
    isActive: true,
    isDeleted: false,
    startDate: null,
    endDate: null,
  }).sort({ createdAt: -1 });

  return fallbackBanner || null;
};
