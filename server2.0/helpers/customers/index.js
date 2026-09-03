const { generateUniqueCustomerId } = require("./generateUniqueCustomerId");
const { resolveCustomerByUserId } = require("./resolveCustomer");
const {
  resolveCustomerId,
  resolveCustomerIdString,
} = require("./resolveCustomerId");
const {
  collectCustomerStats,
  getCustomerStats,
  round2,
  SPENDING_STATUSES,
  REFUSED_STATUSES,
} = require("./customerStats");

module.exports = {
  generateUniqueCustomerId,
  resolveCustomerByUserId,
  // `req.customerId` is a populated document, not an id. Always normalise.
  resolveCustomerId,
  resolveCustomerIdString,
  /**
   * The admin directory and the admin detail screen read the same numbers, side
   * by side — a row in the list and the page it opens must not disagree about a
   * customer's money. One definition, batched by id so the list pays for its
   * page rather than for the whole collection.
   */
  collectCustomerStats,
  getCustomerStats,
  round2,
  // Which claim statuses count as money we hold, and which refund outcomes count
  // as a refusal. Exported so a caller that needs to filter rows the same way
  // cannot pick a different list.
  SPENDING_STATUSES,
  REFUSED_STATUSES,
};
