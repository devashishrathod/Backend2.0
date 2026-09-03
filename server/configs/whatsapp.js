const { NOTIFICATION_TYPES } = require("../constants/notification");

/**
 * WhatsApp Business delivery, through the TENDIGIT provider already used for OTP.
 *
 * Credentials are shared with OTP (`TENDIGIT_*`) because it is the same account.
 * What is *not* shared is the template: OTP has one fixed template, while
 * WhatsApp Business requires a **separate pre-approved template per message
 * type**, submitted through the provider and approved by Meta.
 *
 * So templates are resolved per notification type from the environment:
 *
 *   WHATSAPP_TEMPLATE_SUBSCRIPTION_ACTIVATED=trydood_sub_activated
 *   WHATSAPP_TEMPLATE_SUBSCRIPTION_EXPIRING=trydood_sub_expiring
 *   ...one per type you have an approved template for
 *
 * A type with no template set simply does not send on WhatsApp — the in-app row
 * and the email still go out. That is what makes this safe to ship before every
 * template is approved: templates can be switched on one at a time, by adding an
 * env var, with no code change and no redeploy of logic.
 *
 * Adding a notification type later needs nothing here either — the key name is
 * derived from the type itself.
 */
const CREDENTIALS = Object.freeze({
  urlBase: process.env.TENDIGIT_BASEURL || null,
  licenseNumber: process.env.TENDIGIT_LICENSE || null,
  apiKey: process.env.TENDIGIT_APIKEY || null,
});

/** The env var holding the approved template name for a notification type. */
const templateEnvKey = (type) => `WHATSAPP_TEMPLATE_${type}`;

/**
 * The approved template name for this notification type, or null.
 *
 * Read at call time rather than frozen at boot, so a template can be added to the
 * environment and picked up on the next restart without touching this file, and
 * so tests can set one without reloading the module.
 */
const templateFor = (type) => {
  const value = process.env[templateEnvKey(type)];
  return value && String(value).trim() ? String(value).trim() : null;
};

/** True when the provider account is configured. Says nothing about templates. */
const isWhatsAppConfigured = () =>
  Boolean(CREDENTIALS.urlBase && CREDENTIALS.licenseNumber && CREDENTIALS.apiKey);

/**
 * Which notification types currently have an approved template.
 *
 * Exposed so a health check can answer "what will actually send on WhatsApp?"
 * without anyone having to read the environment by hand.
 */
const configuredTemplates = () =>
  Object.values(NOTIFICATION_TYPES)
    .filter((type) => templateFor(type))
    .map((type) => ({ type, template: templateFor(type) }));

const WHATSAPP = Object.freeze({
  ...CREDENTIALS,
  // Provider variables are positional and single-line. Anything longer is
  // rejected by Meta, so params are trimmed to this before being sent.
  maxParamLength: 200,
  maxParams: 10,
  requestTimeoutMs: 10000,
});

module.exports = {
  WHATSAPP,
  templateFor,
  templateEnvKey,
  isWhatsAppConfigured,
  configuredTemplates,
};
