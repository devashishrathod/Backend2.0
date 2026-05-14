const { createBillValidation } = require("../../validator/validate.bill");
const { createBillAmount } = require("../../service/billServices");
const { sendSuccess, sendError } = require("../../utils");

exports.createBill = async (req, res) => {
  try {
    const userId = req.payload._id;
    const { error } = createBillValidation(req.body);
    if (error) return sendError(res, 400, error.details[0].message);
    const data = await createBillAmount(userId, req.body);
    return sendSuccess(res, 201, "Bill created successfully", data);
  } catch (err) {
    console.log("error on creating bill", err);
    return sendError(res, err.statusCode || 500, err.message);
  }
};
