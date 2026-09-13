const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const { schema, PROFILES } = require("./schema");

const SERVER_ROOT = path.join(__dirname, "..", "..");

/**
 * Read the environment, prove it, and refuse to continue if it is wrong.
 *
 * Runs once, before anything else is required, because eleven modules read
 * `process.env` at **load time** — `MERCHANT_ID_SECRET`, `CLOUD_BASE_URL`,
 * `TWO_FACTOR_API_KEY` and the rest. A value that arrives after they have been
 * required is a value they never see.
 */

/** Never let a credential reach a log, a terminal, or a paste buffer. */
const redact = (uri) => String(uri ?? "").replace(/\/\/[^@]*@/, "//***:***@");

const fail = (title, lines) => {
  console.error("");
  console.error(`❌ ${title}`);
  for (const line of lines) console.error(`   ${line}`);
  console.error("");
  console.error("   Nothing is listening, on purpose — a server that starts on a");
  console.error("   bad environment fails later, somewhere less obvious.");
  console.error("");
  process.exit(1);
};

/**
 * Which tier this is.
 *
 * ⚠️ **Not `NODE_ENV`.** That comes from the shell, and on this machine it is
 * `production` on a laptop pointed at a development database with Razorpay test
 * keys. Keying the tier off it would mean the guards below fire on a developer's
 * machine and never where they matter. `CONFIG_PROFILE` lives in the env file,
 * so the file says what it is.
 */
const resolveProfile = () => {
  const raw = process.env.CONFIG_PROFILE;
  if (!raw) return PROFILES.DEVELOPMENT;

  const profile = String(raw).trim().toUpperCase();
  if (!PROFILES[profile]) {
    fail(`CONFIG_PROFILE is not a known profile: ${JSON.stringify(raw)}`, [
      `Expected one of: ${Object.values(PROFILES).join(", ")}`,
    ]);
  }
  return profile;
};

/**
 * `.env` is the base; `.env.<profile>` overlays it when present.
 *
 * ⚠️ Lowercase filenames against uppercase profile values, deliberately. The
 * value is ours and follows the repo's convention that enums shout;
 * `.env.production` is a path, and every tool that looks for one — dotenv's own
 * docs, deploy templates, `.gitignore` patterns — spells it in lower case.
 *
 * ⚠️ `override: true` on the overlay. dotenv's default is to keep whatever is
 * already set, which would make the more specific file lose to the general one.
 */
const loadFiles = (profile) => {
  const loaded = [];

  const base = path.join(SERVER_ROOT, ".env");
  if (fs.existsSync(base)) {
    dotenv.config({ path: base, quiet: true });
    loaded.push(".env");
  }

  const overlay = path.join(SERVER_ROOT, `.env.${profile.toLowerCase()}`);
  if (fs.existsSync(overlay)) {
    dotenv.config({ path: overlay, override: true, quiet: true });
    loaded.push(`.env.${profile.toLowerCase()}`);
  }

  return loaded;
};

/**
 * Guard 1 — something has to have set the environment.
 *
 * On a server the values come from the platform (Render's env vars, an EC2
 * instance's Secrets Manager) and there is no file at all, which is correct.
 * What is never correct is *neither*: no file and no `MONGO_URL` means the
 * process is about to invent defaults for a production database.
 */
const assertSomethingWasLoaded = (loaded) => {
  if (loaded.length) return;
  if (process.env.MONGO_URL) return;

  fail("No environment file, and no environment.", [
    `Looked for ${SERVER_ROOT}/.env`,
    "Copy .env.example to .env and fill it in, or set the variables on the host.",
  ]);
};

/**
 * Guard 2 — the file and the shell must agree about which tier this is.
 *
 * A shell exporting `CONFIG_PROFILE=PRODUCTION` while `.env` says
 * `DEVELOPMENT` is somebody half way through a deploy, and the half that wins
 * decides whether Guard 3 runs at all.
 */
