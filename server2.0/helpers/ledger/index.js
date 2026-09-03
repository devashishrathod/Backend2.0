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
const { postRefundEntries } = require("./postRefundEntries");
const {
  postChargebackLoss,
  postChargebackReversal,
} = require("./postChargebackEntries");
const {
  postPayoutEntries,
  reversePayoutEntries,
} = require("./postPayoutEntries");

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
  // The mirror image: each row reverses the capture row it matches, under the
  // same entry type, so a report grouped by type nets out on its own.
  postRefundEntries,
  /**
   * Booked on the **leg**, not the settlement — a split payout or a retry moves
   * its own money at its own moment, and a settlement-level key would refuse the
   * second leg's entry while the money still left.
   */
  postPayoutEntries,
  reversePayoutEntries,
  // A lost dispute is recovered from the vendor's next cycle — the strategy
  // vendor_settlement_plan.md §7.5 wrote down and nothing implemented.
  postChargebackLoss,
  postChargebackReversal,
};
