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
  // The refund twin: `releasePromoCode` only touches RESERVED rows, and by the
  // time a refund happens the usage is CONSUMED.
  releaseConsumedPromoOnRefund,
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
  // The refund twin: `releasePromoCode` only touches RESERVED rows, and by the
  // time a refund happens the usage is CONSUMED.
  releaseConsumedPromoOnRefund,
  releaseStalePromoReservations,
};
