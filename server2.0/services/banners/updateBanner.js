const Banner = require("../../models/Banner");
const { throwError } = require("../../utils");
const { BANNER_MEDIA_FIELD } = require("../../constants/banner");
const {
  uploadBannerMedia,
  deleteBannerMedia,
  assertNoActiveOverlap,
} = require("../../helpers/banners");

exports.updateBanner = async (userId, id, payload, files) => {
  const banner = await Banner.findOne({ _id: id, isDeleted: false });
  if (!banner) throwError(404, "Banner not found.");

  const nextType = payload.type || banner.type;
  const nextField = BANNER_MEDIA_FIELD[nextType];
  const hasStartDate = Object.prototype.hasOwnProperty.call(
    payload,
    "startDate",
  );
  const hasEndDate = Object.prototype.hasOwnProperty.call(payload, "endDate");

  const nextStartDate = hasStartDate
    ? payload.startDate || null
    : banner.startDate;
  const nextEndDate = hasEndDate ? payload.endDate || null : banner.endDate;
  const nextIsActive =
    typeof payload.isActive === "boolean" ? payload.isActive : banner.isActive;

  const dateOrStatusChanged =
    nextIsActive !== banner.isActive ||
    String(nextStartDate) !== String(banner.startDate) ||
    String(nextEndDate) !== String(banner.endDate);

  if (dateOrStatusChanged) {
    await assertNoActiveOverlap({
      isActive: nextIsActive,
      startDate: nextStartDate,
      endDate: nextEndDate,
      excludeId: banner._id,
    });
  }

  const file = files?.[nextField];
  if (payload.type && payload.type !== banner.type && !file) {
    throwError(
      422,
      `Please upload a ${nextField} file when changing banner type.`,
    );
  }

  let newMedia = null;
  if (file) newMedia = await uploadBannerMedia(nextType, file);

  const previousType = banner.type;
  const previousField = BANNER_MEDIA_FIELD[previousType];
  const previousMedia = banner[previousField]?.toObject
    ? banner[previousField].toObject()
    : banner[previousField];

  if (payload.title !== undefined) banner.title = payload.title;
  if (payload.description !== undefined)
    banner.description = payload.description;
  if (payload.redirect !== undefined) banner.redirect = payload.redirect;
  if (hasStartDate) banner.startDate = payload.startDate || null;
  if (hasEndDate) banner.endDate = payload.endDate || null;
  if (typeof payload.isActive === "boolean") banner.isActive = payload.isActive;
  if (payload.type) banner.type = payload.type;
  if (newMedia) banner[nextField] = newMedia;
  banner.updatedBy = userId;

  try {
    await banner.save();
  } catch (error) {
    if (newMedia) await deleteBannerMedia(nextType, newMedia);
    throw error;
  }

  if (newMedia) await deleteBannerMedia(previousType, previousMedia);

  return banner;
};
