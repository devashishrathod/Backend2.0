/**
 * ⚠️ First, before anything else is required — including express.
 *
 * Eleven modules read `process.env` at **load time** (`MERCHANT_ID_SECRET` in
 * `generateBrandMerchantId`, `CLOUD_BASE_URL` in `helpers/cloudinary`,
 * `TWO_FACTOR_API_KEY` in three OTP helpers, and the rest). A value that
 * arrives after they have been required is a value they never see, so the
 * environment has to be loaded, validated and written back before the first
 * `require` below runs.
 *
 * This replaces a bare `dotenv.config()`. The difference is that a missing or
 * malformed variable now fails the boot instead of surfacing weeks later as
 * behaviour nobody can explain — `CLOUD_BASE_URL` unset, for instance, makes
 * every media delete a silent no-op while the server answers 200 to everything.
 */
const { config } = require("./configs/env");
const os = require("os");
const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const fileUpload = require("express-fileupload");
const compression = require("compression");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { mongoDb } = require("./database/mongoDb");
const { errorHandler, cleanupTempFiles } = require("./middlewares");
const { logChannelStatus } = require("./helpers/notifications");
const { logPaymentAccounts, assertMoneyIndexes } = require("./helpers/transactions");
const { throwError } = require("./utils");
const allRoutes = require("./routes");
const { getIP } = require("./configs/render");
const { startJobs } = require("./jobs");
const { assertReachableAdmins } = require("./helpers/notifications");

const app = express();
const port = config.PORT;

/**
 * Which tier this is — from `CONFIG_PROFILE`, never from `NODE_ENV`.
 *
 * ⚠️ `NODE_ENV=production` is set in some shells on the dev machine here (see
 * `CLAUDE.md`), on a laptop pointed at a development database with Razorpay test
 * keys. Anything that changes behaviour must therefore hang off the profile,
 * which lives in the environment file and says what that file is. `NODE_ENV`
 * survives for exactly one job below — picking a log format — because it is
 * npm's and Express's variable, not ours.
 */
const isProduction = config.isProduction;

/**
 * How many proxies sit in front of this process.
 *
 * Without it `req.ip` is the proxy's address rather than the caller's, and the
 * rate limiter below then counts **every customer in the country as one client**
 * — the first few hundred requests exhaust the bucket and everyone else is
 * locked out of a working service. Render and an ALB are each one hop, so `1` is
 * right for both.
 *
 * ⚠️ Set `TRUST_PROXY=0` if this ever runs on an EC2 box with nothing in front
 * of it. Trusting a hop that does not exist means believing an `X-Forwarded-For`
 * header the caller wrote themselves, which is a free pass around the limiter.
 */
app.set("trust proxy", config.TRUST_PROXY);

app.use(
  helmet({
    // Nothing here renders HTML, so a policy for scripts and styles protects
    // nothing and ships on every response. The plain-text `/` is unaffected.
    contentSecurityPolicy: false,
    // `cors()` below is deliberately open, and helmet's default `same-origin`
    // would quietly contradict it for browser callers.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

/**
 * The largest single thing that stops a customer waiting.
 *
 * Listings, vouchers and settlement pages are JSON, which compresses to roughly
 * a fifth of its size — and on the mobile networks most of these customers are
 * on, transfer time, not query time, is what they actually experience. Below
 * 1 KB (the default threshold) it is skipped, because compressing a small
 * payload costs more than it saves.
 */
app.use(compression());

app.use(cors());

// `dev` is colourised and built for a terminal. In production the log is a file
// or a CloudWatch stream, where `combined` is the format everything else parses.
app.use(morgan(config.LOG_FORMAT || (isProduction ? "combined" : "dev")));

/**
 * A backstop against a runaway client, not a security boundary.
 *
 * ⚠️ The limit is deliberately high. Indian mobile networks put thousands of
 * real customers behind one carrier-grade NAT address, so an IP here is not a
 * person — a tight limit does not stop an attacker with a phone, it locks out a
 * whole city block of paying users, and they would see a 429 with no idea why.
 * This catches a loop that has gone wrong and leaves everything else alone.
 *
 * Real protection for the endpoints that deserve it — OTP, login, refund
 * requests — belongs on those routes, keyed on the account rather than the
 * address. See `docs/` for what is still open.
 *
 * ⚠️ The counter lives in this process. On one instance that is exactly right;
 * the day a second one starts, each keeps its own tally and the effective limit
 * doubles. That is a degradation, not a break — but when this moves behind a
 * load balancer, move the store to Redis rather than halving the number.
 */
const WEBHOOK_PATHS = new Set([
  "/trydood/v1/transactions/webhook/razorpay",
  "/trydood/v1/transactions/webhook/razorpay/customer",
]);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.RATE_LIMIT_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    /**
     * ⚠️ Razorpay must never be rate limited. A 429 to a webhook is retried for
     * a while and then dropped, and the only symptom is money that stops moving
     * — no error, no alert, exactly the silent failure `CLAUDE.md` describes a
     * settlement having. `/` is the health check and is not worth counting.
     */
    skip: (req) => WEBHOOK_PATHS.has(req.path) || req.path === "/",
    handler: () => throwError(429, "Too many requests. Please try again in a few minutes."),
  }),
);

