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
} = require("./refundJobs");
const {
  getRefunds,
  getRefundDetail,
  assertRefundAccess,
} = require("./getRefunds");

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
  // One endpoint, three shapes.
  getRefunds,
  getRefundDetail,
  assertRefundAccess,
};
