const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateTicker } = require("../../services/promotionalTickers");

exports.update = asyncWrapper(async (req, res) => {
  const { id, ...payload } = req.validatedData;
  const result = await updateTicker(req.userId, id, payload, req.files);
  return sendSuccess(
    res,
    200,
    "Promotional ticker updated successfully.",
    result,
  );
});
