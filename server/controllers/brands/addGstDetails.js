const { asyncWrapper, sendSuccess } = require("../../utils");
const { createGst } = require("../../services/gst");

exports.addGstDetails = asyncWrapper(async (req, res) => {
  const result = await createGst(req.userId, req.validatedData);
  return sendSuccess(res, 200, "GST details added successfully.", result);
});
