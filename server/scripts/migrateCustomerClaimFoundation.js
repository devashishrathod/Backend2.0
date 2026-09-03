/**
 * One-off migration for the customer voucher-claim foundation (Phase 0).
 *
 * Why it is needed
 * ----------------
 * The `transactions` collection now serves **two** checkouts — vendor
 * subscriptions and customer voucher claims — discriminated by `purpose`, and
 * routed to one of two Razorpay accounts by `gatewayAccount`. Both are
 * `required: true`, and both are new. Every row written before they existed has
 * neither, which means:
 *
 *   - `buildTransactionFilter({ purpose: SUBSCRIPTION })` — which every
 *     subscription query now goes through — matches none of them. A vendor's
 *     payment history reads as empty.
 *   - Any `save()` on one of those documents fails validation.
 *
 * The same applies to `PromoCode.audience` and `PromoCodeUsage.audience`: a
 * Mongoose default applies on **write** only, so existing codes have no value
 * and an `{ audience: "VENDOR" }` query would find none of them.
 *
 * Indexes have the same shape of problem from the other direction. `autoIndex`
 * only ever *creates*; it never drops. A second index on the same key pattern
 * under a different name raises `IndexOptionsConflict` (code 85), which Mongoose
 * swallows on the `index` event — so the old index simply stays and the new one
 * silently never appears. `invoiceId_1` is the one that matters: non-sparse and
 * unique, it would reject the **second** transaction that has no invoice yet.
 *
 * What it does
 * ------------
 *  1. **Indexes** — creates the new named indexes, verifies each one is really
 *     there, and only then drops the legacy ones **by name**.
 *  2. **Transactions** — backfills `purpose`, `gatewayAccount`, and
 *     `settlementStage` for rows that predate them.
 *  3. **Promo codes** — backfills `audience` on codes and on ledger rows.
 *  4. **Settings** — materialises the `Setting.customer` blocks so the admin
 *     panel has something to render.
 *  5. **Report** — prints what is left, so a partial run is visible.
 *
 * Why not `syncIndexes()`
 * -----------------------
 * It would do steps 1 in one call, and it is the wrong tool: `syncIndexes()`
 * drops **every** index not in the current schema. Any index added by hand, by
 * an ops task, or by a branch that is not this one disappears without being
 * named. Dropping by name means the script can only remove indexes it was told
 * about, and an unexpected one is reported rather than deleted.
 *
 * Production is fresh
 * -------------------
 * The production database has never been launched, so on it this script finds
 * nothing to do and says so. It exists for **dev and staging**, which have real
 * rows written before any of this existed.
 *
 * Safe to re-run: every step is idempotent and reports zero on a second pass.
 *
 * Usage
 * -----
 *   node scripts/migrateCustomerClaimFoundation.js            # dry run, writes nothing
 *   node scripts/migrateCustomerClaimFoundation.js --apply    # actually write
 */

require("dotenv").config();
const dns = require("dns");
const mongoose = require("mongoose");

const Transaction = require("../models/Transaction");
const PromoCode = require("../models/PromoCode");
const PromoCodeUsage = require("../models/PromoCodeUsage");
const VoucherUsage = require("../models/VoucherUsage");
const VoucherClaim = require("../models/VoucherClaim");
const VoucherClaimHistory = require("../models/VoucherClaimHistory");
const LedgerEntry = require("../models/LedgerEntry");
const WebhookEvent = require("../models/WebhookEvent");
const Setting = require("../models/Setting");

const {
  TRANSACTION_PURPOSE,
  ACCOUNT_FOR_PURPOSE,
  SETTLEMENT_STAGE,
  TRANSACTION_INDEXES,
  LEGACY_TRANSACTION_INDEXES,
} = require("../constants/transaction");
const { PROMO_AUDIENCE } = require("../constants/promoCode");

const APPLY = process.argv.includes("--apply");

/**
 * Legacy indexes to remove, and the index that must exist before each is dropped.
 *
 * The guard is the point. Dropping `invoiceId_1` before its partial replacement
 * exists would leave the collection with **no** uniqueness on `invoiceId` at
 * all, and a duplicate invoice number issued in that window is not something a
 * later run can undo.
 */
