const mongoose = require("mongoose");
const { connectTestDb, disconnectTestDb } = require("./testDb");

/**
 * Build every index once, before any test runs.
 *
 * The tests below are largely *about* indexes — a partial unique index that
 * rejects the second once-per-user redemption, another that must **not** reject
 * the second invoice-less transaction. Mongoose's `autoIndex` builds those in the
 * background after connecting, so a test that starts immediately can run against
 * a collection where the index does not exist yet, pass, and prove nothing.
 *
 * Awaiting `createIndexes()` here removes that race for the whole suite.
 *
 * `createIndexes`, never `syncIndexes` — the same rule as the migration script.
 * This is a real cluster and dropping every index not in the current schema is
 * not something a test setup should ever do.
 */
module.exports = async () => {
  await connectTestDb();

  const models = [
    require("../../../models/Transaction"),
    require("../../../models/VoucherUsage"),
    require("../../../models/VoucherClaim"),
    require("../../../models/VoucherClaimHistory"),
    require("../../../models/LedgerEntry"),
    require("../../../models/PromoCode"),
    require("../../../models/PromoCodeUsage"),
    require("../../../models/WebhookEvent"),
    require("../../../models/JobLock"),
    require("../../../models/Counter"),
  ];

  for (const model of models) {
    await model.createIndexes();
  }

  console.log(`\n  money tests → ${mongoose.connection.name}\n`);
  await disconnectTestDb();
};
