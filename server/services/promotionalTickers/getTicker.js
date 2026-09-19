const PromotionalTicker = require("../../models/PromotionalTicker");
const { toAdminTickerShape } = require("../../helpers/promotionalTickers");
const { throwError } = require("../../utils");

exports.getTicker = async (id) => {
  const ticker = await PromotionalTicker.findOne({
    _id: id,
    isDeleted: false,
  }).lean();
  if (!ticker) throwError(404, "Promotional ticker not found.");
  return toAdminTickerShape(ticker);
};
