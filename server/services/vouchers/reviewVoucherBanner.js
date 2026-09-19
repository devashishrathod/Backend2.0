const mongoose = require("mongoose");
const Voucher = require("../../models/Voucher");
const { throwError } = require("../../utils");
const { VOUCHER_BANNER_STATUS } = require("../../constants/voucherBanner");
const { deleteVoucherBannerMedia } = require("../../helpers/vouchers");

const MAX_REASON = 1000;

/**
 * An admin approves or rejects the banner a vendor submitted (V-4).
 *
 * ### 🔴 This reviews the **banner**, not the voucher
 *
 * The two are separate and can disagree: a PUBLISHED voucher may be carrying a
 * REJECTED banner, and that is an ordinary state rather than a contradiction.
 * Rejecting a banner never touches the voucher's own status — the offer stays
 * live on the `images[0]` fallback (V-4a), which is the whole reason the
 * fallback exists.
 *
 * ### What approval actually does
 *
 *     pending → current          the new banner goes live
 *     old current → deleted      nothing points at it any more
 *     status → null              there is nothing in review
 *
 * ⚠️ The old file is deleted **after** the save, never before. If the save
 * failed first, the voucher would be left pointing at an object that no longer
 * exists — a live banner turned into a broken image by a failed write.
 *
 * ### Rejection keeps the file
 *
 * A rejected banner stays in `pending` with its reason, because the vendor is
 * about to look at it beside the reason they were given. Deleting it would show
 * them "your banner was rejected because the text is unreadable" next to nothing
 * at all. It is replaced — and only then deleted — when they upload the next one.
 *
 * @param {string} adminUserId
 * @param {string} voucherId
 * @param {{ action: string, rejectionReason?: string }} payload
 */
exports.reviewVoucherBanner = async (adminUserId, voucherId, payload = {}) => {
  if (!adminUserId) throwError(401, "Admin authentication is required.");
  if (!mongoose.Types.ObjectId.isValid(voucherId)) {
    throwError(400, "Invalid voucher ID.");
  }

  const action = String(payload.action || "")
    .trim()
    .toUpperCase();

  if (
    ![VOUCHER_BANNER_STATUS.APPROVED, VOUCHER_BANNER_STATUS.REJECTED].includes(
      action,
    )
  ) {
    throwError(
      400,
      "Invalid review action. Allowed actions are APPROVED or REJECTED.",
    );
  }

  /**
   * A rejection without a reason is not a decision the vendor can act on — it
   * tells them the answer is no and leaves them to guess at the question.
   */
  let rejectionReason = null;
  if (action === VOUCHER_BANNER_STATUS.REJECTED) {
    rejectionReason = String(payload.rejectionReason || "").trim();
    if (!rejectionReason) {
      throwError(400, "A reason is required when rejecting a banner.");
    }
    if (rejectionReason.length > MAX_REASON) {
      throwError(400, `The reason cannot exceed ${MAX_REASON} characters.`);
    }
  }

  const voucher = await Voucher.findOne({ _id: voucherId, isDeleted: false });
  if (!voucher) throwError(404, "Voucher not found.");

  /**
   * ⚠️ Reviewing means reviewing something. A voucher with nothing in `pending`
   * has either never had a banner submitted or has already been reviewed, and
   * both are a 409 rather than a silent no-op — an admin who clicks approve on a
   * stale queue row should be told the row is stale.
   */
  if (!voucher.banner?.pending?.url) {
    throwError(409, "This voucher has no banner waiting for review.");
  }
  if (voucher.banner.status !== VOUCHER_BANNER_STATUS.PENDING) {
    throwError(
      409,
      `This banner has already been reviewed — it is ${voucher.banner.status}.`,
    );
  }

  const pending = voucher.banner.pending.toObject?.() ?? voucher.banner.pending;
  const supersededCurrent =
    voucher.banner.current?.toObject?.() ?? voucher.banner.current ?? null;

  if (action === VOUCHER_BANNER_STATUS.APPROVED) {
    voucher.banner.current = pending;
    voucher.banner.pending = undefined;
    /**
     * `null`, not `APPROVED`. `status` describes what is **in review**, and
     * after an approval nothing is — the approved banner's state is that it is
     * sitting in `current`. `pickVoucherBanner` reports `APPROVED` to clients
     * off `current` itself, so nothing downstream loses that information.
     */
    voucher.banner.status = null;
    voucher.banner.rejectionReason = null;
  } else {
    // The file stays where it is — see the note above.
    voucher.banner.status = VOUCHER_BANNER_STATUS.REJECTED;
    voucher.banner.rejectionReason = rejectionReason;
  }

  voucher.banner.reviewedBy = adminUserId;
  voucher.banner.reviewedAt = new Date();
  voucher.updatedBy = adminUserId;

  await voucher.save();

  /**
   * After the save, and only on approval: the banner it replaced is now
   * referenced by nothing. Doing this first would leave a live voucher pointing
   * at a deleted object if the save then failed.
   */
  if (action === VOUCHER_BANNER_STATUS.APPROVED && supersededCurrent?.url) {
    await deleteVoucherBannerMedia(supersededCurrent);
  }

  return {
    voucherId: voucher._id,
    banner: voucher.banner,
  };
};
