/**
 * One-off: strip the shared seeded password from every account that still has it.
 *
 * Why
 * ---
 * `loginOrSignUpWithWhatsapp` and `signUpSubBrandWithWhatsapp` used to create
 * every VENDOR, CUSTOMER and SUB_VENDOR with the same `DEFAULT_PASSWORD`, and
 * there was no set-password or forgot-password flow anywhere — so that one
 * string was a permanent password for every OTP-created account on the platform.
 *
 * Any account whose email, mobile or username is populated is reachable by
 * `POST /auth/login` with that string. Removing the code that seeds it does
 * nothing for accounts that already exist; this does.
 *
 * How it decides
 * --------------
 * A password is only cleared when `bcrypt.compare` proves it is *exactly* the
 * seeded value. Anything else — an admin's real password, a password a user has
 * since chosen — does not match and is left completely alone. So this cannot
 * lock a legitimate password holder out.
 *
 * After it runs, those accounts have no password. They keep working: they log in
 * by OTP, and can choose a real password via `POST /auth/set-password` or
 * `POST /auth/forgot-password` -> `/reset-password`.
 *
 * Usage
 * -----
 *   node scripts/clearSeededPasswords.js            # dry run, writes nothing
 *   node scripts/clearSeededPasswords.js --apply    # write
 */

require("dotenv").config();
const dns = require("dns");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const User = require("../models/User");

const APPLY = process.argv.includes("--apply");

// The literal that was hard-coded as a fallback alongside the env var, so
// accounts seeded before the variable existed are caught too.
const SEEDED_CANDIDATES = [
  process.env.DEFAULT_PASSWORD,
  "Trydood@123",
].filter(Boolean);

const connect = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      serverSelectionTimeoutMS: 20000,
    });
  } catch (error) {
    if (error.code === "ECONNREFUSED" || error.message?.includes("querySrv")) {
      dns.setServers(["8.8.8.8", "1.1.1.1"]);
      await mongoose.connect(process.env.MONGO_URL, {
        serverSelectionTimeoutMS: 20000,
      });
    } else {
      throw error;
    }
  }
};

const run = async () => {
  await connect();
  console.log(
    `\n${APPLY ? "🔴 APPLY MODE — writing changes" : "🔵 DRY RUN — nothing will be written"}\n`,
  );

  if (!SEEDED_CANDIDATES.length) {
    console.log(
      "No DEFAULT_PASSWORD configured and no literal to check — nothing to do.\n",
    );
    await mongoose.disconnect();
    return;
  }
  console.log(`Checking against ${SEEDED_CANDIDATES.length} known seeded value(s).\n`);

  // No `+` prefix: inside an inclusive projection Mongoose drops `+password`
  // entirely (the prefix only means anything for a `select: false` path), which
  // silently left every hash undefined.
  const users = await User.find({ password: { $exists: true, $ne: null } })
    .select("password role email mobile username whatsappNumber passwordSetAt")
    .lean();

  const seeded = [];
  let keptOwn = 0;

  for (const user of users) {
    // A user who has been through set-password owns their password by
    // definition — skip without even comparing.
    if (user.passwordSetAt) {
      keptOwn += 1;
      continue;
    }

    // A blank or malformed hash cannot be compared and is not the seeded value.
    if (typeof user.password !== "string" || user.password.length < 20) {
      keptOwn += 1;
      continue;
    }

    let matches = false;
    for (const candidate of SEEDED_CANDIDATES) {
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(candidate, user.password)) {
        matches = true;
        break;
      }
    }
    if (matches) seeded.push(user);
    else keptOwn += 1;
  }

  console.log(`  accounts with a password stored : ${users.length}`);
  console.log(`  still holding the seeded value  : ${seeded.length}`);
  console.log(`  own / unrecognised, left alone  : ${keptOwn}\n`);

  if (!seeded.length) {
    console.log("Nothing to clear.\n");
    await mongoose.disconnect();
    return;
  }

  // Reachability is what turns a shared password into a live takeover: an
  // account with no email, mobile or username cannot be found by any password
  // login path today.
  const reachable = seeded.filter(
    (u) => u.email || u.mobile || u.username,
  );

  const byRole = seeded.reduce((acc, u) => {
    const key = u.role || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  console.log("  by role:");
  Object.entries(byRole).forEach(([role, n]) =>
    console.log(`     ${role.padEnd(12)} ${n}`),
  );

  console.log(
    `\n  🔴 currently reachable by password login : ${reachable.length}`,
  );
  reachable.slice(0, 15).forEach((u) => {
    const via = [
      u.email && `email=${u.email}`,
      u.mobile && `mobile=${u.mobile}`,
      u.username && `username=${u.username}`,
    ]
      .filter(Boolean)
      .join("  ");
    console.log(`     ${String(u.role).padEnd(11)} ${via}`);
  });
  if (reachable.length > 15) {
    console.log(`     ... and ${reachable.length - 15} more`);
  }

  if (!APPLY) {
    console.log("\n  Re-run with --apply to clear these passwords.\n");
    await mongoose.disconnect();
    return;
  }

  const result = await User.updateMany(
    { _id: { $in: seeded.map((u) => u._id) } },
    { $unset: { password: "" } },
  );

  console.log(`\n  ✅ cleared ${result.modifiedCount} seeded password(s).`);
  console.log(
    "     Those accounts now log in by OTP and can choose a real password via\n" +
      "     POST /auth/set-password, or /auth/forgot-password -> /auth/reset-password.\n",
  );

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("\n❌ Failed:", error);
  process.exit(1);
});
