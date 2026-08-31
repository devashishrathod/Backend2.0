const { validatePromoCode } = require("./validatePromoCode");
const { assertPromoWindowAndCaps } = require("./assertPromoWindowAndCaps");
const { buildAudienceFilter } = require("./buildAudienceFilter");
const {
  validateCustomerPromoCode,
  splitPromoCost,
} = require("./validateCustomerPromoCode");
const {
  reservePromoCode,
  commitPromoCode,
  releasePromoCode,
  releaseStalePromoReservations,
} = require("./promoReservation");

module.exports = {
  validatePromoCode,
  // The customer-side twin. Shares every audience-agnostic rule with the vendor
  // one through assertPromoWindowAndCaps.
  validateCustomerPromoCode,
  splitPromoCost,
  // Shared by both audience validators — exported so the customer-side one can
  // import it from the barrel like everything else.
  assertPromoWindowAndCaps,
  // The one place that knows a missing `audience` means VENDOR.
  buildAudienceFilter,
  reservePromoCode,
  commitPromoCode,
  releasePromoCode,
  releaseStalePromoReservations,
};
