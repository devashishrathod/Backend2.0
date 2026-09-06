/**
 * Prove that one number + one role can only ever be one account.
 *
 *   node scripts/verifyIdentityUniqueness.js
 *   node scripts/verifyIdentityUniqueness.js --db Trydood2_postman
 *   node scripts/verifyIdentityUniqueness.js --n 12 --keep
 *
 * ### Why this exists as a script and not a one-off check
 *
 * `8210574144` had **four** CUSTOMER accounts, all written inside the same
 * second. Nothing was broken in the way a test would normally catch — each
 * request ran the existence check, each check honestly reported "no user", and
 * each then created one. The bug was the gap between the read and the write, and
 * a gap is invisible to any test that sends one request at a time.
 *
 * So this sends them at once, on purpose, through **the real services** rather
 * than through hand-written inserts — a test that inserts its own rows proves
 * the index works and proves nothing about the code above it.
 *
 * ### What it covers
 *
 * All three paths that can bring a User into existence:
 *
 *   A/B   `loginOrSignUpWithWhatsapp`     CUSTOMER, then VENDOR
 *   C/C2  `registerUser`                  the admin-created account
 *   D     `signUpSubBrandWithWhatsapp`    the outlet a vendor adds
 *
 * plus the five rules that have to hold around them: a soft-deleted account must
 * not block a fresh signup, two accounts with no email must both be allowed, one
 * number must still be allowed a CUSTOMER *and* a VENDOR account, a repeat login
 * must return the same row, and — the one that makes the guarantee real — a raw
 * driver insert that skips every service must still be refused.
 *
 * ⚠️ **This writes.** It creates accounts on the `9799990xxx` numbers and removes
 * them again in a `finally`, including on failure. `--keep` leaves them for
 * inspection. Never point it at production data.
 */
require("dotenv").config();
const dns = require("dns");
const mongoose = require("mongoose");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

/**
 * ⚠️ Stub the OTP provider **before** anything requires it.
 *
 * `services/otps/sendOtp` destructures `sendTemplate` at module load, so the
 * patch has to land on the cached helpers object first — after that require, the
 * destructured reference is fixed and mutating it is too late.
 *
 * The sub-brand path sends an OTP inside the same `try` that creates the user,
 * so without this every run would fire real WhatsApp messages at fake numbers,
 * and a provider refusal would roll the winner back and read as a failure of
 * something this script is not testing.
 */
const otpHelpers = require("../helpers/otps");
otpHelpers.sendTemplate = async () => ({ stubbed: true });

const User = require("../models/User");
const Brand = require("../models/Brand");
const Customer = require("../models/Customer");
const SubBrand = require("../models/SubBrand");
const Otp = require("../models/OTP");
const OtpThrottle = require("../models/OtpThrottle");
const { ROLES, OUTLET_TYPES } = require("../constants");
const {
  loginOrSignUpWithWhatsapp,
} = require("../services/auth/loginOrSignUpWithWhatsapp");
const { registerUser } = require("../services/auth/registerUser");
const {
  signUpSubBrandWithWhatsapp,
} = require("../services/subBrands/signUpSubBrandWithWhatsapp");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const DB = flag("db") || null;
const KEEP = args.includes("--keep");
const N = Number.parseInt(flag("n") || "8", 10);

/** Every number this script touches. Cleanup keys off exactly this list. */
const NUM = {
  customer: "9799990001",
  vendor: "9799990002",
  admin: "9799990003",
  subVendor: "9799990004",
  deleted: "9799990005",
  twoRoles: "9799990006",
  repeat: "9799990007",
  rawAdmin: "9799990008",
  noEmailA: "9799990009",
  noEmailB: "9799990010",
};
const ALL_NUMBERS = Object.values(NUM);
const ADMIN_EMAIL = "race.admin@identity-check.invalid";
const NO_USERNAME_EMAIL = "race.nouser@identity-check.invalid";
const ADMIN_USERNAME = "raceadmincheck";

const log = (...a) => console.log(...a);
let failures = 0;
let skips = 0;

const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  log(`  ${ok ? "✅" : "❌"} ${label}${detail ? `  — ${detail}` : ""}`);
};
const skip = (label, why) => {
  skips += 1;
  log(`  ⏭️  ${label}  — ${why}`);
};

