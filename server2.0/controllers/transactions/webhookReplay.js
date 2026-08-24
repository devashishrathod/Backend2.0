const { asyncWrapper, sendSuccess } = require("../../utils");
const { replayWebhookEvent } = require("../../services/transactions");

exports.webhookReplay = asyncWrapper(async (req, res) => {
  const result = await replayWebhookEvent(
    { userId: req.userId, role: req.role },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    result.recovered
      ? "Webhook replayed successfully — the delivery now processed cleanly."
      : "Webhook replayed. See `after.outcome` for what happened.",
    result,
  );
});
