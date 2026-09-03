const mongoose = require("mongoose");
const Settlement = require("../../models/Settlement");
const Transaction = require("../../models/Transaction");
const Brand = require("../../models/Brand");
const Bank = require("../../models/Bank");
const {
  TRANSACTION_PURPOSE,
  INVOICE_SERIES,
} = require("../../constants/transaction");
const { PAYMENT_STATUS } = require("../../constants");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const { DUPLICATE_KEY } = require("../../constants/mongo");
const { getCustomerConfig } = require("../../helpers/settings");
const {
  buildTransactionFilter,
  generateInvoiceNumber,
} = require("../../helpers/transactions");
const {
  settlementPeriodStart,
  settlementPeriodEnd,
} = require("../../helpers/dates");
const {
  buildEligibilityFilter,
  claimTransactions,
  claimRefundAdjustments,
  claimChargebackAdjustments,
  transitionSettlement,
} = require("../../helpers/settlements");

const HOUR_MS = 60 * 60 * 1000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Build one day's settlement for every brand that took money.
 *
 * ### The order is the design
 *
 * ```
 * canonical period → shell (idempotency key) → claim rows atomically
 *   → total ONLY what was claimed → PENDING_APPROVAL (or CARRIED_FORWARD)
 * ```
 *
 * The obvious order — select, total, write — leaves a window between selecting
 * and writing in which a refund lands. That payment is then counted in a
 * settlement it should not be in **while** the refund is also deducted: the same
 * money moves twice. So the shell exists first, the rows are claimed with
 * `settlementId: null` as the lock, and the arithmetic reads only what was
 * actually captured.
 *
 * ### It is safe to run twenty times
 *
 * `jobs/index.js` runs every job once at boot, before the interval starts, and
 * the runner is per-process — so a restart or a second instance runs this again.
 * Two things make that harmless:
 *
 *  - `periodEnd` is **canonical** (`helpers/dates/istDate.js`), so the
 *    idempotency key is byte-identical on every run of the same day. Derived from
 *    `new Date()` it would not be, and two settlements would exist for one day.
 *  - The unique index on that key is what actually refuses the second shell —
 *    not the read-then-write check above it, which two concurrent runs both pass.
 */
exports.buildSettlements = async ({ at = new Date() } = {}) => {
  const config = await getCustomerConfig();
  const settings = config.settlement || {};

  if (settings.isEnabled === false) {
    return { skipped: true, reason: "Settlement is switched off in settings." };
  }

  /**
   * ⚠️ `?? 3`, not `|| 3`.
   *
   * A configured `delayDays: 0` is falsy, so `||` silently rewrote it to 3 and
   * built a period three days in the past — the wrong day, with no error. Zero
   * is a legitimate setting (same-day settlement) and `assertSettlementTimingRule`
   * is what decides whether it is *safe*, not this line.
   */
  const configuredDelay = Number(settings.delayDays);
  const delayDays = Number.isFinite(configuredDelay) ? configuredDelay : 3;
  const bufferHours = Number(settings.payoutBufferHours) || 0;
  const minPayout = Number(settings.minPayoutAmount) || 0;

  /**
   * ⚠️ Canonical, and never `new Date()`.
   *
   * One IST day has exactly one of these however often, and from however many
   * processes, the job runs.
   */
  const periodStart = settlementPeriodStart(delayDays, at);
  const periodEnd = settlementPeriodEnd(delayDays, at);

  /**
   * The gateway must have settled the money to **us** long enough ago to be
   * sure. `fundsReceivedAt` is observed from Razorpay, not inferred from a
   * calendar — see `helpers/transactions/recordFundsReceived.js`.
   */
  const fundsReceivedBefore = new Date(at.getTime() - bufferHours * HOUR_MS);

  const brandIds = await brandsWithEligibleMoney({
    periodEnd,
    fundsReceivedBefore,
  });

  const built = [];
  let skipped = 0;
  let carriedForward = 0;

  const failures = [];

  for (const brandId of brandIds) {
    /**
     * ⚠️ One brand's failure must not cost every brand behind it their payout.
     *
     * This loop had no guard, so a single throw — a brand with no verified bank,
     * a corrupt pricing block, a transient write error — aborted the whole
     * nightly run. Every remaining brand was simply skipped, and the failing
     * brand's shell was left holding rows it had already claimed: stranded, and
     * invisible to the next build because its `idempotencyKey` owns the period.
     * One bad row could stop a platform's payouts and nothing would say so.
     *
     * Now each brand stands alone. `sweepAbandonedDrafts` releases whatever the
     * failed one stranded, and the failures are reported rather than thrown, so
     * the job's health record carries them instead of reading as a clean run.
     */
    try {
      const result = await buildForBrand({
        brandId,
        periodStart,
        periodEnd,
        fundsReceivedBefore,
        minPayout,
        settings,
      });

      if (result.reused) skipped += 1;
      else if (result.status === SETTLEMENT_STATUS.CARRIED_FORWARD) carriedForward += 1;
      else if (result.settlement) built.push(result.settlement.settlementNumber || result.settlement._id);
    } catch (error) {
      failures.push({ brandId: String(brandId), reason: error?.message });
      console.error(
        `[buildSettlements] brand ${brandId} failed; the rest of the run continues:`,
        error?.message,
      );
    }
  }

  return {
    periodStart,
    periodEnd,
    brandsChecked: brandIds.length,
    built: built.length,
    carriedForward,
    skipped,
    failed: failures.length,
    // Named, so the job health record says which brand rather than "1 failed".
    ...(failures.length ? { failures } : {}),
  };
};

