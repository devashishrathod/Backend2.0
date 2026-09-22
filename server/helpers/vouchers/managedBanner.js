const { toMediaResponse } = require("../media");

/**
 * A voucher's banner, as a **panel** sees it.
 *
 * ### 🔴 Why one function and not three write-ups of the same idea
 *
 * Three surfaces answer with this block — the vendor's upload
 * (`setVoucherBanner`), the admin's verdict (`reviewVoucherBanner`) and the
 * version listing (`getAllVoucherVersions`) — and until now each shaped it for
 * itself. Predictably, all three did it differently:
 *
 *   - the upload returned **the whole `Voucher` document**, `normalizedName`,
 *     `createdBy`, `timezone` and all, while its own doc described
 *     `{ voucherId, banner }`;
 *   - the review returned the raw sub-document, locator attached;
 *   - the listing returned the raw sub-document nested inside `voucher`.
 *
 * That is the same shape of drift this domain has now produced five times: one
 * idea, several spellings, and whichever one a reader happens to open becomes
 * the one they copy.
 *
 * ### ⚠️ `storage` does not leave, on any of the three
 *
 * `toMediaResponse`'s admin shape is the rule: size, dimensions, mime type,
 * original name and **`provider`** — never `publicId`, `bucket` or `key`. Those
 * are the object's address, and whoever holds one can fetch or overwrite the
 * file directly, around every check this server makes.
 *
 * 🔴 This **overrides** a note in the vendor doc which said the locator was
 * acceptable on the vendor's own upload response, on the reasoning that they
 * had just uploaded that file themselves. That reasoning explains why it was
 * not dangerous; it never explained why it was *needed*. Nothing asks the
 * vendor for a `publicId` — a file is attached by `uploadId`, never by its key
 * — so the field was decoration on the one response where a locator is easiest
 * to forget about. One shape, everywhere, is worth more than an exception
 * nobody consumes.
 *
 * @param {object|null} banner  the stored `voucher.banner` sub-document
 * @returns {object|null} the same six fields, with both slots shaped
 */
exports.toManagedBanner = (banner) => {
  if (!banner) return null;

  const plain = typeof banner.toObject === "function" ? banner.toObject() : banner;

  return {
    current: toMediaResponse(plain.current, { forAdmin: true }),
    pending: toMediaResponse(plain.pending, { forAdmin: true }),
    /**
     * ⚠️ `status` describes what is **in review** — `null` once a banner has
     * been approved, because at that point nothing is. `pickVoucherBanner`
     * reports `APPROVED` to customers off `current` itself, so the information
     * is not lost; it is simply not this field's job.
     */
    status: plain.status ?? null,
    rejectionReason: plain.rejectionReason ?? null,
    reviewedBy: plain.reviewedBy ?? null,
    reviewedAt: plain.reviewedAt ?? null,
  };
};
