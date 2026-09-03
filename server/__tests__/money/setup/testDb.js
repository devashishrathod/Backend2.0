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
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 20000,
        /**
         * ⚠️ Mongoose opens **100** connections by default.
         *
         * The suite is strictly serial (`maxWorkers: 1`), so it can never use
         * more than one at a time — but a shared Atlas M0 has a hard connection
         * ceiling for the whole cluster, and a client that grabs a hundred of
         * them starves everything else, including the next operation this very
         * run makes. The symptom is `MongooseServerSelectionError` mid-test on
         * assertions that are individually correct, which reads as flakiness.
         */
        maxPoolSize: 5,
        minPoolSize: 1,
      });
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

/**
 * Hand the connection back, by actually closing it.
 *
 * ### ⚠️ This was a no-op, and the reasoning behind that was wrong
 *
 * The argument was: thirty suites each connecting and disconnecting is thirty
 * SRV lookups and TLS handshakes against a shared Atlas M0, so let **one**
 * connection serve the whole run and close it in `globalTeardown`.
 *
 * There is no such thing as one connection for the whole run. Jest gives every
 * test **file** its own module registry — and its own `global` — so `require`ing
 * mongoose in the next file returns a *different* mongoose with a *different*
 * connection. Nothing was ever shared. Skipping the disconnect did not reuse a
 * connection; it leaked one per suite, thirty-odd of them, each with its own
 * pool and its own topology monitor.
 *
 * The symptom was the same shape as the bug it was meant to fix, which is why it
 * survived: a scatter of unrelated suites failing, every one of them passing
 * when re-run alone. Measured on the full suite —
 *
 * ```
 *   disconnect as a no-op   15 suites / 294 tests failed
 *   disconnect for real      2 suites /   4 tests failed   (both real defects)
 * ```
 *
 * — with every one of those failures reading `Refusing to clear collections on
 * "undefined"`: the connection was gone, not the assertion wrong.
 *
 * A test file's `beforeAll` reconnects, and `connect()` above already retries
 * three times on the transient errors a busy cluster produces, so the handshake
 * cost this reintroduces is bounded and self-healing in a way the leak was not.
 *
 * Set `TEST_DB_KEEP_CONNECTION=1` to hold it open when debugging something that
 * needs the socket to survive teardown.
 */
exports.disconnectTestDb = async () => {
  if (mongoose.connection.readyState === 0) return;
  if (process.env.TEST_DB_KEEP_CONNECTION) return;
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
