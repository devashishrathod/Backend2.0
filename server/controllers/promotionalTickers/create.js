const { asyncWrapper, sendSuccess } = require("../../utils");
const { createTicker } = require("../../services/promotionalTickers");

exports.create = asyncWrapper(async (req, res) => {
  const result = await createTicker({ userId: req.userId, role: req.role }, req.validatedData, req.files);
  return sendSuccess(
    res,
    201,
    "Promotional ticker created successfully.",
    result,
  );
});
