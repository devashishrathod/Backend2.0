const { createVoucherClaimOrder } = require("./createVoucherClaimOrder");
const { verifyVoucherClaimPayment } = require("./verifyVoucherClaimPayment");
const { getClaimTransactions, getClaims } = require("./getClaimTransactions");
const {
  getClaimTransactionDetail,
} = require("./getClaimTransactionDetail");
const { getClaimDetail } = require("./getClaimDetail");
const {
  releaseStaleClaimHolds,
  resumeIncompleteSettlements,
  reconcileClaimPayments,
  alertStuckAuthorizations,
} = require("./claimJobs");

module.exports = {
  createVoucherClaimOrder,
  verifyVoucherClaimPayment,
  // One endpoint, three shapes — the projection follows the role.
  getClaimTransactions,
  getClaims,
  // Where the payment notification's deep link lands. Same projections as the
  // listings, so a detail page cannot show what a list hides.
  getClaimTransactionDetail,
  // The claim's own page: what was bought, what was paid, and the story so far.
  getClaimDetail,
  // The four safety nets. Registered in `jobs/index.js`, which gives them the
  // cross-process lock and the health record.
  releaseStaleClaimHolds,
  resumeIncompleteSettlements,
  reconcileClaimPayments,
  alertStuckAuthorizations,
};
