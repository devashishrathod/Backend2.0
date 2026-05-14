const { sendSuccess, sendError } = require("../../utils");
const {
  getAllSubscriptionByBrand,
} = require("../../service/subscribedServices");

exports.getAllSubscribed = async (req, res) => {
  try {
    const { brandId } = req.params;
    const data = await getAllSubscriptionByBrand(brandId);
    if (!data || data.length === 0) {
      return sendError(res, 404, "No any subscription found.");
    }
    return sendSuccess(res, 200, "All subscription plans fetched", data);
  } catch (error) {
    console.log("error on fetching current plan: ", error);
    sendError(res, 500, error.message);
  }
};
