const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllNotifications } = require("../../services/notifications");

exports.getAll = asyncWrapper(async (req, res) => {
  const result = await getAllNotifications(
    /**
     * ⚠️ `customerId` belongs in here.
     *
     * This actor is hand-assembled rather than passed as `req`, so every field
     * the service needs has to be listed — and the customer feed scopes on
     * `customerId`. Leaving it out did not error: `resolveCustomerId` returned
     * `null` and every customer got *"Only a customer can read this feed"*,
     * which reads like a deliberate refusal rather than a missing field.
     */
    {
      userId: req.userId,
      role: req.role,
      brandId: req.brandId,
      customerId: req.customerId,
    },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Notifications fetched successfully", result);
});
