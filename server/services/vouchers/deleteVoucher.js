const mongoose = require("mongoose");
const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherApprovalHistory = require("../../models/VoucherApprovalHistory");
const { throwError } = require("../../utils");
const {
  VOUCHER_STATUSES,
  VOUCHER_APPROVAL_ACTION,
} = require("../../constants/voucher");
const { ENTITLEMENT_BUCKETS } = require("../../constants/subscription");
const { resolveActorBrand, releaseSlot } = require("../../helpers/brands");
const {
  assertNoLiveClaims,
  voucherDeletionFields,
} = require("../../helpers/vouchers");

const MAX_REASON = 500;

/**
 * Delete a voucher (V-6, V-8, V-11).
 *
 * ### 🔴 The "D" that was never built
 *
 * A vendor could create, edit, submit, publish and pause a voucher, and then
 * live with it for ever. There was no delete at all — so a voucher made by
 * mistake sat in the listing holding a plan slot, and the only way to get the
 * slot back was to wait for it to expire.
 *
 * ### Soft, and said out loud
 *
 * The row stays. `VoucherClaim` carries snapshots of the offer, voucher, brand
 * and outlet, so a customer's order history does not read through to this
 * document and survives the delete intact — but the claim still points at
 * `voucherId`, and hard-deleting would leave every one of those pointing at
 * nothing.
 *
 * `isDeleted`, `status: DELETED`, `deletedAt`, `deletedBy` and `deleteReason`
 * are all written by `voucherDeletionFields()` in one `$set`, which is the only
 * thing that builds them — see the note on `VOUCHER_STATUSES.DELETED`.
 *
 * ### Versions go with it
 *
 * A voucher's versions have no life of their own; leaving them behind would
 * leave a `PUBLISHED` version of a deleted voucher, which the customer listing
 * joins to through `voucherMappings` and would happily keep serving.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {string} voucherId
 * @param {{ reason?: string }} [payload]
 */
exports.deleteVoucher = async (actor, voucherId, payload = {}) => {
  if (!actor?.userId) throwError(401, "User authentication is required.");
  if (!voucherId || !mongoose.Types.ObjectId.isValid(voucherId)) {
    throwError(400, "Invalid voucher ID.");
  }

  const reason = String(payload.reason || "").trim();
  if (reason.length > MAX_REASON) {
    throwError(400, `The reason cannot exceed ${MAX_REASON} characters.`);
  }

  const voucher = await Voucher.findOne({ _id: voucherId, isDeleted: false })
    .select("_id brandId voucherCode status currentVersionId publishedVersionId")
    .lean();

  if (!voucher) throwError(404, "Voucher not found.");

  await resolveActorBrand(actor, voucher.brandId);

  /**
   * ⚠️ `VoucherApprovalHistory` requires a version on every row, because every
   * other action it records is version-scoped. A delete is not — it takes the
   * whole voucher and every version with it — so the row names the version the
   * vendor was last working on, and `versionsDeleted` in the metadata carries
   * what actually happened.
   *
   * The fallback to the highest-numbered version is for a voucher whose
   * `currentVersionId` never got set. That should not happen (`createVoucher`
   * always makes v1), but a history row is the wrong place to discover it: the
   * delete would abort on a required field and leave the vendor unable to remove
   * their own voucher for a reason that has nothing to do with them.
   */
  const namedVersion =
    (voucher.currentVersionId &&
      (await VoucherVersion.findOne({ _id: voucher.currentVersionId })
        .select("_id versionNumber versionCode")
        .lean())) ||
    (await VoucherVersion.findOne({ voucherId: voucher._id })
      .sort({ versionNumber: -1 })
      .select("_id versionNumber versionCode")
      .lean());

  if (!namedVersion) throwError(409, "Voucher has no version to delete.");

  /**
   * 🔴 Before anything is written, and **before** the transaction — there is
   * nothing to roll back if this refuses, and a guard that costs a transaction
   * to say no is a guard people learn to avoid.
   *
   * This one does not exempt ADMIN. Every other guard here does, because an
   * admin overriding a vendor's rule is what being an admin is for. The person
   * this protects is neither of them.
   */
  await assertNoLiveClaims(voucher._id);

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const deletion = voucherDeletionFields({ userId: actor.userId, reason });

    /**
     * ⚠️ `isDeleted: false` on the write, and it guards a narrower thing than it
     * looks like.
     *
     * 🔴 It is **not** what stops a double click. Two deletes fired together
     * overlap inside their transactions and Mongo refuses one with a
     * `WriteConflict` before this filter is consulted at all — verified: a
     * mutation that deletes this line leaves the concurrency test passing,
     * because the transaction is doing that job.
     *
     * What it does cover is the gap between the two: a second caller whose
     * `findOne` above ran *before* the first delete committed, but whose write
     * lands *after* it. There is no overlap for the transaction to catch, the
     * document is already deleted, and without this the update would succeed a
     * second time — a second history row, and a second `releaseSlot` handing the
     * brand a voucher it did not pay for.
     *
     * That window is real but too narrow to construct deterministically from
     * outside this function, so it is held by the filter and by this note rather
     * than by a test. The mutation on it survives, and is reported as surviving.
     */
    const voucherUpdate = await Voucher.updateOne(
      { _id: voucher._id, isDeleted: false },
      { $set: { ...deletion, updatedBy: actor.userId } },
      { session },
    );

    if (voucherUpdate.modifiedCount !== 1) {
      throwError(409, "Voucher was already deleted. Please refresh.");
    }

    const versionResult = await VoucherVersion.updateMany(
      { voucherId: voucher._id, isDeleted: false },
      { $set: { ...deletion, updatedBy: actor.userId } },
      { session },
    );

    await VoucherApprovalHistory.create(
      [
        {
          voucherId: voucher._id,
          brandId: voucher.brandId,
          voucherVersionId: namedVersion._id,
          action: VOUCHER_APPROVAL_ACTION.DELETED,
          performedBy: actor.userId,
          versionNumber: namedVersion.versionNumber,
          versionCode: namedVersion.versionCode,
          voucherCode: voucher.voucherCode,
          reason: deletion.deleteReason,
          metadata: {
            previousVoucherStatus: voucher.status,
            newVoucherStatus: VOUCHER_STATUSES.DELETED,
            versionsDeleted: versionResult.modifiedCount || 0,
            deletedAt: deletion.deletedAt,
            deletedBy: actor.userId,
          },
        },
      ],
      { session },
    );

    await session.commitTransaction();

    /**
     * ⚠️ After the commit, not inside it. `releaseSlot` writes to `Brand`, which
     * is outside this transaction's concern, and it deliberately never throws —
     * a counter that failed to move must not undo a delete that has already
     * happened. `recountBrandUsage` reconciles anything missed.
     */
    await releaseSlot(voucher.brandId, ENTITLEMENT_BUCKETS.VOUCHERS);

    return {
      voucherId: voucher._id,
      voucherCode: voucher.voucherCode,
      status: VOUCHER_STATUSES.DELETED,
      deletedAt: deletion.deletedAt,
      deletedBy: actor.userId,
      deleteReason: deletion.deleteReason,
      versionsDeleted: versionResult.modifiedCount || 0,
      previousStatus: voucher.status,
    };
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
};
