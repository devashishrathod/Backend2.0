/**
 * Phase S1 foundation — refund request storage.
 *
 * Dry-run by default, like every script here:
 *
 *   node scripts/migrateRefundFoundation.js           # what would change
 *   node scripts/migrateRefundFoundation.js --apply   # change it
 *
 * ⚠️ Never `syncIndexes()`. It drops **every** index not in the current schema —
 * including ones added by hand or by another branch — and names none of them on
 * the way out. Everything here is dropped by name, and only after the
 * replacement is confirmed present.
 */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const dns = require("dns");

const Transaction = require("../models/Transaction");
const RefundRequest = require("../models/RefundRequest");
const { REFUND_INDEXES } = require("../constants/refund");

const APPLY = process.argv.includes("--apply");

const log = (line) => console.log(line);

/**
 * The repo's own connect — some networks here refuse SRV lookups outright, and
 * `database/mongoDb.js`, `__tests__/money/setup/testDb.js` and
 * `migrateCustomerClaimFoundation.js` all carry the same fallback. A script
 * without it simply cannot run on this machine.
 */
const connect = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      serverSelectionTimeoutMS: 20000,
    });
  } catch (error) {
    if (!/querySrv|ECONNREFUSED|ENOTFOUND/i.test(error?.message || "")) throw error;
    console.log("⚠️  SRV DNS failed; retrying with public DNS...");
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
    await mongoose.connect(process.env.MONGO_URL, {
      serverSelectionTimeoutMS: 20000,
    });
  }
};

const run = async () => {
  await connect();
  log(`📦 ${mongoose.connection.name}\n`);

  let fieldChanges = 0;
  let indexChanges = 0;

  // ---------------------------------------------------------------------
  // 1. refundId → latestRefundRequestId
  // ---------------------------------------------------------------------
  /**
   * The old field ref'd a `Refund` model that never existed, and nothing ever
   * wrote to it — so this is expected to find zero rows. It runs anyway,
   * because "nothing writes it" is a claim about the code we have, and a row
   * written by an older build would otherwise sit unreachable behind a field
   * name nothing reads.
   */
  const withOldField = await Transaction.collection.countDocuments({
    refundId: { $exists: true },
  });

  if (withOldField) {
    log(`   refundId → latestRefundRequestId: ${withOldField} row(s)`);
    fieldChanges += withOldField;
    if (APPLY) {
      // Only where the new field is not already set, so a re-run cannot
      // overwrite a newer pointer with a stale one.
      await Transaction.collection.updateMany(
        { refundId: { $exists: true }, latestRefundRequestId: { $exists: false } },
        { $rename: { refundId: "latestRefundRequestId" } },
      );
      await Transaction.collection.updateMany(
        { refundId: { $exists: true } },
        { $unset: { refundId: "" } },
      );
    }
  } else {
    log("   refundId → latestRefundRequestId: nothing to move");
  }

  // ---------------------------------------------------------------------
  // 2. refundStatus: PARTIAL is now a real state
  // ---------------------------------------------------------------------
  /**
   * ⚠️ Rows written before `PARTIAL` existed said `COMPLETED` for a partial
   * refund, because `COMPLETED` was the only success value there was. Left
   * alone they read as fully refunded forever: settlement skips them and the
   * balance still owed to the vendor is invisible.
   *
   * Detected by comparing against `paidAmount` rather than trusting the status.
   */
  const wronglyCompleted = await Transaction.collection
    .aggregate([
      {
        $match: {
          refundStatus: "COMPLETED",
          amountRefunded: { $gt: 0 },
          isDeleted: { $ne: true },
        },
      },
      {
        $match: {
          $expr: { $lt: ["$amountRefunded", { $ifNull: ["$paidAmount", 0] }] },
        },
      },
      { $project: { _id: 1, amountRefunded: 1, paidAmount: 1 } },
    ])
    .toArray();

  if (wronglyCompleted.length) {
    log(
      `   ⚠️  refundStatus COMPLETED but only partly refunded: ${wronglyCompleted.length} row(s)`,
    );
    for (const row of wronglyCompleted.slice(0, 5)) {
      log(`        ${row._id}  ₹${row.amountRefunded} of ₹${row.paidAmount}`);
    }
    fieldChanges += wronglyCompleted.length;
    if (APPLY) {
      await Transaction.collection.updateMany(
        { _id: { $in: wronglyCompleted.map((r) => r._id) } },
        { $set: { refundStatus: "PARTIAL", isRefunded: false } },
      );
    }
  } else {
    log("   refundStatus PARTIAL backfill: nothing to correct");
  }

  // ---------------------------------------------------------------------
  // 3. RefundRequest indexes
  // ---------------------------------------------------------------------
  const existing = await RefundRequest.collection
    .listIndexes()
    .toArray()
    .catch(() => []);
  const byName = new Map(existing.map((i) => [i.name, i]));

  const required = [
    REFUND_INDEXES.ONE_OPEN_PER_TRANSACTION,
    REFUND_INDEXES.RAZORPAY_REFUND,
  ];
  const missing = required.filter((name) => !byName.has(name));

  if (missing.length) {
    log(`   indexes to build: ${missing.join(", ")}`);
    indexChanges += missing.length;
    if (APPLY) await RefundRequest.createIndexes();
  } else {
    log("   indexes: all present");
  }

  /**
   * ⚠️ The blanket-unique trap, checked here too.
   *
   * A path-level `unique: true` makes Mongo derive `<field>_1` with no partial
   * filter, and that index rejects the **second** row with no value. On this
   * collection that would reject the second refund request ever created before
   * execution — both carrying no `razorpayRefundId`.
   *
   * Reported, never dropped automatically: dropping an index somebody added on
   * purpose is not this script's decision.
   */
  const blanket = existing.filter(
    (i) => i.unique && !i.partialFilterExpression && i.name !== "_id_",
  );
  if (blanket.length) {
    log(
      `   ⚠️  blanket unique index(es) with no partial filter: ${blanket
        .map((i) => i.name)
        .join(", ")} — these reject the second row with no value`,
    );
  }

  log(
    `\n${APPLY ? "✅ Applied" : "🔍 Dry run"}: ${fieldChanges} document field(s) and ${
      indexChanges
    } index(es) ${APPLY ? "changed" : "would change"}.`,
  );
  if (!APPLY) log("   Re-run with --apply to write.");

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("❌", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
