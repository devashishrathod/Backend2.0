const { generateUniqueCustomerId } = require("./generateUniqueCustomerId");
const { resolveCustomerByUserId } = require("./resolveCustomer");
const {
  resolveCustomerId,
  resolveCustomerIdString,
} = require("./resolveCustomerId");

module.exports = {
  generateUniqueCustomerId,
  resolveCustomerByUserId,
  // `req.customerId` is a populated document, not an id. Always normalise.
  resolveCustomerId,
  resolveCustomerIdString,
};
