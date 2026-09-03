const express = require("express");
const router = express.Router();

const { validateSchema, isAdmin } = require("../middlewares");
const {
  validateGetAllAdminCustomers,
  validateGetAdminCustomer,
} = require("../validator/customers");
const { getAllAdmin, getAdmin } = require("../controllers/customers");

// ---------------------------------------------------------------------------
// Admin — the customer directory, and one customer in full.
//
// `/admin/get-all` is the triage list: identity, the account behind it, spend,
// refunds, chargebacks, engagement and profile completeness, one row per
// customer. `/admin/:customerId` is the support screen behind a row — the same
// figures, plus the history, addresses, masked bank rows, referral graph and
// the live refund allowance.
//
// Both admin-only, and not by accident. They report refund refusals, chargeback
// counts and wallet balances — facts about a person that the person themselves
// must never be handed, and that a vendor has no claim to either. There is no
// role branch for the same reason `getAllAdminBrands` has none: a projection
// that strips those is one edit away from leaking them.
//
// ⚠️ `get-all` is declared **before** `/:customerId` so the literal path is
// never read as a customer id.
// ---------------------------------------------------------------------------
router.get(
  "/admin/get-all",
  isAdmin,
  validateSchema(validateGetAllAdminCustomers),
  getAllAdmin,
);

/**
 * Opens by Mongo id or by the `#TC64840` number a customer reads out. The `#`
 * needs percent-encoding in a URL (`%23TC64840`); the bare `TC64840` form works
 * without it, which is what an admin pasting from a ticket will actually type.
 *
 * Deleted and deactivated customers open here — the directory hides them, but
 * "where did this account go?" has to be answerable, and a closed account can
 * still have a refund owed on it.
 */
router.get(
  "/admin/:customerId",
  isAdmin,
  validateSchema(validateGetAdminCustomer),
  getAdmin,
);

module.exports = router;
