const PromotionalTicker = require("../../models/PromotionalTicker");
const { throwError } = require("../../utils");

exports.getTicker = async (id) => {
  const ticker = await PromotionalTicker.findOne({ _id: id, isDeleted: false });
  if (!ticker) throwError(404, "Promotional ticker not found.");
  return ticker;
};
