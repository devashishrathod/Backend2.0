/**
 * Soft-delete rows whose other half is gone.
 *
 *   node scripts/cleanupOrphans.js                 # what would change
 *   node scripts/cleanupOrphans.js --apply         # change it
 *   node scripts/cleanupOrphans.js --apply --force # even the ones carrying money
 *
 * ### Why this is separate from `auditOrphans.js`
 *
 * That script deliberately has no `--apply`: an orphan is a symptom, and the
 * right response depends entirely on its shape. A `User` with no `Customer` is
 * repaired on next login; a `Customer` with no `User` is unreachable; a claim
 * with no transaction is a money record that needs a person. A script that
 * "cleaned up" all three the same way would delete the one that mattered.
 *
 * This one handles the two shapes that were actually decided:
 *
 *   - **Brand → User**, where the owning account no longer exists. Nobody can
 *     sign in to these, so they can never trade and can never be repaired. They
 *     are, however, still `isActive: true` and `isDeleted: false` — and
 *     `getAllCustomerBrands` filters on exactly those two, **not** on
 *     `isApproved` (which nothing in the codebase ever writes). So they appear
 *     in the customer-facing brand directory as empty shells.
 *   - **SubBrand → Brand**, where the parent brand is gone. These are doubly
 *     orphaned here — their `userId` points at a missing user too.
 *
 * ⚠️ **Soft delete, never hard.** `isDeleted: true` is the repo-wide rule, and
 * it matters more than usual here: a hard delete would take the row's history
 * with it, and the history is the only remaining evidence of how the orphan
 * happened.
 *
 * ⚠️ **Refuses a row that carries money** unless `--force`. Zero of the eight
 * did when this was written — no settlements, no ledger rows, no unsettled
 * captured transactions; the "transactions" on three of them are historical
 * *subscription* payments the vendor made to us. But that is a fact about
 * today's data, not a property of the shape, and the next orphan might be
 * different.
 */
require("dotenv").config({ quiet: true });
const dns = require("dns");
const mongoose = require("mongoose");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const DB = flag("db") || null;

const log = (...a) => console.log(...a);

/** What would make a row unsafe to touch without a person looking. */
const MONEY = [
  ["settlements", "brandId"],
  ["ledgerentries", "brandId"],
  ["voucherclaims", "brandId"],
];

const run = async () => {
  const url = DB
    ? process.env.MONGO_URL.replace(/\/([A-Za-z0-9_-]+)(\?|$)/, `/${DB}$2`)
    : process.env.MONGO_URL;

  await mongoose.connect(url, { serverSelectionTimeoutMS: 30000 });
  const db = mongoose.connection.db;
  log(`\nConnected: ${mongoose.connection.name}${APPLY ? "" : "   (dry run)"}\n`);

  const col = (n) => db.collection(n);

  /** Rows in `from` whose `localField` points at a `to` row that is not there. */
  const findOrphans = async (from, localField, to) =>
    col(from)
      .aggregate([
        {
          $match: {
            [localField]: { $type: "objectId" },
            isDeleted: { $ne: true },
          },
        },
        { $lookup: { from: to, localField, foreignField: "_id", as: "_t" } },
        { $match: { _t: { $size: 0 } } },
        { $project: { _t: 0 } },
      ])
      .toArray();

  let touched = 0;
  let refused = 0;

  const sweep = async ({ label, from, localField, to, moneyKey }) => {
    const rows = await findOrphans(from, localField, to);
    log(`── ${label} — ${rows.length} orphan(s)\n`);
    if (!rows.length) return;

    for (const row of rows) {
      const carried = [];
      for (const [coll, field] of MONEY) {
        if (!moneyKey) break;
        const n = await col(coll).countDocuments({ [field]: row[moneyKey] });
        if (n) carried.push(`${coll}:${n}`);
      }

      const name = row.brandName || row.uniqueId || String(row._id);
      const money = carried.length ? `  💰 ${carried.join(" ")}` : "";

      if (carried.length && !FORCE) {
        refused += 1;
        log(`  ⏭️  ${String(row._id)}  ${name}${money}`);
        log("      refused — carries money. Re-run with --force if that is the decision.");
        continue;
      }

      touched += 1;
      log(`  ${APPLY ? "🗑️ " : "  "} ${String(row._id)}  ${name}${money}`);

      if (APPLY) {
        await col(from).updateOne(
          { _id: row._id },
          {
            $set: {
              isDeleted: true,
              // Why, in the row itself. An orphan cleaned up with no trace is
              // indistinguishable next month from one somebody deleted by hand.
              orphanCleanedAt: new Date(),
              orphanReason: `${localField} pointed at a ${to} row that no longer exists`,
            },
          },
        );
      }
    }
    log("");
  };

  await sweep({
    label: "Brand → User",
    from: "brands",
    localField: "userId",
    to: "users",
    moneyKey: "_id",
  });

  await sweep({
    label: "SubBrand → Brand",
    from: "subbrands",
    localField: "brandId",
    to: "brands",
  });

  /**
   * The number that actually mattered: how much of the customer-facing brand
   * directory was these. `getAllCustomerBrands` matches on exactly this pair.
   */
  const visible = await col("brands").countDocuments({
    isDeleted: false,
    isActive: true,
  });

  log("─".repeat(60));
  log(
    APPLY
      ? `✅ ${touched} row(s) soft-deleted${refused ? `, ${refused} refused` : ""}.`
      : `${touched} row(s) would be soft-deleted${refused ? `, ${refused} refused` : ""}. Re-run with --apply.`,
  );
  log(`   Customer brand directory now returns ${visible} brand(s).`);
  log("");
};

run()
  .catch((e) => {
    console.error("\nFAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  });
