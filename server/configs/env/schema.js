const Joi = require("joi");

/**
 * Every environment variable this server reads, and what a valid one looks like.
 *
 * ### Why a schema at all
 *
 * A missing variable used to be invisible until the code path that wanted it
 * ran for the first time — which can be weeks. And the failure was rarely an
 * error: `CLOUD_BASE_URL` unset makes `url.startsWith(undefined)` false, so
 * `deleteFile` logs "Skip delete" and returns, and **every media delete is
 * silently skipped** while the server answers 200 to everything. A schema turns
 * that into a failed deploy, which is the only version of the problem anybody
 * notices.
 *
 * ### `CONFIG_PROFILE`, not `NODE_ENV`
 *
 * The tier is named by `CONFIG_PROFILE`, which lives in the environment file
 * and therefore says what the file *is*. `NODE_ENV` comes from the shell and on
 * this machine is `production` on a laptop pointed at a development database
 * with Razorpay test keys — so anything that changed behaviour on it would be
 * wrong here, which is what `index.js` has said for a long time.
 *
 * ⚠️ `NODE_ENV` stays **lowercase** while every value we own is uppercase. It is
 * not our enum: npm reads `production` to skip devDependencies, and Express
 * compares `app.get("env")` against `"production"` to decide whether to hide
 * error stack traces from clients. `NODE_ENV=PRODUCTION` matches neither, so a
 * production server would leak stack traces while looking correctly configured.
 *
 * ### Adding a variable
 *
 * Add it here **and** to `.env.example`. `scripts/verifyEnvCoverage.js` fails a
 * commit where the two disagree, for the same reason `verifyApiCoverage` exists.
 */

const PROFILES = Object.freeze({
  DEVELOPMENT: "DEVELOPMENT",
  STAGING: "STAGING",
  PRODUCTION: "PRODUCTION",
});

/** Optional, and allowed to be written as an empty string. */
const optionalText = Joi.string().allow("").optional();

/** A secret: present or absent, never empty — an empty secret is a false sense of one. */
const secret = Joi.string().min(1);

