const CustomerBankAccount = require("../../models/CustomerBankAccount");
const { throwError } = require("../../utils");
const { resolveCustomerId } = require("../../helpers/customers");
const { present } = require("./addBankAccount");

/**
 * The customer's own accounts, newest first.
 *
 * ⚠️ `present()` — shared with the attach path rather than re-listed here — so
 * the raw `accountNumber` and the provider's full response cannot leak from one
 * surface after being masked on the other. One decision, one place.
 *
 * Unverified rows are returned too, and marked. Hiding them would leave a
 * customer who tried and failed staring at an empty list with no idea whether
 * their attempt registered.
 */
exports.getBankAccounts = async (actor) => {
  const customerId = resolveCustomerId(actor);

  const accounts = await CustomerBankAccount.find({
    customerId,
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .lean();

  return accounts.map(present);
};

/**
 * Remove one. Soft, like everything else here.
 *
 * ⚠️ Refuses while a refund is pointed at it. The `PayoutLeg` freezes its own
 * `bankSnapshot` at the moment money is sent, so a deletion cannot rewrite
 * history — but a refund waiting to be paid would lose its destination and land
 * in the admin's queue with nothing to pay into.
 */
exports.removeBankAccount = async (actor, accountId) => {
  const customerId = resolveCustomerId(actor);

  const RefundRequest = require("../../models/RefundRequest");
  const inUse = await RefundRequest.findOne({
    customerBankAccountId: accountId,
    isOpen: true,
    isDeleted: false,
  }).select("_id");

  if (inUse) {
    throwError(
      409,
      "A refund is waiting to be paid into this account. It can be removed once that refund is done.",
    );
  }

  const removed = await CustomerBankAccount.findOneAndUpdate(
    { _id: accountId, customerId, isDeleted: false },
    { $set: { isDeleted: true } },
    { returnDocument: "after" },
  );

  if (!removed) throwError(404, "Bank account not found.");

  return { removed: true };
};
