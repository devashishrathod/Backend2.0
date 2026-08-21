const { asyncWrapper, sendSuccess } = require("../../utils");
const { createTicker } = require("../../services/promotionalTickers");

exports.create = asyncWrapper(async (req, res) => {
  const result = await createTicker(req.userId, req.validatedData, req.files);
  return sendSuccess(
    res,
    201,
    "Promotional ticker created successfully.",
    result,
  );
});
