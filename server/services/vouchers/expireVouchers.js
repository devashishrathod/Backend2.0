const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const { VOUCHER_STATUSES } = require("../../constants/voucher");
const { ENTITLEMENT_BUCKETS } = require("../../constants/subscription");
const { recountBrandUsage } = require("../../helpers/brands");

/**
 * Retire vouchers whose validity window has closed.
 *
 * Two things this now does that it did not before:
 *
 *  1. **Expires the master `Voucher` too**, not just the `VoucherVersion`. The
 *     master's status was left at PUBLISHED forever, which mattered little
 *     while nothing read it — but it is now what the plan's voucher limit is
 *     counted from, so a stale master would hold a slot for good.
 *  2. **Recounts the affected brands' voucher usage.** Voucher usage is the one
 *     metered pool that changes with no API call behind it, so the cached
 *     counter on Brand has to be reconciled whenever this sweep frees slots.
 */
exports.expireVouchers = async () => {
  const now = new Date();

  // Which brands are about to be affected — captured before the update, since
  // afterwards the rows no longer match the filter.
  const dueVouchers = await Voucher.find({
    status: {
      $in: [
        VOUCHER_STATUSES.PUBLISHED,
        VOUCHER_STATUSES.APPROVED,
        VOUCHER_STATUSES.PAUSED,
      ],
    },
    endAt: { $lte: now },
    isDeleted: false,
  })
    .select("_id brandId")
    .lean();

  /**
   * `ARCHIVED` is swept alongside `PUBLISHED`.
   *
   * ⚠️ An archived version is one a newer publish replaced — it left circulation
   * early, but its own validity window is still running. When `endAt` finally
   * passes it has genuinely expired, and this is the sweep that says so. Without
   * `ARCHIVED` in this filter every superseded version would sit archived for
   * ever, and "how many vouchers expired this month" would count only the ones
   * that were never replaced.
   */
  const versionResult = await VoucherVersion.updateMany(
    {
      status: {
        $in: [VOUCHER_STATUSES.PUBLISHED, VOUCHER_STATUSES.ARCHIVED],
      },
      endAt: { $lte: now },
      isDeleted: false,
    },
    {
      $set: {
        status: VOUCHER_STATUSES.EXPIRED,
        expiredAt: now,
        isActive: false,
      },
    },
  );

  let masterResult = { matchedCount: 0, modifiedCount: 0 };
  if (dueVouchers.length) {
    masterResult = await Voucher.updateMany(
      { _id: { $in: dueVouchers.map((doc) => doc._id) } },
      { $set: { status: VOUCHER_STATUSES.EXPIRED, isActive: false } },
    );
  }

  // Expiring a voucher releases its slot, so the counters must catch up.
  const brandIds = [
    ...new Set(dueVouchers.map((doc) => String(doc.brandId)).filter(Boolean)),
  ];
  let brandsRecounted = 0;
  for (const brandId of brandIds) {
    try {
      await recountBrandUsage(brandId, [ENTITLEMENT_BUCKETS.VOUCHERS]);
      brandsRecounted += 1;
    } catch (error) {
      // One bad brand must not abort the sweep for the rest.
      console.error(
        `[expireVouchers] failed to recount brand ${brandId}:`,
        error?.message,
      );
    }
  }

  return {
    matched: versionResult.matchedCount || 0,
    modified: versionResult.modifiedCount || 0,
    mastersExpired: masterResult.modifiedCount || 0,
    brandsRecounted,
  };
};
