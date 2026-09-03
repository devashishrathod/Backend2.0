const { getPaymentDetails } = require("./getPaymentDetails");
const { generateRazorpaySignature } = require("./generateRazorpaySignature");
const {
  generateAndUploadInvoice,
  renderInvoicePdf,
} = require("./generateAndUploadInvoice");
// const {
//   generateAndUploadBillInvoice,
// } = require("./generateAndUploadBillInvoice");
// const { isSameDay } = require("./isSameDay");
const { generateInvoiceNumber } = require("./generateInvoiceNumber");
const { verifyRazorpayWebhook } = require("./verifyRazorpayWebhook");
const { buildInvoiceSnapshot } = require("./buildInvoiceSnapshot");
const { buildTransactionFilter } = require("./buildTransactionFilter");
const { logPaymentAccounts } = require("./logPaymentAccounts");
const { assertMoneyIndexes } = require("./assertMoneyIndexes");
const {
  assertTransactionAccess,
  assertClaimAccess,
  buildAccessScopeFilter,
} = require("./assertTransactionAccess");
const { recordRejectedWebhook } = require("./recordRejectedWebhook");
const { detectDoubleCapture } = require("./detectDoubleCapture");
const { recordFundsReceived } = require("./recordFundsReceived");
const {
  buildMoneyListFilter,
  claimProjection,
  claimRecordProjection,
  buildClaimTransactionPipeline,
  buildClaimPipeline,
  pickByProjection,
} = require("./buildClaimReadPipeline");

module.exports = {
  generateInvoiceNumber,
  verifyRazorpayWebhook,
  buildInvoiceSnapshot,
  buildTransactionFilter,
  logPaymentAccounts,
  assertMoneyIndexes,
  // Who may open a money row, and how much of it they get to read. One source
  // for both the single-row check and the listing filter.
  assertTransactionAccess,
  assertClaimAccess,
  buildAccessScopeFilter,
  recordRejectedWebhook,
  detectDoubleCapture,
  /**
   * The one thing that fills `fundsReceivedAt` — and settlement eligibility keys
   * on it, not on `verifiedAt`. Paying a vendor from money the gateway has not
   * settled yet is how a platform funds its own float without deciding to.
   */
  recordFundsReceived,
  // The money-read surface: one filter builder, one projection per audience,
  // shared by every listing and by the detail endpoint so they cannot drift.
  buildMoneyListFilter,
  claimProjection,
  claimRecordProjection,
  buildClaimTransactionPipeline,
  buildClaimPipeline,
  pickByProjection,
  getPaymentDetails,
  generateRazorpaySignature,
  generateAndUploadInvoice,
  renderInvoicePdf,
  // generateAndUploadBillInvoice,
  // isSameDay,
};
