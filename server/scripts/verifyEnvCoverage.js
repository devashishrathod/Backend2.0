/**
 * ---------- three lists of environment variables, and they must agree ----------
 *
 * There are three places a variable has to appear, and nothing made them match:
 *
 *   1. the **code** that reads it
 *   2. **`.env.example`**, the only place a new developer can learn it exists
 *   3. **`configs/env/schema.js`**, which decides whether a boot is allowed
 *
 * A variable the code reads but the schema does not know is unvalidated: it can
 * be absent, empty or nonsense and the server starts anyway. One in
 * `.env.example` that nothing reads is a person setting a value that does
 * nothing. One the schema requires but nobody documents is a deploy that fails
 * with a name the operator has never seen.
 *
 * Measured before this existed: ten variables the code read were missing from
 * `.env.example`, including `TRUST_PROXY` — where a wrong value walks straight
 * past the rate limiter — and `ENABLE_JOBS`, which on a laptop runs twenty-one
 * background jobs against the shared development database.
 *
 * Same idea as `verifyApiCoverage.js`, applied to configuration instead of
 * routes.
 *
 *     node scripts/verifyEnvCoverage.js
 *
 * Exits non-zero when the three disagree, so `.githooks/pre-commit` can run it.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { schema } = require("../configs/env/schema");

/**
 * ⚠️ Some variables are read through a computed key and a text search cannot
 * see them. They are named here rather than guessed at, because the alternative
 * — treating them as unused — is what made an earlier pass of this report
 * twenty-eight dead variables when only six were.
 *
 *   `configs/razorpay.js`  reads `process.env[account.keyIdEnv]`
 *   `configs/whatsapp.js`  reads a key built from the notification type
 */
const READ_INDIRECTLY = Object.freeze([
  "RAZORPAY_VENDOR_KEY_ID",
  "RAZORPAY_VENDOR_SECRET",
  "RAZORPAY_CUSTOMER_KEY_ID",
  "RAZORPAY_CUSTOMER_SECRET",
  "RAZORPAY_WEBHOOK_SECRETS",
  "RAZORPAY_CUSTOMER_WEBHOOK_SECRETS",
  "RAZORPAY_WEBHOOK_SECRET",
]);

/** Prefix whose members are all read through a computed key. */
const DYNAMIC_PREFIXES = Object.freeze(["WHATSAPP_TEMPLATE_"]);

/**
 * Declared on purpose while nothing reads them yet. Each is an open decision
 * rather than an oversight — see `docs/environment_and_services_map.md`.
 */
const DECLARED_UNUSED = Object.freeze({
  CLOUDINARY_URL: "the SDK's URL form — unused; kept while the S3 migration is open",
  NODEMAILER_APP_NAME: "unused",
  S3_BUCKET_ADMIN: "replaced by a public/private split in the S3 plan",
  S3_BUCKET_CUSTOMER: "replaced by a public/private split in the S3 plan",
  S3_BUCKET_VENDOR: "replaced by a public/private split in the S3 plan",
  AWS_REGION: "for the S3 migration",
});

// `DEFAULT_PASSWORD` and `NODE_ENV` used to sit in the list above. Both are
// read — the first by the seed scripts, the second by the log-format choice —
// and their own notes said so while the list claimed they were unread.

/** Read by code, and deliberately not in the schema. Empty for now. */
const UNVALIDATED = Object.freeze({});

const isDynamic = (key) => DYNAMIC_PREFIXES.some((p) => key.startsWith(p));

/**
 * ⚠️ Two spellings both count as a read, and missing the second is a trap.
 *
 * `process.env.PORT` is the old way; `config.PORT` is the new one. A file
 * migrated to the config layer stops matching a search for `process.env` — so a
 * check that looked only for that would report every migrated variable as dead,
 * and press somebody into deleting a value the server depends on. The migration
 * is deliberately gradual, so both spellings stay live for a long time.
 */
const ENV_READ = /process\.env\.([A-Z0-9_]+)/g;
const CONFIG_READ = /\bconfig\.([A-Z][A-Z0-9_]+)\b/g;

const readByCode = () => {
  const found = new Set();
  const configLayer = path.join("configs", "env");

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", "coverage"].includes(entry.name)) continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!entry.name.endsWith(".js")) continue;

      const src = fs.readFileSync(p, "utf8");
      for (const m of src.matchAll(ENV_READ)) found.add(m[1]);
      // The config layer's own files are skipped, or every key would look read
      // by virtue of being declared there.
      if (!p.includes(configLayer)) {
        for (const m of src.matchAll(CONFIG_READ)) found.add(m[1]);
      }
    }
  };

  walk(ROOT);
  for (const key of READ_INDIRECTLY) found.add(key);
  return found;
};

