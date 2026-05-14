const { sendError, sendSuccess } = require("../../utils");
const { createLessAmount } = require("../../service/lessAmountServices");
const {
  validateCreateLessAmount,
} = require("../../validator/validate.lessAmount");

exports.create = async (req, res) => {
  try {
    const { error } = validateCreateLessAmount(req.body);
    if (error) {
      return sendError(
        res,
        422,
        error.details.map((d) => d.message).join(", "),
      );
    }
    const lessAmount = await createLessAmount(req.body);
    return sendSuccess(res, 201, "LessAmount created successfully", lessAmount);
  } catch (err) {
    console.error("Create LessAmount error:", err);
    return sendError(res, err.statusCode || 500, err.message);
  }
};
