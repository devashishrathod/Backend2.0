const { asyncWrapper, sendSuccess } = require("../../utils");
const { getBrandsAllShowcase } = require("../../services/showcases");

exports.getBrandShowcase = asyncWrapper(async (req, res) => {
  const result = await getBrandsAllShowcase(req.validatedData);
  return sendSuccess(res, 200, "Showcase fetched successfully.", result);
});
