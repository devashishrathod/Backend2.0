const { asyncWrapper, sendSuccess } = require("../../utils");
const { addOrUpdateBasicDetails } = require("../../services/brands");

exports.addOrUpdateBasicDetails = asyncWrapper(async (req, res) => {
  const result = await addOrUpdateBasicDetails(req.userId, req.validatedData);
  return sendSuccess(res, 200, "Basic details updated successfully.", result);
});
