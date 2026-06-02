const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const { createBanner } = require("../../services/banners");
const { validateCreateBanner } = require("../../validator/banners");

exports.create = asyncWrapper(async (req, res) => {
  const { error, value } = validateCreateBanner(req.body);
  if (error) throwError(422, cleanJoiError(error));
  const image = req.files?.image;
  const video = req.files?.video;
  const result = await createBanner(video, image, value);
  return sendSuccess(res, 201, "Banner video created successfully", result);
});