const schema = Joi.object({
  // ── Tier ─────────────────────────────────────────────────────────────────
  CONFIG_PROFILE: Joi.string()
    .uppercase()
    .valid(...Object.values(PROFILES))
    .default(PROFILES.DEVELOPMENT),

  /**
   * ⚠️ Lowercase on purpose — see the note above. Only ever used to pick a log
   * format; nothing else may branch on it.
   */
  NODE_ENV: Joi.string()
    .lowercase()
    .valid("development", "staging", "production", "test")
    .default("development"),

  // ── Core ─────────────────────────────────────────────────────────────────
  /**
   * ⚠️ `0` is allowed and means something: Node reads it as "any free port",
   * which is how a server is started in a test or alongside a running one. A
   * `min(1)` here refuses that, and the failure reads as a broken environment
   * rather than a rule nobody meant to write.
   */
  PORT: Joi.number().integer().min(0).max(65535).default(8080),

  /** The database name is part of the path — the money tests derive theirs from it. */
  MONGO_URL: Joi.string().uri({ scheme: ["mongodb", "mongodb+srv"] }).required(),
  MONGO_AUTO_INDEX: Joi.boolean().default(true),
  MONGO_MAX_POOL_SIZE: Joi.number().integer().min(1).optional(),
  MONGO_MIN_POOL_SIZE: Joi.number().integer().min(0).optional(),
  MONGO_SERVER_SELECTION_TIMEOUT_MS: Joi.number().integer().min(1000).optional(),

  JWT_SECRET: secret.required(),
  JWT_EXPIRY: Joi.string().default("7d"),
  /** Seeded accounts only. Never a login path in production. */
  DEFAULT_PASSWORD: optionalText,

  // ── Public URLs ──────────────────────────────────────────────────────────
  // Unset means the corresponding notification button is omitted rather than
  // pointing somewhere wrong.
  ADMIN_PANEL_URL: Joi.string().uri().optional(),
  VENDOR_PANEL_URL: Joi.string().uri().optional(),
  PUBLIC_API_URL: Joi.string().uri().optional(),
  CUSTOMER_APP_URL: optionalText,

  // ── Razorpay — two separate merchants ────────────────────────────────────
  // Read through `process.env[...]` in `configs/razorpay.js`, so a plain search
  // for `process.env.RAZORPAY_VENDOR_KEY_ID` finds nothing. They are live.
  RAZORPAY_VENDOR_KEY_ID: Joi.string().pattern(/^rzp_(test|live)_/).optional(),
  RAZORPAY_VENDOR_SECRET: secret.optional(),
  RAZORPAY_CUSTOMER_KEY_ID: Joi.string().pattern(/^rzp_(test|live)_/).optional(),
  RAZORPAY_CUSTOMER_SECRET: secret.optional(),
  RAZORPAY_BASEURL: Joi.string().uri().optional(),
  /** Comma-separated, newest first — rotation without downtime. */
  RAZORPAY_WEBHOOK_SECRETS: optionalText,
  RAZORPAY_CUSTOMER_WEBHOOK_SECRETS: optionalText,
  /** The pre-rotation single value. Kept so an un-updated environment still verifies. */
  RAZORPAY_WEBHOOK_SECRET: optionalText,

  // ── Cloudinary ───────────────────────────────────────────────────────────
  CLOUD_NAME: optionalText,
  CLOUD_API_KEY: optionalText,
  CLOUD_SECRET: optionalText,
  /**
   * ⚠️ Load-bearing in a way its name does not suggest. `deleteFile` compares
   * every URL against it, and an unset value makes that comparison false for
   * everything — so deletes are skipped with a `console.log` and no error.
   */
  CLOUD_BASE_URL: Joi.string().uri().required(),
  /**
   * ⚠️ Nothing reads this. Kept rather than removed while the S3 migration is
   * open — see `docs/environment_and_services_map.md`.
   */
  CLOUDINARY_URL: optionalText,

  // ── Media provider ───────────────────────────────────────────────────────
  /**
   * Which provider **new** uploads go to.
   *
   * ⚠️ Only new ones. Deleting an existing asset follows that row's own
   * `storage.provider`, never this — otherwise flipping the switch would strand
   * every file uploaded before it.
   */
  MEDIA_PROVIDER: Joi.string()
    .uppercase()
    .valid("CLOUDINARY", "S3")
    .default("CLOUDINARY"),

  // ── AWS S3 ───────────────────────────────────────────────────────────────
  AWS_REGION: optionalText,
  /**
   * ⚠️ Credentials are deliberately **absent** from this schema.
   *
   * `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are read by the SDK's own
   * credential chain, not by us. On Render they come from the environment; on
   * EC2 there are no keys at all and the SDK reads the instance role. Requiring
   * them here would make the correct production setup — no keys — fail to boot.
   * See `docs/aws_s3_setup.md` §6.
   */
  S3_BUCKET_PUBLIC: optionalText,
  /** 🔴 Documents only. Block Public Access on, presigned GET only. */
  S3_BUCKET_PRIVATE: optionalText,
  /**
   * Key prefix for this tier: `dev/`, `staging/`, empty in production. It is
   * what lets development and staging share one bucket without sharing objects.
   */
  S3_PREFIX: Joi.string().allow("").default(""),
  /** CloudFront in front of the public bucket. Falls back to the S3 URL. */
  CDN_BASE_URL: Joi.string().uri().optional(),
  /**
   * ⚠️ Nothing reads these three, and the plan replaces them: media is split
   * public/private, not by role — an outlet video is uploaded by a vendor and
   * watched by a customer. Kept until that lands.
   */
  S3_BUCKET_ADMIN: optionalText,
  S3_BUCKET_CUSTOMER: optionalText,
  S3_BUCKET_VENDOR: optionalText,

  // ── Email ────────────────────────────────────────────────────────────────
  NODEMAILER_EMAIL: Joi.string().email().optional(),
  /** A Gmail app password, not the account password. */
  NODEMAILER_PASSWORD: optionalText,
  /** ⚠️ Nothing reads this. Kept, not removed. */
  NODEMAILER_APP_NAME: optionalText,

  // ── Push ─────────────────────────────────────────────────────────────────
  FCM_PROJECT_ID: optionalText,
  FCM_CLIENT_EMAIL: optionalText,
  /** Full PEM including the BEGIN/END lines, newlines written as `\n`. */
  FCM_PRIVATE_KEY: optionalText,

  // ── WhatsApp / SMS ───────────────────────────────────────────────────────
  TENDIGIT_BASEURL: Joi.string().uri().optional(),
  TENDIGIT_APIKEY: optionalText,
  TENDIGIT_LICENSE: optionalText,
  TENDIGIT_TEMPLATE_ID: optionalText,
  TWO_FACTOR_API_KEY: optionalText,
  /** Signs the OTP hash. Rotating it invalidates every OTP in flight. */
  OTP_HMAC_SECRET: secret.required(),

  // ── KYC ──────────────────────────────────────────────────────────────────
  CGPEY_BASE_URL: Joi.string().uri().optional(),
  CGPEY_MERCHANT_ID: optionalText,
  CGPEY_API_KEY: optionalText,
  CGPEY_SECRET_KEY: optionalText,
  CGPEY_PAN_ENDPOINT: optionalText,
  CGPEY_GST_ENDPOINT: optionalText,
  CGPEY_BANK_ENDPOINT: optionalText,
  CGPEY_TIMEOUT: Joi.number().integer().min(1000).default(15000),

  // ── Identifier salts ─────────────────────────────────────────────────────
  /**
   * ⚠️ Required, and read at **module load** by `generateBrandMerchantId` and
   * `validator/common`. Unset, `CHARSET[...]` throws `TypeError` — but only the
   * first time somebody creates a brand, which can be weeks after the deploy.
   * Changing one changes every id derived from it, so treat them as permanent.
   */
  MERCHANT_ID_SECRET: secret.required(),
  STORE_ID_SECRET: secret.required(),

  // ── Uploads ──────────────────────────────────────────────────────────────
  /** A ceiling that protects the process. Product limits live in `Setting`. */
  MAX_UPLOAD_SIZE_MB: Joi.number().integer().min(1).max(2048).default(100),

  // ── Runtime toggles ──────────────────────────────────────────────────────
  /**
   * ⚠️ How many proxies are in front. Trusting a hop that is not there means
   * believing an `X-Forwarded-For` the caller wrote, which walks past the rate
   * limiter entirely.
   */
  TRUST_PROXY: Joi.number().integer().min(0).max(10).default(1),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).default(3000),
  LOG_FORMAT: optionalText,
  /**
   * ⚠️ `false` on a laptop. There are 21 background jobs and they run against
   * whatever database this points at, sending real notifications.
   */
  ENABLE_JOBS: Joi.boolean().default(true),

  // ── Development only ─────────────────────────────────────────────────────
  ENABLE_NGROK: Joi.boolean().default(false),
  NGROK_AUTH_TOKEN: optionalText,
  NGROK_SUBDOMAIN: optionalText,

  // ── Test only ────────────────────────────────────────────────────────────
  TEST_DB_KEEP_CONNECTION: optionalText,
  TZ: optionalText,
})
  /**
   * ⚠️ Unknown keys pass. The process environment carries `PATH`, `HOME`, npm's
   * own variables and whatever the platform injects; failing on those would
   * mean this schema could never run anywhere real. Coverage of *our* variables
   * is enforced by `scripts/verifyEnvCoverage.js` instead, which compares this
   * file against `.env.example` and against what the code actually reads.
   */
  .unknown(true);

/**
 * Template names, one per notification type, read as
 * `process.env[`WHATSAPP_TEMPLATE_${type}`]`. Listed so `.env.example`
 * coverage can see them; an empty one means that notice is simply not sent on
 * WhatsApp, which is a supported state rather than a misconfiguration.
 */
const WHATSAPP_TEMPLATE_PREFIX = "WHATSAPP_TEMPLATE_";

module.exports = { schema, PROFILES, WHATSAPP_TEMPLATE_PREFIX };
