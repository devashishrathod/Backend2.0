const express = require("express");
const router = express.Router();

const { validateSchema, isCustomer } = require("../middlewares");
const {
  requestBankOtp,
  addCustomerBankAccount,
  listCustomerBankAccounts,
  deleteCustomerBankAccount,
} = require("../controllers/customerBankAccounts");
const {
  validateAddBankAccount,
  validateDeleteBankAccount,
} = require("../validator/customerBankAccounts");

/**
 * A customer's bank accounts — used when a refund cannot go back the way it
 * came.
 *
 * ⚠️ `isCustomer` on every route, and the customer id comes from the token
 * inside each service. Nothing here accepts a `customerId`: an endpoint that did
 * would let one person read or add accounts against another.
 *
 * ### Why this is its own domain and not part of `/refunds`
 *
 * An account belongs to the customer, not to one refund. Filing it under a
 * refund would mean re-adding it — and re-verifying it, at cost — for the next
 * one, and would leave no way to look at what a customer has on file.
 */

/**
 * Step one: a code, before anything is added.
 *
 * Adding an account decides **where money goes**, so login alone is the wrong
 * strength of gate: anyone holding a live session could otherwise point a
 * pending refund at their own account, and a NEFT cannot be recalled.
 */
router.post("/otp", isCustomer, requestBankOtp);

/**
 * Step two: the account, with the code.
 *
 * The server does the penny drop itself and derives `isVerified` from the
 * provider's answer — nothing about verification is accepted from the client.
 */
router.post(
  "/",
  isCustomer,
  validateSchema(validateAddBankAccount),
  addCustomerBankAccount,
);

router.get("/", isCustomer, listCustomerBankAccounts);

/**
 * Soft delete, and refused while a refund is pointed at it — that refund would
 * otherwise lose its destination and land in the admin queue with nothing to pay
 * into.
 */
router.delete(
  "/:accountId",
  isCustomer,
  validateSchema(validateDeleteBankAccount),
  deleteCustomerBankAccount,
);

/**
 * ⚠️ `{ router, routePrefix }`, not `exports.routePrefix` — assigning
 * `module.exports` after setting a property replaces the whole object and the
 * prefix is silently lost, mounting this at `/customerBankAccounts`. That
 * happened once already; see `routes/voucherClaims.js`.
 */
module.exports = { router, routePrefix: "/bank-accounts" };
