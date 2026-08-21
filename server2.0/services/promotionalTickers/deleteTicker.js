const PromotionalTicker = require("../../models/PromotionalTicker");
const { throwError } = require("../../utils");

exports.deleteTicker = async (userId, id) => {
  const ticker = await PromotionalTicker.findOne({ _id: id, isDeleted: false });
  if (!ticker) throwError(404, "Promotional ticker not found.");

  ticker.isDeleted = true;
  ticker.isActive = false;
  ticker.updatedBy = userId;
  await ticker.save();
};
