const crypto = require("crypto");
const { WEBHOOK_DEFAULTS } = require("../../constants/webhook");
const { RAZORPAY_ACCOUNTS } = require("../../constants/transaction");
const { getRazorpayWebhookSecrets } = require("../../configs/razorpay");

/**
 * Constant-time compare of two hex digests.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are checked
 * first — and that check is safe to do in variable time because a digest's
 * length is not a secret.
 */
const matches = (expected, received) => {
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(received, "utf8"),
  );
};

/**
 * Verify a Razorpay webhook signature.
 *
 * Razorpay signs the **raw request body** with the webhook secret — not the
 * re-serialised JSON. `JSON.stringify(req.body)` will not match, because key
 * order and whitespace differ. `index.js` therefore stashes the untouched
 * buffer on `req.rawBody` via the body-parser `verify` hook.
 *
 * This is the only thing standing between the endpoint and anyone who knows the
 * URL, since a webhook cannot carry a JWT. There is no unverified fallback: no
 * secret configured means every delivery is rejected rather than trusted.
 *
 * ---
 *
 * Two things changed when the platform grew a second Razorpay account:
 *
 * **1. Each account has its own list of secrets, not one value.**
 * Rotating a webhook secret leaves a window — however long the deploy takes —
 * where deliveries are still signed with the old one. A single value turns that
 * window into silently unsettled payments. A list makes rotation free: add the
 * new secret, rotate in the dashboard, remove the old one.
 *
 * **2. The account comes from the ROUTE, and the signature only authenticates.**
 * `expect` is the account the endpoint belongs to and its secrets are tried
 * first. The other account's secrets are tried only as a fallback, and a match
 * there is reported as `matchedExpected: false` so the caller can process the
 * delivery *and* raise a warning — a dashboard pointed at the wrong URL should
 * self-heal, but it must not do so silently.
 *
 * Deriving the account purely from which secret matched would be wrong: if the
 * same secret string were ever configured on both dashboards, every customer
 * payment would be looked up against the vendor account.
 *
 * @param {Buffer} rawBody
 * @param {string} signature  the x-razorpay-signature header
 * @param {object} [options]
 * @param {string} [options.expect]  RAZORPAY_ACCOUNTS value for this route
 * @returns {{ ok: boolean, account?: string, matchedExpected?: boolean, reason?: string }}
 */
exports.verifyRazorpayWebhook = (rawBody, signature, { expect } = {}) => {
  if (!signature) {
    return {
      ok: false,
      reason: `Missing ${WEBHOOK_DEFAULTS.signatureHeader} header.`,
    };
  }
  if (!rawBody?.length) {
    return {
      ok: false,
      reason:
        "Raw request body unavailable — the webhook route must receive the untouched payload.",
    };
  }

  // Expected account first, then the rest. When no account is named (a caller
  // that has not been updated) every account is tried in declaration order.
  const order = expect
    ? [expect, ...Object.values(RAZORPAY_ACCOUNTS).filter((a) => a !== expect)]
    : Object.values(RAZORPAY_ACCOUNTS);

  const received = String(signature);
  let anySecretConfigured = false;

  for (const account of order) {
    const secrets = getRazorpayWebhookSecrets(account);
    if (secrets.length) anySecretConfigured = true;

    for (const secret of secrets) {
      const expected = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

      if (matches(expected, received)) {
        return {
          ok: true,
          account,
          // false means the delivery landed on the wrong endpoint. It is still
          // authentic and still processed — but somebody should fix the
          // dashboard, so the caller alerts on it.
          matchedExpected: !expect || account === expect,
        };
      }
    }
  }

  if (!anySecretConfigured) {
    return {
      ok: false,
      reason:
        "No Razorpay webhook secret is configured — deliveries cannot be verified. Set RAZORPAY_WEBHOOK_SECRETS and RAZORPAY_CUSTOMER_WEBHOOK_SECRETS.",
    };
  }

  return { ok: false, reason: "Signature mismatch." };
};