/**
 * How large a single uploaded file may be.
 *
 * A ceiling that protects the process, not a product rule. The limits a vendor
 * actually meets — 10 MB for a showcase image, 50 MB for a showcase video —
 * live in `Setting` and are enforced per surface with a message naming the
 * surface. This one exists so that nothing, from any client, can put an
 * unbounded file on this disk; it is set well above every real limit and a
 * normal user should never see it.
 *
 * ⚠️ Read once, here, because `express-fileupload` builds its options at
 * `app.use()` time and not per request (`lib/index.js`). Changing it needs a
 * restart. Once uploads are presigned the size condition is built per request
 * from `Setting` and this line goes away with the multipart path.
 *
 * Validated by `configs/env/schema.js` along with everything else, so an
 * unreadable value fails the boot rather than becoming `NaN` — and `NaN` bytes
 * is not a small limit, it is **no limit**, because every comparison against it
 * is false. That check briefly lived in its own module; the schema does it
 * strictly better, rejecting `"100MB"` too rather than reading it as 100.
 */
const MAX_UPLOAD_SIZE_MB = config.MAX_UPLOAD_SIZE_MB;

/**
 * ⚠️ Before `fileUpload()`, deliberately — see `middlewares/cleanupTempFiles.js`.
 * A request aborted on the size limit never reaches a middleware mounted after
 * it, and any file that had already finished writing would be left behind.
 */
app.use(cleanupTempFiles);
app.use(
  fileUpload({
    useTempFiles: true,
    /**
     * ⚠️ Not `"/tmp/"`. That is an absolute POSIX path, and on Windows it
     * resolves to `C:\tmp` — the root of the drive, nowhere near this project,
     * which is why 7.70 GB of abandoned uploads accumulated there unnoticed.
     * `os.tmpdir()` is the right directory on both, and the subdirectory makes
     * it obvious who owns the files. The library creates it if missing.
     */
    tempFileDir: path.join(os.tmpdir(), "trydood-uploads"),
    limits: { fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024 },
    /**
     * ⚠️ Load-bearing, and `false` by default.
     *
     * Without it busboy **truncates** a file that passes the limit, marks it
     * `truncated: true`, and lets the request carry on. Nothing in this
     * codebase reads `truncated`, so half a video would upload cleanly and be
     * stored as a valid row — a worse outcome than having no limit at all.
     */
    abortOnLimit: true,
    /**
     * The library's own response is `res.end(<plain text>)`, which never
     * reaches `errorHandler` and gives a client expecting JSON something it
     * cannot parse — surfacing as a generic "something went wrong" rather than
     * the one message that would tell the user what to do about it.
     */
    limitHandler: (req, res) => {
      // Several files in one request each fire this. Only the first can answer.
      if (res.headersSent) return;
      res.status(413).json({
        success: false,
        message: `File is too large. The maximum upload size is ${MAX_UPLOAD_SIZE_MB} MB.`,
      });
    },
  }),
);
// The raw bytes are kept alongside the parsed body because Razorpay signs the
// untouched payload — re-serialised JSON would not match the HMAC. Only the
// webhook route reads `req.rawBody`; everything else is unaffected.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      if (buf?.length) req.rawBody = buf;
    },
  }),
);
app.use("/trydood/v1", allRoutes);
app.get("/", async (req, res) => {
  res.send("Welcome to Trydood 2.0🚀");
});
app.get("/my-ip", getIP);
app.get("/client-ip", (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  res.json({ ip });
});
app.use((req, res, next) => {
  throwError(404, "Invalid API");
});
app.use(errorHandler);

