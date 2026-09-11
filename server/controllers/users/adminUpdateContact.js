const { asyncWrapper, sendSuccess } = require("../../utils");
const { adminUpdateContact } = require("../../services/users");

/**
 * An admin changes somebody's contact details for them.
 *
 * ⚠️ The message says the keys landed **unverified**, on purpose. An admin who
 * does not know that would assume the job is finished and close the ticket, and
 * the customer would then find that the email they were told about still cannot
 * sign them in.
 */
exports.adminUpdateContactHandler = asyncWrapper(async (req, res) => {
  const result = await adminUpdateContact(
    // From the token, never the body — the actor is a fact about the caller.
    { userId: req.userId, role: req.role },
    req.params.userId,
    req.validatedData,
  );

  return sendSuccess(
    res,
    200,
    result.sessionsEnded
      ? `Updated ${result.changed.join(" and ")}. The account has been signed out everywhere, and the new details are unverified until the user confirms them.`
      : `Updated ${result.changed.join(" and ")}. The new details are unverified until the user confirms them.`,
    result,
  );
});
