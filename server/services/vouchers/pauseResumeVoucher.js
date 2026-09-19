const mongoose = require("mongoose");
const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherApprovalHistory = require("../../models/VoucherApprovalHistory");
const { throwError } = require("../../utils");
const {
  VOUCHER_STATUSES,
  VOUCHER_APPROVAL_ACTION,
} = require("../../constants/voucher");
const { resolveActorBrand } = require("../../helpers/brands");

const MAX_REASON = 1000;

/**
 * Pause and resume — the vendor's own switch on a live voucher (V-5, P7).
 *
 * ### 🔴 `PAUSED` existed and could not be reached
 *
 * The status was in `VOUCHER_STATUSES`, `PAUSED`/`RESUMED` were in
 * `VOUCHER_APPROVAL_ACTION`, `PAUSED` counted against the plan limit, and
 * `updateVoucher` already refused to edit a paused version. Every piece of the
 * feature was in place except the one that assigns it: nothing in the codebase
 * ever wrote `PAUSED` to anything. This is that write.
 *
 * ### What it is for
 *
 * A published voucher is in front of customers, and the only way to take it down
 * was to let it expire or publish something else over it — both irreversible.
 * A vendor who is out of stock for a week needs neither. Pausing takes it out of
 * the feed and puts it back unchanged.
 *
 * ### ⚠️ The customer read needs nothing from this
 *
 * `customerListing` matches `status: "PUBLISHED"` on the version, so a paused
 * version drops out of every feed the moment it is written, and returns on
 * resume. Nothing was added there, and nothing should be: a second filter would
 * be a second answer to "is this live".
 *
 * ### 🔴 Why resume checks before it writes
 *
 * `voucherId_1_status_1` is a partial unique index on
 * `{ status: "PUBLISHED", isDeleted: false }` — one published version per
 * voucher. A vendor can pause v1 and publish v2 while it is down, and then
 * resuming v1 would put a second `PUBLISHED` row on the same voucher. Without
 * the check ahead of it that surfaces as `E11000 … dup key`, which the error
 * handler has no branch for: a 500, naming an index the vendor has never heard
 * of, for something they did on purpose.
 */

/** The load-and-authorise half both directions share. */
const loadForSwitch = async (actor, versionId, session) => {
  if (!actor?.userId) throwError(401, "User authentication is required.");
  if (!versionId || !mongoose.Types.ObjectId.isValid(versionId)) {
    throwError(400, "Invalid voucher version ID.");
  }

  const version = await VoucherVersion.findOne({
    _id: versionId,
    isDeleted: false,
  })
    .session(session)
    .select("_id voucherId versionNumber versionCode status startAt endAt");

  if (!version) throwError(404, "Voucher version not found.");

  const voucher = await Voucher.findOne({
    _id: version.voucherId,
    isDeleted: false,
  })
    .session(session)
    .select("_id brandId voucherCode status publishedVersionId");

  if (!voucher) throwError(404, "Voucher not found.");

  /**
   * ⚠️ Same rule as publish: an admin may act for any brand, a vendor only
   * their own, and ownership is read off `Brand.userId` rather than the token's
   * cached `brandId`. Pausing is taking a voucher off the customer app — doing
   * it to someone else's brand is exactly as bad as publishing over it.
   */
  await resolveActorBrand(actor, voucher.brandId);

  return { version, voucher };
};

/**
 * ⚠️ The master follows only when it is describing this version.
 *
 * `updateVoucher` sets the master back to `DRAFT` the moment a vendor forks a
 * new version, so a voucher can be live on v1 while its master reads `DRAFT`
 * because v2 is being written. Writing `PAUSED` over that would throw away the
 * one thing the master is actually tracking — the work in progress — to record
 * something the version already says. The version is the single source of truth
 * for what customers see; the master only mirrors it while it has nothing else
 * to say.
 */
const masterFollows = (voucherStatus, from) => voucherStatus === from;

