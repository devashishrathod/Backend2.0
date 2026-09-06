/**
 * Collapse duplicate sign-in identities so the partial unique indexes on `User`
 * can be built.
 *
 *   node scripts/dedupeUserIdentities.js                  # what would change
 *   node scripts/dedupeUserIdentities.js --apply          # change it
 *   node scripts/dedupeUserIdentities.js --db Trydood2_postman --apply
 *
 * Dry run by default, like every other script here.
 *
 * ### What this is fixing
 *
 * `User` carries unique indexes on `username`, `referralCode` and `uniqueId` —
 * and on **none of the three fields anybody actually signs in with**. Every auth
 * path does `User.findOne({ whatsappNumber, role })` or the email/mobile
 * equivalent, which assumes at most one match and does not check.
 *
 * It has already happened: `8210574144` has **four** CUSTOMER accounts in the
 * dev database, all created inside the same second — four concurrent taps that
 * each passed a read-then-write existence check and each inserted. Since then
 * that person's login has returned an arbitrary one of the four, so which
 * account they land in — and which history they see — is decided by nothing.
 *
 * The index is the real fix, because the index decides rather than the timing.
 * This script only clears the way for it.
 *
 * ### Which row survives
 *
 * The **oldest**, and among equals the one carrying the most history. Age wins
 * because it is the account any earlier link, invoice or notification already
 * points at; history breaks the tie because losing a claim is worse than losing
 * an empty row.
 *
 * ⚠️ Losers are **soft-deleted**, never removed. `isDeleted: true` drops them out
 * of the partial index (so the number is free) while leaving the row for anyone
 * who later asks where an account went — the same rule the rest of the domain
 * follows.
 *
 * ⚠️ It **refuses** when more than one candidate in a group carries money. Two
 * accounts with real claims are not a duplicate to be tidied away; that is a
 * merge, and a merge is somebody's decision, not a script's.
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
const APPLY = args.includes("--apply");
const DB = flag("db") || null;

/** The three fields an auth path looks a user up by. */
const IDENTITY_FIELDS = ["whatsappNumber", "email", "mobile"];

const log = (...a) => console.log(...a);

const run = async () => {
  const url = DB
    ? process.env.MONGO_URL.replace(/\/([A-Za-z0-9_-]+)(\?|$)/, `/${DB}$2`)
    : process.env.MONGO_URL;

  await mongoose.connect(url, { serverSelectionTimeoutMS: 30000 });
  log(`\nConnected: ${mongoose.connection.name}`);
  if (!APPLY) log("\n── DRY RUN ── nothing will be written. Re-run with --apply.\n");

  const users = mongoose.connection.db.collection("users");
  const customers = mongoose.connection.db.collection("customers");
  const claims = mongoose.connection.db.collection("voucherclaims");
  const txns = mongoose.connection.db.collection("transactions");

  let groups = 0;
  let wouldDelete = 0;
  let refused = 0;

  for (const field of IDENTITY_FIELDS) {
    const dupes = await users
      .aggregate([
        {
          $match: {
            [field]: { $type: "string", $ne: "" },
            isDeleted: { $ne: true },
          },
        },
        {
          $group: {
            _id: { value: `$${field}`, role: "$role" },
            n: { $sum: 1 },
            ids: { $push: "$_id" },
          },
        },
        { $match: { n: { $gt: 1 } } },
      ])
      .toArray();

    if (!dupes.length) {
      log(`  ${field}: no duplicates`);
      continue;
    }

    for (const group of dupes) {
      groups += 1;
      log(`\n  ${field} "${group._id.value}" role=${group._id.role} — ${group.n} accounts`);

      const rows = await users
        .find({ _id: { $in: group.ids } })
        .project({ _id: 1, uniqueId: 1, customerId: 1, brandId: 1, createdAt: 1 })
        .toArray();

      /**
       * How much would actually be lost. Counted per account rather than
       * assumed, because "the newest is the junk one" is true right up until it
       * is the one somebody bought something with.
       */
      const scored = [];
      for (const u of rows) {
        const cid = u.customerId;
        const nClaims = cid ? await claims.countDocuments({ customerId: cid }) : 0;
        const nTxn = cid ? await txns.countDocuments({ customerId: cid }) : 0;
        const nCust = cid ? await customers.countDocuments({ _id: cid }) : 0;
        scored.push({ ...u, nClaims, nTxn, nCust, weight: nClaims + nTxn });
      }

      scored.sort(
        (a, b) =>
          b.weight - a.weight || new Date(a.createdAt) - new Date(b.createdAt),
      );

      const withMoney = scored.filter((r) => r.weight > 0);
      if (withMoney.length > 1) {
        refused += 1;
        log(
          `    ⚠️  REFUSING: ${withMoney.length} of these carry claims or payments.`,
        );
        log("        Merging real histories is a decision, not a cleanup. Left alone.");
        for (const r of scored) {
          log(`        ${r._id} ${r.uniqueId} claims=${r.nClaims} txns=${r.nTxn}`);
        }
        continue;
      }

      const [keep, ...lose] = scored;
      log(
        `    keep  ${keep._id} ${keep.uniqueId} created=${new Date(keep.createdAt).toISOString().slice(0, 16)} claims=${keep.nClaims} txns=${keep.nTxn}`,
      );
      for (const r of lose) {
        log(
          `    drop  ${r._id} ${r.uniqueId} created=${new Date(r.createdAt).toISOString().slice(0, 16)} claims=${r.nClaims} txns=${r.nTxn}`,
        );
      }
      wouldDelete += lose.length;

      if (APPLY) {
        const loserIds = lose.map((r) => r._id);
        const loserCustomerIds = lose.map((r) => r.customerId).filter(Boolean);

        await users.updateMany(
          { _id: { $in: loserIds } },
          {
            $set: {
              isDeleted: true,
              // Named so a human reading this row later knows it was a machine's
              // doing and why, rather than guessing at a stray flag.
              deduplicatedAt: new Date(),
              deduplicatedInto: keep._id,
            },
          },
        );

        /**
         * The profile goes too. Leaving a live `Customer` pointing at a deleted
         * `User` is precisely the orphan shape `repairRoleProfile` exists to
         * clean up after — and it would be found by any query that starts from
         * the customer side.
         */
        if (loserCustomerIds.length) {
          await customers.updateMany(
            { _id: { $in: loserCustomerIds } },
            { $set: { isDeleted: true } },
          );
        }
      }
    }
  }

  log(
    `\n${groups} duplicate group(s) · ${wouldDelete} account(s) ${APPLY ? "soft-deleted" : "would be soft-deleted"}` +
      (refused ? ` · ${refused} refused (real history on more than one)` : ""),
  );

  if (!APPLY && wouldDelete) {
    log("\nRe-run with --apply, then create the indexes:");
    log("  node scripts/ensureIndexes.js --apply");
  }
  if (refused) {
    log(
      "\n⚠️  The refused groups block the unique index. They need a human decision" +
        "\n    about which account keeps the history before the index can build.",
    );
  }
};

run()
  .catch((e) => {
    console.error("\nFAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  });