const LEGACY_INDEXES = [
  {
    model: Transaction,
    drop: LEGACY_TRANSACTION_INDEXES.INVOICE_ID,
    requires: TRANSACTION_INDEXES.INVOICE_ID,
    why: "non-sparse unique — would reject the second transaction with no invoice yet",
  },
  {
    model: Transaction,
    drop: LEGACY_TRANSACTION_INDEXES.RAZORPAY_ORDER_ID,
    requires: TRANSACTION_INDEXES.RAZORPAY_ORDER_ID,
    why: "non-sparse unique — same problem for orders created without a gateway order",
  },
  {
    model: VoucherUsage,
    // Mongo's generated name for the old `{ voucherId, customerId }` unique index.
    drop: "voucherId_1_customerId_1",
    requires: "voucherUsage_oncePerUser",
    why: "replaced by a partial index scoped per offer and skipping reversed rows",
  },
];

/** Models whose indexes this migration is responsible for building. */
const INDEXED_MODELS = [
  Transaction,
  PromoCode,
  PromoCodeUsage,
  VoucherUsage,
  WebhookEvent,
  // New collections. Nothing to backfill, but their partial unique indexes are
  // what makes the claim flow race-safe, and `autoIndex` builds them in the
  // background where a first request can beat them.
  VoucherClaim,
  VoucherClaimHistory,
  LedgerEntry,
];

const connect = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      serverSelectionTimeoutMS: 20000,
    });
  } catch (error) {
    // The repo's own fallback: some networks refuse SRV lookups.
    if (!/querySrv|ECONNREFUSED|ENOTFOUND/i.test(error?.message || "")) throw error;
    console.log("⚠️  SRV DNS failed; retrying with public DNS...");
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
    await mongoose.connect(process.env.MONGO_URL, {
      serverSelectionTimeoutMS: 20000,
    });
  }
};

