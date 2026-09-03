/**
 * Inspect or clear the money-test run lock.
 *
 * Every test file shares one database on a real cluster, so two `jest` runs at
 * once clear each other's collections mid-flight. The result is not a clean
 * failure — it is a scatter of unrelated tests failing on assertions that are
 * individually correct, then passing when re-run alone. That reads as flakiness
 * and sends you looking in the wrong place.
 *
 *   node scripts/testRunLock.js          # who holds it
 *   node scripts/testRunLock.js --clear  # take it back from a run that died
 */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const dns = require("dns");

const LOCK_ID = "money-test-run";
const CLEAR = process.argv.includes("--clear");

/** The same `_test` guard the suite itself uses. Never point this at live data. */
const toTestUri = (uri) => {
  const match = uri.match(/^(mongodb(?:\+srv)?:\/\/[^/]+\/)([^?]*)(\?.*)?$/);
  if (!match) throw new Error("MONGO_URL is not a shape this script understands.");
  const name = (match[2] || "test").replace(/_test$/, "");
  return `${match[1]}${name}_test${match[3] || ""}`;
};

const connect = async (uri) => {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  } catch (error) {
    if (!/querySrv|ECONNREFUSED|ENOTFOUND/i.test(error?.message || "")) throw error;
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  }
};

(async () => {
  await connect(toTestUri(process.env.MONGO_URL));

  const name = mongoose.connection.name;
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to touch ${name} — it does not end in _test.`);
  }

  const collection = mongoose.connection.db.collection("testrunlocks");
  const before = await collection.findOne({ _id: LOCK_ID });

  console.log(`📦 ${name}`);
  if (!before || !before.owner) {
    console.log("   lock: free");
  } else {
    console.log(`   lock: HELD by ${before.owner}`);
    console.log(`         since ${before.startedAt?.toISOString?.() || "?"}`);
    console.log(`         expires ${before.expiresAt?.toISOString?.() || "?"}`);
  }

  if (CLEAR) {
    await collection.updateOne(
      { _id: LOCK_ID },
      { $set: { owner: null, releasedAt: new Date(), expiresAt: new Date(0) } },
      { upsert: true },
    );
    console.log("   ✅ cleared");
  } else if (before?.owner) {
    console.log("   Re-run with --clear if that run is gone.");
  }

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("❌", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
