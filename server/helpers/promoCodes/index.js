const { validatePromoCode } = require("./validatePromoCode");
const { assertPromoWindowAndCaps } = require("./assertPromoWindowAndCaps");
const { buildAudienceFilter } = require("./buildAudienceFilter");
const { buildListedPromoFilter } = require("./buildListedPromoFilter");
const {
  validateCustomerPromoCode,
  splitPromoCost,
} = require("./validateCustomerPromoCode");
const { evaluateCustomerPromo } = require("./evaluateCustomerPromo");
const { evaluateVendorPromo } = require("./evaluateVendorPromo");
const {
  buildPromoTerms,
  buildPromoHeadline,
} = require("./buildPromoTerms");
const { shapePromoForList } = require("./shapePromoForList");
const {
  resolvePromoScopeNames,
  pickScopeNames,
} = require("./resolvePromoScopeNames");
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
  /**
   * The pure half of each validator: every rule a code is judged by, with the
   * two count-backed gates taken as arguments.
   *
   * The checkout validators above and the two listings both go through these,
   * which is what stops the drawer a code is picked from and the checkout that
   * applies it from ever disagreeing.
   */
  evaluateCustomerPromo,
  evaluateVendorPromo,
  // Terms generated from the code's own rules, so a listed term cannot claim
  // something the validator does not enforce.
  buildPromoTerms,
  buildPromoHeadline,
  // The response allow-list. `costBearing` and the platform counters never
  // leave through it.
  shapePromoForList,
  // Four queries for a whole page of scope lists, not four per row.
  resolvePromoScopeNames,
  pickScopeNames,
  // The one place that knows a missing `audience` means VENDOR.
  buildAudienceFilter,
  // What "on offer right now" means, for both listings.
  buildListedPromoFilter,
  reservePromoCode,
  commitPromoCode,
  releasePromoCode,
  // The refund twin: `releasePromoCode` only touches RESERVED rows, and by the
  // time a refund happens the usage is CONSUMED.
  releaseConsumedPromoOnRefund,
  releaseStalePromoReservations,
};
