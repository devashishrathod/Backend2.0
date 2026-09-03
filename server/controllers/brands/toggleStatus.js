const { asyncWrapper, sendSuccess } = require("../../utils");
const { toggleBrandStatus } = require("../../services/brands");

exports.toggleStatus = asyncWrapper(async (req, res) => {
  const result = await toggleBrandStatus(
    { userId: req.userId, role: req.role },
    req.validatedData,
  );
  // The account switch is the headline when it moved; a visibility-only call
  // gets its own message rather than reporting an account state that did not
  // change.
  const accountMoved = result.actions.some((a) => a.startsWith("ACCOUNT_"));
  const message = accountMoved
    ? result.isActive
      ? "Vendor account activated successfully."
      : "Vendor account deactivated successfully."
    : result.isVisibleToCustomers
      ? "Brand is now visible to customers."
      : "Brand is now hidden from customers.";

  return sendSuccess(res, 200, message, result);
});
