const VoucherClaimHistory = require("../../models/VoucherClaimHistory");
const { ROLES } = require("../../constants");
const { CLAIM_PERFORMED_BY } = require("../../constants/voucherClaim");

/**
 * Map an auth role to the audit actor.
 *
 * Anything that is not a recognised human role is `SYSTEM` — a job, a webhook, a
 * sweep. That is a real answer, not a fallback: "the expiry job did it" is
 * exactly what an auditor needs to read.
 */
const roleToPerformer = (role) => {
  if (role === ROLES.ADMIN) return CLAIM_PERFORMED_BY.ADMIN;
  if (role === ROLES.VENDOR || role === ROLES.SUB_VENDOR) {
    return CLAIM_PERFORMED_BY.VENDOR;
  }
  if (role === ROLES.CUSTOMER) return CLAIM_PERFORMED_BY.CUSTOMER;
  return CLAIM_PERFORMED_BY.SYSTEM;
};

/**
 * Append one immutable audit row.
 *
 * **Deliberately swallows its own errors.** An audit write must never roll back
 * the capture, refund or expiry that produced it: a customer whose payment
 * succeeded but whose history row failed to save has still been charged, and
 * throwing here would unwind a settled payment over a logging failure.
 *
 * A lost row is logged loudly instead, and the business operation stands. That
 * is the same trade `recordSubscribedHistory` makes on the vendor side.
 */
exports.recordClaimHistory = async (payload = {}) => {
  try {
    const performedByRole =
      payload.performedByRole || roleToPerformer(payload.role);
    const { role, ...rest } = payload;
    return await VoucherClaimHistory.create({ ...rest, performedByRole });
  } catch (error) {
    console.error(
      `[recordClaimHistory] failed to write ${payload?.action} row for claim ${payload?.claimId}:`,
      error?.message,
    );
    return null;
  }
};

exports.roleToPerformer = roleToPerformer;
