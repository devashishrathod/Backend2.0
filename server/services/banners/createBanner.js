const mongoose = require("mongoose");
const { toDisplayName } = require("../../helpers/common");

const Banner = require("../../models/Banner");
const {
  uploadBannerMedia,
  deleteBannerMedia,
  assertActiveBannerCapacity,
  toAdminBannerShape,
  BANNER_MEDIA_FILE_FIELD,
  BANNER_POSTER_FILE_FIELD,
} = require("../../helpers/banners");

exports.createBanner = async (userId, payload, files) => {
  const {
    title,
    description,
    redirect,
    startDate,
    endDate,
    isActive = true,
  } = payload;

  // Before the upload, deliberately: a refusal here is a full home screen, and
  // paying the provider for a file that is about to be rejected is the wrong
  // order.
  await assertActiveBannerCapacity({ isActive, startDate, endDate });

  // Minted before the upload, because the object key carries it.
  const _id = new mongoose.Types.ObjectId();
  const media = await uploadBannerMedia(
    files?.[BANNER_MEDIA_FILE_FIELD],
    _id,
    files?.[BANNER_POSTER_FILE_FIELD],
  );

  try {
    // ⚠️ Through the same whitelist the reads use — `create` returns the
    // mongoose document, and handing that back is what puts `media.storage` on
    // the wire.
    const banner = await Banner.create({
      _id,
      title: toDisplayName(title),
      description,
      redirect,
      startDate: startDate || null,
      endDate: endDate || null,
      isActive,
      createdBy: userId,
      media,
    });
    return toAdminBannerShape(banner);
  } catch (error) {
    await deleteBannerMedia(media);
    throw error;
  }
};
