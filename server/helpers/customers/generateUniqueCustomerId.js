const Customer = require("../../models/Customer");

exports.generateUniqueCustomerId = async () => {
  const prefix = "#TC";
  while (true) {
    const randomNumber = Math.floor(10000 + Math.random() * 90000);
    const uniqueId = `${prefix}${randomNumber}`;
    const existing = await Customer.findOne({ uniqueId });
    if (!existing) return uniqueId;
  }
};
