const mongoose = require("mongoose");
const dns = require("dns");
const { LOCK_ID, COLLECTION } = require("./runLock");

/**
 * Hand the database back.
 *
 * ⚠️ Connects on its **own** mongoose instance rather than through `testDb.js`.
 *
 * Jest runs `globalTeardown` in a fresh module registry, and the shared default
 * connection there is a different object from the one the tests used — writing
 * through it appeared to succeed and landed nowhere. The symptom was a lock that
 * logged "released" and stayed held, which then blocked the next run for the
 * whole TTL.
 *
 * A dedicated connection removes the ambiguity: this either writes or throws.
 */
const LOCK_TTL_EXPIRED = new Date(0);

const toTestUri = (uri) => {
  const match = uri.match(/^(mongodb(?:\+srv)?:\/\/[^/]+\/)([^?]*)(\?.*)?$/);
  if (!match) throw new Error("MONGO_URL is not a shape this teardown understands.");
  const name = (match[2] || "test").replace(/_test$/, "");
  return `${match[1]}${name}_test${match[3] || ""}`;
};

module.exports = async () => {
  require("dotenv").config({ quiet: true });
  const uri = toTestUri(process.env.MONGO_URL);

  let connection;
  try {
    try {
      connection = await mongoose.createConnection(uri, {
        serverSelectionTimeoutMS: 20000,
      }).asPromise();
    } catch (error) {
      if (!/querySrv|ECONNREFUSED|ENOTFOUND/i.test(error?.message || "")) throw error;
      dns.setServers(["8.8.8.8", "1.1.1.1"]);
      connection = await mongoose.createConnection(uri, {
        serverSelectionTimeoutMS: 20000,
      }).asPromise();
    }

    // The same `_test` guard the suite uses. Never point this at live data.
    if (!connection.name.endsWith("_test")) {
      throw new Error(`Refusing to touch ${connection.name} — it does not end in _test.`);
    }

    const result = await connection.db.collection(COLLECTION).updateOne(
      { _id: LOCK_ID },
      {
        $set: {
          owner: null,
          releasedAt: new Date(),
          expiresAt: LOCK_TTL_EXPIRED,
        },
      },
    );

    if (result.matchedCount !== 1) {
      console.error(
        `[globalTeardown] run lock not found — the next run may wait for its TTL. ` +
          `Clear it with: node scripts/testRunLock.js --clear`,
      );
    }
  } catch (error) {
    // A teardown that throws hides the test result behind an unrelated error.
    console.error("[globalTeardown] could not release the run lock:", error?.message);
  } finally {
    await connection?.close().catch(() => {});
  }
};
