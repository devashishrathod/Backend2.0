/**
 * The voucher's master banner.
 *
 * Independent from `constants/banner.js` on purpose — the voucher's banner has
 * no relation to the standalone Banner feature, it just follows the same
 * media-handling pattern.
 *
 * ### 🔴 `VOUCHER_BANNER_TYPE` and its three friends are gone (V-4)
 *
 * The banner used to be `{ type, image, video, gif }`: a stored label beside
 * three slots, exactly one of which was meant to be filled. That shape cost
 * three separate things.
 *
 *   - **A second source of truth.** `type` could disagree with the file sitting
 *     next to it, and nothing reconciled them. The home banner carried that
 *     exact bug for months.
 *   - **Three empty objects on every voucher** (P9) — `default: () => ({})` on
 *     all three meant a banner-less voucher still stored `image: {}`,
 *     `video: {}`, `gif: {}`.
 *   - **Three multipart field names** the client had to choose between, and a
 *     `bannerType` in the payload to say which one it had picked.
 *
 * All of it answered one question — *what is this file?* — which `media.kind`
 * now answers from the bytes themselves. So the type, the field map, the file
 * map and the per-type mime lists have all gone; the file arrives as `media`
 * and the platform works out the rest.
 */

/**
 * Where a banner is in its review.
 *
 * ⚠️ Deliberately its own vocabulary, not `VOUCHER_STATUSES`. A voucher and its
 * banner are reviewed separately and can disagree — a PUBLISHED voucher may be
 * carrying a REJECTED banner, and that is a normal state, not a contradiction.
 * Sharing an enum would invite code that compares the two.
 */
const VOUCHER_BANNER_STATUS = Object.freeze({
  /** Uploaded, waiting for an admin. Not visible to a customer. */
  PENDING: "PENDING",
  /** Live. This is the only status a customer ever sees a banner in. */
  APPROVED: "APPROVED",
  /** Refused, with a reason. The voucher stays published on the fallback. */
  REJECTED: "REJECTED",
});

/** The multipart field a banner file arrives in. One name, whatever it is. */
const VOUCHER_BANNER_FILE_FIELD = "media";

/** Its poster, when the banner is a video. */
const VOUCHER_BANNER_POSTER_FIELD = "poster";

module.exports = {
  VOUCHER_BANNER_STATUS,
  VOUCHER_BANNER_FILE_FIELD,
  VOUCHER_BANNER_POSTER_FIELD,
};
