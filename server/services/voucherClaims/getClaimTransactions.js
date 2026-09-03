const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const { pagination } = require("../../utils");
const {
  buildClaimTransactionPipeline,
  buildClaimPipeline,
} = require("../../helpers/transactions/buildClaimReadPipeline");

/**
 * A money listing, scoped to whoever is asking.
 *
 * **One endpoint, three shapes.** A customer sees their payments, a brand sees
 * what was taken at theirs, an admin sees everything — and each gets a different
 * projection, decided by `claimProjection` rather than by three services that
 * would drift.
 *
 * The scope is a filter, not a post-filter: filtering after the query makes the
 * pagination count wrong, so a page of ten comes back with three rows and the
 * client cannot tell whether that is the end of the list.
 */
exports.getClaimTransactions = async (actor, query = {}) => {
  const pipeline = buildClaimTransactionPipeline(actor, query);
  return pagination(
    Transaction,
    pipeline,
    query.page || 1,
    query.limit || 20,
    "payment",
    // A customer who has bought nothing has an empty history, not a missing
    // one. 404 here would make a first-run app show an error screen.
    { allowEmpty: true },
  );
};

/**
 * A claim listing — "what did I buy", not "what money moved".
 *
 * A customer's order history is this one. It reads the frozen snapshots, so a
 * claim from September still names the voucher and the outlet as they were, even
 * after the voucher was republished and the outlet renamed.
 */
exports.getClaims = async (actor, query = {}) => {
  const pipeline = buildClaimPipeline(actor, query);
  return pagination(
    VoucherClaim,
    pipeline,
    query.page || 1,
    query.limit || 20,
    "claim",
    { allowEmpty: true },
  );
};
