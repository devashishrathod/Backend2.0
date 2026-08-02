const Transaction = require("../../models/Transaction");

exports.generateUniqueInvoiceId = async () => {
  const prefix = "INV-#";
  while (true) {
    const randomNumber = Math.floor(10000 + Math.random() * 90000);
    const invoiceId = `${prefix}${randomNumber}`;
    const existingTransaction = await Transaction.findOne({ invoiceId });
    if (!existingTransaction) return invoiceId;
  }
};
