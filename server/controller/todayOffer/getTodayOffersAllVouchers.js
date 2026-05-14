const {
  getTodayOffersByCategory,
} = require("../../service/todayOfferServices");
const { sendSuccess, sendError } = require("../../utils");

exports.getTodayOffersAllVouchers = async (req, res) => {
  try {
    const categoryId = req.params.categoryId;
    const {
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;
    if (!categoryId) return sendError(res, 404, "categoryId is required", 400);
    const offers = await getTodayOffersByCategory(categoryId, {
      page,
      limit,
      sortBy,
      sortOrder,
    });
    if (!offers?.vouchers?.length) {
      return sendError(res, 404, "No any voucher found for the today offer");
    }
    return sendSuccess(res, 200, "Vouchers for this offer category", offers);
  } catch (err) {
    console.log(
      "error on fetching all today offers vouchers of an category",
      err
    );
    return sendError(res, 500, err.message);
  }
};
