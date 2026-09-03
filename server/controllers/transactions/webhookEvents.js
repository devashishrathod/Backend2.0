const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  getWebhookEvents,
  getWebhookEvent,
} = require("../../services/transactions");

exports.webhookEventList = asyncWrapper(async (req, res) => {
  const result = await getWebhookEvents(req.validatedData);
  return sendSuccess(res, 200, "Webhook events fetched successfully", result);
});

exports.webhookEventGet = asyncWrapper(async (req, res) => {
  const result = await getWebhookEvent(req.validatedData);
  return sendSuccess(res, 200, "Webhook event fetched successfully", result);
});
