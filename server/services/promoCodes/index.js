const { createPromoCode } = require("./createPromoCode");
const { updatePromoCode } = require("./updatePromoCode");
const { getAllPromoCodes } = require("./getAllPromoCodes");
const { getPromoCode } = require("./getPromoCode");
const { getPromoCodeReport } = require("./getPromoCodeReport");
const { deletePromoCode } = require("./deletePromoCode");
const { getCustomerPromoCodes } = require("./getCustomerPromoCodes");
const { getVendorPromoCodes } = require("./getVendorPromoCodes");

module.exports = {
  createPromoCode,
  updatePromoCode,
  getAllPromoCodes,
  getPromoCode,
  getPromoCodeReport,
  deletePromoCode,
  /**
   * The two listings each audience sees of its own codes. They share every rule
   * with the checkout validators through `helpers/promoCodes` — see the note on
   * `evaluateCustomerPromo`.
   */
  getCustomerPromoCodes,
  getVendorPromoCodes,
};
