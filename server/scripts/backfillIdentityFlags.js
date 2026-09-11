/**
 * ---------------- the verified flag, moved onto the right key ----------------
 *
 * `verifyOtpWithWhatsapp` used to set **`isMobileVerified`**. So every account
 * that came in through the public WhatsApp login carries a `true` about a
 * `mobile` field it does not have, and `isWhatsappVerified` — the flag that
 * actually describes what happened — was never written by anything.
 *
 * The code is fixed. This moves the existing rows.
 *
 * ### ⚠️ Two steps, because two different things are true
 *
 * **Everyone** with `isMobileVerified: true` and a WhatsApp number has signed in
 * with a WhatsApp OTP, so `isWhatsappVerified: true` is accurate for all of them
 * — admins included. ADMIN is **not** excluded, and the reason matters: an admin
 * can and does log in through `POST /auth/loginOrSignUp-with-whatsapp`. The
 * validator accepts every role, and the service restricts only account
 * *creation* to customers and vendors — its own comment says other roles "may
 * still log in here".
 *
 * But `isMobileVerified` may only be **cleared** where there is no `mobile` at
 * all. An account holding a real mobile number with `loginType: MOBILE` went
 * through `verifyMobileOTP`, which means that flag is telling the truth about a
 * field that exists. Clearing it would replace one wrong flag with another.
 *
 * So a row can legitimately end with both flags `true`.
 *
 * ⚠️ `isEmailVerified` is deliberately untouched. Nothing here can prove an
 * address was ever confirmed, and the rule this whole change exists to enforce is
 * that **no flag turns true without an OTP**. A migration is not an exception to
 * that.
 *
 *   node scripts/backfillIdentityFlags.js            # what would change
 *   node scripts/backfillIdentityFlags.js --apply    # change it
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { ROLES } = require("../constants");

const APPLY = process.argv.includes("--apply");

/** Rows that came in through WhatsApp — the flag belongs on `isWhatsappVerified`. */
const WHATSAPP_VERIFIED = Object.freeze({
  isMobileVerified: true,
  whatsappNumber: { $type: "string" },
  isDeleted: false,
});

/** Of those, the ones whose `isMobileVerified` is a claim about nothing. */
const MOBILE_FLAG_IS_EMPTY = Object.freeze({
  isMobileVerified: true,
  whatsappNumber: { $type: "string" },
  $or: [{ mobile: { $exists: false } }, { mobile: null }, { mobile: "" }],
  isDeleted: false,
});

const countByRole = async (users, filter) => {
  const rows = await users
    .aggregate([{ $match: filter }, { $group: { _id: "$role", n: { $sum: 1 } } }, { $sort: { n: -1 } }])
    .toArray();
  return rows.map((r) => `${r._id}:${r.n}`).join(" · ") || "none";
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const db = mongoose.connection.db;
  const users = db.collection("users");

  console.log(`\nDatabase: ${db.databaseName}`);
  console.log(APPLY ? "Mode: APPLY — rows will be written\n" : "Mode: DRY RUN — nothing will be written\n");

  const toFlag = await users.countDocuments(WHATSAPP_VERIFIED);
  const toClear = await users.countDocuments(MOBILE_FLAG_IS_EMPTY);
  const keepBoth = toFlag - toClear;

  console.log(`isWhatsappVerified → true : ${toFlag}   (${await countByRole(users, WHATSAPP_VERIFIED)})`);
  console.log(`isMobileVerified   → false: ${toClear}  (no mobile on the account)`);
  console.log(`both flags stay true      : ${keepBoth}  (real mobile, verified by mobile OTP)`);

  if (APPLY) {
    const flagged = await users.updateMany(WHATSAPP_VERIFIED, {
      $set: { isWhatsappVerified: true },
    });
    // ⚠️ Re-read after the first write: the filter below keys on
    // `isWhatsappVerified: true`, so running it first would match nothing.
    const cleared = await users.updateMany(
      { ...MOBILE_FLAG_IS_EMPTY, isWhatsappVerified: true },
      { $set: { isMobileVerified: false } },
    );
    console.log(`\nwritten — flagged: ${flagged.modifiedCount}, cleared: ${cleared.modifiedCount}`);
  }

  /**
   * ---------------- who can still be reached ----------------
   *
   * An admin with no verified channel is the one outcome of this change that
   * fails **silently**. `SETTLEMENT_LEDGER_DRIFT`, `REFUND_FAILED` and the shadow
   * index alert are all on `ALWAYS_DELIVER_TYPES` because their silence costs
   * money — and once the notification guard lands, an unverified address stops
   * carrying them.
   *
   * ⚠️ WhatsApp does not rescue an admin. `ADMIN_NOTIFICATION_DEFAULTS
   * .isWhatsAppNotificationEnabled` is `false`, and the platform switch is
   * checked before everything else, so email is an admin's only real outbound
   * channel.
   */
  const admins = await users
    .find({ role: ROLES.ADMIN, isDeleted: false })
    .project({ name: 1, email: 1, isEmailVerified: 1 })
    .toArray();

  const unreachable = admins.filter((a) => a.isEmailVerified !== true);

  console.log(`\nADMIN reachability — ${admins.length} admin(s)`);
  if (!unreachable.length) {
    console.log("  every admin has a verified email.");
  } else {
    console.log(
      `  ⚠️  ${unreachable.length} admin(s) with NO verified email. Once the ` +
        `notification guard lands their money alerts reach in-app and push only ` +
        `(WhatsApp is off platform-wide for the admin audience).`,
    );
    for (const a of unreachable) {
      console.log(`      ${a.name || "(no name)"} — ${a.email || "(no email)"}`);
    }
    console.log("  Fix: each of them signs in and runs POST /auth/email/verify once.");
  }

  if (!APPLY && (toFlag || toClear)) console.log("\nRe-run with --apply to write.");

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("\nFailed:", error.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
