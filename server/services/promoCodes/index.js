const { createPromoCode } = require("./createPromoCode");
const { updatePromoCode } = require("./updatePromoCode");
const { getAllPromoCodes } = require("./getAllPromoCodes");
const { getPromoCode } = require("./getPromoCode");
const { getPromoCodeReport } = require("./getPromoCodeReport");
const { deletePromoCode } = require("./deletePromoCode");

module.exports = {
  createPromoCode,
  updatePromoCode,
  getAllPromoCodes,
  getPromoCode,
  getPromoCodeReport,
  deletePromoCode,
};