/**
 * Which brands have anything to settle.
 *
 * A `distinct` over the eligible rows rather than "every brand" — a platform
 * with ten thousand brands and forty active ones should not open ten thousand
 * shells to discover that.
 */
const brandsWithEligibleMoney = async ({ periodEnd, fundsReceivedBefore }) => {
  /**
   * ⚠️ Built from `buildEligibilityFilter`, never restated.
   *
   * This used to carry its own hand-written copy of the same predicate, and the
   * two drifted the moment one changed: eligibility stopped excluding partially
   * refunded payments, this did not, and the brand was never even *considered* —
   * so the fix looked like it had done nothing. Two definitions of "eligible" is
   * one too many for a rule that decides whether anyone gets paid.
   *
   * `brandId` is the one key this filter must not carry, since the whole point
   * is to discover which brands to ask about.
   */
  const { brandId, ...eligible } = buildEligibilityFilter({
    brandId: null,
    eligibleBefore: periodEnd,
    fundsReceivedBefore,
  });

  return Transaction.distinct("brandId", eligible);
};

const buildForBrand = async ({
  brandId,
  periodStart,
  periodEnd,
  fundsReceivedBefore,
  minPayout,
  settings,
}) => {
  const idempotencyKey = `STL:${brandId}:${periodEnd.toISOString()}`;

  let settlement;
  try {
    settlement = await Settlement.create({
      brandId,
      periodStart,
      periodEnd,
      cycleType: settings.cycleType,
      payoutProvider: settings.payoutProvider,
      idempotencyKey,
      /**
       * ⚠️ `TD/STL/26-27/000123`, and nothing was allotting one.
       *
       * `SETTLEMENT_NUMBER` sat in the constants with a prefix, a pad width and
       * a counter key, and `INVOICE_SERIES.SETTLEMENT` was already wired into
       * `generateInvoiceNumber` — every single reference in the codebase was a
       * **read**. So the field was always empty: the admin's `settlementNumber`
       * search matched nothing, every vendor notification printed a dash where
       * the reference should be, and ledger narrations said
       * "Payout for <objectid>" — the one string a person quotes back when a
       * payout is queried.
       *
       * Allotted here rather than in a pre-save hook because `Settlement.create`
       * can legitimately fail on the idempotency key, and a hook would burn a
       * number from a GST-facing sequence on every duplicate build attempt.
       */
      settlementNumber: await generateInvoiceNumber({
        series: INVOICE_SERIES.SETTLEMENT,
        at: periodEnd,
      }),
      status: SETTLEMENT_STATUS.DRAFT,
      // Frozen here so a vendor changing their bank details between the build
      // and the NEFT cannot redirect a payout somebody has already signed off.
      bankSnapshot: await freezeBankSnapshot(brandId),
    });
  } catch (error) {
    if (error?.code === DUPLICATE_KEY) {
      /**
       * This day is already built. The unique index decided, not the timing —
       * which is exactly what makes a boot-storm or a second instance harmless.
       */
      return { reused: true };
    }
    throw error;
  }

  // ---------------- claim, then count ----------------
  /**
   * ⚠️ Sequential, and the order is load-bearing. These used to run in
   * `Promise.all`.
   *
   * `claimRefundAdjustments` now only takes refunds whose payment carries a
   * `settlementId` — that is what stops a fully refunded payment's clawback
   * being deducted from sales the vendor *was* paid for. A partially refunded
   * payment gets its id from `claimTransactions`, so if the two race, the refund
   * claim can look before the stamp lands and skip a deduction that belongs in
   * this cycle: the vendor would be paid the full sale and the clawback would
   * never be taken.
   */
  const transactions = await claimTransactions({
    settlementId: settlement._id,
    brandId,
    eligibleBefore: periodEnd,
    fundsReceivedBefore,
  });

  const refunds = await claimRefundAdjustments({
    settlementId: settlement._id,
    brandId,
  });

  /**
   * ⚠️ And the lost disputes, on the same rule and in the same order.
   *
   * `vendor_settlement_plan.md` §7.5 chose recovery-from-the-next-cycle as the
   * default for a chargeback that lands after payout. It was never implemented:
   * `chargebackAdjustment` sat hardcoded at `0`, so the platform silently ate
   * every lost dispute and the books showed a healthy sale.
   *
   * Claimed like the refunds — `chargebackSettlementId` is the lock — because a
   * figure computed live from "this brand's lost disputes" would deduct the same
   * one every cycle for ever.
   */
  const chargebacks = await claimChargebackAdjustments({
    settlementId: settlement._id,
    brandId,
  });

  const totals = computeTotals({ transactions, refunds, chargebacks, settings });

  /**
   * Written before the transition, so the status change and the figures it
   * describes are never out of step for a reader.
   */
  await Settlement.updateOne({ _id: settlement._id }, { $set: totals });
  const withTotals = await Settlement.findById(settlement._id).lean();

  /**
   * ⚠️ Nothing to pay is a legitimate outcome, not a failure.
   *
   * A `PAID` settlement writes a `PAYOUT` ledger entry, and booking a payout for
   * money no bank transfer carried makes `reconcileLedger` shout about drift
   * without saying which settlement caused it. So this goes to
   * `CARRIED_FORWARD`, which releases — and the release **is** the carry
   * forward, because eligibility has no `periodStart` floor and both the takings
   * and the unapplied deductions flow into the next cycle by themselves.
   */
  const nothingToPay = totals.netPayable <= 0 || totals.netPayable < minPayout;

  const { settlement: moved } = await transitionSettlement({
    settlement: withTotals,
    to: nothingToPay
      ? SETTLEMENT_STATUS.CARRIED_FORWARD
      : SETTLEMENT_STATUS.PENDING_APPROVAL,
    reason: nothingToPay
      ? totals.netPayable <= 0
        ? `Nothing payable this period (net ₹${totals.netPayable.toFixed(2)}); carried forward`
        : `Below the ₹${minPayout} minimum; carried forward`
      : undefined,
  });

  return { settlement: moved, status: moved.status };
};

