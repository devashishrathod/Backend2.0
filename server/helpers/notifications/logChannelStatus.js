const { isFcmConfigured } = require("../../configs/fcm");
const { isWhatsAppConfigured, configuredTemplates } = require("../../configs/whatsapp");

/**
 * Print which notification channels can actually deliver, once at boot.
 *
 * Every channel is designed to skip cleanly when unconfigured, which is the right
 * behaviour but leaves one awkward question: *did my env var take effect?* Adding
 * a `WHATSAPP_TEMPLATE_…` and seeing nothing happen is indistinguishable from a
 * typo in the key name. This answers that in one line at startup, with no API
 * surface and no secrets in the output.
 *
 * Never throws, and never logs a credential — only whether one is present.
 */
exports.logChannelStatus = () => {
  try {
    // The same pair `helpers/nodeMailer/sendMail.js` gates on, so this line
    // cannot claim email works when that would skip.
    const email = Boolean(
      process.env.NODEMAILER_EMAIL && process.env.NODEMAILER_PASSWORD,
    );
    const push = isFcmConfigured();
    const waAccount = isWhatsAppConfigured();
    const templates = waAccount ? configuredTemplates() : [];

    const mark = (on) => (on ? "✅" : "⚪");

    console.log(
      `${mark(email)} [notify] email     ${email ? "configured" : "not configured — sends are skipped"}`,
    );
    console.log(
      `${mark(push)} [notify] push      ${push ? "FCM configured" : "no FCM credentials — sends are skipped"}`,
    );

    if (!waAccount) {
      console.log(
        "⚪ [notify] whatsapp  no provider credentials — sends are skipped",
      );
    } else if (!templates.length) {
      console.log(
        "⚪ [notify] whatsapp  provider ready, 0 approved templates — set WHATSAPP_TEMPLATE_<TYPE> per message type",
      );
    } else {
      console.log(
        `✅ [notify] whatsapp  ${templates.length} template(s): ${templates.map((t) => t.type).join(", ")}`,
      );
      // The admin toggle is read from the DB per send, so it is not checked here
      // — but it is the other half of the gate and worth the reminder.
      console.log(
        "   [notify] whatsapp  also requires Setting.vendor.subscription.isWhatsAppNotificationEnabled = true",
      );
    }
  } catch (error) {
    console.error("[notify] could not report channel status:", error?.message);
  }
};
