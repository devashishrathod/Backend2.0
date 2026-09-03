const { asyncWrapper, sendSuccess } = require("../../utils");
const { getPaymentHealth } = require("../../services/transactions");

/**
 * The money page an admin opens at nine in the morning.
 *
 * Always 200, even when the news is bad. A health endpoint that answers 500
 * when something is unhealthy cannot report *what* is unhealthy — and it is
 * exactly the report that matters on the worst day.
 */
exports.paymentHealth = asyncWrapper(async (req, res) => {
  const result = await getPaymentHealth();
  return sendSuccess(res, 200, "Payment health fetched successfully.", result);
});
