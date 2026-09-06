const mongoose = require("mongoose");
const Settlement = require("../../models/Settlement");
const Transaction = require("../../models/Transaction");
const Brand = require("../../models/Brand");
const Bank = require("../../models/Bank");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const {
  DOCUMENT_KIND,
  DOCUMENT_SERIES,
} = require("../../constants/document");
const { PAYMENT_STATUS } = require("../../constants");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const { DUPLICATE_KEY } = require("../../constants/mongo");
const { getCustomerConfig } = require("../../helpers/settings");
const { buildTransactionFilter } = require("../../helpers/transactions");
const { generateDocumentNumber } = require("../../helpers/documents");
const {
  settlementPeriodStart,
  settlementPeriodEnd,
} = require("../../helpers/dates");
const {
  buildEligibilityFilter,
  claimTransactions,
  claimRefundAdjustments,
  claimChargebackAdjustments,
  claimMaturedReserves,
  brandsWithMaturedReserves,
  transitionSettlement,
  buildReserveRiskMap,
} = require("../../helpers/settlements");
const {
  notifyVendorSettlementCarriedForward,
} = require("../../helpers/notifications");

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

  /**
   * Brands with money to settle — from sales, **or** from a reserve that has
   * matured.
   *
   * ⚠️ The second source is not a nicety. `brandsWithEligibleMoney` is a
   * `distinct` over eligible **transactions**, so a brand that stops trading is
   * never even considered — and a reserve taken from them months ago would sit
   * there for ever, with nothing anywhere to say so. Their money does not stop
   * being theirs because they stopped selling.
   */
  const holdDays = Number(settings.reserve?.holdDays) || 0;
  const reserveMaturedBefore = holdDays
    ? new Date(at.getTime() - holdDays * 24 * HOUR_MS)
    : null;

  const [tradingBrands, reserveBrands] = await Promise.all([
    brandsWithEligibleMoney({ periodEnd, fundsReceivedBefore }),
    reserveMaturedBefore
      ? brandsWithMaturedReserves({ maturedBefore: reserveMaturedBefore })
      : [],
  ]);

  // De-duplicated by string, because two ObjectIds for the same brand are not
  // `===` and a Set of the raw values would build that brand twice.
  const brandIds = [
    ...new Map(
      [...tradingBrands, ...reserveBrands].map((id) => [String(id), id]),
    ).values(),
  ];

  /**
   * How much of each brand's payout to hold back, decided **once for the run**.
   *
   * ⚠️ Not inside the loop. The obvious shape — a helper taking one `brandId`,
   * called per brand — is two extra round trips multiplied by however many
   * brands the night has, which is exactly the number that grows. Two
   * aggregations grouped by brand answer it for all of them.
   *
   * ⚠️ And it is passed **down** rather than fetched again, for the same reason
   * `settings` is: a rate that moved between the reserve calculation and the row
   * that records it would produce a settlement whose own arithmetic did not add
   * up.
   */
  const reserveRisk = await buildReserveRiskMap({ brandIds, settings });

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
        reserveMaturedBefore,
        minPayout,
        settings,
        // ⚠️ Handed in, not looked up — see `buildReserveRiskMap` above.
        risk: reserveRisk.get(String(brandId)),
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
  /**
   * When a reserve stops being held — `null` while the reserve is switched off.
   *
   * ⚠️ Passed in rather than worked out here. This function is declared at module
   * level, so it does **not** close over `buildSettlements`'s locals: reaching
   * for `at` would be a `ReferenceError` on the first brand with a matured
   * reserve, and `node --check` does not catch a free identifier. It is also a
   * run-level decision, like `fundsReceivedBefore` beside it — every brand in one
   * run must be measured against the same instant.
   */
  reserveMaturedBefore,
  minPayout,
  settings,
  /**
   * This brand's reserve rate and the reasoning behind it, from
   * `buildReserveRiskMap` — decided once for the whole run.
   *
   * ⚠️ Passed in for the same two reasons `reserveMaturedBefore` is: this
   * function does not close over the caller's locals, and every brand in one run
   * must be measured against the same instant. A rate re-derived here would also
   * cost two round trips per brand.
   */
  risk,
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
       * `TD/STL/26-27/000123` — the reference a vendor quotes when they query a
       * payout, and the one the admin's `settlementNumber` search matches on.
       *
       * The series is `DOCUMENT_SERIES[PAYOUT_STATEMENT]`, which is the same
       * `"STL"` the payout statement itself prints, so a settlement and the
       * document describing it carry one number rather than two.
       *
       * Allotted here rather than in a pre-save hook because `Settlement.create`
       * can legitimately fail on the idempotency key, and a hook would burn a
       * number from a GST-facing sequence on every duplicate build attempt.
       */
      settlementNumber: await generateDocumentNumber({
        series: DOCUMENT_SERIES[DOCUMENT_KIND.PAYOUT_STATEMENT],
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
   * Claimed like the refunds — `Dispute.recoverySettlementId` is the lock —
   * because a figure computed live from "this brand's lost disputes" would
   * deduct the same one every cycle for ever.
   *
   * ⚠️ The lock is on the **dispute**, not the payment. It used to be
   * `Transaction.chargebackSettlementId`, one per payment, while the ledger keyed
   * on the dispute — so a payment carrying two lost disputes booked two losses
   * and recovered one, and the second was silently forgiven.
   */
  const chargebacks = await claimChargebackAdjustments({
    settlementId: settlement._id,
    brandId,
  });

  /**
   * ⚠️ And the reserves whose hold period has run out — the only thing here that
   * **adds** to the payout rather than taking from it.
   *
   * `reserveHeld` was fully wired: computed, subtracted from `netPayable`, and
   * booked to the ledger. `reserveReleased` was a hardcoded `0`,
   * `RESERVE_RELEASE` was a ledger type nothing wrote, and there was no job. So
   * with `reserve.isEnabled: true` the money went in and **never came out** —
   * the same shape `chargebackAdjustment` and `commissionTax` both had.
   *
   * Claimed with a lock for the same reason as the others: a live "what has
   * matured" query would hand the same reserve back every single cycle.
   */
  const reserves = reserveMaturedBefore
    ? await claimMaturedReserves({
        settlementId: settlement._id,
        brandId,
        maturedBefore: reserveMaturedBefore,
      })
    : [];

  const totals = computeTotals({
    transactions,
    refunds,
    chargebacks,
    reserves,
    settings,
    risk,
  });

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

  /**
   * ⚠️ `settlement.requiresAdminApproval` — until now read by **nothing**.
   *
   * It defaults to `true`, is settable from the admin panel, and its own comment
   * in `constants/customer.js` says *"turning this off auto-approves"*. Nothing
   * anywhere consulted it, so an admin who switched it off to stop payouts
   * queuing behind a person got no auto-approval and no error either: every
   * settlement carried on waiting for a click, and the switch that was meant to
   * fix that did nothing at all. The seventh field in this flow wired at both
   * ends and connected in the middle to nothing.
   *
   * ### Approving is not paying
   *
   * `PATCH /settlements/admin/:id/pay` is still a deliberate human action, and
   * `paySettlement` re-checks `needsRevalidation` at that moment — its own note
   * says approval checking the flag *"is not enough"*, because hours pass in
   * that window and a dispute can land inside it. So this removes a queue, not
   * a guard.
   *
   * ⚠️ `!== false`, not `Boolean(...)`. An unset value must mean **on**: a
   * settings document written before this field existed would otherwise
   * auto-approve every payout on the platform, silently, on the next deploy.
   */
  const autoApprove = !nothingToPay && settings.requiresAdminApproval === false;

  let to = SETTLEMENT_STATUS.PENDING_APPROVAL;
  if (nothingToPay) to = SETTLEMENT_STATUS.CARRIED_FORWARD;
  else if (autoApprove) to = SETTLEMENT_STATUS.APPROVED;

  let reason;
  if (nothingToPay) {
    reason =
      totals.netPayable <= 0
        ? `Nothing payable this period (net ₹${totals.netPayable.toFixed(2)}); carried forward`
        : `Below the ₹${minPayout} minimum; carried forward`;
  } else if (autoApprove) {
    /**
     * ⚠️ Spelled out on the history row, because the audit trail must not read
     * as though a person signed this off. `approvedBy` stays unset for the same
     * reason — see the `$set` below.
     */
    reason =
      "Auto-approved: admin approval is switched off in settings " +
      "(settlement.requiresAdminApproval). No person reviewed this settlement.";
  }

  const { settlement: moved } = await transitionSettlement({
    settlement: withTotals,
    to,
    reason,
    /**
     * ⚠️ `approvedAt` but **never** `approvedBy`.
     *
     * `approvedAt` is what the vendor's statement and every "how long has this
     * been sitting?" query read, so leaving it unset would make an auto-approved
     * settlement look stuck for ever to `alertLateSettlements`. `approvedBy`
     * naming a user would be a lie in the one record somebody reaches for when
     * they ask who authorised a payout.
     */
    ...(autoApprove ? { set: { approvedAt: new Date() } } : {}),
  });

  /**
   * ⚠️ Tell the vendor — but only when the deductions are the reason.
   *
   * Two very different outcomes share `CARRIED_FORWARD`, and conflating them is
   * how a real message gets ignored. *"Below the ₹500 minimum"* is routine and
   * stays silent. *"Your refunds and chargebacks came to more than this period's
   * sales"* is a payout that is not arriving, and it was silent too — from the
   * outlet's side indistinguishable from one that quietly failed. The first
   * anybody heard was a support call, usually weeks later.
   *
   * Sent after the transition so the notice and the settlement it describes can
   * never disagree, and `dedupeKey` keys on the settlement so a re-run sends one
   * message rather than one per attempt.
   */
  const deductions = round2(
    (totals.refundAdjustment || 0) + (totals.chargebackAdjustment || 0),
  );
  if (nothingToPay && totals.netPayable <= 0 && deductions > 0) {
    await notifyVendorSettlementCarriedForward({
      settlement: { ...withTotals, status: moved.status },
      refundAdjustment: totals.refundAdjustment || 0,
      chargebackAdjustment: totals.chargebackAdjustment || 0,
    });
  }

  return { settlement: moved, status: moved.status };
};

/**
 * The arithmetic, over exactly the rows this settlement captured.
 *
 * Never a fresh query: a live total would move under a refund landing mid-build
 * and the figures would not add up to the rows they claim to describe.
 */
const computeTotals = ({
  transactions,
  refunds,
  chargebacks = [],
  reserves = [],
  settings,
  risk,
}) => {
  let grossCollected = 0;
  let vendorPromoCost = 0;
  let commissionAmount = 0;
  let commissionTax = 0;
  let commissionDeduction = 0;

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
    commissionTax += Number(voucher.commissionTax) || 0;
    /**
     * ⚠️ The deduction, not the commission — they differ whenever GST sits on
     * top, and it is the deduction the vendor actually loses.
     *
     * Falls back to `commissionAmount` for a claim frozen before the field
     * existed; there GST was off, so the two were equal anyway.
     */
    commissionDeduction +=
      Number(voucher.commissionDeduction ?? voucher.commissionAmount) || 0;
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
  /**
   * ⚠️ Exactly what the ledger booked for each dispute, not recomputed here.
   *
   * This used to work the vendor's share out again from `voucher`, which is
   * wrong the moment a payment carries two disputes: `postChargebackLoss` caps
   * each loss against what that payment has already given up, so the second one
   * can only take the headroom left. Recomputing ignored that cap and would
   * charge the vendor the full share twice — the books would say we recovered
   * money that was never lost.
   *
   * `claimChargebackAdjustments` reads the figure off the ledger, net of any
   * reversal, and hands it over as `recoverAmount`.
   */
  const chargebackAdjustment = chargebacks.reduce(
    (sum, dispute) => sum + Math.max(0, Number(dispute.recoverAmount) || 0),
    0,
  );

  /**
   * ⚠️ **This brand's** rate, not the one flat number.
   *
   * `settings.reserve.percent` is the base; `buildReserveRiskMap` decides whether
   * this brand pays it or the raised one, from their own chargeback record over a
   * trailing window. `riskChargebackCount` had sat in the constants, in the
   * `Setting` schema and in `getCustomerConfig` — configurable from the admin
   * panel — while **no code anywhere read it**.
   *
   * The fallback keeps a caller that passes no `risk` (a test, a resume path) on
   * exactly the old behaviour rather than silently holding nothing.
   */
  const reservePercent = settings.reserve?.isEnabled
    ? Number(risk?.percent ?? settings.reserve.percent) || 0
    : 0;

  /**
   * ⚠️ `commissionDeduction`, not `commissionAmount`.
   *
   * With GST **inclusive** the two are equal and nothing changes. With GST on
   * **top** the vendor owes the tax as well, and subtracting only the bare
   * commission would leave the platform paying the vendor's GST out of its own
   * margin on every single sale — and the settlement would still look internally
   * consistent, because every figure in it would be individually correct.
   */
  const beforeReserve = round2(
    grossCollected -
      vendorPromoCost -
      commissionDeduction -
      refundAdjustment -
      chargebackAdjustment,
  );
  // A reserve is only ever held back from money that exists.
  const reserveHeld = round2(Math.max(0, beforeReserve) * (reservePercent / 100));

  /**
   * Reserves from earlier settlements whose hold has run out.
   *
   * ⚠️ Added **after** the new hold is worked out, deliberately. Folding it into
   * `beforeReserve` would take a fresh percentage off money that has already
   * served its hold — a reserve on a reserve — and at a 5% rate a vendor's money
   * would shrink a little every cycle it passed through, for ever.
   */
  const reserveReleased = reserves.reduce(
    (sum, settlement) => sum + (Number(settlement.reserveHeld) || 0),
    0,
  );

  return {
    grossCollected: round2(grossCollected),
    vendorPromoCost: round2(vendorPromoCost),
    commissionAmount: round2(commissionAmount),
    /**
     * Summed from the frozen per-claim values, not hardcoded.
     *
     * ⚠️ This was `0`, with the field already on the model and already projected
     * to the vendor — the same shape `chargebackAdjustment: 0` had before it
     * turned out to be a real hole. It is still zero today (rate 0, GST off), but
     * now because the arithmetic says so rather than because nobody wired it.
     */
    commissionTax: round2(commissionTax),
    commissionDeduction: round2(commissionDeduction),
    refundAdjustment: round2(refundAdjustment),
    chargebackAdjustment: round2(chargebackAdjustment),
    reserveHeld,
    /**
     * ⚠️ The rate and the reasoning, frozen onto the row.
     *
     * `reserveHeld` was stored while the rate was not, which was fine only while
     * every brand paid the same one. Now that the rate comes from a **trailing**
     * chargeback window, that window has moved by the time anybody opens the
     * statement — so answering *"why was 15% withheld from me in March?"* by
     * recomputing gives a different number, and the arithmetic on the page stops
     * reproducing.
     *
     * `reserveBasis` carries the working, not just the answer: *"4 chargebacks in
     * 260 sales over 180 days"* is something a vendor can argue with. *"15%"* is
     * not.
     */
    reservePercent: round2(reservePercent),
    reserveBasis: {
      reason: risk?.basis || null,
      disputeCount: risk?.disputeCount || 0,
      paymentCount: risk?.paymentCount || 0,
      disputeRatePercent: risk?.disputeRatePercent || 0,
      lookbackDays: risk?.lookbackDays || 0,
    },
    reserveReleased: round2(reserveReleased),
    netPayable: round2(beforeReserve - reserveHeld + reserveReleased),
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
