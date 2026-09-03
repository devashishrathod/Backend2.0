const mongoose = require("mongoose");
const os = require("os");
const { connectTestDb, disconnectTestDb } = require("./testDb");

/**
 * One test run at a time, per database.
 *
 * ⚠️ `maxWorkers: 1` stops two workers colliding **inside** one run. It does
 * nothing about two runs: every file shares one database on a real cluster, and
 * a second `npx jest` started while the first is still going has its own
 * `beforeEach` clearing collections the first is mid-way through using.
 *
 * The result is not a clean failure. It is a scatter of unrelated tests failing
 * on assertions that are individually correct — and then passing when re-run
 * alone, which reads as flakiness and sends you looking in the wrong place. It
 * cost two separate debugging detours before the cause was obvious.
 *
 * So the run takes a lock. A second run is told plainly what is happening rather
 * than quietly corrupting both.
 */
const { LOCK_ID, COLLECTION, TTL_MS: LOCK_TTL_MS } = require("./runLock");

const acquireRunLock = async () => {
  const collection = mongoose.connection.db.collection(COLLECTION);
  const owner = `${os.hostname()}:${process.pid}`;
  const now = new Date();

  try {
    await collection.updateOne(
      {
        _id: LOCK_ID,
        // Free, or held by a run that died without releasing. A stale lock must
        // not block the suite for ever.
        $or: [
          { owner: null },
          { expiresAt: { $lte: now } },
        ],
      },
      { $set: { owner, startedAt: now, expiresAt: new Date(Date.now() + LOCK_TTL_MS) } },
      { upsert: true },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const held = await collection.findOne({ _id: LOCK_ID });
    throw new Error(
      `Another money-test run is already using ${mongoose.connection.name} ` +
        `(${held?.owner}, started ${held?.startedAt?.toISOString?.() || "?"}).
` +
        `  They share one database, so running both corrupts each other's fixtures ` +
        `and produces failures that look like real bugs.
` +
        `  Wait for it, or clear the lock: db.testrunlocks.deleteOne({_id:"${LOCK_ID}"})`,
    );
  }

  const held = await collection.findOne({ _id: LOCK_ID });
  if (held?.owner !== owner) {
    throw new Error(
      `Another money-test run holds ${mongoose.connection.name} (${held?.owner}).`,
    );
  }
};

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
  await acquireRunLock();

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