/**
 * The database is a start-up requirement, not a background task.
 *
 * `mongoDb()` used to be fired and forgotten here, and it swallowed every
 * failure — so a cluster that was unreachable, or a wrong `MONGO_URL`, still
 * produced a listening port and a "✅ Server running" line. Nothing after that
 * point said anything was wrong: Mongoose buffers each query for
 * `bufferTimeoutMS` and then rejects it, so the app was not down, it was slow
 * and then broken, and every uptime check passed because the port answered.
 *
 * Refusing to listen turns that into the one thing it should always have been:
 * a failed deploy. It also means `assertMoneyIndexes` and `startJobs` below can
 * assume a live connection, which they always did anyway.
 *
 * An async IIFE because this is CommonJS — there is no top-level `await`.
 */
(async () => {
  const connected = await mongoDb();

  if (!connected) {
    console.error("");
    console.error("❌ Refusing to start without a database.");
    console.error("   Nothing is listening, on purpose — a server with no");
    console.error("   database answers health checks while failing customers.");
    console.error("");
    process.exit(1);
  }

  app.listen(port, async () => {
    console.log(`✅ Trydood 2.0 Server running on http://localhost:${port}`);
    // Which notification channels can actually deliver. Answers "did my env
    // var take effect?" without an endpoint, and logs no credentials.
    logChannelStatus();
    // Same question for the two Razorpay accounts: keys present, test or live,
    // and whether each one can verify a webhook at all. A missing webhook secret
    // is otherwise invisible until a payment is captured and never settles.
    logPaymentAccounts();
    // Background sweeps (subscription + voucher expiry). Started after the
    // listener so a slow first run never delays the port binding, and never
    // allowed to take the process down. Disable with ENABLE_JOBS=false.
    /**
     * Are the money indexes the ones this build expects?
     *
     * A blanket unique index where a partial one belongs rejects the second row
     * that has no value yet, and it is invisible until a real payment hits it.
     * `assertMoneyIndexes` reports; `reapShadowIndexes` removes.
     *
     * ⚠️ It **does** drop now, where it used to only warn. That note said an
     * automatic drop was "exactly the kind of surprise that should never happen
     * on its own" — sound reasoning, wrong outcome: with nothing removing what an
     * older build recreates, the old build wins by default, and what it wins is a
     * database that rejects half the claims. Only an index already superseded by
     * a partial one on the same key is ever touched, and if that replacement is
     * missing nothing is dropped at all.
     *
     * Boot is not enough on its own — a shadow created an hour after a deploy
     * would sit until the next one — so `reapShadowIndexes` is also an hourly
     * job. See `jobs/index.js` and `helpers/transactions/reapShadowIndexes.js`.
     */
    assertMoneyIndexes().catch((error) =>
      console.error("[idx] index check failed:", error?.message),
    );

    /**
     * Can the admins still be told when money goes wrong?
     *
     * An unverified address now carries nothing, and WhatsApp is off for the
     * admin audience platform-wide — so an admin whose email was never confirmed
     * has **no** outbound channel, and their `SETTLEMENT_LEDGER_DRIFT` and
     * `REFUND_FAILED` alerts reach in-app only.
     *
     * Exactly the failure `CLAUDE.md` describes as the dangerous kind: nothing
     * errors, nothing is logged, the send is simply skipped. So it is checked out
     * loud, at every boot. Reports and never acts — marking an address verified
     * without an OTP is the one thing this whole feature forbids, and the
     * accounts with the most power are the worst place to make an exception.
     */
    assertReachableAdmins().catch((error) =>
      console.error("[notify] admin reachability check failed:", error?.message),
    );
    startJobs().catch((error) =>
      console.error("❌ [jobs] failed to start:", error?.message),
    );
    /**
     * A public tunnel so Razorpay's webhooks can reach a laptop. Development
     * only — there is nothing for it to do once this runs on a real host.
     *
     * ⚠️ `require`d **here**, not at the top of the file. `ngrok` lives in
     * `devDependencies`, so a production install (`npm ci --omit=dev`) does not
     * have it — and a top-level require would then throw before the server ever
     * listened. Inside this branch it is only reached when somebody has asked
     * for a tunnel, which can only be true where the package is installed.
     */
    if (config.ENABLE_NGROK) {
      const ngrok = require("ngrok");
      const url = await ngrok.connect({
        addr: port,
        authtoken: config.NGROK_AUTH_TOKEN,
        // subdomain: process.env.NGROK_SUBDOMAIN // must be set for custom subdomain
      });
      console.log(`Public URL: ${url}`);
    }
  });
})();
