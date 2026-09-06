const {
  NOTIFICATION_AUDIENCE,
  PLATFORM_CHANNEL_KEYS,
  ADMIN_NOTIFICATION_DEFAULTS,
} = require("../../constants/notification");
const { SUBSCRIPTION_DEFAULTS } = require("../../constants/subscription");
const {
  CUSTOMER_NOTIFICATION_DEFAULTS,
} = require("../../constants/customer");
const {
  getSubscriptionConfig,
  getCustomerConfig,
  getAdminConfig,
} = require("../settings");

/**
 * The **platform's** channel switches for one audience, always complete.
 *
 * ### What this returns, and why the shape matters
 *
 * Always exactly this, with three real booleans and nothing absent:
 *
 * ```js
 * { email: true, push: true, whatsapp: false }
 * ```
 *
 * Never a partial object, never `undefined` for a channel, whatever the database
 * says or fails to say. Everything downstream — `notify`, `notifyAudience`, the
 * preference endpoints — can then read `channels[channel]` and be done, instead
 * of each deciding for itself what a missing flag means.
 *
 * ---
 *
 * ### 🔴 The bug this replaces
 *
 * `notify()` read the settings inside a `try` and, on failure, fell back to
 * `{}` — under a comment that said *"defaults are the right fallback for a
 * delivery decision"*. `{}` is not the defaults. It is **every flag
 * `undefined`**, and the three delivery gates each read `undefined` differently,
 * because each had been written with a different operator:
 *
 * ```js
 * Boolean(config.isEmailNotificationEnabled)      // undefined → false → no email
 * config.isPushNotificationEnabled !== false      // undefined → true  → push sends
 * config.isWhatsAppNotificationEnabled === true   // undefined → false → no WhatsApp
 * ```
 *
 * So a settings read that failed produced: **no email** (default is `true`),
 * push (default `true`), no WhatsApp (default `false`). Email came out the
 * opposite of its own default — and email is the one channel the guard existed
 * to protect. The guard turned off the thing it was written to keep on.
 *
 * ⚠️ Worse, it is not necessarily transient. `getSetting()` is a `findOneAndUpdate`
 * with `upsert: true` — a **write**. A `Setting` document that fails to cast or
 * validate makes it throw on *every* call, for ever: all email and all WhatsApp
 * silently off, push still working, in-app rows still appearing. Half-working is
 * harder to notice than broken, and the symptom ("emails stopped") points at
 * SMTP, not at a settings document.
 *
 * ### Where the per-channel intent lives now
 *
 * In the **defaults**, which is the one place it can be read at a glance:
 *
 * | Channel | Default | Why |
 * |---|---|---|
 * | email | `true` | costs nothing, and a lost notification is the failure to avoid |
 * | push | `true` | costs nothing, and is already gated by whether FCM is configured |
 * | whatsapp | `false` | charged per message, and every type needs its own Meta-approved template |
 *
 * Three different operators were an attempt to encode that intent at the point
 * of use. It belongs here instead: one rule downstream, one table to read.
 */

/**
 * One warning per distinct cause, not per notification.
 *
 * ⚠️ The old code logged inside `notify`, so a persistent settings failure
 * printed once **per message** — thousands of identical lines an hour, burying
 * the one that mattered.
 */
const warned = new Set();
const warnOnce = (key, message) => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
};

/**
 * Which settings block belongs to which audience, and what it falls back to.
 *
 * ⚠️ A table, not a chain of `if`s. Adding an audience is one entry; the
 * previous shape was *"customer? … otherwise vendor"*, and **admin fell into
 * *otherwise***, which is how admin alerts came to be governed by the vendor's
 * toggle. A missing entry in a table is visible; a missing branch is not.
 */
