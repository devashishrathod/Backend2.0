const {
  getAllTodayOfferCategories,
} = require("../../service/todayOfferServices");
const { sendSuccess, sendError } = require("../../utils");

exports.getTodayOfferCategories = async (req, res) => {
  try {
    const categories = await getAllTodayOfferCategories();
    if (!categories) return sendError(res, 404, "No any today's offer found.");
    return sendSuccess(res, 200, "Offer categories fetched", categories);
  } catch (err) {
    console.log("erorr on fetching today offer's categories", err);
    return sendError(res, 500, err.message);
  }
};
