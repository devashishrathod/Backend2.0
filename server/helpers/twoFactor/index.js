const { sendOtpToMobile } = require("./sendOtpToMobile");
const { verifyOtpToMobile } = require("./verifyOtpToMobile");
const { sendThrottledMobileOtp } = require("./sendThrottledMobileOtp");

module.exports = {
  /**
   * ⚠️ `sendOtpToMobile` is the **raw** 2factor call and has no rate limit.
   * Nothing new should reach for it — use `sendThrottledMobileOtp`, which is the
   * same send with the 60s / 5-per-hour claim in front. This stays exported
   * because the throttled wrapper is built on it.
   */
  sendOtpToMobile,
  sendThrottledMobileOtp,
  verifyOtpToMobile,
};
