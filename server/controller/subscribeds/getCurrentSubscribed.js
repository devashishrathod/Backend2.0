const {
  getCurrentSubscriptionByBrand,
} = require("../../service/subscribedServices");
const { sendSuccess, sendError } = require("../../utils");

exports.getCurrentSubscribed = async (req, res) => {
  try {
    const { brandId } = req.params;
    const data = await getCurrentSubscriptionByBrand(brandId);
    if (!data) return sendError(res, 404, "No active subscription found");
    return sendSuccess(res, 200, "Current subscription fetched", data);
  } catch (error) {
    console.log("error on fetching current plan: ", error);
    return sendError(res, 500, error.message);
  }
};
