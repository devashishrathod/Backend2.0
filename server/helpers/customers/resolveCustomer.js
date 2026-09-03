const Customer = require("../../models/Customer");
const { throwError } = require("../../utils");

exports.resolveCustomerByUserId = async (userId) => {
  const customer = await Customer.findOne({
    userId,
    isActive: true,
    isDeleted: false,
  }).select("_id");

  if (!customer) throwError(404, "Customer not found.");
  return customer;
};
