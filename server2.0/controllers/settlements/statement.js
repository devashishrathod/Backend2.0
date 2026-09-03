const { asyncWrapper, sendRedirect } = require("../../utils");
const { getStatementByToken } = require("../../services/settlements");

/**
 * The public payout-statement link.
 *
 * Redirects to the file rather than streaming it: the PDF already sits on a CDN,
 * and proxying every download through this service buys nothing.
 *
 * **No JWT.** The link arrives in a payout notification and an email, and the
 * vendor opening it on their phone has no session in that browser — requiring
 * one means the Download button does not work, which is the one thing it has to
 * do. The 32-byte token is the credential, and revoking one is a field update.
 */
exports.statementByToken = asyncWrapper(async (req, res) => {
  const { url } = await getStatementByToken(req.params.token);
  return sendRedirect(res, url);
});
