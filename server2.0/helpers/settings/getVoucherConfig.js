const { getSetting } = require("./getSetting");
const { VOUCHER_OFFER_LIMITS } = require("../../constants/voucher");

// DB config (Setting.vendor.voucher) always wins; these constants only kick in
// as a last-resort fallback if the singleton Setting doc somehow lacks a value.
exports.getVoucherConfig = async () => {
  const setting = await getSetting();
  const voucher = setting?.vendor?.voucher || {};
  return {
    maxOffers: voucher.maxOffers ?? VOUCHER_OFFER_LIMITS.MAX_OFFERS ?? 10,
    maxImages: voucher.maxImages ?? VOUCHER_OFFER_LIMITS.MAX_IMAGES ?? 5,
    maxDistanceKm: voucher.maxDistanceKm ?? 25,
  };
};
