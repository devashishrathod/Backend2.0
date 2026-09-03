const { VOUCHER_BANNER_MEDIA_FIELD } = require("../../constants/voucherBanner");

/**
 * Flatten a voucher's banner into the two fields a client actually needs.
 *
 * `Voucher.banner` stores the media in a type-specific sub-document — an IMAGE
 * banner lives on `banner.image`, a VIDEO on `banner.video`, a GIF on
 * `banner.gif`. Making every caller branch on the type to find the URL is how
 * that logic ends up copy-pasted and drifting, so it lives here once.
 *
 * Both keys are always present, `null` when there is no banner, so a client
 * never has to distinguish "absent" from "empty".
 *
 * `storage` (Cloudinary publicId / bucket / key) is deliberately never exposed —
 * only the URL is any of the customer's business.
 *
 * @param {object|null} banner  the raw `voucher.banner` sub-document
 * @returns {{ bannerType: string|null, bannerUrl: string|null }}
 */
exports.pickVoucherBanner = (banner) => {
  const type = banner?.type || null;
  if (!type) return { bannerType: null, bannerUrl: null };

  const field = VOUCHER_BANNER_MEDIA_FIELD[type];
  const url = field ? banner?.[field]?.url || null : null;

  // A type with no reachable URL is a half-written banner. Reporting the type
  // without a URL would have the client render a broken tile, so treat it as
  // no banner at all.
  if (!url) return { bannerType: null, bannerUrl: null };

  return { bannerType: type, bannerUrl: url };
};
