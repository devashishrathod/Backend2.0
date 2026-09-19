const { asyncWrapper, sendSuccess } = require("../../utils");
const { createUploadIntent } = require("../../services/storage");

exports.presign = asyncWrapper(async (req, res) => {
  const result = await createUploadIntent(
    { userId: req.userId, role: req.role },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Upload authorised.", result);
});
