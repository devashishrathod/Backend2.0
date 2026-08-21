const { asyncWrapper, sendSuccess } = require("../../utils");
const { getTicker } = require("../../services/promotionalTickers");

exports.get = asyncWrapper(async (req, res) => {
  const result = await getTicker(req.validatedData.id);
  return sendSuccess(
    res,
    200,
    "Promotional ticker fetched successfully.",
    result,
  );
});
