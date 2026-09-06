/**
 * Find rows whose other half is missing.
 *
 *   node scripts/auditOrphans.js                      # report only
 *   node scripts/auditOrphans.js --detail             # + what is attached to each
 *   node scripts/auditOrphans.js --db Trydood2_postman
 *
 * ⚠️ **Read-only. There is no `--apply`, on purpose.**
 *
 * Every other script here writes with `--apply`; this one refuses to. An orphan
 * is a symptom, and the right response depends entirely on which shape it is: a
 * `User` with no `Customer` is repaired on next login by `repairRoleProfile`, a
 * `Customer` with no `User` is unreachable and probably wants deleting, and a
 * claim with no transaction is a money record that needs a person to look at it.
 * A script that "cleaned up" all three the same way would delete the one that
 * mattered.
 *
 * So this prints, counts, and names the first few of each. What to do with them
 * is a decision, and the decision needs the names.
 */
require("dotenv").config();
const dns = require("dns");
const mongoose = require("mongoose");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const DB = flag("db") || null;
const SHOW = Number.parseInt(flag("show") || "5", 10);
const DETAIL = args.includes("--detail");

const log = (...a) => console.log(...a);

const run = async () => {
  const url = DB
    ? process.env.MONGO_URL.replace(/\/([A-Za-z0-9_-]+)(\?|$)/, `/${DB}$2`)
    : process.env.MONGO_URL;

  await mongoose.connect(url, { serverSelectionTimeoutMS: 30000 });
  const db = mongoose.connection.db;
  log(`\nConnected: ${mongoose.connection.name}  (read-only audit)\n`);

  const col = (n) => db.collection(n);

  /**
   * A left-join count: rows in `from` whose `localField` points at a `to` row
   * that is not there.
   *
   * ⚠️ `localField` missing entirely is **not** an orphan — an OTP account with
   * no email, a claim with no settlement yet. Only a value that points nowhere
   * counts, which is why the pipeline matches on `$type: "objectId"` first.
   */
  const orphans = async ({ label, from, localField, to, extraMatch = {} }) => {
    const rows = await col(from)
      .aggregate([
        /**
         * ⚠️ Soft-deleted rows are not orphans any more.
         *
         * Without this the report never goes green: `cleanupOrphans.js` sets
         * `isDeleted: true` — the repo-wide rule, and the right call, because a
         * hard delete would take the history that explains the orphan with it —
         * and this script kept counting them. A tool that still shouts after
         * the fix has been applied teaches people to stop reading it.
         */
        {
          $match: {
            [localField]: { $type: "objectId" },
            isDeleted: { $ne: true },
            ...extraMatch,
          },
        },
        {
          $lookup: {
            from: to,
            localField,
            foreignField: "_id",
            as: "_target",
          },
        },
        { $match: { _target: { $size: 0 } } },
        { $project: { _id: 1, [localField]: 1, createdAt: 1 } },
      ])
      .toArray();

    // Same filter as the aggregation above, so `4 / 29` compares like with like.
    const total = await col(from).countDocuments({
      [localField]: { $type: "objectId" },
      isDeleted: { $ne: true },
      ...extraMatch,
    });

    const mark = rows.length ? "⚠️ " : "   ";
    log(`${mark}${label.padEnd(46)} ${String(rows.length).padStart(4)} / ${total}`);
    for (const r of rows.slice(0, SHOW)) {
      log(`      ${String(r._id)}  ${localField}=${String(r[localField])}`);
    }
    if (rows.length > SHOW) log(`      … and ${rows.length - SHOW} more`);
    return rows.length;
  };

  log("── a row pointing at something that is not there ──\n");
  let n = 0;
  n += await orphans({
    label: "Customer -> User",
    from: "customers",
    localField: "userId",
    to: "users",
  });
  n += await orphans({
    label: "VoucherClaim -> Customer",
    from: "voucherclaims",
    localField: "customerId",
    to: "customers",
  });
  n += await orphans({
    label: "VoucherClaim -> Transaction",
    from: "voucherclaims",
    localField: "transactionId",
    to: "transactions",
  });
  n += await orphans({
    label: "Transaction -> Customer",
    from: "transactions",
    localField: "customerId",
    to: "customers",
  });
  n += await orphans({
    label: "RefundRequest -> VoucherClaim",
    from: "refundrequests",
    localField: "claimId",
    to: "voucherclaims",
  });
  n += await orphans({
    label: "Notification -> Customer",
    from: "notifications",
    localField: "customerId",
    to: "customers",
  });
  n += await orphans({
    label: "Brand -> User",
    from: "brands",
    localField: "userId",
    to: "users",
  });
  n += await orphans({
    label: "SubBrand -> Brand",
    from: "subbrands",
    localField: "brandId",
    to: "brands",
  });

  /**
   * The other direction, and the one `repairRoleProfile` exists for: an account
   * that can sign in but has no role profile behind it. Harmless-looking and
   * the reason a vendor could once never finish onboarding.
   */
  log("\n── an account with no role profile (repaired on next login) ──\n");
  for (const [role, field, target] of [
    ["CUSTOMER", "customerId", "customers"],
    ["VENDOR", "brandId", "brands"],
  ]) {
    const missing = await col("users").countDocuments({
      role,
      isDeleted: { $ne: true },
      [field]: { $exists: false },
    });
    const total = await col("users").countDocuments({
      role,
      isDeleted: { $ne: true },
    });
    log(
      `${missing ? "⚠️ " : "   "}${`${role} with no ${field}`.padEnd(46)} ${String(missing).padStart(4)} / ${total}`,
    );
    void target;
  }

  /**
   * ── what is actually attached to each orphan ──
   *
   * The counts above say *how many*. They cannot say what to do, because the
   * answer turns entirely on one question: **does this row carry money?**
   *
   * An empty brand whose owner is gone is a half-finished signup, and deleting
   * it costs nothing. A brand with settlements against it is a record somebody
   * was paid from — soft-deleting that quietly removes it from the queries that
   * reconcile payouts, and the books stop adding up with no error anywhere.
   *
   * So this prints the deciding facts per row and still refuses to act on them.
   */
  if (DETAIL && n) {
    log("\n── what each orphan carries ──");

    const attachments = async (label, from, localField, to, links) => {
      const rows = await col(from)
        .aggregate([
          { $match: { [localField]: { $type: "objectId" } } },
          {
            $lookup: { from: to, localField, foreignField: "_id", as: "_t" },
          },
          { $match: { _t: { $size: 0 } } },
        ])
        .toArray();
      if (!rows.length) return;

      log(`\n${label} — ${rows.length} row(s)\n`);
      for (const r of rows) {
        const counts = await Promise.all(
          links.map(async ({ name, coll, field }) => {
            const c = await col(coll).countDocuments({ [field]: r._id });
            return { name, c };
          }),
        );
        const carried = counts.filter((x) => x.c > 0);
        // The money links are listed first in `links`, so anything found in the
        // first three is the reason not to touch this row.
        const money = carried.filter((x) =>
          ["transactions", "settlements", "subscriptions"].includes(x.name),
        );

        log(
          `  ${money.length ? "💰" : "  "} ${String(r._id)}  ` +
            `${(r.uniqueId || r.storeId || "—").padEnd(10)} ` +
            `${(r.name || r.brandName || "(no name)").slice(0, 22).padEnd(24)} ` +
            `${r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : "—"}  ` +
            `${r.isDeleted ? "deleted" : "live   "}`,
        );
        log(
          `      missing ${localField}=${String(r[localField])}` +
            `   ${carried.length ? carried.map((x) => `${x.name}:${x.c}`).join("  ") : "nothing attached"}`,
        );
      }
    };

    // Money first in each list — the summary above keys off these three names.
    await attachments("Brand -> User", "brands", "userId", "users", [
      { name: "transactions", coll: "transactions", field: "brandId" },
      { name: "settlements", coll: "settlements", field: "brandId" },
      { name: "subscriptions", coll: "subscribeds", field: "brandId" },
      { name: "vouchers", coll: "vouchers", field: "brandId" },
      { name: "claims", coll: "voucherclaims", field: "brandId" },
      { name: "outlets", coll: "subbrands", field: "brandId" },
    ]);

    await attachments("SubBrand -> Brand", "subbrands", "brandId", "brands", [
      { name: "transactions", coll: "transactions", field: "subBrandId" },
      { name: "claims", coll: "voucherclaims", field: "subBrandId" },
      { name: "vouchers", coll: "vouchers", field: "subBrandId" },
    ]);

    log(
      "\n  💰 = carries payment, settlement or subscription rows. " +
        "Those are money records — decide them one at a time, never in a sweep.",
    );
  }

  log(
    n
      ? `\n⚠️  ${n} orphaned row(s). Nothing was changed — decide per shape, see the note at the top of this file.` +
          (DETAIL ? "" : "\n    Run again with --detail to see what each one carries.")
      : "\n✅ no orphans.",
  );
};

run()
  .catch((e) => {
    console.error("\nFAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  });
