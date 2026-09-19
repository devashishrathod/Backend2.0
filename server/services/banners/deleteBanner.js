const Banner = require("../../models/Banner");
const { deleteBannerMedia } = require("../../helpers/banners");
const { throwError } = require("../../utils");

exports.deleteBanner = async (userId, id) => {
  const banner = await Banner.findOne({ _id: id, isDeleted: false });
  if (!banner) throwError(404, "Banner not found.");

  // Read before the flags change — the save below is what the delete is for,
  // and the media has to be captured while the document still describes it.
  const media = banner.media?.toObject?.() ?? banner.media;

  banner.isDeleted = true;
  banner.isActive = false;
  banner.updatedBy = userId;
  /**
   * ⚠️ Deleting does not touch the media, so it must not be blocked by
   * full-document validation. A row written before `media` existed — three
   * separate `image`/`video`/`gif` fields and a `type` beside them — has no
   * `media` at all, and `required` would refuse to let an admin delete exactly
   * the stale banners they are trying to clear out.
   */
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
   * who has already seen the banner disappear. A video's poster goes with it.
   */
  await deleteBannerMedia(media);
};
