const { asyncWrapper, sendSuccess } = require("../../utils");
const { confirmUpload } = require("../../services/storage");

exports.confirm = asyncWrapper(async (req, res) => {
  const { uploadId, entityId } = req.validatedData;
  const result = await confirmUpload(
    { userId: req.userId, role: req.role },
    uploadId,
    { entityId },
  );
  return sendSuccess(res, 200, "Upload confirmed.", result);
});
