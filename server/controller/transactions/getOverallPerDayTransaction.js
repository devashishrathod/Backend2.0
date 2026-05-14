const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  getOverallPerDayBrandsTransaction,
} = require("../../service/transactionServices");

exports.getOverallPerDayTransaction = asyncWrapper(async (req, res) => {
  const data = await getOverallPerDayBrandsTransaction(req.query);
  return sendSuccess(res, 200, "Transaction data fetched successfully", data);
});