const assertProfileAgrees = (profile) => {
  const fromEnv = process.env.CONFIG_PROFILE;
  if (!fromEnv) return;

  const resolved = String(fromEnv).trim().toUpperCase();
  if (resolved !== profile) {
    fail("CONFIG_PROFILE disagrees with itself.", [
      `Resolved profile: ${profile}`,
      `After loading files: ${resolved}`,
      "One of the environment files sets a different profile than the shell does.",
    ]);
  }
};

/**
 * Guard 3 — production has to look like production.
 *
 * This is the one that catches the dangerous direction: a deploy that believes
 * it is production while still pointed at development infrastructure. Every
 * check is on a **value**, never on `NODE_ENV`, because the value is the thing
 * that would actually take the money.
 */
const assertProductionIsProduction = (env) => {
  if (env.CONFIG_PROFILE !== PROFILES.PRODUCTION) return;

  const problems = [];

  const dbName = (() => {
    try {
      return decodeURIComponent(new URL(env.MONGO_URL).pathname.replace(/^\//, ""));
    } catch {
      return "";
    }
  })();
  if (!dbName || !/prod/i.test(dbName)) {
    problems.push(
      `MONGO_URL names the database "${dbName || "(none)"}" — a production ` +
        `profile must point at a database whose name says so.`,
    );
  }

  for (const key of ["RAZORPAY_VENDOR_KEY_ID", "RAZORPAY_CUSTOMER_KEY_ID"]) {
    const value = env[key];
    if (value && !String(value).startsWith("rzp_live_")) {
      problems.push(`${key} is a test key (${String(value).slice(0, 9)}…).`);
    }
  }

  for (const key of ["S3_BUCKET_ADMIN", "S3_BUCKET_CUSTOMER", "S3_BUCKET_VENDOR"]) {
    const value = env[key];
    if (value && !/prod/i.test(value)) {
      problems.push(`${key} is "${value}" — not a production bucket.`);
    }
  }

  if (problems.length) {
    fail("CONFIG_PROFILE is PRODUCTION, but the environment is not.", [
      ...problems,
      "",
      "Either point this at production infrastructure, or set",
      "CONFIG_PROFILE=DEVELOPMENT (or STAGING) for this machine.",
    ]);
  }
};

/**
 * Validated values go back into `process.env` as strings.
 *
 * ⚠️ Without this the schema's defaults would exist only inside the returned
 * object, and the sixty-odd call sites that still read `process.env` directly
 * would see `undefined` where the schema says `3000`. Migrating those is
 * mechanical and happens per domain; this makes the schema true for them today,
 * so a default is a default everywhere rather than only where somebody
 * remembered to use the new reader.
 */
const writeBack = (value) => {
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined || v === null) continue;
    process.env[key] = String(v);
  }
};

exports.loadEnvironment = () => {
  const profileBeforeFiles = process.env.CONFIG_PROFILE;
  const loaded = loadFiles(resolveProfile());
  assertSomethingWasLoaded(loaded);

  const profile = resolveProfile();
  if (profileBeforeFiles) assertProfileAgrees(profile);

  const { value, error } = schema.validate(
    { ...process.env, CONFIG_PROFILE: profile },
    {
      // Every problem at once. Fixing one variable per deploy is how a bad
      // environment takes an afternoon.
      abortEarly: false,
      convert: true,
      stripUnknown: false,
    },
  );

  if (error) {
    fail("The environment is not valid.", [
      // ⚠️ Names only. A Joi message quotes the offending value by default, and
      // for a secret that puts it in the deploy log.
      ...error.details.map((d) => `${d.path.join(".")}: ${d.type}`),
      "",
      "See .env.example for what each one is.",
    ]);
  }

  assertProductionIsProduction(value);
  writeBack(value);

  return Object.freeze({
    ...value,
    // Convenience, so a reader never has to remember which spelling is ours.
    isProduction: value.CONFIG_PROFILE === PROFILES.PRODUCTION,
    isStaging: value.CONFIG_PROFILE === PROFILES.STAGING,
    isDevelopment: value.CONFIG_PROFILE === PROFILES.DEVELOPMENT,
    loadedFiles: loaded,
  });
};

exports.redact = redact;
