const Dispute = require("../../models/Dispute");
const { throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const {
  DISPUTE_STATUS,
  DISPUTE_ACTIONABLE_STATUSES,
} = require("../../constants/webhook");
const { buildEvidencePack } = require("../../helpers/disputes");

/**
 * The outlet adds what only they have.
 *
 * ### ⚠️ A bonus, never a dependency
 *
 * `buildEvidencePack` stands on our own records: on this platform a voucher is
 * paid for at the counter, so the payment itself places the customer there. An
 * admin can file without ever hearing from the outlet — which matters, because a
 * dispute gets **one** response and the deadline belongs to the bank.
 *
 * This exists for the one case our data cannot answer: a customer claiming they
 * were never at the outlet at all. The kitchen ticket, a camera timestamp, what
 * the staff remember — none of that is ours to hold.
 *
 * ### Only while it is still open
 *
 * Once the bank has decided, a note changes nothing and accepting it would imply
 * otherwise. The refusal says which way it went, so the outlet is not left
 * guessing why their message bounced.
 */
exports.addVendorDisputeEvidence = async (actor = {}, disputeId, payload = {}) => {
  if (actor.role !== ROLES.VENDOR && actor.role !== ROLES.SUB_VENDOR) {
    throwError(403, "Only the outlet can add evidence to a dispute.");
  }
  if (!actor.brandId) throwError(403, "No brand on this account.");

  const note = String(payload.note || "").trim();
  if (note.length < 3) {
    throwError(422, "Please describe what you remember, or the bill / KOT number.");
  }

  const dispute = await Dispute.findOne({
    $or: [
      { disputeId },
      ...(String(disputeId).match(/^[0-9a-fA-F]{24}$/) ? [{ _id: disputeId }] : []),
    ],
    isDeleted: false,
  }).lean();

  if (!dispute) throwError(404, "Dispute not found.");

  /**
   * ⚠️ Scoped to their own brand, and the same answer as "not found".
   *
   * Telling somebody that a dispute exists but belongs to another brand confirms
   * the id is real, which is a slow way of mapping other people's chargebacks.
   */
  if (String(dispute.brandId) !== String(actor.brandId)) {
    throwError(404, "Dispute not found.");
  }

  if (!DISPUTE_ACTIONABLE_STATUSES.includes(dispute.status)) {
    throwError(
      409,
      dispute.status === DISPUTE_STATUS.WON
        ? "This dispute has already been decided in your favour — nothing more is needed."
        : "This dispute has already been decided, so evidence can no longer be added.",
    );
  }

  const updated = await Dispute.findOneAndUpdate(
    { _id: dispute._id, isDeleted: false },
    {
      $set: {
        vendorEvidenceNote: note,
        vendorEvidenceAt: new Date(),
        vendorEvidenceBy: actor.userId || actor._id,
      },
    },
    { returnDocument: "after" },
  ).lean();

  return {
    disputeId: updated.disputeId,
    vendorEvidenceNote: updated.vendorEvidenceNote,
    vendorEvidenceAt: updated.vendorEvidenceAt,
    message:
      "Thank you — this has been added to what we send the bank. We will let you know how it goes.",
  };
};

/**
 * Everything we can prove about a disputed payment, for the admin filing it.
 *
 * ⚠️ Admin only, and deliberately so: the pack carries the customer's masked
 * contact, the full claim timeline and the argument we intend to make. None of
 * that is the outlet's to read, and some of it is not theirs to know.
 *
 * ⚠️ It does not talk to Razorpay and submits nothing. Evidence is filed by a
 * person, in the dashboard, **once**.
 */
exports.getDisputeEvidencePack = async (actor = {}, disputeId) => {
  if (actor.role !== ROLES.ADMIN) {
    throwError(403, "Only Trydood can prepare a dispute response.");
  }

  return buildEvidencePack(disputeId);
};