const declaredInExample = () =>
  new Set(
    fs
      .readFileSync(path.join(ROOT, ".env.example"), "utf8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => l.split("=")[0]),
  );

const knownToSchema = () => new Set(Object.keys(schema.describe().keys ?? {}));

const report = (label, keys, note) => {
  console.log(`\n${keys.length ? "❌" : "✅"} ${label}: ${keys.length}`);
  if (!keys.length) return;
  for (const k of keys.sort()) console.log(`     ${k}`);
  if (note) console.log(`   ${note}`);
};

const main = () => {
  const code = readByCode();
  const example = declaredInExample();
  const schemaKeys = knownToSchema();

  console.log("\nenvironment coverage\n" + "─".repeat(60));
  console.log(`  read by code       : ${code.size}`);
  console.log(`  in .env.example    : ${example.size}`);
  console.log(`  in schema.js       : ${schemaKeys.size}`);

  const codeNotInExample = [...code].filter(
    (k) => !example.has(k) && !isDynamic(k),
  );
  const codeNotInSchema = [...code].filter(
    (k) => !schemaKeys.has(k) && !isDynamic(k) && !Object.hasOwn(UNVALIDATED, k),
  );
  /**
   * ⚠️ An exemption that has gone stale is worse than no exemption: it states
   * something about the code that is no longer true, and nothing else would
   * ever say so. `AWS_REGION` sat in `DECLARED_UNUSED` reading "for the S3
   * migration" for a while after `configs/s3.js` started reading it.
   */
  const staleExemptions = Object.keys(DECLARED_UNUSED).filter((k) =>
    code.has(k),
  );
  const exampleNotRead = [...example].filter(
    (k) =>
      !code.has(k) &&
      !isDynamic(k) &&
      !Object.hasOwn(DECLARED_UNUSED, k) &&
      // Documented for the operator, read by a library rather than by us.
      !Object.hasOwn(UNVALIDATED, k),
  );
  const schemaNotInExample = [...schemaKeys].filter((k) => !example.has(k));

  report(
    "read by code, missing from .env.example",
    codeNotInExample,
    "A reader has no other way to learn these exist.",
  );
  report(
    "read by code, missing from schema.js",
    codeNotInSchema,
    "These are never validated — absent, empty or nonsense all boot fine.",
  );
  report(
    "in schema.js, missing from .env.example",
    schemaNotInExample,
    "The schema may refuse a boot for a name nobody has documented.",
  );
  report(
    "in .env.example, read by nothing",
    exampleNotRead,
    "Somebody is setting a value that does nothing. Add it to DECLARED_UNUSED " +
      "with a reason if that is deliberate.",
  );

  report(
    "listed as unread, but code reads them",
    staleExemptions,
    "Remove these from DECLARED_UNUSED — the note is now false.",
  );

  const unvalidated = Object.keys(UNVALIDATED).filter(
    (k) => code.has(k) || example.has(k),
  );
  if (unvalidated.length) {
    console.log(`\n⚪ read, deliberately unvalidated: ${unvalidated.length}`);
    for (const k of [...unvalidated].sort()) {
      console.log(`     ${k.padEnd(22)} ${UNVALIDATED[k]}`);
    }
  }

  const knownUnused = [...example].filter(
    (k) => Object.hasOwn(DECLARED_UNUSED, k) && !code.has(k),
  );
  if (knownUnused.length) {
    console.log(`\n⚪ declared but unread on purpose: ${knownUnused.length}`);
    for (const k of knownUnused.sort()) {
      console.log(`     ${k.padEnd(22)} ${DECLARED_UNUSED[k]}`);
    }
  }

  const dynamic = [...example].filter(isDynamic);
  if (dynamic.length) {
    console.log(
      `\n⚪ read through a computed key, invisible to a text search: ${dynamic.length}`,
    );
    console.log(`     ${DYNAMIC_PREFIXES.join(", ")}…`);
  }

  const failures =
    codeNotInExample.length +
    codeNotInSchema.length +
    schemaNotInExample.length +
    exampleNotRead.length +
    staleExemptions.length;

  console.log("\n" + "─".repeat(60));
  if (failures) {
    console.log(`❌ ${failures} disagreement(s) between the three lists.\n`);
    process.exitCode = 1;
  } else {
    console.log("✅ code, .env.example and schema.js agree.\n");
  }
};

main();
