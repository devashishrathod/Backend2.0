const Transaction = require("../../model/Transaction");
const { sendSuccess, sendError } = require("../../utils");

exports.getCurrentTransaction = async (req, res) => {
  try {
    const userId = req.user._id;
    const currentTransaction = await Transaction.findOne({
      user: userId,
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .populate({
        path: "subscription",
        select: "name",
      });

    if (!currentTransaction) {
      return sendError(res, 404, "No successful transaction found");
    }
    return sendSuccess(
      res,
      200,
      "Current transaction fetched",
      currentTransaction
    );
  } catch (error) {
    console.error("Error fetching current transaction", error);
    return sendError(
      res,
      500,
      error.message || "Failed to fetch current transaction"
    );
  }
};
