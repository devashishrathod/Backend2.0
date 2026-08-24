/**
 * One-off backfill: give pre-existing Subscribed documents a `status`, then
 * rebuild every brand's cached subscription state and plan limits.
 *
 * Why it is needed
 * ----------------
 * `status` is new. Documents written before it exists have no value, so
 * `getActiveSubscription` — which matches on `status: ACTIVE` — cannot see them.
 * Without this, a brand with a genuinely live subscription reads as unsubscribed
 * and every gated action returns 403. The same applies to the outlet/franchise
 * counters, which never had a writer before and are all undefined.
 *
 * What it does
 * ------------
 *  1. Derives `status` for each Subscribed doc from the legacy flags:
 *       isUpgraded            -> UPGRADED
 *       isExpired             -> EXPIRED
 *       endDate <= now        -> EXPIRED
 *       otherwise             -> ACTIVE
 *     and keeps `isActive` / `isExpired` in step with it.
 *  2. Fills `userId` from the owning brand (the field did not exist on the
 *     schema before, so every historical write of it was silently dropped).
 *  3. Runs `syncBrandSubscriptionState` per brand, which sets `isSubscribed`,
 *     `subscribedId`, the plan limits, and recounts outlet/franchise usage from
 *     the actual SubBrand rows.
 *
 * Safe to re-run: every step is idempotent.
 *
 * Usage
 * -----
 *   node scripts/backfillSubscriptionState.js            # dry run, writes nothing
 *   node scripts/backfillSubscriptionState.js --apply    # actually write
 */

require("dotenv").config();
const dns = require("dns");
const mongoose = require("mongoose");

const Brand = require("../models/Brand");
const Subscribed = require("../models/Subscribed");
const { SUBSCRIBED_STATUS } = require("../constants/subscription");
const {
  syncBrandSubscriptionState,
} = require("../helpers/subscribeds/syncBrandSubscriptionState");

const APPLY = process.argv.includes("--apply");

const deriveStatus = (doc, now) => {
  if (doc.isUpgraded) return SUBSCRIBED_STATUS.UPGRADED;
  if (doc.isExpired) return SUBSCRIBED_STATUS.EXPIRED;
  if (!doc.endDate) return SUBSCRIBED_STATUS.EXPIRED;
  return new Date(doc.endDate) > now
    ? SUBSCRIBED_STATUS.ACTIVE
    : SUBSCRIBED_STATUS.EXPIRED;
};

const connect = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      serverSelectionTimeoutMS: 20000,
    });
  } catch (error) {
    if (error.code === "ECONNREFUSED" || error.message?.includes("querySrv")) {
      // Same SRV DNS fallback the app uses.
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

  const now = new Date();
  const docs = await Subscribed.find({}).lean();
  console.log(`Found ${docs.length} subscribed document(s)\n`);

  const tally = {};
  const brandIds = new Set();
  let statusWrites = 0;
  let userIdWrites = 0;

  for (const doc of docs) {
    const status = doc.status || deriveStatus(doc, now);
    tally[status] = (tally[status] || 0) + 1;
    if (doc.brandId) brandIds.add(String(doc.brandId));

    const set = {};
    if (!doc.status) {
      set.status = status;
      set.isActive = status === SUBSCRIBED_STATUS.ACTIVE;
      set.isExpired = status !== SUBSCRIBED_STATUS.ACTIVE;
      if (status === SUBSCRIBED_STATUS.ACTIVE && !doc.activatedAt) {
        set.activatedAt = doc.startDate || doc.createdAt;
      }
      if (status === SUBSCRIBED_STATUS.EXPIRED && !doc.expiredAt) {
        set.expiredAt = doc.endDate;
      }
      statusWrites += 1;
    }

    if (!doc.userId && doc.brandId) {
      const brand = await Brand.findById(doc.brandId).select("userId").lean();
      if (brand?.userId) {
        set.userId = brand.userId;
        userIdWrites += 1;
      }
    }

    if (Object.keys(set).length && APPLY) {
      await Subscribed.updateOne({ _id: doc._id }, { $set: set });
    }
  }

  console.log("Derived status distribution:");
  Object.entries(tally).forEach(([status, count]) =>
    console.log(`   ${status.padEnd(12)} ${count}`),
  );
  console.log(
    `\nstatus fields to write : ${statusWrites}` +
      `\nuserId fields to write : ${userIdWrites}` +
      `\nbrands to resync       : ${brandIds.size}\n`,
  );

  if (!APPLY) {
    console.log("Re-run with --apply to write these changes.\n");
    await mongoose.disconnect();
    return;
  }

  console.log("Resyncing brands (state + limits + usage recount)...\n");
  for (const brandId of brandIds) {
    try {
      const sync = await syncBrandSubscriptionState(brandId);
      const brand = await Brand.findById(brandId).select("brandName").lean();
      const e = sync.entitlements;
      console.log(
        `   ${(brand?.brandName || brandId).padEnd(20)} ` +
          `subscribed=${sync.isSubscribed} ` +
          `outlets=${sync.usage.subBrandsUsed}/${e.subBrands.isUnlimited ? "∞" : e.subBrands.limit} ` +
          `franchises=${sync.usage.franchisesUsed}/${e.franchises.isUnlimited ? "∞" : e.franchises.limit} ` +
          `[${sync.source}]`,
      );
      sync.warnings.forEach((w) => console.log(`      ⚠️  ${w}`));
      if (sync.overflow.subBrands || sync.overflow.franchises) {
        console.log(
          `      ⚠️  over limit — outlets by ${sync.overflow.subBrands}, franchises by ${sync.overflow.franchises}`,
        );
      }
    } catch (error) {
      console.error(`   ${brandId}  FAILED: ${error.message}`);
    }
  }

  // Brands flagged subscribed with no Subscribed doc at all — stale cache.
  const orphans = await Brand.find({
    isSubscribed: true,
    _id: { $nin: [...brandIds].map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select("_id brandName")
    .lean();

  for (const brand of orphans) {
    console.log(
      `   ${(brand.brandName || brand._id).padEnd(20)} no subscription doc — clearing stale isSubscribed`,
    );
    await syncBrandSubscriptionState(brand._id);
  }

  console.log("\n✅ Backfill complete.\n");
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("\n❌ Backfill failed:", error);
  process.exit(1);
});
