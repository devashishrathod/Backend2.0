const mongoose = require("mongoose");
const Transaction = require("../../models/Transaction");
const Dispute = require("../../models/Dispute");
const { buildTransactionFilter } = require("../transactions");
const { DISPUTE_STATUS } = require("../../constants/webhook");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const { PAYMENT_STATUS } = require("../../constants");

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Why a brand is holding what it is holding.
 *
 * Stored on the settlement, so a statement read months later can answer *"why
 * was 15% withheld from me in March?"* — see `Settlement.reserveBasis`.
 */
const RESERVE_BASIS = Object.freeze({
  /** The reserve is switched off entirely. */
  DISABLED: "DISABLED",
  /** Nothing against them: the base rate. */
  BASE: "BASE",
  /** Chargebacks over both the count and the rate. */
  RISK_CHARGEBACKS: "RISK_CHARGEBACKS",
  /** Too new to have a record either way — unproven, so held higher. */
  NEW_VENDOR: "NEW_VENDOR",
  /** Enough chargebacks to trigger a look, but too few sales to judge by. */
  TOO_FEW_PAYMENTS: "TOO_FEW_PAYMENTS",
});

/**
 * How much of each brand's payout to hold back this cycle.
 *
 * ### ⚠️ Two queries for the whole run, not two per brand
 *
 * The obvious shape is a helper that takes one `brandId` and asks two questions
 * about it, called from inside the per-brand loop. That is correct and it does
 * not scale: a nightly build over 500 brands becomes 1,000 round trips, growing
 * linearly with the thing that is supposed to grow.
 *
 * So the whole map is built once, before the loop, from **two** aggregations
 * grouped by brand — the same reason `buildSettlements` reads settings once and
 * passes them down rather than fetching per brand.
 *
 * ### Count **and** rate, never count alone
 *
 * `riskChargebackCount` alone punishes size. A brand doing 10,000 sales with 2
 * chargebacks is a better merchant than one doing 40 with 2, and holding more
 * from the first is exactly backwards. The count is the trigger; the rate is the
 * test. Both must be crossed.
 *
 * And under `riskMinPayments`, neither means anything: one chargeback out of
 * three sales is 33%, and treating that as a signal freezes a new outlet's cash
 * on their unluckiest week. Those brands keep the base rate and say so
 * (`TOO_FEW_PAYMENTS`), rather than silently reading as safe.
 *
 * ### Which disputes count
 *
 * Everything except `WON`. A dispute we won is proof the sale was good, and
 * holding a vendor's money for a case we won is not defensible to them.
 * Everything else is either unresolved — which is precisely what a reserve is
 * for — or lost, which cost real money.
 *
 * @param {object} args
 * @param {Array} args.brandIds  brands in this run
 * @param {object} args.settings `getCustomerConfig().settlement`
 * @returns {Promise<Map<string, object>>} brandId → {percent, basis, …}
 */
