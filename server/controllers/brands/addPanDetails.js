const { asyncWrapper, sendSuccess } = require("../../utils");
const { createPan } = require("../../services/pan");

exports.addPanDetails = asyncWrapper(async (req, res) => {
  const result = await createPan(req.userId, req.validatedData);
  return sendSuccess(res, 200, "PAN details added successfully.", result);
});
