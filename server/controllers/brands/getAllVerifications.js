const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllBrandVerifications } = require("../../services/systemVerify");

exports.getAllVerifications = asyncWrapper(async (req, res) => {
  const result = await getAllBrandVerifications(req.query);
  return sendSuccess(
    res,
    200,
    "Brand verifications fetched successfully.",
    result,
  );
});