const indexNames = async (model) => {
  try {
    return (await model.collection.indexes()).map((i) => i.name);
  } catch (error) {
    // A collection that has never been written to does not exist yet.
    if (/ns does not exist|NamespaceNotFound/i.test(error?.message || "")) {
      return [];
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Step 1 — indexes
// ---------------------------------------------------------------------------
const migrateIndexes = async () => {
  console.log("\n1. Indexes");

  if (APPLY) {
    for (const model of INDEXED_MODELS) {
      // `createIndexes`, never `syncIndexes` — see the header. This only adds.
      await model.createIndexes();
    }
    console.log(`   built schema indexes on ${INDEXED_MODELS.length} collections`);
  } else {
    console.log(`   would build schema indexes on ${INDEXED_MODELS.length} collections`);
  }

  let dropped = 0;
  let blocked = 0;

  for (const entry of LEGACY_INDEXES) {
    const collection = entry.model.collection.collectionName;
    const present = await indexNames(entry.model);

    if (!present.includes(entry.drop)) {
      console.log(`   ⚪ ${collection}.${entry.drop} — already gone`);
      continue;
    }

    // The guard. Without the replacement in place, dropping is a downgrade.
    if (!present.includes(entry.requires)) {
      console.log(
        `   ⛔ ${collection}.${entry.drop} — NOT dropped: its replacement ${entry.requires} does not exist`,
      );
      console.log(`      ${entry.why}`);
      blocked++;
      continue;
    }

    if (!APPLY) {
      console.log(`   → would drop ${collection}.${entry.drop} (${entry.requires} verified present)`);
      dropped++;
      continue;
    }

    await entry.model.collection.dropIndex(entry.drop);
    console.log(`   ✅ dropped ${collection}.${entry.drop}`);
    dropped++;
  }

  // Anything on these collections that neither the schema nor this list knows
  // about. Reported, never dropped — an index this script did not create is not
  // this script's to remove.
  for (const model of INDEXED_MODELS) {
    const expected = new Set(
      model.schema.indexes().map(([, options]) => options?.name).filter(Boolean),
    );
    const legacyHere = new Set(
      LEGACY_INDEXES.filter((e) => e.model === model).map((e) => e.drop),
    );
    for (const name of await indexNames(model)) {
      if (name === "_id_") continue;
      if (expected.has(name)) continue;
      if (legacyHere.has(name)) continue;
      // Mongo-generated names for schema indexes declared without one are the
      // common case here and are perfectly fine; only shout about the rest.
      const looksGenerated = /_-?1(_|$)/.test(name);
      if (looksGenerated) continue;
      console.log(`   ℹ️  ${model.collection.collectionName}.${name} — unknown to this script, left alone`);
    }
  }

  return { dropped, blocked };
};

// ---------------------------------------------------------------------------
// Step 2 — transactions
// ---------------------------------------------------------------------------
const migrateTransactions = async () => {
  console.log("\n2. Transactions");

  // Every row that predates `purpose` is a subscription — voucher claims did not
  // exist. `gatewayAccount` follows from it rather than being guessed
  // separately, so the two can never disagree.
  const missingPurpose = { purpose: { $exists: false } };
  const purposeCount = await Transaction.countDocuments(missingPurpose);

  const missingAccount = { gatewayAccount: { $exists: false } };
  const accountCount = await Transaction.countDocuments(missingAccount);

  /**
   * `settlementStage` marks how far the settle pipeline got, so
   * `resumeIncompleteSettlements` can pick up a run that crashed mid-way.
   *
   * Old rows have no value, and `!= "COMPLETE"` is true of a missing field — so
   * left alone, every already-settled transaction on this database would look
   * like an interrupted one and be re-settled. Rows that are `verified: true`
   * genuinely did complete, so they are marked `COMPLETE` here.
   *
   * Unverified rows are left absent, which is correct: they are unpaid orders
   * and never entered the pipeline at all.
   */
  const missingStage = {
    verified: true,
    settlementStage: { $exists: false },
  };
  const stageCount = await Transaction.countDocuments(missingStage);

  console.log(`   purpose missing         ${purposeCount}`);
  console.log(`   gatewayAccount missing  ${accountCount}`);
  console.log(`   settled, no stage       ${stageCount}`);

  if (!APPLY) {
    if (purposeCount + accountCount + stageCount === 0) {
      console.log("   nothing to do");
    } else {
      console.log(
        `   → would set purpose=${TRANSACTION_PURPOSE.SUBSCRIPTION}, gatewayAccount=${ACCOUNT_FOR_PURPOSE[TRANSACTION_PURPOSE.SUBSCRIPTION]}, settlementStage=${SETTLEMENT_STAGE.COMPLETE}`,
      );
    }
    return { purposeCount, accountCount, stageCount };
  }

  if (purposeCount) {
    const r = await Transaction.updateMany(missingPurpose, {
      $set: { purpose: TRANSACTION_PURPOSE.SUBSCRIPTION },
    });
    console.log(`   ✅ purpose         -> SUBSCRIPTION  (${r.modifiedCount})`);
  }
  if (accountCount) {
    const r = await Transaction.updateMany(missingAccount, {
      $set: {
        gatewayAccount: ACCOUNT_FOR_PURPOSE[TRANSACTION_PURPOSE.SUBSCRIPTION],
      },
    });
    console.log(`   ✅ gatewayAccount  -> VENDOR        (${r.modifiedCount})`);
  }
  if (stageCount) {
    const r = await Transaction.updateMany(missingStage, {
      $set: { settlementStage: SETTLEMENT_STAGE.COMPLETE },
    });
    console.log(`   ✅ settlementStage -> COMPLETE      (${r.modifiedCount})`);
  }

  return { purposeCount, accountCount, stageCount };
};

// ---------------------------------------------------------------------------
// Step 3 — promo codes
// ---------------------------------------------------------------------------
const migratePromoCodes = async () => {
  console.log("\n3. Promo codes");

  // Everything that exists today is a vendor subscription code — the customer
  // audience is what this phase introduces.
  const filter = { audience: { $exists: false } };
  const codes = await PromoCode.countDocuments(filter);
  const usages = await PromoCodeUsage.countDocuments(filter);

  console.log(`   PromoCode.audience missing       ${codes}`);
  console.log(`   PromoCodeUsage.audience missing  ${usages}`);

  if (!APPLY) {
    if (codes + usages === 0) console.log("   nothing to do");
    else console.log(`   → would set audience=${PROMO_AUDIENCE.VENDOR} on both`);
    return { codes, usages };
  }

  if (codes) {
    const r = await PromoCode.updateMany(filter, {
      $set: { audience: PROMO_AUDIENCE.VENDOR },
    });
    console.log(`   ✅ PromoCode      -> VENDOR  (${r.modifiedCount})`);
  }
  if (usages) {
    const r = await PromoCodeUsage.updateMany(filter, {
      $set: { audience: PROMO_AUDIENCE.VENDOR },
    });
    console.log(`   ✅ PromoCodeUsage -> VENDOR  (${r.modifiedCount})`);
  }

  return { codes, usages };
};

// ---------------------------------------------------------------------------
// Step 4 — settings
// ---------------------------------------------------------------------------
const CUSTOMER_BLOCKS = [
  "convenienceFee",
  "tax",
  "promoCode",
  "claim",
  "notification",
  "invoice",
  "settlement",
  "refund",
  "chargeback",
];

const migrateSettings = async () => {
  console.log("\n4. Settings");

  /**
   * Read the **raw** document, not a hydrated one.
   *
   * Mongoose materialises sub-schema defaults on load, so `Setting.findOne()`
   * hands back a `customer` with all nine blocks filled in even when what is
   * stored is `customer: {}`. Checking the model would report nothing missing on
   * a database where nothing has ever been written — verified against this one.
   */
  const raw = await mongoose.connection.db.collection("settings").findOne({});
  if (!raw) {
    console.log("   no Setting document — it is created with full defaults on first read");
    return { missing: [] };
  }

  const missing = CUSTOMER_BLOCKS.filter((block) => !raw.customer?.[block]);
  console.log(
    `   Setting.customer blocks missing  ${missing.length}${missing.length ? ` (${missing.join(", ")})` : ""}`,
  );

  if (!missing.length) {
    console.log("   nothing to do");
    return { missing };
  }

  if (!APPLY) {
    console.log("   → would materialise them from the schema defaults");
    return { missing };
  }

  // Assigning `{}` lets the sub-schema fill in its own defaults, so the values
  // written here are exactly the ones `constants/customer.js` declares — no
  // second copy of them in this script to drift from the source.
  const setting = await Setting.findOne({});
  if (!setting.customer) setting.customer = {};
  for (const block of missing) setting.customer[block] = {};
  // `markModified` because assigning `{}` to a path whose hydrated value already
  // looked complete leaves Mongoose seeing no change to persist.
  setting.markModified("customer");
  await setting.save();

  console.log(`   ✅ materialised ${missing.length} block(s) from their schema defaults`);
  return { missing };
};

// ---------------------------------------------------------------------------
const run = async () => {
  await connect();
  console.log(
    APPLY
      ? "\n🚚 Customer claim foundation migration — APPLYING"
      : "\n🔍 Customer claim foundation migration — DRY RUN (nothing will be written)",
  );

  const indexes = await migrateIndexes();
  const transactions = await migrateTransactions();
  const promos = await migratePromoCodes();
  const settings = await migrateSettings();

  console.log("\n" + "─".repeat(60));

  const pending =
    transactions.purposeCount +
    transactions.accountCount +
    transactions.stageCount +
    promos.codes +
    promos.usages +
    settings.missing.length;

  if (!APPLY) {
    console.log(
      pending || indexes.dropped
        ? `\n🔍 Dry run: ${pending} document field(s) and ${indexes.dropped} index(es) would change.\n   Re-run with --apply to write.\n`
        : "\n✅ Dry run: nothing to migrate — this database is already up to date.\n",
    );
  } else {
    // Re-count rather than trusting the update results, so a partial write is
    // visible here rather than at the next 500.
    const left =
      (await Transaction.countDocuments({ purpose: { $exists: false } })) +
      (await Transaction.countDocuments({ gatewayAccount: { $exists: false } })) +
      (await PromoCode.countDocuments({ audience: { $exists: false } })) +
      (await PromoCodeUsage.countDocuments({ audience: { $exists: false } }));

    if (left) {
      console.log(`\n⚠️  Migration finished but ${left} document(s) still lack a required field.`);
      console.log("   Re-run to retry; if the number does not fall, inspect those rows by hand.\n");
    } else {
      console.log("\n✅ Migration complete. Every required field is populated.\n");
    }
  }

  if (indexes.blocked) {
    console.log(
      `⛔ ${indexes.blocked} legacy index(es) were NOT dropped because their replacement is missing.`,
    );
    console.log("   Run with --apply so the new indexes are built first, then re-run.\n");
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("\n❌ Migration failed:", error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
