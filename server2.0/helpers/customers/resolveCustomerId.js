const mongoose = require("mongoose");

/**
 * The customer's ObjectId, from whatever `req.customerId` happens to hold.
 *
 * ### Why this is not just `req.customerId`
 *
 * `middlewares/authenticate.js` sets `req.customerId = user.customerId`, and
 * `user` comes from `services/users/getUserById.js`, which **populates** that
 * path. So `req.customerId` is a full Customer *document*, not an id — despite
 * the name.
 *
 * That difference is silent everywhere it matters:
 *
 *  - `String(req.customerId)` gives `"[object Object]"`, not a hex id, so a
 *    comparison against a stored id is always false.
 *  - Echoing it into a response leaks the whole customer record — including
 *    fields the endpoint never meant to return.
 *  - Used in an aggregation `$expr` or a `$match`, it matches nothing, which
 *    reads as "this customer has no history" rather than as an error.
 *
 * None of those throw. Every one of them produces a wrong answer that looks
 * like a correct one, which is why this exists rather than a convention.
 *
 * Accepts a document, an id, a string, or a request-like object, and returns an
 * ObjectId — or `null` for a guest, which is a legitimate caller on every
 * preview endpoint.
 *
 * @param {object|string} actor `req`, `req.customerId`, an id, or a document
 * @returns {mongoose.Types.ObjectId|null}
 */
exports.resolveCustomerId = (actor) => {
  if (!actor) return null;

  // A request object: take the field off it and recurse.
  if (actor.customerId !== undefined) {
    return exports.resolveCustomerId(actor.customerId);
  }

  // Already an ObjectId.
  if (actor instanceof mongoose.Types.ObjectId) return actor;

  // A populated document, or a lean object.
  if (typeof actor === "object") {
    if (actor._id) return exports.resolveCustomerId(actor._id);
    return null;
  }

  // A hex string. Anything else — a stray "[object Object]" from a caller that
  // stringified a document — is refused rather than turned into a bad query.
  if (typeof actor === "string" && mongoose.Types.ObjectId.isValid(actor)) {
    return new mongoose.Types.ObjectId(actor);
  }

  return null;
};

/** The same value as a string, for logging and response bodies. */
exports.resolveCustomerIdString = (actor) => {
  const id = exports.resolveCustomerId(actor);
  return id ? String(id) : null;
};
