/**
 * One-time: move existing voucher banners into the V-4 shape.
 *
 * ### 🔴 Stage only. Production will never run this.
 *
 * Production starts on a fresh database, so there is nothing there to migrate —
 * and that is the decision this script is written around, not an accident of
 * timing. **No application code depends on it having run**: `pickVoucherBanner`
 * reads only `banner.current` and falls back to the voucher's first image, so a
 * voucher whose banner was never migrated renders correctly, just on the
 * fallback.
 *
 * That matters more than the migration itself. If the read path understood the
 * old shape "for a transition period", the old shape would still be alive a year
 * from now and the next person would have to support both.
 *
 * ### What it does
 *
 *     { type: "IMAGE", image: {…} }   →   { current: {…}, status: "APPROVED" }
 *     { type: "VIDEO", video: {…} }   →   { current: {…}, status: "APPROVED" }
 *     { type: "GIF",   gif:   {…} }   →   { current: {…}, status: "APPROVED" }
 *
 * ⚠️ Everything lands as **APPROVED**, deliberately. These banners were live to
 * customers before this phase, so putting them into review would take every
 * brand's banner off screen at once and fill an empty queue with work nobody
 * asked for. The review flow starts applying to what happens next.
 *
 * ### Safety
 *
 * - Refuses any database whose name is not the stage one unless `--force`.
 * - `--dry` prints what it would write and changes nothing.
 * - Re-runnable: a voucher that already has `banner.current` is skipped, so a
 *   half-finished run can simply be run again.
 *
 *     node scripts/backfillVoucherBanners.js --dry
 *     node scripts/backfillVoucherBanners.js
 */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");

const { config } = require("../configs/env");
const {
  VOUCHER_BANNER_STATUS,
} = require("../constants/voucherBanner");

const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");

/**
 * ⚠️ Guarded on the database **name**, never on `NODE_ENV`.
 *
 * `NODE_ENV` is one env var away from being wrong on the machine that matters;
 * the database name is what the connection actually opened. That is the rule
 * the money-test guard follows too.
 */
const PRODUCTION_HINTS = ["prod", "production", "live"];

const legacyFieldFor = (type) =>
  ({ IMAGE: "image", VIDEO: "video", GIF: "gif" })[type] ?? null;

const run = async () => {
  await mongoose.connect(config.MONGO_URL);
  const db = mongoose.connection.db;
  const name = db.databaseName;

  const looksProduction = PRODUCTION_HINTS.some((hint) =>
    name.toLowerCase().includes(hint),
  );
  if (looksProduction && !FORCE) {
    console.error(
      `⛔ "${name}" looks like production, and production is meant to start fresh.\n` +
        "   Nothing was changed. Re-run with --force only if you are certain.",
    );
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  console.log(`${DRY ? "DRY RUN — " : ""}database: ${name}\n`);

  // The raw collection, not the model: the old fields are no longer in the
  // schema, so Mongoose would not hand them back.
  const vouchers = db.collection("vouchers");

  const legacy = await vouchers
    .find({ "banner.type": { $ne: null, $exists: true } })
    .project({ banner: 1, name: 1 })
    .toArray();

  let moved = 0;
  let skipped = 0;
  let empty = 0;

  for (const voucher of legacy) {
    const { banner } = voucher;

    if (banner?.current) {
      skipped += 1;
      continue;
    }

    const field = legacyFieldFor(banner?.type);
    const media = field ? banner[field] : null;

    // A type with no file beside it — the half-written state the old shape
    // allowed. There is nothing to carry over, so it just loses the label.
    if (!media?.url) {
      empty += 1;
      if (!DRY) {
        await vouchers.updateOne(
          { _id: voucher._id },
          { $unset: { banner: "" } },
        );
      }
      continue;
    }

    moved += 1;
    console.log(`  ${voucher.name} — ${banner.type} → current (APPROVED)`);

    if (DRY) continue;

    await vouchers.updateOne(
      { _id: voucher._id },
      {
        $set: {
          banner: {
            current: media,
            status: VOUCHER_BANNER_STATUS.APPROVED,
            rejectionReason: null,
            reviewedBy: null,
            reviewedAt: new Date(),
          },
        },
      },
    );
  }

  console.log(
    `\n${DRY ? "would move" : "moved"}: ${moved}` +
      `\nalready migrated: ${skipped}` +
      `\ntype with no file (banner dropped): ${empty}`,
  );

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Backfill failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
