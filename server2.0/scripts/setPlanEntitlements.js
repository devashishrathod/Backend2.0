/**
 * One-off: set structured `entitlements` on the live subscription plans, and
 * fix the display `features[]` rows that contradict them.
 *
 * Why
 * ---
 * Every plan currently resolves as DERIVED — `helpers/subscriptions/
 * resolveEntitlements.js` has to parse the free-text `features[]`, and
 * `Franchise: "Yes"` carries no count, so franchises fall back to 0 and
 * franchise creation is blocked on Pro Plus, Pro Lite and Advanced.
 *
 * After this runs, `entitlementsSource` becomes DB and nothing is guessed.
 *
 * Plans are matched by `name`. Safe to re-run: it only writes the keys below.
 *
 * Usage:
 *   node scripts/setPlanEntitlements.js            # dry run, writes nothing
 *   node scripts/setPlanEntitlements.js --apply    # write
 */

require("dotenv").config();
const dns = require("dns");
const mongoose = require("mongoose");
const Subscription = require("../models/Subscription");

const APPLY = process.argv.includes("--apply");

/**
 * Confirmed with the product owner.
 *
 * `subBrands` meters outletType OUTLET, `franchises` meters outletType
 * FRANCHISE — separate pools, neither draws from the other.
 *
 * Notes on the judgement calls, all flagged in the run output:
 *  - Basic: the owner confirmed **5 outlets / 1 franchise**. The plan's
 *    `features[]` currently reads `Sub Brand: "01"` and `Franchise: "5"` — the
 *    two values are swapped relative to the intent, so `featureFixes` below
 *    corrects the display text as well. Without that, the plan card would
 *    contradict what the system actually enforces.
 *  - Pro Lite `Deal Pack`: the feature row says `value: "Yes"` with
 *    `available: false` — self-contradictory. Pro Lite (₹3,999) sits above
 *    Advanced (₹2,999), which does grant Deal Pack, so this is read as enabled
 *    and the stale `available: false` is corrected.
 *  - `vouchers` and `showcase` are now **metered pools**, not on/off flags, and
 *    are enforced by real gates. Voucher counts were set explicitly by the
 *    product owner (10 / 15 / 25 / 50); showcase section counts mirror each
 *    plan's outlet allowance.
 *  - Because every tier now grants vouchers, the `Voucher: "No"` display rows on
 *    Basic and Advanced would contradict what is enforced, so `featureFixes`
 *    replaces them with the real allowance.
 */
const PLANS = [
  {
    name: "Pro Plus",
    entitlements: {
      subBrands: { limit: 0, isUnlimited: true },
      franchises: { limit: 0, isUnlimited: true },
      vouchers: { limit: 50, isUnlimited: false },
      showcase: { limit: 0, isUnlimited: true },
      dealPack: { isEnabled: true },
      prioritySupport: { isEnabled: true },
    },
    featureFixes: [
      { title: "Franchise", value: "Unlimited", available: true },
      { title: "Voucher", value: "50", available: true },
    ],
  },
  {
    name: "Pro Lite",
    entitlements: {
      subBrands: { limit: 25, isUnlimited: false },
      franchises: { limit: 25, isUnlimited: false },
      vouchers: { limit: 25, isUnlimited: false },
      showcase: { limit: 25, isUnlimited: false },
      dealPack: { isEnabled: true },
      prioritySupport: { isEnabled: true },
    },
    featureFixes: [
      { title: "Franchise", value: "25", available: true },
      { title: "Voucher", value: "25", available: true },
      // Was value "Yes" with available:false — contradictory.
      { title: "Deal Pack", value: "Yes", available: true },
    ],
  },
  {
    name: "Advanced",
    entitlements: {
      subBrands: { limit: 15, isUnlimited: false },
      franchises: { limit: 10, isUnlimited: false },
      vouchers: { limit: 15, isUnlimited: false },
      showcase: { limit: 15, isUnlimited: false },
      dealPack: { isEnabled: true },
      prioritySupport: { isEnabled: false },
    },
    featureFixes: [
      { title: "Franchise", value: "10", available: true },
      // Was "No"/available:false, which now contradicts a real allowance of 15.
      { title: "Voucher", value: "15", available: true },
    ],
  },
  {
    name: "Basic",
    entitlements: {
      subBrands: { limit: 5, isUnlimited: false },
      franchises: { limit: 1, isUnlimited: false },
      vouchers: { limit: 10, isUnlimited: false },
      showcase: { limit: 5, isUnlimited: false },
      dealPack: { isEnabled: false },
      prioritySupport: { isEnabled: false },
    },
    // The two values were the wrong way round versus the confirmed intent.
    featureFixes: [
      { title: "Sub Brand", value: "5", available: true },
      { title: "Franchise", value: "1", available: true },
      // Was "No"/available:false, which now contradicts a real allowance of 10.
      { title: "Voucher", value: "10", available: true },
    ],
  },
];

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

const show = (bucket) =>
  bucket.isUnlimited ? "UNLIMITED" : String(bucket.limit);

const run = async () => {
  await connect();
  console.log(
    `\n${APPLY ? "🔴 APPLY MODE — writing changes" : "🔵 DRY RUN — nothing will be written"}\n`,
  );

  for (const target of PLANS) {
    const plan = await Subscription.findOne({
      name: target.name,
      isDeleted: false,
    });

    if (!plan) {
      console.log(`  ⚠️  "${target.name}" not found — skipped`);
      continue;
    }

    const e = target.entitlements;
    console.log(`  ${target.name}  (Rs${plan.price})`);
    console.log(
      `      outlets ${show(e.subBrands).padEnd(10)} franchises ${show(e.franchises).padEnd(10)}` +
        ` vouchers ${show(e.vouchers).padEnd(10)} showcase ${show(e.showcase).padEnd(10)}` +
        ` dealPack=${e.dealPack.isEnabled} priority=${e.prioritySupport.isEnabled}`,
    );

    // Report the display rows that are about to be corrected.
    const features = (plan.features || []).map((f) =>
      typeof f.toObject === "function" ? f.toObject() : { ...f },
    );
    for (const fix of target.featureFixes || []) {
      const row = features.find((f) => f.title === fix.title);
      if (!row) {
        console.log(`      + feature "${fix.title}" = "${fix.value}" (added)`);
        features.push({ ...fix });
        continue;
      }
      if (row.value !== fix.value || row.available !== fix.available) {
        console.log(
          `      ~ feature "${fix.title}": "${row.value}"/available=${row.available}  ->  "${fix.value}"/available=${fix.available}`,
        );
        row.value = fix.value;
        row.available = fix.available;
      }
    }

    if (APPLY) {
      plan.entitlements = e;
      plan.features = features;
      await plan.save();
      console.log("      ✅ written");
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("Re-run with --apply to write these changes.\n");
  } else {
    console.log(
      "✅ Plans updated. Brands already on these plans need their limits refreshed:\n" +
        "   node scripts/backfillSubscriptionState.js --apply\n" +
        "   (or PUT /subscribeds/admin/resync per brand)\n",
    );
  }

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("\n❌ Failed:", error);
  process.exit(1);
});
