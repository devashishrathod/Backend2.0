/**
 * Create every index the schemas declare, so `MONGO_AUTO_INDEX=false` is safe.
 *
 * ### Why this exists
 *
 * Mongoose builds indexes itself by default, which is convenient and costs more
 * than it looks: it re-checks every schema against the server the first time
 * each model is used — measured at 6.3s for five models with every index
 * **already present**, so roughly a minute of background round trips across the
 * 53 models here, competing with real traffic in exactly the window after a
 * deploy when there is most of it.
 *
 * Turning that off in production is the fix. Turning it off *without* a
 * deliberate way to create indexes is how a partial unique index quietly stops
 * existing — and the money paths depend on those for correctness, not speed:
 * `holdsUsageSlot`, `isOncePerTransaction`, the idempotency keys and
 * `ledger_type_dispute_unique` are what stop two rows that must never coexist
 * from both inserting. Nothing errors when one is missing. The second row is
 * simply accepted.
 *
 * So: run this, with `--apply`, as part of the deploy, before setting
 * `MONGO_AUTO_INDEX=false`.
 *
 *     node scripts/ensureIndexes.js            # what is missing
 *     node scripts/ensureIndexes.js --apply    # create it
 *
 * ### ⚠️ It never drops anything
 *
 * `syncIndexes()` would be the one-liner here, and it is forbidden in this repo:
 * it drops **every** index not in the current schema, including any added by
 * hand or by another branch, and names none of them on the way out. This reports
 * with `diffIndexes()` (read-only) and writes with `createIndexes()` (creates,
 * never drops). Anything listed under "extra" is left exactly where it is — read
 * it, decide, and drop it by name yourself.
 */
require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const MODELS_DIR = path.join(__dirname, "..", "models");

/** Never let a credential reach a log, a terminal, or a paste buffer. */
const redact = (uri) => String(uri).replace(/\/\/[^@]*@/, "//***:***@");

/**
 * Every file in `models/` that actually compiles a model. Four of them are
 * shared sub-schemas (`pricingSchema`, `validObjectId`, …) and export plain
 * objects, so the check is what the file exports, not what it is called.
 */
const loadModels = () =>
  fs
    .readdirSync(MODELS_DIR)
    .filter((file) => file.endsWith(".js"))
    .map((file) => require(path.join(MODELS_DIR, file)))
    .filter((exported) => typeof exported?.createIndexes === "function" && exported.modelName)
    .sort((a, b) => a.modelName.localeCompare(b.modelName));

(async () => {
  if (!process.env.MONGO_URL) {
    console.error("MONGO_URL is not set — nothing to connect to.");
    process.exit(1);
  }

  /**
   * `autoIndex: false` for this connection specifically. Otherwise requiring the
   * models below would start building indexes on its own, and a dry run would
   * quietly become a write.
   */
  await mongoose.connect(process.env.MONGO_URL, { autoIndex: false });

  console.log("cluster  :", redact(process.env.MONGO_URL));
  console.log("database :", mongoose.connection.name);
  console.log("mode     :", APPLY ? "APPLY — indexes will be created" : "dry run");
  console.log("");

  const models = loadModels();
  let missingTotal = 0;
  let extraTotal = 0;
  const failures = [];

  for (const model of models) {
    let toCreate = [];
    let toDrop = [];

    try {
      // Read-only. Returns what the schema has that the server does not, and
      // vice versa — it changes nothing by itself.
      ({ toCreate = [], toDrop = [] } = await model.diffIndexes());
    } catch (error) {
      failures.push({ model: model.modelName, message: error?.message });
      console.log(`❌ ${model.modelName.padEnd(24)} could not be read: ${error?.message}`);
      continue;
    }

    if (!toCreate.length && !toDrop.length) continue;

    missingTotal += toCreate.length;
    extraTotal += toDrop.length;

    console.log(`${model.modelName}`);
    for (const index of toCreate) {
      console.log(`   missing  ${JSON.stringify(index)}`);
    }
    for (const index of toDrop) {
      // Reported so it is visible, never acted on. See the header.
      console.log(`   extra    ${JSON.stringify(index)}  (left alone)`);
    }

    if (APPLY && toCreate.length) {
      try {
        await model.createIndexes();
        console.log(`   ✅ created ${toCreate.length}`);
      } catch (error) {
        failures.push({ model: model.modelName, message: error?.message });
        console.log(`   ❌ failed: ${error?.message}`);
      }
    }
  }

  console.log("");
  console.log(`models checked : ${models.length}`);
  console.log(`missing        : ${missingTotal}`);
  console.log(`extra          : ${extraTotal}  (never dropped by this script)`);

  if (failures.length) {
    console.log("");
    console.log("❌ Some models failed:");
    for (const failure of failures) console.log(`   ${failure.model}: ${failure.message}`);
  }

  if (!APPLY && missingTotal) {
    console.log("");
    console.log("🔍 Dry run. Re-run with --apply to create the missing indexes.");
  }

  if (APPLY && !failures.length && !missingTotal) {
    console.log("");
    console.log("✅ Nothing missing — MONGO_AUTO_INDEX=false is safe on this database.");
  }

  await mongoose.disconnect();

  // A deploy step that half-worked must not be reported as success.
  process.exit(failures.length ? 1 : 0);
})().catch(async (error) => {
  console.error("ensureIndexes failed:", error?.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
