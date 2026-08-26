/**
 * Create an admin account from the command line.
 *
 * Why
 * ---
 * `POST /auth/register` used to be public with `role` defaulting to ADMIN, so
 * anyone who could reach the endpoint could mint themselves a super admin. It
 * now sits behind `isAdmin` — which leaves the obvious question of where the
 * *first* admin comes from. Here.
 *
 * This is also the recovery path if every admin account is ever locked out.
 *
 * What it does
 * ------------
 * Creates a User with `role: ADMIN` and the password you supply, hashed by the
 * model's pre-save hook exactly as `/auth/register` would. Nothing else — an
 * admin has no side profile the way a vendor has a Brand.
 *
 * Refuses to overwrite: if the email or username is already taken it stops and
 * tells you, rather than quietly editing someone's account.
 *
 * Usage
 * -----
 *   node scripts/seedAdmin.js --email admin@trydood.com --password 'Str0ngPass' \
 *     --name "Admin User" --username admin_user --mobile 9800000000
 *
 * Optional:
 *   --whatsapp 9800000000   defaults to --mobile
 *   --dob 1990-01-15        defaults to 1990-01-01
 *   --apply                 without it, this is a dry run and writes nothing
 */

require("dotenv").config();
const dns = require("dns");
const mongoose = require("mongoose");
const User = require("../models/User");
const { ROLES } = require("../constants");
const {
  generateUniqueUserId,
  generateReferralCode,
} = require("../helpers/users");

const APPLY = process.argv.includes("--apply");

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
};

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

// Mirrors validator/auth.js so a seeded admin cannot be weaker than one created
// through the API.
const validate = ({ email, password, name, username, mobile, whatsapp }) => {
  const problems = [];

  if (!email) problems.push("--email is required");
  else if (!/^\S+@\S+\.\S+$/.test(email)) problems.push("--email is not a valid address");

  if (!password) problems.push("--password is required");
  else if (password.length < 8 || password.length > 30) {
    problems.push("--password must be 8-30 characters");
  }

  if (!name) problems.push("--name is required");
  else if (name.trim().length < 3) problems.push("--name must be at least 3 characters");

  if (!username) problems.push("--username is required");
  else if (!/^[a-z0-9_]{3,50}$/.test(username)) {
    problems.push("--username may only contain lowercase letters, numbers and underscores");
  }

  if (!mobile) problems.push("--mobile is required");
  else if (!/^[6-9]\d{9}$/.test(mobile)) problems.push("--mobile must be a 10 digit number");

  if (whatsapp && !/^[6-9]\d{9}$/.test(whatsapp)) {
    problems.push("--whatsapp must be a 10 digit number");
  }

  return problems;
};

const run = async () => {
  const input = {
    email: arg("email")?.toLowerCase(),
    password: arg("password"),
    name: arg("name"),
    username: arg("username")?.toLowerCase(),
    mobile: arg("mobile"),
    whatsapp: arg("whatsapp"),
    dob: arg("dob") || "1990-01-01",
  };

  const problems = validate(input);
  if (problems.length) {
    console.error("\n❌ Cannot seed an admin:\n");
    problems.forEach((p) => console.error(`   • ${p}`));
    console.error("\nRun with no arguments to see usage in the file header.\n");
    process.exitCode = 1;
    return;
  }

  await connect();
  console.log(
    `\n${APPLY ? "🔴 APPLY MODE — writing changes" : "🔵 DRY RUN — nothing will be written"}\n`,
  );

  // Uniqueness is enforced per (identifier, role) across the auth layer, but a
  // duplicate email or username would fail on the unique index anyway — better
  // to say so plainly than to surface a driver error.
  const clash = await User.findOne({
    isDeleted: false,
    $or: [
      { email: input.email, role: ROLES.ADMIN },
      { username: input.username },
    ],
  })
    .select("_id email username role")
    .lean();

  if (clash) {
    const which = clash.username === input.username ? "username" : "email";
    console.error(
      `❌ That ${which} is already taken (user ${clash._id}, role ${clash.role}).`,
    );
    console.error("   Nothing was written. Pick a different one.\n");
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const existingAdmins = await User.countDocuments({
    role: ROLES.ADMIN,
    isDeleted: false,
  });
  console.log(`Existing admin accounts: ${existingAdmins}`);
  console.log(`Will create: ${input.name} <${input.email}> (@${input.username})\n`);

  if (!APPLY) {
    console.log("🔵 Dry run complete. Re-run with --apply to write.\n");
    await mongoose.disconnect();
    return;
  }

  const admin = await User.create({
    name: input.name.toLowerCase(),
    email: input.email,
    username: input.username,
    mobile: input.mobile,
    whatsappNumber: input.whatsapp || input.mobile,
    dob: new Date(input.dob),
    role: ROLES.ADMIN,
    // Hashed by the model's pre-save hook.
    password: input.password,
    passwordSetAt: new Date(),
    isActive: true,
    uniqueId: await generateUniqueUserId(),
    referralCode: await generateReferralCode(),
  });

  console.log(`✅ Admin created — id ${admin._id}, uniqueId ${admin.uniqueId}`);
  console.log(
    `   Sign in with POST /auth/login { type: "EMAIL", email, password, role: "ADMIN" }\n`,
  );

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("\n❌ Failed:", error?.message || error);
  if (error?.code === 11000) {
    console.error("   A unique field (email / username / mobile) is already in use.\n");
  }
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
