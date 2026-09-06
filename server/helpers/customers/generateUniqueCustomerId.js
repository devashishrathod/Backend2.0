const Customer = require("../../models/Customer");
const { generateUniqueDisplayId } = require("../common");

/**
 * `#TC123456` — the number a customer reads out to support.
 *
 * ⚠️ Six digits now, not five. `validateGetAdminCustomer` matches `#?TC\d+`, so
 * nothing pins the length; the doc's `#TC64840` example is simply an older,
 * shorter one and both keep working.
 */
exports.generateUniqueCustomerId = async () =>
  generateUniqueDisplayId(Customer, { prefix: "#TC" });
