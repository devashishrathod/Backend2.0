const { VOUCHER_BANNER_MEDIA_FIELD } = require("../../constants/voucherBanner");
const { MEDIA_KIND } = require("../../constants/storage");

/**
 * Flatten a voucher's banner into the fields a client actually needs.
 *
 * `Voucher.banner` stores the media in a type-specific sub-document — an IMAGE
 * banner lives on `banner.image`, a VIDEO on `banner.video`, a GIF on
 * `banner.gif`. Making every caller branch on the type to find the URL is how
 * that logic ends up copy-pasted and drifting, so it lives here once.
 *
 * All three keys are always present, `null` when there is no banner, so a client
 * never has to distinguish "absent" from "empty".
 *
 * `storage` (publicId / bucket / key) is deliberately never exposed — only the
 * URL is any of the customer's business.
 *
 * @param {object|null} banner  the raw `voucher.banner` sub-document
 * @returns {{ bannerType: string|null, bannerUrl: string|null, bannerThumbnail: string|null }}
 */
const EMPTY = { bannerType: null, bannerUrl: null, bannerThumbnail: null };

exports.pickVoucherBanner = (banner) => {
  const type = banner?.type || null;
  if (!type) return { ...EMPTY };

  const field = VOUCHER_BANNER_MEDIA_FIELD[type];
  const media = field ? banner?.[field] : null;
  const url = media?.url || null;

  // A type with no reachable URL is a half-written banner. Reporting the type
  // without a URL would have the client render a broken tile, so treat it as
  // no banner at all.
  if (!url) return { ...EMPTY };

  return {
    bannerType: type,
    bannerUrl: url,
    /**
     * 🔴 The frame to paint before a video plays.
     *
     * A video banner's poster is **mandatory** at upload (M-5), and storing it
     * without sending it makes the requirement pointless — the app still shows a
     * blank rectangle until the `.mp4` has buffered enough for a frame.
     *
     * ⚠️ On a still or a GIF this is the banner's own URL rather than `null`, so
     * a client can paint `bannerThumbnail` once instead of branching on
     * `bannerType` to work out which field holds an image. That is the same
     * contract the home banner and showcase media already have.
     */
    bannerThumbnail:
      media.kind === MEDIA_KIND.VIDEO ? (media.poster?.url ?? null) : url,
  };
};
