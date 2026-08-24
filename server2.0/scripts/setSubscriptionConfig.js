/**
 * One-off: write the platform's real seller identity into
 * `Setting.vendor.subscription`.
 *
 * Why
 * ---
 * The block currently holds the placeholder values from the Postman example
 * (`23AAACT1234A1Z5`, "Trydood HQ, Indore"). Those are fabricated. Left in
 * place, every tax invoice would carry a GSTIN that does not exist.
 *
 * The values below come from the verified GST record on file
 * (`gsts` -> 33AAKCT3750H1ZB, TRYDOOD RETAIL PRIVATE LIMITED, Tamil Nadu,
 * REGULAR taxpayer, registrationStatus SUCCESS).
 *
 * `companyStateCode` is what decides CGST+SGST vs IGST: it is compared against
 * the first two digits of each brand's GSTIN at checkout, so this single value
 * changes the tax split on every future invoice. Nothing already issued moves —
 * `pricing` is frozen per transaction.
 *
 * Usage:
 *   node scripts/setSubscriptionConfig.js            # dry run, writes nothing
 *   node scripts/setSubscriptionConfig.js --apply    # write
 */

require("dotenv").config();
const dns = require("dns");
const mongoose = require("mongoose");
const { getSetting } = require("../helpers/settings");

const APPLY = process.argv.includes("--apply");

// Seller identity — the entity that sells the subscription and issues the
// invoice. Not to be confused with the vendor brands being billed.
const CONFIG = {
  companyName: "TRYDOOD RETAIL PRIVATE LIMITED",
  companyGstin: "33AAKCT3750H1ZB",
  companyAddress:
    "2nd Floor, Phase-3, Suite No. 250, No. S101, Door No. 769, Spencer Plaza, Anna Salai, Chennai, Tamil Nadu, 600002",
  companyStateCode: "33",
  companyState: "Tamil Nadu",
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

const run = async () => {
  await connect();
  console.log(
    `\n${APPLY ? "🔴 APPLY MODE — writing changes" : "🔵 DRY RUN — nothing will be written"}\n`,
  );

  const setting = await getSetting();
  const current = setting.vendor?.subscription || {};

  console.log("  Seller identity changes:\n");
  for (const [key, value] of Object.entries(CONFIG)) {
    const before = current[key] ?? "";
    const changed = String(before) !== String(value);
    console.log(`    ${key}`);
    console.log(`      before : ${before || "(blank)"}`);
    console.log(`      after  : ${value}${changed ? "   <== changed" : "   (no change)"}`);
  }

  console.log("\n  Tax behaviour that follows from companyStateCode = 33:\n");
  const brands = await mongoose.connection.db
    .collection("brands")
    .find({ isDeleted: { $ne: true }, GSTId: { $ne: null } })
    .project({ brandName: 1, GSTId: 1 })
    .toArray();

  for (const brand of brands) {
    const gst = await mongoose.connection.db
      .collection("gsts")
      .findOne({ _id: brand.GSTId }, { projection: { gstNumber: 1 } });
    if (!gst) continue;
    const code = gst.gstNumber.slice(0, 2);
    const intra = code === CONFIG.companyStateCode;
    console.log(
      `    ${(brand.brandName || "(no name)").padEnd(14)} GSTIN ${code}  ->  ${intra ? "CGST 9% + SGST 9%" : "IGST 18%"}`,
    );
  }

  if (!APPLY) {
    console.log("\n  Re-run with --apply to write these changes.\n");
    await mongoose.disconnect();
    return;
  }

  Object.assign(setting.vendor.subscription, CONFIG);
  await setting.save();

  console.log("\n  ✅ Seller identity written.\n");
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("\n❌ Failed:", error);
  process.exit(1);
});