exports.buildReserveRiskMap = async ({ brandIds = [], settings = {} } = {}) => {
  const reserve = settings.reserve || {};
  const map = new Map();

  const basePercent = Number(reserve.percent) || 0;
  const maxPercent = Number.isFinite(Number(reserve.maxPercent))
    ? Number(reserve.maxPercent)
    : 100;

  /** Nothing is held at all, so nothing needs measuring. */
  if (!reserve.isEnabled || !brandIds.length) {
    for (const brandId of brandIds) {
      map.set(String(brandId), {
        percent: 0,
        basis: RESERVE_BASIS.DISABLED,
        disputeCount: 0,
        paymentCount: 0,
        disputeRatePercent: 0,
        lookbackDays: 0,
      });
    }
    return map;
  }

  const lookbackDays = Number(reserve.riskLookbackDays) || 180;
  const since = new Date(Date.now() - lookbackDays * 86400000);
  const ids = brandIds.map((id) =>
    id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id),
  );

  const [payments, disputes] = await Promise.all([
    /**
     * The denominator: captured payments in the window. ⚠️ Captured, not
     * *settled* — a dispute is drawn from the population of sales that happened,
     * and using settled payments would shrink the denominator by exactly the
     * held-back ones, inflating the rate for the brands already under suspicion.
     */
    Transaction.aggregate([
      {
        $match: {
          ...buildTransactionFilter({
            purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
          }),
          brandId: { $in: ids },
          status: PAYMENT_STATUS.CAPTURED,
          verifiedAt: { $gte: since },
          isDeleted: false,
        },
      },
      { $group: { _id: "$brandId", count: { $sum: 1 } } },
    ]),
    Dispute.aggregate([
      {
        $match: {
          brandId: { $in: ids },
          status: { $ne: DISPUTE_STATUS.WON },
          /**
           * ⚠️ `openedAt` with `createdAt` behind it. A dispute that arrived
           * already resolved — Razorpay does send those — carries no `openedAt`,
           * and `{openedAt: {$gte: since}}` would drop it from the count
           * entirely: the worst cases would be the ones that never registered.
           */
          $or: [
            { openedAt: { $gte: since } },
            { openedAt: null, createdAt: { $gte: since } },
          ],
          isDeleted: false,
        },
      },
      { $group: { _id: "$brandId", count: { $sum: 1 } } },
    ]),
  ]);

  const paymentsBy = new Map(payments.map((r) => [String(r._id), r.count]));
  const disputesBy = new Map(disputes.map((r) => [String(r._id), r.count]));

  /**
   * A brand with no history at all is unproven, not safe — the reading an
   * acquirer takes of a new merchant. Only asked when `newVendorReserveDays` is
   * set, so the extra query costs nothing while the feature is off.
   */
  const newVendorDays = Number(settings.newVendorReserveDays) || 0;
  const firstPaymentBy = new Map();
  if (newVendorDays > 0) {
    const firsts = await Transaction.aggregate([
      {
        $match: {
          ...buildTransactionFilter({
            purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
          }),
          brandId: { $in: ids },
          status: PAYMENT_STATUS.CAPTURED,
          isDeleted: false,
        },
      },
      { $group: { _id: "$brandId", firstAt: { $min: "$verifiedAt" } } },
    ]);
    for (const row of firsts) firstPaymentBy.set(String(row._id), row.firstAt);
  }

  const minCount = Number(reserve.riskChargebackCount) || 1;
  const minPayments = Number(reserve.riskMinPayments) || 1;
  const rateThreshold = Number(reserve.riskDisputeRatePercent) || 0;
  const riskPercent = Number(reserve.riskPercent) || basePercent;
  const newVendorCutoff = new Date(Date.now() - newVendorDays * 86400000);

  for (const brandId of brandIds) {
    const key = String(brandId);
    const paymentCount = paymentsBy.get(key) || 0;
    const disputeCount = disputesBy.get(key) || 0;
    const disputeRatePercent = paymentCount
      ? round2((disputeCount / paymentCount) * 100)
      : 0;

    let percent = basePercent;
    let basis = RESERVE_BASIS.BASE;

    if (disputeCount >= minCount) {
      if (paymentCount < minPayments) {
        /**
         * ⚠️ Named rather than folded into `BASE`. "We saw the chargebacks and
         * had too little to judge by" and "there is nothing against them" are
         * different answers, and the first is the one somebody wants back when
         * the brand's volume grows.
         */
        basis = RESERVE_BASIS.TOO_FEW_PAYMENTS;
      } else if (disputeRatePercent >= rateThreshold) {
        percent = riskPercent;
        basis = RESERVE_BASIS.RISK_CHARGEBACKS;
      }
    }

    if (newVendorDays > 0 && basis !== RESERVE_BASIS.RISK_CHARGEBACKS) {
      const firstAt = firstPaymentBy.get(key);
      // No payment at all is as unproven as it gets.
      if (!firstAt || new Date(firstAt) > newVendorCutoff) {
        percent = Math.max(percent, riskPercent);
        basis = RESERVE_BASIS.NEW_VENDOR;
      }
    }

    map.set(key, {
      // ⚠️ The ceiling applies to whatever route got us here, including the base
      // rate — a misconfigured `percent: 90` must not empty a payout either.
      percent: Math.min(round2(percent), maxPercent),
      basis,
      disputeCount,
      paymentCount,
      disputeRatePercent,
      lookbackDays,
    });
  }

  return map;
};

exports.RESERVE_BASIS = RESERVE_BASIS;
