const { requestRefund, REFUNDABLE_CLAIM_STATUSES } = require("./requestRefund");
const {
  approveRefundAsVendor,
  rejectRefundAsVendor,
  cancelRefund,
  VENDOR_CAN_DECIDE,
} = require("./decideRefund");
const {
  approveRefundAsAdmin,
  rejectRefundAsAdmin,
  executeRefund,
  ADMIN_CAN_DECIDE,
  OVERRIDE_FROM,
} = require("./executeRefund");
const {
  escalateStaleRefunds,
  reconcileRefunds,
  remindVendorsAboutRefunds,
  remindCustomersAboutBankDetails,
} = require("./refundJobs");
const {
  getRefunds,
  getRefundDetail,
  assertRefundAccess,
} = require("./getRefunds");
const {
  requestBankDetails,
  attachBankToRefund,
  payRefundToBank,
  confirmRefundPayout,
  failRefundPayout,
} = require("./manualBankRefund");

module.exports = {
  // The customer asks. Order of operations is the design: eligibility → freeze
  // the split → create the request (the unique index settles a double tap) →
  // hold the settlement.
  requestRefund,
  REFUNDABLE_CLAIM_STATUSES,
  // The vendor decides; the amount may go down, never up.
  approveRefundAsVendor,
  rejectRefundAsVendor,
  // The customer withdraws — allowed until the money is with Razorpay.
  cancelRefund,
  VENDOR_CAN_DECIDE,
  // The admin clears it. On the normal path this is not a second gate — the
  // vendor already decided. Overriding needs a written reason and is counted.
  approveRefundAsAdmin,
  rejectRefundAsAdmin,
  /**
   * Sends the money. `attemptCount` is bumped BEFORE the gateway call, which is
   * what lets a crashed attempt ask Razorpay what exists instead of paying twice.
   */
  executeRefund,
  ADMIN_CAN_DECIDE,
  OVERRIDE_FROM,
  /**
   * The three safety nets. Registered in `jobs/index.js`, which gives them the
   * cross-process lock and the health record for free.
   */
  escalateStaleRefunds,
  reconcileRefunds,
  remindVendorsAboutRefunds,
  /**
   * The fourth: `AWAITING_BANK_DETAILS` was the one open state with nothing
   * watching it. Two nudges to the customer, then the row becomes an admin's —
   * because a hold nobody releases costs the **vendor**, for ever.
   */
  remindCustomersAboutBankDetails,
  // One endpoint, three shapes.
  getRefunds,
  getRefundDetail,
  assertRefundAccess,
  /**
   * `MANUAL_BANK` — the fallback for when the original card or UPI cannot take
   * the money back. Admin asks, customer supplies an account, admin does the
   * NEFT and confirms it with a UTR. Deliberately separate from `executeRefund`:
   * one calls a gateway, the other waits for a person.
   */
  requestBankDetails,
  attachBankToRefund,
  payRefundToBank,
  confirmRefundPayout,
  failRefundPayout,
};
