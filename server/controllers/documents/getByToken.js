const { asyncWrapper, sendRedirect } = require("../../utils");
const { getDocumentByToken } = require("../../services/documents");

/**
 * The public link to any Trydood document.
 *
 * Redirects to the file rather than streaming it: the PDF already sits on a CDN,
 * and proxying every download through this service buys nothing.
 *
 * No JWT. The link is opened from a WhatsApp message or an email, where the
 * browser has no session — requiring one means the Download button does not work,
 * which is the one thing it has to do. The 32-byte token is the credential.
 *
 * One route for all six kinds. The resolver works out which collection the token
 * belongs to; the holder of a link does not have to know, and neither does the
 * code that built it.
 */
exports.getByToken = asyncWrapper(async (req, res) => {
  const { url } = await getDocumentByToken(req.params.token);
  return sendRedirect(res, url);
});
