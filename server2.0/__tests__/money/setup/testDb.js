require("dotenv").config();
const dns = require("dns");
const mongoose = require("mongoose");

/**
 * The connection every money test uses — and the guard that stops it eating the
 * development database.
 *
 * ### Why not `mongodb-memory-server`
 *
 * The usual answer is an in-memory Mongo per run. It was measured against this
 * machine and rejected: a `mongod` reserves a WiredTiger cache of half the
 * machine's RAM by default, and there is under a gigabyte free here. Jest also
 * forks a worker per core, so the default configuration would try to start
 * several of them.
 *
 * Running against a **separate database on the real cluster** costs nothing to
 * install and tests the same server that production will use. The repo already
 * does exactly this for the Postman fixtures (`Trydood2_postman`), so the shape
 * is not new.
 *
 * The trade-offs are real and worth naming: these tests are slower (every
 * operation is a network round trip), they need the cluster reachable, and they
 * cannot run in CI without credentials. What they do **not** lose is fidelity —
 * every guarantee under test here (atomic `findOneAndUpdate`, partial unique
 * indexes, `$inc` under contention) is enforced **server-side**, so racing two
 * operations from one process still races them at the server. Latency changes
 * how long the test takes, not what it proves.
 *
 * Everything is behind this one module so switching to an in-memory server later
 * is a change to this file and nothing else.
 *
 * ### The guard
 *
 * The database name is derived from `MONGO_URL` and must end in `_test`. If it
 * does not, this refuses to connect at all rather than running. That check is the
 * only thing standing between a `deleteMany` in a test and the development data,
 * so it throws rather than warns, and it runs **after** connecting — the name is
 * read back from the live connection, not from the string we hoped we built.
 */

const TEST_DB_SUFFIX = "_test";

/**
 * Rewrite the database name in a Mongo connection string.
 *
 * Parsed with `URL` rather than a regular expression: the password in these
 * strings routinely contains `/` and `@`, and a regex that looks right against
 * one credential set quietly matches the wrong slash in another.
 */
const toTestUri = (uri) => {
  if (!uri) {
    throw new Error(
      "MONGO_URL is not set. The money tests need a cluster to talk to — copy .env into place first.",
    );
  }

  const parsed = new URL(uri);
  // `pathname` is "/<dbname>", and may be just "/" when the string names none.
  const current = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const base = current || "Trydood2";

  if (base.endsWith(TEST_DB_SUFFIX)) return uri;
  parsed.pathname = `/${encodeURIComponent(base + TEST_DB_SUFFIX)}`;
  return parsed.toString();
};

/**
 * Errors that mean "the network hiccuped", not "the test is wrong".
 *
 * Talking to a remote cluster is the price of not running a local `mongod`, and
 * an SRV lookup that fails or a pool cleared by an `ECONNRESET` says nothing
 * about the code under test. Retrying these keeps a red suite meaningful — a
 * failure that is always a network blip trains everyone to ignore failures.
 */
const TRANSIENT = /querySrv|ECONNREFUSED|ENOTFOUND|ECONNRESET|pool.*cleared|ETIMEDOUT|ServerSelection/i;

const connect = async (uri, attempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
      return;
    } catch (error) {
      lastError = error;
      if (!TRANSIENT.test(error?.message || "")) throw error;

      // The repo's own fallback: some networks refuse SRV lookups.
      dns.setServers(["8.8.8.8", "1.1.1.1"]);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  throw lastError;
};

exports.connectTestDb = async () => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  await connect(toTestUri(process.env.MONGO_URL));

  // Read the name back off the live connection. Deriving it and trusting the
  // derivation would mean a bug in `toTestUri` disables its own guard.
  const name = mongoose.connection.name;
  if (!name || !name.endsWith(TEST_DB_SUFFIX)) {
    await mongoose.disconnect();
    throw new Error(
      `Refusing to run: connected to "${name}", which does not end in "${TEST_DB_SUFFIX}". ` +
        `These tests delete documents, and pointing them at a real database would destroy data.`,
    );
  }

  return mongoose.connection;
};

exports.disconnectTestDb = async () => {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
};

/**
 * Empty the named collections between tests.
 *
 * Deletes documents rather than dropping collections, so the indexes built at
 * setup survive. That matters more than it sounds: **the indexes are what most
 * of these tests are actually testing**, and a dropped collection takes its
 * partial unique index with it — leaving a test that passes because nothing is
 * enforcing anything.
 *
 * Re-asserts the guard on every call. Cheap, and it means no individual test can
 * reconnect somewhere else and then reach this.
 */
exports.clearCollections = async (...models) => {
  const name = mongoose.connection.name;
  if (!name?.endsWith(TEST_DB_SUFFIX)) {
    throw new Error(`Refusing to clear collections on "${name}".`);
  }
  await Promise.all(models.map((model) => model.deleteMany({})));
};

exports.TEST_DB_SUFFIX = TEST_DB_SUFFIX;
exports.toTestUri = toTestUri;
