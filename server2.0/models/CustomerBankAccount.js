const mongoose = require("mongoose");
const { customerField } = require("./validObjectId");
const { isValidAccountNumber, isValidIFSC } = require("../validator/common");

/**
 * Where a refund goes when it cannot go back the way it came.
 *
 * ### ⚠️ Why this is not `models/Bank.js`
 *
 * `Bank` looks like the obvious home and is the wrong one. It is a **CGPEY
 * penny-drop verification record for a brand**, not a bank-account model:
 * `brandId` is `required`, and — the part that bites — account-number
 * uniqueness is enforced by **collection-wide queries** rather than an index,
 * in `verifyBankAndFetchDetails` and `createBank`.
 *
 * Put a customer row in there and those queries start seeing it. A vendor
 * entering their own account would be told *"this account number is already in
 * use"* by a customer they have never heard of, mid-onboarding — and the same
 * check feeds the brand's verification score, so a collision can push a KYC
 * result to `REJECTED` for a reason nobody can see. That is why `MANUAL_BANK`
 * was deferred rather than bolted onto `Bank`.
 *
 * A separate collection has none of that surface, and the uniqueness that
 * actually matters here — one customer not holding the same account twice — is
 * an index rather than a query.
 *
 * ### What is trusted
 *
 * Nothing the client sends about verification. `isVerified` and `verifiedAt` are
 * derived on the server from the provider's own response, the same rule
 * `createBank` applies, because a client that can set `isVerified: true` can
 * point a refund anywhere.
 */
const customerBankAccountSchema = new mongoose.Schema(
  {
    customerId: { ...customerField, required: true, index: true },

    accountHolderName: { type: String, required: true, trim: true },
    accountNumber: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (value) => isValidAccountNumber(value),
        message: (props) => `${props.value} is not a valid account number!`,
      },
    },
    /**
     * Everything but the last four, so a listing, a notification or a support
     * screen never has to read the real number to be useful.
     */
    maskedAccountNumber: { type: String, required: true },
    accountLast4Digits: { type: String, required: true },
    ifscCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      validate: {
        validator: (value) => isValidIFSC(value),
        message: (props) => `${props.value} is not a valid IFSC code!`,
      },
    },
    bankName: { type: String, trim: true },
    branchName: { type: String, trim: true },

    /**
     * ⚠️ Server-derived, never accepted from the client.
     *
     * `false` here means no money may be sent, however complete the row looks.
     * A penny drop can fail on an account that exists — closed, frozen, or a
     * name that does not match — and paying into one of those is the single
     * payout mistake with no recall.
     */
    isVerified: { type: Boolean, default: false },
    verifiedAt: { type: Date },
    /** The provider's raw answer, kept for disputes. Admin-only. */
    verificationResponse: { type: mongoose.Schema.Types.Mixed },
    /**
     * Did the name on the account match the name we hold?
     *
     * Recorded rather than enforced: a legitimate mismatch is common — a
     * maiden name, an initial, a joint account — and refusing every one of them
     * strands refunds that were about to be paid correctly. It is the admin's
     * call, and this is what they need to make it.
     */
    isNameMatch: { type: Boolean },
    matchingScore: { type: String },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

/**
 * One customer cannot hold the same account twice.
 *
 * ⚠️ Partial on `isDeleted: false`, so removing an account and adding it back
 * later works. A blanket unique index would refuse the second row for ever, and
 * the customer would have no way to undo a deletion they made by mistake.
 *
 * ⚠️ And deliberately **not** unique on `accountNumber` alone: two people
 * genuinely do share an account — spouses, a family account, a parent paying
 * for a child. Refusing the second one would strand a real refund, and the
 * cross-customer check that `Bank` performs is exactly the behaviour this model
 * exists to avoid.
 */
customerBankAccountSchema.index(
  { customerId: 1, accountNumber: 1 },
  {
    name: "customer_bank_account_unique",
    unique: true,
    partialFilterExpression: { isDeleted: false },
  },
);

module.exports = mongoose.model(
  "CustomerBankAccount",
  customerBankAccountSchema,
);
