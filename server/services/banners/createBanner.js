const Banner = require("../../models/Banner");
const { throwError } = require("../../utils");
const { BANNER_MEDIA_FIELD } = require("../../constants/banner");
const {
  uploadBannerMedia,
  deleteBannerMedia,
  assertActiveBannerCapacity,
} = require("../../helpers/banners");

exports.createBanner = async (userId, payload, files) => {
  const {
    title,
    description,
    type,
    redirect,
    startDate,
    endDate,
    isActive = true,
  } = payload;

  const field = BANNER_MEDIA_FIELD[type];
  const file = files?.[field];
  if (!file)
    throwError(422, `Please upload a ${field} file for this banner type.`);

  // Before the upload, deliberately: a refusal here is a full home screen, and
  // paying Cloudinary for a file that is about to be rejected is the wrong order.
  await assertActiveBannerCapacity({ isActive, startDate, endDate });

  const media = await uploadBannerMedia(type, file);

  try {
    return await Banner.create({
      title,
      description,
      type,
      redirect,
      startDate: startDate || null,
      endDate: endDate || null,
      isActive,
      createdBy: userId,
      [field]: media,
    });
  } catch (error) {
    await deleteBannerMedia(type, media);
    throw error;
  }
};
