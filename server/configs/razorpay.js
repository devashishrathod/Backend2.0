const Razorpay = require("razorpay");
const { throwError } = require("../utils");
const { RAZORPAY_ACCOUNTS } = require("../constants/transaction");

/**
 * Two entirely separate Razorpay merchants.
 *
 *   VENDOR    — vendor subscription purchases
 *   CUSTOMER  — customer voucher claims
 *
 * Different key id, different secret, different webhook secret, different
 * settlement cycle into different bank accounts. Nothing is shared between
 * them, which is why every account-sensitive operation reads
 * `transaction.gatewayAccount` rather than assuming one.
 *
 * **Instance and key id are handed out together** by `getRazorpayAccount`. They
 * used to be looked up separately — the order was created with one account's
 * client while the checkout key id came from `process.env` at a different line
 * — and a mismatch there means Razorpay's checkout refuses to open at all
 * ("order does not belong to this key") with no useful error.
 *
 * **Nothing throws at import.** `postman/lib/routeGates.js` requires the route
 * tree (and therefore this file) to enumerate endpoints, sometimes without a
 * full environment. A missing key must produce a client that fails on use, not
 * a process that will not boot.
 */

const ACCOUNTS = Object.freeze({
  [RAZORPAY_ACCOUNTS.VENDOR]: Object.freeze({
    keyIdEnv: "RAZORPAY_VENDOR_KEY_ID",
    keySecretEnv: "RAZORPAY_VENDOR_SECRET",
    // Newest first. The legacy single-value var is kept as the last entry so an
    // environment that has not been updated keeps verifying.
    webhookSecretEnvs: Object.freeze([
      "RAZORPAY_WEBHOOK_SECRETS",
      "RAZORPAY_WEBHOOK_SECRET",
    ]),
  }),
  [RAZORPAY_ACCOUNTS.CUSTOMER]: Object.freeze({
    keyIdEnv: "RAZORPAY_CUSTOMER_KEY_ID",
    keySecretEnv: "RAZORPAY_CUSTOMER_SECRET",
    webhookSecretEnvs: Object.freeze(["RAZORPAY_CUSTOMER_WEBHOOK_SECRETS"]),
  }),
});

/**
 * SDK clients, built on first use and then cached.
 *
 * Lazily and not at module load, because `new Razorpay({})` **throws** when
 * `key_id` is missing. Building them eagerly meant that requiring this module
 * without credentials crashed the process at import — so an account with no key
 * took the whole server down at boot, and `logPaymentAccounts()` never got to
 * run. That helper exists precisely to report a missing key as one calm line,
 * and it cannot do that from inside a stack trace.
 *
 * Now a missing key is a falsy client and `isRazorpayAccountConfigured()` says
 * so. The failure surfaces where it is actionable — at boot as a report, and at
 * the call site as a clear 500 — rather than as an import-time crash.
 */
const instanceCache = new Map();

const buildInstance = (account) => {
  const env = ACCOUNTS[account];
  const keyId = process.env[env.keyIdEnv];
  const keySecret = process.env[env.keySecretEnv];
  if (!keyId || !keySecret) return null;

  try {
    return new Razorpay({ key_id: keyId, key_secret: keySecret });
  } catch (error) {
    console.error(
      `[pay] could not build the ${account} Razorpay client:`,
      error?.message,
    );
    return null;
  }
};

/**
 * Not cached by key value: a rotated credential needs a restart anyway, and
 * keying the cache on the secret would keep it in a Map for the process's life.
 */
const getInstance = (account) => {
  if (!instanceCache.has(account)) {
    instanceCache.set(account, buildInstance(account));
  }
  return instanceCache.get(account);
};

/**
 * The SDK client and its matching key id, together.
 *
 * @param {string} account RAZORPAY_ACCOUNTS value
 * @returns {{ account: string, instance: object, keyId: string, keySecret: string }}
 */
const getRazorpayAccount = (account) => {
  const env = ACCOUNTS[account];
  if (!env) {
    throwError(500, `Invalid Razorpay account: ${account}`);
  }
  const instance = getInstance(account);
  if (!instance) {
    throwError(
      500,
      `The ${account} Razorpay account is not configured. Set ${env.keyIdEnv} and ${env.keySecretEnv}.`,
    );
  }

  return {
    account,
    instance,
    keyId: process.env[env.keyIdEnv],
    keySecret: process.env[env.keySecretEnv],
  };
};

/**
 * Every webhook secret configured for an account, newest first.
 *
 * A **list**, not a single value, because Razorpay lets you rotate the webhook
 * secret and there is a window — however long it takes to deploy the new env —
 * where deliveries are still signed with the old one. With a single value those
 * deliveries fail their signature check and the payment behind them silently
 * never settles.
 *
 * With a list, rotation is: add the new secret, rotate in the dashboard, remove
 * the old one. No window, no lost deliveries.
 *
 * Read at call time (not frozen at load) so a rotation only needs a restart,
 * and so tests can set one without reloading the module — same reasoning as
 * `configs/whatsapp.js`.
 */
const getRazorpayWebhookSecrets = (account) => {
  const env = ACCOUNTS[account];
  if (!env) return [];

  const seen = new Set();
  for (const key of env.webhookSecretEnvs) {
    for (const value of String(process.env[key] || "").split(",")) {
      const secret = value.trim();
      if (secret) seen.add(secret);
    }
  }
  return [...seen];
};

/** True when the account can actually open an order. Says nothing about webhooks. */
const isRazorpayAccountConfigured = (account) => {
  const env = ACCOUNTS[account];
  return Boolean(
    env && process.env[env.keyIdEnv] && process.env[env.keySecretEnv],
  );
};

/**
 * What each account looks like right now — for the boot report only.
 * Never returns a secret, only whether one is present.
 */
const describeRazorpayAccounts = () =>
  Object.entries(ACCOUNTS).map(([account, env]) => {
    const keyId = process.env[env.keyIdEnv] || "";
    return {
      account,
      hasKeys: isRazorpayAccountConfigured(account),
      // `rzp_test_` vs `rzp_live_` is the single most useful thing to see at
      // boot: two accounts times two modes is four key sets, and mixing them is
      // a deploy mistake that otherwise surfaces as a failed payment.
      mode: keyId.startsWith("rzp_live_")
        ? "live"
        : keyId.startsWith("rzp_test_")
          ? "test"
          : keyId
            ? "unknown"
            : null,
      keyIdPrefix: keyId ? `${keyId.slice(0, 12)}…` : null,
      webhookSecretCount: getRazorpayWebhookSecrets(account).length,
    };
  });

module.exports = {
  getRazorpayAccount,
  getRazorpayWebhookSecrets,
  isRazorpayAccountConfigured,
  describeRazorpayAccounts,
};
