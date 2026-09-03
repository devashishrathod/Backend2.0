const { asyncWrapper, sendSuccess } = require("../../utils");
const { acceptPartnership } = require("../../services/brands");

exports.acceptPartnershipDeed = asyncWrapper(async (req, res) => {
  const result = await acceptPartnership(req.userId);
  return sendSuccess(res, 200, "Partnership Deed accepted!", result);
});
