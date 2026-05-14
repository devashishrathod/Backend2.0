const { asyncWrapper, sendSuccess } = require("../../utils");
const { createSuggestionAd } = require("../../service/suggestionAdsServices");

exports.createSuggestionAd = asyncWrapper(async (req, res, next) => {
  const { voucherId } = req.params;
  const image = req.files?.image;
  const data = await createSuggestionAd(voucherId, image, req.body);
  return sendSuccess(res, 201, "Suggestion Ad created successfully", data);
});
