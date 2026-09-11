/**
 * ---------------- bring every mirror back in step ----------------
 *
 * `email`, `mobile` and `whatsappNumber` live on `User` and are mirrored onto the
 * role profile — `Customer`, `Brand`, `SubBrand`. Until `applyIdentityChange`
 * existed, that mirror was written **once at signup and never again**, so every
 * profile edit since has been drifting.
 *
 * It is not a cosmetic drift. Five places read the profile's copy in preference
 * to the account's:
 *
 * - `services/customerBankAccounts/sendBankOtp.js` — the code that gates
 *   attaching a bank account goes to `Customer.whatsappNumber`. A stale value
 *   there means a refund's one-time code is delivered to whoever holds the
 *   customer's old number.
 * - `helpers/notifications/notify.js` — `customer?.email || brand?.email ||
 *   user?.email`, the profile first.
 * - `helpers/subscribeds/buildBillingDetails.js` and
 *   `helpers/voucherClaims/buildVoucherInvoiceSnapshot.js` — what is printed on
 *   an invoice.
 * - `services/systemVerify/verifyVendor.js` — where the approval mail is sent.
 *
 * Going forward every identity write repairs the mirror as it goes, so this is a
 * one-off catch-up rather than something that has to keep running.
 *
 * ⚠️ **The account is the source, always.** Where the two disagree the profile is
 * overwritten, never the other way round: `User` is what the partial unique
 * indexes are on and what every login looks up, so it is the only copy that can
 * be authoritative.
 *
 *   node scripts/syncRoleProfileIdentity.js            # what would change
 *   node scripts/syncRoleProfileIdentity.js --apply    # change it
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const { ROLE_PROFILES, IDENTITY_KEYS } = require("../helpers/users");

const APPLY = process.argv.includes("--apply");
const KEYS = Object.keys(IDENTITY_KEYS);

const main = async () => {
  await mongoose.connect(process.env.MONGO_URL);

  console.log(`\nDatabase: ${mongoose.connection.db.databaseName}`);
  console.log(APPLY ? "Mode: APPLY — rows will be written\n" : "Mode: DRY RUN — nothing will be written\n");

  let drifted = 0;
  let missing = 0;
  let checked = 0;

  for (const [role, profile] of Object.entries(ROLE_PROFILES)) {
    const users = await User.find({ role, isDeleted: false })
      .select(`_id name role ${KEYS.join(" ")}`)
      .lean();

    const ops = [];
    let roleMissing = 0;

    for (const user of users) {
      checked += 1;

      const doc = await profile.model
        .findOne({ userId: user._id, isDeleted: false })
        .select(KEYS.join(" "))
        .lean();

      if (!doc) {
        roleMissing += 1;
        missing += 1;
        continue;
      }

      const diffs = {};
      for (const key of KEYS) {
        // An absent value on the account is not a reason to blank the mirror:
        // only a real difference between two present-or-absent values counts,
        // and a `User` with no email simply has nothing to push down.
        if (user[key] === undefined) continue;
        if (doc[key] === user[key]) continue;
        diffs[key] = { from: doc[key] ?? null, to: user[key] };
      }

      if (!Object.keys(diffs).length) continue;

      drifted += 1;
      if (drifted <= 15) {
        const summary = Object.entries(diffs)
          .map(([k, v]) => `${k}: ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`)
          .join(", ");
        console.log(`  ${profile.label} ${doc._id} (${role}) — ${summary}`);
      }

      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: Object.fromEntries(
              Object.entries(diffs).map(([key, v]) => [key, v.to]),
            ),
          },
        },
      });
    }

    console.log(
      `${role.padEnd(11)} → ${profile.label.padEnd(9)}: ${users.length} account(s), ` +
        `${ops.length} to fix` +
        (roleMissing ? `, ${roleMissing} with no profile` : ""),
    );

    if (APPLY && ops.length) {
      /**
       * ⚠️ The raw collection, not the model.
       *
       * Saving through Mongoose would re-validate every other path on the
       * document, so one profile carrying an unrelated legacy problem — a
       * `storeId` that predates its format, an enum value since removed — would
       * fail a repair that has nothing to do with it. The values being written
       * came off `User`, where the same validators already accepted them.
       */
      const result = await profile.model.collection.bulkWrite(ops, { ordered: false });
      console.log(`             written: ${result.modifiedCount}`);
    }
  }

  if (drifted > 15) console.log(`  … and ${drifted - 15} more`);

  console.log(
    `\nChecked ${checked} account(s) · ${APPLY ? "Fixed" : "Would fix"}: ${drifted}` +
      (missing ? ` · No profile at all: ${missing} (see scripts/auditOrphans.js)` : " · No orphans"),
  );
  if (!APPLY && drifted) console.log("Re-run with --apply to write.");

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("\nFailed:", error.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
