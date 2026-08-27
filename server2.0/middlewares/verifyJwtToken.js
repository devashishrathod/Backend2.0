const { buildAuthGate } = require("./authenticate");

/** Any signed-in, live account. The default door. */
exports.verifyJwtToken = buildAuthGate();

/**
 * Same, but a deactivated account is let through.
 *
 * Only for the endpoints a suspended user still has to reach: signing out and
 * retiring their push devices. A session that was explicitly killed
 * (`User.sessionInvalidatedAt`) is still refused here — see
 * helpers/auth/assertAccountAccess.js.
 */
exports.verifyJwtTokenEvenIfDeactivated = buildAuthGate({
  allowDeactivated: true,
});
