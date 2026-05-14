const { asyncWrapper, sendSuccess } = require("../../utils");
const { createDailyPayment } = require("../../service/dailyPaymentServices");

exports.create = asyncWrapper(async (req, res) => {
  const userId = req.payload?._id;
  const data = await createDailyPayment(userId, req.body);
  return sendSuccess(res, 201, "Payment added successfully", data);
});
