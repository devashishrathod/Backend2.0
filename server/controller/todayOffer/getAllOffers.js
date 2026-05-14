const { getAllTodayOffers } = require("../../service/todayOfferServices");
const { asyncWrapper, sendSuccess } = require("../../utils");

exports.getAllOffers = asyncWrapper(async (req, res) => {
  const data = await getAllTodayOffers(req.query);
  return sendSuccess(res, 200, "All offers fetched successfully", data);
});
