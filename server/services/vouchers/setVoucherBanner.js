const Voucher = require("../../models/Voucher");
const { throwError } = require("../../utils");
const { resolveActorBrand } = require("../../helpers/brands");
const { UPLOAD_PURPOSE } = require("../../constants/storage");
const { describeIncoming } = require("../storage");
const { VOUCHER_BANNER_STATUS } = require("../../constants/voucherBanner");
const {
  uploadVoucherBannerMedia,
  deleteVoucherBannerMedia,
} = require("../../helpers/vouchers");

/**
 * Upload the voucher's banner — or a replacement for it.
 *
 * ### 🔴 The live banner stays live (V-5)
 *
 * A replacement goes into `pending` and waits for an admin. `current` — the one
 * customers are looking at — is left exactly where it is until the new one is
 * approved.
 *
 * The obvious alternative, swapping immediately, means a vendor tweaking their
 * artwork takes their own live offer's banner down for however long the review
 * queue happens to be. Worse, it puts an unreviewed image in front of customers,
 * which is the thing the review exists to prevent.
 *
 * ### ⚠️ Replacing a pending banner deletes the one it replaces
 *
 * Two uploads before any review means the first was never seen by anybody and
 * nothing points at it — leaving it would be a paid-for orphan. `current` is
 * never touched here, so this can only ever delete something no customer has
 * seen.
 *
 * ### There is no delete (V-3)
 *
 * A voucher's banner slot is never empty: with no approved banner the customer
 * read falls back to the voucher's first image (V-4a). "Remove my banner" is
 * therefore not a state the platform has — the endpoint that offered it is gone.
 *
 * @param {object} actor        `{ userId, role, brandId }`
 * @param {object} payload      `{ voucherId, bannerUploadId?, bannerPosterUploadId? }`
 * @param {object} [file]       the banner, attached as `media`
 * @param {object} [posterFile] required when the banner is a video
 */
exports.setVoucherBanner = async (actor, payload, file, posterFile) => {
  const { voucherId } = payload;
  const voucher = await Voucher.findOne({ _id: voucherId, isDeleted: false });
  if (!voucher) throwError(404, "Voucher not found.");

  // The endpoint took a voucherId with no ownership check at all, so any
  // authenticated caller could change any brand's banner.
  await resolveActorBrand(actor, voucher.brandId);

  /**
   * ⚠️ Read before the upload, because `voucher.banner.pending` is about to be
   * overwritten — and this copy is what the delete at the end needs.
   */
  const supersededPending =
    voucher.banner?.pending?.toObject?.() ?? voucher.banner?.pending ?? null;

  /**
   * 🔴 Described before anything is confirmed (U-4). Ownership is checked above
   * and the banner's own rules are checked inside — both have to be able to
   * refuse while the upload is still spendable, or a vendor who attaches the
   * wrong file pays for it twice.
   */
  const banner = await describeIncoming(actor, {
    file,
    uploadId: payload.bannerUploadId,
    purpose: UPLOAD_PURPOSE.VOUCHER_BANNER,
  });
  const poster = await describeIncoming(actor, {
    file: posterFile,
    uploadId: payload.bannerPosterUploadId,
    purpose: UPLOAD_PURPOSE.VOUCHER_BANNER_POSTER,
  });

  const newMedia = await uploadVoucherBannerMedia(
    actor,
    banner,
    voucher._id,
    poster,
  );

  voucher.banner.pending = newMedia;
  voucher.banner.status = VOUCHER_BANNER_STATUS.PENDING;
  /**
   * A fresh submission is not a rejected one. Clearing the verdict is what lets
   * a vendor act on the reason they were given — leaving `REJECTED` and its
   * reason beside a brand-new upload would show them yesterday's refusal against
   * today's file.
   */
  voucher.banner.rejectionReason = null;
  voucher.banner.reviewedBy = null;
  voucher.banner.reviewedAt = null;
  voucher.updatedBy = actor.userId;

  try {
    await voucher.save();
  } catch (error) {
    // Nothing references the new file yet, so it is safe to take back.
    await deleteVoucherBannerMedia(newMedia);
    throw error;
  }

  // Only ever the superseded *pending* one — `current` is untouched above.
  if (supersededPending?.url) {
    await deleteVoucherBannerMedia(supersededPending);
  }

  return voucher;
};
