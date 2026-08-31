const {
  recordLedgerEntry,
  reverseLedgerEntry,
} = require("./recordLedgerEntry");
const {
  getVendorBalance,
  getVendorBalances,
  getPlatformTotals,
} = require("./getVendorBalance");
const { postCaptureEntries } = require("./postCaptureEntries");

module.exports = {
  // The only way a ledger row is created. Never write one directly.
  recordLedgerEntry,
  // Corrections are new rows, never edits.
  reverseLedgerEntry,
  // A vendor's balance in one index scan.
  getVendorBalance,
  getVendorBalances,
  getPlatformTotals,
  // Every row a captured claim produces, idempotent so a resume is safe.
  postCaptureEntries,
};
