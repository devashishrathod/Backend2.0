const { throwError } = require("../../utils");
const User = require("../../models/User");
const { sendThrottledMobileOtp } = require("../../helpers/twoFactor");
const { ROLES } = require("../../constants");
const { assertIdentityVerified } = require("../../helpers/auth");

exports.loginWithMobileOTP = async (body) => {
  let { mobile, role } = body;
  role = role?.toUpperCase() || ROLES.ADMIN;
  const user = await User.findOne({ mobile, role, isDeleted: false }).select(
    "+password",
  );
  if (!user) throwError(404, "User not found with this Mobile");
  assertIdentityVerified(user, "mobile");
  /**
   * ⚠️ Throttled now, and this route is **public**.
   *
   * It called 2factor directly, and `sendOtp`'s 60s / 5-per-hour limit only
   * covers WhatsApp and email — so anybody could post a stranger's number here as
   * fast as they liked and every request became an SMS we pay for, on a phone
   * belonging to somebody who never asked. `CLAUDE.md` says every OTP path goes
   * through the throttle; this was the one that did not.
   */
  return await sendThrottledMobileOtp(mobile);
};