/**
 * The arithmetic, over exactly the rows this settlement captured.
 *
 * Never a fresh query: a live total would move under a refund landing mid-build
 * and the figures would not add up to the rows they claim to describe.
 */
const computeTotals = ({ transactions, refunds, chargebacks = [], settings }) => {
  let grossCollected = 0;
  let vendorPromoCost = 0;
  let commissionAmount = 0;

  for (const txn of transactions) {
    const voucher = txn.voucher || {};
    /**
     * `netBill`, not `amount`. The customer paid `amount`, which includes our
     * convenience fee and is net of a promo we may have funded — none of that is
     * the vendor's. `netBill` is what they supplied.
     */
    grossCollected += Number(voucher.netBill) || 0;
    vendorPromoCost += Number(voucher.vendorPromoCost) || 0;
    commissionAmount += Number(voucher.commissionAmount) || 0;
  }

  /**
   * Refunds from **earlier** cycles, claimed the same way the transactions are.
   *
   * `vendorClawback` rather than `totalRefund`: what the customer got back
   * includes our convenience fee and our share of a promo, and neither comes out
   * of the vendor.
   */
  const refundAdjustment = refunds.reduce(
    (sum, r) => sum + (Number(r.split?.vendorClawback) || 0),
    0,
  );

  /**
   * What the bank took back on disputes we lost, capped at the vendor's share.
   *
   * The same shape as `refundAdjustment` above: only the vendor's slice, and
   * only for payments they were actually paid for — `claimChargebackAdjustments`
   * enforces the second half.
   */
  const chargebackAdjustment = chargebacks.reduce((sum, txn) => {
    const voucher = txn.voucher || {};
    const vendorShare =
      (Number(voucher.netBill) || 0) -
      (Number(voucher.vendorPromoCost) || 0) -
      (Number(voucher.commissionAmount) || 0);
    return sum + Math.max(0, round2(vendorShare));
  }, 0);

  const reservePercent = settings.reserve?.isEnabled
    ? Number(settings.reserve.percent) || 0
    : 0;

  const beforeReserve = round2(
    grossCollected -
      vendorPromoCost -
      commissionAmount -
      refundAdjustment -
      chargebackAdjustment,
  );
  // A reserve is only ever held back from money that exists.
  const reserveHeld = round2(Math.max(0, beforeReserve) * (reservePercent / 100));

  return {
    grossCollected: round2(grossCollected),
    vendorPromoCost: round2(vendorPromoCost),
    commissionAmount: round2(commissionAmount),
    commissionTax: 0,
    refundAdjustment: round2(refundAdjustment),
    chargebackAdjustment: round2(chargebackAdjustment),
    reserveHeld,
    reserveReleased: 0,
    netPayable: round2(beforeReserve - reserveHeld),
    transactionCount: transactions.length,
  };
};

