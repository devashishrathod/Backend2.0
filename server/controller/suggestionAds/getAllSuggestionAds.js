const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  getAllSuggestionAdsByUserLocation,
} = require("../../service/suggestionAdsServices");

/**
 * GET /api/suggestions
 * Role-aware results; flexible region filters; pagination
 */
exports.getAllSuggestionAds = asyncWrapper(async (req, res) => {
  const userId = req.payload?._id;
  const data = await getAllSuggestionAdsByUserLocation(userId, req.query);
  return sendSuccess(res, 200, "Suggestions fetched successfully", data);
});
