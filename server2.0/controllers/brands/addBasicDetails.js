const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateBasicDetails } = require("../../services/brands");

exports.addBasicDetails = asyncWrapper(async (req, res) => {
  const result = await updateBasicDetails(req.userId, req.validatedData);
  return sendSuccess(res, 200, "Basic details updated successfully.", result);
});
