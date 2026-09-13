const Banner = require("../../models/Banner");
const { BANNER_MEDIA_FIELD } = require("../../constants/banner");
const { deleteBannerMedia } = require("../../helpers/banners");
const { throwError } = require("../../utils");

exports.deleteBanner = async (userId, id) => {
  const banner = await Banner.findOne({ _id: id, isDeleted: false });
  if (!banner) throwError(404, "Banner not found.");

  // Read before the flags change, because the media lives on a type-named
  // field and the type is what tells us which one to look at.
  const field = BANNER_MEDIA_FIELD[banner.type];
  const media = field ? (banner[field]?.toObject?.() ?? banner[field]) : null;

  banner.isDeleted = true;
  banner.isActive = false;
  banner.updatedBy = userId;
  // Deleting doesn't touch type/media, so it shouldn't be blocked by
  // full-document validation (e.g. legacy documents saved before the
  // BANNER_TYPE enum switched to uppercase).
  await banner.save({ validateBeforeSave: false });

  /**
   * The file goes too — after the save, never before.
   *
   * This delete is soft, but nothing can bring the row back: there is no
   * restore endpoint and every read filters `isDeleted: false`. So the asset
   * was simply abandoned — paid for every month, referenced by a row nobody
   * can reach. Banners are the highest-churn content in the system (campaigns
   * change weekly), so the pile only ever grew.
   *
   * `deleteBannerMedia` swallows and logs its own failures: a file that
   * outlives its row is worth a log line, not a failed request for the admin
   * who has already seen the banner disappear.
   */
  await deleteBannerMedia(banner.type, media);
};
