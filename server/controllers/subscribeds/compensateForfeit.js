const { asyncWrapper, sendSuccess } = require("../../utils");
const { markForfeitCompensated } = require("../../services/subscribeds");

exports.compensateForfeit = asyncWrapper(async (req, res) => {
  const result = await markForfeitCompensated(
    { userId: req.userId, role: req.role },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    "Forfeited term marked as compensated",
    result,
  );
});
