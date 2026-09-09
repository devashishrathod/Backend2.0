const Joi = require("joi");

/**
 * The public document link — `GET /documents/:token`.
 *
 * ### Why a validator on an unauthenticated route
 *
 * The token **is** the credential. There is no JWT behind this route, because
 * the link is opened from a WhatsApp message or an email where the browser has
 * no session — so the only thing standing between a stranger and somebody's
 * invoice is the token's own unguessability.
 *
 * `crypto.randomBytes(32).toString("hex")` is exactly 64 hex characters. Nothing
 * else is a token this system has ever issued.
 *
 * ### What it actually saves
 *
 * `getDocumentByToken` walks **four** collections — `Transaction`,
 * `RefundRequest`, `Dispute`, `Settlement` — one after another until a token
 * matches. Without a shape check, `GET /documents/whatever` costs four database
 * queries on a route with no auth in front of it. With one, malformed input
 * never reaches the lookup.
 *
 * ### Why the message says nothing
 *
 * Every failure answers `"Document not found."` — the same words
 * `getDocumentByToken` uses for a token that does not exist. A holder of a bad
 * token learning that it was *nearly* right is how guessing gets cheaper.
 *
 * ⚠️ Replaces `validateStatementByToken` from `validator/settlements.js`, which
 * was written for the retired `/settlements/statement/:token` route and never
 * moved when one route took over all six document kinds. It sat unused while the
 * route that replaced it had no validation at all.
 */
exports.validateDocumentByToken = {
  params: Joi.object({
    token: Joi.string()
      .trim()
      .pattern(/^[a-f0-9]{64}$/i)
      .required()
      .messages({
        "any.required": "Document not found.",
        "string.empty": "Document not found.",
        "string.base": "Document not found.",
        "string.pattern.base": "Document not found.",
      }),
  }),
};
