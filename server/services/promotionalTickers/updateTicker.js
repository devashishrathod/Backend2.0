const PromotionalTicker = require("../../models/PromotionalTicker");
const { throwError } = require("../../utils");
const {
  uploadTickerIcon,
  deleteTickerIcon,
} = require("../../helpers/promotionalTickers");

exports.updateTicker = async (userId, id, payload, files) => {
  const ticker = await PromotionalTicker.findOne({ _id: id, isDeleted: false });
  if (!ticker) throwError(404, "Promotional ticker not found.");

  let newIcon = null;
  if (files?.icon) newIcon = await uploadTickerIcon(files.icon);

  const previousIcon = ticker.icon?.toObject
    ? ticker.icon.toObject()
    : ticker.icon;

  if (payload.title !== undefined) ticker.title = payload.title;
  if (payload.redirect !== undefined) ticker.redirect = payload.redirect;
  if (payload.displayOrder !== undefined)
    ticker.displayOrder = payload.displayOrder;
  if (Object.prototype.hasOwnProperty.call(payload, "startDate")) {
    ticker.startDate = payload.startDate || null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "endDate")) {
    ticker.endDate = payload.endDate || null;
  }
  if (typeof payload.isActive === "boolean") ticker.isActive = payload.isActive;
  if (newIcon) ticker.icon = newIcon;
  ticker.updatedBy = userId;

  try {
    await ticker.save();
  } catch (error) {
    if (newIcon) await deleteTickerIcon(newIcon);
    throw error;
  }

  if (newIcon) await deleteTickerIcon(previousIcon);

  return ticker;
};
