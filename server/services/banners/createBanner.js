const Banner = require("../../models/Banner");
const { throwError } = require("../../utils");
const { BANNER_MEDIA_FIELD } = require("../../constants/banner");
const {
  uploadBannerMedia,
  deleteBannerMedia,
  assertNoActiveOverlap,
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

  await assertNoActiveOverlap({ isActive, startDate, endDate });

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
