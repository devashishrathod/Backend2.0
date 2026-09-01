const LedgerEntry = require("../../models/LedgerEntry");
const {
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
  LEDGER_ENTRY_TYPE,
  LEDGER_ENTRY_RULES,
  ONCE_PER_TRANSACTION_TYPES,
} = require("../../constants/ledger");
const { round2 } = require("../subscribeds/calculatePricing");
const { throwError } = require("../../utils");

const { DUPLICATE_KEY } = require("../../constants/mongo");

/**
 * Write one ledger row.
 *
 * The **only** way a row is created. Everything about an entry that can be
 * derived — which account it belongs to, which way it moves, whether it may
 * repeat — is derived here from its type, so two call sites cannot disagree
 * about whether a refund is a debit.
 *
 * ### Idempotent by construction
 *
 * The capture-time types are posted once per transaction and no more, enforced
 * by a partial unique index. A replayed webhook or a resumed settle hits that
 * index, gets a duplicate-key error, and this reports it as `duplicate: true`
 * rather than throwing — because "this was already posted" is the correct
 * outcome of a retry, not a failure of one.
 *
 * That matters more than care at the call site: posting `COLLECTION` twice
 * credits a vendor twice for one payment, and no amount of "we check first"
 * survives two processes checking at the same moment.
 *
 * ### Zero amounts are skipped
 *
 * A ₹0 `VENDOR_PROMO_SHARE` on a claim with no promo says nothing and clutters
 * every statement it appears on. The exception is an explicit `allowZero`, for
 * the cases where the absence of a row would itself be ambiguous.
 *
 * @param {object} args
 * @param {string} args.entryType     LEDGER_ENTRY_TYPE
 * @param {number} args.amount        always positive; direction carries the sign
 * @param {string} [args.account]     only for types whose account is not fixed
 * @param {string} [args.direction]   only to override the type's default
 * @param {object} [args.brandId]     required on VENDOR_PAYABLE
 * @param {string} [args.narration]   what an accountant reads
 * @returns {Promise<{entry, duplicate: boolean, skipped: boolean}>}
 */
exports.recordLedgerEntry = async ({
  entryType,
  amount,
  account,
  direction,
  brandId,
  transactionId,
  voucherClaimId,
  settlementId,
  refundRequestId,
  disputeId,
  payoutLegId,
  narration,
  occurredAt,
  reversalOf,
  reason,
  createdBy,
  currency,
  allowZero = false,
  /**
   * Force this row out of the once-per-transaction index.
   *
   * Only a reversal sets it. A reversal is by definition a **second** row of the
   * same type on the same transaction, so leaving it in the index would make it
   * impossible to write — the correction mechanism would be blocked by the
   * safety mechanism.
   */
  isReversal = false,
}) => {
  const rule = LEDGER_ENTRY_RULES[entryType];
  if (!entryType || !LEDGER_ENTRY_TYPE[entryType]) {
    throwError(500, `Unknown ledger entry type: ${entryType}`);
  }

  const resolvedAccount = account || rule?.account;
  const resolvedDirection = direction || rule?.direction;

  if (!resolvedAccount) {
    // `GATEWAY_FEE` lands on whichever account bears it, so the writer must say.
    throwError(
      500,
      `Ledger entry ${entryType} needs an explicit account — its type does not fix one.`,
    );
  }
  if (!resolvedDirection) {
    throwError(500, `Ledger entry ${entryType} needs a direction.`);
  }

  /**
   * A `VENDOR_PAYABLE` row with no brand is unreachable money: the balance query
   * groups by brand, so it would never appear in anyone's balance and never be
   * paid out. Refused rather than written.
   */
  if (resolvedAccount === LEDGER_ACCOUNT.VENDOR_PAYABLE && !brandId) {
    throwError(
      500,
      `A ${LEDGER_ACCOUNT.VENDOR_PAYABLE} ledger entry needs a brandId — without one it belongs to nobody's balance.`,
    );
  }

  // An adjustment nobody explained cannot be told apart from a mistake.
  if (entryType === LEDGER_ENTRY_TYPE.MANUAL_ADJUSTMENT && !reason) {
    throwError(422, "A manual ledger adjustment needs a reason.");
  }

  const value = round2(amount);
  if (!Number.isFinite(value) || value < 0) {
    throwError(500, `Ledger amount must be a positive number, got ${amount}.`);
  }
  if (value === 0 && !allowZero) {
    return { entry: null, duplicate: false, skipped: true };
  }

  const isOncePerTransaction =
    !isReversal &&
    Boolean(transactionId) &&
    ONCE_PER_TRANSACTION_TYPES.includes(entryType);

  try {
    const entry = await LedgerEntry.create({
      entryType,
      direction: resolvedDirection,
      amount: value,
      currency,
      account: resolvedAccount,
      brandId,
      transactionId,
      voucherClaimId,
      settlementId,
      refundRequestId,
      disputeId,
      payoutLegId,
      narration,
      occurredAt: occurredAt || new Date(),
      reversalOf,
      reason,
      createdBy,
      isOncePerTransaction,
    });
    return { entry, duplicate: false, skipped: false };
  } catch (error) {
    if (error?.code === DUPLICATE_KEY) {
      /**
       * Already posted. The retry did its job; nothing is wrong.
       *
       * ⚠️ `refundRequestId` has to be part of the lookup when it is set. A
       * refund row shares its `entryType` and `transactionId` with the capture
       * row it reverses, so looking up by those two alone would hand back the
       * **capture** — and the caller would report a ₹800 collection as the
       * refund it had just tried to write.
       */
      const entry = await LedgerEntry.findOne(
        refundRequestId
          ? { entryType, refundRequestId }
          : { entryType, transactionId },
      );
      return { entry, duplicate: true, skipped: false };
    }
    throw error;
  }
};

/**
 * Undo an entry by writing its opposite.
 *
 * Never edits the original — that is the whole discipline. The reversal carries
 * `reversalOf`, so the pair reads as "this happened, and then it was undone",
 * which is what actually occurred. An edited row would read as though the first
 * thing never happened at all.
 */
exports.reverseLedgerEntry = async (entry, { reason, createdBy } = {}) => {
  if (!entry) throwError(500, "Nothing to reverse.");

  const opposite =
    entry.direction === LEDGER_DIRECTION.CREDIT
      ? LEDGER_DIRECTION.DEBIT
      : LEDGER_DIRECTION.CREDIT;

  return exports.recordLedgerEntry({
    entryType: entry.entryType,
    amount: entry.amount,
    account: entry.account,
    direction: opposite,
    brandId: entry.brandId,
    transactionId: entry.transactionId,
    voucherClaimId: entry.voucherClaimId,
    settlementId: entry.settlementId,
    narration: `Reversal: ${entry.narration || entry.entryType}`,
    reversalOf: entry._id,
    reason,
    createdBy,
    // Keeps this row out of the once-per-transaction index. Without it the
    // reversal collides with the entry it is undoing, and the correction
    // mechanism is blocked by the safety mechanism.
    isReversal: true,
    // A zero-amount entry is normally skipped as noise, but a reversal of one
    // still needs to exist: the pair is the record of what was undone.
    allowZero: true,
  });
};
