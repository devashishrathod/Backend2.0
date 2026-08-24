const {
  WHATSAPP,
  templateFor,
  templateEnvKey,
  isWhatsAppConfigured,
} = require("../../configs/whatsapp");

/**
 * Provider variables are positional and single-line. A newline or an over-long
 * value is rejected by Meta, and a rejection looks identical to an outage from
 * here — so they are cleaned before sending rather than after being refused.
 */
const sanitise = (value) => {
  if (value === null || value === undefined) return "";
  return (
    String(value)
      .replace(/[\r\n\t]+/g, " ")
      // Params are sent as one comma-separated list, so a comma *inside* a value
      // would split it into two and shift every variable after it. A plan named
      // "Pro, Plus" or a formatted amount like "₹ 1,299.00" would do exactly
      // that.
      //
      // A thousands separator is dropped outright — "₹ 1299.00" reads correctly
      // where "₹ 1 299.00" looks like a typo. Any other comma becomes a space,
      // which is what a name or a sentence needs.
      .replace(/(\d),(?=\d)/g, "$1")
      .replace(/,/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, WHATSAPP.maxParamLength)
  );
};

/**
 * The provider expects a bare Indian 10-digit number. Stored numbers are not
 * consistent about it — some carry `+91`, some `91`, some spaces or dashes —
 * and sending the wrong shape fails silently at the provider rather than
 * erroring, which is the worst kind of failure to debug.
 */
const normalisePhone = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  // Country code prefixed, with or without a leading zero.
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 13 && digits.startsWith("091")) return digits.slice(3);
  return null;
};

/**
 * Send one templated WhatsApp message.
 *
 * **Never throws.** This is the important difference from `helpers/otps/tendigit.js`,
 * which throws a 503 — correct there, because a user is staring at an OTP screen
 * waiting. Here the caller is a business operation (a payment settling, the expiry
 * sweep) that must not be rolled back because a message did not go out. The
 * in-app notification row is the record; WhatsApp is a side channel.
 *
 * Skips cleanly, with a stated reason, in every unconfigured case:
 *  - provider credentials missing
 *  - no approved template for this notification type
 *  - the recipient has no usable WhatsApp number
 *
 * @param {object} params
 * @param {string} params.phone      recipient number, any common format
 * @param {string} params.type       NOTIFICATION_TYPES — selects the template
 * @param {Array}  [params.params]   positional template variables, in order
 * @param {string} [params.urlParam] value for a template's dynamic URL button
 * @returns {Promise<{sent:boolean, skipped?:boolean, reason?:string, error?:string, template?:string}>}
 */
exports.sendWhatsApp = async ({ phone, type, params = [], urlParam }) => {
  if (!isWhatsAppConfigured()) {
    return {
      sent: false,
      skipped: true,
      reason:
        "WhatsApp is not configured (TENDIGIT_BASEURL / TENDIGIT_LICENSE / TENDIGIT_APIKEY)",
    };
  }

  const template = templateFor(type);
  if (!template) {
    // The normal state for a type whose template is still awaiting approval, so
    // the reason names the env var rather than sounding like a fault.
    return {
      sent: false,
      skipped: true,
      reason: `No approved WhatsApp template for ${type}. Set ${templateEnvKey(type)} once Meta approves it.`,
    };
  }

  const contact = normalisePhone(phone);
  if (!contact) {
    return {
      sent: false,
      skipped: true,
      reason: phone
        ? "Recipient's number is not a usable 10-digit Indian mobile number"
        : "Recipient has no WhatsApp number on record",
    };
  }

  // Empties become "-" rather than being dropped. A Meta-approved template has a
  // **fixed** number of positional variables, so removing one would silently
  // shift every variable after it — the plan name landing where the date belongs.
  // A visible dash is far better than a scrambled message.
  const cleaned = params
    .slice(0, WHATSAPP.maxParams)
    .map((v) => sanitise(v) || "-");

  const url = new URL(WHATSAPP.urlBase);
  url.searchParams.set("LicenseNumber", WHATSAPP.licenseNumber);
  url.searchParams.set("APIKey", WHATSAPP.apiKey);
  url.searchParams.set("Contact", contact);
  url.searchParams.set("Template", template);
  if (cleaned.length) url.searchParams.set("Param", cleaned.join(","));
  if (urlParam) url.searchParams.set("URLParam", sanitise(urlParam));

  // `fetch` has no default timeout. Without this an unreachable provider would
  // hold the request open indefinitely — the same failure mode the SMTP client
  // had before its timeouts were added.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WHATSAPP.requestTimeoutMs);

  try {
    const resp = await fetch(url.toString(), { signal: controller.signal });

    // Read as text first: an error page or a gateway response is not JSON, and
    // `resp.json()` on one throws something unhelpful.
    const body = await resp.text();
    let json = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }

    if (!resp.ok) {
      return {
        sent: false,
        template,
        error: `Provider returned HTTP ${resp.status}`,
      };
    }
    if (json?.ApiResponse !== "Success") {
      // The provider's own reason is far more useful than "failed" — a rejected
      // template or a number not on WhatsApp both land here.
      return {
        sent: false,
        template,
        error:
          json?.Reason ||
          json?.Message ||
          json?.ApiResponse ||
          "Provider did not confirm delivery",
      };
    }

    // `sent: true` means the provider **accepted** the message for delivery, not
    // that it reached the handset. TENDIGIT answers `Success` on acceptance, and
    // it answers that even for a template name Meta has not approved — the
    // rejection happens downstream, out of sight. So a `true` here is "handed
    // over successfully", and a template must still be verified by sending one to
    // a real number before it is trusted.
    return { sent: true, template };
  } catch (error) {
    return {
      sent: false,
      template,
      error:
        error?.name === "AbortError"
          ? `Provider did not respond within ${WHATSAPP.requestTimeoutMs}ms`
          : error?.message || "unknown WhatsApp error",
    };
  } finally {
    clearTimeout(timer);
  }
};

// Exported for the notification layer and for tests. `sanitise` is exported so
// the comma/newline rules can be verified without sending a real message.
exports.normalisePhone = normalisePhone;
exports.sanitiseParam = sanitise;
