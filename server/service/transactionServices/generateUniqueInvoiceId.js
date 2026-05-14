const Transaction = require("../../model/Transaction");
const { findOne } = require("../../db/dbServices");

exports.generateUniqueInvoiceId = async () => {
  const prefix = "INV-#";
  while (true) {
    const randomNumber = Math.floor(10000 + Math.random() * 90000);
    const invoiceId = `${prefix}${randomNumber}`;
    const existingTransaction = await findOne(Transaction, { invoiceId });
    if (!existingTransaction) return invoiceId;
  }
};
