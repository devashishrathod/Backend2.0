const SubscribedHistory = require("../../models/SubscribedHistory");
const { ROLES } = require("../../constants");
const { HISTORY_PERFORMED_BY } = require("../../constants/subscription");

const roleToPerformer = (role) => {
  if (role === ROLES.ADMIN) return HISTORY_PERFORMED_BY.ADMIN;
  if (role === ROLES.VENDOR || role === ROLES.SUB_VENDOR) {
    return HISTORY_PERFORMED_BY.VENDOR;
  }
  return HISTORY_PERFORMED_BY.SYSTEM;
};

/**
 * Append one immutable audit row.
 *
 * Deliberately swallows its own errors: an audit write must never roll back the
 * activation, grant or expiry that produced it. A lost row is logged loudly and
 * the business operation stands.
 */
exports.recordSubscribedHistory = async (payload = {}) => {
  try {
    const performedByRole =
      payload.performedByRole || roleToPerformer(payload.role);
    return await SubscribedHistory.create({ ...payload, performedByRole });
  } catch (error) {
    console.error(
      `[recordSubscribedHistory] failed to write ${payload?.action} row for brand ${payload?.brandId}:`,
      error?.message,
    );
    return null;
  }
};

exports.roleToPerformer = roleToPerformer;
