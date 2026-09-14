const { loadEnvironment, redact } = require("./load");
const { PROFILES } = require("./schema");

/**
 * The validated environment, loaded once.
 *
 * ⚠️ **Require this before anything else**, including `express`. Eleven modules
 * read `process.env` at load time — `MERCHANT_ID_SECRET` in
 * `generateBrandMerchantId`, `CLOUD_BASE_URL` in `helpers/cloudinary`,
 * `TWO_FACTOR_API_KEY` in three OTP helpers — and a value that arrives after
 * they have been required is a value they never see. Those reads are why
 * `loadEnvironment` writes the validated result back into `process.env` rather
 * than only returning it.
 *
 *     const { config } = require("./configs/env");
 *     if (config.isProduction) …
 *
 * Migrating the remaining `process.env` call sites is mechanical and happens per
 * domain as each is touched. It is deliberately not a single sweep: sixty files
 * changed at once is how a typo ends up in a code path nobody runs for a month,
 * which is exactly the class of failure this layer exists to end.
 */
const config = loadEnvironment();

module.exports = { config, PROFILES, redact };
