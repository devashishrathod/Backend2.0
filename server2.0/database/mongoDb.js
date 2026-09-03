const mongoose = require("mongoose");
const dns = require("dns");
const dotenv = require("dotenv");
dotenv.config();

/**
 * The version of Node where `mongodb+srv://` starts working again on Windows.
 * See `explainSrvDnsFailure` below for what breaks before it.
 */
const SRV_DNS_FIXED_IN = "24.19.0";

/**
 * Is c-ares pointed at a loopback address with nothing listening on it?
 *
 * Checking the symptom rather than `process.versions.node` is deliberate: the
 * regression spans several release lines (v20.20.2, v22.22.2, v24.14.1 were all
 * affected) and a version comparison would have to track every one of them. This
 * matches the actual broken state on any version, and stops matching by itself
 * the moment the machine is fixed.
 */
const caresIsOnLoopback = () => {
  const servers = dns.getServers();
  return (
    servers.length > 0 &&
    servers.every((server) => server === "127.0.0.1" || server === "::1")
  );
};

/**
 * Say why the connection failed, in the one case where nothing else on the
 * machine looks wrong.
 *
 * Node has two DNS paths and they can disagree:
 *
 *   dns.lookup   -> the OS resolver. Browsers, `npm install`, `ping`, and a
 *                   plain `mongodb://` string all use this, and it works.
 *   dns.resolve* -> c-ares, with its own server list. `mongodb+srv://` needs
 *                   this, and only this.
 *
 * c-ares 1.34.6 shipped a Windows regression that made it report `127.0.0.1`,
 * where nothing listens — so the SRV lookup failed in about 2ms with
 * ECONNREFUSED while the box was otherwise perfectly healthy. That combination
 * points at everything except the real cause: the cluster looks down, the
 * password looks wrong, Atlas looks like it is blocking the IP. It cost hours.
 * See https://github.com/nodejs/node/issues/62347.
 *
 * ### Why there is no retry here any more
 *
 * This used to catch the failure, call `dns.setServers(["8.8.8.8", "1.1.1.1"])`
 * and reconnect. It worked — and it re-hid the cause on every single boot, so
 * the machine stayed broken for every other tool that resolves a name. Node
 * 24.19.0 cherry-picked the c-ares patch, so the fix is now an upgrade rather
 * than a workaround, and this function points at it. One upgrade fixes the
 * machine permanently; a retry fixed one connection at a time, forever.
 */
const explainSrvDnsFailure = () => {
  console.log("");
  console.log("   This is a Node bug, not a problem with the cluster.");
  console.log(`   c-ares reports ${dns.getServers().join(", ")}, where nothing listens,`);
  console.log("   so the SRV lookup mongodb+srv:// needs fails instantly.");
  console.log("");
  console.log(`   You are on Node ${process.versions.node} (c-ares ${process.versions.ares}).`);
  console.log(`   Fixed in Node ${SRV_DNS_FIXED_IN}:`);
  console.log("");
  console.log(`     nvm install ${SRV_DNS_FIXED_IN}  &&  nvm use ${SRV_DNS_FIXED_IN}`);
  console.log("");
  console.log("   Then confirm with:  node scripts/checkDnsForSrv.js");
  console.log("");
};

/**
 * The driver already retries server selection internally for 30s, so these
 * attempts are not about a slow cluster — they cover the failures that throw
 * straight away, before selection ever starts. Worst case is therefore about
 * 90s before the boot gives up, which is a slow deploy and not a stuck one.
 */
