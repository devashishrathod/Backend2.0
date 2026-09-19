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
const { describeIncoming } = require("../storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

/**
 * ⚠️ `actor` where it used to be a bare `userId` (U-5): the facade looks an
 * upload intent up by id **and** owner, so it has to know who is asking.
 */
exports.createBanner = async (actor, payload, files) => {
  const userId = actor.userId;
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
  // 🔴 Described before anything is confirmed — the capacity check above has to
  // be able to refuse while the upload is still spendable.
  const media = await uploadBannerMedia(
    actor,
    await describeIncoming(actor, {
      file: files?.[BANNER_MEDIA_FILE_FIELD],
      uploadId: payload.mediaUploadId,
      purpose: UPLOAD_PURPOSE.BANNER_MEDIA,
    }),
    _id,
    await describeIncoming(actor, {
      file: files?.[BANNER_POSTER_FILE_FIELD],
      uploadId: payload.posterUploadId,
      purpose: UPLOAD_PURPOSE.BANNER_POSTER,
    }),
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
