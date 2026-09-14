const { S3Client } = require("@aws-sdk/client-s3");

const { config } = require("./env");
const { STORAGE_BUCKET } = require("../constants/storage");
const { throwError } = require("../utils");

/**
 * The S3 client — one per process, built on first use.
 *
 * ### Why no credentials are passed
 *
 * The v3 SDK resolves them itself, in order: explicit → `AWS_ACCESS_KEY_ID` /
 * `AWS_SECRET_ACCESS_KEY` → shared config → ECS → EC2 instance metadata. Render
 * sets the environment variables and EC2 answers from instance metadata, so the
 * same single line is correct on both hosts and there is no branch to get wrong.
 *
 * 🔴 The order is also the trap. **Environment keys beat the instance role.**
 * Attaching a role on EC2 while leaving the old Render keys in the environment
 * leaves the server running happily on the wrong identity, until the day that
 * key is revoked and every upload starts failing with nothing in any log to say
 * why. `describeCredentialSource()` exists to make that visible at boot.
 *
 * Built lazily so that a deployment still on Cloudinary — no region, no buckets
 * — boots normally instead of dying on a client it will never use.
 */
let client = null;

const getS3Client = () => {
  if (client) return client;
  if (!config.AWS_REGION) {
    throwError(500, "AWS_REGION is not set, so S3 cannot be used.");
  }
  client = new S3Client({ region: config.AWS_REGION });
  return client;
};

/** Only for tests, which need a clean client between cases. */
const resetS3Client = () => {
  client = null;
};

const BUCKET_VAR = Object.freeze({
  [STORAGE_BUCKET.PUBLIC]: "S3_BUCKET_PUBLIC",
  [STORAGE_BUCKET.PRIVATE]: "S3_BUCKET_PRIVATE",
});

/**
 * The bucket name for PUBLIC or PRIVATE.
 *
 * Missing is an error, not a default. Falling back to the other bucket would
 * put invoices — name, address, GSTIN, amount — behind a CDN.
 */
const bucketName = (bucket) => {
  const variable = BUCKET_VAR[bucket];
  if (!variable) throwError(500, `Unknown storage bucket: ${bucket}`);

  const name = config[variable];
  if (!name) throwError(500, `${variable} is not set, so S3 cannot be used.`);
  return name;
};

/**
 * Which identity the SDK is about to use, in a form that is safe to print.
 *
 * Only the last four characters of a key id, which is enough to tell two keys
 * apart when deciding whether the one in the environment is the stale one.
 */
const describeCredentialSource = () => {
  const keyId = process.env.AWS_ACCESS_KEY_ID;
  if (!keyId) return { source: "instance role or shared config", stale: false };
  return {
    source: `environment key (…${String(keyId).slice(-4)})`,
    stale: true,
  };
};

/**
 * One line at boot, in the shape `logPaymentAccounts()` established.
 *
 * Silent when S3 is not configured at all — that is a Cloudinary deployment,
 * not a misconfigured one.
 */
const logS3Config = () => {
  if (!config.S3_BUCKET_PUBLIC && !config.S3_BUCKET_PRIVATE) return;

  const { source, stale } = describeCredentialSource();
  const buckets = [config.S3_BUCKET_PUBLIC, config.S3_BUCKET_PRIVATE]
    .filter(Boolean)
    .join(" / ");
  const where = config.S3_PREFIX ? ` · prefix ${config.S3_PREFIX}` : "";

  console.log(
    `${stale && config.isProduction ? "⚠️ " : "✅ "}[s3] ${buckets} · ` +
      `${config.AWS_REGION || "no region"}${where} · credentials: ${source}`,
  );

  if (stale && config.isProduction) {
    console.warn(
      "   Production is using an access key from the environment rather than " +
        "an instance role.\n" +
        "   If this host has a role attached, delete AWS_ACCESS_KEY_ID and " +
        "AWS_SECRET_ACCESS_KEY —\n" +
        "   environment keys win over the role, and this one stops working the " +
        "day it is revoked.",
    );
  }
};

module.exports = {
  getS3Client,
  resetS3Client,
  bucketName,
  describeCredentialSource,
  logS3Config,
};
