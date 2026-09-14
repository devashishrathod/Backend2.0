const mongoose = require("mongoose");
const { toDisplayName } = require("../../helpers/common");

const PromotionalTicker = require("../../models/PromotionalTicker");
const {
  uploadTickerIcon,
  deleteTickerIcon,
} = require("../../helpers/promotionalTickers");

exports.createTicker = async (userId, payload, files) => {
  const {
    title,
    redirect,
    displayOrder,
    startDate,
    endDate,
    isActive = true,
  } = payload;

  // Minted before the upload, because the object key carries it.
  const _id = new mongoose.Types.ObjectId();
  const icon = await uploadTickerIcon(files?.icon, _id);

  try {
    return await PromotionalTicker.create({
      _id,
      title: toDisplayName(title),
      icon,
      redirect,
      displayOrder,
      startDate: startDate || null,
      endDate: endDate || null,
      isActive,
      createdBy: userId,
    });
  } catch (error) {
    await deleteTickerIcon(icon);
    throw error;
  }
};
