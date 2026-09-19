/**
 * Print the indexes a model actually has **in the test database**.
 *
 * The money suite's guarantees are largely index-enforced — a partial unique
 * index that rejects the second redemption, a unique key that lets exactly one
 * concurrent OTP send through. When one of those tests fails, the first question
 * is whether the index it relies on is there at all, and reading it beats
 * guessing.
 *
 *     node scripts/showTestIndexes.js OtpThrottle
 *     node scripts/showTestIndexes.js OtpThrottle Voucher VoucherClaim
 */
require("dotenv").config({ quiet: true });

const {
  connectTestDb,
  disconnectTestDb,
} = require("../__tests__/money/setup/testDb");

const names = process.argv.slice(2);

(async () => {
  if (!names.length) {
    console.log("Usage: node scripts/showTestIndexes.js <ModelName> [...]");
    return;
  }

  await connectTestDb();

  for (const name of names) {
    const model = require(`../models/${name}`);
    let indexes;
    try {
      indexes = await model.collection.indexes();
    } catch (error) {
      console.log(`\n${name}: no collection yet (${error.message})`);
      continue;
    }

    console.log(`\n${name}`);
    for (const index of indexes) {
      const flags = [
        index.unique ? "unique" : null,
        index.partialFilterExpression
          ? `partial ${JSON.stringify(index.partialFilterExpression)}`
          : null,
        index.expireAfterSeconds != null
          ? `ttl ${index.expireAfterSeconds}s`
          : null,
      ].filter(Boolean);

      console.log(
        `  ${index.name}  ${JSON.stringify(index.key)}${flags.length ? `  [${flags.join(", ")}]` : ""}`,
      );
    }
  }

  await disconnectTestDb();
})().catch(async (error) => {
  console.error("Failed:", error.message);
  await disconnectTestDb().catch(() => {});
  process.exit(1);
});