const AUDIENCE_CHANNELS = Object.freeze({
  [NOTIFICATION_AUDIENCE.CUSTOMER]: {
    block: "customer.notification",
    defaults: CUSTOMER_NOTIFICATION_DEFAULTS,
    read: async () => (await getCustomerConfig()).notification,
  },
  [NOTIFICATION_AUDIENCE.ADMIN]: {
    block: "admin.notification",
    defaults: ADMIN_NOTIFICATION_DEFAULTS,
    read: getAdminConfig,
  },
  [NOTIFICATION_AUDIENCE.VENDOR]: {
    block: "vendor.subscription",
    // ⚠️ `SUBSCRIPTION_DEFAULTS` carries far more than these three keys — GST
    // rates, company identity, reminder offsets. Only the channel flags are read
    // out of it, by `PLATFORM_CHANNEL_KEYS`, so the rest cannot leak into a
    // delivery decision.
    defaults: SUBSCRIPTION_DEFAULTS,
    read: getSubscriptionConfig,
  },
});

/** An audience nobody declared is a bug; it is named rather than guessed at. */
const entryFor = (audience) => {
  const entry = AUDIENCE_CHANNELS[audience];
  if (entry) return entry;

  warnOnce(
    `audience:${audience}`,
    `[notify] no channel settings declared for audience "${audience}" — using the vendor block. Add it to AUDIENCE_CHANNELS in helpers/notifications/audienceChannels.js.`,
  );
  return AUDIENCE_CHANNELS[NOTIFICATION_AUDIENCE.VENDOR];
};

/**
 * A settings-shaped object into the three-boolean shape, filling anything absent
 * from that audience's defaults.
 *
 * `??`, not `||` — an explicit `false` from the database is a decision and must
 * survive.
 */
const toChannels = (source, entry) => {
  const channels = {};

  for (const [channel, settingKey] of Object.entries(PLATFORM_CHANNEL_KEYS)) {
    const value = source?.[settingKey] ?? entry.defaults?.[settingKey];

    /**
     * ⚠️ Every audience's defaults declare every channel, so this is a
     * programming error — a channel added to `PLATFORM_CHANNEL_KEYS` without a
     * default — and not a runtime state.
     *
     * Fails **closed**, because an unknown switch is not a reason to spend money
     * on a WhatsApp message or to mail somebody; and says so, because a silent
     * `false` here is exactly the class of bug this file exists to remove.
     */
    if (typeof value !== "boolean") {
      warnOnce(
        `default:${entry.block}:${channel}`,
        `[notify] no default for "${channel}" in ${entry.block} — treating it as off. Add ${settingKey} to that audience's defaults.`,
      );
      channels[channel] = false;
      continue;
    }

    channels[channel] = value;
  }

  return channels;
};

/**
 * The platform's verdict per channel for this audience.
 *
 * **Never throws and never returns a partial answer.** A settings failure yields
 * that audience's declared defaults, which is what the old guard said it did.
 *
 * @param {string} audience  NOTIFICATION_AUDIENCE
 * @returns {Promise<{channels: {email:boolean, push:boolean, whatsapp:boolean},
 *                    degraded: boolean, reason?: string}>}
 */
exports.resolveAudienceChannels = async (audience) => {
  const entry = entryFor(audience);

  try {
    return { channels: toChannels(await entry.read(), entry), degraded: false };
  } catch (error) {
    warnOnce(
      `read:${entry.block}`,
      `[notify] could not read ${entry.block} settings — falling back to its defaults. ` +
        `Delivery continues; check the Setting document. ${error?.message}`,
    );

    return {
      // `null` source: every channel comes from the defaults.
      channels: toChannels(null, entry),
      degraded: true,
      reason: error?.message,
    };
  }
};

/** Exported for the tests, and for anything that needs the table itself. */
exports.AUDIENCE_CHANNELS = AUDIENCE_CHANNELS;
exports.toChannels = toChannels;

/**
 * Test-only. Empties the "already warned" set.
 *
 * ⚠️ `warnOnce` is module state, so without this the **first** test to provoke a
 * failure silences every later one — and a test asserting "it warned" would then
 * pass or fail on the order the file happens to run in. Worse, the test for
 * warn-*once* would pass trivially, because some earlier test had already used
 * up the one warning.
 */
exports.resetChannelWarningsForTests = () => warned.clear();
