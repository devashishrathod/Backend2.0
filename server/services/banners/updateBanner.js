const Banner = require("../../models/Banner");
const { toDisplayName } = require("../../helpers/common");
const { throwError } = require("../../utils");
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

/** ⚠️ `actor` where it used to be a bare `userId` — see `createBanner`. */
exports.updateBanner = async (actor, id, payload, files) => {
  const userId = actor.userId;
  const banner = await Banner.findOne({ _id: id, isDeleted: false });
  if (!banner) throwError(404, "Banner not found.");

  /**
   * ⚠️ Checked here, not in the validator, because this is the only layer that
   * can see both halves. `validateSchema` never receives `req.files`, so a
   * body-only rule would refuse the commonest edit there is — replacing the
   * picture and changing nothing else.
   */
  if (Object.keys(payload || {}).length === 0 && !files?.[BANNER_MEDIA_FILE_FIELD]) {
    throwError(
      422,
      "Please provide at least one field to update, or attach a new media file.",
    );
  }

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

  // ⚠️ The validator can only see the request body, so it catches a half-open
  // pair that was *sent*. It cannot catch one that is half-open only after the
  // merge — clearing `startDate` alone on a banner that has an `endDate`, or
  // editing a legacy document that was stored half-open before the rule existed.
  // Either way the result belongs to neither pool: the scheduled query wants
  // both dates and the evergreen query wants neither, so the banner is saved,
  // returns 200, and is never rendered for anybody.
  if (Boolean(nextStartDate) !== Boolean(nextEndDate)) {
    throwError(
      422,
      "Please provide both startDate and endDate, or clear both — a banner with only one of them is never shown.",
    );
  }

  const dateOrStatusChanged =
    nextIsActive !== banner.isActive ||
    String(nextStartDate) !== String(banner.startDate) ||
    String(nextEndDate) !== String(banner.endDate);

  if (dateOrStatusChanged) {
    await assertActiveBannerCapacity({
      isActive: nextIsActive,
      startDate: nextStartDate,
      endDate: nextEndDate,
      excludeId: banner._id,
    });
  }

  /**
   * ⚠️ Replacing the media is now the **only** reason to send a file, and a
   * banner keeps the one it has otherwise.
   *
   * The old endpoint had a second reason — changing `type` forced a re-upload,
   * because the bytes had to move to a different field. There is no type to
   * change any more: a new file that happens to be a video where the old one was
   * an image simply arrives as one, and `media.kind` follows it.
   */
  const file = await describeIncoming(actor, {
    file: files?.[BANNER_MEDIA_FILE_FIELD],
    uploadId: payload.mediaUploadId,
    purpose: UPLOAD_PURPOSE.BANNER_MEDIA,
  });
  const newMedia = file
    ? await uploadBannerMedia(
        actor,
        file,
        banner._id,
        await describeIncoming(actor, {
          file: files?.[BANNER_POSTER_FILE_FIELD],
          uploadId: payload.posterUploadId,
          purpose: UPLOAD_PURPOSE.BANNER_POSTER,
        }),
      )
    : null;

  const previousMedia = banner.media?.toObject
    ? banner.media.toObject()
    : banner.media;

  if (payload.title !== undefined) banner.title = toDisplayName(payload.title);
  if (payload.description !== undefined)
    banner.description = payload.description;
  if (payload.redirect !== undefined) banner.redirect = payload.redirect;
  if (hasStartDate) banner.startDate = payload.startDate || null;
  if (hasEndDate) banner.endDate = payload.endDate || null;
  if (typeof payload.isActive === "boolean") banner.isActive = payload.isActive;
  if (newMedia) banner.media = newMedia;
  banner.updatedBy = userId;

  try {
    await banner.save();
  } catch (error) {
    if (newMedia) await deleteBannerMedia(newMedia);
    throw error;
  }

  if (newMedia) await deleteBannerMedia(previousMedia);

  return toAdminBannerShape(banner);
};
