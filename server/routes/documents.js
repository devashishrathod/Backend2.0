const express = require("express");
const router = express.Router();
const { getByToken } = require("../controllers/documents");

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
 */
router.get("/:token", getByToken);

module.exports = router;
