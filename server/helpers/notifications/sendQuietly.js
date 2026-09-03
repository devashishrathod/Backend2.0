/**
 * Send a notice without letting it undo the thing it is announcing.
 *
 * ⚠️ A refund that went out, a hold that came off, a decision that was recorded
 * — none of those may be rolled back because an email server was down or a push
 * token had expired. The money has already moved; throwing here would unwind a
 * settled operation over a delivery failure.
 *
 * The same trade `recordClaimHistory` makes. A lost notice is logged loudly and
 * the business operation stands.
 */
exports.sendQuietly = async (send, context = "notification") => {
  try {
    return await send();
  } catch (error) {
    console.error(`[notify] ${context} failed:`, error?.message);
    return null;
  }
};
