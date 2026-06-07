const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateBrand } = require("../../services/brands");

exports.updateBasicDetails = asyncWrapper(async (req, res) => {
  const result = await updateBrand(req.userId, req.validatedData);
  return sendSuccess(res, 200, "Basic details updated successfully.", result);
});
