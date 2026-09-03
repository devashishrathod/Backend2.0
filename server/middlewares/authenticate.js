const jwt = require("jsonwebtoken");
const { ROLES } = require("../constants");
const { getUserById } = require("../services/users");
const { assertAccountAccess } = require("../helpers/auth");
const { throwError, asyncWrapper } = require("../utils");

/**
 * The one implementation behind every auth gate in the app.
 *
 * `verifyJwtToken` and `validateRoles` used to be near-duplicates — the same
 * forty lines of token parsing, the same user load, the same `req` decoration,
 * differing only in a role check at the end. That is a bad place for a copy: any
 * rule added to one door and forgotten on the other leaves the API open through
 * the second one. Adding the deactivation gate made that concrete, so the body
 * now lives here once and each exported gate is a call to this builder.
 *
 * Behaviour is unchanged from the two originals, including the specific status
 * codes for each JWT failure mode, so nothing downstream had to move.
 *
 * @param {object}   [options]
 * @param {string[]} [options.allowedRoles]  Roles permitted. Omit for "any
 *                                           authenticated user".
 * @param {boolean}  [options.allowDeactivated=false]
 *        Let a deactivated account through. Only for the endpoints a suspended
 *        user still has to reach — see middlewares/index.js.
 * @param {boolean}  [options.optional=false]
 *        Guest browsing. With no `Authorization` header at all the request
 *        continues with no `req.userId`, and the handler decides what an
 *        anonymous caller gets.
 *
 *        A header that *is* present still has to be valid. Silently downgrading
 *        an expired token to a guest session would show a signed-in user the
 *        anonymous view with no hint why, and they would never be prompted to
 *        log in again — so a bad token is rejected here exactly as it is on
 *        every other gate.
 */
exports.buildAuthGate = ({
  allowedRoles = null,
  allowDeactivated = false,
  optional = false,
} = {}) =>
  asyncWrapper(async (req, res, next) => {
    let token = req.headers["authorization"];
    if (!token) {
      if (optional) return next();
      throwError(401, "Access Denied! Missing authorization token");
    }
    const splitToken = token.split(" ")[1];
    if (!splitToken) {
      throwError(403, "Access Denied! Invalid authorization token format");
    }
    let decodedToken;
    try {
      decodedToken = jwt.verify(splitToken, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        throwError(401, "Your session has expired. Please log in again.");
      } else if (error.name === "JsonWebTokenError") {
        throwError(403, "Invalid or malformed token. Please log in again.");
      } else if (error.name === "NotBeforeError") {
        throwError(403, "Token not active yet. Please try again later.");
      } else {
        throwError(500, "Authentication failed due to an unexpected error.");
      }
    }
    if (!decodedToken) throwError(403, "Access Denied! Invalid token");

    const user = await getUserById(decodedToken?.id);
    if (!user) throwError(404, "Access Denied! User not found");

    // A valid token is not the same as a live account. Without this, deactivating
    // someone only took effect at their next login — which a logged-in user never
    // reaches. `iat` is passed so a token predating a session kill is refused
    // too. See helpers/auth/assertAccountAccess.js.
    assertAccountAccess(user, {
      issuedAt: decodedToken.iat,
      allowDeactivated,
    });

    req.userId = user._id;
    req.role = user.role;
    req.user = user;
    if (user.role === ROLES.CUSTOMER) {
      req.customerId = user.customerId;
    }
    if (user.role === ROLES.VENDOR) {
      req.brandId = user.brandId;
    }
    /**
     * A sub-vendor works one outlet of a brand, and needs both.
     *
     * ⚠️ Nothing was set here at all. Every gate that reads `req.brandId` — the
     * claim access check, the outlet verify screen — simply saw `undefined` for
     * a sub-vendor and refused them, or worse, matched nothing and returned an
     * empty list that reads as "no claims today".
     *
     * `brandId` is the parent brand, not a second identity: a sub-vendor's claims
     * belong to the brand, and scoping to the outlet is `subBrandId`'s job.
     */
    if (user.role === ROLES.SUB_VENDOR) {
      req.brandId = user.brandId;
      req.subBrandId = user.subBrandId;
    }

    // Last, so a deactivated account is told it is deactivated rather than that
    // it lacks permission.
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      throwError(
        403,
        "Forbidden: You do not have permission to perform this action.",
      );
    }

    next();
  });