/**
 * The bank account as it stands right now, copied onto the settlement.
 *
 * ⚠️ Frozen rather than joined at payout time. `createBank.js` soft-deletes the
 * old record and repoints `brand.BankId` when a vendor changes their account, so
 * a settlement built on Monday and paid on Thursday would otherwise follow the
 * pointer to whatever is there on Thursday — quietly redirecting a payout an
 * admin already approved. NEFT has no recall.
 *
 * Returns `undefined` when there is no verified account: the settlement is still
 * built (the money is still owed) and the payout step is what refuses to run.
 */
const freezeBankSnapshot = async (brandId) => {
  const brand = await Brand.findById(brandId).select("BankId").lean();
  if (!brand?.BankId) return undefined;

  const bank = await Bank.findOne({ _id: brand.BankId, isDeleted: false }).lean();
  /**
   * ⚠️ `isVerified`, not just "a record exists".
   *
   * `models/Bank.js` is a **CGPEY penny-drop verification record**, and a row can
   * exist for an account the drop failed on. Paying to an unverified account is
   * the one payout mistake with no recall.
   */
  if (!bank?.isVerified) return undefined;

  return {
    accountHolderName: bank.accountHolderName,
    maskedAccountNumber: bank.maskedAccountNumber,
    accountLast4Digits: bank.accountLast4Digits,
    ifscCode: bank.ifscCode,
    bankName: bank.bankName,
    bankId: bank._id,
    verifiedAt: bank.verifiedAt || bank.updatedAt,
  };
};

exports.computeTotals = computeTotals;
exports.freezeBankSnapshot = freezeBankSnapshot;
