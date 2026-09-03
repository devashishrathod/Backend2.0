const { asyncWrapper, sendRedirect } = require("../../utils");
const { getInvoiceByToken } = require("../../services/transactions");

/**
 * The public invoice link.
 *
 * Redirects to the file rather than streaming it: the PDF already sits on a CDN,
 * and proxying every download through this service buys nothing.
 *
 * No JWT. The link is opened from a WhatsApp message or an email, where the
 * browser has no session — requiring one means the Download button does not
 * work, which is the one thing it has to do. The 32-byte token is the credential.
 */
exports.invoiceByToken = asyncWrapper(async (req, res) => {
  const { url } = await getInvoiceByToken(req.params.token);
  return sendRedirect(res, url);
});
