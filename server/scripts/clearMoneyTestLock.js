/**
 * Release the money suite's run lock when its holder is gone.
 *
 * ### Why this exists
 *
 * `__tests__/money/setup/globalSetup.js` takes a lock on `Trydood2_test` so two
 * runs cannot share one database and corrupt each other's fixtures — failures
 * that look exactly like real bugs. A run that is **killed** never releases it,
 * and the next run then refuses to start.
 *
 * The lock has a TTL, so it frees itself eventually. This is for when you do not
 * want to wait, and it prints the holder first so you can check it is really
 * dead before taking it.
 *
 * ⚠️ Killing the holder process is your job, not this script's. Clearing a lock
 * that something is still using is how the shared database gets corrupted in the
 * first place — on Windows a killed jest often leaves its node child alive:
 *
 *     Get-CimInstance Win32_Process -Filter "ProcessId = <pid>"
 *     Stop-Process -Id <pid> -Force
 *
 *     node scripts/clearMoneyTestLock.js          # show the holder
 *     node scripts/clearMoneyTestLock.js --force  # and release it
 */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
} = require("../__tests__/money/setup/testDb");

const LOCK_ID = "money-test-run";
const FORCE = process.argv.includes("--force");

(async () => {
  await connectTestDb();
  const locks = mongoose.connection.collection("testrunlocks");
  const held = await locks.findOne({ _id: LOCK_ID });

  if (!held?.owner) {
    console.log(`No lock on ${mongoose.connection.name} — the suite can start.`);
    return disconnectTestDb();
  }

  const expiry = held.expiresAt?.toISOString?.() ?? "?";
  console.log(`Held by ${held.owner}`);
  console.log(`  started ${held.startedAt?.toISOString?.() ?? "?"}`);
  console.log(`  expires ${expiry}`);

  if (!FORCE) {
    console.log(
      "\nCheck that process is really gone, then re-run with --force.",
    );
    return disconnectTestDb();
  }

  await locks.deleteOne({ _id: LOCK_ID });
  console.log("\nReleased.");
  return disconnectTestDb();
})().catch(async (error) => {
  console.error("Failed:", error.message);
  await disconnectTestDb().catch(() => {});
  process.exit(1);
});
