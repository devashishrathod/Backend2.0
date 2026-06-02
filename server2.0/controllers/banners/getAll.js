const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const { getAllBanners } = require("../../services/banners");
const { validateGetAllBannersQuery } = require("../../validator/banners");

exports.getAll = asyncWrapper(async (req, res) => {
  const { error } = validateGetAllBannersQuery(req.query);
  if (error) throwError(422, cleanJoiError(error));
  const result = await getAllBanners(req.query);
  return sendSuccess(res, 200, "Banners fetched successfully", result);
});
