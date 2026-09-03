const { describeRazorpayAccounts } = require("../../configs/razorpay");

/**
 * Print which Razorpay accounts can actually take money, once at boot.
 *
 * Two accounts times test/live is four key sets, plus two webhook secret lists.
 * Mixing them — a customer test key against a live webhook secret, or a webhook
 * secret that was never deployed — fails at the worst possible moment: after
 * the customer has paid. And it fails *quietly*, because a rejected delivery
 * looks identical to no delivery.
 *
 * This is the same idea as `helpers/notifications/logChannelStatus.js`: answer
 * "did my env var take effect?" in one line at startup, with no endpoint and no
 * secret in the output. Only whether a value is present, and whether the key is
 * a test or live one.
 *
 * Never throws — a boot report must not be able to stop the boot.
 */
exports.logPaymentAccounts = () => {
  try {
    const mark = (on) => (on ? "✅" : "⚪");

    for (const acc of describeRazorpayAccounts()) {
      if (!acc.hasKeys) {
        console.log(
          `⚪ [pay] ${acc.account.padEnd(8)}  no API keys — this account cannot open orders`,
        );
        continue;
      }

      const mode =
        acc.mode === "unknown"
          ? "key id is neither rzp_test_ nor rzp_live_"
          : `${acc.mode} · ${acc.keyIdPrefix}`;

      const webhook = acc.webhookSecretCount
        ? `${acc.webhookSecretCount} webhook secret(s)`
        : "NO webhook secret — deliveries will be rejected";

      console.log(
        `${mark(acc.webhookSecretCount > 0)} [pay] ${acc.account.padEnd(8)}  ${mode} · ${webhook}`,
      );
    }

    // Not a payment credential, but it belongs in the same glance: without it
    // the invoice download link and the WhatsApp button are silently omitted
    // rather than broken, which is easy to miss.
    console.log(
      `${mark(Boolean(process.env.PUBLIC_API_URL))} [pay] PUBLIC_API_URL  ${
        process.env.PUBLIC_API_URL ||
        "not set — invoice links and WhatsApp buttons will be omitted"
      }`,
    );
  } catch (error) {
    console.error("[pay] could not report payment accounts:", error?.message);
  }
};
