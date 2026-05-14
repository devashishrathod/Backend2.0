const Transaction = require("../../model/Transaction");
const { sendSuccess, sendError } = require("../../utils");

exports.getAllTransactions = async (req, res) => {
  try {
    const { brandId } = req.query;
    const transactions = await Transaction.find({
      isDeleted: false,
      brand: brandId,
    }).populate({
      path: "subscription",
      select: "name",
    });
    return sendSuccess(res, 200, "All transactions fetched", transactions);
  } catch (error) {
    console.error("Error fetching transactions", error);
    return sendError(res, 500, error.message || "Failed to fetch transactions");
  }
};
