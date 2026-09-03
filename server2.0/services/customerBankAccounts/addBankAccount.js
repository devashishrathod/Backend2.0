const Customer = require("../../models/Customer");
const CustomerBankAccount = require("../../models/CustomerBankAccount");
const { verifyOtp } = require("../otps");
const { fetchAPI } = require("../../helpers/cgpeyAPIs");
const { throwError } = require("../../utils");
const { LOGIN_TYPES, PRIMARY_VERIFICATION_STATUSES } = require("../../constants");
const { BANK_ATTACH_OTP_PURPOSE } = require("../../constants/customer");
const { resolveCustomerId } = require("../../helpers/customers");

const DUPLICATE_KEY = 11000;

/** The same target `sendBankOtp` used, or the code will never match. */
const otpTargetFor = (customer) =>
  customer?.whatsappNumber
    ? { type: LOGIN_TYPES.WHATSAPP, target: customer.whatsappNumber }
    : customer?.email
      ? { type: LOGIN_TYPES.EMAIL, target: customer.email }
      : null;

/**
 * Did the penny drop actually land?
 *
 * ⚠️ All four conditions, and never anything the client sent. `createBank`
 * applies exactly this rule for vendors and it is not loosened here: a row can
 * exist for an account the drop failed on, and paying into one of those is the
 * single payout mistake with no recall.
 */
const isDropSuccessful = (response) =>
  Boolean(
    response?.success &&
      response?.status === PRIMARY_VERIFICATION_STATUSES.SUCCESS &&
      response?.result?.is_valid &&
      response?.result?.recommended_action === "PROCEED",
  );

/** What the customer and every screen sees. Never the full account number. */
const present = (account) => ({
  _id: account._id,
  accountHolderName: account.accountHolderName,
  maskedAccountNumber: account.maskedAccountNumber,
  accountLast4Digits: account.accountLast4Digits,
  ifscCode: account.ifscCode,
  bankName: account.bankName,
  branchName: account.branchName,
  isVerified: account.isVerified,
  verifiedAt: account.verifiedAt,
  isNameMatch: account.isNameMatch,
  createdAt: account.createdAt,
});

exports.present = present;

/**
 * Attach a bank account to a customer, verified by a penny drop.
 *
 * ### The order is the design
 *
 * ```
 * OTP (consumed)  →  reuse an already-verified account  →  penny drop  →  store
 * ```
 *
 * The OTP goes **first** so a stolen session cannot make us spend a paid
 * verification call, let alone attach an account. The reuse check goes before
 * the drop so re-entering an account already proven costs nothing — the same
 * saving `verifyBankAndFetchDetails` makes for vendors.
 *
 * ### A failed drop is still recorded
 *
 * The row is written **before** the error is thrown. That reads oddly and is
 * deliberate: support needs to see that the customer tried and what the provider
 * said. Throwing without writing leaves someone insisting they entered their
 * details and nothing anywhere to show they did.
 *
 * `isVerified: false` is what actually stops the money — every payout path
 * checks it, so an unverified row is evidence and never a destination.
 */
exports.addBankAccount = async (actor, payload = {}) => {
  const customerId = resolveCustomerId(actor);

  const accountNumber = String(payload.accountNumber || "").trim();
  const ifscCode = String(payload.ifscCode || "").trim().toUpperCase();
  const accountHolderName = String(payload.accountHolderName || "").trim();

  const customer = await Customer.findOne({ _id: customerId, isDeleted: false })
    .select("whatsappNumber email fullName")
    .lean();
  if (!customer) throwError(404, "Customer not found.");

  const channel = otpTargetFor(customer);
  if (!channel) {
    throwError(422, "We have no WhatsApp number or email on file to verify against.");
  }

  // Consumes the code on success, and counts attempts on failure.
  await verifyOtp(channel.target, payload.otp, BANK_ATTACH_OTP_PURPOSE);

  const existing = await CustomerBankAccount.findOne({
    customerId,
    accountNumber,
    isDeleted: false,
  });

  /**
   * Already proven, unchanged. Re-running the drop would give the same answer
   * and bill us for it.
   */
  if (existing?.isVerified) return present(existing);

  const verificationResponse = await fetchAPI(process.env.CGPEY_BANK_ENDPOINT, {
    accountNumber,
    ifscCode,
  });

  const verified = isDropSuccessful(verificationResponse);
  const result = verificationResponse?.result || {};

  const bankData = {
    customerId,
    accountNumber,
    accountHolderName: accountHolderName || result.name_at_bank || customer.fullName,
    maskedAccountNumber: accountNumber.replace(/\d(?=\d{4})/g, "*"),
    accountLast4Digits: accountNumber.slice(-4),
    ifscCode,
    bankName: result.bank_name,
    branchName: result.branch,
    verificationResponse,
    // ⚠️ Server-derived. See `isDropSuccessful`.
    isVerified: verified,
    verifiedAt: verified ? verificationResponse.timestamp || new Date() : null,
    isNameMatch: result.name_match,
    matchingScore: result.matching_score,
  };

  let account;
  try {
    account = existing
      ? await CustomerBankAccount.findOneAndUpdate(
          { _id: existing._id, isDeleted: false },
          { $set: bankData },
          { returnDocument: "after", runValidators: true },
        )
      : await CustomerBankAccount.create(bankData);
  } catch (error) {
    /**
     * Two taps racing on the same account. The index decided; hand back the row
     * that won rather than an error, because from the customer's side they added
     * it once.
     */
    if (error?.code === DUPLICATE_KEY) {
      const won = await CustomerBankAccount.findOne({
        customerId,
        accountNumber,
        isDeleted: false,
      });
      if (won) return present(won);
    }
    throw error;
  }

  if (!verified) {
    /**
     * The row is saved above and stays saved. The customer needs the reason in
     * their own terms — "verification failed" sends them back to type the same
     * digits again.
     */
    throwError(
      422,
      result.message ||
        "We could not verify this account with your bank. Check the account " +
          "number and IFSC and try again, or contact support.",
      { isNameMatch: result.name_match ?? null },
    );
  }

  return present(account);
};
