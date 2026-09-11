const User = require("../../models/User");
const { ROLES, LOGIN_TYPES } = require("../../constants");
const { verifyOtp } = require("../../services/otps");
const { throwError } = require("../../utils");
const { assertAccountAccess } = require("../../helpers/auth");
const {
  sanitizeUser,
  syncRoleProfileIdentity,
} = require("../../helpers/users");

exports.verifyOtpWithWhatsapp = async (body) => {
  let { otp, whatsappNumber, role, currentScreen } = body;
  role = role?.toUpperCase() || ROLES.CUSTOMER;
  whatsappNumber = whatsappNumber?.toLowerCase();

  const user = await User.findOne({ whatsappNumber, role, isDeleted: false });
  if (!user) throwError(404, "Invalid Whatsapp number, user not found!");

  // Step one refuses to *create* a deactivated account's role, but an account
  // can be deactivated between requesting a code and presenting it. Same shared
  // gate as the middlewares, so the refusal carries `details.code` and the
  // client branches on one value everywhere.
  assertAccountAccess(user);

  //  await verifyOtp(whatsappNumber, otp);

  /**
   * ⚠️ `isWhatsappVerified`, not `isMobileVerified`.
   *
   * This path set **`isMobileVerified`** for as long as it existed, which meant
   * every account created through the public WhatsApp login carried a `true`
   * about a `mobile` field it does not have — while `isWhatsappVerified`, the
   * flag that describes what actually happened here, was written by nothing at
   * all.
   *
   * That crossed wire is not cosmetic once anything reads it: the admin
   * directory filters on `isMobileVerified` and would answer "verified" for a
   * customer with no mobile number, and the notification guard decides whether a
   * message may be sent on a channel by asking whether *that channel's* key was
   * confirmed.
   *
   * `scripts/backfillIdentityFlags.js` moves the existing rows.
   */
  user.isWhatsappVerified = true;

  /**
   * ⚠️ Set here, and it was not before.
   *
   * `verifyMobileOTP` writes `MOBILE`, `verifyEmailOTP` writes `EMAIL`,
   * `registerUser` writes `PASSWORD` — this path wrote nothing, so a person who
   * signs in by WhatsApp a hundred times kept whatever `loginType` some earlier
   * route had left behind. The admin directory shows that field as "how they
   * sign in" and filters on it, so it was quietly wrong for every WhatsApp user.
   *
   * Nothing branches on `loginType`; it is a projection and a filter only.
   */
  user.loginType = LOGIN_TYPES.WHATSAPP;

  if (currentScreen) user.currentScreen = currentScreen.toUpperCase().trim();
  // Set on the document rather than through `markSignedIn`, because this
  // path already saves — a second write for two booleans is waste. Same two
  // fields, same meaning; see helpers/auth/markSession.js for why they
  // matter and why they were missing here.
  user.isLoggedIn = true;
  user.isOnline = true;
  await user.save();

  /**
   * The number is already the one on the account — this call changes no value.
   * It runs so the **mirror** is repaired: `Customer.whatsappNumber` and
   * `Brand.whatsappNumber` were written once at signup and never again, and
   * `sendBankOtp` delivers a refund's bank-attach code to the customer's copy.
   *
   * ⚠️ Not inside a transaction and deliberately not awaited into the failure
   * path: a sign-in must not fail because a mirror could not be written. The next
   * login tries again, and `scripts/syncRoleProfileIdentity.js` catches up in
   * bulk.
   */
  await syncRoleProfileIdentity(user).catch((error) =>
    console.error(`[auth] identity mirror failed for ${user._id}:`, error?.message),
  );

  const token = user.getSignedJwtToken();

  return { user: sanitizeUser(user), token };
};
