const express = require("express");
const router = express.Router();
const { validateSchema } = require("../middlewares");
const { getByToken } = require("../controllers/documents");
const { validateDocumentByToken } = require("../validator/documents");

/**
 * The public document link. **No JWT** — see the controller.
 *
 * ⚠️ No `router.use(verifyJwtToken)` anywhere in this file, deliberately. The
 * link is opened from a WhatsApp message or an email, where the browser has no
 * session; an auth gate here means the Download button does not work.
 *
 * Replaces `/transactions/invoice/:token` and `/settlements/statement/:token`,
 * which between them could serve two of the six document kinds and each had its
 * own token field name. A refund receipt and a chargeback advice would have made
 * it four routes.
 *
 * ⚠️ `validateSchema` is doing more here than on a normal route. With no auth in
 * front, the token is the only credential — and the resolver behind this route
 * walks four collections looking for it, so an unchecked path segment costs four
 * queries a stranger can trigger at will. The shape check keeps malformed input
 * out of the lookup entirely, and answers it with the same "Document not found."
 * a real miss gets.
 */
router.get("/:token", validateSchema(validateDocumentByToken), getByToken);

module.exports = router;
