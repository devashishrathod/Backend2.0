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

  const icon = await uploadTickerIcon(files?.icon);

  try {
    return await PromotionalTicker.create({
      title,
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
