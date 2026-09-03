require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const ngrok = require("ngrok");
const fileUpload = require("express-fileupload");
const compression = require("compression");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { mongoDb } = require("./database/mongoDb");
const { errorHandler } = require("./middlewares");
const { logChannelStatus } = require("./helpers/notifications");
const { logPaymentAccounts, assertMoneyIndexes } = require("./helpers/transactions");
const { throwError } = require("./utils");
const allRoutes = require("./routes");
const { getIP } = require("./configs/render");
const { startJobs } = require("./jobs");

const app = express();
const port = process.env.PORT || 8080;

/**
 * ⚠️ Only ever used to choose a log format. `NODE_ENV=production` is set in some
 * shells on the dev machine here (see `CLAUDE.md`), so anything that changes
 * behaviour must not hang off it — the money paths and index handling all read
 * their own named variables instead.
 */
const isProduction = process.env.NODE_ENV === "production";

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
app.set("trust proxy", Number.parseInt(process.env.TRUST_PROXY ?? "1", 10));

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
app.use(morgan(process.env.LOG_FORMAT || (isProduction ? "combined" : "dev")));

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
    limit: Number.parseInt(process.env.RATE_LIMIT_MAX ?? "3000", 10),
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

app.use(fileUpload({ useTempFiles: true, tempFileDir: "/tmp/" }));
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
    startJobs().catch((error) =>
      console.error("❌ [jobs] failed to start:", error?.message),
    );
    if (process.env.ENABLE_NGROK === "true") {
      const url = await ngrok.connect({
        addr: port,
        authtoken: process.env.NGROK_AUTH_TOKEN,
        // subdomain: process.env.NGROK_SUBDOMAIN // must be set for custom subdomain
      });
      console.log(`Public URL: ${url}`);
    }
  });
})();