const CONNECT_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const positiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Connection options. These used to be absent entirely — `mongoose.connect(url)`
 * and nothing else — while the **test** setup carefully capped its pool and
 * explained why. Production was the untuned one.
 *
 * ### `maxPoolSize` is the one that bites first
 *
 * Mongoose opens **100** connections per process by default, and a cluster has a
 * ceiling for the whole account: 500 on Flex. Node is single-threaded, so a
 * hundred sockets per process buys almost nothing — but the arithmetic that
 * matters is not per process, it is:
 *
 *     total connections  =  pool size  ×  workers per instance  ×  instances
 *
 * At the default 100 that is 100 for one process today, and 1200 the day this
 * runs 4 pm2 workers on 3 instances — well past the ceiling, at which point
 * Atlas refuses new connections and every request fails at once. At 20 the same
 * growth lands at 240, which fits. Tune with `MONGO_MAX_POOL_SIZE` rather than
 * editing this, so a bigger instance does not need a deploy of new code.
 *
 * ### `autoIndex` defaults to on, and that is not free
 *
 * Mongoose checks every schema's indexes against the server when each model is
 * first used. Measured here: 6.3s for five models with every index **already
 * present** — so ~65s of background round trips across 53 models, competing with
 * whatever real traffic arrives in that window. It does not delay boot; it
 * slows the first minute of it.
 *
 * Worse, a mismatch raises `IndexOptionsConflict`, which Mongoose swallows on
 * the `index` event — the index simply never appears (see `constants/mongo.js`).
 *
 * ⚠️ It stays **on by default** deliberately. Turning it off silently is how a
 * partial unique index quietly stops existing and two rows that must never
 * coexist both insert. Set `MONGO_AUTO_INDEX=false` in production **only after**
 * `node scripts/ensureIndexes.js --apply` has run against that database, and
 * keep that script in the deploy.
 */
const connectionOptions = () => ({
  maxPoolSize: positiveInt(process.env.MONGO_MAX_POOL_SIZE, 20),
  /**
   * A warm floor. Opening a socket to Atlas costs a round trip plus a TLS
   * handshake, and paying that on the first request of a quiet period is a
   * user-visible delay for no reason.
   */
  minPoolSize: positiveInt(process.env.MONGO_MIN_POOL_SIZE, 2),
  /**
   * The driver's own 30s. That is right for a boot, where waiting beats failing,
   * and wrong for a live request, where it means a customer watches a spinner
   * for half a minute before an error. `retryWrites`/`retryReads` already cover
   * the ordinary blip and a replica-set election, so 10s is the point where
   * waiting longer stops buying anything.
   */
  serverSelectionTimeoutMS: positiveInt(
    process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    10000,
  ),
  autoIndex: process.env.MONGO_AUTO_INDEX !== "false",
});

/**
 * Connect, or report that we could not. **Returns a boolean and never throws** —
 * `index.js` turns `false` into a non-zero exit, because a server that is up
 * with no database is the worst of the three outcomes: Mongoose buffers each
 * query for `bufferTimeoutMS` and then fails it, so a customer waits ten seconds
 * for a spinner and gets a 500, while the port stays open and every health check
 * and uptime monitor reports the service as fine.
 */
exports.mongoDb = async () => {
  const options = connectionOptions();

  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    try {
      await mongoose.connect(process.env.MONGO_URL, options);
      console.log("✅ Trydood 2.0 MongoDb connection established");
      console.log(
        `   pool ${options.minPoolSize}-${options.maxPoolSize} · ` +
          `select ${options.serverSelectionTimeoutMS}ms · ` +
          `autoIndex ${options.autoIndex ? "on" : "off"}`,
      );
      return true;
    } catch (error) {
      console.log(
        `❌ MongoDB connection failed (attempt ${attempt}/${CONNECT_ATTEMPTS}):`,
        error?.message,
      );

      const isSrvDnsFailure =
        error.code === "ECONNREFUSED" && error.syscall === "querySrv";

      /**
       * Deterministic: the resolver is misconfigured, so the next two attempts
       * fail identically. Say why once and stop, rather than printing the same
       * wall of text three times over six seconds.
       */
      if (isSrvDnsFailure && caresIsOnLoopback()) {
        explainSrvDnsFailure();
        return false;
      }

      if (attempt < CONNECT_ATTEMPTS) await sleep(RETRY_DELAY_MS);
    }
  }

  return false;
};