const switchVersion = async ({
  actor,
  versionId,
  from,
  to,
  action,
  reason,
  beforeWrite,
}) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const { version, voucher } = await loadForSwitch(actor, versionId, session);

    if (version.status !== from) {
      throwError(
        409,
        action === VOUCHER_APPROVAL_ACTION.PAUSED
          ? `Only a published voucher can be paused — this one is ${version.status}.`
          : `Only a paused voucher can be resumed — this one is ${version.status}.`,
      );
    }

    if (beforeWrite) await beforeWrite({ version, voucher, session });

    const now = new Date();
    const versionUpdate = await VoucherVersion.updateOne(
      {
        _id: version._id,
        voucherId: voucher._id,
        status: from,
        isDeleted: false,
      },
      {
        $set: {
          status: to,
          /**
           * A paused version is not in circulation, and `isActive` is what the
           * rest of the codebase reads to mean exactly that. Resume puts it
           * back — the version is otherwise untouched, which is the whole point
           * of pausing rather than unpublishing.
           */
          isActive: to === VOUCHER_STATUSES.PUBLISHED,
          pausedAt: to === VOUCHER_STATUSES.PAUSED ? now : null,
          pausedBy: to === VOUCHER_STATUSES.PAUSED ? actor.userId : null,
          pauseReason: to === VOUCHER_STATUSES.PAUSED ? reason || null : null,
          updatedBy: actor.userId,
        },
      },
      { session },
    );

    if (versionUpdate.modifiedCount !== 1) {
      throwError(
        409,
        "Voucher version status changed. Please refresh and try again.",
      );
    }

    const masterMoves = masterFollows(voucher.status, from);
    if (masterMoves) {
      const voucherUpdate = await Voucher.updateOne(
        { _id: voucher._id, status: from, isDeleted: false },
        { $set: { status: to, updatedBy: actor.userId } },
        { session },
      );

      if (voucherUpdate.modifiedCount !== 1) {
        throwError(
          409,
          "Voucher status changed. Please refresh and try again.",
        );
      }
    }

    await VoucherApprovalHistory.create(
      [
        {
          voucherId: voucher._id,
          voucherVersionId: version._id,
          brandId: voucher.brandId,
          action,
          performedBy: actor.userId,
          versionNumber: version.versionNumber,
          voucherCode: voucher.voucherCode,
          versionCode: version.versionCode,
          reason: reason || null,
          metadata: {
            previousVoucherStatus: voucher.status,
            previousVersionStatus: from,
            newVoucherStatus: masterMoves ? to : voucher.status,
            newVersionStatus: to,
            // Says out loud when the master deliberately stayed behind, so the
            // history does not look like a half-applied write.
            masterFollowed: masterMoves,
          },
        },
      ],
      { session },
    );

    await session.commitTransaction();

    return {
      voucherId: voucher._id,
      versionId: version._id,
      voucherCode: voucher.voucherCode,
      versionCode: version.versionCode,
      versionNo: version.versionNumber,
      action,
      voucherStatus: masterMoves ? to : voucher.status,
      versionStatus: to,
      pausedAt: to === VOUCHER_STATUSES.PAUSED ? now : null,
      reason: reason || null,
    };
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
};

/**
 * Take a live voucher out of the customer feed without ending it.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {string} versionId
 * @param {{ reason?: string }} [payload]
 */
exports.pauseVoucher = async (actor, versionId, payload = {}) => {
  const reason = String(payload.reason || "").trim();
  if (reason.length > MAX_REASON) {
    throwError(400, `The reason cannot exceed ${MAX_REASON} characters.`);
  }

  return switchVersion({
    actor,
    versionId,
    from: VOUCHER_STATUSES.PUBLISHED,
    to: VOUCHER_STATUSES.PAUSED,
    action: VOUCHER_APPROVAL_ACTION.PAUSED,
    reason,
  });
};

/**
 * Put a paused voucher back in front of customers.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {string} versionId
 */
exports.resumeVoucher = async (actor, versionId) =>
  switchVersion({
    actor,
    versionId,
    from: VOUCHER_STATUSES.PAUSED,
    to: VOUCHER_STATUSES.PUBLISHED,
    action: VOUCHER_APPROVAL_ACTION.RESUMED,
    beforeWrite: async ({ version, voucher, session }) => {
      /**
       * 🔴 The check the index would otherwise make for us, in a language the
       * vendor can act on.
       *
       * Pausing frees the published slot, so a vendor can publish v2 while v1 is
       * down — and then there is nowhere for v1 to come back to. The index would
       * refuse it with `E11000 … dup key: { voucherId, status: "PUBLISHED" }`,
       * which `errorHandler` turns into a 500. This says what happened and what
       * is left to do.
       */
      const live = await VoucherVersion.findOne({
        voucherId: voucher._id,
        status: VOUCHER_STATUSES.PUBLISHED,
        _id: { $ne: version._id },
        isDeleted: false,
      })
        .session(session)
        .select("versionNumber versionCode");

      if (live) {
        throwError(
          409,
          `Version ${live.versionNumber} went live while this one was paused, and a voucher can only have one live version. Pause version ${live.versionNumber} first, or leave this one paused.`,
        );
      }

      /**
       * ⚠️ A voucher whose validity ran out while it was paused cannot come
       * back. Resuming it would put an expired offer in front of customers —
       * and the hourly sweep would take it straight down again, so the vendor
       * would watch it flicker rather than be told why.
       */
      if (version.endAt && version.endAt <= new Date()) {
        throwError(
          409,
          "This voucher's validity ran out while it was paused. Create a new version with new dates.",
        );
      }
    },
  });
