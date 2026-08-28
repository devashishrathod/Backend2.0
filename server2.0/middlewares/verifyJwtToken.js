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

/**
 * Guest browsing: signed in if a token is sent, anonymous if not.
 *
 * The customer app lets people look around before creating an account (an app
 * store requirement), so the browse endpoints cannot demand a token. Removing
 * the gate outright is not the same thing though — the handlers behind them
 * read `req.userId` to personalise, and with no gate at all that is `undefined`
 * even for a signed-in caller. This populates it when a token is there and
 * leaves it unset when it is not, so one endpoint serves both audiences.
 *
 * A token that *is* present must still be valid; see `optional` in
 * middlewares/authenticate.js for why.
 */
exports.optionalAuth = buildAuthGate({ optional: true });
