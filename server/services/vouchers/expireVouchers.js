const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const {
  VOUCHER_STATUSES,
  VOUCHER_IN_PLAY_STATUSES,
} = require("../../constants/voucher");
const { ENTITLEMENT_BUCKETS } = require("../../constants/subscription");
const { recountBrandUsage } = require("../../helpers/brands");

/**
 * Retire vouchers whose validity window has closed.
 *
 * Runs hourly from `jobs/index.js`. It expires the versions whose time is up,
 * then the masters those versions leave with nothing in play, then reconciles
 * the affected brands' voucher counters — voucher usage is the one metered pool
 * that changes with no API call behind it.
 *
 * ### 🔴 The master sweep never ran (V-5)
 *
 * It used to select masters by `{ status: {...}, endAt: { $lte: now } }` — and
 * **`Voucher` has no `endAt` field**. Not stale, not rare: no voucher has ever
 * carried one, so that filter returned nothing on every run since it was
 * written. Verified on stage: 0 of 18 vouchers have the field.
 *
 * Two things followed. Masters stayed at their pre-expiry status for ever, and
 * because the brand list was built from those same rows, `recountBrandUsage`
 * **was never called from here at all** — so an expired voucher never released
 * its plan slot, which is the one thing this function's own comment promised it
 * did. A vendor on a 10-voucher plan stayed at 10 for ever.
 *
 * ### Why the master is derived, not given its own `endAt`
 *
 * The obvious repair is to mirror the published version's `endAt` onto the
 * master. That makes one date true in two places, and the master's live version
 * changes on every publish — so the copy has to be re-written by publish, by
 * pause, by resume and by every fork, and is wrong in between. This codebase has
 * removed that shape twice already (`banner.type` against `media.kind`, four
 * copies of the image-floor message).
 *
 * The versions already hold the dates. This asks them.
 */
exports.expireVouchers = async () => {
  const now = new Date();

  /**
   * `ARCHIVED` and `PAUSED` are swept alongside `PUBLISHED`.
   *
   * ⚠️ An archived version is one a newer publish replaced — it left
   * circulation early, but its own validity window is still running. When
   * `endAt` finally passes it has genuinely expired, and this is the sweep that
   * says so. Without `ARCHIVED` here every superseded version would sit archived
   * for ever, and "how many vouchers expired this month" would count only the
   * ones that were never replaced.
   *
   * 🔴 `PAUSED` is here for the same reason, and it is new (V-5). A paused
   * voucher whose validity runs out is over — the vendor did not stop time by
   * pausing it. Left out, every paused version would outlive its own `endAt`
   * and hold its brand's slot for ever: exactly the trap `ARCHIVED` was added
   * to close, on a status that until now could not occur.
   */
  const dueVersions = await VoucherVersion.find({
    status: {
      $in: [
        VOUCHER_STATUSES.PUBLISHED,
        VOUCHER_STATUSES.ARCHIVED,
        VOUCHER_STATUSES.PAUSED,
      ],
    },
    endAt: { $lte: now },
    isDeleted: false,
  })
    .select("_id voucherId")
    .lean();

  const versionResult = await VoucherVersion.updateMany(
    { _id: { $in: dueVersions.map((doc) => doc._id) } },
    {
      $set: {
        status: VOUCHER_STATUSES.EXPIRED,
        expiredAt: now,
        isActive: false,
      },
    },
  );

  /**
   * ⚠️ A master expires only when **nothing of it is left in play**.
   *
   * A voucher whose live version just ran out but which has a draft or a
   * version in review is not finished — the vendor is in the middle of its next
   * one. Expiring the master there would retire a voucher from behind and,
   * because the same statuses drive the plan limit, hand back a slot the vendor
   * is still using. So the survivors are counted first, and only the masters
   * with no survivor are retired.
   */
  const touchedVoucherIds = [
    ...new Map(
      dueVersions
        .filter((doc) => doc.voucherId)
        .map((doc) => [String(doc.voucherId), doc.voucherId]),
    ).values(),
  ];

  let dueVouchers = [];
  if (touchedVoucherIds.length) {
    const stillInPlay = await VoucherVersion.distinct("voucherId", {
      voucherId: { $in: touchedVoucherIds },
      status: { $in: VOUCHER_IN_PLAY_STATUSES },
      isDeleted: false,
    });
    const survivors = new Set(stillInPlay.map((id) => String(id)));

    dueVouchers = await Voucher.find({
      _id: {
        $in: touchedVoucherIds.filter((id) => !survivors.has(String(id))),
      },
      status: { $ne: VOUCHER_STATUSES.EXPIRED },
      isDeleted: false,
    })
      .select("_id brandId")
      .lean();
  }

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
