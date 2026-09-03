const mongoose = require("mongoose");
const LedgerEntry = require("../../models/LedgerEntry");
const {
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} = require("../../constants/ledger");
const { round2 } = require("../subscribeds/calculatePricing");

/**
 * What a brand still has coming.
 *
 * One index scan over their `VENDOR_PAYABLE` rows — no status filter, no date
 * window, no clause anyone can forget to add when a new case appears. That is
 * the reason the ledger exists at all: the alternative is an aggregation over
 * `transactions` that grows a clause per edge case until nobody can tell an
 * oversight from a deliberate exclusion.
 *
 * @param {object|string} brandId
 * @param {object} [options]
 * @param {Date}   [options.upTo]  balance as it stood at a moment, for a statement
 * @returns {Promise<{ balance, credited, debited, entryCount }>}
 */
exports.getVendorBalance = async (brandId, { upTo } = {}) => {
  const match = {
    brandId: new mongoose.Types.ObjectId(String(brandId)),
    account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
  };
  // A statement is "as at" a date, and re-reading today's balance for last
  // month's statement would restate a document already sent to a vendor.
  if (upTo) match.occurredAt = { $lte: upTo };

  const [row] = await LedgerEntry.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        credited: {
          $sum: {
            $cond: [
              { $eq: ["$direction", LEDGER_DIRECTION.CREDIT] },
              "$amount",
              0,
            ],
          },
        },
        debited: {
          $sum: {
            $cond: [
              { $eq: ["$direction", LEDGER_DIRECTION.DEBIT] },
              "$amount",
              0,
            ],
          },
        },
        entryCount: { $sum: 1 },
      },
    },
  ]);

  const credited = round2(row?.credited || 0);
  const debited = round2(row?.debited || 0);

  return {
    balance: round2(credited - debited),
    credited,
    debited,
    entryCount: row?.entryCount || 0,
  };
};

/**
 * The same figure for many brands at once.
 *
 * The settlement job needs every eligible brand's balance in one pass; asking
 * per brand would be one round trip each, and on a settlement day that is the
 * difference between a job that finishes and a job that times out.
 */
exports.getVendorBalances = async (brandIds = [], { upTo } = {}) => {
  if (!brandIds.length) return new Map();

  const match = {
    brandId: { $in: brandIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
    account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
  };
  if (upTo) match.occurredAt = { $lte: upTo };

  const rows = await LedgerEntry.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$brandId",
        credited: {
          $sum: {
            $cond: [{ $eq: ["$direction", LEDGER_DIRECTION.CREDIT] }, "$amount", 0],
          },
        },
        debited: {
          $sum: {
            $cond: [{ $eq: ["$direction", LEDGER_DIRECTION.DEBIT] }, "$amount", 0],
          },
        },
        entryCount: { $sum: 1 },
      },
    },
  ]);

  return new Map(
    rows.map((r) => [
      String(r._id),
      {
        balance: round2(r.credited - r.debited),
        credited: round2(r.credited),
        debited: round2(r.debited),
        entryCount: r.entryCount,
      },
    ]),
  );
};

/**
 * The platform's own books, for the admin dashboard.
 *
 * Not scoped to a brand — `PLATFORM_REVENUE`, `PLATFORM_COST` and `TAX_PAYABLE`
 * are the platform's, and summing them per-brand would be meaningless.
 */
exports.getPlatformTotals = async ({ from, to } = {}) => {
  const match = {
    account: {
      $in: [
        LEDGER_ACCOUNT.PLATFORM_REVENUE,
        LEDGER_ACCOUNT.PLATFORM_COST,
        LEDGER_ACCOUNT.TAX_PAYABLE,
      ],
    },
  };
  if (from || to) {
    match.occurredAt = {
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: to } : {}),
    };
  }

  const rows = await LedgerEntry.aggregate([
    { $match: match },
    {
      $group: {
        _id: { account: "$account", entryType: "$entryType" },
        credited: {
          $sum: {
            $cond: [{ $eq: ["$direction", LEDGER_DIRECTION.CREDIT] }, "$amount", 0],
          },
        },
        debited: {
          $sum: {
            $cond: [{ $eq: ["$direction", LEDGER_DIRECTION.DEBIT] }, "$amount", 0],
          },
        },
      },
    },
  ]);

  /**
   * Every account is reported in its **own natural sign**.
   *
   * `PLATFORM_COST` is debit-normal: money spent arrives as a DEBIT, so
   * `credited − debited` would make it negative and a line labelled "cost" would
   * read as −52.94. Worse, subtracting that from revenue *adds* it, and a claim
   * that lost the platform ₹42.94 reports a ₹62.94 profit. That is not a
   * rounding error, it is a sign error with the right shape — the kind a ledger
   * exists to make impossible.
   *
   * So a cost is reported as a positive magnitude, and `net` subtracts it.
   */
  const isDebitNormal = (account) => account === LEDGER_ACCOUNT.PLATFORM_COST;

  const byAccount = {};
  const byType = {};
  for (const r of rows) {
    const net = isDebitNormal(r._id.account)
      ? round2(r.debited - r.credited)
      : round2(r.credited - r.debited);
    byAccount[r._id.account] = round2((byAccount[r._id.account] || 0) + net);
    byType[r._id.entryType] = round2((byType[r._id.entryType] || 0) + net);
  }

  const revenue = byAccount[LEDGER_ACCOUNT.PLATFORM_REVENUE] || 0;
  const cost = byAccount[LEDGER_ACCOUNT.PLATFORM_COST] || 0;

  return {
    byAccount,
    byType,
    revenue,
    // Positive = money spent.
    cost,
    /**
     * What the platform actually kept. Negative is a real answer.
     *
     * On the plan's worked example this is **−42.94**: ₹10 of convenience fee
     * against ₹35 of promo cost and ₹17.94 of gateway fee. The campaign spend is
     * deliberate; the gateway fee is the part that used to be invisible.
     */
    net: round2(revenue - cost),
  };
};