/**
 * Fire `n` calls without awaiting between them.
 *
 * The `Array.from` invokes every function synchronously, so all `n` are in
 * flight before the first one's `findOne` resolves. Awaiting in a loop would
 * serialise them and the script would pass no matter how broken the code is —
 * which is precisely why the original bug survived so long.
 */
const race = async (n, fn) => {
  const settled = await Promise.allSettled(
    Array.from({ length: n }, (_, i) => fn(i)),
  );
  return {
    won: settled.filter((r) => r.status === "fulfilled").map((r) => r.value),
    lost: settled.filter((r) => r.status === "rejected").map((r) => r.reason),
  };
};

const liveUsers = (whatsappNumber, role) =>
  User.find({ whatsappNumber, role, isDeleted: false }).select("_id").lean();

/** Group rejections by `statusCode: message` so a mixed bag is readable. */
const summarise = (errors) => {
  const counts = new Map();
  for (const e of errors) {
    const key = `${e?.statusCode || "?"}: ${e?.message || e}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].map(([k, v]) => `${v}× ${k}`).join(" | ") || "none";
};

const cleanup = async () => {
  /**
   * ⚠️ The throttle rows too, or the script fails on its own second run.
   *
   * The sub-brand path sends an OTP inside the same `try` that creates the user.
   * `claimOtpSend` records that send whether or not the provider is stubbed, and
   * the window is 60 seconds — so a re-run inside a minute has its winner
   * refused with a 429, caught, and **rolled back**: user deleted, outlet
   * deleted, slot released. Zero accounts, four red checks, and nothing wrong
   * with the code.
   *
   * That reads exactly like flakiness, which is the most expensive kind of
   * wrong. Clearing the window makes each run independent of the last.
   */
  await Promise.all([
    OtpThrottle.deleteMany({ target: { $in: ALL_NUMBERS } }),
    Otp.deleteMany({ target: { $in: ALL_NUMBERS } }),
  ]);

  const users = await User.find({
    $or: [
      { whatsappNumber: { $in: ALL_NUMBERS } },
      { mobile: { $in: ALL_NUMBERS } },
      { email: { $in: [ADMIN_EMAIL, NO_USERNAME_EMAIL] } },
    ],
  })
    .select("_id")
    .lean();
  const ids = users.map((u) => u._id);
  if (!ids.length) return 0;

  await Promise.all([
    Customer.deleteMany({ userId: { $in: ids } }),
    Brand.deleteMany({ userId: { $in: ids } }),
    SubBrand.deleteMany({ userId: { $in: ids } }),
    User.deleteMany({ _id: { $in: ids } }),
  ]);
  return ids.length;
};

const run = async () => {
  const url = DB
    ? process.env.MONGO_URL.replace(/\/([A-Za-z0-9_-]+)(\?|$)/, `/${DB}$2`)
    : process.env.MONGO_URL;

  await mongoose.connect(url, { serverSelectionTimeoutMS: 30000 });
  log(`\nConnected: ${mongoose.connection.name}   (${N} concurrent per test)\n`);

  await cleanup();

  // ── 0. the indexes themselves ────────────────────────────────────────────
  //
  // Everything below depends on these three existing *in this database*.
  // A schema declaration is not an index — it only becomes one when
  // `ensureIndexes` runs, so checking the live collection is the only honest
  // check. If these are missing, every later ✅ would be meaningless.
  log("0. the three identity indexes are live");
  const indexes = await User.collection.indexes();
  for (const field of ["whatsappNumber", "email", "mobile"]) {
    const name = `user_${field}_role_unique`;
    const idx = indexes.find((i) => i.name === name);
    check(`${name} exists`, Boolean(idx));
    if (!idx) continue;
    check(
      `  ${name} is unique on the {${field}, role} pair`,
      idx.unique === true && idx.key?.[field] === 1 && idx.key?.role === 1,
      JSON.stringify(idx.key),
    );
    // The partial filter is what keeps a blanket unique from refusing the
    // second account that simply has no email — the `invoiceId_1` trap.
    check(
      `  ${name} skips deleted rows and absent values`,
      idx.partialFilterExpression?.isDeleted === false &&
        idx.partialFilterExpression?.[field]?.$type === "string",
      JSON.stringify(idx.partialFilterExpression),
    );
  }

  // ── A. the exact bug: concurrent customer signup ─────────────────────────
  log(`\nA. ${N} simultaneous CUSTOMER signups on ${NUM.customer}`);
  {
    const { won, lost } = await race(N, () =>
      loginOrSignUpWithWhatsapp({
        whatsappNumber: NUM.customer,
        role: ROLES.CUSTOMER,
      }),
    );
    const rows = await liveUsers(NUM.customer, ROLES.CUSTOMER);
    check("exactly 1 User row", rows.length === 1, `${rows.length} row(s)`);
    // The four-account bug had every request succeed — so "all answered 200" is
    // only meaningful next to the row count above it.
    check(`all ${N} requests answered`, lost.length === 0, summarise(lost));
    const ids = new Set(won.map((r) => String(r.user?._id)));
    check(
      "every response names the same account",
      ids.size === 1,
      `${ids.size} distinct id(s)`,
    );
    const profiles = await Customer.countDocuments({
      userId: { $in: rows.map((r) => r._id) },
    });
    check("exactly 1 Customer profile", profiles === 1, `${profiles}`);
  }

  // ── B. the same, on the path that also writes a Brand ────────────────────
  //
  // Worth its own test: VENDOR creates a second document inside the
  // transaction, and the loser is handed a row it did not write. That row has
  // to come back complete, which is what `repairRoleProfile` is for.
  log(`\nB. ${N} simultaneous VENDOR signups on ${NUM.vendor}`);
  {
    const { won, lost } = await race(N, () =>
      loginOrSignUpWithWhatsapp({
        whatsappNumber: NUM.vendor,
        role: ROLES.VENDOR,
      }),
    );
    const rows = await liveUsers(NUM.vendor, ROLES.VENDOR);
    check("exactly 1 User row", rows.length === 1, `${rows.length} row(s)`);
    check(`all ${N} requests answered`, lost.length === 0, summarise(lost));
    const brands = await Brand.countDocuments({
      userId: { $in: rows.map((r) => r._id) },
    });
    check("exactly 1 Brand profile", brands === 1, `${brands}`);
    const linked = await User.findById(rows[0]?._id).select("brandId").lean();
    check("the winner's brandId is linked", Boolean(linked?.brandId));
    // A loser that got the winner's row back but no brand would onboard into a
    // dead end — the failure mode `repairRoleProfile` was written for.
    check(
      "no response came back without a brand",
      won.every((r) => Boolean(r.user?.brandId)),
      `${won.filter((r) => !r.user?.brandId).length} without`,
    );
  }

  // ── C. the admin-created account ─────────────────────────────────────────
  log(`\nC. ${N} simultaneous registerUser calls on ${ADMIN_EMAIL}`);
  {
    const { won, lost } = await race(N, () =>
      registerUser({
        name: "race admin",
        email: ADMIN_EMAIL,
        password: "Test@12345",
        mobile: NUM.admin,
        whatsappNumber: NUM.admin,
        username: ADMIN_USERNAME,
        role: ROLES.ADMIN,
      }),
    );
    const rows = await User.find({ email: ADMIN_EMAIL, isDeleted: false })
      .select("_id")
      .lean();
    check("exactly 1 User row", rows.length === 1, `${rows.length} row(s)`);
    check("exactly 1 request succeeded", won.length === 1, `${won.length}`);
    // Unlike the login path there is no winner to hand back — an admin creating
    // an account that already exists should be *told*, not silently given
    // somebody else's row. So a friendly 400 is the correct answer here.
    check(
      `the other ${N - 1} were refused with a readable 400`,
      lost.length === N - 1 &&
        lost.every(
          (e) => e?.statusCode === 400 && /already exists/i.test(e?.message),
        ),
      summarise(lost),
    );
    check(
      "no refusal leaked an index name",
      lost.every((e) => !/E11000|dup key|index/i.test(e?.message || "")),
    );
  }

  // ── C2. the same, with no username to collide on ─────────────────────────
  //
  // ⚠️ Test C above passes for the wrong reason on its own.
  //
  // `username` carries its own plain `unique: true`, and it is alphabetically
  // the index Mongo happened to refuse on — so all seven losers were rejected
  // for their username, and the identity indexes this script exists to prove
  // were never reached. `username` is optional on this endpoint, so leaving it
  // out forces the collision onto `email`/`mobile`, which is the case that
  // matters.
  log(`\nC2. ${N} simultaneous registerUser calls with no username`);
  {
    const email = NO_USERNAME_EMAIL;
    const { won, lost } = await race(N, () =>
      registerUser({
        name: "race admin two",
        email,
        password: "Test@12345",
        mobile: NUM.rawAdmin,
        whatsappNumber: NUM.rawAdmin,
        role: ROLES.ADMIN,
      }),
    );
    const rows = await User.find({ email, isDeleted: false })
      .select("_id")
      .lean();
    check("exactly 1 User row", rows.length === 1, `${rows.length} row(s)`);
    check("exactly 1 request succeeded", won.length === 1, `${won.length}`);
    check(
      `the other ${N - 1} were refused on email/whatsapp/mobile`,
      lost.length === N - 1 &&
        lost.every(
          (e) =>
            e?.statusCode === 400 &&
            /(email|whatsapp contact|mobile number) already exists/i.test(
              e?.message,
            ),
        ),
      summarise(lost),
    );
    // Two accounts with no email at all must still both be allowed — the
    // `invoiceId_1` trap, which a blanket unique on a nullable path would hit.
    const a = await loginOrSignUpWithWhatsapp({
      whatsappNumber: NUM.noEmailA,
      role: ROLES.CUSTOMER,
    });
    let b = null;
    let error = null;
    try {
      b = await loginOrSignUpWithWhatsapp({
        whatsappNumber: NUM.noEmailB,
        role: ROLES.CUSTOMER,
      });
    } catch (e) {
      error = e;
    }
    check(
      "two accounts with no email are both allowed",
      Boolean(a && b),
      error?.message || "",
    );
  }

  // ── D. the outlet a vendor adds ──────────────────────────────────────────
  {
    /**
     * ⚠️ Pick a brand with room, and race only as many as it has room for.
     *
     * The outlet slot is reserved *before* `User.create`, so on a plan with
     * fewer free slots than `N` the surplus requests are turned away at the
     * limit and never reach the identity check at all — the race this test
     * exists for silently shrinks, and on a full plan it disappears entirely
     * while still printing green.
     *
     * So: prefer a brand that can take all `N`, and if none can, say plainly how
     * many actually raced rather than quietly testing less than the label
     * claims.
     */
    const candidates = await Brand.find({ isSubscribed: true, isDeleted: false })
      .select("_id userId subBrandsUsed subBrandsLimit isSubBrandsUnlimited")
      .lean();

    const freeSlots = (b) =>
      b.isSubBrandsUnlimited
        ? Infinity
        : (b.subBrandsLimit ?? 0) - (b.subBrandsUsed ?? 0);

    const brand = candidates
      .slice()
      .sort((x, y) => freeSlots(y) - freeSlots(x))[0];
    const free = brand ? freeSlots(brand) : 0;
    const dN = Math.min(N, free);

    log(
      `\nD. ${dN} simultaneous SUB_VENDOR signups on ${NUM.subVendor}` +
        (dN < N ? `  (capped from ${N} — the plan has ${free} free)` : ""),
    );

    if (!brand) {
      skip(
        "sub-brand race",
        "no subscribed brand in this database — run scripts/seedPostmanFixtures.js",
      );
    } else if (dN < 2) {
      skip(
        "sub-brand race",
        `no brand has 2 free outlet slots — nothing to race (best has ${free})`,
      );
    } else {
      const before = brand.subBrandsUsed ?? 0;
      const actor = {
        userId: brand.userId,
        role: ROLES.VENDOR,
        brandId: brand._id,
      };
      const { won, lost } = await race(dN, () =>
        signUpSubBrandWithWhatsapp(actor, {
          brandId: String(brand._id),
          whatsappNumber: NUM.subVendor,
          outletType: OUTLET_TYPES.OUTLET,
        }),
      );

      const rows = await liveUsers(NUM.subVendor, ROLES.SUB_VENDOR);
      check("exactly 1 User row", rows.length === 1, `${rows.length} row(s)`);
      check("exactly 1 request succeeded", won.length === 1, `${won.length}`);
      const outlets = await SubBrand.countDocuments({
        whatsappNumber: NUM.subVendor,
        isDeleted: { $ne: true },
      });
      check("exactly 1 SubBrand row", outlets === 1, `${outlets}`);
      /**
       * `dN` is capped to the free slots above, so every loser here should have
       * reached `User.create` and been refused by the identity index — that is
       * the message this asserts. The limit wording stays accepted because a
       * slot freed by another process mid-race is legitimate, and failing on it
       * would make the script flaky for a reason that is not a defect.
       */
      const readable = /already registered|limit reached|does not include/i;
      check(
        `the other ${dN - 1} were refused with a readable 403`,
        lost.length === dN - 1 &&
          lost.every(
            (e) => e?.statusCode === 403 && readable.test(e?.message || ""),
          ),
        summarise(lost),
      );
      check(
        "they were refused for being a duplicate, not for the plan limit",
        lost.every((e) => /already registered/i.test(e?.message || "")),
        summarise(lost),
      );
      check(
        "no refusal leaked an index name",
        lost.every((e) => !/E11000|dup key|index/i.test(e?.message || "")),
      );

      /**
       * A free check an accidental plan-limit collision exposed: the reserve is
       * atomic, so concurrent adds against a plan with room for fewer can never
       * overshoot it. A read-then-write limit test would let every request read
       * `used < limit` and all of them through.
       */
      const cap = brand.isSubBrandsUnlimited
        ? Infinity
        : (brand.subBrandsLimit ?? 0);
      const peak = await Brand.findById(brand._id)
        .select("subBrandsUsed")
        .lean();
      check(
        "the plan limit was never overshot",
        (peak?.subBrandsUsed ?? 0) <= cap,
        `${peak?.subBrandsUsed ?? 0} of ${cap === Infinity ? "unlimited" : cap}`,
      );

      /**
       * The check that proves the new catch block does more than change the
       * wording.
       *
       * Every one of the `dN` requests reserves an outlet slot before it reaches
       * `User.create`. If a loser threw without unwinding, the vendor would
       * silently lose `dN - 1` outlets from a plan they paid for — a duplicate
       * refused correctly and a quota quietly eaten.
       */
      const after = await Brand.findById(brand._id)
        .select("subBrandsUsed")
        .lean();
      check(
        "the outlet counter moved by exactly 1",
        (after?.subBrandsUsed ?? 0) - before === 1,
        `${before} → ${after?.subBrandsUsed ?? 0}`,
      );
      await Brand.updateOne(
        { _id: brand._id },
        { $set: { subBrandsUsed: before } },
      );
    }
  }

  // ── E. a deleted account must not block the number forever ───────────────
  //
  // The other half of `partialFilterExpression`. Without `isDeleted: false` in
  // the filter, deleting an account would permanently burn its phone number:
  // the row stays indexed, and the person can never sign up again.
  log(`\nE. a soft-deleted account does not block ${NUM.deleted}`);
  {
    const first = await loginOrSignUpWithWhatsapp({
      whatsappNumber: NUM.deleted,
      role: ROLES.CUSTOMER,
    });
    await User.updateOne(
      { _id: first.user._id },
      { $set: { isDeleted: true } },
    );

    let second = null;
    let error = null;
    try {
      second = await loginOrSignUpWithWhatsapp({
        whatsappNumber: NUM.deleted,
        role: ROLES.CUSTOMER,
      });
    } catch (e) {
      error = e;
    }
    check("signing up again is allowed", Boolean(second), error?.message || "");
    check(
      "it is a new account, not the deleted one",
      second && String(second.user._id) !== String(first.user._id),
    );
    const live = await liveUsers(NUM.deleted, ROLES.CUSTOMER);
    check("exactly 1 live row remains", live.length === 1, `${live.length}`);
  }

  // ── F. the exception that has to keep working ────────────────────────────
  //
  // The index is on the *pair*, deliberately. A vendor buying a voucher as a
  // customer is a real person doing a normal thing, and a globally unique
  // number would refuse them.
  log(`\nF. one number may still hold two different roles (${NUM.twoRoles})`);
  {
    const asCustomer = await loginOrSignUpWithWhatsapp({
      whatsappNumber: NUM.twoRoles,
      role: ROLES.CUSTOMER,
    });
    let asVendor = null;
    let error = null;
    try {
      asVendor = await loginOrSignUpWithWhatsapp({
        whatsappNumber: NUM.twoRoles,
        role: ROLES.VENDOR,
      });
    } catch (e) {
      error = e;
    }
    check(
      "a VENDOR account on the same number is allowed",
      Boolean(asVendor),
      error?.message || "",
    );
    check(
      "they are two distinct accounts",
      asVendor && String(asVendor.user._id) !== String(asCustomer.user._id),
    );
    const total = await User.countDocuments({
      whatsappNumber: NUM.twoRoles,
      isDeleted: false,
    });
    check("exactly 2 rows, one per role", total === 2, `${total}`);
  }

  // ── G. logging in twice is not signing up twice ──────────────────────────
  log(`\nG. a repeat login returns the same account (${NUM.repeat})`);
  {
    const first = await loginOrSignUpWithWhatsapp({
      whatsappNumber: NUM.repeat,
      role: ROLES.CUSTOMER,
    });
    const second = await loginOrSignUpWithWhatsapp({
      whatsappNumber: NUM.repeat,
      role: ROLES.CUSTOMER,
    });
    check(
      "same account id both times",
      String(first.user._id) === String(second.user._id),
    );
    const rows = await liveUsers(NUM.repeat, ROLES.CUSTOMER);
    check("still exactly 1 row", rows.length === 1, `${rows.length}`);
  }

  // ── H. the guarantee, with the application removed ───────────────────────
  //
  // Every test above proves *these services* behave. This one proves the rule
  // does not depend on them: a raw driver insert, skipping validation, hooks and
  // every line of service code, still cannot land a second row.
  //
  // That is what makes the promise "under no circumstance" rather than "as long
  // as nobody writes a new signup path".
  log("\nH. a raw driver insert that bypasses every service is still refused");
  {
    const existing = await User.findOne({
      whatsappNumber: NUM.customer,
      role: ROLES.CUSTOMER,
      isDeleted: false,
    })
      .select("_id")
      .lean();

    if (!existing) {
      skip("raw insert", "test A left no row to collide with");
    } else {
      let code = null;
      let message = "";
      try {
        await User.collection.insertOne({
          whatsappNumber: NUM.customer,
          role: ROLES.CUSTOMER,
          isDeleted: false,
          uniqueId: "#RACECHECK1",
          referralCode: "RACE01",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } catch (e) {
        code = e?.code;
        message = e?.message || "";
      }
      check("the insert was rejected", code === 11000, `code=${code}`);
      check(
        "rejected by the identity index specifically",
        /user_whatsappNumber_role_unique/.test(message),
        message.slice(0, 120),
      );
      const rows = await liveUsers(NUM.customer, ROLES.CUSTOMER);
      check("still exactly 1 row", rows.length === 1, `${rows.length}`);
    }
  }

  log("");
  if (!KEEP) {
    const removed = await cleanup();
    log(`cleaned up ${removed} test account(s).`);
  } else {
    log(`--keep: left the ${ALL_NUMBERS.length} test numbers in place.`);
  }

  log(
    failures
      ? `\n❌ ${failures} check(s) failed${skips ? `, ${skips} skipped` : ""} — a duplicate is possible on some path.\n`
      : `\n✅ every check passed${skips ? `, ${skips} skipped` : ""} — one number + one role is one account.\n`,
  );
  process.exitCode = failures ? 1 : 0;
};

run()
  .catch(async (e) => {
    console.error("\nFAILED:", e?.message);
    console.error(e?.stack);
    process.exitCode = 1;
    // The rows exist whether or not the run finished; leaving them behind would
    // make the next run collide with its own leftovers and report a false pass.
    if (!KEEP && mongoose.connection.readyState === 1) {
      await cleanup().catch(() => {});
    }
  })
  .finally(async () => {
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  });
